import { canonicalizeUrl, uniqueStrings } from "./contracts.js";
import { createNormalizedItem, mergeRiskWarnings } from "./schema.js";
import {
  buildItemIdentitySignals,
  mergeCanonicalIdentifiers,
  itemsShareIdentity,
} from "./item-identity.js";

const TRACKING_QUERY_PARAMS = new Set(["ref", "source", "s", "t"]);

export function createDefaultDeduplicationHooks() {
  return {
    fingerprints(item) {
      return buildFingerprints(item);
    },

    isDuplicate(left, right) {
      return itemsShareIdentity(left, right);
    },

    merge(left, right) {
      const primary = preferPrimary(left, right);
      const secondary = primary === left ? right : left;
      const sourceUrls = mergeSourceUrls(left, right);
      const canonicalSourceUrl = selectCanonicalSourceUrl(primary.sourceUrl, sourceUrls);
      const sourceAuthorityScore = Math.max(left.sourceAuthorityScore, right.sourceAuthorityScore);
      const mentionCount = countGroupedMentions([left, right]);
      const deduplicationFingerprints = uniqueStrings([
        ...readDeduplicationFingerprints(primary),
        ...readDeduplicationFingerprints(secondary),
        ...buildFingerprints(left),
        ...buildFingerprints(right),
      ]);
      const canonicalIdentifiers = mergeCanonicalIdentifiers(
        primary.canonicalIdentifiers ?? null,
        secondary.canonicalIdentifiers ?? null,
      );
      const identitySignals = uniqueStrings([
        ...buildItemIdentitySignals(left),
        ...buildItemIdentitySignals(right),
      ]);

      return createNormalizedItem({
        ...primary,
        itemId: left.itemId === right.itemId ? left.itemId : undefined,
        sourceUrl: canonicalSourceUrl,
        sourceUrls,
        summary: pickRicherText(left.summary, right.summary),
        integrationHint: pickRicherText(left.integrationHint, right.integrationHint),
        riskWarning: pickHigherRiskWarning(left.riskWarning, right.riskWarning),
        mentionCount,
        publishedAt: pickEarlierTimestamp(left.publishedAt, right.publishedAt),
        discoveredAt: pickEarlierTimestamp(left.discoveredAt, right.discoveredAt),
        firstSeen: pickEarlierTimestamp(left.firstSeen, right.firstSeen),
        editionCount: Math.max(left.editionCount ?? 1, right.editionCount ?? 1),
        canonicalIdentifiers,
        sourceKinds: uniqueStrings([...left.sourceKinds, ...right.sourceKinds]),
        adapterIds: uniqueStrings([...left.adapterIds, ...right.adapterIds]),
        sourceAuthorityScore,
        relevanceScore: maxNullable(left.relevanceScore, right.relevanceScore),
        scoreVersion: pickScoreVersion(left, right),
        scoreInterpretation: pickScoreInterpretation(left, right),
        scoringSignals: {
          recencyHours: minNullable(left.scoringSignals.recencyHours, right.scoringSignals.recencyHours),
          sourceAuthority: sourceAuthorityScore,
          mentionCount,
          githubStars: maxNullable(left.scoringSignals.githubStars, right.scoringSignals.githubStars),
          githubActivity: maxNullable(
            left.scoringSignals.githubActivity,
            right.scoringSignals.githubActivity,
          ),
          socialEngagement: maxNullable(
            left.scoringSignals.socialEngagement,
            right.scoringSignals.socialEngagement,
          ),
        },
        metadata: {
          ...mergeMetadata(secondary.metadata, primary.metadata),
          mergedFrom: uniqueStrings([
            ...(primary.metadata.mergedFrom ?? []),
            ...(secondary.metadata.mergedFrom ?? []),
            left.id,
            right.id,
          ]),
          identitySignals,
          deduplicationFingerprints,
        },
      });
    },
  };
}

