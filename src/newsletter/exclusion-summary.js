import {
  CONTENT_CATEGORIES,
  assertNonEmptyString,
  assertOneOf,
  normalizeTimestamp,
} from "../core/contracts.js";
import { normalizeExclusionReasonCode as normalizeStoredExclusionReasonCode } from "./exclusion-analytics.js";

export const EDITION_EXCLUSION_REASON_CODES = Object.freeze([
  "filtered_by_curation_rule",
  "relevance_below_threshold",
  "out_of_scope",
  "source_authority_below_threshold",
  "source_not_approved",
  "source_retired",
]);

const CATEGORY_ORDER = new Map(
  CONTENT_CATEGORIES.map((category, index) => [category, index]),
);

export function buildEditionExclusionSummary(exclusionDecisions = []) {
  if (!Array.isArray(exclusionDecisions)) {
    throw new TypeError("exclusionDecisions must be an array");
  }

  const groupedCounts = new Map();
  const categoryCounts = new Map();
  const reasonCodeCounts = new Map();

  for (const exclusionDecision of exclusionDecisions) {
    const category = normalizeExclusionCategory(exclusionDecision?.category);
    const reasonCode = normalizeExclusionReasonCode(
      exclusionDecision?.reasonCode ??
        exclusionDecision?.reason ??
        exclusionDecision?.exclusionReasonCode,
    );
    const count = normalizePositiveInteger(
      exclusionDecision?.count ?? 1,
      "exclusionDecision.count",
    );
    incrementAggregateCount(categoryCounts, category, count);
    incrementAggregateCount(reasonCodeCounts, reasonCode, count);
    const groupKey = `${category}:${reasonCode}`;
    const existingGroup = groupedCounts.get(groupKey);

    if (existingGroup) {
      existingGroup.count += count;
      continue;
    }

    groupedCounts.set(groupKey, {
      category,
      reasonCode,
      count,
    });
  }

  const countsByCategoryAndReason = [...groupedCounts.values()];

  return createEditionExclusionSummary({
    totalExcludedItems: sumCountValues(countsByCategoryAndReason),
    countsByCategory: [...categoryCounts.entries()].map(([category, count]) => ({
      category,
      count,
    })),
    countsByReasonCode: [...reasonCodeCounts.entries()].map(([reasonCode, count]) => ({
      reasonCode,
      count,
    })),
    countsByCategoryAndReason,
  });
}

export function createEditionExclusionSummary(input = null) {
  if (input == null) {
    return {
      totalExcludedItems: 0,
      countsByCategory: [],
      countsByReasonCode: [],
      countsByCategoryAndReason: [],
    };
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("exclusionSummary must be an object");
  }

  const countsByCategoryAndReason = normalizeExclusionGroups(
    input.countsByCategoryAndReason ??
      input.counts_by_category_and_reason ??
      input.groups ??
      [],
  );
  const countsByCategory = normalizeCategoryCountGroups(
    input.countsByCategory ??
      input.counts_by_category ??
      collapseExclusionGroupsByCategory(countsByCategoryAndReason),
  );
  const countsByReasonCode = normalizeReasonCodeCountGroups(
    input.countsByReasonCode ??
      input.counts_by_reason_code ??
      collapseExclusionGroupsByReasonCode(countsByCategoryAndReason),
  );
  const computedTotal = sumCountValues(countsByCategoryAndReason);
  const computedCategoryTotal = sumCountValues(countsByCategory);
  const computedReasonCodeTotal = sumCountValues(countsByReasonCode);
  const totalExcludedItems = normalizeNonNegativeInteger(
    input.totalExcludedItems ?? input.total_excluded_items ?? computedTotal,
    "exclusionSummary.totalExcludedItems",
  );

  if (totalExcludedItems !== computedTotal) {
    throw new TypeError(
      "exclusionSummary.totalExcludedItems must equal the grouped exclusion count total",
    );
  }

  if (computedCategoryTotal !== totalExcludedItems) {
    throw new TypeError(
      "exclusionSummary.countsByCategory must equal exclusionSummary.totalExcludedItems",
    );
  }

  if (computedReasonCodeTotal !== totalExcludedItems) {
    throw new TypeError(
      "exclusionSummary.countsByReasonCode must equal exclusionSummary.totalExcludedItems",
    );
  }

  return {
    totalExcludedItems,
    countsByCategory,
    countsByReasonCode,
    countsByCategoryAndReason,
  };
}

