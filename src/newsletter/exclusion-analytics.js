import {
  CONTENT_CATEGORIES,
  SOURCE_KINDS,
  assertNonEmptyString,
  assertOneOf,
  canonicalizeUrl,
  clampScore,
  normalizeTimestamp,
  uniqueStrings,
} from "../core/contracts.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_RECURRING_EDITIONS = 2;

export const EXCLUSION_PHASES = Object.freeze(["scoring", "source", "scope"]);
export const EXCLUSION_REASONS = Object.freeze([
  "relevance_below_threshold",
  "out_of_scope",
  "source_authority_below_threshold",
  "source_not_approved",
  "source_retired",
]);

const EXCLUSION_REASON_ALIASES = new Map([
  ["relevance_below_threshold", "relevance_below_threshold"],
  ["relevance-below-threshold", "relevance_below_threshold"],
  ["below_threshold", "relevance_below_threshold"],
  ["below-threshold", "relevance_below_threshold"],
  ["out_of_scope", "out_of_scope"],
  ["out-of-scope", "out_of_scope"],
  ["source_authority_below_threshold", "source_authority_below_threshold"],
  ["source-authority-below-threshold", "source_authority_below_threshold"],
  ["source_not_approved", "source_not_approved"],
  ["source-not-approved", "source_not_approved"],
  ["source_retired", "source_retired"],
  ["source-retired", "source_retired"],
]);

export function createEditionExclusion(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("exclusion must be an object");
  }

  const normalizedReasonCode = normalizeExclusionReasonCode(
    input.exclusionReasonCode ??
      input.exclusion_reason_code ??
      input.reasonCode ??
      input.reason_code ??
      input.reason ??
      input.exclusionReason,
    "exclusion.exclusionReasonCode",
  );
  const normalizedPhase = normalizeExclusionPhase(
    input.phase ?? input.exclusionPhase ?? null,
    normalizedReasonCode,
  );

  const sourceKinds = normalizeSourceKinds(input.sourceKinds ?? input.source_kinds ?? []);
  const adapterIds = normalizeStringArray(input.adapterIds ?? input.adapter_ids ?? [], "adapterIds");

  if (sourceKinds.length === 0) {
    throw new TypeError("exclusion.sourceKinds must contain at least one source kind");
  }

  if (adapterIds.length === 0) {
    throw new TypeError("exclusion.adapterIds must contain at least one adapter id");
  }

  const exclusion = {
    itemIdentity: normalizeExclusionItemIdentity(input),
    itemId: assertNonEmptyString(input.itemId ?? input.item_id, "exclusion.itemId"),
    name: assertNonEmptyString(input.name, "exclusion.name"),
    sourceUrl: canonicalizeUrl(input.sourceUrl ?? input.source_url, "exclusion.sourceUrl"),
    category: assertOneOf(input.category, CONTENT_CATEGORIES, "exclusion.category"),
    exclusionReasonCode: normalizedReasonCode,
    reasonCode: normalizeExclusionReasonCode(
      input.reasonCode ??
        input.reason_code ??
        input.exclusionReasonCode ??
        input.exclusion_reason_code ??
        input.reason ??
        input.exclusionReason,
      "exclusion.reasonCode",
    ),
    timestamp: normalizeTimestamp(
      input.timestamp ?? input.evaluatedAt ?? input.evaluated_at,
      "exclusion.timestamp",
    ),
    evaluationContext: normalizeEvaluationContext(
      input.evaluationContext ??
        input.evaluation_context ??
        buildLegacyEvaluationContext({
          ...input,
          phase: normalizedPhase,
          reasonCode: normalizedReasonCode,
        }),
    ),
    sourceKinds,
    adapterIds,
    reason: normalizeExclusionReasonCode(
      input.reason ??
        input.exclusionReason ??
        input.reasonCode ??
        input.reason_code ??
        input.exclusionReasonCode ??
        input.exclusion_reason_code,
      "exclusion.reason",
    ),
    phase: normalizedPhase,
    relevanceScore: normalizeNullableScore(
      input.relevanceScore ?? input.relevance_score ?? null,
      "exclusion.relevanceScore",
    ),
    minRelevanceScore: normalizeNullableScore(
      input.minRelevanceScore ?? input.min_relevance_score ?? null,
      "exclusion.minRelevanceScore",
    ),
    scoreVersion: normalizeNullableString(
      input.scoreVersion ?? input.score_version ?? null,
      "exclusion.scoreVersion",
    ),
    sourceAuthorityScore: normalizeNullableScore(
      input.sourceAuthorityScore ?? input.source_authority_score ?? null,
      "exclusion.sourceAuthorityScore",
    ),
    minSourceAuthorityScore: normalizeNullableScore(
      input.minSourceAuthorityScore ?? input.min_source_authority_score ?? null,
      "exclusion.minSourceAuthorityScore",
    ),
    sourceStatus: normalizeNullableString(
      input.sourceStatus ?? input.source_status ?? null,
      "exclusion.sourceStatus",
    ),
    sourceLifecycleState: normalizeNullableString(
      input.sourceLifecycleState ?? input.source_lifecycle_state ?? null,
      "exclusion.sourceLifecycleState",
    ),
  };

  const editionContext = normalizeEditionContext(
    input.editionContext ?? input.edition_context ?? null,
  );

  if (editionContext) {
    exclusion.editionContext = editionContext;
  }

  return exclusion;
}

