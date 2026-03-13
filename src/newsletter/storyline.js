import {
  STORYLINE_STATUSES as STORYLINE_STATUS_VALUES,
  assertNonEmptyString,
  assertOneOf,
  normalizeComparableText,
  normalizeTimestamp,
  slugify,
  uniqueStrings,
} from "../core/contracts.js";
import { itemsShareIdentity, resolveDuplicateCategoryGroup } from "../core/item-identity.js";
import { createNormalizedItem } from "../core/schema.js";
import { classifyStorylineRelationship } from "../core/storyline-classifier.js";
import { advanceStorylineLifecycle } from "./storyline-lifecycle.js";

const STORYLINE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "announced",
  "announcing",
  "article",
  "blog",
  "breakdown",
  "deep",
  "dive",
  "for",
  "from",
  "guide",
  "how",
  "in",
  "introducing",
  "launch",
  "launched",
  "launches",
  "latest",
  "new",
  "notes",
  "of",
  "official",
  "on",
  "overview",
  "post",
  "review",
  "roundup",
  "setup",
  "the",
  "thread",
  "tips",
  "to",
  "update",
  "updates",
  "using",
  "with",
]);
const VERSION_TOKEN_PATTERN = /^(?:v?\d+(?:\.\d+)*|rc\d+|beta\d*|alpha\d*)$/iu;
const MAX_STORYLINE_TOKENS = 3;
const STORYLINE_MATCH_THRESHOLD = 0.82;
const STORYLINE_REFERENCE_MIN_TOKEN_COUNT = 2;
const STORYLINE_REFERENCE_MIN_SINGLE_TOKEN_LENGTH = 8;
const STORYLINE_ID_PREFIX = "storyline-";

export function createStoryline(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("storyline must be an object");
  }

  const storylineId = normalizeStorylineId(input, "storylineId");
  const memberItemIds = normalizeStorylineMemberItemIds(input);
  const parentStorylineIds = normalizeStorylineRelationIds(
    input.parentStorylineIds ?? input.parent_storyline_ids ?? [],
    "storyline.parentStorylineIds",
  );
  const childStorylineIds = normalizeStorylineRelationIds(
    input.childStorylineIds ?? input.child_storyline_ids ?? [],
    "storyline.childStorylineIds",
  );
  const mergedStorylineIds = normalizeStorylineRelationIds(
    input.mergedStorylineIds ?? input.merged_storyline_ids ?? [],
    "storyline.mergedStorylineIds",
  );
  const mergedIntoStorylineId = normalizeOptionalStorylineId(
    input.mergedIntoStorylineId ?? input.merged_into_storyline_id ?? null,
    "storyline.mergedIntoStorylineId",
  );
  const narrativeType = normalizeStorylineNarrativeType(
    input.narrativeType ?? input.narrative_type ?? null,
    "storyline.narrativeType",
  );
  const updatedAt = normalizeOptionalTimestamp(
    input.updatedAt ?? input.updated_at ?? null,
    "storyline.updatedAt",
  );
  const lastEvolutionAt = normalizeOptionalTimestamp(
    input.lastEvolutionAt ?? input.last_evolution_at ?? null,
    "storyline.lastEvolutionAt",
  );
  const evolutionCount = normalizeNonNegativeInteger(
    input.evolutionCount ?? input.evolution_count ?? null,
    0,
    "storyline.evolutionCount",
  );
  const repetitionCount = normalizeNonNegativeInteger(
    input.repetitionCount ?? input.repetition_count ?? null,
    0,
    "storyline.repetitionCount",
  );
  const repetitionStreak = normalizeNonNegativeInteger(
    input.repetitionStreak ?? input.repetition_streak ?? null,
    0,
    "storyline.repetitionStreak",
  );

  if (memberItemIds.length === 0) {
    throw new TypeError("storyline.memberItemIds must include at least one item id");
  }

  const storyline = {
    storylineId,
    title: assertNonEmptyString(input.title, "storyline.title"),
    memberItemIds,
    status: normalizeStorylineStatus(input.status ?? "developing", "storyline.status"),
  };

  if (parentStorylineIds.length > 0) {
    storyline.parentStorylineIds = parentStorylineIds;
  }

  if (childStorylineIds.length > 0) {
    storyline.childStorylineIds = childStorylineIds;
  }

  if (mergedStorylineIds.length > 0) {
    storyline.mergedStorylineIds = mergedStorylineIds;
  }

  if (mergedIntoStorylineId) {
    storyline.mergedIntoStorylineId = mergedIntoStorylineId;
  }

  if (narrativeType) {
    storyline.narrativeType = narrativeType;
  }

  if (updatedAt) {
    storyline.updatedAt = updatedAt;
  }

  if (lastEvolutionAt) {
    storyline.lastEvolutionAt = lastEvolutionAt;
  }

  if (evolutionCount > 0) {
    storyline.evolutionCount = evolutionCount;
  }

  if (repetitionCount > 0) {
    storyline.repetitionCount = repetitionCount;
  }

  if (repetitionStreak > 0) {
    storyline.repetitionStreak = repetitionStreak;
  }

  return storyline;
}

export function buildStorylineMembershipSnapshot(
  items,
  trackedStorylineStates = new Map(),
  publishedAt = new Date().toISOString(),
  trackedItemStates = new Map(),
) {
  const annotatedItems = applyStorylineMembership(
    items,
    trackedStorylineStates,
    publishedAt,
    trackedItemStates,
  );

  return {
    items: annotatedItems,
    storylines: buildEditionStorylines(annotatedItems, trackedStorylineStates),
  };
}