export function deduplicateItems(items, hooks = createDefaultDeduplicationHooks()) {
  return groupDuplicateItems(items, hooks).map((group) => consolidateMatchedItems(group, hooks));
}

export function groupDuplicateItems(items, hooks = createDefaultDeduplicationHooks()) {
  /** @type {import("./contracts.js").NormalizedItem[][]} */
  const groups = [];

  for (const item of items) {
    const matchingIndexes = [];

    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];

      if (group.some((candidate) => hooks.isDuplicate(candidate, item))) {
        matchingIndexes.push(index);
      }
    }

    if (matchingIndexes.length === 0) {
      groups.push([item]);
      continue;
    }

    const [primaryIndex, ...secondaryIndexes] = matchingIndexes;
    const primaryGroup = groups[primaryIndex];
    primaryGroup.push(item);

    for (const index of [...secondaryIndexes].sort((left, right) => right - left)) {
      const [secondaryGroup] = groups.splice(index, 1);
      primaryGroup.push(...secondaryGroup);
    }
  }

  return groups.map((group) => assignDeduplicationCluster(group, hooks));
}

function buildFingerprints(item) {
  return uniqueStrings([
    ...readDeduplicationFingerprints(item),
    ...buildItemIdentitySignals(item),
  ]);
}

export function consolidateMatchedItems(group, hooks = createDefaultDeduplicationHooks()) {
  if (group.length === 0) {
    throw new TypeError("matched item groups must contain at least one item");
  }

  const mergedItem = group
    .slice(1)
    .reduce((candidateItem, item) => hooks.merge(candidateItem, item), group[0]);
  const sourceUrls = mergeSourceUrls(group);
  const mentionCount = countGroupedMentions(group);
  const sourceProvenance = group.length > 1 ? mergeSourceProvenance(group) : null;

  return {
    ...mergedItem,
    sourceUrl: selectCanonicalSourceUrl(mergedItem.sourceUrl, sourceUrls),
    sourceUrls,
    mentionCount,
    scoringSignals: {
      ...mergedItem.scoringSignals,
      mentionCount,
    },
    metadata:
      sourceProvenance == null
        ? mergedItem.metadata
        : {
            ...mergedItem.metadata,
            sourceProvenance,
          },
  };
}

function assignDeduplicationCluster(group, hooks) {
  const consolidated = consolidateMatchedItems(group, hooks);
  const deduplicationClusterId = consolidated.itemId;
  const deduplicationClusterSourceIds = uniqueStrings(group.map((item) => item.id));
  const deduplicationFingerprints = uniqueStrings([
    ...readDeduplicationFingerprints(consolidated),
    ...group.flatMap((item) => hooks.fingerprints(item)),
  ]);
  const clusterCanonicalIdentifiers = mergeCanonicalIdentifiers(
    consolidated.canonicalIdentifiers ?? null,
    ...group.map((item) => item.canonicalIdentifiers ?? null),
  );

  return group.map((item) => ({
    ...item,
    itemId: deduplicationClusterId,
    canonicalIdentifiers: mergeCanonicalIdentifiers(
      clusterCanonicalIdentifiers,
      item.canonicalIdentifiers ?? null,
    ),
    metadata: {
      ...(item.metadata ?? {}),
      deduplicationClusterId,
      deduplicationClusterSourceIds,
      deduplicationFingerprints,
    },
  }));
}

function readDeduplicationFingerprints(item) {
  const fingerprints = item.metadata?.deduplicationFingerprints;

  if (!Array.isArray(fingerprints)) {
    return [];
  }

  return fingerprints.filter((fingerprint) => typeof fingerprint === "string" && fingerprint.length > 0);
}

function preferPrimary(left, right) {
  if (left.sourceAuthorityScore !== right.sourceAuthorityScore) {
    return left.sourceAuthorityScore >= right.sourceAuthorityScore ? left : right;
  }

  if (left.mentionCount !== right.mentionCount) {
    return left.mentionCount >= right.mentionCount ? left : right;
  }

  return left;
}

