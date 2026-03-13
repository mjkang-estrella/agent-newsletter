import { CONTENT_CATEGORIES, normalizeTimestamp } from "../core/contracts.js";
import { DEFAULT_MIN_RELEVANCE_SCORE } from "../core/relevance-scoring.js";
import { countDistinctSourceClusters, createNormalizedItem } from "../core/schema.js";
import { DEFAULT_ARCHIVE_WINDOW_DAYS, createNewsletterEdition } from "./schema.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_REFERENCE_MINIMUM_EDITION_COUNT = 3;
export const DEFAULT_REFERENCE_MINIMUM_SOURCE_CLUSTER_COUNT = 2;
export const DEFAULT_REFERENCE_RELAXED_SOURCE_CLUSTER_COUNT = 1;
export const DEFAULT_REFERENCE_MINIMUM_CATEGORY_ITEM_COUNT = 1;

export function selectReferenceItemsFromEditions(
  editions,
  {
    now = new Date().toISOString(),
    archiveWindowDays = DEFAULT_ARCHIVE_WINDOW_DAYS,
    minimumEditionCount = DEFAULT_REFERENCE_MINIMUM_EDITION_COUNT,
    minimumSourceClusterCount = DEFAULT_REFERENCE_MINIMUM_SOURCE_CLUSTER_COUNT,
    relaxedSourceClusterCount = DEFAULT_REFERENCE_RELAXED_SOURCE_CLUSTER_COUNT,
    minimumItemsPerCategory = DEFAULT_REFERENCE_MINIMUM_CATEGORY_ITEM_COUNT,
    underrepresentedCategories = [],
  } = {},
) {
  if (!Array.isArray(editions)) {
    throw new TypeError("editions must be an array");
  }

  const normalizedNow = normalizeTimestamp(now, "now");
  const normalizedArchiveWindowDays = normalizePositiveInteger(
    archiveWindowDays,
    "archiveWindowDays",
  );
  const normalizedMinimumEditionCount = normalizePositiveInteger(
    minimumEditionCount,
    "minimumEditionCount",
  );
  const normalizedMinimumSourceClusterCount = normalizePositiveInteger(
    minimumSourceClusterCount,
    "minimumSourceClusterCount",
  );
  const normalizedRelaxedSourceClusterCount = normalizePositiveInteger(
    relaxedSourceClusterCount,
    "relaxedSourceClusterCount",
  );
  const normalizedMinimumItemsPerCategory = normalizePositiveInteger(
    minimumItemsPerCategory,
    "minimumItemsPerCategory",
  );
  const normalizedUnderrepresentedCategories = normalizeUnderrepresentedCategories(
    underrepresentedCategories,
  );

  if (normalizedRelaxedSourceClusterCount > normalizedMinimumSourceClusterCount) {
    throw new TypeError(
      "relaxedSourceClusterCount must be less than or equal to minimumSourceClusterCount",
    );
  }

  const nowMs = new Date(normalizedNow).getTime();
  const cutoffMs = nowMs - normalizedArchiveWindowDays * DAY_IN_MS;
  const recentItemIds = new Set();
  const publishedEditions = editions
    .map((edition) => createNewsletterEdition(edition))
    .filter((edition) => new Date(edition.publishedAt).getTime() <= nowMs)
    .sort(sortEditionsByPublishedAtDesc);
  const candidateItems = collectReferenceCandidates(publishedEditions, {
    cutoffMs,
    recentItemIds,
  });
  const strictSelections = [];
  const strictSelectionsByCategory = new Map();
  const diversityFallbackCandidatesByCategory = new Map();

  for (const candidate of candidateItems.values()) {
    const evaluation = evaluateReferenceCandidate(candidate, {
      minimumEditionCount: normalizedMinimumEditionCount,
      minimumSourceClusterCount: normalizedMinimumSourceClusterCount,
      relaxedSourceClusterCount: normalizedRelaxedSourceClusterCount,
    });

    if (evaluation.strictlyEligible) {
      strictSelections.push(candidate.item);
      incrementCategoryCount(strictSelectionsByCategory, candidate.item.category);
      continue;
    }

    if (!evaluation.diversityFallbackEligible) {
      continue;
    }

    if (!normalizedUnderrepresentedCategories.has(candidate.item.category)) {
      continue;
    }

    upsertBestCategoryFallbackCandidate(diversityFallbackCandidatesByCategory, candidate);
  }

  const referenceItems = [...strictSelections];

  // Preserve at least one durable candidate for categories that would otherwise vanish
  // from the long-term reference index after applying the stricter corroboration rule.
  for (const [category, candidate] of diversityFallbackCandidatesByCategory.entries()) {
    if ((strictSelectionsByCategory.get(category) ?? 0) >= normalizedMinimumItemsPerCategory) {
      continue;
    }

    referenceItems.push(candidate.item);
  }

  return referenceItems.sort(compareReferenceItems);
}

