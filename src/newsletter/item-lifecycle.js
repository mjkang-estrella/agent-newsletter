import { assertNonEmptyString, normalizeTimestamp } from "../core/contracts.js";
import { hasHighSentimentDivergence } from "../core/relevance-scoring.js";

export function buildItemLifecycleFromEditions(editions, itemId) {
  if (!Array.isArray(editions)) {
    throw new TypeError("editions must be an array");
  }

  const normalizedItemId = assertNonEmptyString(itemId, "itemId");
  const appearances = [];
  let firstSeen = null;
  let editionCount = 0;
  let latestStoryline = null;

  for (const edition of [...editions].sort(sortByPublishedAtAsc)) {
    const item = edition.items.find((candidate) => resolveTrackedItemId(candidate) === normalizedItemId);

    if (!item) {
      continue;
    }

    firstSeen = pickEarlierTimestamp(
      firstSeen,
      item.firstSeen ?? item.discoveredAt ?? edition.publishedAt,
    );
    editionCount = Math.max(editionCount, item.editionCount ?? appearances.length + 1);
    const storyline = resolveLifecycleStoryline(edition, item);
    appearances.push({
      editionId: edition.id,
      publishedAt: edition.publishedAt,
      window: edition.window,
      item,
      storyline,
    });
    latestStoryline = storyline ?? latestStoryline;
  }

  if (appearances.length === 0) {
    return null;
  }

  const firstAppearance = appearances[0];

  return {
    itemId: normalizedItemId,
    firstSeen: normalizeTimestamp(firstSeen ?? appearances[0].publishedAt, "firstSeen"),
    editionCount: Math.max(editionCount, appearances.length),
    firstAppearance: createLifecycleOccurrenceSummary(firstAppearance, 1),
    repeatAppearances: appearances
      .slice(1)
      .map((appearance, index) => createLifecycleOccurrenceSummary(appearance, index + 2)),
    scoreEvolution: appearances.map((appearance, index) =>
      createLifecycleScoreSnapshot(
        appearance,
        appearances[index - 1] ?? null,
        firstAppearance,
      ),
    ),
    storylineMembership: appearances.map((appearance) =>
      createLifecycleStorylineMembershipSummary(appearance),
    ),
    storyline: latestStoryline,
    appearances,
  };
}

function createLifecycleOccurrenceSummary(appearance, appearanceNumber) {
  const storylineIds = resolveLifecycleStorylineIds(appearance.item, appearance.storyline);

  return {
    editionId: appearance.editionId,
    publishedAt: appearance.publishedAt,
    appearanceNumber,
    relevanceScore: appearance.item.relevanceScore ?? null,
    scoreVersion: appearance.item.scoreVersion ?? null,
    divergenceFlag: resolveItemDivergenceFlag(appearance.item),
    storylineIds,
  };
}

function createLifecycleScoreSnapshot(appearance, previousAppearance, firstAppearance) {
  return {
    editionId: appearance.editionId,
    publishedAt: appearance.publishedAt,
    relevanceScore: appearance.item.relevanceScore ?? null,
    scoreVersion: appearance.item.scoreVersion ?? null,
    divergenceFlag: resolveItemDivergenceFlag(appearance.item),
    deltaFromPrevious:
      previousAppearance?.item?.relevanceScore == null || appearance.item.relevanceScore == null
        ? null
        : appearance.item.relevanceScore - previousAppearance.item.relevanceScore,
    deltaFromFirstAppearance:
      firstAppearance?.item?.relevanceScore == null || appearance.item.relevanceScore == null
        ? null
        : appearance.item.relevanceScore - firstAppearance.item.relevanceScore,
  };
}

function createLifecycleStorylineMembershipSummary(appearance) {
  const storylineIds = resolveLifecycleStorylineIds(appearance.item, appearance.storyline);

  return {
    editionId: appearance.editionId,
    publishedAt: appearance.publishedAt,
    storylineIds,
    primaryStorylineId: appearance.storyline?.storylineId ?? null,
    primaryStorylineTitle: appearance.storyline?.title ?? null,
    primaryStorylineStatus: appearance.storyline?.status ?? null,
    position: appearance.storyline?.position ?? null,
    relationshipDecision: appearance.storyline?.relationship?.decision ?? null,
  };
}

function resolveTrackedItemId(item) {
  return item.itemId ?? item.id;
}

function resolveItemDivergenceFlag(item) {
  return typeof item?.divergenceFlag === "boolean"
    ? item.divergenceFlag
    : hasHighSentimentDivergence(item);
}