function pickRicherText(left, right) {
  return left.length >= right.length ? left : right;
}

function pickHigherRiskWarning(left, right) {
  return mergeRiskWarnings(left, right);
}

function pickEarlierTimestamp(left, right) {
  if (left == null) {
    return right;
  }

  if (right == null) {
    return left;
  }

  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function maxNullable(left, right) {
  if (left == null) {
    return right ?? null;
  }

  if (right == null) {
    return left;
  }

  return Math.max(left, right);
}

function minNullable(left, right) {
  if (left == null) {
    return right ?? null;
  }

  if (right == null) {
    return left;
  }

  return Math.min(left, right);
}

function pickScoreVersion(left, right) {
  if (left.relevanceScore == null && right.relevanceScore == null) {
    return null;
  }

  if (right.relevanceScore == null) {
    return left.scoreVersion ?? null;
  }

  if (left.relevanceScore == null) {
    return right.scoreVersion ?? null;
  }

  if (left.relevanceScore > right.relevanceScore) {
    return left.scoreVersion ?? right.scoreVersion ?? null;
  }

  if (right.relevanceScore > left.relevanceScore) {
    return right.scoreVersion ?? left.scoreVersion ?? null;
  }

  return left.scoreVersion ?? right.scoreVersion ?? null;
}

function pickScoreInterpretation(left, right) {
  if (left.relevanceScore == null && right.relevanceScore == null) {
    return null;
  }

  if (right.relevanceScore == null) {
    return left.scoreInterpretation ?? null;
  }

  if (left.relevanceScore == null) {
    return right.scoreInterpretation ?? null;
  }

  if (left.relevanceScore > right.relevanceScore) {
    return left.scoreInterpretation ?? right.scoreInterpretation ?? null;
  }

  if (right.relevanceScore > left.relevanceScore) {
    return right.scoreInterpretation ?? left.scoreInterpretation ?? null;
  }

  return left.scoreInterpretation ?? right.scoreInterpretation ?? null;
}

function mergeMetadata(secondaryMetadata = {}, primaryMetadata = {}) {
  const merged = {
    ...secondaryMetadata,
    ...primaryMetadata,
  };

  for (const key of [
    "outboundUrls",
    "tags",
    "searchQueries",
    "discoveryChannels",
    "discoveryUrls",
    "identitySignals",
  ]) {
    const values = [
      ...(Array.isArray(secondaryMetadata[key]) ? secondaryMetadata[key] : []),
      ...(Array.isArray(primaryMetadata[key]) ? primaryMetadata[key] : []),
    ];

    if (values.length > 0) {
      merged[key] = uniqueStrings(values);
    }
  }

  const sourceSentiments = [
    ...(Array.isArray(secondaryMetadata.sourceSentiments) ? secondaryMetadata.sourceSentiments : []),
    ...(Array.isArray(primaryMetadata.sourceSentiments) ? primaryMetadata.sourceSentiments : []),
  ];

  if (sourceSentiments.length > 0) {
    merged.sourceSentiments = sourceSentiments;
  }

  return merged;
}

function countGroupedMentions(group) {
  return group.reduce((total, item) => {
    const mentionCount =
      Number.isFinite(item?.mentionCount) && item.mentionCount > 0
        ? Math.trunc(item.mentionCount)
        : 1;

    return total + mentionCount;
  }, 0);
}

function mergeSourceProvenance(items) {
  const merged = new Map();

  for (const item of items) {
    for (const entry of readSourceProvenanceEntries(item)) {
      const normalizedEntry = normalizeSourceProvenanceEntry(entry, item);

      if (!normalizedEntry) {
        continue;
      }

      merged.set(stableSerialize(normalizedEntry), normalizedEntry);
    }
  }

  return [...merged.values()].sort(compareSourceProvenanceEntries);
}

function readSourceProvenanceEntries(item) {
  const sourceProvenance = item?.metadata?.sourceProvenance;

  if (Array.isArray(sourceProvenance)) {
    return sourceProvenance;
  }

  if (sourceProvenance && typeof sourceProvenance === "object") {
    return [sourceProvenance];
  }

  const fallbackEntry = buildSyntheticSourceProvenance(item);

  return fallbackEntry == null ? [] : [fallbackEntry];
}

function normalizeSourceProvenanceEntry(entry, item) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return buildSyntheticSourceProvenance(item);
  }

  const sourceUrl = resolveProvenanceSourceUrl(entry, item);
  const sourceItemId = normalizeOptionalString(
    entry.sourceItemId ?? entry.source_item_id ?? item?.id ?? null,
  );
  const contributedMentionCount = resolveContributedMentionCount(item);
  const adapterId = normalizeOptionalString(
    entry.adapterId ?? entry.adapter_id ?? item?.adapterIds?.[0] ?? null,
  );
  const sourceKind = normalizeOptionalString(
    entry.sourceKind ?? entry.source_kind ?? item?.sourceKinds?.[0] ?? null,
  );
  const sourceName = normalizeOptionalString(
    entry.sourceName ?? entry.source_name ?? item?.metadata?.sourceName ?? null,
  );
  const sourceType = normalizeOptionalString(
    entry.sourceType ?? entry.source_type ?? item?.metadata?.sourceType ?? null,
  );

  return {
    ...entry,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceItemId ? { sourceItemId } : {}),
    contributedMentionCount,
    ...(adapterId ? { adapterId } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    ...(sourceName ? { sourceName } : {}),
    ...(sourceType ? { sourceType } : {}),
  };
}

