import { createPublicationStatus } from "./publication-status.js";
import { normalizeTimestamp } from "../core/contracts.js";
import { mergeCanonicalIdentifiers } from "../core/item-identity.js";
import { ItemResolutionService } from "../core/item-resolution.js";
import {
  DEFAULT_MIN_RELEVANCE_SCORE,
  DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  filterCuratedItemsByRelevance,
} from "../core/relevance-scoring.js";
import { createNormalizedItem } from "../core/schema.js";
import {
  DEFAULT_PUBLICATION_BASE_TIMEZONE,
  DEFAULT_PUBLICATION_SCHEDULE,
  NEWSLETTER_BASE_TIMEZONE_ENV_NAME,
  createPublicationSchedule,
  resolvePublicationScheduleFromRuntimeConfig,
} from "./publication-schedule.js";
import { createNewsletterRuntimeConfig } from "./runtime-config.js";
import { buildEditionExclusionSummary } from "./exclusion-summary.js";
import {
  createEditionExclusion,
  createRelevanceExclusion,
  normalizeExclusionReasonCode,
} from "./exclusion-analytics.js";
import {
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  createNewsletterScopeDefinition,
} from "./scope-definition.js";
import { buildStorylineMembershipSnapshot } from "./storyline.js";

export const DEFAULT_PUBLICATION_HOUR = DEFAULT_PUBLICATION_SCHEDULE.hour;
export const DEFAULT_PUBLICATION_TIMEZONE = DEFAULT_PUBLICATION_BASE_TIMEZONE;
export const PUBLICATION_TIMEZONE_ENV_NAME = NEWSLETTER_BASE_TIMEZONE_ENV_NAME;

const ZONED_DATE_TIME_FORMATTERS = new Map();

export function createPublicationConfig(env = process.env) {
  const publication = createNewsletterRuntimeConfig(env).publication;

  return Object.freeze({
    baseTimezone: publication.baseTimezone,
    publicationHour: publication.hour,
    publicationMinute: publication.minute,
    publicationCronExpression: publication.cronExpression,
  });
}

export function createPublicationPlan({
  now = new Date().toISOString(),
  schedule,
  timezone = DEFAULT_PUBLICATION_TIMEZONE,
  publicationHour = DEFAULT_PUBLICATION_HOUR,
  publicationMinute = 0,
} = {}) {
  const normalizedNow = normalizeTimestamp(now, "now");
  const normalizedSchedule = createPublicationSchedule(
    schedule ?? {
      timezone,
      hour: publicationHour,
      minute: publicationMinute,
    },
  );
  const nowDate = new Date(normalizedNow);
  const localNow = getZonedDateTimeParts(nowDate, normalizedSchedule.timezone);
  const publicationDate = hasReachedPublicationTime(localNow, normalizedSchedule)
    ? pickCalendarDate(localNow)
    : shiftCalendarDate(localNow, -1);
  const startsOn = shiftCalendarDate(publicationDate, -1);
  const publishedAt = zonedDateTimeToUtc(
    {
      ...publicationDate,
      hour: normalizedSchedule.hour,
      minute: normalizedSchedule.minute,
      second: 0,
    },
    normalizedSchedule.timezone,
  );

  return {
    publishedAt,
    window: {
      startsAt: zonedDateTimeToUtc(
        {
          ...startsOn,
          hour: normalizedSchedule.hour,
          minute: normalizedSchedule.minute,
          second: 0,
        },
        normalizedSchedule.timezone,
      ),
      endsAt: publishedAt,
      timezone: normalizedSchedule.timezone,
    },
  };
}