export function createRelevanceExclusion(item, decision) {
  return createEditionExclusion({
    itemIdentity: {
      id: item.id,
      itemId: item.itemId,
      name: item.name,
      sourceUrl: item.sourceUrl,
      sourceUrls: item.sourceUrls,
      canonicalIdentifiers: item.canonicalIdentifiers,
    },
    itemId: item.itemId,
    name: item.name,
    sourceUrl: item.sourceUrl,
    category: item.category,
    exclusionReasonCode: "relevance_below_threshold",
    reasonCode: "relevance_below_threshold",
    timestamp: decision.timestamp ?? decision.evaluatedAt ?? new Date().toISOString(),
    evaluationContext:
      decision.evaluationContext ??
      decision.evaluation_context ??
      {
        stage: "relevance_gate",
        relevance: {
          minRelevanceScore: decision.minRelevanceScore ?? null,
          relevanceScore: decision.relevanceScore ?? null,
          scoreVersion: decision.scoreVersion ?? null,
          scoreInterpretation: decision.scoreInterpretation ?? null,
          scoreBreakdown: decision.scoreBreakdown ?? null,
        },
      },
    editionContext:
      decision.editionContext ??
      decision.edition_context ??
      null,
    sourceKinds: item.sourceKinds,
    adapterIds: item.adapterIds,
    reason: "relevance_below_threshold",
    phase: "scoring",
    relevanceScore: decision.relevanceScore ?? null,
    minRelevanceScore: decision.minRelevanceScore ?? null,
    scoreVersion: decision.scoreVersion ?? null,
    sourceAuthorityScore: item.sourceAuthorityScore ?? null,
  });
}

export function createSourceExclusion(item, context = {}) {
  const reason = resolveSourceExclusionReason(context);

  if (!reason) {
    return null;
  }

  return createEditionExclusion({
    itemIdentity: {
      id: item.id,
      itemId: item.itemId,
      name: item.name,
      sourceUrl: item.sourceUrl,
      sourceUrls: item.sourceUrls,
      canonicalIdentifiers: item.canonicalIdentifiers,
    },
    itemId: item.itemId,
    name: item.name,
    sourceUrl: item.sourceUrl,
    category: item.category,
    exclusionReasonCode: reason,
    reasonCode: reason,
    timestamp: context.timestamp ?? context.evaluatedAt ?? new Date().toISOString(),
    evaluationContext:
      context.evaluationContext ??
      context.evaluation_context ??
      {
        stage: "source_gate",
        source: {
          sourceId: context.sourceId ?? null,
          sourceStatus: context.sourceStatus ?? null,
          sourceLifecycleState: context.sourceLifecycleState ?? null,
          requiresSourceApproval: Boolean(context.requiresSourceApproval),
          minimumItemAuthorityScore: context.minimumItemAuthorityScore ?? null,
          sourceAuthorityScore:
            context.effectiveSourceAuthorityScore ?? item.sourceAuthorityScore ?? null,
          weightedSourceAuthorityScore: context.weightedSourceAuthorityScore ?? null,
        },
      },
    editionContext:
      context.editionContext ??
      context.edition_context ??
      null,
    sourceKinds: item.sourceKinds,
    adapterIds: item.adapterIds,
    reason,
    phase: "source",
    sourceAuthorityScore:
      context.effectiveSourceAuthorityScore ?? item.sourceAuthorityScore ?? null,
    minSourceAuthorityScore: context.minimumItemAuthorityScore ?? null,
    sourceStatus: context.sourceStatus ?? null,
    sourceLifecycleState: context.sourceLifecycleState ?? null,
  });
}

export function normalizeExclusionReasonCode(
  value,
  fieldName = "exclusion.reasonCode",
) {
  const rawValue = assertNonEmptyString(value, fieldName);
  const normalizedLookupKey = rawValue.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const normalizedValue =
    EXCLUSION_REASON_ALIASES.get(rawValue.trim().toLowerCase()) ??
    EXCLUSION_REASON_ALIASES.get(normalizedLookupKey) ??
    rawValue;

  return assertOneOf(normalizedValue, EXCLUSION_REASONS, fieldName);
}