export function applyStorylineMembership(
  items,
  trackedStorylineStates = new Map(),
  publishedAt = new Date().toISOString(),
  trackedItemStates = new Map(),
) {
  if (!Array.isArray(items)) {
    throw new TypeError("items must be an array");
  }

  const normalizedPublishedAt = normalizeTimestamp(publishedAt, "publishedAt");
  const normalizedItems = items.map((item) => createNormalizedItem(item));
  const storylineStates = normalizeTrackedStorylineStateMap(trackedStorylineStates);
  const preexistingStorylineIds = new Set(storylineStates.keys());
  const assignments = new Map();
  const groupedAssignments = new Map();
  const relationshipAssignments = new Map();
  const orderedItems = normalizedItems
    .map((item, index) => ({
      index,
      item,
      eventTimestamp: resolveStorylineEventTimestamp(item, normalizedPublishedAt),
    }))
    .sort(compareStorylineAssignments);

  for (const { index, item, eventTimestamp } of orderedItems) {
    const metadata = readStorylineMetadata(item);
    const previousStorylineIds = resolvePreviousStorylineIds(
      item,
      storylineStates,
      trackedItemStates,
      metadata,
    );
    const storylineId = resolveAssignedStorylineId(
      item,
      storylineStates,
      trackedItemStates,
      metadata,
      previousStorylineIds,
    );
    const storylineState = getOrCreateStorylineState(storylineStates, storylineId, item);
    const wasKnownMember = storylineState.memberItemIds.includes(item.itemId);

    if (metadata.title) {
      storylineState.title = metadata.title;
    }

    mergeStorylineLineage(storylineState, metadata);

    if (metadata.narrativeType) {
      storylineState.narrativeType = metadata.narrativeType;
    }

    for (const memberItemId of metadata.memberItemIds) {
      appendChronologicalMember(storylineState, memberItemId, eventTimestamp);
    }

    const relationship = resolveStorylineRelationship(
      item,
      storylineState,
      trackedItemStates,
      metadata,
    );
    const contributesMembership = shouldRetainStorylineMembership({
      item,
      itemId: item.itemId,
      storylineState,
      metadata,
      relationship,
      wasKnownMember,
      trackedItemStates,
    });
    storylineState.firstSeen = pickEarlierTimestamp(storylineState.firstSeen, eventTimestamp);
    storylineState.lastSeen = pickLaterTimestamp(storylineState.lastSeen, eventTimestamp);

    if (contributesMembership) {
      appendChronologicalMember(storylineState, item.itemId, eventTimestamp);
    }

    appendStorylineAppearanceHistory(storylineState, {
      editionId: null,
      publishedAt: eventTimestamp,
      item,
    });
    assignments.set(item.itemId, storylineId);
    relationshipAssignments.set(index, relationship);
    const group = groupedAssignments.get(storylineId) ?? [];
    group.push({
      index,
      item,
      eventTimestamp,
      metadata,
      relationship,
      previousStorylineIds,
      wasKnownMember,
      contributesMembership,
    });
    groupedAssignments.set(storylineId, group);
  }

  for (const [storylineId, group] of groupedAssignments.entries()) {
    const storylineState = storylineStates.get(storylineId);
    const lifecycleDecision = reconcileStorylineRelationships(
      storylineState,
      group,
      storylineStates,
      trackedItemStates,
      normalizedPublishedAt,
      preexistingStorylineIds,
    );

    Object.assign(
      storylineState,
      advanceStorylineLifecycle(storylineState, {
        decision: lifecycleDecision ?? resolveEditionDecision(group),
        observedAt: normalizedPublishedAt,
      }),
    );
  }

  synchronizeStorylineGraph(storylineStates, {
    observedAt: normalizedPublishedAt,
  });

  return normalizedItems.map((item, index) => {
    const storylineId =
      assignments.get(item.itemId) ??
      resolveAssignedStorylineId(
        item,
        storylineStates,
        trackedItemStates,
        readStorylineMetadata(item),
      );
    const storylineState = getOrCreateStorylineState(storylineStates, storylineId, item);
    const memberIndex = storylineState.memberItemIds.indexOf(item.itemId);
    const storylineMemberPosition = memberIndex === -1 ? null : memberIndex + 1;
    const relationship =
      relationshipAssignments.get(index) ??
      resolveStorylineRelationship(
        item,
        storylineState,
        trackedItemStates,
        readStorylineMetadata(item),
      );

    return createNormalizedItem({
      ...item,
      storylineId,
      storylineMemberPosition,
      metadata: {
        ...(item.metadata ?? {}),
        storyline: {
          ...serializeStorylineMetadata(storylineState),
          position: storylineMemberPosition,
          relationship,
        },
      },
    });
  });
}

export function buildEditionStorylines(items, trackedStorylineStates = new Map()) {
  if (!Array.isArray(items)) {
    throw new TypeError("items must be an array");
  }

  const storylineStates = normalizeTrackedStorylineStateMap(trackedStorylineStates);
  const normalizedItems = items.map((item) => createNormalizedItem(item));
  const orderedItems = normalizedItems
    .map((item, index) => ({
      index,
      item,
      eventTimestamp: resolveStorylineEventTimestamp(
        item,
        item.publishedAt ?? item.discoveredAt ?? item.firstSeen,
      ),
    }))
    .sort(compareStorylineAssignments);

  for (const { item, eventTimestamp } of orderedItems) {
    const metadata = readStorylineMetadata(item);
    const storylineId =
      item.storylineId ??
      metadata.id ??
      resolveAssignedStorylineId(item, storylineStates, new Map(), metadata);
    const storylineState = getOrCreateStorylineState(storylineStates, storylineId, item);

    if (metadata.title) {
      storylineState.title = metadata.title;
    }

    if (metadata.status) {
      storylineState.status = metadata.status;
    }

    if (metadata.updatedAt || metadata.lastEvolutionAt) {
      storylineState.updatedAt = metadata.updatedAt;
      storylineState.lastEvolutionAt = metadata.lastEvolutionAt;
      storylineState.evolutionCount = metadata.evolutionCount;
      storylineState.repetitionCount = metadata.repetitionCount;
      storylineState.repetitionStreak = metadata.repetitionStreak;
    }

    mergeStorylineLineage(storylineState, metadata);

    if (metadata.narrativeType) {
      storylineState.narrativeType = metadata.narrativeType;
    }

    for (const memberItemId of metadata.memberItemIds) {
      appendChronologicalMember(storylineState, memberItemId, eventTimestamp);
    }

    const contributesMembership = shouldRetainStorylineMembership({
      item,
      itemId: item.itemId,
      storylineState,
      metadata,
      relationship: metadata.relationship ?? null,
      wasKnownMember: storylineState.memberItemIds.includes(item.itemId),
    });

    if (contributesMembership) {
      appendChronologicalMember(storylineState, item.itemId, eventTimestamp);
    }
  }

  synchronizeStorylineGraph(storylineStates);

  return [...storylineStates.values()]
    .filter((storylineState) => storylineState.memberItemIds.length > 0)
    .filter((storylineState) =>
      hasConsistentStorylineMembership(storylineState, normalizedItems),
    )
    .map((storylineState) =>
      createStoryline({
        storylineId: storylineState.id,
        title: storylineState.title,
        memberItemIds: storylineState.memberItemIds,
        status: storylineState.status,
        updatedAt: storylineState.updatedAt,
        lastEvolutionAt: storylineState.lastEvolutionAt,
        evolutionCount: storylineState.evolutionCount,
        repetitionCount: storylineState.repetitionCount,
        repetitionStreak: storylineState.repetitionStreak,
        parentStorylineIds: storylineState.parentStorylineIds,
        childStorylineIds: storylineState.childStorylineIds,
        mergedStorylineIds: storylineState.mergedStorylineIds,
        mergedIntoStorylineId: storylineState.mergedIntoStorylineId,
        narrativeType: storylineState.narrativeType,
      }),
    )
    .sort((left, right) => left.storylineId.localeCompare(right.storylineId));
}

