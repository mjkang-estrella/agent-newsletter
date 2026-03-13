import {
  CONTENT_CATEGORIES,
  DISAGREEMENT_DIMENSIONS,
  RISK_WARNING_DIMENSIONS,
  RISK_SEVERITIES,
  SCORE_INTERPRETATIONS,
  SENTIMENT_SPREADS,
  SOURCE_SENTIMENTS,
  SOURCE_KINDS,
  assertNonEmptyString,
  assertOneOf,
  canonicalizeUrl,
  clampScore,
  normalizeOptionalMetric,
  normalizePositiveInteger,
  normalizeTimestamp,
  slugify,
  uniqueStrings,
} from "./contracts.js";
import {
  buildStableItemId,
  extractCanonicalIdentifiersFromContent,
  mergeCanonicalIdentifiers,
  resolveCanonicalIdentifiers,
} from "./item-identity.js";
import { countDistinctSourceClusters } from "./source-clusters.js";
import {
  DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
} from "./relevance-scoring.js";
import { DEFAULT_DISCOVERY_CONFIG } from "../discovery/config.js";
import { resolveSourceAuthorityWeight } from "../discovery/source-authority.js";
import { normalizeSourceLifecycle } from "../discovery/source-lifecycle.js";

export { countDistinctSourceClusters } from "./source-clusters.js";

const DISAGREEMENT_DIMENSION_KEYWORDS = Object.freeze({
  security: [
    "security",
    "secure",
    "unsafe",
    "vulnerability",
    "vulnerable",
    "exploit",
    "audit",
    "breach",
    "auth",
    "permission",
    "credential",
    "secret",
    "sandbox",
    "isolation",
    "prompt injection",
    "jailbreak",
    "guardrail",
    "safety",
  ],
  utility: [
    "utility",
    "useful",
    "workflow",
    "integration",
    "setup",
    "prerequisite",
    "caveat",
    "reliability",
    "stable",
    "stability",
    "regression",
    "breakage",
    "rollback",
    "latency",
    "performance",
    "operational",
    "production",
    "docs",
    "documentation",
    "fit",
  ],
  novelty: [
    "novel",
    "novelty",
    "new",
    "release",
    "launch",
    "announced",
    "incremental",
    "derivative",
    "original",
    "breakthrough",
    "state of the art",
    "sota",
    "research",
    "paper",
  ],
  market: [
    "market",
    "commercial",
    "pricing",
    "enterprise",
    "customer",
    "adoption",
    "ecosystem",
    "demand",
    "traction",
    "vendor",
    "category",
    "competitive",
    "monetization",
    "go-to-market",
  ],
});
const DEFAULT_INFERRED_DISAGREEMENT_DIMENSION = "utility";
const DEFAULT_RISK_WARNING_DESCRIPTION = "Risk review pending.";
const RISK_SEVERITY_RANK = Object.freeze({
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
});

export function createSourceDescriptor(input) {
  const authorityScore = clampScore(input.authorityScore ?? 50, "authorityScore");

  return {
    id: assertNonEmptyString(input.id, "id"),
    kind: assertOneOf(input.kind, SOURCE_KINDS, "kind"),
    displayName: assertNonEmptyString(input.displayName, "displayName"),
    authorityScore,
    seeded: Boolean(input.seeded),
    supportsDiscovery: Boolean(input.supportsDiscovery),
    minimumItemAuthorityScore: clampScore(
      input.minimumItemAuthorityScore ?? authorityScore,
      "minimumItemAuthorityScore",
    ),
  };
}

export function normalizeRiskWarning(input) {
  if (input == null) {
    return normalizeRiskWarningDimension(null);
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("riskWarning must be an object when provided");
  }

  const legacyFallback = normalizeRiskWarningDimension(input, "riskWarning");

  if (!hasTypedRiskWarningDimensions(input)) {
    return legacyFallback;
  }

  const dimensions = Object.fromEntries(
    RISK_WARNING_DIMENSIONS.map((dimension) => [
      dimension,
      normalizeRiskWarningDimension(
        resolveRiskWarningDimensionInput(input, dimension) ?? legacyFallback,
        `riskWarning.${dimension}`,
      ),
    ]),
  );

  return createTypedRiskWarning(dimensions);
}

