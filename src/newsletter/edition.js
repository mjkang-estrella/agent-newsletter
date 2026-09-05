import {
  CONTENT_CATEGORIES,
  DISAGREEMENT_DIMENSIONS,
  STORYLINE_STATUSES,
  assertNonEmptyString,
  normalizeTimestamp,
  RISK_SEVERITIES,
  RISK_WARNING_DIMENSIONS,
  SCORE_INTERPRETATIONS,
  SENTIMENT_SPREADS,
  uniqueStrings,
} from "../core/contracts.js";
import { hasHighSentimentDivergence } from "../core/relevance-scoring.js";
import { createNormalizedItem } from "../core/schema.js";
import {
  NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  NEWSLETTER_ITEM_RESPONSE_SCHEMA,
} from "./item-response-schema.js";
import { createNewsletterEdition } from "./schema.js";
import { CURRENT_NEWSLETTER_SCOPE_DEFINITION } from "./scope-definition.js";

export { createNewsletterEdition } from "./schema.js";
export {
  NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  NEWSLETTER_ITEM_RESPONSE_SCHEMA,
  NEWSLETTER_ITEM_RESPONSE_SCHEMA_VERSION,
  REQUIRED_NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  SUPPLEMENTAL_NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
} from "./item-response-schema.js";
const DEFAULT_RISK_WARNING_DESCRIPTION = "Risk review pending.";

export function serializeNewsletterEdition(edition, options = {}) {
  const normalizedEdition = createNewsletterEdition(edition);
  const storylineContexts = resolveNewsletterEditionStorylineContexts(normalizedEdition);
  const storylineLookup = new Map(
    storylineContexts.map((storyline) => [storyline.storylineId, storyline]),
  );

  return {
    ...(normalizedEdition.publication ? { publication: normalizedEdition.publication } : {}),
    edition_id: normalizedEdition.id,
    published_at: normalizedEdition.publishedAt,
    content_window: {
      starts_at: normalizedEdition.window.startsAt,
      ends_at: normalizedEdition.window.endsAt,
      timezone: normalizedEdition.window.timezone,
    },
    item_count: normalizedEdition.items.length,
    items: normalizedEdition.items.map((item) =>
      serializeNewsletterItem(item, {
        ...options,
        storylineLookup,
        collectedAt: normalizedEdition.publication?.collected_at ?? null,
      }),
    ),
    storyline_count: storylineContexts.length,
    storylines: storylineContexts.map((storyline) =>
      serializeNewsletterStorylineGroup(storyline, options),
    ),
  };
}

export const formatNewsletterEditionResponse = serializeNewsletterEdition;

/**
 * Serialize a curated item into the public newsletter API contract.
 *
 * @returns {{
 *   item_id: string,
 *   name: string,
 *   source_urls: string[],
 *   category: import("../core/contracts.js").ContentCategory,
 *   summary: string,
 *   integration_hint: string,
 *   relevance_score: number,
 *   score_version: string,
 *   score_interpretation: import("../core/contracts.js").ScoreInterpretation,
 *   divergence_flag: boolean,
 *   risk_warning: {
 *     security: {
 *       severity: import("../core/contracts.js").RiskSeverity,
 *       description: string,
 *     },
 *     maturity: {
 *       severity: import("../core/contracts.js").RiskSeverity,
 *       description: string,
 *     },
 *     adoption_complexity: {
 *       severity: import("../core/contracts.js").RiskSeverity,
 *       description: string,
 *     },
 *   },
 *   mention_count: number,
 *   sentiment_spread: {
 *     classification: import("../core/contracts.js").SentimentSpreadClassification,
 *     disagreement_dimension?: import("../core/contracts.js").DisagreementDimension,
 *   },
 *   first_seen: string,
 *   edition_count: number,
 *   storyline_ids: string[],
 *   storyline: ReturnType<typeof serializeLifecycleAppearanceStoryline> | null,
 *   scope_version: string,
 * }}
 */
export function serializeNewsletterItem(
  item,
  {
    scopeVersionFallback = CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
    storylineLookup = null,
    primaryStoryline = null,
    collectedAt = null,
  } = {},
) {
  const normalizedItem = createNormalizedItem(item);

  if (normalizedItem.relevanceScore == null) {
    throw new TypeError("relevanceScore is required for published newsletter items");
  }

  if (normalizedItem.scoreVersion == null) {
    throw new TypeError("scoreVersion is required for published newsletter items");
  }

  if (normalizedItem.scoreInterpretation == null) {
    throw new TypeError("scoreInterpretation is required for published newsletter items");
  }

  return assertNewsletterItemApiResponse({
    evidence: {
      source_published_at: normalizedItem.metadata?.github ? null : normalizedItem.publishedAt ?? null,
      source_activity_at: normalizedItem.metadata?.github ? normalizedItem.publishedAt ?? null : null,
      collected_at: normalizedItem.metadata?.fetchedAt ?? collectedAt,
      novelty_reason: normalizedItem.metadata?.storyline?.relationship?.explanation ?? "First observed in this publication history; upstream novelty is unverified.",
      uncertainty: "Source claims and integration instructions are unverified. Review linked sources before adopting.",
    },
    item_id: normalizedItem.itemId,
    name: normalizedItem.name,
    source_urls: [...normalizedItem.sourceUrls],
    category: normalizedItem.category,
    summary: normalizedItem.summary,
    integration_hint: normalizedItem.integrationHint,
    relevance_score: normalizedItem.relevanceScore,
    score_version: normalizedItem.scoreVersion,
    score_interpretation: normalizedItem.scoreInterpretation,
    divergence_flag: resolveItemDivergenceFlag(normalizedItem),
    risk_warning: serializeRiskWarning(normalizedItem.riskWarning),
    mention_count: normalizedItem.mentionCount,
    sentiment_spread: serializeSentimentSpread(normalizedItem.sentimentSpread),
    first_seen: normalizedItem.firstSeen,
    edition_count: normalizedItem.editionCount,
    storyline_ids: resolveNewsletterItemStorylineIds(normalizedItem),
    storyline: resolveNewsletterItemStorylineState(normalizedItem, {
      storylineLookup,
      primaryStoryline,
    }),
    scope_version: resolveNewsletterItemScopeVersion(
      normalizedItem.scopeVersion,
      scopeVersionFallback,
    ),
  });
}

export const formatNewsletterItemResponse = serializeNewsletterItem;

export function serializeNewsletterItemLifecycle(lifecycle, options = {}) {
  const itemId = String(lifecycle?.itemId ?? "").trim();

  if (itemId.length === 0) {
    throw new TypeError("itemLifecycle.itemId is required");
  }

  if (!Array.isArray(lifecycle?.appearances) || lifecycle.appearances.length === 0) {
    throw new TypeError("itemLifecycle.appearances must be a non-empty array");
  }

  const serializedAppearances = lifecycle.appearances.map((appearance) =>
    serializeNewsletterItemAppearance(appearance, options),
  );

  return {
    item_id: itemId,
    first_seen: normalizeTimestamp(lifecycle.firstSeen, "itemLifecycle.firstSeen"),
    edition_count: normalizeEditionCount(lifecycle.editionCount),
    first_appearance: serializeLifecycleOccurrenceSummary(
      lifecycle?.firstAppearance ?? lifecycle?.first_appearance ?? null,
      serializedAppearances[0],
      1,
    ),
    repeat_appearances: serializeLifecycleOccurrenceSummaryList(
      lifecycle?.repeatAppearances ?? lifecycle?.repeat_appearances ?? null,
      serializedAppearances.slice(1),
    ),
    score_evolution: serializeLifecycleScoreEvolution(
      lifecycle?.scoreEvolution ?? lifecycle?.score_evolution ?? null,
      serializedAppearances,
    ),
    storyline: serializeLifecycleStorylineSummary(lifecycle.storyline, itemId),
    storyline_membership: serializeLifecycleStorylineMembership(
      lifecycle?.storylineMembership ?? lifecycle?.storyline_membership ?? null,
      serializedAppearances,
    ),
    appearances: serializedAppearances,
  };
}