export function buildTrackedStorylineStatesFromEditions(
  editions,
  { before = null } = {},
) {
  if (!Array.isArray(editions)) {
    throw new TypeError("editions must be an array");
  }

  const normalizedBefore = before == null ? null : normalizeTimestamp(before, "before");
  const cutoffMs =
    normalizedBefore == null
      ? Number.POSITIVE_INFINITY
      : new Date(normalizedBefore).getTime();
  const storylineStates = new Map();

  for (const edition of [...editions].sort(sortEditionsByPublishedAtAsc)) {
    const publishedAt = normalizeTimestamp(edition.publishedAt, "edition.publishedAt");

    if (new Date(publishedAt).getTime() >= cutoffMs) {
      continue;
    }

    for (const storyline of edition.storylines ?? []) {
      const normalizedStoryline = createStoryline(storyline);
      const existingState = storylineStates.get(normalizedStoryline.storylineId);

      storylineStates.set(
        normalizedStoryline.storylineId,
        normalizeTrackedStorylineState({
          id: normalizedStoryline.storylineId,
          title: normalizedStoryline.title,
          status: normalizedStoryline.status,
          memberItemIds: mergeTrackedStorylineMemberItemIds(
            existingState?.memberItemIds ?? [],
            normalizedStoryline.memberItemIds,
          ),
          firstSeen: existingState?.firstSeen ?? null,
          lastSeen: existingState?.lastSeen ?? null,
          updatedAt: normalizedStoryline.updatedAt ?? existingState?.updatedAt ?? null,
          lastEvolutionAt:
            normalizedStoryline.lastEvolutionAt ?? existingState?.lastEvolutionAt ?? null,
          evolutionCount:
            normalizedStoryline.evolutionCount ?? existingState?.evolutionCount ?? 0,
          repetitionCount:
            normalizedStoryline.repetitionCount ?? existingState?.repetitionCount ?? 0,
          repetitionStreak:
            normalizedStoryline.repetitionStreak ?? existingState?.repetitionStreak ?? 0,
          parentStorylineIds:
            normalizedStoryline.parentStorylineIds ??
            existingState?.parentStorylineIds ??
            [],
          childStorylineIds:
            normalizedStoryline.childStorylineIds ??
            existingState?.childStorylineIds ??
            [],
          mergedStorylineIds:
            normalizedStoryline.mergedStorylineIds ??
            existingState?.mergedStorylineIds ??
            [],
          mergedIntoStorylineId:
            normalizedStoryline.mergedIntoStorylineId ??
            existingState?.mergedIntoStorylineId ??
            null,
          narrativeType:
            normalizedStoryline.narrativeType ?? existingState?.narrativeType ?? null,
        }),
      );
    }

    const groupedAssignments = new Map();
    const orderedItems = [...(edition.items ?? [])]
      .map((item, index) => ({
        index,
        item: createNormalizedItem(item),
        eventTimestamp: resolveStorylineEventTimestamp(item, publishedAt),
      }))
      .sort(compareStorylineAssignments);

    for (const { item, eventTimestamp } of orderedItems) {
      const storylineId =
        item.storylineId ?? resolveStoredStorylineId(item) ?? resolveStorylineId(item);
      const storylineState = getOrCreateStorylineState(storylineStates, storylineId, item);
      const metadata = readStorylineMetadata(item);
      const wasKnownMember = storylineState.memberItemIds.includes(item.itemId);

      if (metadata.title) {
        storylineState.title = metadata.title;
      }

      if (metadata.status) {
        storylineState.status = metadata.status;
      }

      mergeStorylineLineage(storylineState, metadata);

      if (metadata.narrativeType) {
        storylineState.narrativeType = metadata.narrativeType;
      }

      storylineState.firstSeen = pickEarlierTimestamp(
        storylineState.firstSeen,
        metadata.firstSeen ?? eventTimestamp,
      );
      storylineState.lastSeen = pickLaterTimestamp(
        storylineState.lastSeen,
        metadata.lastSeen ?? eventTimestamp,
      );

      for (const memberItemId of metadata.memberItemIds) {
        appendChronologicalMember(storylineState, memberItemId, eventTimestamp);
      }

      const contributesMembership = shouldRetainStorylineMembership({
        item,
        itemId: item.itemId,
        storylineState,
        metadata,
        relationship: metadata.relationship ?? null,
        wasKnownMember,
      });

      if (contributesMembership) {
        appendChronologicalMember(storylineState, item.itemId, eventTimestamp);
      }

      appendStorylineAppearanceHistory(storylineState, {
        editionId: edition.id ?? null,
        publishedAt,
        item,
      });
      const group = groupedAssignments.get(storylineId) ?? [];
      group.push({
        item,
        eventTimestamp,
        metadata,
        wasKnownMember,
        contributesMembership,
      });
      groupedAssignments.set(storylineId, group);
    }

    for (const [storylineId, group] of groupedAssignments.entries()) {
      const storylineState = storylineStates.get(storylineId);
      const latestMetadata = group.at(-1)?.metadata ?? null;

      if (
        latestMetadata?.updatedAt != null ||
        latestMetadata?.lastEvolutionAt != null ||
        latestMetadata?.evolutionCount > 0 ||
        latestMetadata?.repetitionCount > 0 ||
        latestMetadata?.repetitionStreak > 0
      ) {
        storylineState.status = latestMetadata.status ?? storylineState.status;
        storylineState.updatedAt = latestMetadata.updatedAt;
        storylineState.lastEvolutionAt = latestMetadata.lastEvolutionAt;
        storylineState.evolutionCount = latestMetadata.evolutionCount;
        storylineState.repetitionCount = latestMetadata.repetitionCount;
        storylineState.repetitionStreak = latestMetadata.repetitionStreak;
        mergeStorylineLineage(storylineState, latestMetadata);
        storylineState.narrativeType =
          latestMetadata.narrativeType ?? storylineState.narrativeType ?? null;
        continue;
      }

      Object.assign(
        storylineState,
        advanceStorylineLifecycle(storylineState, {
          decision: resolveEditionDecision(group),
          observedAt: publishedAt,
        }),
      );
    }

    synchronizeStorylineGraph(storylineStates, {
      observedAt: publishedAt,
    });
  }

  return storylineStates;
}

export function resolveStorylineId(item) {
  const normalizedItem = createNormalizedItem(item);
  const anchorTokens = resolveStorylineAnchorTokens(normalizedItem);
  const categoryGroup = resolveDuplicateCategoryGroup(normalizedItem.category);
  const storylineSlug = slugify([categoryGroup, ...anchorTokens].join(" "));

  if (!storylineSlug) {
    throw new TypeError("Unable to derive a storyline id");
  }

  return `storyline-${storylineSlug}`;
}

function resolveAssignedStorylineId(
  item,
  storylineStates,
  trackedItemStates = new Map(),
  metadata = readStorylineMetadata(item),
  previousStorylineIds = resolvePreviousStorylineIds(
    item,
    storylineStates,
    trackedItemStates,
    metadata,
  ),
) {
  const explicitStorylineId = resolveCanonicalTrackedStorylineId(
    resolveExplicitStorylineId(item, metadata),
    storylineStates,
  );

  if (explicitStorylineId) {
    return explicitStorylineId;
  }

  const previousStorylineId = previousStorylineIds[0] ?? null;

  if (previousStorylineId) {
    if (hasDirectPreviousStorylineReference(item, trackedItemStates, metadata) && hasStorylineForkSignal(item)) {
      const derivedStorylineId = resolveStorylineId(item);

      if (derivedStorylineId !== previousStorylineId) {
        return derivedStorylineId;
      }
    }

    return previousStorylineId;
  }

  const matchedStorylineId = findMatchingStorylineId(item, storylineStates);

  if (matchedStorylineId) {
    return matchedStorylineId;
  }

  return resolveStorylineId(item);
}

function resolveExplicitStorylineId(item, metadata) {
  return item.storylineId ?? metadata.id ?? null;
}

function resolvePreviousStorylineIds(
  item,
  storylineStates,
  trackedItemStates = new Map(),
  metadata = readStorylineMetadata(item),
) {
  const candidates = [];

  if (metadata.previousStorylineId) {
    candidates.push(metadata.previousStorylineId);
  }

  const trackedItemState =
    trackedItemStates instanceof Map ? trackedItemStates.get(item.itemId) : null;

  if (trackedItemState?.storylineId) {
    candidates.push(trackedItemState.storylineId);
  }

  if (candidates.length === 0) {
    candidates.push(...findStorylineIdsByMember(item.itemId, storylineStates));
  }

  return uniqueStrings(
    candidates
      .map((storylineId) =>
        resolveCanonicalTrackedStorylineId(storylineId, storylineStates),
      )
      .filter(Boolean),
  );
}

function hasStorylineForkSignal(item) {
  return typeof item?.metadata?.topic === "string" && item.metadata.topic.trim().length > 0;
}

function hasDirectPreviousStorylineReference(
  item,
  trackedItemStates = new Map(),
  metadata = readStorylineMetadata(item),
) {
  if (metadata.previousStorylineId) {
    return true;
  }

  if (!(trackedItemStates instanceof Map)) {
    return false;
  }

  return Boolean(trackedItemStates.get(item.itemId)?.storylineId);
}

function resolveStorylineAnchorTokens(item) {
  const focusCandidates = [
    item.metadata?.topic,
    item.canonicalIdentifiers?.entityName,
    item.name,
    item.summary,
  ];

  for (const candidate of focusCandidates) {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      continue;
    }

    const tokens = tokenizeStorylineText(candidate);

    if (tokens.length > 0) {
      return tokens.slice(0, MAX_STORYLINE_TOKENS);
    }
  }

  return [resolveDuplicateCategoryGroup(item.category)];
}