export function createPublicationFlow({
  pipeline,
  editionStore,
  sourceDiscoveryService = null,
  itemIdentityRepository = null,
  itemResolutionService = new ItemResolutionService(),
  scopeDefinition = CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  env = process.env,
  now = () => new Date().toISOString(),
  mode = "live",
} = {}) {
  if (!pipeline || typeof pipeline.aggregate !== "function") {
    throw new TypeError("pipeline must expose aggregate(window)");
  }

  if (!editionStore || typeof editionStore.publish !== "function") {
    throw new TypeError("editionStore must expose publish(edition)");
  }

  if (
    sourceDiscoveryService &&
    typeof sourceDiscoveryService.discoverFromItems !== "function"
  ) {
    throw new TypeError(
      "sourceDiscoveryService must expose discoverFromItems(items, options)",
    );
  }

  if (
    itemIdentityRepository &&
    (typeof itemIdentityRepository.loadTrackedItemStates !== "function" ||
      typeof itemIdentityRepository.recordEdition !== "function")
  ) {
    throw new TypeError(
      "itemIdentityRepository must expose loadTrackedItemStates(before) and recordEdition(edition)",
    );
  }

  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  if (!itemResolutionService || typeof itemResolutionService.resolve !== "function") {
    throw new TypeError("itemResolutionService must expose resolve(item, candidates)");
  }

  const normalizedScopeDefinition = createNewsletterScopeDefinition(
    scopeDefinition ?? CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  );

  return {
    getConfig() {
      return createNewsletterRuntimeConfig(env);
    },

    async publishEdition() {
      const runtimeSchedule = resolvePublicationScheduleFromRuntimeConfig(
        createNewsletterRuntimeConfig(env),
      );
      const publicationPlan = createPublicationPlan({
        now: resolveNow(now),
        schedule: runtimeSchedule,
      });
      const existingEdition = await loadPublishedEditionForPlan(
        editionStore,
        publicationPlan.publishedAt,
      );

      if (existingEdition) {
        return existingEdition;
      }

      const aggregated = await pipeline.aggregate(publicationPlan.window);
      const evaluatedItems = resolvePublicationEvaluatedItems(aggregated);
      const explicitExclusionRecords = resolvePublicationExclusionRecords(aggregated);
      const publicationOutcome = resolvePublicationExclusionDecisions({
        items: evaluatedItems,
        exclusionDecisions: explicitExclusionRecords,
        minRelevanceScore: resolvePublicationMinRelevanceScore(pipeline),
        publishedAt: publicationPlan.publishedAt,
        window: publicationPlan.window,
      });
      const publicationItems = publicationOutcome.items;
      const exclusionDecisions = publicationOutcome.decisions;
      const exclusions = publicationOutcome.persistedExclusions;

      if (sourceDiscoveryService) {
        await sourceDiscoveryService.discoverFromItems(
          aggregated.fetchedItems ?? aggregated.items ?? [],
          {
            now: publicationPlan.publishedAt,
            cycleId: buildPublicationCycleId(
              publicationPlan.publishedAt,
              runtimeSchedule.timezone,
            ),
            scoredItems: aggregated.scoredItems ?? publicationItems,
            discoveredSources: aggregated.discoveredSources ?? [],
          },
        );
      }

      const trackedItemStates = await loadTrackedItemStates(
        itemIdentityRepository,
        editionStore,
        publicationPlan.publishedAt,
      );
      const trackedStorylineStates = await loadTrackedStorylineStates(
        editionStore,
        publicationPlan.publishedAt,
      );
      const trackedItems = applyTrackedItemStates(
        publicationItems,
        trackedItemStates,
        publicationPlan.publishedAt,
        itemResolutionService,
        normalizedScopeDefinition.currentVersion,
      );
      const storylineSnapshot = buildStorylineMembershipSnapshot(
        trackedItems,
        trackedStorylineStates,
        publicationPlan.publishedAt,
        trackedItemStates,
      );
      const exclusionSummary = buildEditionExclusionSummary(
        exclusionDecisions.map((exclusion) => ({
          category: exclusion.category,
          reasonCode: exclusion.reason ?? exclusion.reasonCode,
          count: exclusion.count,
        })),
      );

      const publishedEdition = await editionStore.publish({
        publishedAt: publicationPlan.publishedAt,
        window: publicationPlan.window,
        items: storylineSnapshot.items,
        publication: createPublicationStatus(aggregated, resolveNow(now), mode),
        exclusionSummary,
        ...(exclusions.length > 0 ? { exclusions } : {}),
        ...(storylineSnapshot.storylines.length > 0
          ? { storylines: storylineSnapshot.storylines }
          : {}),
      });

      if (itemIdentityRepository) {
        await itemIdentityRepository.recordEdition(publishedEdition, {
          scopeVersion: normalizedScopeDefinition.currentVersion,
        });
      }

      return publishedEdition;
    },
  };
}