export const formatNewsletterItemLifecycleResponse = serializeNewsletterItemLifecycle;

export function serializeNewsletterStorylineGroup(storyline, options = {}) {
  const items = normalizeStorylineItems(storyline?.items);
  const memberItemIds = normalizeStringList(
    storyline?.memberItemIds ?? storyline?.member_item_ids ?? items.map((item) => item.itemId),
    "storyline.memberItemIds",
  );
  const parentStorylineIds = normalizeOptionalStringList(
    storyline?.parentStorylineIds ?? storyline?.parent_storyline_ids ?? [],
    "storyline.parentStorylineIds",
  );
  const childStorylineIds = normalizeOptionalStringList(
    storyline?.childStorylineIds ?? storyline?.child_storyline_ids ?? [],
    "storyline.childStorylineIds",
  );
  const mergedStorylineIds = normalizeOptionalStringList(
    storyline?.mergedStorylineIds ?? storyline?.merged_storyline_ids ?? [],
    "storyline.mergedStorylineIds",
  );
  const mergedIntoStorylineId = normalizeOptionalString(
    storyline?.mergedIntoStorylineId ?? storyline?.merged_into_storyline_id ?? null,
  );
  const narrativeType = normalizeOptionalNarrativeType(
    storyline?.narrativeType ?? storyline?.narrative_type ?? null,
    "storyline.narrativeType",
  );
  const primaryStorylineContext = {
    storylineId:
      storyline?.storylineId ?? storyline?.storyline_id,
    title: storyline?.title,
    status: storyline?.status,
    memberItemIds,
    ...(parentStorylineIds.length > 0 ? { parentStorylineIds } : {}),
    ...(childStorylineIds.length > 0 ? { childStorylineIds } : {}),
    ...(mergedStorylineIds.length > 0 ? { mergedStorylineIds } : {}),
    ...(mergedIntoStorylineId ? { mergedIntoStorylineId } : {}),
    ...(narrativeType ? { narrativeType } : {}),
  };
  const relationshipMetadata = serializeStorylineRelationshipMetadata({
    parentStorylineIds,
    childStorylineIds,
    mergedStorylineIds,
    mergedIntoStorylineId,
  });

  return {
    storyline_id: assertNonEmptyString(
      storyline?.storylineId ?? storyline?.storyline_id,
      "storyline.storylineId",
    ),
    title: assertNonEmptyString(storyline?.title, "storyline.title"),
    member_item_ids: memberItemIds,
    status: normalizeStorylineStatus(storyline?.status),
    relationship_metadata: relationshipMetadata,
    ...(parentStorylineIds.length > 0
      ? { parent_storyline_ids: parentStorylineIds }
      : {}),
    ...(childStorylineIds.length > 0
      ? { child_storyline_ids: childStorylineIds }
      : {}),
    ...(mergedStorylineIds.length > 0
      ? { merged_storyline_ids: mergedStorylineIds }
      : {}),
    ...(mergedIntoStorylineId ? { merged_into_storyline_id: mergedIntoStorylineId } : {}),
    ...(narrativeType ? { narrative_type: narrativeType } : {}),
    first_seen: normalizeTimestamp(
      storyline?.firstSeen ?? storyline?.first_seen,
      "storyline.firstSeen",
    ),
    last_seen: normalizeTimestamp(
      storyline?.lastSeen ?? storyline?.last_seen,
      "storyline.lastSeen",
    ),
    updated_at: normalizeTimestamp(
      storyline?.updatedAt ?? storyline?.updated_at,
      "storyline.updatedAt",
    ),
    last_evolution_at: normalizeTimestamp(
      storyline?.lastEvolutionAt ?? storyline?.last_evolution_at,
      "storyline.lastEvolutionAt",
    ),
    evolution_count: validateNonNegativeInteger(
      storyline?.evolutionCount ?? storyline?.evolution_count,
      "storyline.evolutionCount",
    ),
    repetition_count: validateNonNegativeInteger(
      storyline?.repetitionCount ?? storyline?.repetition_count,
      "storyline.repetitionCount",
    ),
    repetition_streak: validateNonNegativeInteger(
      storyline?.repetitionStreak ?? storyline?.repetition_streak,
      "storyline.repetitionStreak",
    ),
    item_count: items.length,
    items: items.map((item) =>
      serializeNewsletterItem(item, {
        ...options,
        primaryStoryline: primaryStorylineContext,
      }),
    ),
  };
}

export function formatNewsletterStorylinesResponse({
  generatedAt,
  storylines,
  scopeVersionFallback,
}) {
  const normalizedStorylines = normalizeStorylineList(storylines);

  return {
    generated_at: normalizeTimestamp(generatedAt, "generatedAt"),
    storyline_count: normalizedStorylines.length,
    storylines: normalizedStorylines.map((storyline) =>
      serializeNewsletterStorylineGroup(storyline, { scopeVersionFallback }),
    ),
  };
}

export function formatNewsletterArchiveResponse({
  archiveWindowDays,
  generatedAt,
  editions,
  scopeVersionFallback,
}) {
  return {
    archive_window_days: normalizeArchiveWindowDays(archiveWindowDays),
    generated_at: normalizeTimestamp(generatedAt, "generatedAt"),
    editions: normalizeEditionList(editions).map((edition) =>
      formatNewsletterEditionResponse(edition, { scopeVersionFallback }),
    ),
  };
}

function resolveNewsletterEditionStorylineContexts(edition) {
  const storylineContexts = new Map();

  for (const storyline of edition.storylines ?? []) {
    const storylineId = normalizeOptionalString(
      storyline?.storylineId ?? storyline?.storyline_id,
    );

    if (!storylineId) {
      continue;
    }

    mergeNewsletterEditionStorylineContext(
      storylineContexts,
      storylineId,
      createNewsletterEditionStorylineSeed({
        storylineId,
        storyline,
      }),
    );
  }

  for (const item of edition.items) {
    const storylineMetadata = readNewsletterItemStorylineMetadata(item);

    for (const storylineId of resolveNewsletterItemStorylineIds(item)) {
      mergeNewsletterEditionStorylineContext(
        storylineContexts,
        storylineId,
        createNewsletterEditionStorylineSeed({
          storylineId,
          storyline: storylineMetadata,
          item,
          publishedAt: edition.publishedAt,
        }),
      );
    }
  }

  return [...storylineContexts.values()]
    .map((storyline) => finalizeNewsletterEditionStorylineContext(storyline, edition.publishedAt))
    .filter((storyline) => storyline.items.length > 0)
    .sort((left, right) => left.storylineId.localeCompare(right.storylineId));
}