function buildSyntheticSourceProvenance(item) {
  const sourceUrl = resolveProvenanceSourceUrl({}, item);
  const sourceItemId = normalizeOptionalString(item?.id ?? null);
  const adapterId = normalizeOptionalString(item?.adapterIds?.[0] ?? null);
  const sourceKind = normalizeOptionalString(item?.sourceKinds?.[0] ?? null);
  const sourceName = normalizeOptionalString(item?.metadata?.sourceName ?? null);
  const sourceType = normalizeOptionalString(item?.metadata?.sourceType ?? null);
  const fetchedAt = normalizeOptionalString(item?.metadata?.fetchedAt ?? null);
  const fetchedFromUrl = normalizeOptionalString(item?.metadata?.fetchedFromUrl ?? null);
  const requestUrl = normalizeOptionalString(item?.metadata?.requestUrl ?? null);
  const query = normalizeOptionalString(item?.metadata?.query ?? null);

  if (!sourceUrl && !sourceItemId && !adapterId && !sourceKind) {
    return null;
  }

  return {
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceItemId ? { sourceItemId } : {}),
    contributedMentionCount: resolveContributedMentionCount(item),
    ...(adapterId ? { adapterId } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    ...(sourceName ? { sourceName } : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(fetchedAt ? { fetchedAt } : {}),
    ...(fetchedFromUrl ? { fetchedFromUrl } : {}),
    ...(requestUrl ? { requestUrl } : {}),
    ...(query ? { query } : {}),
  };
}

function mergeSourceUrls(...entries) {
  const merged = new Map();
  const items = entries.flat();

  for (const item of items) {
    for (const value of [
      item.sourceUrl,
      ...(Array.isArray(item.sourceUrls) ? item.sourceUrls : []),
    ]) {
      const cleanedValue = sanitizeSourceUrl(value);
      const deduplicationKey = normalizeDuplicateUrl(cleanedValue);
      const existingValue = merged.get(deduplicationKey);

      if (!existingValue || isPreferredSourceUrlVariant(cleanedValue, existingValue)) {
        merged.set(deduplicationKey, cleanedValue);
      }
    }
  }

  return [...merged.values()];
}

function selectCanonicalSourceUrl(sourceUrl, sourceUrls) {
  const sanitizedSourceUrl = sanitizeSourceUrl(sourceUrl);
  const sourceKey = normalizeDuplicateUrl(sanitizedSourceUrl);

  return (
    sourceUrls.find((value) => normalizeDuplicateUrl(value) === sourceKey) ??
    sanitizedSourceUrl
  );
}

function removeTrackingQueryParams(value) {
  const url = new URL(canonicalizeUrl(value));

  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || TRACKING_QUERY_PARAMS.has(key)) {
      url.searchParams.delete(key);
    }
  }

  return url.toString();
}