function hasReachedPublicationTime(localNow, schedule) {
  return (
    localNow.hour > schedule.hour ||
    (localNow.hour === schedule.hour &&
      (localNow.minute > schedule.minute ||
        (localNow.minute === schedule.minute && localNow.second >= 0)))
  );
}

async function loadPublishedEditionForPlan(editionStore, publishedAt) {
  if (!editionStore || typeof editionStore.loadLatest !== "function") {
    return null;
  }

  const latestEdition = await editionStore.loadLatest({ now: publishedAt });

  return latestEdition?.publishedAt === publishedAt ? latestEdition : null;
}

function zonedDateTimeToUtc(localDateTime, timezone) {
  let guess = new Date(
    Date.UTC(
      localDateTime.year,
      localDateTime.month - 1,
      localDateTime.day,
      localDateTime.hour,
      localDateTime.minute ?? 0,
      localDateTime.second ?? 0,
    ),
  );

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const actual = getZonedDateTimeParts(guess, timezone);
    const expectedMs = Date.UTC(
      localDateTime.year,
      localDateTime.month - 1,
      localDateTime.day,
      localDateTime.hour,
      localDateTime.minute ?? 0,
      localDateTime.second ?? 0,
    );
    const actualMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const diffMs = expectedMs - actualMs;

    if (diffMs === 0) {
      return guess.toISOString();
    }

    guess = new Date(guess.getTime() + diffMs);
  }

  throw new RangeError(`Unable to resolve publication window for timezone ${timezone}`);
}

function resolvePublicationMinRelevanceScore(pipeline) {
  if (typeof pipeline?.minRelevanceScore === "number" && Number.isFinite(pipeline.minRelevanceScore)) {
    return pipeline.minRelevanceScore;
  }

  return DEFAULT_MIN_RELEVANCE_SCORE;
}

function resolvePublicationEvaluatedItems(aggregated) {
  if (Array.isArray(aggregated?.scoredItems) && aggregated.scoredItems.length > 0) {
    return aggregated.scoredItems;
  }

  return Array.isArray(aggregated?.items) ? aggregated.items : [];
}

function resolvePublicationExclusionRecords(aggregated) {
  if (Array.isArray(aggregated?.exclusionRecords) && aggregated.exclusionRecords.length > 0) {
    return aggregated.exclusionRecords;
  }

  if (Array.isArray(aggregated?.exclusionDecisions) && aggregated.exclusionDecisions.length > 0) {
    return aggregated.exclusionDecisions;
  }

  return [];
}

function filterPublicationItems(items, minRelevanceScore) {
  return filterCuratedItemsByRelevance(
    Array.isArray(items) ? items : [],
    minRelevanceScore,
  );
}