function createNewsletterEditionStorylineSeed({
  storylineId,
  storyline,
  item = null,
  publishedAt = null,
}) {
  return {
    storylineId,
    title: normalizeOptionalString(storyline?.title) ?? (item ? item.name : null),
    status: normalizeOptionalString(storyline?.status),
    memberItemIds: uniqueStrings(
      [
        ...(storyline?.memberItemIds ?? storyline?.member_item_ids ?? []),
        ...(item ? [item.itemId] : []),
      ].filter(Boolean),
    ),
    parentStorylineIds: normalizeOptionalStringList(
      storyline?.parentStorylineIds ?? storyline?.parent_storyline_ids ?? [],
      "edition.storyline.parentStorylineIds",
    ),
    childStorylineIds: normalizeOptionalStringList(
      storyline?.childStorylineIds ?? storyline?.child_storyline_ids ?? [],
      "edition.storyline.childStorylineIds",
    ),
    mergedStorylineIds: normalizeOptionalStringList(
      storyline?.mergedStorylineIds ?? storyline?.merged_storyline_ids ?? [],
      "edition.storyline.mergedStorylineIds",
    ),
    mergedIntoStorylineId: normalizeOptionalString(
      storyline?.mergedIntoStorylineId ?? storyline?.merged_into_storyline_id ?? null,
    ),
    narrativeType:
      normalizeOptionalNarrativeType(
        storyline?.narrativeType ?? storyline?.narrative_type ?? null,
        "edition.storyline.narrativeType",
      ) ?? null,
    firstSeen:
      normalizeOptionalString(storyline?.firstSeen ?? storyline?.first_seen) ??
      normalizeOptionalString(item?.firstSeen ?? item?.discoveredAt ?? publishedAt),
    lastSeen:
      normalizeOptionalString(storyline?.lastSeen ?? storyline?.last_seen) ??
      normalizeOptionalString(item?.discoveredAt ?? item?.publishedAt ?? publishedAt),
    updatedAt:
      normalizeOptionalString(storyline?.updatedAt ?? storyline?.updated_at) ??
      normalizeOptionalString(publishedAt),
    lastEvolutionAt:
      normalizeOptionalString(storyline?.lastEvolutionAt ?? storyline?.last_evolution_at) ??
      normalizeOptionalString(storyline?.updatedAt ?? storyline?.updated_at) ??
      normalizeOptionalString(publishedAt),
    evolutionCount:
      normalizeOptionalNonNegativeInteger(
        storyline?.evolutionCount ?? storyline?.evolution_count,
        "edition.storyline.evolutionCount",
      ) ?? 0,
    repetitionCount:
      normalizeOptionalNonNegativeInteger(
        storyline?.repetitionCount ?? storyline?.repetition_count,
        "edition.storyline.repetitionCount",
      ) ?? 0,
    repetitionStreak:
      normalizeOptionalNonNegativeInteger(
        storyline?.repetitionStreak ?? storyline?.repetition_streak,
        "edition.storyline.repetitionStreak",
      ) ?? 0,
    items: item ? [item] : [],
  };
}

function mergeNewsletterEditionStorylineContext(storylineContexts, storylineId, seed) {
  const existing = storylineContexts.get(storylineId) ?? {
    storylineId,
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
    items: [],
  };

  existing.title ??= seed.title;
  existing.status = selectPreferredStorylineStatus(existing.status, seed.status);
  existing.memberItemIds = uniqueStrings([...existing.memberItemIds, ...seed.memberItemIds]);
  existing.parentStorylineIds = uniqueStrings([
    ...existing.parentStorylineIds,
    ...seed.parentStorylineIds,
  ]);
  existing.childStorylineIds = uniqueStrings([
    ...existing.childStorylineIds,
    ...seed.childStorylineIds,
  ]);
  existing.mergedStorylineIds = uniqueStrings([
    ...existing.mergedStorylineIds,
    ...seed.mergedStorylineIds,
  ]);
  existing.mergedIntoStorylineId ??= seed.mergedIntoStorylineId;
  existing.narrativeType ??= seed.narrativeType;
  existing.firstSeen = pickEarlierNewsletterTimestamp(existing.firstSeen, seed.firstSeen);
  existing.lastSeen = pickLaterNewsletterTimestamp(existing.lastSeen, seed.lastSeen);
  existing.updatedAt = pickLaterNewsletterTimestamp(existing.updatedAt, seed.updatedAt);
  existing.lastEvolutionAt = pickLaterNewsletterTimestamp(
    existing.lastEvolutionAt,
    seed.lastEvolutionAt,
  );
  existing.evolutionCount = Math.max(existing.evolutionCount, seed.evolutionCount);
  existing.repetitionCount = Math.max(existing.repetitionCount, seed.repetitionCount);
  existing.repetitionStreak = Math.max(existing.repetitionStreak, seed.repetitionStreak);

  for (const item of seed.items) {
    if (!existing.items.some((candidate) => candidate.itemId === item.itemId)) {
      existing.items.push(item);
    }
  }

  storylineContexts.set(storylineId, existing);
}

function finalizeNewsletterEditionStorylineContext(storyline, publishedAt) {
  const memberItemIds = uniqueStrings([
    ...storyline.memberItemIds,
    ...storyline.items.map((item) => item.itemId),
  ]);
  const firstSeen =
    storyline.firstSeen ??
    storyline.items
      .map((item) => normalizeOptionalString(item.firstSeen ?? item.discoveredAt ?? publishedAt))
      .filter(Boolean)
      .reduce(pickEarlierNewsletterTimestamp, null) ??
    publishedAt;
  const lastSeen =
    storyline.lastSeen ??
    storyline.items
      .map((item) => normalizeOptionalString(item.discoveredAt ?? item.publishedAt ?? publishedAt))
      .filter(Boolean)
      .reduce(pickLaterNewsletterTimestamp, null) ??
    publishedAt;
  const updatedAt = storyline.updatedAt ?? publishedAt;
  const lastEvolutionAt = storyline.lastEvolutionAt ?? updatedAt;

  return {
    storylineId: storyline.storylineId,
    title: storyline.title ?? storyline.items[0]?.name ?? storyline.storylineId,
    memberItemIds,
    status: normalizeStorylineStatus(storyline.status),
    ...(storyline.parentStorylineIds.length > 0
      ? { parentStorylineIds: storyline.parentStorylineIds }
      : {}),
    ...(storyline.childStorylineIds.length > 0
      ? { childStorylineIds: storyline.childStorylineIds }
      : {}),
    ...(storyline.mergedStorylineIds.length > 0
      ? { mergedStorylineIds: storyline.mergedStorylineIds }
      : {}),
    ...(storyline.mergedIntoStorylineId
      ? { mergedIntoStorylineId: storyline.mergedIntoStorylineId }
      : {}),
    ...(storyline.narrativeType ? { narrativeType: storyline.narrativeType } : {}),
    firstSeen,
    lastSeen,
    updatedAt,
    lastEvolutionAt,
    evolutionCount: storyline.evolutionCount,
    repetitionCount: storyline.repetitionCount,
    repetitionStreak: storyline.repetitionStreak,
    items: storyline.items,
  };
}