function normalizeExclusionItemIdentity(input) {
  const sourceUrl = canonicalizeUrl(
    input.itemIdentity?.sourceUrl ?? input.sourceUrl ?? input.source_url,
    "exclusion.itemIdentity.sourceUrl",
  );

  return {
    itemId: assertNonEmptyString(
      input.itemIdentity?.itemId ?? input.itemId ?? input.item_id,
      "exclusion.itemIdentity.itemId",
    ),
    id: normalizeNullableString(
      input.itemIdentity?.id ?? input.id ?? null,
      "exclusion.itemIdentity.id",
    ),
    name: assertNonEmptyString(
      input.itemIdentity?.name ?? input.name,
      "exclusion.itemIdentity.name",
    ),
    sourceUrl,
    sourceUrls: uniqueStrings(
      (input.itemIdentity?.sourceUrls ?? input.sourceUrls ?? input.source_urls ?? [sourceUrl]).map(
        (value) => canonicalizeUrl(value, "exclusion.itemIdentity.sourceUrls[]"),
      ),
    ),
    canonicalIdentifiers:
      input.itemIdentity?.canonicalIdentifiers ??
      input.itemIdentity?.canonical_identifiers ??
      null,
  };
}

function normalizeEvaluationContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("exclusion.evaluationContext must be an object");
  }

  return {
    ...value,
  };
}

function buildLegacyEvaluationContext(input) {
  const phase = input.phase ?? input.exclusionPhase ?? "scoring";

  if (phase === "scope") {
    return {
      stage: "scope_gate",
      scope: {
        scopeVersion: input.scopeVersion ?? input.scope_version ?? null,
        reasonCode: normalizeExclusionReasonCode(
          input.reasonCode ??
            input.reason_code ??
            input.exclusionReasonCode ??
            input.exclusion_reason_code ??
            input.reason ??
            input.exclusionReason ??
            "out_of_scope",
          "exclusion.reasonCode",
        ),
      },
    };
  }

  if (phase === "source") {
    return {
      stage: "source_gate",
      source: {
        sourceStatus: input.sourceStatus ?? input.source_status ?? null,
        sourceLifecycleState:
          input.sourceLifecycleState ?? input.source_lifecycle_state ?? null,
        minimumItemAuthorityScore:
          input.minSourceAuthorityScore ?? input.min_source_authority_score ?? null,
        sourceAuthorityScore:
          input.sourceAuthorityScore ?? input.source_authority_score ?? null,
      },
    };
  }

  return {
    stage: "relevance_gate",
    relevance: {
      minRelevanceScore:
        input.minRelevanceScore ?? input.min_relevance_score ?? null,
      relevanceScore: input.relevanceScore ?? input.relevance_score ?? null,
      scoreVersion: input.scoreVersion ?? input.score_version ?? null,
    },
  };
}

function normalizeExclusionPhase(
  value,
  reasonCode,
  fieldName = "exclusion.phase",
) {
  if (value == null) {
    return inferExclusionPhase(reasonCode);
  }

  return assertOneOf(value, EXCLUSION_PHASES, fieldName);
}

function inferExclusionPhase(reasonCode) {
  if (reasonCode === "out_of_scope") {
    return "scope";
  }

  if (reasonCode === "relevance_below_threshold") {
    return "scoring";
  }

  return "source";
}

function normalizeEditionContext(value) {
  if (value == null) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("exclusion.editionContext must be an object when provided");
  }

  const startsAt = normalizeTimestamp(
    value.window?.startsAt ?? value.window?.starts_at,
    "exclusion.editionContext.window.startsAt",
  );
  const endsAt = normalizeTimestamp(
    value.window?.endsAt ?? value.window?.ends_at,
    "exclusion.editionContext.window.endsAt",
  );

  if (new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
    throw new RangeError("exclusion.editionContext.window.startsAt must be earlier than endsAt");
  }

  return {
    editionId: assertNonEmptyString(
      value.editionId ?? value.edition_id,
      "exclusion.editionContext.editionId",
    ),
    publishedAt: normalizeTimestamp(
      value.publishedAt ?? value.published_at,
      "exclusion.editionContext.publishedAt",
    ),
    window: {
      startsAt,
      endsAt,
      timezone: assertNonEmptyString(
        value.window?.timezone ?? "UTC",
        "exclusion.editionContext.window.timezone",
      ),
    },
  };
}