function resolvePublicationExclusionDecisions({
  items,
  exclusionDecisions,
  minRelevanceScore,
  publishedAt,
  window,
}) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const itemLookup = new Map(
    normalizedItems
      .filter((item) => item?.itemId)
      .map((item) => [item.itemId, item]),
  );
  const summaryDecisions = (Array.isArray(exclusionDecisions) ? exclusionDecisions : [])
    .map((exclusion) =>
      normalizePublicationExclusionSummaryDecision(
        exclusion,
        itemLookup.get(exclusion?.itemId ?? exclusion?.itemIdentity?.itemId),
      ),
    )
    .filter(Boolean);
  const explicitExcludedItemIds = new Set(
    summaryDecisions.map((exclusion) => exclusion.itemId).filter(Boolean),
  );
  const persistedExclusions = (Array.isArray(exclusionDecisions) ? exclusionDecisions : [])
    .map((exclusion) =>
      hydratePublicationExclusionDecision(
        exclusion,
        itemLookup.get(exclusion?.itemId ?? exclusion?.itemIdentity?.itemId),
        {
          publishedAt,
          window,
        },
      ),
    )
    .filter(Boolean);
  const excludedItemIds = new Set([
    ...explicitExcludedItemIds,
    ...persistedExclusions.map((exclusion) => exclusion.itemId),
  ]);
  const publishedItems = filterPublicationItems(normalizedItems, minRelevanceScore).filter(
    (item) => !excludedItemIds.has(item?.itemId),
  );
  const keptItemIds = new Set(publishedItems.map((item) => item?.itemId).filter(Boolean));

  for (const item of normalizedItems) {
    if (!item?.itemId || keptItemIds.has(item.itemId)) {
      continue;
    }

    if (excludedItemIds.has(item.itemId)) {
      continue;
    }

    persistedExclusions.push(
      createRelevanceExclusion(item, {
        timestamp: publishedAt,
        minRelevanceScore,
        relevanceScore: item.relevanceScore ?? null,
        scoreVersion:
          item.scoreVersion ??
          item.metadata?.curation?.relevanceGate?.scoreVersion ??
          DEFAULT_RELEVANCE_SCORE_VERSION,
        scoreInterpretation:
          item.scoreInterpretation ??
          item.metadata?.curation?.relevanceGate?.scoreInterpretation ??
          DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
        scoreBreakdown:
          item.metadata?.curation?.relevanceGate?.scoreBreakdown ?? null,
        evaluationContext: {
          stage: "relevance_gate",
          window: {
            startsAt: window?.startsAt ?? null,
            endsAt: window?.endsAt ?? null,
            timezone: window?.timezone ?? null,
          },
          relevance: {
            minRelevanceScore,
            relevanceScore: item.relevanceScore ?? null,
            scoreVersion:
              item.scoreVersion ??
              item.metadata?.curation?.relevanceGate?.scoreVersion ??
              DEFAULT_RELEVANCE_SCORE_VERSION,
            scoreInterpretation:
              item.scoreInterpretation ??
              item.metadata?.curation?.relevanceGate?.scoreInterpretation ??
              DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
            scoreBreakdown:
              item.metadata?.curation?.relevanceGate?.scoreBreakdown ?? null,
          },
        },
        editionContext: buildPublicationEditionContext(publishedAt, window),
      }),
    );
    summaryDecisions.push({
      itemId: item.itemId,
      category: item.category,
      reasonCode: "relevance_below_threshold",
    });
  }

  return {
    items: publishedItems,
    decisions: summaryDecisions,
    persistedExclusions,
  };
}

function normalizePublicationExclusionSummaryDecision(exclusion, item) {
  if (!exclusion || typeof exclusion !== "object" || Array.isArray(exclusion)) {
    return null;
  }

  const itemId = exclusion.itemId ?? exclusion?.itemIdentity?.itemId ?? item?.itemId ?? null;
  const category = exclusion.category ?? item?.category ?? null;

  if (!itemId || !category) {
    return null;
  }

  try {
    const reasonCode = normalizeExclusionReasonCode(
      exclusion.reasonCode ??
        exclusion.reason ??
        exclusion.exclusionReasonCode,
      "exclusion.reasonCode",
    );

    return {
      itemId,
      category,
      reasonCode,
    };
  } catch {
    return null;
  }
}

function hydratePublicationExclusionDecision(exclusion, item, { publishedAt, window }) {
  if (!exclusion || typeof exclusion !== "object" || Array.isArray(exclusion)) {
    return null;
  }

  const itemId = exclusion.itemId ?? exclusion?.itemIdentity?.itemId ?? item?.itemId ?? null;

  if (!itemId) {
    return null;
  }

  const reasonCode = normalizeExclusionReasonCode(
    exclusion.reasonCode ??
      exclusion.reason ??
      exclusion.exclusionReasonCode ??
      (item ? "relevance_below_threshold" : null),
    "exclusion.reasonCode",
  );

  try {
    return createEditionExclusion({
      ...exclusion,
      itemId,
      name: exclusion.name ?? exclusion?.itemIdentity?.name ?? item?.name,
      sourceUrl:
        exclusion.sourceUrl ??
        exclusion?.itemIdentity?.sourceUrl ??
        item?.sourceUrl,
      sourceUrls:
        exclusion.sourceUrls ??
        exclusion?.itemIdentity?.sourceUrls ??
        item?.sourceUrls,
      category: exclusion.category ?? item?.category,
      sourceKinds: exclusion.sourceKinds ?? item?.sourceKinds,
      adapterIds: exclusion.adapterIds ?? item?.adapterIds,
      timestamp: exclusion.timestamp ?? publishedAt,
      evaluationContext:
        exclusion.evaluationContext ??
        exclusion.evaluation_context ??
        buildPublicationExclusionEvaluationContext({
          exclusion,
          item,
          reasonCode,
          window,
        }),
      editionContext:
        exclusion.editionContext ??
        exclusion.edition_context ??
        buildPublicationEditionContext(publishedAt, window),
      relevanceScore: exclusion.relevanceScore ?? item?.relevanceScore ?? null,
      scoreVersion:
        exclusion.scoreVersion ??
        item?.scoreVersion ??
        item?.metadata?.curation?.relevanceGate?.scoreVersion ??
        null,
      sourceAuthorityScore:
        exclusion.sourceAuthorityScore ?? item?.sourceAuthorityScore ?? null,
      itemIdentity:
        exclusion.itemIdentity ??
        buildPublicationExclusionItemIdentity(item, {
          itemId,
          name: exclusion.name ?? item?.name ?? null,
          sourceUrl: exclusion.sourceUrl ?? item?.sourceUrl ?? null,
          sourceUrls:
            exclusion.sourceUrls ??
            item?.sourceUrls ??
            (exclusion.sourceUrl ?? item?.sourceUrl ? [exclusion.sourceUrl ?? item?.sourceUrl] : []),
        }),
      reasonCode,
      exclusionReasonCode: reasonCode,
      reason: reasonCode,
    });
  } catch {
    return null;
  }
}