export function buildNewsletterExclusionSummaryResult(analytics) {
  if (!analytics || typeof analytics !== "object" || Array.isArray(analytics)) {
    throw new TypeError("analytics must be an object");
  }

  const exclusionSummary = buildEditionExclusionSummary(
    normalizeGroupedExclusions(analytics.exclusions),
  );

  return createNewsletterExclusionSummaryResult({
    archiveWindowDays: analytics.archiveWindowDays,
    generatedAt: analytics.generatedAt,
    filters: analytics.filters,
    totals: {
      scannedEditionCount: analytics?.totals?.scannedEditionCount ?? 0,
      matchedEditionCount: analytics?.totals?.matchedEditionCount ?? 0,
      distinctItemCount: analytics?.totals?.distinctItemCount ?? 0,
      exclusionGroupCount: exclusionSummary.countsByCategoryAndReason.length,
    },
    exclusionSummary,
  });
}

export function createNewsletterExclusionSummaryResult(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("exclusionSummaryResult must be an object");
  }

  const exclusionSummary = createEditionExclusionSummary(
    input.exclusionSummary ??
      input.exclusion_summary ??
      {
        totalExcludedItems:
          input.totalExcludedItems ?? input.total_excluded_items ?? 0,
        countsByCategoryAndReason:
          input.countsByCategoryAndReason ?? input.counts_by_category_and_reason ?? [],
      },
  );

  const totals = {
    scannedEditionCount: normalizeNonNegativeInteger(
      input?.totals?.scannedEditionCount ??
        input?.totals?.scanned_edition_count ??
        0,
      "exclusionSummaryResult.totals.scannedEditionCount",
    ),
    matchedEditionCount: normalizeNonNegativeInteger(
      input?.totals?.matchedEditionCount ??
        input?.totals?.matched_edition_count ??
        0,
      "exclusionSummaryResult.totals.matchedEditionCount",
    ),
    distinctItemCount: normalizeNonNegativeInteger(
      input?.totals?.distinctItemCount ??
        input?.totals?.distinct_item_count ??
        0,
      "exclusionSummaryResult.totals.distinctItemCount",
    ),
    totalExcludedItems: normalizeNonNegativeInteger(
      input?.totals?.totalExcludedItems ??
        input?.totals?.total_excluded_items ??
        exclusionSummary.totalExcludedItems,
      "exclusionSummaryResult.totals.totalExcludedItems",
    ),
    exclusionGroupCount: normalizeNonNegativeInteger(
      input?.totals?.exclusionGroupCount ??
        input?.totals?.exclusion_group_count ??
        exclusionSummary.countsByCategoryAndReason.length,
      "exclusionSummaryResult.totals.exclusionGroupCount",
    ),
  };

  if (totals.totalExcludedItems !== exclusionSummary.totalExcludedItems) {
    throw new TypeError(
      "exclusionSummaryResult.totals.totalExcludedItems must equal exclusionSummary.totalExcludedItems",
    );
  }

  if (totals.exclusionGroupCount !== exclusionSummary.countsByCategoryAndReason.length) {
    throw new TypeError(
      "exclusionSummaryResult.totals.exclusionGroupCount must equal the grouped exclusion summary count",
    );
  }

  return {
    archiveWindowDays: normalizePositiveInteger(
      input.archiveWindowDays ?? input.archive_window_days,
      "exclusionSummaryResult.archiveWindowDays",
    ),
    generatedAt: normalizeTimestamp(
      input.generatedAt ?? input.generated_at,
      "exclusionSummaryResult.generatedAt",
    ),
    filters: normalizeSummaryFilters(input.filters),
    totals,
    exclusionSummary,
  };
}