export function mergeRiskWarnings(left, right) {
  if (left == null) {
    return normalizeRiskWarning(right);
  }

  if (right == null) {
    return normalizeRiskWarning(left);
  }

  const normalizedLeft = normalizeRiskWarning(left);
  const normalizedRight = normalizeRiskWarning(right);

  if (
    !hasTypedRiskWarningDimensions(normalizedLeft) &&
    !hasTypedRiskWarningDimensions(normalizedRight)
  ) {
    return pickHigherRiskWarningDimension(normalizedLeft, normalizedRight);
  }

  const dimensions = Object.fromEntries(
    RISK_WARNING_DIMENSIONS.map((dimension) => [
      dimension,
      pickHigherRiskWarningDimension(
        resolveRiskWarningDimensionInput(normalizedLeft, dimension) ?? normalizedLeft,
        resolveRiskWarningDimensionInput(normalizedRight, dimension) ?? normalizedRight,
      ),
    ]),
  );

  return createTypedRiskWarning(dimensions);
}

export function normalizeSourceSentiment(value, fieldName = "sourceSentiment") {
  if (value == null) {
    return null;
  }

  return assertOneOf(value, SOURCE_SENTIMENTS, fieldName);
}

export function normalizeDisagreementDimension(
  value,
  fieldName = "disagreementDimension",
) {
  if (value == null) {
    return null;
  }

  return assertOneOf(value, DISAGREEMENT_DIMENSIONS, fieldName);
}