function resolveNewsletterItemStorylineState(
  item,
  { storylineLookup = null, primaryStoryline = null } = {},
) {
  const storylineMetadata = readNewsletterItemStorylineMetadata(item);
  const storylineIds = resolveNewsletterItemStorylineIds(item);
  const storylineId =
    storylineMetadata.storylineId ??
    primaryStoryline?.storylineId ??
    primaryStoryline?.storyline_id ??
    storylineIds[0] ??
    null;

  if (!storylineId) {
    return null;
  }

  const lookupStoryline =
    normalizeOptionalString(primaryStoryline?.storylineId ?? primaryStoryline?.storyline_id) ===
    storylineId
      ? primaryStoryline
      : storylineLookup?.get(storylineId) ?? null;

  if (!lookupStoryline && isEmptyNewsletterItemStorylineMetadata(storylineMetadata)) {
    return null;
  }

  const memberItemIds = uniqueStrings([
    ...(lookupStoryline?.memberItemIds ?? lookupStoryline?.member_item_ids ?? []),
    ...storylineMetadata.memberItemIds,
    item.itemId,
  ]);
  const position =
    normalizeOptionalPositiveInteger(
      item.storylineMemberPosition ?? storylineMetadata.position ?? null,
      "newsletterItem.storyline.position",
    ) ?? deriveNewsletterStorylinePosition(memberItemIds, item.itemId);

  return serializeLifecycleAppearanceStoryline(
    {
      storylineId,
      title:
        storylineMetadata.title ??
        normalizeOptionalString(lookupStoryline?.title) ??
        item.name,
      status:
        storylineMetadata.status ??
        normalizeOptionalString(lookupStoryline?.status) ??
        STORYLINE_STATUSES[0],
      position: position ?? 1,
      memberItemIds,
      relatedItemIds:
        storylineMetadata.relatedItemIds.length > 0
          ? storylineMetadata.relatedItemIds
          : memberItemIds.filter((memberItemId) => memberItemId !== item.itemId),
      parentStorylineIds: uniqueStrings([
        ...(lookupStoryline?.parentStorylineIds ?? lookupStoryline?.parent_storyline_ids ?? []),
        ...storylineMetadata.parentStorylineIds,
      ]),
      narrativeType:
        storylineMetadata.narrativeType ??
        lookupStoryline?.narrativeType ??
        lookupStoryline?.narrative_type ??
        null,
      relationship:
        storylineMetadata.relationship ??
        lookupStoryline?.relationship ??
        null,
    },
    item.itemId,
  );
}

function readNewsletterItemStorylineMetadata(item) {
  const storyline = item?.metadata?.storyline;

  if (!storyline || typeof storyline !== "object" || Array.isArray(storyline)) {
    return {
      storylineId: null,
      title: null,
      status: null,
      memberItemIds: [],
      relatedItemIds: [],
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
      position: null,
      relationship: null,
    };
  }

  return {
    storylineId: normalizeOptionalString(
      storyline.storylineId ?? storyline.storyline_id ?? storyline.id ?? null,
    ),
    title: normalizeOptionalString(storyline.title),
    status: normalizeOptionalString(storyline.status),
    memberItemIds: normalizeOptionalStringList(
      storyline.memberItemIds ?? storyline.member_item_ids ?? [],
      "newsletterItem.storyline.memberItemIds",
    ),
    relatedItemIds: normalizeOptionalStringList(
      storyline.relatedItemIds ?? storyline.related_item_ids ?? [],
      "newsletterItem.storyline.relatedItemIds",
    ),
    parentStorylineIds: normalizeOptionalStringList(
      storyline.parentStorylineIds ?? storyline.parent_storyline_ids ?? [],
      "newsletterItem.storyline.parentStorylineIds",
    ),
    childStorylineIds: normalizeOptionalStringList(
      storyline.childStorylineIds ?? storyline.child_storyline_ids ?? [],
      "newsletterItem.storyline.childStorylineIds",
    ),
    mergedStorylineIds: normalizeOptionalStringList(
      storyline.mergedStorylineIds ?? storyline.merged_storyline_ids ?? [],
      "newsletterItem.storyline.mergedStorylineIds",
    ),
    mergedIntoStorylineId: normalizeOptionalString(
      storyline.mergedIntoStorylineId ?? storyline.merged_into_storyline_id ?? null,
    ),
    narrativeType:
      normalizeOptionalNarrativeType(
        storyline.narrativeType ?? storyline.narrative_type ?? null,
        "newsletterItem.storyline.narrativeType",
      ) ?? null,
    firstSeen: normalizeOptionalString(storyline.firstSeen ?? storyline.first_seen),
    lastSeen: normalizeOptionalString(storyline.lastSeen ?? storyline.last_seen),
    updatedAt: normalizeOptionalString(storyline.updatedAt ?? storyline.updated_at),
    lastEvolutionAt: normalizeOptionalString(
      storyline.lastEvolutionAt ?? storyline.last_evolution_at,
    ),
    evolutionCount:
      normalizeOptionalNonNegativeInteger(
        storyline.evolutionCount ?? storyline.evolution_count,
        "newsletterItem.storyline.evolutionCount",
      ) ?? 0,
    repetitionCount:
      normalizeOptionalNonNegativeInteger(
        storyline.repetitionCount ?? storyline.repetition_count,
        "newsletterItem.storyline.repetitionCount",
      ) ?? 0,
    repetitionStreak:
      normalizeOptionalNonNegativeInteger(
        storyline.repetitionStreak ?? storyline.repetition_streak,
        "newsletterItem.storyline.repetitionStreak",
      ) ?? 0,
    position:
      normalizeOptionalPositiveInteger(
        storyline.position ?? null,
        "newsletterItem.storyline.position",
      ) ?? null,
    relationship: storyline.relationship ?? null,
  };
}

function isEmptyNewsletterItemStorylineMetadata(metadata) {
  return (
    metadata.storylineId == null &&
    metadata.title == null &&
    metadata.status == null &&
    metadata.memberItemIds.length === 0 &&
    metadata.parentStorylineIds.length === 0 &&
    metadata.narrativeType == null &&
    metadata.position == null &&
    metadata.relationship == null
  );
}

function deriveNewsletterStorylinePosition(memberItemIds, itemId) {
  const itemIndex = memberItemIds.indexOf(itemId);
  return itemIndex === -1 ? null : itemIndex + 1;
}