function tokenizeStorylineText(value) {
  const normalized = normalizeComparableText(value);
  const tokens = normalized
    .split(/\s+/u)
    .filter(Boolean)
    .filter((token) => !STORYLINE_STOPWORDS.has(token))
    .filter((token) => !VERSION_TOKEN_PATTERN.test(token));

  return tokens.length > 0
    ? uniqueStrings(tokens)
    : normalized.split(/\s+/u).filter(Boolean).slice(0, MAX_STORYLINE_TOKENS);
}

function normalizeTrackedStorylineStateMap(trackedStorylineStates) {
  if (!(trackedStorylineStates instanceof Map) || trackedStorylineStates.size === 0) {
    return new Map();
  }

  const normalized = new Map();

  for (const [storylineId, storylineState] of trackedStorylineStates.entries()) {
    const id = normalizeStorylineId(storylineId ?? storylineState?.id, "storylineId");

    normalized.set(
      id,
      normalizeTrackedStorylineState({
        id,
        title: storylineState?.title ?? null,
        status: storylineState?.status ?? "developing",
        memberItemIds: storylineState?.memberItemIds ?? storylineState?.member_item_ids ?? [],
        firstSeen: storylineState?.firstSeen ?? storylineState?.first_seen ?? null,
        lastSeen: storylineState?.lastSeen ?? storylineState?.last_seen ?? null,
        updatedAt: storylineState?.updatedAt ?? storylineState?.updated_at ?? null,
        lastEvolutionAt:
          storylineState?.lastEvolutionAt ?? storylineState?.last_evolution_at ?? null,
        evolutionCount:
          storylineState?.evolutionCount ?? storylineState?.evolution_count ?? 0,
        repetitionCount:
          storylineState?.repetitionCount ?? storylineState?.repetition_count ?? 0,
        repetitionStreak:
          storylineState?.repetitionStreak ?? storylineState?.repetition_streak ?? 0,
        parentStorylineIds:
          storylineState?.parentStorylineIds ??
          storylineState?.parent_storyline_ids ??
          [],
        childStorylineIds:
          storylineState?.childStorylineIds ??
          storylineState?.child_storyline_ids ??
          [],
        mergedStorylineIds:
          storylineState?.mergedStorylineIds ??
          storylineState?.merged_storyline_ids ??
          [],
        mergedIntoStorylineId:
          storylineState?.mergedIntoStorylineId ??
          storylineState?.merged_into_storyline_id ??
          null,
        narrativeType:
          storylineState?.narrativeType ?? storylineState?.narrative_type ?? null,
        appearanceHistory:
          storylineState?.appearanceHistory ?? storylineState?.appearance_history ?? [],
      }),
    );
  }

  return normalized;
}

function normalizeTrackedStorylineState(state) {
  const updatedAt = state?.updatedAt ?? state?.updated_at ?? null;
  const lastEvolutionAt = state?.lastEvolutionAt ?? state?.last_evolution_at ?? null;
  const appearanceHistory = normalizeStorylineAppearanceHistory(
    state?.appearanceHistory ?? state?.appearance_history ?? [],
  );
  const normalizedState = {
    id: normalizeStorylineId(state, "storylineState.id"),
    title:
      state?.title == null ? null : assertNonEmptyString(state.title, "storylineState.title"),
    status: normalizeStorylineStatus(
      state?.status ?? "developing",
      "storylineState.status",
    ),
    memberItemIds: normalizeStorylineMemberItemIds(state),
    parentStorylineIds: normalizeStorylineRelationIds(
      state?.parentStorylineIds ?? state?.parent_storyline_ids ?? [],
      "storylineState.parentStorylineIds",
    ),
    childStorylineIds: normalizeStorylineRelationIds(
      state?.childStorylineIds ?? state?.child_storyline_ids ?? [],
      "storylineState.childStorylineIds",
    ),
    mergedStorylineIds: normalizeStorylineRelationIds(
      state?.mergedStorylineIds ?? state?.merged_storyline_ids ?? [],
      "storylineState.mergedStorylineIds",
    ),
    mergedIntoStorylineId: normalizeOptionalStorylineId(
      state?.mergedIntoStorylineId ?? state?.merged_into_storyline_id ?? null,
      "storylineState.mergedIntoStorylineId",
    ),
    narrativeType: normalizeStorylineNarrativeType(
      state?.narrativeType ?? state?.narrative_type ?? null,
      "storylineState.narrativeType",
    ),
    firstSeen:
      state?.firstSeen == null
        ? null
        : normalizeTimestamp(state.firstSeen, "storylineState.firstSeen"),
    lastSeen:
      state?.lastSeen == null
        ? null
        : normalizeTimestamp(state.lastSeen, "storylineState.lastSeen"),
  };

  Object.defineProperties(normalizedState, {
    updatedAt: {
      value: updatedAt == null ? null : normalizeTimestamp(updatedAt, "storylineState.updatedAt"),
      enumerable: false,
      configurable: true,
      writable: true,
    },
    lastEvolutionAt: {
      value:
        lastEvolutionAt == null
          ? null
          : normalizeTimestamp(lastEvolutionAt, "storylineState.lastEvolutionAt"),
      enumerable: false,
      configurable: true,
      writable: true,
    },
    evolutionCount: {
      value: normalizeNonNegativeInteger(
        state?.evolutionCount ?? state?.evolution_count,
        0,
        "storylineState.evolutionCount",
      ),
      enumerable: false,
      configurable: true,
      writable: true,
    },
    repetitionCount: {
      value: normalizeNonNegativeInteger(
        state?.repetitionCount ?? state?.repetition_count,
        0,
        "storylineState.repetitionCount",
      ),
      enumerable: false,
      configurable: true,
      writable: true,
    },
    repetitionStreak: {
      value: normalizeNonNegativeInteger(
        state?.repetitionStreak ?? state?.repetition_streak,
        0,
        "storylineState.repetitionStreak",
      ),
      enumerable: false,
      configurable: true,
      writable: true,
    },
    appearanceHistory: {
      value: appearanceHistory,
      enumerable: false,
      configurable: true,
      writable: true,
    },
  });

  return normalizedState;
}

function normalizeStorylineMemberItemIds(state) {
  const values = state?.memberItemIds ?? state?.member_item_ids ?? [];

  if (!Array.isArray(values)) {
    throw new TypeError("storylineState.memberItemIds must be an array");
  }

  return uniqueStrings(
    values.map((value) => assertNonEmptyString(value, "storylineState.memberItemIds[]")),
  );
}

function normalizeStorylineAppearanceHistory(values) {
  if (!Array.isArray(values)) {
    throw new TypeError("storylineState.appearanceHistory must be an array");
  }

  const appearanceKeys = new Set();
  const normalized = [];

  for (const value of values) {
    const appearance = createStorylineAppearance(value);
    const appearanceKey = buildStorylineAppearanceKey(appearance);

    if (appearanceKeys.has(appearanceKey)) {
      continue;
    }

    appearanceKeys.add(appearanceKey);
    normalized.push(appearance);
  }

  return normalized.sort(sortAppearancesByPublishedAtAsc);
}

