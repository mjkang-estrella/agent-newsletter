import { normalizeTimestamp } from "../core/contracts.js";
import { createNormalizedItem } from "../core/schema.js";

import { buildTrackedStorylineStatesFromEditions } from "./storyline.js";

export function selectActiveStorylinesFromEditions(
  editions,
  { now = new Date().toISOString() } = {},
) {
  if (!Array.isArray(editions)) {
    throw new TypeError("editions must be an array");
  }

  const normalizedNow = normalizeTimestamp(now, "now");
  const nowMs = new Date(normalizedNow).getTime();
  const publishedEditions = editions
    .filter((edition) => new Date(edition.publishedAt).getTime() <= nowMs)
    .sort(sortEditionsByPublishedAtDesc);
  const latestItemsById = buildLatestPublishedItemMap(publishedEditions);
  const storylineStates = buildTrackedStorylineStatesFromEditions(publishedEditions);

  return [...storylineStates.values()]
    .filter((storylineState) => storylineState.status !== "archived")
    .map((storylineState) => createActiveStorylineGroup(storylineState, latestItemsById))
    .filter(Boolean)
    .sort(compareActiveStorylineGroups);
}

function buildLatestPublishedItemMap(editions) {
  const latestItemsById = new Map();

  for (const edition of editions) {
    for (const item of edition.items ?? []) {
      if (latestItemsById.has(item.itemId)) {
        continue;
      }

      latestItemsById.set(
        item.itemId,
        createNormalizedItem({
          ...item,
          publishedAt: item.publishedAt ?? edition.publishedAt,
        }),
      );
    }
  }

  return latestItemsById;
}

function createActiveStorylineGroup(storylineState, latestItemsById) {
  const items = storylineState.memberItemIds
    .map((itemId) => latestItemsById.get(itemId) ?? null)
    .filter(Boolean)
    .sort(compareStorylineItems);

  if (items.length === 0) {
    return null;
  }

  return {
    storylineId: storylineState.id,
    title: storylineState.title ?? items[items.length - 1].name,
    memberItemIds: items.map((item) => item.itemId),
    status: storylineState.status,
    ...(storylineState.parentStorylineIds.length > 0
      ? { parentStorylineIds: [...storylineState.parentStorylineIds] }
      : {}),
    ...(storylineState.childStorylineIds.length > 0
      ? { childStorylineIds: [...storylineState.childStorylineIds] }
      : {}),
    ...(storylineState.mergedStorylineIds.length > 0
      ? { mergedStorylineIds: [...storylineState.mergedStorylineIds] }
      : {}),
    ...(storylineState.mergedIntoStorylineId
      ? { mergedIntoStorylineId: storylineState.mergedIntoStorylineId }
      : {}),
    ...(storylineState.narrativeType
      ? { narrativeType: storylineState.narrativeType }
      : {}),
    firstSeen: storylineState.firstSeen ?? items[0].firstSeen,
    lastSeen:
      storylineState.lastSeen ??
      items.at(-1)?.publishedAt ??
      items.at(-1)?.discoveredAt ??
      items.at(-1)?.firstSeen,
    updatedAt:
      storylineState.updatedAt ??
      storylineState.lastSeen ??
      items.at(-1)?.publishedAt ??
      items.at(-1)?.discoveredAt ??
      items.at(-1)?.firstSeen,
    lastEvolutionAt:
      storylineState.lastEvolutionAt ??
      storylineState.updatedAt ??
      storylineState.firstSeen ??
      items[0].firstSeen,
    evolutionCount: normalizeNonNegativeInteger(storylineState.evolutionCount),
    repetitionCount: normalizeNonNegativeInteger(storylineState.repetitionCount),
    repetitionStreak: normalizeNonNegativeInteger(storylineState.repetitionStreak),
    items,
  };
}

function compareActiveStorylineGroups(left, right) {
  return (
    new Date(resolveStorylineSortTimestamp(right)).getTime() -
      new Date(resolveStorylineSortTimestamp(left)).getTime() ||
    left.title.localeCompare(right.title) ||
    left.storylineId.localeCompare(right.storylineId)
  );
}

function resolveStorylineSortTimestamp(storyline) {
  return (
    storyline.updatedAt ??
    storyline.lastSeen ??
    storyline.lastEvolutionAt ??
    storyline.firstSeen
  );
}

function compareStorylineItems(left, right) {
  return (
    new Date(resolveItemTimelineTimestamp(left)).getTime() -
      new Date(resolveItemTimelineTimestamp(right)).getTime() ||
    new Date(resolveItemPublishedTimestamp(left)).getTime() -
      new Date(resolveItemPublishedTimestamp(right)).getTime() ||
    left.name.localeCompare(right.name) ||
    left.itemId.localeCompare(right.itemId)
  );
}

function resolveItemTimelineTimestamp(item) {
  return item.firstSeen ?? item.discoveredAt ?? item.publishedAt;
}

function resolveItemPublishedTimestamp(item) {
  return item.publishedAt ?? item.discoveredAt ?? item.firstSeen;
}

function normalizeNonNegativeInteger(value) {
  if (value == null) {
    return 0;
  }

  if (!Number.isFinite(value)) {
    throw new TypeError("storyline counters must be finite numbers");
  }

  return Math.max(0, Math.trunc(value));
}

function sortEditionsByPublishedAtDesc(left, right) {
  return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
}