function pickEarlierNewsletterTimestamp(left, right) {
  if (!left) {
    return right ?? null;
  }

  if (!right) {
    return left;
  }

  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function pickLaterNewsletterTimestamp(left, right) {
  if (!left) {
    return right ?? null;
  }

  if (!right) {
    return left;
  }

  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function selectPreferredStorylineStatus(currentStatus, candidateStatus) {
  const normalizedCurrent =
    normalizeOptionalString(currentStatus) ?? STORYLINE_STATUSES[0];
  const normalizedCandidate = normalizeOptionalString(candidateStatus);

  if (!normalizedCandidate) {
    return normalizedCurrent;
  }

  const statusRank = new Map(STORYLINE_STATUSES.map((status, index) => [status, index]));
  return statusRank.get(normalizedCandidate) >= statusRank.get(normalizedCurrent)
    ? normalizedCandidate
    : normalizedCurrent;
}

function serializeStorylineRelationshipMetadata({
  parentStorylineIds,
  childStorylineIds,
  mergedStorylineIds,
  mergedIntoStorylineId,
}) {
  const mergeSourceStorylineIds = [...mergedStorylineIds];
  const mergeSourceStorylineIdSet = new Set(mergeSourceStorylineIds);

  return {
    fork: {
      parent_storyline_ids: parentStorylineIds.filter(
        (storylineId) => !mergeSourceStorylineIdSet.has(storylineId),
      ),
      child_storyline_ids: [...childStorylineIds],
    },
    merge: {
      source_storyline_ids: mergeSourceStorylineIds,
      target_storyline_id: mergedIntoStorylineId,
    },
  };
}

function serializeRiskWarning(riskWarning) {
  const legacyFallback = serializeRiskWarningDimension(riskWarning);

  return Object.fromEntries(
    RISK_WARNING_DIMENSIONS.map((dimension) => [
      dimension,
      serializeRiskWarningDimension(
        riskWarning?.[dimension] ??
          riskWarning?.[dimension === "adoption_complexity" ? "adoptionComplexity" : dimension] ??
          legacyFallback,
      ),
    ]),
  );
}

function serializeRiskWarningDimension(riskDimension) {
  return {
    severity: riskDimension?.severity ?? "unknown",
    description: riskDimension?.description ?? DEFAULT_RISK_WARNING_DESCRIPTION,
  };
}

function serializeSentimentSpread(sentimentSpread) {
  return {
    classification: sentimentSpread.classification,
    ...(sentimentSpread.classification === "agree"
      ? {}
      : { disagreement_dimension: sentimentSpread.disagreementDimension }),
  };
}

export function assertNewsletterItemApiResponse(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new TypeError("newsletter item response must be an object");
  }

  const actualFields = Object.keys(item).sort();
  const expectedFields = [...NEWSLETTER_ITEM_API_RESPONSE_FIELDS].sort();

  if (
    actualFields.length !== expectedFields.length ||
    actualFields.some((field, index) => field !== expectedFields[index])
  ) {
    throw new TypeError(
      `newsletter item response must include only schema v${NEWSLETTER_ITEM_RESPONSE_SCHEMA.version} fields: ${NEWSLETTER_ITEM_API_RESPONSE_FIELDS.join(", ")}`,
    );
  }

  if (typeof item.item_id !== "string" || item.item_id.length === 0) {
    throw new TypeError("newsletter item response item_id must be a non-empty string");
  }

  if (typeof item.name !== "string" || item.name.length === 0) {
    throw new TypeError("newsletter item response name must be a non-empty string");
  }

  validateSourceUrls(item.source_urls);

  if (!CONTENT_CATEGORIES.includes(item.category)) {
    throw new TypeError("newsletter item response category is invalid");
  }

  if (typeof item.summary !== "string" || item.summary.length === 0) {
    throw new TypeError("newsletter item response summary must be a non-empty string");
  }

  if (typeof item.integration_hint !== "string" || item.integration_hint.length === 0) {
    throw new TypeError("newsletter item response integration_hint must be a non-empty string");
  }

  validateScore(item.relevance_score, "newsletter item response relevance_score");
  assertNonEmptyString(item.score_version, "newsletter item response score_version");
  if (!SCORE_INTERPRETATIONS.includes(item.score_interpretation)) {
    throw new TypeError("newsletter item response score_interpretation is invalid");
  }
  if (typeof item.divergence_flag !== "boolean") {
    throw new TypeError("newsletter item response divergence_flag must be a boolean");
  }
  validateRiskWarning(item.risk_warning);
  validatePositiveInteger(item.mention_count, "newsletter item response mention_count");
  validateSentimentSpread(item.sentiment_spread);
  normalizeTimestamp(item.first_seen, "newsletter item response first_seen");
  validatePositiveInteger(item.edition_count, "newsletter item response edition_count");
  validateStorylineIds(item.storyline_ids);
  validateNewsletterItemStoryline(item.storyline);
  assertNonEmptyString(item.scope_version, "newsletter item response scope_version");

  return item;
}

export function resolveNewsletterItemStorylineIds(item) {
  if (!item || typeof item !== "object") {
    return [];
  }

  const candidates = [];

  for (const values of [item.storylineIds, item.storyline_ids]) {
    if (values == null) {
      continue;
    }

    if (!Array.isArray(values)) {
      throw new TypeError("storyline_ids must be an array when provided");
    }

    candidates.push(...values);
  }

  for (const value of [item.storylineId, item.storyline_id]) {
    if (value != null) {
      candidates.push(value);
    }
  }

  return uniqueStrings(
    candidates
      .filter((value) => value != null)
      .map((value) => {
        if (typeof value !== "string" || value.trim().length === 0) {
          throw new TypeError("storyline_ids[] must contain non-empty strings");
        }

        return value.trim();
      }),
  );
}

function resolveItemDivergenceFlag(item) {
  return typeof item?.divergenceFlag === "boolean"
    ? item.divergenceFlag
    : hasHighSentimentDivergence(item);
}

function normalizeArchiveWindowDays(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("archiveWindowDays must be a positive integer");
  }

  return value;
}

function normalizeEditionList(editions) {
  if (!Array.isArray(editions)) {
    throw new TypeError("editions must be an array");
  }

  return editions;
}

function normalizeStorylineList(storylines) {
  if (!Array.isArray(storylines)) {
    throw new TypeError("storylines must be an array");
  }

  return storylines;
}

function serializeNewsletterItemAppearance(appearance, options = {}) {
  const normalizedEdition = createNewsletterEdition({
    id: appearance?.editionId,
    publishedAt: appearance?.publishedAt,
    window: appearance?.window,
    items: [appearance?.item],
  });

  return {
    edition_id: normalizedEdition.id,
    published_at: normalizedEdition.publishedAt,
    content_window: {
      starts_at: normalizedEdition.window.startsAt,
      ends_at: normalizedEdition.window.endsAt,
      timezone: normalizedEdition.window.timezone,
    },
    item: serializeNewsletterItem(normalizedEdition.items[0], {
      ...options,
      primaryStoryline: appearance?.storyline ?? null,
    }),
    storyline: serializeLifecycleAppearanceStoryline(
      appearance?.storyline,
      normalizedEdition.items[0].itemId,
    ),
  };
}

function serializeLifecycleOccurrenceSummary(summary, appearance, appearanceNumber) {
  const serializedAppearance =
    appearance ??
    (summary == null
      ? null
      : serializeNewsletterItemAppearance(
          {
            editionId: summary.editionId ?? summary.edition_id,
            publishedAt: summary.publishedAt ?? summary.published_at,
            window: summary.window ?? summary.content_window,
            item: summary.item,
            storyline: summary.storyline ?? null,
          },
          {},
        ));

  if (serializedAppearance == null) {
    throw new TypeError("itemLifecycle occurrence summary requires an appearance");
  }

  const storylineIds = normalizeStringList(
    summary?.storylineIds ??
      summary?.storyline_ids ??
      serializedAppearance.item.storyline_ids,
    "itemLifecycle.occurrence.storylineIds",
  );

  return {
    edition_id: serializedAppearance.edition_id,
    published_at: serializedAppearance.published_at,
    appearance_number: validatePositiveInteger(
      summary?.appearanceNumber ?? summary?.appearance_number ?? appearanceNumber,
      "itemLifecycle.occurrence.appearanceNumber",
    ),
    relevance_score: serializedAppearance.item.relevance_score,
    score_version: serializedAppearance.item.score_version,
    divergence_flag: normalizeBoolean(
      summary?.divergenceFlag ??
        summary?.divergence_flag ??
        serializedAppearance.item.divergence_flag,
      "itemLifecycle.occurrence.divergenceFlag",
    ),
    storyline_ids: storylineIds,
  };
}