function compareReferenceItems(left, right) {
  return (
    right.relevanceScore - left.relevanceScore ||
    right.editionCount - left.editionCount ||
    new Date(right.publishedAt ?? 0).getTime() - new Date(left.publishedAt ?? 0).getTime() ||
    left.name.localeCompare(right.name)
  );
}

function normalizePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }

  return value;
}

function normalizeUnderrepresentedCategories(categories) {
  if (!Array.isArray(categories)) {
    throw new TypeError("underrepresentedCategories must be an array");
  }

  const normalizedCategories = new Set(
    categories
      .filter((category) => typeof category === "string")
      .map((category) => category.trim().toLowerCase())
      .filter(Boolean),
  );

  return new Set(CONTENT_CATEGORIES.filter((category) => normalizedCategories.has(category)));
}

function sortEditionsByPublishedAtDesc(left, right) {
  return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
}

function collectReferenceCandidates(publishedEditions, { cutoffMs, recentItemIds }) {
  const candidates = new Map();

  for (const edition of publishedEditions) {
    const publishedAtMs = new Date(edition.publishedAt).getTime();
    const withinArchiveWindow = publishedAtMs > cutoffMs;

    for (const item of edition.items) {
      const trackedItemId = item.itemId ?? item.id;

      if (withinArchiveWindow) {
        recentItemIds.add(trackedItemId);
        continue;
      }

      if (recentItemIds.has(trackedItemId) || candidates.has(trackedItemId)) {
        continue;
      }

      const normalizedItem = createNormalizedItem({
        ...item,
        publishedAt: item.publishedAt ?? edition.publishedAt,
      });

      candidates.set(trackedItemId, {
        item: normalizedItem,
        sourceClusterCount: countDistinctSourceClusters(normalizedItem.sourceUrls),
      });
    }
  }

  return candidates;
}

function evaluateReferenceCandidate(
  candidate,
  {
    minimumEditionCount,
    minimumSourceClusterCount,
    relaxedSourceClusterCount,
  },
) {
  const editionCount = candidate.item.editionCount ?? 1;
  const relevanceScore = candidate.item.relevanceScore;
  const meetsPersistence = editionCount >= minimumEditionCount;
  const meetsRelevance =
    relevanceScore != null && relevanceScore >= DEFAULT_MIN_RELEVANCE_SCORE;
  const meetsStrictCorroboration =
    candidate.sourceClusterCount >= minimumSourceClusterCount;
  const meetsRelaxedCorroboration =
    candidate.sourceClusterCount >= relaxedSourceClusterCount;

  return {
    strictlyEligible:
      meetsPersistence && meetsRelevance && meetsStrictCorroboration,
    diversityFallbackEligible:
      meetsPersistence &&
      meetsRelevance &&
      meetsRelaxedCorroboration &&
      !meetsStrictCorroboration,
  };
}

function incrementCategoryCount(counts, category) {
  counts.set(category, (counts.get(category) ?? 0) + 1);
}

function upsertBestCategoryFallbackCandidate(candidatesByCategory, candidate) {
  const existingCandidate = candidatesByCategory.get(candidate.item.category);

  if (
    existingCandidate == null ||
    compareReferenceItems(candidate.item, existingCandidate.item) < 0
  ) {
    candidatesByCategory.set(candidate.item.category, candidate);
  }
}