export function buildNewsletterExclusionAnalytics(
  editions,
  {
    now = new Date().toISOString(),
    days = 7,
    from = null,
    to = null,
    reason = null,
    category = null,
    sourceKind = null,
    adapterId = null,
    itemId = null,
    phase = null,
    minRecurringEditions = DEFAULT_MIN_RECURRING_EDITIONS,
  } = {},
) {
  const normalizedNow = normalizeTimestamp(now, "now");
  const normalizedFilters = normalizeAnalyticsFilters({
    now: normalizedNow,
    days,
    from,
    to,
    reason,
    category,
    sourceKind,
    adapterId,
    itemId,
    phase,
    minRecurringEditions,
  });
  const filteredEditions = filterEditionsByWindow(
    Array.isArray(editions) ? editions : [],
    normalizedNow,
    normalizedFilters,
  );
  const exclusions = filteredEditions.flatMap((edition) =>
    normalizeEditionExclusions(edition?.exclusions).flatMap((exclusion) =>
      matchesExclusionFilters(exclusion, normalizedFilters)
        ? [
            {
              editionId: assertNonEmptyString(edition.id, "edition.id"),
              publishedAt: normalizeTimestamp(edition.publishedAt, "edition.publishedAt"),
              ...exclusion,
            },
          ]
        : [],
    ),
  );
  const recurringItems = buildRecurringItems(exclusions, normalizedFilters.minRecurringEditions);
  const blindSpots = buildBlindSpots(exclusions, normalizedFilters.minRecurringEditions);

  return {
    archiveWindowDays: normalizedFilters.days,
    generatedAt: normalizedNow,
    filters: {
      publishedFrom: normalizedFilters.from,
      publishedTo: normalizedFilters.to,
      reason: normalizedFilters.reason,
      category: normalizedFilters.category,
      sourceKind: normalizedFilters.sourceKind,
      adapterId: normalizedFilters.adapterId,
      itemId: normalizedFilters.itemId,
      phase: normalizedFilters.phase,
      minRecurringEditions: normalizedFilters.minRecurringEditions,
    },
    totals: {
      scannedEditionCount: filteredEditions.length,
      matchedEditionCount: countDistinct(exclusions, (entry) => entry.editionId),
      exclusionCount: exclusions.length,
      distinctItemCount: countDistinct(exclusions, (entry) => entry.itemId),
      recurringItemCount: recurringItems.length,
      blindSpotCount: blindSpots.length,
    },
    exclusions,
    aggregations: {
      reasons: aggregateSingleValue(exclusions, "reason"),
      categories: aggregateSingleValue(exclusions, "category"),
      phases: aggregateSingleValue(exclusions, "phase"),
      sourceKinds: aggregateMultiValue(exclusions, "sourceKinds", "source_kind"),
      adapterIds: aggregateMultiValue(exclusions, "adapterIds", "adapter_id"),
      categoryReasonCodes: aggregateByCategoryAndReason(exclusions),
      editions: aggregateByEdition(exclusions),
    },
    recurringItems,
    blindSpots,
  };
}

export function formatNewsletterExclusionAnalyticsResponse(analytics) {
  return {
    archive_window_days: normalizePositiveInteger(
      analytics?.archiveWindowDays,
      "analytics.archiveWindowDays",
    ),
    generated_at: normalizeTimestamp(analytics?.generatedAt, "analytics.generatedAt"),
    filters: {
      published_from:
        analytics?.filters?.publishedFrom == null
          ? null
          : normalizeTimestamp(analytics.filters.publishedFrom, "analytics.filters.publishedFrom"),
      published_to:
        analytics?.filters?.publishedTo == null
          ? null
          : normalizeTimestamp(analytics.filters.publishedTo, "analytics.filters.publishedTo"),
      reason_code: analytics?.filters?.reason ?? null,
      category: analytics?.filters?.category ?? null,
      source_kind: analytics?.filters?.sourceKind ?? null,
      adapter_id: analytics?.filters?.adapterId ?? null,
      item_id: analytics?.filters?.itemId ?? null,
      phase: analytics?.filters?.phase ?? null,
      min_recurring_editions: normalizePositiveInteger(
        analytics?.filters?.minRecurringEditions,
        "analytics.filters.minRecurringEditions",
      ),
    },
    totals: {
      scanned_edition_count: normalizeNonNegativeInteger(
        analytics?.totals?.scannedEditionCount,
        "analytics.totals.scannedEditionCount",
      ),
      matched_edition_count: normalizeNonNegativeInteger(
        analytics?.totals?.matchedEditionCount,
        "analytics.totals.matchedEditionCount",
      ),
      exclusion_count: normalizeNonNegativeInteger(
        analytics?.totals?.exclusionCount,
        "analytics.totals.exclusionCount",
      ),
      distinct_item_count: normalizeNonNegativeInteger(
        analytics?.totals?.distinctItemCount,
        "analytics.totals.distinctItemCount",
      ),
      recurring_item_count: normalizeNonNegativeInteger(
        analytics?.totals?.recurringItemCount,
        "analytics.totals.recurringItemCount",
      ),
      blind_spot_count: normalizeNonNegativeInteger(
        analytics?.totals?.blindSpotCount,
        "analytics.totals.blindSpotCount",
      ),
    },
    exclusions: normalizeAnalyticsExclusions(analytics?.exclusions),
    aggregations: {
      reason_codes: normalizeAggregationEntries(
        analytics?.aggregations?.reasons,
        "reason",
        "reason_code",
      ),
      categories: normalizeAggregationEntries(analytics?.aggregations?.categories, "category"),
      phases: normalizeAggregationEntries(analytics?.aggregations?.phases, "phase"),
      source_kinds: normalizeAggregationEntries(
        analytics?.aggregations?.sourceKinds,
        "source_kind",
      ),
      adapter_ids: normalizeAggregationEntries(
        analytics?.aggregations?.adapterIds,
        "adapter_id",
      ),
      category_reason_codes: normalizeCategoryReasonAggregationEntries(
        analytics?.aggregations?.categoryReasonCodes,
      ),
      editions: normalizeEditionAggregationEntries(analytics?.aggregations?.editions),
    },
    recurring_items: normalizeRecurringItems(analytics?.recurringItems),
    blind_spots: normalizeBlindSpots(analytics?.blindSpots),
  };
}