function serializeLifecycleOccurrenceSummaryList(summaries, fallbackAppearances) {
  if (summaries == null) {
    return fallbackAppearances.map((appearance, index) =>
      serializeLifecycleOccurrenceSummary(null, appearance, index + 2),
    );
  }

  if (!Array.isArray(summaries)) {
    throw new TypeError("itemLifecycle.repeatAppearances must be an array");
  }

  return summaries.map((summary, index) =>
    serializeLifecycleOccurrenceSummary(summary, fallbackAppearances[index] ?? null, index + 2),
  );
}

function serializeLifecycleScoreEvolution(scoreEvolution, appearances) {
  if (scoreEvolution == null) {
    return appearances.map((appearance, index) =>
      deriveLifecycleScoreEvolutionEntry(
        appearance,
        appearances[index - 1] ?? null,
        appearances[0],
      ),
    );
  }

  if (!Array.isArray(scoreEvolution)) {
    throw new TypeError("itemLifecycle.scoreEvolution must be an array");
  }

  return scoreEvolution.map((entry, index) =>
    serializeLifecycleScoreEvolutionEntry(
      entry,
      appearances[index] ?? null,
      appearances[index - 1] ?? null,
      appearances[0],
    ),
  );
}

function deriveLifecycleScoreEvolutionEntry(appearance, previousAppearance, firstAppearance) {
  return {
    edition_id: appearance.edition_id,
    published_at: appearance.published_at,
    relevance_score: appearance.item.relevance_score,
    score_version: appearance.item.score_version,
    divergence_flag: appearance.item.divergence_flag,
    delta_from_previous:
      previousAppearance == null
        ? null
        : appearance.item.relevance_score - previousAppearance.item.relevance_score,
    delta_from_first_appearance:
      appearance.item.relevance_score - firstAppearance.item.relevance_score,
  };
}

function serializeLifecycleScoreEvolutionEntry(
  entry,
  appearance,
  previousAppearance,
  firstAppearance,
) {
  const serializedAppearance = appearance;

  if (serializedAppearance == null) {
    throw new TypeError("itemLifecycle.scoreEvolution entries require an appearance");
  }

  return {
    edition_id: serializedAppearance.edition_id,
    published_at: serializedAppearance.published_at,
    relevance_score: serializedAppearance.item.relevance_score,
    score_version: serializedAppearance.item.score_version,
    divergence_flag: normalizeBoolean(
      entry?.divergenceFlag ??
        entry?.divergence_flag ??
        serializedAppearance.item.divergence_flag,
      "itemLifecycle.scoreEvolution.divergenceFlag",
    ),
    delta_from_previous: normalizeOptionalFiniteNumber(
      entry?.deltaFromPrevious ?? entry?.delta_from_previous,
      "itemLifecycle.scoreEvolution.deltaFromPrevious",
      previousAppearance == null
        ? null
        : serializedAppearance.item.relevance_score - previousAppearance.item.relevance_score,
    ),
    delta_from_first_appearance: normalizeOptionalFiniteNumber(
      entry?.deltaFromFirstAppearance ?? entry?.delta_from_first_appearance,
      "itemLifecycle.scoreEvolution.deltaFromFirstAppearance",
      serializedAppearance.item.relevance_score - firstAppearance.item.relevance_score,
    ),
  };
}

function serializeLifecycleStorylineMembership(storylineMembership, appearances) {
  if (storylineMembership == null) {
    return appearances.map((appearance) => deriveLifecycleStorylineMembershipEntry(appearance));
  }

  if (!Array.isArray(storylineMembership)) {
    throw new TypeError("itemLifecycle.storylineMembership must be an array");
  }

  return storylineMembership.map((entry, index) =>
    serializeLifecycleStorylineMembershipEntry(entry, appearances[index] ?? null),
  );
}

function deriveLifecycleStorylineMembershipEntry(appearance) {
  return {
    edition_id: appearance.edition_id,
    published_at: appearance.published_at,
    storyline_ids: normalizeStringList(
      appearance.item.storyline_ids,
      "itemLifecycle.storylineMembership.storylineIds",
    ),
    primary_storyline_id: appearance.storyline?.storyline_id ?? null,
    primary_storyline_title: appearance.storyline?.title ?? null,
    primary_storyline_status: appearance.storyline?.status ?? null,
    position: appearance.storyline?.position ?? null,
    relationship_decision: appearance.storyline?.relationship?.decision ?? null,
  };
}

function serializeLifecycleStorylineMembershipEntry(entry, appearance) {
  const fallbackEntry = appearance ? deriveLifecycleStorylineMembershipEntry(appearance) : null;
  const storylineIds = normalizeStringList(
    entry?.storylineIds ?? entry?.storyline_ids ?? fallbackEntry?.storyline_ids ?? [],
    "itemLifecycle.storylineMembership.storylineIds",
  );

  return {
    edition_id: normalizeOptionalString(
      entry?.editionId ?? entry?.edition_id ?? fallbackEntry?.edition_id,
      "itemLifecycle.storylineMembership.editionId",
    ),
    published_at: normalizeOptionalTimestamp(
      entry?.publishedAt ?? entry?.published_at ?? fallbackEntry?.published_at,
    ),
    storyline_ids: storylineIds,
    primary_storyline_id: normalizeOptionalString(
      entry?.primaryStorylineId ??
        entry?.primary_storyline_id ??
        fallbackEntry?.primary_storyline_id,
      "itemLifecycle.storylineMembership.primaryStorylineId",
    ),
    primary_storyline_title: normalizeOptionalString(
      entry?.primaryStorylineTitle ??
        entry?.primary_storyline_title ??
        fallbackEntry?.primary_storyline_title,
      "itemLifecycle.storylineMembership.primaryStorylineTitle",
    ),
    primary_storyline_status: normalizeOptionalString(
      entry?.primaryStorylineStatus ??
        entry?.primary_storyline_status ??
        fallbackEntry?.primary_storyline_status,
      "itemLifecycle.storylineMembership.primaryStorylineStatus",
    ),
    position: normalizeOptionalPositiveInteger(
      entry?.position ?? fallbackEntry?.position ?? null,
      "itemLifecycle.storylineMembership.position",
    ),
    relationship_decision: normalizeOptionalString(
      entry?.relationshipDecision ??
        entry?.relationship_decision ??
        fallbackEntry?.relationship_decision,
      "itemLifecycle.storylineMembership.relationshipDecision",
    ),
  };
}