function normalizeStorylineRelationIds(values, fieldName) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${fieldName} must be an array`);
  }

  return uniqueStrings(values.map((value) => assertNonEmptyString(value, `${fieldName}[]`)));
}

function normalizeOptionalStorylineId(value, fieldName) {
  if (value == null) {
    return null;
  }

  return normalizeStorylineId(value, fieldName);
}

function normalizeOptionalTimestamp(value, fieldName) {
  if (value == null) {
    return null;
  }

  return normalizeTimestamp(value, fieldName);
}

function normalizeStorylineNarrativeType(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return {
      key: assertNonEmptyString(value, `${fieldName}.key`),
    };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object when provided`);
  }

  const key = assertNonEmptyString(
    value.key ?? value.id ?? value.type ?? value.slug,
    `${fieldName}.key`,
  );
  const label =
    value.label == null ? null : assertNonEmptyString(value.label, `${fieldName}.label`);
  const metadata = normalizeStorylineNarrativeMetadata(
    value.metadata ?? null,
    `${fieldName}.metadata`,
  );

  return {
    key,
    ...(label ? { label } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeStorylineNarrativeMetadata(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object when provided`);
  }

  return { ...value };
}

function mergeStorylineLineage(storylineState, lineage) {
  if (!lineage || typeof lineage !== "object") {
    return;
  }

  for (const parentStorylineId of lineage.parentStorylineIds ?? []) {
    appendStorylineRelationId(
      storylineState.parentStorylineIds,
      parentStorylineId,
      storylineState.id,
    );
  }

  for (const childStorylineId of lineage.childStorylineIds ?? []) {
    appendStorylineRelationId(
      storylineState.childStorylineIds,
      childStorylineId,
      storylineState.id,
    );
  }

  for (const mergedStorylineId of lineage.mergedStorylineIds ?? []) {
    appendStorylineRelationId(
      storylineState.mergedStorylineIds,
      mergedStorylineId,
      storylineState.id,
    );
  }

  if (
    lineage.mergedIntoStorylineId &&
    lineage.mergedIntoStorylineId !== storylineState.id
  ) {
    storylineState.mergedIntoStorylineId = lineage.mergedIntoStorylineId;
  }

  if (lineage.narrativeType) {
    storylineState.narrativeType = lineage.narrativeType;
  }
}

function appendStorylineRelationId(target, candidate, ownStorylineId) {
  const normalizedCandidate = normalizeOptionalStorylineId(candidate, "storylineRelationId");

  if (!normalizedCandidate || normalizedCandidate === ownStorylineId) {
    return;
  }

  if (!target.includes(normalizedCandidate)) {
    target.push(normalizedCandidate);
  }
}

function reconcileStorylineRelationships(
  storylineState,
  group,
  storylineStates,
  trackedItemStates,
  observedAt,
  preexistingStorylineIds,
) {
  const sourceStorylineIds = uniqueStrings(
    group.flatMap((entry) => entry.previousStorylineIds ?? []).filter(Boolean),
  ).filter((storylineId) => storylineId !== storylineState.id);

  if (sourceStorylineIds.length === 0) {
    return null;
  }

  const targetWasPreexisting = preexistingStorylineIds.has(storylineState.id);
  const targetRetainsHistoricalMembership = group.some((entry) =>
    (entry.previousStorylineIds ?? []).includes(storylineState.id),
  );

  if (!targetWasPreexisting && !targetRetainsHistoricalMembership && sourceStorylineIds.length === 1) {
    const parentState = storylineStates.get(sourceStorylineIds[0]);

    if (parentState) {
      connectStorylineStates(parentState, storylineState);
    }

    return "fork";
  }

  for (const sourceStorylineId of sourceStorylineIds) {
    const sourceState = storylineStates.get(sourceStorylineId);

    if (!sourceState) {
      continue;
    }

    connectStorylineStates(sourceState, storylineState);
    appendStorylineRelationId(
      storylineState.mergedStorylineIds,
      sourceStorylineId,
      storylineState.id,
    );
    mergeStorylineMembersIntoTarget(storylineState, sourceState, trackedItemStates);
    sourceState.mergedIntoStorylineId = storylineState.id;
    applyMergedSourceLifecycle(sourceState, observedAt);
  }

  return "merge";
}

function synchronizeStorylineGraph(
  storylineStates,
  { observedAt = null, applyMergeLifecycle = observedAt != null } = {},
) {
  const normalizedObservedAt =
    observedAt == null ? null : normalizeTimestamp(observedAt, "observedAt");

  for (const storylineState of storylineStates.values()) {
    for (const parentStorylineId of storylineState.parentStorylineIds) {
      const parentState = storylineStates.get(parentStorylineId);

      if (parentState) {
        connectStorylineStates(parentState, storylineState);
      }
    }

    for (const childStorylineId of storylineState.childStorylineIds) {
      const childState = storylineStates.get(childStorylineId);

      if (childState) {
        connectStorylineStates(storylineState, childState);
      }
    }

    for (const mergedStorylineId of storylineState.mergedStorylineIds) {
      const mergedState = storylineStates.get(mergedStorylineId);

      if (!mergedState) {
        continue;
      }

      connectStorylineStates(mergedState, storylineState);
      mergeStorylineMembersIntoTarget(storylineState, mergedState, new Map());
      mergedState.mergedIntoStorylineId = storylineState.id;

      if (applyMergeLifecycle) {
        applyMergedSourceLifecycle(mergedState, normalizedObservedAt);
      }
    }

    if (storylineState.mergedIntoStorylineId) {
      const targetState = storylineStates.get(storylineState.mergedIntoStorylineId);

      if (!targetState) {
        continue;
      }

      connectStorylineStates(storylineState, targetState);
      appendStorylineRelationId(
        targetState.mergedStorylineIds,
        storylineState.id,
        targetState.id,
      );
      mergeStorylineMembersIntoTarget(targetState, storylineState, new Map());

      if (applyMergeLifecycle) {
        applyMergedSourceLifecycle(storylineState, normalizedObservedAt);
      }
    }
  }
}

function applyMergedSourceLifecycle(storylineState, observedAt) {
  if (
    storylineState.status === "archived" &&
    storylineState.mergedIntoStorylineId &&
    storylineState.updatedAt
  ) {
    return;
  }

  Object.assign(
    storylineState,
    advanceStorylineLifecycle(storylineState, {
      decision: "merge",
      mergeDisposition: "source",
      observedAt,
    }),
  );
}

function connectStorylineStates(parentState, childState) {
  appendStorylineRelationId(parentState.childStorylineIds, childState.id, parentState.id);
  appendStorylineRelationId(childState.parentStorylineIds, parentState.id, childState.id);
}

function mergeStorylineMembersIntoTarget(targetState, sourceState, trackedItemStates) {
  for (const memberItemId of sourceState.memberItemIds) {
    appendChronologicalMember(
      targetState,
      memberItemId,
      resolveTrackedStorylineMemberTimestamp(
        memberItemId,
        trackedItemStates,
        sourceState.firstSeen ?? sourceState.lastSeen ?? targetState.firstSeen,
      ),
    );
  }

  mergeStorylineAppearanceHistoryIntoTarget(targetState, sourceState);
  targetState.firstSeen = pickEarlierTimestamp(targetState.firstSeen, sourceState.firstSeen);
  targetState.lastSeen = pickLaterTimestamp(targetState.lastSeen, sourceState.lastSeen);
  sortStorylineMembersChronologically(targetState, trackedItemStates);
}

function mergeStorylineAppearanceHistoryIntoTarget(targetState, sourceState) {
  for (const appearance of sourceState.appearanceHistory ?? []) {
    appendStorylineAppearanceHistory(targetState, appearance);
  }
}

function sortStorylineMembersChronologically(storylineState, trackedItemStates) {
  storylineState.memberItemIds = [...storylineState.memberItemIds]
    .map((itemId, index) => ({
      itemId,
      index,
      timestamp: resolveTrackedStorylineMemberTimestamp(
        itemId,
        trackedItemStates,
        storylineState.lastSeen ?? storylineState.firstSeen,
      ),
    }))
    .sort((left, right) => {
      const timeDiff =
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();

      if (timeDiff !== 0) {
        return timeDiff;
      }

      return left.index - right.index || left.itemId.localeCompare(right.itemId);
    })
    .map((entry) => entry.itemId);
}

function resolveTrackedStorylineMemberTimestamp(
  itemId,
  trackedItemStates,
  fallbackTimestamp,
) {
  const trackedItemState =
    trackedItemStates instanceof Map ? trackedItemStates.get(itemId) : null;

  if (trackedItemState?.firstSeen) {
    return normalizeTimestamp(trackedItemState.firstSeen, "storylineMemberTimestamp");
  }

  if (trackedItemState?.item) {
    return resolveStorylineEventTimestamp(
      trackedItemState.item,
      fallbackTimestamp ??
        trackedItemState.item.firstSeen ??
        trackedItemState.item.discoveredAt ??
        trackedItemState.item.publishedAt,
    );
  }

  return normalizeTimestamp(
    fallbackTimestamp ?? new Date().toISOString(),
    "storylineMemberTimestamp",
  );
}

function getOrCreateStorylineState(storylineStates, storylineId, item) {
  const existingState = storylineStates.get(storylineId);

  if (existingState) {
    return existingState;
  }

  const nextState = normalizeTrackedStorylineState({
    id: storylineId,
    title: deriveStorylineTitle(item),
    status: "developing",
    memberItemIds: [],
    parentStorylineIds: [],
    childStorylineIds: [],
    mergedStorylineIds: [],
    mergedIntoStorylineId: null,
    narrativeType: null,
    firstSeen: item.firstSeen ?? item.discoveredAt ?? item.publishedAt ?? null,
    lastSeen: item.publishedAt ?? item.discoveredAt ?? item.firstSeen ?? null,
    updatedAt: null,
    lastEvolutionAt: null,
    evolutionCount: 0,
    repetitionCount: 0,
    repetitionStreak: 0,
    appearanceHistory: [],
  });

  storylineStates.set(storylineId, nextState);

  return nextState;
}

function resolveEditionDecision(group) {
  const decisions = group
    .map((entry) => entry.relationship?.decision ?? entry.metadata?.relationship?.decision ?? null)
    .filter(Boolean);

  if (decisions.includes("origin")) {
    return "origin";
  }

  if (decisions.includes("evolution")) {
    return "evolution";
  }

  if (decisions.includes("repetition")) {
    return "repetition";
  }

  if (group.some((entry) => !entry.wasKnownMember)) {
    return "evolution";
  }

  return "repetition";
}

function shouldRetainStorylineMembership({
  item,
  itemId,
  storylineState,
  metadata,
  relationship,
  wasKnownMember = false,
  trackedItemStates = new Map(),
}) {
  const normalizedItemId = assertNonEmptyString(itemId, "itemId");

  if (wasKnownMember) {
    return true;
  }

  if (storylineState?.memberItemIds?.includes(normalizedItemId)) {
    return true;
  }

  if (metadata?.memberItemIds?.includes(normalizedItemId)) {
    return true;
  }

  if ((metadata?.memberItemIds?.length ?? 0) > 0) {
    return false;
  }

  if (relationship?.decision !== "repetition") {
    return true;
  }

  if (metadata?.relationship?.decision === "repetition") {
    return false;
  }

  return !resolvePriorStorylineAppearances(item, storylineState, trackedItemStates).some(
    (appearance) => appearance?.item && itemsShareIdentity(item, appearance.item),
  );
}

function appendChronologicalMember(storylineState, itemId, eventTimestamp) {
  const normalizedItemId = assertNonEmptyString(itemId, "itemId");

  if (!storylineState.memberItemIds.includes(normalizedItemId)) {
    storylineState.memberItemIds.push(normalizedItemId);
  }

  storylineState.firstSeen = pickEarlierTimestamp(storylineState.firstSeen, eventTimestamp);
  storylineState.lastSeen = pickLaterTimestamp(storylineState.lastSeen, eventTimestamp);
}

function mergeTrackedStorylineMemberItemIds(existingMemberItemIds, nextMemberItemIds) {
  return uniqueStrings([
    ...normalizeStorylineMemberItemIds({ memberItemIds: existingMemberItemIds }),
    ...normalizeStorylineMemberItemIds({ memberItemIds: nextMemberItemIds }),
  ]);
}

function readStorylineMetadata(item) {
  const metadata = item?.metadata?.storyline;

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {
      id: null,
      previousStorylineId: null,
      title: null,
      status: null,
      memberItemIds: [],
      parentStorylineIds: [],
      childStorylineIds: [],
      mergedStorylineIds: [],
      mergedIntoStorylineId: null,
      narrativeType: null,
      firstSeen: null,
      lastSeen: null,
      updatedAt: null,
      lastEvolutionAt: null,
      evolutionCount: 0,
      repetitionCount: 0,
      repetitionStreak: 0,
      relationship: null,
    };
  }

  const firstSeen = metadata.first_seen ?? metadata.firstSeen ?? null;
  const lastSeen = metadata.last_seen ?? metadata.lastSeen ?? null;
  const updatedAt = metadata.updated_at ?? metadata.updatedAt ?? null;
  const lastEvolutionAt = metadata.last_evolution_at ?? metadata.lastEvolutionAt ?? null;

  return {
    id:
      metadata.storylineId == null &&
      metadata.storyline_id == null &&
      metadata.id == null
        ? null
        : normalizeStorylineId(metadata, "metadata.storyline.id"),
    previousStorylineId: normalizeOptionalStorylineId(
      metadata.previous_storyline_id ?? metadata.previousStorylineId ?? null,
      "metadata.storyline.previousStorylineId",
    ),
    title:
      metadata.title == null
        ? null
        : assertNonEmptyString(metadata.title, "metadata.storyline.title"),
    status:
      metadata.status == null
        ? null
        : normalizeStorylineStatus(metadata.status, "metadata.storyline.status"),
    memberItemIds: normalizeStorylineMemberItemIds(metadata),
    parentStorylineIds: normalizeStorylineRelationIds(
      metadata.parent_storyline_ids ?? metadata.parentStorylineIds ?? [],
      "metadata.storyline.parentStorylineIds",
    ),
    childStorylineIds: normalizeStorylineRelationIds(
      metadata.child_storyline_ids ?? metadata.childStorylineIds ?? [],
      "metadata.storyline.childStorylineIds",
    ),
    mergedStorylineIds: normalizeStorylineRelationIds(
      metadata.merged_storyline_ids ?? metadata.mergedStorylineIds ?? [],
      "metadata.storyline.mergedStorylineIds",
    ),
    mergedIntoStorylineId: normalizeOptionalStorylineId(
      metadata.merged_into_storyline_id ?? metadata.mergedIntoStorylineId ?? null,
      "metadata.storyline.mergedIntoStorylineId",
    ),
    narrativeType: normalizeStorylineNarrativeType(
      metadata.narrative_type ?? metadata.narrativeType ?? null,
      "metadata.storyline.narrativeType",
    ),
    firstSeen:
      firstSeen == null
        ? null
        : normalizeTimestamp(firstSeen, "metadata.storyline.firstSeen"),
    lastSeen:
      lastSeen == null
        ? null
        : normalizeTimestamp(lastSeen, "metadata.storyline.lastSeen"),
    updatedAt:
      updatedAt == null ? null : normalizeTimestamp(updatedAt, "metadata.storyline.updatedAt"),
    lastEvolutionAt:
      lastEvolutionAt == null
        ? null
        : normalizeTimestamp(lastEvolutionAt, "metadata.storyline.lastEvolutionAt"),
    evolutionCount: normalizeNonNegativeInteger(
      metadata.evolution_count ?? metadata.evolutionCount,
      0,
      "metadata.storyline.evolutionCount",
    ),
    repetitionCount: normalizeNonNegativeInteger(
      metadata.repetition_count ?? metadata.repetitionCount,
      0,
      "metadata.storyline.repetitionCount",
    ),
    repetitionStreak: normalizeNonNegativeInteger(
      metadata.repetition_streak ?? metadata.repetitionStreak,
      0,
      "metadata.storyline.repetitionStreak",
    ),
    relationship: metadata.relationship ?? null,
  };
}

function resolveStoredStorylineId(item) {
  return readStorylineMetadata(item).id;
}

function serializeStorylineMetadata(storylineState) {
  const serialized = {
    id: storylineState.id,
    storylineId: storylineState.id,
    storyline_id: storylineState.id,
    title: storylineState.title,
    status: storylineState.status,
    member_item_ids: [...storylineState.memberItemIds],
    first_seen: storylineState.firstSeen,
    last_seen: storylineState.lastSeen,
    updated_at: storylineState.updatedAt,
    last_evolution_at: storylineState.lastEvolutionAt,
    evolution_count: storylineState.evolutionCount,
    repetition_count: storylineState.repetitionCount,
    repetition_streak: storylineState.repetitionStreak,
  };

  if (storylineState.parentStorylineIds.length > 0) {
    serialized.parent_storyline_ids = [...storylineState.parentStorylineIds];
  }

  if (storylineState.childStorylineIds.length > 0) {
    serialized.child_storyline_ids = [...storylineState.childStorylineIds];
  }

  if (storylineState.mergedStorylineIds.length > 0) {
    serialized.merged_storyline_ids = [...storylineState.mergedStorylineIds];
  }

  if (storylineState.mergedIntoStorylineId) {
    serialized.merged_into_storyline_id = storylineState.mergedIntoStorylineId;
  }

  if (storylineState.narrativeType) {
    serialized.narrative_type = storylineState.narrativeType;
  }

  return serialized;
}

function resolveStorylineRelationship(
  item,
  storylineState,
  trackedItemStates,
  storylineMetadata,
) {
  const priorAppearances = resolvePriorStorylineAppearances(
    item,
    storylineState,
    trackedItemStates,
  );

  if (priorAppearances.length === 0) {
    return storylineMetadata.relationship ?? classifyStorylineRelationship(item, []);
  }

  return classifyStorylineRelationship(item, priorAppearances);
}

function resolvePriorStorylineAppearances(item, storylineState, trackedItemStates) {
  const appearanceKeys = new Set();
  const appearances = [];

  for (const appearance of storylineState?.appearanceHistory ?? []) {
    const appearanceKey = buildStorylineAppearanceKey(appearance);

    if (appearanceKeys.has(appearanceKey)) {
      continue;
    }

    appearanceKeys.add(appearanceKey);
    appearances.push(appearance);
  }

  if (!(trackedItemStates instanceof Map) || trackedItemStates.size === 0) {
    return appearances;
  }

  const trackedCandidates = [];
  const directTrackedItemState = trackedItemStates.get(item.itemId);

  if (directTrackedItemState?.item) {
    trackedCandidates.push(directTrackedItemState);
  }

  for (const memberItemId of storylineState.memberItemIds) {
    if (memberItemId === item.itemId) {
      continue;
    }

    const trackedItemState = trackedItemStates.get(memberItemId);

    if (trackedItemState?.item) {
      trackedCandidates.push(trackedItemState);
    }
  }

  for (const trackedItemState of trackedCandidates) {
    const appearance = createTrackedAppearance(trackedItemState);

    if (!appearance) {
      continue;
    }

    const appearanceKey = buildStorylineAppearanceKey(appearance);

    if (appearanceKeys.has(appearanceKey)) {
      continue;
    }

    appearanceKeys.add(appearanceKey);
    appearances.push(appearance);
  }

  return appearances;
}

function createTrackedAppearance(trackedItemState) {
  if (!trackedItemState?.item) {
    return null;
  }

  return createStorylineAppearance({
    editionId: null,
    publishedAt:
      trackedItemState.publishedAt ??
      trackedItemState.item.publishedAt ??
      trackedItemState.item.discoveredAt ??
      trackedItemState.item.firstSeen ??
      null,
    item: trackedItemState.item,
  });
}

function appendStorylineAppearanceHistory(storylineState, appearanceInput) {
  const appearance = createStorylineAppearance(appearanceInput);
  const appearanceKey = buildStorylineAppearanceKey(appearance);
  const appearanceHistory = storylineState.appearanceHistory ?? [];

  if (appearanceHistory.some((candidate) => buildStorylineAppearanceKey(candidate) === appearanceKey)) {
    return;
  }

  appearanceHistory.push(appearance);
  appearanceHistory.sort(sortAppearancesByPublishedAtAsc);
  storylineState.appearanceHistory = appearanceHistory;
}

function createStorylineAppearance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("storyline appearance must be an object");
  }

  const item = createNormalizedItem(value.item ?? value);
  const editionId = value.editionId ?? value.edition_id ?? null;
  const publishedAt =
    value.publishedAt ??
    value.published_at ??
    item.publishedAt ??
    item.discoveredAt ??
    item.firstSeen ??
    null;

  return {
    editionId:
      editionId == null ? null : assertNonEmptyString(editionId, "storylineAppearance.editionId"),
    publishedAt:
      publishedAt == null
        ? null
        : normalizeTimestamp(publishedAt, "storylineAppearance.publishedAt"),
    item,
  };
}

function buildStorylineAppearanceKey(appearance) {
  return [
    appearance?.item?.itemId ?? "",
    appearance?.publishedAt ?? "",
    appearance?.item?.sourceUrl ?? "",
  ].join("|");
}

function sortAppearancesByPublishedAtAsc(left, right) {
  return (
    new Date(left?.publishedAt ?? 0).getTime() - new Date(right?.publishedAt ?? 0).getTime()
  );
}

function normalizeStorylineId(value, fieldName) {
  const candidate = value?.storylineId ?? value?.storyline_id ?? value?.id ?? value;
  return assertNonEmptyString(candidate, fieldName);
}

function normalizeStorylineStatus(value, fieldName) {
  return assertOneOf(value, STORYLINE_STATUS_VALUES, fieldName);
}

function normalizeNonNegativeInteger(value, fallback, fieldName) {
  if (value == null) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${fieldName} must be a finite number when provided`);
  }

  return Math.max(0, Math.trunc(value));
}

