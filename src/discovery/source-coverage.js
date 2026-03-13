import { CONTENT_CATEGORIES } from "../core/contracts.js";
import { DEFAULT_DISCOVERY_CONFIG } from "./config.js";
import { SOURCE_LIFECYCLE_STATES, normalizeSourceLifecycle } from "./source-lifecycle.js";

export const SOURCE_COVERAGE_STATUSES = Object.freeze({
  covered: "covered",
  underrepresented: "underrepresented",
  uncovered: "uncovered",
});

export function buildSourceCoverageMap(sources, config = DEFAULT_DISCOVERY_CONFIG) {
  const minimumActiveSources = resolveMinimumActiveCategorySources(config);
  const activeSourcesByCategory = countActiveSourcesByCategory(sources, config);

  return CONTENT_CATEGORIES.map((topicArea) => {
    const activeSourceCount = activeSourcesByCategory.get(topicArea) ?? 0;

    return {
      topicArea,
      activeSourceCount,
      coverageStatus: resolveSourceCoverageStatus(activeSourceCount, minimumActiveSources),
    };
  });
}

export function countActiveSourcesByTopicArea(
  sources,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const counts = new Map();

  for (const source of normalizeSourceCollection(sources)) {
    if (!isActiveSourceForCoverage(source, config)) {
      continue;
    }

    for (const topicArea of normalizeTopicAreas(source?.evidence?.topicHits, config)) {
      counts.set(topicArea, (counts.get(topicArea) ?? 0) + 1);
    }
  }

  return counts;
}

export function countActiveSourcesByCategory(sources, config = DEFAULT_DISCOVERY_CONFIG) {
  const counts = new Map();

  for (const source of normalizeSourceCollection(sources)) {
    if (!isActiveSourceForCoverage(source, config)) {
      continue;
    }

    for (const category of normalizeCategoryCoverage(source?.evidence?.categoryCoverage)) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }

  return counts;
}

export function findRetirementBlockedCategories(
  sources,
  source,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  if (!isActiveSourceForCoverage(source, config)) {
    return [];
  }

  const minimumActiveSources = resolveMinimumActiveCategorySources(config);
  const activeSourcesByCategory = countActiveSourcesByCategory(sources, config);

  return normalizeCategoryCoverage(source?.evidence?.categoryCoverage).filter((category) => {
    const activeSourceCount = activeSourcesByCategory.get(category) ?? 0;

    return activeSourceCount === 1 && activeSourceCount < minimumActiveSources;
  });
}

export function isActiveSourceForCoverage(
  source,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  if (!source || source.seed === true || source.status !== "approved") {
    return false;
  }

  return normalizeSourceLifecycle(source, config).state === SOURCE_LIFECYCLE_STATES.active;
}

export function isActiveCategorySource(source, config = DEFAULT_DISCOVERY_CONFIG) {
  return isActiveSourceForCoverage(source, config);
}

export function normalizeCategoryCoverage(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return CONTENT_CATEGORIES.filter((category) => values.includes(category));
}

export function resolveMinimumActiveCategorySources(config = DEFAULT_DISCOVERY_CONFIG) {
  const minimum = config.minimumActiveCategorySources;

  if (typeof minimum !== "number" || !Number.isFinite(minimum) || minimum <= 0) {
    return 2;
  }

  return Math.trunc(minimum);
}

export function resolveSourceCoverageStatus(activeSourceCount, minimumActiveSources) {
  const normalizedActiveSourceCount = normalizeNonNegativeInteger(
    activeSourceCount,
    "activeSourceCount",
  );
  const normalizedMinimum = normalizePositiveInteger(
    minimumActiveSources,
    "minimumActiveSources",
  );

  if (normalizedActiveSourceCount === 0) {
    return SOURCE_COVERAGE_STATUSES.uncovered;
  }

  if (normalizedActiveSourceCount < normalizedMinimum) {
    return SOURCE_COVERAGE_STATUSES.underrepresented;
  }

  return SOURCE_COVERAGE_STATUSES.covered;
}

function normalizeSourceCollection(sources) {
  if (sources instanceof Map) {
    return [...sources.values()];
  }

  if (sources == null) {
    return [];
  }

  if (Array.isArray(sources)) {
    return sources;
  }

  if (typeof sources[Symbol.iterator] === "function") {
    return [...sources];
  }

  throw new TypeError("sources must be iterable");
}

function normalizeTopicAreas(values, config = DEFAULT_DISCOVERY_CONFIG) {
  if (!Array.isArray(values)) {
    return [];
  }

  const topicHits = new Set(
    values
      .filter((value) => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  return resolveKnownTopicAreas(config).filter((topicArea) => topicHits.has(topicArea));
}

function resolveKnownTopicAreas(config = DEFAULT_DISCOVERY_CONFIG) {
  const keywords = Array.isArray(config?.topicalKeywords)
    ? config.topicalKeywords
    : DEFAULT_DISCOVERY_CONFIG.topicalKeywords;

  return [...new Set(keywords.map((value) => String(value).trim().toLowerCase()).filter(Boolean))];
}

function normalizeNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }

  return value;
}

function normalizePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }

  return value;
}