function sanitizeSourceUrl(value) {
  const url = new URL(removeTrackingQueryParams(value));

  if (
    url.hostname === "twitter.com" ||
    url.hostname === "www.twitter.com" ||
    url.hostname === "mobile.twitter.com"
  ) {
    url.hostname = "x.com";
  }

  if (url.hostname === "github.com" || url.hostname === "www.github.com") {
    url.hostname = "github.com";
    url.pathname = url.pathname.toLowerCase();
  }

  return url.toString();
}

function isPreferredSourceUrlVariant(candidate, current) {
  return scoreSourceUrlVariant(candidate) > scoreSourceUrlVariant(current);
}

function scoreSourceUrlVariant(value) {
  const url = new URL(value);
  let score = 0;

  if (![...url.searchParams.keys()].some((key) => key.startsWith("utm_") || TRACKING_QUERY_PARAMS.has(key))) {
    score += 8;
  }

  if (url.hostname === "x.com") {
    score += 4;
  }

  if (url.hostname === "github.com" && url.pathname === url.pathname.toLowerCase()) {
    score += 4;
  }

  if (url.pathname === url.pathname.replace(/\/+$/u, "")) {
    score += 1;
  }

  return score;
}

function normalizeDuplicateUrl(value) {
  const url = new URL(removeTrackingQueryParams(value));

  url.hostname = url.hostname.toLowerCase().replace(/^www\./u, "");

  if (url.hostname === "twitter.com") {
    url.hostname = "x.com";
  }

  if (url.hostname === "github.com") {
    url.pathname = url.pathname.toLowerCase();
  }

  return url.toString();
}

function resolveProvenanceSourceUrl(entry, item) {
  const rawSourceUrl = normalizeOptionalString(
    entry?.sourceUrl ?? entry?.source_url ?? item?.sourceUrl ?? null,
  );

  if (!rawSourceUrl) {
    return null;
  }

  try {
    return sanitizeSourceUrl(rawSourceUrl);
  } catch {
    return null;
  }
}

function resolveContributedMentionCount(item) {
  return Number.isFinite(item?.mentionCount) && item.mentionCount > 0
    ? Math.trunc(item.mentionCount)
    : 1;
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function compareSourceProvenanceEntries(left, right) {
  return compareNullableValues(left.sourceUrl, right.sourceUrl) ||
    compareNullableValues(left.sourceItemId, right.sourceItemId) ||
    compareNullableValues(left.adapterId, right.adapterId) ||
    compareNullableValues(left.sourceKind, right.sourceKind) ||
    compareNullableValues(left.channel, right.channel) ||
    compareNullableValues(left.requestUrl, right.requestUrl) ||
    compareNullableValues(left.fetchedFromUrl, right.fetchedFromUrl) ||
    compareNullableValues(left.queryUrl, right.queryUrl) ||
    compareNullableValues(left.query, right.query) ||
    compareNullableValues(left.fetchedAt, right.fetchedAt) ||
    compareNullableNumbers(left.rank, right.rank);
}

function compareNullableValues(left, right) {
  const normalizedLeft = typeof left === "string" ? left : "";
  const normalizedRight = typeof right === "string" ? right : "";

  return normalizedLeft.localeCompare(normalizedRight);
}

function compareNullableNumbers(left, right) {
  const normalizedLeft = Number.isFinite(left) ? left : -1;
  const normalizedRight = Number.isFinite(right) ? right : -1;

  return normalizedLeft - normalizedRight;
}

function stableSerialize(value) {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(",")}}`;
}