export function formatNewsletterExclusionSummaryResponse(summaryResult) {
  const normalized = createNewsletterExclusionSummaryResult(summaryResult);

  return {
    archive_window_days: normalized.archiveWindowDays,
    generated_at: normalized.generatedAt,
    filters: {
      published_from: normalized.filters.publishedFrom,
      published_to: normalized.filters.publishedTo,
      reason: normalized.filters.reason,
      category: normalized.filters.category,
      source_kind: normalized.filters.sourceKind,
      adapter_id: normalized.filters.adapterId,
      item_id: normalized.filters.itemId,
      phase: normalized.filters.phase,
    },
    totals: {
      scanned_edition_count: normalized.totals.scannedEditionCount,
      matched_edition_count: normalized.totals.matchedEditionCount,
      distinct_item_count: normalized.totals.distinctItemCount,
      total_excluded_items: normalized.totals.totalExcludedItems,
      exclusion_group_count: normalized.totals.exclusionGroupCount,
    },
    exclusion_summary: {
      total_excluded_items: normalized.exclusionSummary.totalExcludedItems,
      counts_by_category: normalized.exclusionSummary.countsByCategory.map((group) => ({
        category: group.category,
        count: group.count,
      })),
      counts_by_reason_code: normalized.exclusionSummary.countsByReasonCode.map((group) => ({
        reason_code: group.reasonCode,
        count: group.count,
      })),
      counts_by_category_and_reason: normalized.exclusionSummary.countsByCategoryAndReason.map(
        (group) => ({
          category: group.category,
          reason_code: group.reasonCode,
          count: group.count,
        }),
      ),
    },
  };
}

function normalizeExclusionGroups(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("exclusionSummary.countsByCategoryAndReason must be an array");
  }

  return value
    .map((group, index) => normalizeExclusionGroup(group, index))
    .sort(sortExclusionGroups);
}

function normalizeGroupedExclusions(exclusions) {
  if (!Array.isArray(exclusions)) {
    throw new TypeError("analytics.exclusions must be an array");
  }

  return exclusions.map((exclusion) => ({
    category: exclusion?.category,
    reasonCode:
      exclusion?.reason ??
      exclusion?.reasonCode ??
      exclusion?.exclusionReasonCode,
    count: exclusion?.count,
  }));
}

function normalizeCategoryCountGroups(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("exclusionSummary.countsByCategory must be an array");
  }

  return value
    .map((group, index) => normalizeCategoryCountGroup(group, index))
    .sort(sortCategoryCountGroups);
}

function normalizeReasonCodeCountGroups(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("exclusionSummary.countsByReasonCode must be an array");
  }

  return value
    .map((group, index) => normalizeReasonCodeCountGroup(group, index))
    .sort(sortReasonCodeCountGroups);
}

function normalizeSummaryFilters(value) {
  const filters = value ?? {};

  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new TypeError("exclusionSummaryResult.filters must be an object");
  }

  return {
    publishedFrom:
      filters.publishedFrom == null && filters.published_from == null
        ? null
        : normalizeTimestamp(
            filters.publishedFrom ?? filters.published_from,
            "exclusionSummaryResult.filters.publishedFrom",
          ),
    publishedTo:
      filters.publishedTo == null && filters.published_to == null
        ? null
        : normalizeTimestamp(
            filters.publishedTo ?? filters.published_to,
            "exclusionSummaryResult.filters.publishedTo",
          ),
    reason:
      filters.reason == null
        ? null
        : normalizeExclusionReasonCode(
            filters.reason,
            "exclusionSummaryResult.filters.reason",
          ),
    category:
      filters.category == null
        ? null
        : normalizeExclusionCategory(filters.category),
    sourceKind:
      filters.sourceKind == null && filters.source_kind == null
        ? null
        : assertNonEmptyString(
            filters.sourceKind ?? filters.source_kind,
            "exclusionSummaryResult.filters.sourceKind",
          ),
    adapterId:
      filters.adapterId == null && filters.adapter_id == null
        ? null
        : assertNonEmptyString(
            filters.adapterId ?? filters.adapter_id,
            "exclusionSummaryResult.filters.adapterId",
          ),
    itemId:
      filters.itemId == null && filters.item_id == null
        ? null
        : assertNonEmptyString(
            filters.itemId ?? filters.item_id,
            "exclusionSummaryResult.filters.itemId",
          ),
    phase:
      filters.phase == null
        ? null
        : assertNonEmptyString(filters.phase, "exclusionSummaryResult.filters.phase"),
  };
}