export function normalizeEditionExclusions(exclusions) {
  if (exclusions == null) {
    return [];
  }

  if (!Array.isArray(exclusions)) {
    throw new TypeError("edition.exclusions must be an array when provided");
  }

  return exclusions.map((exclusion) => createEditionExclusion(exclusion));
}

function normalizeAnalyticsFilters({
  now,
  days,
  from,
  to,
  reason,
  category,
  sourceKind,
  adapterId,
  itemId,
  phase,
  minRecurringEditions,
}) {
  const normalizedDays = normalizePositiveInteger(days, "days");
  const defaultFrom = new Date(new Date(now).getTime() - normalizedDays * DAY_IN_MS).toISOString();
  const normalizedFrom =
    from == null ? defaultFrom : normalizeTimestamp(from, "from");
  const normalizedTo = to == null ? now : normalizeTimestamp(to, "to");

  if (new Date(normalizedFrom).getTime() > new Date(normalizedTo).getTime()) {
    throw new RangeError("from must be earlier than or equal to to");
  }

  return {
    days: normalizedDays,
    from: normalizedFrom,
    to: normalizedTo,
    reason:
      reason == null ? null : assertOneOf(reason, EXCLUSION_REASONS, "reason"),
    category:
      category == null ? null : assertOneOf(category, CONTENT_CATEGORIES, "category"),
    sourceKind:
      sourceKind == null ? null : assertOneOf(sourceKind, SOURCE_KINDS, "sourceKind"),
    adapterId:
      adapterId == null ? null : assertNonEmptyString(adapterId, "adapterId"),
    itemId: itemId == null ? null : assertNonEmptyString(itemId, "itemId"),
    phase: phase == null ? null : assertOneOf(phase, EXCLUSION_PHASES, "phase"),
    minRecurringEditions: normalizePositiveInteger(
      minRecurringEditions,
      "minRecurringEditions",
    ),
  };
}

function filterEditionsByWindow(editions, now, filters) {
  const nowMs = new Date(now).getTime();
  const fromMs = new Date(filters.from).getTime();
  const toMs = new Date(filters.to).getTime();

  return editions.filter((edition) => {
    const publishedAt = normalizeTimestamp(edition?.publishedAt, "edition.publishedAt");
    const publishedAtMs = new Date(publishedAt).getTime();

    return publishedAtMs <= nowMs && publishedAtMs >= fromMs && publishedAtMs <= toMs;
  });
}

function matchesExclusionFilters(exclusion, filters) {
  if (filters.reason && exclusion.reason !== filters.reason) {
    return false;
  }

  if (filters.category && exclusion.category !== filters.category) {
    return false;
  }

  if (filters.sourceKind && !exclusion.sourceKinds.includes(filters.sourceKind)) {
    return false;
  }

  if (filters.adapterId && !exclusion.adapterIds.includes(filters.adapterId)) {
    return false;
  }

  if (filters.itemId && exclusion.itemId !== filters.itemId) {
    return false;
  }

  if (filters.phase && exclusion.phase !== filters.phase) {
    return false;
  }

  return true;
}

function buildRecurringItems(exclusions, minRecurringEditions) {
  const grouped = groupBy(exclusions, (entry) => entry.itemId);

  return [...grouped.values()]
    .map((entries) => ({
      itemId: entries[0].itemId,
      name: entries[0].name,
      category: entries[0].category,
      exclusionCount: entries.length,
      editionCount: countDistinct(entries, (entry) => entry.editionId),
      reasons: uniqueStrings(entries.map((entry) => entry.reason)),
      firstExcludedAt: earliestTimestamp(entries.map((entry) => entry.publishedAt)),
      lastExcludedAt: latestTimestamp(entries.map((entry) => entry.publishedAt)),
    }))
    .filter((entry) => entry.editionCount >= minRecurringEditions)
    .sort((left, right) =>
      compareNumbersDesc(left.editionCount, right.editionCount) ||
      compareNumbersDesc(left.exclusionCount, right.exclusionCount) ||
      compareText(left.name, right.name),
    );
}