function resolveNewsletterItemScopeVersion(scopeVersion, scopeVersionFallback) {
  if (scopeVersion != null) {
    return assertNonEmptyString(scopeVersion, "scopeVersion");
  }

  return assertNonEmptyString(scopeVersionFallback, "scopeVersionFallback");
}

function normalizeEditionCount(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("itemLifecycle.editionCount must be a positive integer");
  }

  return value;
}

function normalizeStorylineItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError("storyline.items must be a non-empty array");
  }

  return items;
}

function serializeLifecycleStorylineSummary(storyline, itemId) {
  if (storyline == null) {
    return null;
  }

  const normalizedStoryline = normalizeLifecycleStoryline(storyline, itemId);

  return {
    storyline_id: normalizedStoryline.storylineId,
    title: normalizedStoryline.title,
    status: normalizedStoryline.status,
    member_item_ids: normalizedStoryline.memberItemIds,
    related_item_ids: normalizedStoryline.relatedItemIds,
    ...(normalizedStoryline.parentStorylineIds.length > 0
      ? { parent_storyline_ids: normalizedStoryline.parentStorylineIds }
      : {}),
    ...(normalizedStoryline.narrativeType
      ? { narrative_type: normalizedStoryline.narrativeType }
      : {}),
    first_seen: normalizedStoryline.firstSeen,
    last_seen: normalizedStoryline.lastSeen,
    updated_at: normalizedStoryline.updatedAt,
    last_evolution_at: normalizedStoryline.lastEvolutionAt,
    evolution_count: normalizedStoryline.evolutionCount,
    repetition_count: normalizedStoryline.repetitionCount,
    repetition_streak: normalizedStoryline.repetitionStreak,
  };
}

function serializeLifecycleAppearanceStoryline(storyline, itemId) {
  if (storyline == null) {
    return null;
  }

  const normalizedStoryline = normalizeLifecycleStoryline(storyline, itemId);

  return {
    storyline_id: normalizedStoryline.storylineId,
    title: normalizedStoryline.title,
    status: normalizedStoryline.status,
    position: normalizedStoryline.position,
    member_item_ids: normalizedStoryline.memberItemIds,
    related_item_ids: normalizedStoryline.relatedItemIds,
    ...(normalizedStoryline.parentStorylineIds.length > 0
      ? { parent_storyline_ids: normalizedStoryline.parentStorylineIds }
      : {}),
    ...(normalizedStoryline.narrativeType
      ? { narrative_type: normalizedStoryline.narrativeType }
      : {}),
    relationship: serializeStorylineRelationship(normalizedStoryline.relationship),
  };
}

function normalizeLifecycleStoryline(storyline, itemId) {
  const storylineId = String(storyline?.storylineId ?? storyline?.storyline_id ?? "").trim();

  if (storylineId.length === 0) {
    throw new TypeError("itemLifecycle.storyline.storylineId is required");
  }

  const memberItemIds = normalizeStringList(
    storyline?.memberItemIds ?? storyline?.member_item_ids ?? [],
    "itemLifecycle.storyline.memberItemIds",
  );
  const relatedItemIds = normalizeStringList(
    storyline?.relatedItemIds ??
      storyline?.related_item_ids ??
      memberItemIds.filter((memberItemId) => memberItemId !== itemId),
    "itemLifecycle.storyline.relatedItemIds",
  );
  const position = normalizeOptionalPositiveInteger(
    storyline?.position,
    "itemLifecycle.storyline.position",
  );

  return {
    storylineId,
    title: String(storyline?.title ?? "").trim() || null,
    status: String(storyline?.status ?? "").trim() || null,
    memberItemIds,
    relatedItemIds,
    parentStorylineIds: normalizeOptionalStringList(
      storyline?.parentStorylineIds ?? storyline?.parent_storyline_ids ?? [],
      "itemLifecycle.storyline.parentStorylineIds",
    ),
    narrativeType: normalizeOptionalNarrativeType(
      storyline?.narrativeType ?? storyline?.narrative_type ?? null,
      "itemLifecycle.storyline.narrativeType",
    ),
    firstSeen: normalizeOptionalTimestamp(storyline?.firstSeen ?? storyline?.first_seen),
    lastSeen: normalizeOptionalTimestamp(storyline?.lastSeen ?? storyline?.last_seen),
    updatedAt: normalizeOptionalTimestamp(storyline?.updatedAt ?? storyline?.updated_at),
    lastEvolutionAt: normalizeOptionalTimestamp(
      storyline?.lastEvolutionAt ?? storyline?.last_evolution_at,
    ),
    evolutionCount: normalizeOptionalNonNegativeInteger(
      storyline?.evolutionCount ?? storyline?.evolution_count,
      "itemLifecycle.storyline.evolutionCount",
    ),
    repetitionCount: normalizeOptionalNonNegativeInteger(
      storyline?.repetitionCount ?? storyline?.repetition_count,
      "itemLifecycle.storyline.repetitionCount",
    ),
    repetitionStreak: normalizeOptionalNonNegativeInteger(
      storyline?.repetitionStreak ?? storyline?.repetition_streak,
      "itemLifecycle.storyline.repetitionStreak",
    ),
    position,
    relationship: storyline?.relationship ?? null,
  };
}

function serializeStorylineRelationship(relationship) {
  if (relationship == null) {
    return null;
  }

  const decision = String(relationship?.decision ?? "").trim();

  if (decision.length === 0) {
    throw new TypeError("itemLifecycle.storyline.relationship.decision is required");
  }

  return {
    decision,
    explanation: String(relationship?.explanation ?? "").trim(),
    prior_appearance_count: normalizeOptionalNonNegativeInteger(
      relationship?.priorAppearanceCount ?? relationship?.prior_appearance_count,
      "itemLifecycle.storyline.relationship.priorAppearanceCount",
    ),
    previous_appearance: serializeRelationshipPreviousAppearance(
      relationship?.previousAppearance ?? relationship?.previous_appearance ?? null,
    ),
    signals: serializeStorylineRelationshipSignals(relationship?.signals ?? null),
  };
}

function serializeRelationshipPreviousAppearance(previousAppearance) {
  if (previousAppearance == null) {
    return null;
  }

  return {
    edition_id: normalizeOptionalString(
      previousAppearance?.editionId ?? previousAppearance?.edition_id,
    ),
    published_at: normalizeOptionalTimestamp(
      previousAppearance?.publishedAt ?? previousAppearance?.published_at,
    ),
    source_url: normalizeOptionalString(
      previousAppearance?.sourceUrl ?? previousAppearance?.source_url,
    ),
  };
}

function serializeStorylineRelationshipSignals(signals) {
  if (signals == null) {
    return {
      fact_overlap_ratio: 0,
      novel_fact_count: 0,
      novel_token_ratio: 0,
      new_source_cluster_count: 0,
    };
  }

  return {
    fact_overlap_ratio: normalizeOptionalFiniteNumber(
      signals?.factOverlapRatio ?? signals?.fact_overlap_ratio,
      "itemLifecycle.storyline.relationship.signals.factOverlapRatio",
    ),
    novel_fact_count: normalizeOptionalNonNegativeInteger(
      signals?.novelFactCount ?? signals?.novel_fact_count,
      "itemLifecycle.storyline.relationship.signals.novelFactCount",
    ),
    novel_token_ratio: normalizeOptionalFiniteNumber(
      signals?.novelTokenRatio ?? signals?.novel_token_ratio,
      "itemLifecycle.storyline.relationship.signals.novelTokenRatio",
    ),
    new_source_cluster_count: normalizeOptionalNonNegativeInteger(
      signals?.newSourceClusterCount ?? signals?.new_source_cluster_count,
      "itemLifecycle.storyline.relationship.signals.newSourceClusterCount",
    ),
  };
}