function hasConsistentStorylineMembership(storylineState, items) {
  const linkedItems = items.filter((item) => item.storylineId === storylineState.id);

  if (linkedItems.length === 0) {
    return false;
  }

  return linkedItems.every((item) => {
    const memberIndex = storylineState.memberItemIds.indexOf(item.itemId);
    const decision = item.metadata?.storyline?.relationship?.decision ?? null;

    if (memberIndex === -1) {
      return decision === "repetition" && item.storylineMemberPosition == null;
    }

    if (item.storylineMemberPosition == null) {
      return true;
    }

    return memberIndex === item.storylineMemberPosition - 1;
  });
}

function deriveStorylineTitle(item) {
  return assertNonEmptyString(
    item?.name ?? item?.canonicalIdentifiers?.entityName ?? resolveStorylineId(item),
    "storylineTitle",
  );
}

function resolveStorylineEventTimestamp(item, fallbackTimestamp) {
  return normalizeTimestamp(
    item.publishedAt ?? item.discoveredAt ?? item.firstSeen ?? fallbackTimestamp,
    "storylineTimestamp",
  );
}

function findStorylineIdsByMember(itemId, storylineStates) {
  if (!(storylineStates instanceof Map) || storylineStates.size === 0) {
    return [];
  }

  const matchingStorylineIds = [];

  for (const [storylineId, storylineState] of storylineStates.entries()) {
    if (storylineState.memberItemIds.includes(itemId)) {
      matchingStorylineIds.push(storylineId);
    }
  }

  return matchingStorylineIds;
}