function buildBlindSpots(exclusions, minRecurringEditions) {
  const grouped = groupBy(exclusions, (entry) => `${entry.category}::${entry.reason}`);

  return [...grouped.values()]
    .map((entries) => ({
      blindSpotKey: `category:${entries[0].category}|reason:${entries[0].reason}`,
      category: entries[0].category,
      reason: entries[0].reason,
      exclusionCount: entries.length,
      distinctItemCount: countDistinct(entries, (entry) => entry.itemId),
      editionCount: countDistinct(entries, (entry) => entry.editionId),
      firstExcludedAt: earliestTimestamp(entries.map((entry) => entry.publishedAt)),
      lastExcludedAt: latestTimestamp(entries.map((entry) => entry.publishedAt)),
    }))
    .filter((entry) => entry.editionCount >= minRecurringEditions)
    .sort((left, right) =>
      compareNumbersDesc(left.editionCount, right.editionCount) ||
      compareNumbersDesc(left.exclusionCount, right.exclusionCount) ||
      compareText(left.blindSpotKey, right.blindSpotKey),
    );
}

function aggregateByCategoryAndReason(exclusions) {
  const grouped = groupBy(exclusions, (entry) => `${entry.category}::${entry.reason}`);

  return [...grouped.values()]
    .map((entries) => ({
      category: entries[0].category,
      reasonCode: entries[0].reason,
      exclusionCount: entries.length,
      distinctItemCount: countDistinct(entries, (entry) => entry.itemId),
      editionCount: countDistinct(entries, (entry) => entry.editionId),
      firstExcludedAt: earliestTimestamp(entries.map((entry) => entry.publishedAt)),
      lastExcludedAt: latestTimestamp(entries.map((entry) => entry.publishedAt)),
    }))
    .sort((left, right) =>
      compareNumbersDesc(left.editionCount, right.editionCount) ||
      compareNumbersDesc(left.exclusionCount, right.exclusionCount) ||
      compareText(left.category, right.category) ||
      compareText(left.reasonCode, right.reasonCode),
    );
}

function aggregateSingleValue(exclusions, fieldName) {
  const grouped = groupBy(exclusions, (entry) => entry[fieldName]);

  return sortAggregationEntries(
    [...grouped.entries()].map(([value, entries]) => ({
      [fieldName]: value,
      exclusionCount: entries.length,
      distinctItemCount: countDistinct(entries, (entry) => entry.itemId),
      editionCount: countDistinct(entries, (entry) => entry.editionId),
    })),
    fieldName,
  );
}

function aggregateMultiValue(exclusions, fieldName, outputField) {
  const grouped = new Map();

  for (const exclusion of exclusions) {
    for (const value of exclusion[fieldName]) {
      const entries = grouped.get(value) ?? [];
      entries.push(exclusion);
      grouped.set(value, entries);
    }
  }

  return sortAggregationEntries(
    [...grouped.entries()].map(([value, entries]) => ({
      [outputField]: value,
      exclusionCount: entries.length,
      distinctItemCount: countDistinct(entries, (entry) => entry.itemId),
      editionCount: countDistinct(entries, (entry) => entry.editionId),
    })),
    outputField,
  );
}

function aggregateByEdition(exclusions) {
  const grouped = groupBy(exclusions, (entry) => entry.editionId);

  return [...grouped.entries()]
    .map(([editionId, entries]) => ({
      editionId,
      publishedAt: entries[0].publishedAt,
      exclusionCount: entries.length,
      distinctItemCount: countDistinct(entries, (entry) => entry.itemId),
    }))
    .sort((left, right) =>
      compareTimestampsDesc(left.publishedAt, right.publishedAt) ||
      compareText(left.editionId, right.editionId),
    );
}