function normalizeOptionalTimestamp(value) {
  if (value == null) {
    return null;
  }

  return normalizeTimestamp(value, "itemLifecycle.timestamp");
}

function normalizeOptionalString(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length === 0 ? null : normalized;
}

function normalizeStringList(values, fieldName) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${fieldName} must be an array`);
  }

  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function normalizeOptionalStringList(values, fieldName) {
  if (values == null) {
    return [];
  }

  return normalizeStringList(values, fieldName);
}

function normalizeOptionalNarrativeType(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return {
      key: assertNonEmptyString(value, `${fieldName}.key`),
    };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }

  const key = assertNonEmptyString(
    value.key ?? value.id ?? value.type ?? value.slug,
    `${fieldName}.key`,
  );
  const label =
    value.label == null ? null : assertNonEmptyString(value.label, `${fieldName}.label`);
  const metadata = value.metadata ?? null;

  if (metadata != null && (typeof metadata !== "object" || Array.isArray(metadata))) {
    throw new TypeError(`${fieldName}.metadata must be an object when provided`);
  }

  return {
    key,
    ...(label ? { label } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeOptionalPositiveInteger(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (!Number.isFinite(value)) {
    throw new TypeError(`${fieldName} must be a finite number`);
  }

  return Math.max(1, Math.trunc(value));
}

function normalizeOptionalNonNegativeInteger(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (!Number.isFinite(value)) {
    throw new TypeError(`${fieldName} must be a finite number`);
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeOptionalFiniteNumber(value, fieldName, fallback = 0) {
  if (value == null) {
    return fallback;
  }

  if (!Number.isFinite(value)) {
    throw new TypeError(`${fieldName} must be a finite number`);
  }

  return value;
}

function validatePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }

  return value;
}

function normalizeBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${fieldName} must be a boolean`);
  }

  return value;
}

function validateNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }

  return value;
}

function validateScore(value, fieldName) {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 100) {
    throw new TypeError(`${fieldName} must be a number between 0 and 100`);
  }
}

function validateSourceUrls(sourceUrls) {
  if (!Array.isArray(sourceUrls) || sourceUrls.length === 0) {
    throw new TypeError("newsletter item response source_urls must be a non-empty array");
  }

  for (const sourceUrl of sourceUrls) {
    if (typeof sourceUrl !== "string" || sourceUrl.length === 0) {
      throw new TypeError("newsletter item response source_urls[] must be non-empty strings");
    }

    new URL(sourceUrl);
  }
}

function validateRiskWarning(riskWarning) {
  if (!riskWarning || typeof riskWarning !== "object" || Array.isArray(riskWarning)) {
    throw new TypeError("newsletter item response risk_warning must be an object");
  }

  const actualFields = Object.keys(riskWarning).sort();
  const expectedFields = [...RISK_WARNING_DIMENSIONS].sort();

  if (
    actualFields.length !== expectedFields.length ||
    actualFields.some((field, index) => field !== expectedFields[index])
  ) {
    throw new TypeError(
      `newsletter item response risk_warning must include only: ${RISK_WARNING_DIMENSIONS.join(", ")}`,
    );
  }

  for (const dimension of RISK_WARNING_DIMENSIONS) {
    const value = riskWarning[dimension];

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`newsletter item response risk_warning.${dimension} must be an object`);
    }

    const severity = value.severity;
    const description = value.description;

    if (!RISK_SEVERITIES.includes(severity)) {
      throw new TypeError(
        `newsletter item response risk_warning.${dimension}.severity is invalid`,
      );
    }

    if (typeof description !== "string" || description.length === 0) {
      throw new TypeError(
        `newsletter item response risk_warning.${dimension}.description must be a non-empty string`,
      );
    }
  }
}

function validateSentimentSpread(sentimentSpread) {
  if (
    !sentimentSpread ||
    typeof sentimentSpread !== "object" ||
    Array.isArray(sentimentSpread)
  ) {
    throw new TypeError("newsletter item response sentiment_spread must be an object");
  }

  if (!SENTIMENT_SPREADS.includes(sentimentSpread.classification)) {
    throw new TypeError("newsletter item response sentiment_spread.classification is invalid");
  }

  if (sentimentSpread.classification === "agree") {
    if (Object.keys(sentimentSpread).length !== 1) {
      throw new TypeError(
        "newsletter item response sentiment_spread for agreement must omit disagreement_dimension",
      );
    }

    return;
  }

  if (
    !DISAGREEMENT_DIMENSIONS.includes(sentimentSpread.disagreement_dimension) ||
    Object.keys(sentimentSpread).length !== 2
  ) {
    throw new TypeError(
      "newsletter item response sentiment_spread must include disagreement_dimension",
    );
  }
}

function validateNewsletterItemStoryline(storyline) {
  if (storyline == null) {
    return;
  }

  if (!storyline || typeof storyline !== "object" || Array.isArray(storyline)) {
    throw new TypeError("newsletter item response storyline must be an object or null");
  }

  if (typeof storyline.storyline_id !== "string" || storyline.storyline_id.length === 0) {
    throw new TypeError("newsletter item response storyline.storyline_id is required");
  }

  if (typeof storyline.title !== "string" || storyline.title.length === 0) {
    throw new TypeError("newsletter item response storyline.title is required");
  }

  if (!STORYLINE_STATUSES.includes(storyline.status)) {
    throw new TypeError("newsletter item response storyline.status is invalid");
  }

  validatePositiveInteger(
    storyline.position,
    "newsletter item response storyline.position",
  );
  validateStorylineIds(storyline.member_item_ids);
  validateStorylineIds(storyline.related_item_ids);

  if (storyline.parent_storyline_ids != null) {
    validateStorylineIds(storyline.parent_storyline_ids);
  }

  if (storyline.narrative_type != null) {
    normalizeOptionalNarrativeType(
      storyline.narrative_type,
      "newsletter item response storyline.narrative_type",
    );
  }

  if (storyline.relationship != null) {
    serializeStorylineRelationship(storyline.relationship);
  }
}

function validateStorylineIds(storylineIds) {
  if (!Array.isArray(storylineIds)) {
    throw new TypeError("newsletter item response storyline_ids must be an array");
  }

  const normalizedIds = storylineIds.map((storylineId) => {
    if (typeof storylineId !== "string" || storylineId.trim().length === 0) {
      throw new TypeError("newsletter item response storyline_ids[] must be non-empty strings");
    }

    return storylineId.trim();
  });

  if (normalizedIds.length !== new Set(normalizedIds).size) {
    throw new TypeError("newsletter item response storyline_ids must be unique");
  }
}

function normalizeStorylineStatus(value) {
  if (!STORYLINE_STATUSES.includes(value)) {
    throw new TypeError("storyline.status is invalid");
  }

  return value;
}