function resolveLifecycleStoryline(edition, item) {
  const trackedItemId = resolveTrackedItemId(item);
  const metadata = readStorylineMetadata(item);
  const storylineId = item.storylineId ?? metadata.id;

  if (!storylineId) {
    return null;
  }

  const editionStoryline = (edition.storylines ?? []).find(
    (candidate) => resolveEditionStorylineId(candidate) === storylineId,
  );
  const memberItemIds = uniqueValues([
    ...(editionStoryline?.memberItemIds ?? editionStoryline?.member_item_ids ?? []),
    ...metadata.memberItemIds,
    trackedItemId,
  ]).filter(Boolean);
  const position =
    normalizePositiveInteger(item.storylineMemberPosition) ??
    normalizePositiveInteger(item.storyline_member_position) ??
    normalizePositiveInteger(metadata.position) ??
    deriveStorylinePosition(memberItemIds, trackedItemId);
  const firstSeen =
    metadata.firstSeen ?? item.firstSeen ?? item.discoveredAt ?? edition.publishedAt ?? null;
  const lastSeen =
    metadata.lastSeen ?? item.discoveredAt ?? item.publishedAt ?? edition.publishedAt ?? null;

  return {
    storylineId,
    title: editionStoryline?.title ?? metadata.title ?? item.name,
    status: editionStoryline?.status ?? metadata.status ?? "developing",
    memberItemIds,
    relatedItemIds: memberItemIds.filter((candidate) => candidate !== trackedItemId),
    parentStorylineIds:
      editionStoryline?.parentStorylineIds ??
      editionStoryline?.parent_storyline_ids ??
      metadata.parentStorylineIds,
    narrativeType:
      editionStoryline?.narrativeType ??
      editionStoryline?.narrative_type ??
      metadata.narrativeType,
    firstSeen,
    lastSeen,
    updatedAt: metadata.updatedAt,
    lastEvolutionAt: metadata.lastEvolutionAt,
    evolutionCount: metadata.evolutionCount,
    repetitionCount: metadata.repetitionCount,
    repetitionStreak: metadata.repetitionStreak,
    position,
    relationship: metadata.relationship ?? null,
  };
}

function pickEarlierTimestamp(left, right) {
  if (left == null) {
    return right ?? null;
  }

  if (right == null) {
    return left;
  }

  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function sortByPublishedAtAsc(left, right) {
  return new Date(left.publishedAt).getTime() - new Date(right.publishedAt).getTime();
}

function readStorylineMetadata(item) {
  const storyline = item?.metadata?.storyline;

  if (!storyline || typeof storyline !== "object" || Array.isArray(storyline)) {
    return {
      id: null,
      title: null,
      status: null,
      memberItemIds: [],
      parentStorylineIds: [],
      narrativeType: null,
      firstSeen: null,
      lastSeen: null,
      updatedAt: null,
      lastEvolutionAt: null,
      evolutionCount: 0,
      repetitionCount: 0,
      repetitionStreak: 0,
      position: null,
      relationship: null,
    };
  }

  return {
    id: storyline.storylineId ?? storyline.id ?? null,
    title: storyline.title ?? null,
    status: storyline.status ?? null,
    memberItemIds: uniqueValues([
      ...(storyline.memberItemIds ?? storyline.member_item_ids ?? []),
    ]).filter(Boolean),
    parentStorylineIds: uniqueValues(
      [...(storyline.parentStorylineIds ?? storyline.parent_storyline_ids ?? [])].filter(Boolean),
    ),
    narrativeType: storyline.narrativeType ?? storyline.narrative_type ?? null,
    firstSeen: storyline.firstSeen ?? storyline.first_seen ?? null,
    lastSeen: storyline.lastSeen ?? storyline.last_seen ?? null,
    updatedAt: storyline.updatedAt ?? storyline.updated_at ?? null,
    lastEvolutionAt: storyline.lastEvolutionAt ?? storyline.last_evolution_at ?? null,
    evolutionCount: normalizeCounter(storyline.evolutionCount ?? storyline.evolution_count),
    repetitionCount: normalizeCounter(storyline.repetitionCount ?? storyline.repetition_count),
    repetitionStreak: normalizeCounter(storyline.repetitionStreak ?? storyline.repetition_streak),
    position: storyline.position ?? null,
    relationship: storyline.relationship ?? null,
  };
}

function resolveEditionStorylineId(storyline) {
  return storyline?.storylineId ?? storyline?.storyline_id ?? null;
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function resolveLifecycleStorylineIds(item, storyline) {
  return uniqueValues(
    [
      ...(item?.storylineIds ?? item?.storyline_ids ?? []),
      item?.storylineId ?? item?.storyline_id ?? null,
      storyline?.storylineId ?? storyline?.storyline_id ?? null,
    ].filter(Boolean),
  );
}

function normalizeCounter(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizePositiveInteger(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(1, Math.trunc(value));
}

function deriveStorylinePosition(memberItemIds, itemId) {
  const index = memberItemIds.indexOf(itemId);
  return index === -1 ? null : index + 1;
}