function findMatchingStorylineId(item, storylineStates) {
  if (!(storylineStates instanceof Map) || storylineStates.size === 0) {
    return null;
  }

  const derivedStorylineId = resolveStorylineId(item);

  if (storylineStates.has(derivedStorylineId)) {
    return resolveCanonicalTrackedStorylineId(derivedStorylineId, storylineStates);
  }

  const itemReferences = collectStorylineReferencesFromItem(item);

  if (itemReferences.length === 0) {
    return null;
  }

  let bestMatch = null;

  for (const storylineState of storylineStates.values()) {
    if (storylineState.mergedIntoStorylineId) {
      continue;
    }

    const storylineScore = scoreStorylineMatch(itemReferences, storylineState);

    if (storylineScore < STORYLINE_MATCH_THRESHOLD) {
      continue;
    }

    if (
      bestMatch == null ||
      isBetterStorylineMatch(
        {
          score: storylineScore,
          storylineState,
        },
        bestMatch,
      )
    ) {
      bestMatch = {
        score: storylineScore,
        storylineState,
      };
    }
  }

  return bestMatch?.storylineState?.id ?? null;
}

function resolveCanonicalTrackedStorylineId(storylineId, storylineStates) {
  const normalizedStorylineId = normalizeOptionalStorylineId(
    storylineId,
    "storylineId",
  );

  if (!normalizedStorylineId) {
    return null;
  }

  if (!(storylineStates instanceof Map) || storylineStates.size === 0) {
    return normalizedStorylineId;
  }

  const visitedStorylineIds = new Set();
  let currentStorylineId = normalizedStorylineId;

  while (!visitedStorylineIds.has(currentStorylineId)) {
    visitedStorylineIds.add(currentStorylineId);
    const storylineState = storylineStates.get(currentStorylineId);
    const nextStorylineId = storylineState?.mergedIntoStorylineId ?? null;

    if (!nextStorylineId || nextStorylineId === currentStorylineId) {
      return currentStorylineId;
    }

    currentStorylineId = nextStorylineId;
  }

  return currentStorylineId;
}

