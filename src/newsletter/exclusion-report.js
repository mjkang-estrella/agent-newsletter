import { assertNonEmptyString, normalizeTimestamp } from "../core/contracts.js";
import {
  buildNewsletterExclusionAnalytics,
  formatNewsletterExclusionAnalyticsResponse,
} from "./exclusion-analytics.js";
import {
  buildEditionExclusionSummary,
  buildNewsletterExclusionSummaryResult,
  createEditionExclusionSummary,
} from "./exclusion-summary.js";
import { createNewsletterEdition } from "./schema.js";

export function buildNewsletterExclusionReport(editions, options = {}) {
  const normalizedEditions = Array.isArray(editions)
    ? editions.map((edition) => createNewsletterEdition(edition))
    : [];
  const analytics = buildNewsletterExclusionAnalytics(normalizedEditions, options);
  const summaryResult = buildNewsletterExclusionSummaryResult(analytics);
  const editionSummaries = buildReportEditionSummaries(normalizedEditions, analytics);

  return {
    archiveWindowDays: analytics.archiveWindowDays,
    generatedAt: analytics.generatedAt,
    filters: analytics.filters,
    totals: {
      ...analytics.totals,
      editionSummaryCount: editionSummaries.length,
    },
    exclusionSummary: summaryResult.exclusionSummary,
    editionSummaries,
    exclusions: analytics.exclusions,
    aggregations: analytics.aggregations,
    recurringItems: analytics.recurringItems,
    blindSpots: analytics.blindSpots,
  };
}

export function formatNewsletterExclusionReportResponse(report) {
  const analyticsResponse = formatNewsletterExclusionAnalyticsResponse({
    archiveWindowDays: report?.archiveWindowDays,
    generatedAt: report?.generatedAt,
    filters: report?.filters,
    totals: {
      scannedEditionCount: report?.totals?.scannedEditionCount,
      matchedEditionCount: report?.totals?.matchedEditionCount,
      exclusionCount: report?.totals?.exclusionCount,
      distinctItemCount: report?.totals?.distinctItemCount,
      recurringItemCount: report?.totals?.recurringItemCount,
      blindSpotCount: report?.totals?.blindSpotCount,
    },
    exclusions: report?.exclusions,
    aggregations: report?.aggregations,
    recurringItems: report?.recurringItems,
    blindSpots: report?.blindSpots,
  });

  return {
    ...analyticsResponse,
    totals: {
      ...analyticsResponse.totals,
      edition_summary_count: normalizeNonNegativeInteger(
        report?.totals?.editionSummaryCount,
        "report.totals.editionSummaryCount",
      ),
    },
    exclusion_summary: serializeExclusionSummary(report?.exclusionSummary),
    edition_summaries: normalizeEditionSummaries(report?.editionSummaries),
  };
}

function buildReportEditionSummaries(editions, analytics) {
  const generatedAtMs = new Date(
    normalizeTimestamp(analytics.generatedAt, "analytics.generatedAt"),
  ).getTime();
  const publishedFromMs = new Date(
    normalizeTimestamp(analytics.filters.publishedFrom, "analytics.filters.publishedFrom"),
  ).getTime();
  const publishedToMs = new Date(
    normalizeTimestamp(analytics.filters.publishedTo, "analytics.filters.publishedTo"),
  ).getTime();
  const exclusionsByEditionId = groupBy(analytics.exclusions, (entry) => entry.editionId);

  return editions
    .filter((edition) => {
      const publishedAtMs = new Date(
        normalizeTimestamp(edition.publishedAt, "edition.publishedAt"),
      ).getTime();

      return (
        publishedAtMs <= generatedAtMs &&
        publishedAtMs >= publishedFromMs &&
        publishedAtMs <= publishedToMs
      );
    })
    .sort(
      (left, right) =>
        new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
    )
    .map((edition) => {
      const matchingExclusions = exclusionsByEditionId.get(edition.id) ?? [];

      return {
        editionId: edition.id,
        publishedAt: edition.publishedAt,
        window: edition.window,
        publishedItemCount: edition.items.length,
        editionExclusionSummary: createEditionExclusionSummary(edition.exclusionSummary),
        matchingExclusionSummary: buildEditionExclusionSummary(
          matchingExclusions.map((exclusion) => ({
            category: exclusion.category,
            reasonCode:
              exclusion.reasonCode ?? exclusion.reason ?? exclusion.exclusionReasonCode,
          })),
        ),
        matchingDistinctItemCount: countDistinct(matchingExclusions, (entry) => entry.itemId),
      };
    });
}

function normalizeEditionSummaries(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("report.editionSummaries must be an array");
  }

  return entries.map((entry) => ({
    edition_id: assertNonEmptyString(entry.editionId, "report.editionSummaries[].editionId"),
    published_at: normalizeTimestamp(
      entry.publishedAt,
      "report.editionSummaries[].publishedAt",
    ),
    content_window: {
      starts_at: normalizeTimestamp(
        entry?.window?.startsAt,
        "report.editionSummaries[].window.startsAt",
      ),
      ends_at: normalizeTimestamp(
        entry?.window?.endsAt,
        "report.editionSummaries[].window.endsAt",
      ),
      timezone: assertNonEmptyString(
        entry?.window?.timezone,
        "report.editionSummaries[].window.timezone",
      ),
    },
    published_item_count: normalizeNonNegativeInteger(
      entry.publishedItemCount,
      "report.editionSummaries[].publishedItemCount",
    ),
    matching_distinct_item_count: normalizeNonNegativeInteger(
      entry.matchingDistinctItemCount,
      "report.editionSummaries[].matchingDistinctItemCount",
    ),
    edition_exclusion_summary: serializeExclusionSummary(entry.editionExclusionSummary),
    matching_exclusion_summary: serializeExclusionSummary(entry.matchingExclusionSummary),
  }));
}

function serializeExclusionSummary(summary) {
  const normalizedSummary = createEditionExclusionSummary(summary);

  return {
    total_excluded_items: normalizedSummary.totalExcludedItems,
    counts_by_category: normalizedSummary.countsByCategory.map((group) => ({
      category: group.category,
      count: group.count,
    })),
    counts_by_reason_code: normalizedSummary.countsByReasonCode.map((group) => ({
      reason_code: group.reasonCode,
      count: group.count,
    })),
    counts_by_category_and_reason: normalizedSummary.countsByCategoryAndReason.map((group) => ({
      category: group.category,
      reason_code: group.reasonCode,
      count: group.count,
    })),
  };
}

function countDistinct(entries, getValue) {
  return new Set(entries.map((entry) => getValue(entry))).size;
}

function groupBy(entries, getKey) {
  const grouped = new Map();

  for (const entry of entries) {
    const key = getKey(entry);
    const bucket = grouped.get(key) ?? [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }

  return grouped;
}

function normalizeNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }

  return value;
}
