import { assertOneOf, normalizeTimestamp, CONTENT_CATEGORIES } from "../core/contracts.js";
import {
  SOURCE_COVERAGE_STATUSES,
  resolveMinimumActiveCategorySources,
} from "../discovery/source-coverage.js";

const SOURCE_COVERAGE_STATUS_VALUES = Object.freeze(
  Object.values(SOURCE_COVERAGE_STATUSES),
);

export function formatNewsletterCoverageMapResponse({
  generatedAt,
  minimumActiveSourceCount,
  coverageMap,
}) {
  if (!Array.isArray(coverageMap)) {
    throw new TypeError("coverageMap must be an array");
  }

  return {
    generated_at: normalizeTimestamp(generatedAt, "generatedAt"),
    minimum_active_source_count: normalizeMinimumActiveSourceCount(minimumActiveSourceCount),
    topic_count: coverageMap.length,
    topics: coverageMap.map((entry) => serializeNewsletterCoverageTopic(entry)),
  };
}

export function serializeNewsletterCoverageTopic(entry) {
  return {
    topic_area: assertOneOf(
      entry?.topicArea ?? entry?.topic_area,
      CONTENT_CATEGORIES,
      "coverageMap.topicArea",
    ),
    active_source_count: normalizeNonNegativeInteger(
      entry?.activeSourceCount ?? entry?.active_source_count,
      "coverageMap.activeSourceCount",
    ),
    coverage_status: assertOneOf(
      entry?.coverageStatus ?? entry?.coverage_status,
      SOURCE_COVERAGE_STATUS_VALUES,
      "coverageMap.coverageStatus",
    ),
  };
}

function normalizeMinimumActiveSourceCount(value) {
  return resolveMinimumActiveCategorySources({
    minimumActiveCategorySources: value,
  });
}

function normalizeNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }

  return value;
}