function buildPublicationExclusionItemIdentity(item, {
  itemId,
  name,
  sourceUrl,
  sourceUrls,
}) {
  if (!item && (!itemId || !name || !sourceUrl)) {
    return null;
  }

  return {
    id: item?.id ?? itemId,
    itemId,
    name: item?.name ?? name,
    sourceUrl: item?.sourceUrl ?? sourceUrl,
    sourceUrls:
      item?.sourceUrls ??
      sourceUrls ??
      (item?.sourceUrl ?? sourceUrl ? [item?.sourceUrl ?? sourceUrl] : []),
    canonicalIdentifiers: item?.canonicalIdentifiers ?? null,
  };
}

function buildPublicationEditionContext(publishedAt, window) {
  return {
    editionId: derivePublicationEditionId(publishedAt, window?.timezone ?? "UTC"),
    publishedAt,
    window: {
      startsAt: window?.startsAt ?? publishedAt,
      endsAt: window?.endsAt ?? publishedAt,
      timezone: window?.timezone ?? "UTC",
    },
  };
}

function buildPublicationExclusionEvaluationContext({
  exclusion,
  item,
  reasonCode,
  window,
}) {
  if (reasonCode === "out_of_scope") {
    return {
      stage: "scope_gate",
      window: createPublicationWindowSnapshot(window),
      scope: {
        scopeVersion: item?.scopeVersion ?? null,
        reasonCode,
      },
    };
  }

  if (reasonCode === "relevance_below_threshold") {
    return {
      stage: "relevance_gate",
      window: createPublicationWindowSnapshot(window),
      relevance: {
        minRelevanceScore: exclusion.minRelevanceScore ?? null,
        relevanceScore: exclusion.relevanceScore ?? item?.relevanceScore ?? null,
        scoreVersion:
          exclusion.scoreVersion ??
          item?.scoreVersion ??
          item?.metadata?.curation?.relevanceGate?.scoreVersion ??
          null,
      },
    };
  }

  return {
    stage: "source_gate",
    window: createPublicationWindowSnapshot(window),
    source: {
      sourceStatus: exclusion.sourceStatus ?? null,
      sourceLifecycleState: exclusion.sourceLifecycleState ?? null,
      minimumItemAuthorityScore: exclusion.minSourceAuthorityScore ?? null,
      sourceAuthorityScore:
        exclusion.sourceAuthorityScore ?? item?.sourceAuthorityScore ?? null,
    },
  };
}

function createPublicationWindowSnapshot(window) {
  return {
    startsAt: window?.startsAt ?? null,
    endsAt: window?.endsAt ?? null,
    timezone: window?.timezone ?? null,
  };
}