function normalizeAnalyticsExclusions(exclusions) {
  if (!Array.isArray(exclusions)) {
    throw new TypeError("analytics.exclusions must be an array");
  }

  return exclusions.map((exclusion) => ({
    edition_id: assertNonEmptyString(exclusion.editionId, "analytics.exclusions[].editionId"),
    published_at: normalizeTimestamp(
      exclusion.publishedAt,
      "analytics.exclusions[].publishedAt",
    ),
    item_id: assertNonEmptyString(exclusion.itemId, "analytics.exclusions[].itemId"),
    name: assertNonEmptyString(exclusion.name, "analytics.exclusions[].name"),
    source_url: canonicalizeUrl(
      exclusion.sourceUrl,
      "analytics.exclusions[].sourceUrl",
    ),
    category: assertOneOf(
      exclusion.category,
      CONTENT_CATEGORIES,
      "analytics.exclusions[].category",
    ),
    source_kinds: normalizeSourceKinds(exclusion.sourceKinds),
    adapter_ids: normalizeStringArray(
      exclusion.adapterIds,
      "analytics.exclusions[].adapterIds",
    ),
    reason_code: assertOneOf(
      exclusion.reason,
      EXCLUSION_REASONS,
      "analytics.exclusions[].reason",
    ),
    phase: assertOneOf(exclusion.phase, EXCLUSION_PHASES, "analytics.exclusions[].phase"),
    relevance_score:
      exclusion.relevanceScore == null
        ? null
        : normalizeNullableScore(
            exclusion.relevanceScore,
            "analytics.exclusions[].relevanceScore",
          ),
    min_relevance_score:
      exclusion.minRelevanceScore == null
        ? null
        : normalizeNullableScore(
            exclusion.minRelevanceScore,
            "analytics.exclusions[].minRelevanceScore",
          ),
    score_version:
      exclusion.scoreVersion == null
        ? null
        : assertNonEmptyString(
            exclusion.scoreVersion,
            "analytics.exclusions[].scoreVersion",
          ),
    source_authority_score:
      exclusion.sourceAuthorityScore == null
        ? null
        : normalizeNullableScore(
            exclusion.sourceAuthorityScore,
            "analytics.exclusions[].sourceAuthorityScore",
          ),
    min_source_authority_score:
      exclusion.minSourceAuthorityScore == null
        ? null
        : normalizeNullableScore(
            exclusion.minSourceAuthorityScore,
            "analytics.exclusions[].minSourceAuthorityScore",
          ),
    source_status: exclusion.sourceStatus ?? null,
    source_lifecycle_state: exclusion.sourceLifecycleState ?? null,
  }));
}

function normalizeAggregationEntries(entries, inputField, outputField = inputField) {
  if (!Array.isArray(entries)) {
    throw new TypeError("aggregation entries must be an array");
  }

  return entries.map((entry) => ({
    [outputField]: assertNonEmptyString(entry[inputField], `aggregation.${inputField}`),
    exclusion_count: normalizeNonNegativeInteger(
      entry.exclusionCount,
      "aggregation.exclusionCount",
    ),
    distinct_item_count: normalizeNonNegativeInteger(
      entry.distinctItemCount,
      "aggregation.distinctItemCount",
    ),
    edition_count: normalizeNonNegativeInteger(entry.editionCount, "aggregation.editionCount"),
  }));
}

function normalizeCategoryReasonAggregationEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("category reason aggregation entries must be an array");
  }

  return entries.map((entry) => ({
    category: assertOneOf(
      entry.category,
      CONTENT_CATEGORIES,
      "aggregation.categoryReasonCodes[].category",
    ),
    reason_code: assertOneOf(
      entry.reasonCode,
      EXCLUSION_REASONS,
      "aggregation.categoryReasonCodes[].reasonCode",
    ),
    exclusion_count: normalizeNonNegativeInteger(
      entry.exclusionCount,
      "aggregation.categoryReasonCodes[].exclusionCount",
    ),
    distinct_item_count: normalizeNonNegativeInteger(
      entry.distinctItemCount,
      "aggregation.categoryReasonCodes[].distinctItemCount",
    ),
    edition_count: normalizeNonNegativeInteger(
      entry.editionCount,
      "aggregation.categoryReasonCodes[].editionCount",
    ),
    first_excluded_at: normalizeTimestamp(
      entry.firstExcludedAt,
      "aggregation.categoryReasonCodes[].firstExcludedAt",
    ),
    last_excluded_at: normalizeTimestamp(
      entry.lastExcludedAt,
      "aggregation.categoryReasonCodes[].lastExcludedAt",
    ),
  }));
}

function normalizeEditionAggregationEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("edition aggregation entries must be an array");
  }

  return entries.map((entry) => ({
    edition_id: assertNonEmptyString(entry.editionId, "aggregation.editionId"),
    published_at: normalizeTimestamp(entry.publishedAt, "aggregation.publishedAt"),
    exclusion_count: normalizeNonNegativeInteger(
      entry.exclusionCount,
      "aggregation.exclusionCount",
    ),
    distinct_item_count: normalizeNonNegativeInteger(
      entry.distinctItemCount,
      "aggregation.distinctItemCount",
    ),
  }));
}