export function normalizeSentimentSpread(value, fieldName = "sentimentSpread") {
  if (typeof value === "string") {
    return createSentimentSpread(
      assertOneOf(value, SENTIMENT_SPREADS, `${fieldName}.classification`),
      null,
      fieldName,
    );
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be a string or object`);
  }

  const classification = assertOneOf(
    value.classification ?? value.spread ?? value.type,
    SENTIMENT_SPREADS,
    `${fieldName}.classification`,
  );
  const disagreementDimension = normalizeDisagreementDimension(
    value.disagreementDimension ?? value.disagreement_dimension ?? null,
    `${fieldName}.disagreementDimension`,
  );

  return createSentimentSpread(classification, disagreementDimension, fieldName);
}

export function normalizeScoringSignals(input = {}) {
  const mentionCount = normalizePositiveInteger(input.mentionCount, 1);
  const sourceAuthority =
    input.sourceAuthority ?? input.sourceAuthorityScore ?? null;

  return {
    recencyHours: normalizeOptionalMetric(input.recencyHours, "scoringSignals.recencyHours"),
    sourceAuthority:
      sourceAuthority == null
        ? null
        : clampScore(sourceAuthority, "scoringSignals.sourceAuthority"),
    mentionCount,
    githubStars: normalizeOptionalMetric(input.githubStars, "scoringSignals.githubStars"),
    githubActivity: normalizeOptionalMetric(input.githubActivity, "scoringSignals.githubActivity"),
    socialEngagement: normalizeOptionalMetric(
      input.socialEngagement,
      "scoringSignals.socialEngagement",
    ),
  };
}

export function normalizeSourceSentiments(
  values,
  { sourceUrl = null, sourceSentiment = null } = {},
) {
  if (values != null && !Array.isArray(values)) {
    throw new TypeError("metadata.sourceSentiments must be an array when provided");
  }

  const normalized = new Map();

  for (const entry of values ?? []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("metadata.sourceSentiments[] must be an object");
    }

    const normalizedUrl = canonicalizeUrl(
      entry.sourceUrl,
      "metadata.sourceSentiments[].sourceUrl",
    );
    const sentiment = assertOneOf(
      entry.sentiment,
      SOURCE_SENTIMENTS,
      "metadata.sourceSentiments[].sentiment",
    );
    const disagreementDimension = normalizeDisagreementDimension(
      entry.disagreementDimension ?? entry.disagreement_dimension ?? null,
      "metadata.sourceSentiments[].disagreementDimension",
    );
    const existingEntry = normalized.get(normalizedUrl);

    normalized.set(normalizedUrl, {
      sourceUrl: normalizedUrl,
      sentiment,
      ...(disagreementDimension ?? existingEntry?.disagreementDimension
        ? {
            disagreementDimension:
              disagreementDimension ?? existingEntry.disagreementDimension,
          }
        : {}),
    });
  }

  if (sourceUrl && sourceSentiment) {
    const existingEntry = normalized.get(sourceUrl);

    normalized.set(sourceUrl, {
      sourceUrl,
      sentiment: sourceSentiment,
      ...(existingEntry?.disagreementDimension
        ? { disagreementDimension: existingEntry.disagreementDimension }
        : {}),
    });
  }

  return [...normalized.values()];
}

export function deriveSentimentSpread(
  sourceSentiments = [],
  fallbackSentiment = null,
  fallbackDisagreementDimension = null,
) {
  if (!Array.isArray(sourceSentiments)) {
    throw new TypeError("sourceSentiments must be an array");
  }

  const sentiments = new Set(
    sourceSentiments
      .map((entry) => entry?.sentiment)
      .filter((sentiment) => sentiment != null)
      .map((sentiment) => normalizeSourceSentiment(sentiment, "sourceSentiments[].sentiment")),
  );

  const normalizedFallback = normalizeSourceSentiment(fallbackSentiment, "sourceSentiment");

  if (sentiments.size === 0 && normalizedFallback) {
    sentiments.add(normalizedFallback);
  }

  if (sentiments.size <= 1) {
    return createSentimentSpread("agree", null);
  }

  const disagreementDimension = resolveContestedDisagreementDimension(
    sourceSentiments,
    fallbackDisagreementDimension,
  );

  if (sentiments.size === 2 && sentiments.has("positive") && sentiments.has("negative")) {
    return createSentimentSpread("disagree", disagreementDimension);
  }

  return createSentimentSpread("mixed", disagreementDimension);
}

function resolveContestedDisagreementDimension(
  sourceSentiments,
  fallbackDisagreementDimension,
) {
  const normalizedFallback = normalizeDisagreementDimension(
    fallbackDisagreementDimension,
    "sentimentSpread.disagreementDimension",
  );
  const disagreementDimensionCounts = new Map();

  for (const entry of sourceSentiments) {
    const disagreementDimension = normalizeDisagreementDimension(
      entry?.disagreementDimension ?? null,
      "sourceSentiments[].disagreementDimension",
    );

    if (!disagreementDimension) {
      continue;
    }

    disagreementDimensionCounts.set(
      disagreementDimension,
      (disagreementDimensionCounts.get(disagreementDimension) ?? 0) + 1,
    );
  }

  if (disagreementDimensionCounts.size === 0) {
    if (normalizedFallback) {
      return normalizedFallback;
    }

    throw new TypeError(
      "sentimentSpread.disagreementDimension is required for contested sentiment",
    );
  }

  return [...disagreementDimensionCounts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return DISAGREEMENT_DIMENSIONS.indexOf(left[0]) - DISAGREEMENT_DIMENSIONS.indexOf(right[0]);
    })[0][0];
}

export function createNormalizedItem(input) {
  const sourceUrl = canonicalizeUrl(
    input.sourceUrl ?? input.source_url,
    "sourceUrl",
  );
  const sourceUrls = uniqueStrings(
    [sourceUrl, ...(input.sourceUrls ?? input.source_urls ?? [])].map((value) =>
      canonicalizeUrl(value, "sourceUrls[]"),
    ),
  );
  const mentionCount = normalizePositiveInteger(
    input.mentionCount ?? input.mention_count,
    inferMentionCount(sourceUrls, input.metadata),
  );
  const discoveredAt = normalizeTimestamp(
    input.discoveredAt ?? new Date().toISOString(),
    "discoveredAt",
  );
  const sourceKinds = uniqueStrings(
    (input.sourceKinds ?? [input.sourceKind]).filter(Boolean).map((value) =>
      assertOneOf(value, SOURCE_KINDS, "sourceKinds[]"),
    ),
  );

  if (sourceKinds.length === 0) {
    throw new TypeError("sourceKinds must include at least one source kind");
  }

  const adapterIds = uniqueStrings(
    (input.adapterIds ?? [input.adapterId]).filter(Boolean).map((value) =>
      assertNonEmptyString(value, "adapterIds[]"),
    ),
  );

  if (adapterIds.length === 0) {
    throw new TypeError("adapterIds must include at least one adapter identifier");
  }

  const sourceAuthorityScore = clampScore(
    input.sourceAuthorityScore ?? input.scoringSignals?.sourceAuthority ?? 0,
    "sourceAuthorityScore",
  );
  const explicitSentimentSpread =
    input.sentimentSpread == null
      ? null
      : normalizeSentimentSpread(input.sentimentSpread);
  const sourceSentimentInput = normalizeSourceSentiment(
    input.sourceSentiment ?? input.metadata?.sourceSentiment ?? null,
  );
  const sourceSentiments = normalizeSourceSentiments(input.metadata?.sourceSentiments, {
    sourceUrl,
    sourceSentiment: sourceSentimentInput,
  });
  const inferredDisagreementDimension =
    sourceSentiments.length > 0
      ? inferDisagreementDimensionFromItemContext(input)
      : null;
  const sentimentSpread =
    sourceSentiments.length > 0
      ? deriveSentimentSpread(
          sourceSentiments,
          null,
          explicitSentimentSpread?.disagreementDimension ?? inferredDisagreementDimension,
        )
      : explicitSentimentSpread ?? deriveSentimentSpread([], sourceSentimentInput);
  const normalizedSourceSentiments = isContestedSentimentSpread(sentimentSpread)
    ? backfillSourceSentimentDisagreementDimensions(
        sourceSentiments,
        sentimentSpread.disagreementDimension,
      )
    : sourceSentiments;
  const sourceSentiment =
    normalizedSourceSentiments.find((entry) => entry.sourceUrl === sourceUrl)?.sentiment ??
    sourceSentimentInput;
  const divergenceFlag = isContestedSentimentSpread(sentimentSpread);
  const scoringSignals = normalizeScoringSignals({
    ...input.scoringSignals,
    mentionCount,
    sourceAuthority:
      input.scoringSignals?.sourceAuthority ?? input.sourceAuthorityScore ?? null,
  });
  const category = assertOneOf(input.category, CONTENT_CATEGORIES, "category");
  const name = assertNonEmptyString(input.name, "name");
  const publishedAt = input.publishedAt == null ? null : normalizeTimestamp(input.publishedAt, "publishedAt");
  const rawRelevanceScore = input.relevanceScore ?? input.relevance_score ?? null;
  const relevanceScore =
    rawRelevanceScore == null ? null : clampScore(rawRelevanceScore, "relevanceScore");
  const scoreVersion = normalizeScoreVersion(
    input.scoreVersion ??
      input.score_version ??
      input.metadata?.scoring?.scoreVersion ??
      input.metadata?.scoring?.score_version ??
      input.metadata?.curation?.relevanceGate?.scoreVersion ??
      input.metadata?.curation?.relevanceGate?.score_version ??
      (relevanceScore == null ? null : DEFAULT_RELEVANCE_SCORE_VERSION),
    relevanceScore,
  );
  const scoreInterpretation = normalizeScoreInterpretation(
    input.scoreInterpretation ??
      input.score_interpretation ??
      input.metadata?.scoring?.scoreInterpretation ??
      input.metadata?.scoring?.score_interpretation ??
      input.metadata?.curation?.relevanceGate?.scoreInterpretation ??
      input.metadata?.curation?.relevanceGate?.score_interpretation ??
      (relevanceScore == null ? null : DEFAULT_RELEVANCE_SCORE_INTERPRETATION),
    relevanceScore,
  );
  const metadata = withScoreProvenance(
    normalizeItemMetadata(input.metadata, normalizedSourceSentiments),
    relevanceScore,
    scoreVersion,
    scoreInterpretation,
    divergenceFlag,
  );
  const providedCanonicalIdentifiers =
    input.canonicalIdentifiers ?? input.canonical_identifiers ?? null;
  const baseItem = {
    id: input.id ?? buildItemId({ category, name, sourceUrl }),
    name,
    sourceUrl,
    sourceUrls,
    category,
    summary: assertNonEmptyString(input.summary, "summary"),
    integrationHint: assertNonEmptyString(input.integrationHint, "integrationHint"),
    relevanceScore,
    scoreVersion,
    scoreInterpretation,
    divergenceFlag,
    sourceSentiment,
    sentimentSpread,
    riskWarning: normalizeRiskWarning(input.riskWarning),
    mentionCount,
    publishedAt,
    discoveredAt,
    sourceKinds,
    adapterIds,
    sourceAuthorityScore,
    scoringSignals,
    metadata,
  };
  const inferredCanonicalIdentifiers = extractCanonicalIdentifiersFromContent(baseItem);
  const canonicalIdentifiers = resolveCanonicalIdentifiers(
    baseItem,
    mergeCanonicalIdentifiers(providedCanonicalIdentifiers, inferredCanonicalIdentifiers),
  );
  const itemId = assertNonEmptyString(
    input.itemId ??
      input.item_id ??
      buildStableItemId({
        ...baseItem,
        canonicalIdentifiers,
      }),
    "itemId",
  );
  const firstSeen = normalizeTimestamp(
    input.firstSeen ?? input.first_seen ?? discoveredAt,
    "firstSeen",
  );
  const editionCount = normalizeEditionCount(
    input.editionCount ?? input.edition_count ?? 1,
  );
  const scopeVersion = normalizeScopeVersion(
    input.scopeVersion ??
      input.scope_version ??
      input.metadata?.scopeVersion ??
      input.metadata?.scope_version ??
      input.metadata?.scope?.version ??
      null,
  );
  const storylineMetadata = input.metadata?.storyline ?? null;
  const storylineIds = normalizeStorylineIds(
    input.storylineIds ??
      input.storyline_ids ??
      storylineMetadata?.storylineIds ??
      storylineMetadata?.storyline_ids ??
      null,
    input.storylineId ??
      input.storyline_id ??
      storylineMetadata?.storylineId ??
      storylineMetadata?.storyline_id ??
      storylineMetadata?.id ??
      null,
  );
  const storylineId = storylineIds[0] ?? null;
  const storylineMemberPosition = normalizeOptionalStorylineMemberPosition(
    input.storylineMemberPosition ??
      input.storyline_member_position ??
      storylineMetadata?.position ??
      null,
  );

  return {
    ...baseItem,
    itemId,
    canonicalIdentifiers,
    firstSeen,
    editionCount,
    scopeVersion,
    storylineId,
    storylineIds,
    storylineMemberPosition,
  };
}

export function createNormalizedItemFromSourceRecord(record, options = {}) {
  const sourceKind =
    options.sourceKind ?? normalizeLegacySourceKind(record.sourceType ?? record.type);
  const sourceAuthority =
    record.sourceAuthority?.authority ?? record.sourceAuthorityScore ?? 0;
  const mentionCount = record.metrics?.mentions ?? record.mentionCount ?? 1;
  const socialEngagement =
    record.scoringSignals?.socialEngagement ??
    sumMetrics(record.metrics, ["upvotes", "comments", "shares"]);

  return createNormalizedItem({
    id: record.externalId ? `${record.adapterId}-${record.externalId}` : undefined,
    itemId: record.itemId ?? record.item_id,
    name: record.title,
    sourceUrl: record.sourceUrl,
    sourceUrls: record.sourceUrls ?? [],
    category:
      options.category ??
      record.category ??
      inferCategoryFromText(record.title, record.summary, record.tags),
    summary: record.summary || record.title,
    integrationHint:
      options.integrationHint ??
      record.integrationHint ??
      "Review the source and extract concrete setup steps before integration.",
    sourceSentiment: record.sourceSentiment ?? record.metadata?.sourceSentiment ?? null,
    publishedAt: record.publishedAt,
    discoveredAt: record.discoveredAt,
    firstSeen: record.firstSeen ?? record.first_seen,
    editionCount: record.editionCount ?? record.edition_count,
    scopeVersion: record.scopeVersion ?? record.scope_version,
    storylineId: record.storylineId ?? record.storyline_id,
    storylineIds: record.storylineIds ?? record.storyline_ids,
    storylineMemberPosition:
      record.storylineMemberPosition ?? record.storyline_member_position,
    sourceKinds: [sourceKind],
    adapterIds: [record.adapterId],
    sourceAuthorityScore: sourceAuthority,
    mentionCount,
    riskWarning: record.riskWarning ?? options.riskWarning,
    relevanceScore: record.relevanceScore ?? null,
    scoreVersion: record.scoreVersion ?? record.score_version ?? null,
    scoreInterpretation:
      record.scoreInterpretation ?? record.score_interpretation ?? null,
    scoringSignals: {
      ...record.scoringSignals,
      recencyHours: record.scoringSignals?.recencyHours ?? null,
      githubStars: record.scoringSignals?.githubStars ?? null,
      githubActivity: record.scoringSignals?.githubActivity ?? null,
      mentionCount,
      sourceAuthority,
      socialEngagement,
    },
    metadata: {
      ...(record.metadata ?? {}),
      sourceName: record.sourceName ?? null,
      sourceType: record.sourceType ?? null,
      externalId: record.externalId ?? null,
      outboundUrls: record.outboundUrls ?? [],
      tags: record.tags ?? [],
      author: record.author ?? null,
      raw: normalizeSourceRecordRawMetadata(record.metadata?.raw, record.raw),
    },
  });
}

export function createDiscoveredSource(
  input,
  { config = DEFAULT_DISCOVERY_CONFIG } = {},
) {
  const lifecycle = normalizeSourceLifecycle(input, config);
  const authorityScore = clampScore(input.authorityScore ?? 0, "authorityScore");
  const authorityWeight = normalizeDiscoveredSourceAuthorityWeight(
    input.authorityWeight,
    input,
    lifecycle,
    config,
  );

  return {
    id: assertNonEmptyString(input.id, "id"),
    kind: assertOneOf(input.kind, SOURCE_KINDS, "kind"),
    displayName: assertNonEmptyString(input.displayName, "displayName"),
    url: canonicalizeUrl(input.url, "url"),
    status: normalizeDiscoveredSourceStatus(input.status, lifecycle),
    lifecycle: serializeDiscoveredSourceLifecycle(lifecycle),
    authorityScore,
    authorityWeight,
    weightedAuthorityScore: normalizeDiscoveredSourceWeightedAuthorityScore(
      input.weightedAuthorityScore,
      authorityScore,
      authorityWeight,
    ),
    discoveredFromUrls: uniqueStrings(
      (input.discoveredFromUrls ?? []).map((value) => canonicalizeUrl(value, "discoveredFromUrls[]")),
    ),
  };
}

function buildItemId({ category, name, sourceUrl }) {
  const url = new URL(sourceUrl);
  const pathBits = url.pathname.split("/").filter(Boolean).slice(0, 2);
  const slug = slugify([category, name, url.hostname, ...pathBits].join(" "));

  return slug || `${category}-${Date.now()}`;
}

function normalizeEditionCount(value) {
  if (value == null) {
    return 1;
  }

  if (!Number.isFinite(value)) {
    throw new TypeError("editionCount must be a finite number when provided");
  }

  return Math.max(1, Math.trunc(value));
}

function normalizeScopeVersion(value) {
  if (value == null) {
    return null;
  }

  return assertNonEmptyString(value, "scopeVersion");
}

function normalizeDiscoveredSourceStatus(value, lifecycle) {
  if (value === "candidate" || value === "approved" || value === "retired") {
    return value;
  }

  if (lifecycle.state === "retired") {
    return "retired";
  }

  return "candidate";
}

function serializeDiscoveredSourceLifecycle(lifecycle) {
  return {
    state: lifecycle.state,
    stage: lifecycle.stage,
    probationStartedAt: lifecycle.probationStartedAt,
    activatedAt: lifecycle.activatedAt,
    retiredAt: lifecycle.retiredAt,
  };
}

function normalizeDiscoveredSourceAuthorityWeight(value, input, lifecycle, config) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  return resolveSourceAuthorityWeight(
    {
      ...input,
      lifecycle,
    },
    config,
  );
}

function normalizeDiscoveredSourceWeightedAuthorityScore(
  value,
  authorityScore,
  authorityWeight,
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampScore(value, "weightedAuthorityScore");
  }

  return clampScore(
    Math.round(authorityScore * authorityWeight),
    "weightedAuthorityScore",
  );
}

function normalizeOptionalStorylineId(value) {
  if (value == null) {
    return null;
  }

  return assertNonEmptyString(value, "storylineId");
}

function normalizeStorylineIds(values, fallbackValue = null) {
  if (values != null && !Array.isArray(values)) {
    throw new TypeError("storylineIds must be an array when provided");
  }

  return uniqueStrings(
    [...(values ?? []), fallbackValue]
      .filter((value) => value != null)
      .map((value) => normalizeOptionalStorylineId(value))
      .filter(Boolean),
  );
}

function normalizeOptionalStorylineMemberPosition(value) {
  if (value == null) {
    return null;
  }

  if (!Number.isFinite(value)) {
    throw new TypeError("storylineMemberPosition must be a finite number when provided");
  }

  return Math.max(1, Math.trunc(value));
}

function normalizeScoreVersion(value, relevanceScore) {
  if (value == null) {
    return null;
  }

  if (relevanceScore == null) {
    throw new TypeError("scoreVersion requires relevanceScore");
  }

  return assertNonEmptyString(value, "scoreVersion");
}

function normalizeScoreInterpretation(value, relevanceScore) {
  if (value == null) {
    return null;
  }

  if (relevanceScore == null) {
    throw new TypeError("scoreInterpretation requires relevanceScore");
  }

  return assertOneOf(value, SCORE_INTERPRETATIONS, "scoreInterpretation");
}

function normalizeLegacySourceKind(value) {
  const normalized = String(value ?? "web").trim().toLowerCase();

  if (normalized === "twitter") {
    return "x";
  }

  if (SOURCE_KINDS.includes(normalized)) {
    return normalized;
  }

  return "web";
}

function inferCategoryFromText(...values) {
  const haystack = values
    .flat()
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (/\b(api|http api|endpoint)\b/u.test(haystack)) {
    return "api";
  }

  if (/\b(library|sdk|framework|package|gem|npm)\b/u.test(haystack)) {
    return "library";
  }

  if (/\b(tool|toolkit|platform|service|cli|app)\b/u.test(haystack)) {
    return "tool";
  }

  return "technique";
}

function sumMetrics(metrics = {}, keys = []) {
  return keys.reduce((total, key) => {
    const value = metrics[key];
    return total + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
}

function inferMentionCountFromSourceUrls(sourceUrls) {
  return Math.max(1, countDistinctSourceClusters(sourceUrls));
}

function inferMentionCount(sourceUrls, metadata) {
  const mergedSourceIds = uniqueStrings(
    [
      ...(Array.isArray(metadata?.mergedFrom) ? metadata.mergedFrom : []),
      ...(Array.isArray(metadata?.deduplicationClusterSourceIds)
        ? metadata.deduplicationClusterSourceIds
        : []),
    ]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim()),
  );

  if (mergedSourceIds.length > 0) {
    return mergedSourceIds.length;
  }

  return inferMentionCountFromSourceUrls(sourceUrls);
}

function normalizeSourceRecordRawMetadata(metadataRaw, sourceRecordRaw) {
  if (metadataRaw == null) {
    return sourceRecordRaw ?? {};
  }

  if (sourceRecordRaw == null) {
    return metadataRaw;
  }

  if (
    typeof metadataRaw === "object" &&
    metadataRaw !== null &&
    !Array.isArray(metadataRaw)
  ) {
    return {
      ...metadataRaw,
      sourceRecord: sourceRecordRaw,
    };
  }

  return {
    metadata: metadataRaw,
    sourceRecord: sourceRecordRaw,
  };
}

function normalizeItemMetadata(metadata, sourceSentiments) {
  if (metadata == null) {
    return sourceSentiments.length > 0 ? { sourceSentiments } : {};
  }

  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("metadata must be an object");
  }

  const normalizedMetadata = { ...metadata };
  delete normalizedMetadata.sourceSentiment;

  if (sourceSentiments.length > 0) {
    normalizedMetadata.sourceSentiments = sourceSentiments;
  } else {
    delete normalizedMetadata.sourceSentiments;
  }

  return normalizedMetadata;
}

function inferDisagreementDimensionFromItemContext(input) {
  const text = [
    input.name,
    input.summary,
    input.integrationHint,
    input.category,
    ...(Array.isArray(input.metadata?.tags) ? input.metadata.tags : []),
    ...(Array.isArray(input.metadata?.searchQueries) ? input.metadata.searchQueries : []),
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase())
    .join(" ");

  if (text.length === 0) {
    return null;
  }

  let bestDimension = DEFAULT_INFERRED_DISAGREEMENT_DIMENSION;
  let bestScore = 0;

  for (const dimension of DISAGREEMENT_DIMENSIONS) {
    const keywords = DISAGREEMENT_DIMENSION_KEYWORDS[dimension] ?? [];
    const score = keywords.reduce(
      (total, keyword) => total + (text.includes(keyword) ? 1 : 0),
      0,
    );

    if (score > bestScore) {
      bestDimension = dimension;
      bestScore = score;
    }
  }

  return bestDimension;
}

function normalizeRiskWarningDimension(input, fieldName = "riskWarning") {
  return {
    severity: assertOneOf(
      input?.severity ?? "unknown",
      RISK_SEVERITIES,
      `${fieldName}.severity`,
    ),
    description: assertNonEmptyString(
      input?.description ?? DEFAULT_RISK_WARNING_DESCRIPTION,
      `${fieldName}.description`,
    ),
  };
}

function hasTypedRiskWarningDimensions(input) {
  return RISK_WARNING_DIMENSIONS.some(
    (dimension) =>
      input?.[dimension] != null ||
      (dimension === "adoption_complexity" && input?.adoptionComplexity != null),
  );
}

function resolveRiskWarningDimensionInput(input, dimension) {
  return input?.[dimension] ??
    (dimension === "adoption_complexity" ? input?.adoptionComplexity : null) ??
    null;
}

function createTypedRiskWarning(dimensions) {
  const aggregate = RISK_WARNING_DIMENSIONS.map((dimension) => dimensions[dimension]).reduce(
    (currentHighest, candidate) =>
      pickHigherRiskWarningDimension(currentHighest, candidate),
    null,
  );

  return {
    ...aggregate,
    ...dimensions,
  };
}

function pickHigherRiskWarningDimension(left, right) {
  const normalizedLeft = normalizeRiskWarningDimension(left);
  const normalizedRight = normalizeRiskWarningDimension(right);
  const leftRank = RISK_SEVERITY_RANK[normalizedLeft.severity];
  const rightRank = RISK_SEVERITY_RANK[normalizedRight.severity];

  if (leftRank !== rightRank) {
    return leftRank >= rightRank ? normalizedLeft : normalizedRight;
  }

  if (normalizedLeft.description.length !== normalizedRight.description.length) {
    return normalizedLeft.description.length >= normalizedRight.description.length
      ? normalizedLeft
      : normalizedRight;
  }

  return normalizedLeft;
}

function backfillSourceSentimentDisagreementDimensions(sourceSentiments, disagreementDimension) {
  const normalizedDisagreementDimension = normalizeDisagreementDimension(
    disagreementDimension,
    "sentimentSpread.disagreementDimension",
  );

  return sourceSentiments.map((entry) =>
    entry.disagreementDimension
      ? entry
      : {
          ...entry,
          disagreementDimension: normalizedDisagreementDimension,
        },
  );
}

function withScoreProvenance(
  metadata,
  relevanceScore,
  scoreVersion,
  scoreInterpretation,
  divergenceFlag,
) {
  if (
    relevanceScore == null ||
    scoreVersion == null ||
    scoreInterpretation == null
  ) {
    return metadata;
  }

  return {
    ...metadata,
    scoring: {
      ...(metadata.scoring ?? {}),
      relevanceScore,
      scoreVersion,
      scoreInterpretation,
      divergenceFlag,
    },
  };
}

function createSentimentSpread(classification, disagreementDimension, fieldName = "sentimentSpread") {
  if (classification === "agree") {
    return { classification };
  }

  if (disagreementDimension == null) {
    throw new TypeError(`${fieldName}.disagreementDimension is required for contested sentiment`);
  }

  return {
    classification,
    disagreementDimension,
  };
}

function isContestedSentimentSpread(sentimentSpread) {
  return (
    sentimentSpread.classification === "disagree" ||
    sentimentSpread.classification === "mixed"
  );
}