function collectStorylineReferencesFromItem(item) {
  return uniqueStrings(
    [
      item?.metadata?.topic,
      item?.canonicalIdentifiers?.entityName,
      item?.name,
    ].flatMap((candidate) => createStorylineReferences(candidate)),
  );
}

function collectStorylineReferencesFromState(storylineState) {
  return uniqueStrings(
    [storylineState?.title, decodeStorylineIdReference(storylineState?.id)].flatMap(
      (candidate) => createStorylineReferences(candidate),
    ),
  );
}

function createStorylineReferences(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  const tokens = tokenizeStorylineText(value);

  if (tokens.length === 0) {
    return [];
  }

  const references = [tokens.join(" ")];
  const maxPrefixLength = Math.min(MAX_STORYLINE_TOKENS, tokens.length);

  for (
    let prefixLength = STORYLINE_REFERENCE_MIN_TOKEN_COUNT;
    prefixLength <= maxPrefixLength;
    prefixLength += 1
  ) {
    references.push(tokens.slice(0, prefixLength).join(" "));
  }

  if (tokens[0].length >= STORYLINE_REFERENCE_MIN_SINGLE_TOKEN_LENGTH) {
    references.push(tokens[0]);
  }

  return uniqueStrings(references).filter(isEligibleStorylineReference);
}

function isEligibleStorylineReference(reference) {
  const tokens = String(reference ?? "")
    .split(" ")
    .filter(Boolean);

  if (tokens.length >= STORYLINE_REFERENCE_MIN_TOKEN_COUNT) {
    return true;
  }

  return tokens.some((token) => token.length >= STORYLINE_REFERENCE_MIN_SINGLE_TOKEN_LENGTH);
}

function decodeStorylineIdReference(storylineId) {
  if (typeof storylineId !== "string" || storylineId.trim().length === 0) {
    return null;
  }

  const trimmedValue = storylineId.trim();
  const withoutPrefix = trimmedValue.startsWith(STORYLINE_ID_PREFIX)
    ? trimmedValue.slice(STORYLINE_ID_PREFIX.length)
    : trimmedValue;
  const withoutCategoryPrefix = withoutPrefix.replace(/^(artifact|technique)-/u, "");

  return withoutCategoryPrefix.replace(/-/gu, " ");
}

function scoreStorylineMatch(itemReferences, storylineState) {
  const storylineReferences = collectStorylineReferencesFromState(storylineState);

  if (storylineReferences.length === 0) {
    return 0;
  }

  let bestScore = 0;

  for (const itemReference of itemReferences) {
    for (const storylineReference of storylineReferences) {
      bestScore = Math.max(
        bestScore,
        scoreStorylineReferenceMatch(itemReference, storylineReference),
      );

      if (bestScore === 1) {
        return bestScore;
      }
    }
  }

  return bestScore;
}

function scoreStorylineReferenceMatch(leftReference, rightReference) {
  if (leftReference === rightReference) {
    return 1;
  }

  if (
    leftReference.startsWith(`${rightReference} `) ||
    rightReference.startsWith(`${leftReference} `)
  ) {
    return 0.96;
  }

  if (leftReference.includes(rightReference) || rightReference.includes(leftReference)) {
    return 0.92;
  }

  const leftTokens = leftReference.split(" ").filter(Boolean);
  const rightTokens = rightReference.split(" ").filter(Boolean);
  const overlapCount = countSharedTokens(leftTokens, rightTokens);
  const overlapRatio = calculateTokenOverlapRatio(leftTokens, rightTokens, overlapCount);

  if (overlapCount >= 2 && overlapRatio >= 0.8) {
    return 0.9;
  }

  if (overlapCount >= 2 && overlapRatio >= 2 / 3) {
    return 0.82;
  }

  return 0;
}

function countSharedTokens(leftTokens, rightTokens) {
  const rightTokenSet = new Set(rightTokens);
  let overlapCount = 0;

  for (const token of new Set(leftTokens)) {
    if (rightTokenSet.has(token)) {
      overlapCount += 1;
    }
  }

  return overlapCount;
}

function calculateTokenOverlapRatio(leftTokens, rightTokens, overlapCount) {
  const leftSize = new Set(leftTokens).size;
  const rightSize = new Set(rightTokens).size;

  if (leftSize === 0 || rightSize === 0) {
    return 0;
  }

  return (overlapCount * 2) / (leftSize + rightSize);
}

function isBetterStorylineMatch(left, right) {
  if (left.score !== right.score) {
    return left.score > right.score;
  }

  const leftTimestamp = resolveStorylineMatchTimestamp(left.storylineState);
  const rightTimestamp = resolveStorylineMatchTimestamp(right.storylineState);

  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp > rightTimestamp;
  }

  const leftMemberCount = left.storylineState.memberItemIds.length;
  const rightMemberCount = right.storylineState.memberItemIds.length;

  if (leftMemberCount !== rightMemberCount) {
    return leftMemberCount > rightMemberCount;
  }

  return left.storylineState.id.localeCompare(right.storylineState.id) < 0;
}

function resolveStorylineMatchTimestamp(storylineState) {
  const timestamp =
    storylineState?.lastSeen ??
    storylineState?.updatedAt ??
    storylineState?.lastEvolutionAt ??
    storylineState?.firstSeen ??
    null;

  if (timestamp == null) {
    return 0;
  }

  return new Date(timestamp).getTime();
}

function compareStorylineAssignments(left, right) {
  const timeDiff =
    new Date(left.eventTimestamp).getTime() - new Date(right.eventTimestamp).getTime();

  if (timeDiff !== 0) {
    return timeDiff;
  }

  return left.index - right.index || left.item.itemId.localeCompare(right.item.itemId);
}

function sortEditionsByPublishedAtAsc(left, right) {
  return new Date(left.publishedAt).getTime() - new Date(right.publishedAt).getTime();
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

function pickLaterTimestamp(left, right) {
  if (left == null) {
    return right ?? null;
  }

  if (right == null) {
    return left;
  }

  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}