function derivePublicationEditionId(publishedAt, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const partMap = Object.fromEntries(
    formatter
      .formatToParts(new Date(normalizeTimestamp(publishedAt, "publishedAt")))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${partMap.year}-${partMap.month}-${partMap.day}`;
}

function getZonedDateTimeParts(date, timezone) {
  const formatter = getZonedDateTimeFormatter(timezone);
  const partMap = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(partMap.year),
    month: Number(partMap.month),
    day: Number(partMap.day),
    hour: Number(partMap.hour),
    minute: Number(partMap.minute),
    second: Number(partMap.second),
  };
}

function getZonedDateTimeFormatter(timezone) {
  if (!ZONED_DATE_TIME_FORMATTERS.has(timezone)) {
    ZONED_DATE_TIME_FORMATTERS.set(
      timezone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    );
  }

  return ZONED_DATE_TIME_FORMATTERS.get(timezone);
}

function pickCalendarDate(value) {
  return {
    year: value.year,
    month: value.month,
    day: value.day,
  };
}

function shiftCalendarDate(value, days) {
  const shifted = new Date(Date.UTC(value.year, value.month - 1, value.day + days));

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function resolveNow(now) {
  const value = now();

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function buildPublicationCycleId(timestamp, timezone) {
  const localDate = getZonedDateTimeParts(new Date(timestamp), timezone);

  return `${localDate.year}-${String(localDate.month).padStart(2, "0")}-${String(
    localDate.day,
  ).padStart(2, "0")}`;
}

async function loadTrackedItemStates(itemIdentityRepository, editionStore, publishedAt) {
  const trackedItemStates = new Map();

  if (typeof editionStore.loadTrackedItemStates === "function") {
    mergeTrackedItemStateMaps(
      trackedItemStates,
      await editionStore.loadTrackedItemStates({ before: publishedAt }),
    );
  }

  if (typeof itemIdentityRepository?.loadTrackedItemStates === "function") {
    mergeTrackedItemStateMaps(
      trackedItemStates,
      await itemIdentityRepository.loadTrackedItemStates({
        before: publishedAt,
      }),
    );
  }

  return trackedItemStates;
}

function mergeTrackedItemStateMaps(targetStates, nextStates) {
  if (!(nextStates instanceof Map) || nextStates.size === 0) {
    return targetStates;
  }

  for (const [itemId, nextState] of nextStates.entries()) {
    targetStates.set(
      itemId,
      mergeTrackedItemState(targetStates.get(itemId), nextState, itemId),
    );
  }

  return targetStates;
}

function mergeTrackedItemState(previousState, nextState, itemId) {
  const freshestState = pickFreshestTrackedItemState(previousState, nextState);

  if (!freshestState) {
    return null;
  }

  const fallbackState = freshestState === previousState ? nextState : previousState;
  const mergedState = {
    firstSeen: pickEarlierTimestamp(
      previousState?.firstSeen ?? null,
      nextState?.firstSeen ?? null,
    ),
    editionCount: Math.max(
      previousState?.editionCount ?? 0,
      nextState?.editionCount ?? 0,
    ),
    canonicalIdentifiers: mergeCanonicalIdentifiers(
      previousState?.canonicalIdentifiers ?? null,
      nextState?.canonicalIdentifiers ?? null,
    ),
    scopeVersion: freshestState.scopeVersion ?? fallbackState?.scopeVersion ?? null,
  };

  if (freshestState.storylineId ?? fallbackState?.storylineId) {
    mergedState.storylineId = freshestState.storylineId ?? fallbackState?.storylineId;
  }

  if (
    freshestState.storylineMemberPosition ??
    fallbackState?.storylineMemberPosition
  ) {
    mergedState.storylineMemberPosition =
      freshestState.storylineMemberPosition ??
      fallbackState?.storylineMemberPosition;
  }

  const mergedItemId = freshestState.itemId ?? fallbackState?.itemId ?? itemId ?? null;
  const mergedPublishedAt = freshestState.publishedAt ?? fallbackState?.publishedAt ?? null;
  const mergedItem = mergeTrackedStateItem(
    freshestState.item ?? null,
    fallbackState?.item ?? null,
    {
      itemId: mergedItemId,
      firstSeen: mergedState.firstSeen,
      editionCount: mergedState.editionCount,
      canonicalIdentifiers: mergedState.canonicalIdentifiers,
      scopeVersion: mergedState.scopeVersion,
    },
  );

  Object.defineProperties(mergedState, {
    itemId: {
      value: mergedItemId,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    id: {
      value:
        freshestState.id ??
        fallbackState?.id ??
        mergedItem?.id ??
        mergedItemId,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    item: {
      value: mergedItem,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    publishedAt: {
      value: mergedPublishedAt,
      enumerable: false,
      configurable: true,
      writable: true,
    },
  });

  return mergedState;
}

function pickFreshestTrackedItemState(left, right) {
  if (!left) {
    return right ?? null;
  }

  if (!right) {
    return left;
  }

  return compareTrackedItemStateFreshness(left, right) >= 0 ? left : right;
}

function mergeTrackedStateItem(preferredItem, fallbackItem, overrides) {
  const baseItem = preferredItem ?? fallbackItem;

  if (!baseItem) {
    return null;
  }

  return {
    ...(fallbackItem ?? {}),
    ...(preferredItem ?? {}),
    ...(overrides.itemId != null ? { itemId: overrides.itemId } : {}),
    ...(overrides.firstSeen != null ? { firstSeen: overrides.firstSeen } : {}),
    ...(overrides.editionCount != null ? { editionCount: overrides.editionCount } : {}),
    canonicalIdentifiers: overrides.canonicalIdentifiers ?? null,
    ...(overrides.scopeVersion != null ? { scopeVersion: overrides.scopeVersion } : {}),
  };
}

function compareTrackedItemStateFreshness(left, right) {
  const leftEditionCount = left?.editionCount ?? 0;
  const rightEditionCount = right?.editionCount ?? 0;

  if (leftEditionCount !== rightEditionCount) {
    return leftEditionCount - rightEditionCount;
  }

  return resolveTrackedItemStateTimestamp(left) - resolveTrackedItemStateTimestamp(right);
}

function resolveTrackedItemStateTimestamp(state) {
  const timestamps = [
    state?.item?.publishedAt,
    state?.item?.discoveredAt,
    state?.item?.firstSeen,
    state?.firstSeen,
  ]
    .filter(Boolean)
    .map((timestamp) => new Date(timestamp).getTime())
    .filter((value) => Number.isFinite(value));

  return timestamps.length === 0 ? 0 : Math.max(...timestamps);
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

async function loadTrackedStorylineStates(editionStore, publishedAt) {
  if (typeof editionStore.loadTrackedStorylineStates !== "function") {
    return new Map();
  }

  return editionStore.loadTrackedStorylineStates({ before: publishedAt });
}

function applyTrackedItemStates(
  items,
  trackedItemStates,
  publishedAt,
  itemResolutionService,
  currentScopeVersion,
) {
  return items.map((item) => {
    const resolvedItem = itemResolutionService.resolve(item, trackedItemStates);
    const trackedState = resolvedItem.matchedCandidate;

    return createNormalizedItem({
      ...item,
      id: resolvedItem.id,
      itemId: resolvedItem.itemId,
      canonicalIdentifiers: resolvedItem.canonicalIdentifiers,
      firstSeen: resolvedItem.firstSeen ?? item.firstSeen ?? publishedAt,
      editionCount: resolvedItem.editionCount,
      scopeVersion:
        normalizeScopeVersion(currentScopeVersion) ??
        resolvedItem.scopeVersion ??
        readItemScopeVersion(item),
      storylineId: item.storylineId ?? null,
      storylineMemberPosition: item.storylineMemberPosition ?? null,
      metadata: {
        ...(item.metadata ?? {}),
        storyline: {
          ...(item.metadata?.storyline ?? {}),
          previous_storyline_id:
            item.metadata?.storyline?.previous_storyline_id ??
            item.metadata?.storyline?.previousStorylineId ??
            trackedState?.storylineId ??
            null,
          previous_storyline_position:
            item.metadata?.storyline?.previous_storyline_position ??
            item.metadata?.storyline?.previousStorylinePosition ??
            trackedState?.storylineMemberPosition ??
            null,
        },
      },
    });
  });
}

function readItemScopeVersion(item) {
  return normalizeScopeVersion(
    item?.scopeVersion ??
      item?.scope_version ??
      item?.metadata?.scopeVersion ??
      item?.metadata?.scope_version ??
      item?.metadata?.scope?.version ??
      null,
  );
}

function normalizeScopeVersion(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