function normalizeExclusionGroup(group, index) {
  if (!group || typeof group !== "object" || Array.isArray(group)) {
    throw new TypeError(
      `exclusionSummary.countsByCategoryAndReason[${index}] must be an object`,
    );
  }

  return {
    category: normalizeExclusionCategory(group.category),
    reasonCode: normalizeExclusionReasonCode(
      group.reasonCode ??
        group.reason_code ??
        group.reason ??
        group.exclusionReasonCode ??
        group.exclusion_reason_code,
      `exclusionSummary.countsByCategoryAndReason[${index}].reasonCode`,
    ),
    count: normalizePositiveInteger(
      group.count,
      `exclusionSummary.countsByCategoryAndReason[${index}].count`,
    ),
  };
}

function normalizeCategoryCountGroup(group, index) {
  if (!group || typeof group !== "object" || Array.isArray(group)) {
    throw new TypeError(`exclusionSummary.countsByCategory[${index}] must be an object`);
  }

  return {
    category: normalizeExclusionCategory(group.category),
    count: normalizePositiveInteger(
      group.count,
      `exclusionSummary.countsByCategory[${index}].count`,
    ),
  };
}

function normalizeReasonCodeCountGroup(group, index) {
  if (!group || typeof group !== "object" || Array.isArray(group)) {
    throw new TypeError(
      `exclusionSummary.countsByReasonCode[${index}] must be an object`,
    );
  }

  return {
    reasonCode: normalizeExclusionReasonCode(
      group.reasonCode ??
        group.reason_code ??
        group.reason ??
        group.exclusionReasonCode ??
        group.exclusion_reason_code,
      `exclusionSummary.countsByReasonCode[${index}].reasonCode`,
    ),
    count: normalizePositiveInteger(
      group.count,
      `exclusionSummary.countsByReasonCode[${index}].count`,
    ),
  };
}

function normalizeExclusionCategory(value) {
  return assertOneOf(value, CONTENT_CATEGORIES, "exclusionDecision.category");
}

function normalizeExclusionReasonCode(
  value,
  fieldName = "exclusionDecision.reasonCode",
) {
  return normalizeStoredExclusionReasonCode(value, fieldName);
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

function collapseExclusionGroupsByCategory(groups) {
  const countsByCategory = new Map();

  for (const group of groups) {
    incrementAggregateCount(countsByCategory, group.category, group.count);
  }

  return [...countsByCategory.entries()].map(([category, count]) => ({
    category,
    count,
  }));
}

function collapseExclusionGroupsByReasonCode(groups) {
  const countsByReasonCode = new Map();

  for (const group of groups) {
    incrementAggregateCount(countsByReasonCode, group.reasonCode, group.count);
  }

  return [...countsByReasonCode.entries()].map(([reasonCode, count]) => ({
    reasonCode,
    count,
  }));
}

function incrementAggregateCount(counts, key, value) {
  counts.set(key, (counts.get(key) ?? 0) + value);
}

function sumCountValues(groups) {
  return groups.reduce((total, group) => total + group.count, 0);
}

function sortExclusionGroups(left, right) {
  const categoryOrderDifference =
    CATEGORY_ORDER.get(left.category) - CATEGORY_ORDER.get(right.category);

  if (categoryOrderDifference !== 0) {
    return categoryOrderDifference;
  }

  return left.reasonCode.localeCompare(right.reasonCode);
}

function sortCategoryCountGroups(left, right) {
  return CATEGORY_ORDER.get(left.category) - CATEGORY_ORDER.get(right.category);
}

function sortReasonCodeCountGroups(left, right) {
  return left.reasonCode.localeCompare(right.reasonCode);
}