function normalizeRecurringItems(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("analytics.recurringItems must be an array");
  }

  return entries.map((entry) => ({
    item_id: assertNonEmptyString(entry.itemId, "analytics.recurringItems[].itemId"),
    name: assertNonEmptyString(entry.name, "analytics.recurringItems[].name"),
    category: assertOneOf(
      entry.category,
      CONTENT_CATEGORIES,
      "analytics.recurringItems[].category",
    ),
    exclusion_count: normalizeNonNegativeInteger(
      entry.exclusionCount,
      "analytics.recurringItems[].exclusionCount",
    ),
    edition_count: normalizeNonNegativeInteger(
      entry.editionCount,
      "analytics.recurringItems[].editionCount",
    ),
    reason_codes: normalizeStringArray(
      entry.reasons,
      "analytics.recurringItems[].reasons",
    ),
    first_excluded_at: normalizeTimestamp(
      entry.firstExcludedAt,
      "analytics.recurringItems[].firstExcludedAt",
    ),
    last_excluded_at: normalizeTimestamp(
      entry.lastExcludedAt,
      "analytics.recurringItems[].lastExcludedAt",
    ),
  }));
}

function normalizeBlindSpots(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("analytics.blindSpots must be an array");
  }

  return entries.map((entry) => ({
    blind_spot_key: assertNonEmptyString(
      entry.blindSpotKey,
      "analytics.blindSpots[].blindSpotKey",
    ),
    category: assertOneOf(
      entry.category,
      CONTENT_CATEGORIES,
      "analytics.blindSpots[].category",
    ),
    reason_code: assertOneOf(
      entry.reason,
      EXCLUSION_REASONS,
      "analytics.blindSpots[].reason",
    ),
    exclusion_count: normalizeNonNegativeInteger(
      entry.exclusionCount,
      "analytics.blindSpots[].exclusionCount",
    ),
    distinct_item_count: normalizeNonNegativeInteger(
      entry.distinctItemCount,
      "analytics.blindSpots[].distinctItemCount",
    ),
    edition_count: normalizeNonNegativeInteger(
      entry.editionCount,
      "analytics.blindSpots[].editionCount",
    ),
    first_excluded_at: normalizeTimestamp(
      entry.firstExcludedAt,
      "analytics.blindSpots[].firstExcludedAt",
    ),
    last_excluded_at: normalizeTimestamp(
      entry.lastExcludedAt,
      "analytics.blindSpots[].lastExcludedAt",
    ),
  }));
}

function normalizeNullableScore(value, fieldName) {
  if (value == null) {
    return null;
  }

  return clampScore(value, fieldName);
}

function normalizeNullableString(value, fieldName) {
  if (value == null) {
    return null;
  }

  return assertNonEmptyString(value, fieldName);
}

function normalizeSourceKinds(values) {
  return uniqueStrings(
    values.map((value) => assertOneOf(value, SOURCE_KINDS, "sourceKinds[]")),
  );
}

function normalizeStringArray(values, fieldName) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${fieldName} must be an array`);
  }

  return uniqueStrings(values.map((value) => assertNonEmptyString(value, `${fieldName}[]`)));
}

function normalizePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }

  return value;
}

function normalizeNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }

  return value;
}

function resolveSourceExclusionReason(context = {}) {
  if (
    context.effectiveSourceAuthorityScore != null &&
    context.minimumItemAuthorityScore != null &&
    context.effectiveSourceAuthorityScore < context.minimumItemAuthorityScore
  ) {
    return "source_authority_below_threshold";
  }

  if (context.requiresSourceApproval && context.sourceStatus !== "approved") {
    return "source_not_approved";
  }

  if (context.sourceLifecycleState === "retired") {
    return "source_retired";
  }

  return null;
}

function groupBy(entries, keyFn) {
  const grouped = new Map();

  for (const entry of entries) {
    const key = keyFn(entry);
    const bucket = grouped.get(key) ?? [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }

  return grouped;
}

function countDistinct(entries, keyFn) {
  return new Set(entries.map((entry) => keyFn(entry))).size;
}

function earliestTimestamp(values) {
  return [...values].sort(compareTimestampsAsc)[0];
}

function latestTimestamp(values) {
  return [...values].sort(compareTimestampsDesc)[0];
}

function sortAggregationEntries(entries, valueField) {
  return entries.sort(
    (left, right) =>
      compareNumbersDesc(left.exclusionCount, right.exclusionCount) ||
      compareNumbersDesc(left.editionCount, right.editionCount) ||
      compareText(left[valueField], right[valueField]),
  );
}

function compareNumbersDesc(left, right) {
  return right - left;
}

function compareTimestampsAsc(left, right) {
  return new Date(left).getTime() - new Date(right).getTime();
}

function compareTimestampsDesc(left, right) {
  return new Date(right).getTime() - new Date(left).getTime();
}

function compareText(left, right) {
  return String(left).localeCompare(String(right));
}
