import {
  consolidateMatchedItems,
  createDefaultDeduplicationHooks,
  groupDuplicateItems,
} from "./dedupe.js";
import { ContentFetcherCore } from "./content-fetcher.js";
import { mergeCanonicalIdentifiers } from "./item-identity.js";
import { ItemResolutionService } from "./item-resolution.js";
import { createNormalizedItem } from "./schema.js";
import {
  DEFAULT_MIN_RELEVANCE_SCORE,
  DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  createWeightedRelevanceScorer,
  filterCuratedItemsByRelevance,
  hasHighSentimentDivergence,
  sortCuratedItemsByRelevance,
} from "./relevance-scoring.js";
import {
  annotateStorylineRelationship,
  buildHistoricalStorylineMap,
} from "./storyline-classifier.js";
import { buildSourceCandidate } from "../discovery/link-extractor.js";
import { resolveWeightedSourceAuthorityScore } from "../discovery/source-authority.js";
import { resolveSourceLifecycleState } from "../discovery/source-lifecycle.js";
import {
  createRelevanceExclusion,
  createSourceExclusion,
} from "../newsletter/exclusion-analytics.js";

export class AggregationPipeline {
  constructor({
    registry,
    contentFetcher = null,
    deduplicationHooks = createDefaultDeduplicationHooks(),
    minRelevanceScore = DEFAULT_MIN_RELEVANCE_SCORE,
    minSourceAuthorityScore = 50,
    scoreItem = createWeightedRelevanceScorer(),
    sourceRepository = null,
    editionHistoryStore = null,
    itemResolutionService = new ItemResolutionService(),
    requiresSourceApproval = defaultRequiresSourceApproval,
    requiredSourceKinds = null,
    allowItem,
  }) {
    const resolvedRegistry = registry ?? contentFetcher?.registry ?? null;

    if (!resolvedRegistry) {
      throw new TypeError("registry is required");
    }

    if (typeof scoreItem !== "function") {
      throw new TypeError("scoreItem must be a function");
    }

    if (sourceRepository && typeof sourceRepository.load !== "function") {
      throw new TypeError("sourceRepository must expose a load({ now }) function");
    }

    if (editionHistoryStore && typeof editionHistoryStore.loadHistory !== "function") {
      throw new TypeError(
        "editionHistoryStore must expose loadHistory({ now, days })",
      );
    }

    if (typeof requiresSourceApproval !== "function") {
      throw new TypeError("requiresSourceApproval must be a function");
    }

    if (!itemResolutionService || typeof itemResolutionService.matchGroup !== "function") {
      throw new TypeError("itemResolutionService must expose matchGroup(group, candidates)");
    }

    if (contentFetcher && typeof contentFetcher.fetch !== "function") {
      throw new TypeError("contentFetcher must expose fetch(window)");
    }

    this.registry = resolvedRegistry;
    this.contentFetcher =
      contentFetcher ??
      new ContentFetcherCore({
        registry: resolvedRegistry,
        requiredSourceKinds,
      });
    this.deduplicationHooks = deduplicationHooks;
    this.minRelevanceScore = minRelevanceScore;
    this.minSourceAuthorityScore = minSourceAuthorityScore;
    this.scoreItem = scoreItem;
    this.sourceRepository = sourceRepository;
    this.editionHistoryStore = editionHistoryStore;
    this.itemResolutionService = itemResolutionService;
    this.requiresSourceApproval = requiresSourceApproval;
    this.requiredSourceKinds = requiredSourceKinds;
    this.allowItem =
      allowItem ??
      ((item, descriptor, context = {}) => {
        const minimumItemAuthorityScore =
          context.minimumItemAuthorityScore ??
          Math.max(this.minSourceAuthorityScore, descriptor.minimumItemAuthorityScore);

        if (item.sourceAuthorityScore < minimumItemAuthorityScore) {
          return false;
        }

        if (!context.requiresSourceApproval) {
          return true;
        }

        return (
          context.sourceStatus === "approved" &&
          context.sourceLifecycleState !== "retired"
        );
      });
  }

  async collect(window) {
    return this.contentFetcher.fetch(window);
  }

  async aggregate(window) {
    const collected = await this.collect(window);
    const sourceSnapshot = await this.loadSourceSnapshot(window);
    const historicalEditions = await this.loadHistoricalEditions(window);
    const historicalItems = extractHistoricalItems(historicalEditions);
    const historicalStorylines = buildHistoricalStorylineMap(historicalEditions);
    const exclusionTimestamp = resolveExclusionTimestamp(window);
    const sourceExclusionDecisions = [];
    const eligibleItems = collected.items.flatMap((item) => {
      const descriptor = this.registry.get(item.adapterIds[0])?.descriptor;
      if (!descriptor) {
        return [];
      }

      const context = this.buildItemCurationContext(item, descriptor, sourceSnapshot);
      const curatedItem = this.applySourceAuthorityContext(item, context);

      if (!this.allowItem(curatedItem, descriptor, context)) {
        const exclusionDecision = createSourceExclusionDecision(
          curatedItem,
          descriptor,
          {
            ...context,
            timestamp: exclusionTimestamp,
            evaluationContext: {
              stage: "source_gate",
              window: createEvaluationWindowSnapshot(window),
              source: {
                sourceId: context?.sourceId ?? null,
                sourceStatus: context?.sourceStatus ?? null,
                sourceLifecycleState: context?.sourceLifecycleState ?? null,
                requiresSourceApproval: Boolean(context?.requiresSourceApproval),
                minimumItemAuthorityScore: context?.minimumItemAuthorityScore ?? null,
                sourceAuthorityScore: context?.sourceAuthorityScore ?? null,
                weightedSourceAuthorityScore:
                  context?.weightedSourceAuthorityScore ?? null,
                effectiveSourceAuthorityScore:
                  context?.effectiveSourceAuthorityScore ?? null,
              },
            },
          },
        );

        if (exclusionDecision) {
          sourceExclusionDecisions.push(exclusionDecision);
        }

        return [];
      }

      return [curatedItem];
    });
    const candidateGroups = this.resolveHistoricalItemIds(
      groupDuplicateItems(eligibleItems, this.deduplicationHooks),
      historicalItems,
    );
    const storylineAnnotatedItems = candidateGroups.map((group) =>
      annotateStorylineRelationship(
        consolidateMatchedItems(group, this.deduplicationHooks),
        historicalStorylines.get(resolveTrackedItemId(group[0])) ?? [],
      ),
    );
    const scoredItems = await Promise.all(
      storylineAnnotatedItems.map(async (item) => {
        const {
          score,
          scoreVersion,
          scoreInterpretation,
          scoreBreakdown,
        } = await resolveScoreEvaluation(this.scoreItem, item, window);
        const scoredItem = createNormalizedItem({
          ...item,
          relevanceScore: score,
          scoreVersion,
          scoreInterpretation,
        });
        const curationDecision = createRelevanceCurationDecision(
          scoredItem,
          scoreVersion,
          scoreInterpretation,
          scoreBreakdown,
          this.minRelevanceScore,
        );

        return {
          item: withCurationDecisionMetadata(scoredItem, curationDecision),
          curationDecision,
        };
      }),
    );
    const curatedItems = scoredItems.map((entry) => entry.item);

    return {
      ...collected,
      fetchedItems: collected.items,
      scoredItems: curatedItems,
      candidateGroups,
      curationDecisions: scoredItems.map((entry) => entry.curationDecision),
      exclusionDecisions: [
        ...sourceExclusionDecisions,
        ...scoredItems
          .filter((entry) => entry.curationDecision.decision === "drop")
          .map((entry) =>
            createRelevanceExclusionDecision(entry.item, {
              ...entry.curationDecision,
              timestamp: exclusionTimestamp,
              evaluationContext: {
                stage: "relevance_gate",
                window: createEvaluationWindowSnapshot(window),
                relevance: {
                  minRelevanceScore: entry.curationDecision.minRelevanceScore,
                  relevanceScore: entry.curationDecision.relevanceScore,
                  scoreVersion: entry.curationDecision.scoreVersion,
                  scoreInterpretation: entry.curationDecision.scoreInterpretation,
                  scoreBreakdown: entry.curationDecision.scoreBreakdown,
                },
              },
            }),
          ),
      ],
      exclusionRecords: [
        ...sourceExclusionDecisions,
        ...scoredItems
          .filter((entry) => entry.curationDecision.decision === "drop")
          .map((entry) =>
            createRelevanceExclusionDecision(entry.item, {
              ...entry.curationDecision,
              timestamp: exclusionTimestamp,
              evaluationContext: {
                stage: "relevance_gate",
                window: createEvaluationWindowSnapshot(window),
                relevance: {
                  minRelevanceScore: entry.curationDecision.minRelevanceScore,
                  relevanceScore: entry.curationDecision.relevanceScore,
                  scoreVersion: entry.curationDecision.scoreVersion,
                  scoreInterpretation: entry.curationDecision.scoreInterpretation,
                  scoreBreakdown: entry.curationDecision.scoreBreakdown,
                },
              },
            }),
          ),
      ],
      items: sortCuratedItemsByRelevance(
        filterCuratedItemsByRelevance(curatedItems, this.minRelevanceScore),
      ),
    };
  }

  async loadHistoricalEditions(window) {
    if (!this.editionHistoryStore) {
      return [];
    }

    const now = window?.endsAt ?? new Date().toISOString();
    const history = await this.editionHistoryStore.loadHistory({ now });
    const currentEditionCutoffMs =
      window?.endsAt == null ? Number.POSITIVE_INFINITY : new Date(window.endsAt).getTime();
    return history.filter(
      (edition) => new Date(edition.publishedAt).getTime() < currentEditionCutoffMs,
    );
  }

  resolveHistoricalItemIds(candidateGroups, historicalItems) {
    if (!Array.isArray(historicalItems) || historicalItems.length === 0) {
      return candidateGroups;
    }

    return candidateGroups.map((group) => {
      const matchedHistoricalItem = this.itemResolutionService.matchGroup(
        group,
        historicalItems,
      );

      if (!matchedHistoricalItem) {
        return group;
      }

      const nextEditionCount = (matchedHistoricalItem.editionCount ?? 1) + 1;

      return group.map((item) =>
        item.itemId === matchedHistoricalItem.itemId &&
        item.firstSeen === matchedHistoricalItem.firstSeen &&
        item.editionCount === nextEditionCount
          ? item
          : {
              ...item,
              itemId: matchedHistoricalItem.itemId,
              canonicalIdentifiers: mergeCanonicalIdentifiers(
                matchedHistoricalItem.canonicalIdentifiers ?? null,
                item.canonicalIdentifiers ?? null,
              ),
              firstSeen: matchedHistoricalItem.firstSeen,
              editionCount: nextEditionCount,
              scopeVersion:
                readItemScopeVersion(matchedHistoricalItem) ?? readItemScopeVersion(item),
              metadata: {
                ...(item.metadata ?? {}),
                deduplicationClusterId: matchedHistoricalItem.itemId,
              },
            },
      );
    });
  }

  async loadSourceSnapshot(window) {
    if (!this.sourceRepository) {
      return null;
    }

    const now = window?.endsAt ?? new Date().toISOString();
    const snapshot = await this.sourceRepository.load({ now });

    return {
      ...snapshot,
      sourceMap: new Map(snapshot.sources.map((source) => [source.id, source])),
    };
  }

  buildItemCurationContext(item, descriptor, sourceSnapshot) {
    const minimumItemAuthorityScore = Math.max(
      this.minSourceAuthorityScore,
      descriptor.minimumItemAuthorityScore,
    );

    if (!sourceSnapshot) {
      return {
        minimumItemAuthorityScore,
        requiresSourceApproval: false,
        sourceStatus: null,
        sourceLifecycleState: null,
      };
    }

    const requiresSourceApproval = this.requiresSourceApproval(item, descriptor);
    const resolvedSource = resolveItemSource(item, sourceSnapshot.sourceMap);
    const sourceAuthorityScore = resolvedSource?.authorityScore ?? null;
    const weightedSourceAuthorityScore =
      resolvedSource == null
        ? null
        : resolveWeightedSourceAuthorityScore(
            resolvedSource,
            this.sourceRepository?.config,
          );

    return {
      minimumItemAuthorityScore,
      requiresSourceApproval,
      sourceId: resolvedSource?.id ?? null,
      sourceStatus: resolvedSource?.status ?? null,
      sourceLifecycleState:
        resolvedSource == null ? null : resolveSourceLifecycleState(resolvedSource),
      sourceAuthorityScore,
      weightedSourceAuthorityScore,
      effectiveSourceAuthorityScore: resolveEffectiveSourceAuthorityScore(
        item.sourceAuthorityScore,
        sourceAuthorityScore,
      ),
      effectiveScoringSourceAuthorityScore: resolveEffectiveSourceAuthorityScore(
        item.scoringSignals?.sourceAuthority ?? item.sourceAuthorityScore,
        weightedSourceAuthorityScore ?? sourceAuthorityScore,
      ),
    };
  }

  applySourceAuthorityContext(item, context = {}) {
    const effectiveSourceAuthorityScore =
      context.effectiveSourceAuthorityScore ?? item.sourceAuthorityScore;
    const effectiveScoringSourceAuthorityScore =
      context.effectiveScoringSourceAuthorityScore ??
      item.scoringSignals?.sourceAuthority ??
      effectiveSourceAuthorityScore;

    if (effectiveSourceAuthorityScore === item.sourceAuthorityScore) {
      if (effectiveScoringSourceAuthorityScore === item.scoringSignals?.sourceAuthority) {
        return item;
      }
    }

    return createNormalizedItem({
      ...item,
      sourceAuthorityScore: effectiveSourceAuthorityScore,
      scoringSignals: {
        ...item.scoringSignals,
        sourceAuthority: effectiveScoringSourceAuthorityScore,
      },
    });
  }
}

function extractHistoricalItems(historicalEditions) {
  const historicalItems = [];
  const seenIds = new Set();

  for (const edition of historicalEditions) {
    for (const item of edition.items ?? []) {
      if (!item?.id || seenIds.has(item.id)) {
        continue;
      }

      seenIds.add(item.id);
      historicalItems.push(item);
    }
  }

  return historicalItems;
}

function resolveTrackedItemId(item) {
  return item?.itemId ?? item?.id ?? null;
}

function readItemScopeVersion(item) {
  const value =
    item?.scopeVersion ??
    item?.scope_version ??
    item?.metadata?.scopeVersion ??
    item?.metadata?.scope_version ??
    item?.metadata?.scope?.version ??
    null;

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function defaultRequiresSourceApproval(item, descriptor) {
  return descriptor.kind === "web";
}

function resolveItemSource(item, sourceMap) {
  const candidate = buildSourceCandidate(item.sourceUrl);

  if (!candidate) {
    return null;
  }

  return sourceMap.get(candidate.id) ?? null;
}

function resolveEffectiveSourceAuthorityScore(itemAuthorityScore, sourceAuthorityScore) {
  if (sourceAuthorityScore == null) {
    return itemAuthorityScore;
  }

  return Math.max(itemAuthorityScore ?? 0, sourceAuthorityScore);
}

async function resolveScoreEvaluation(scoreItem, item, window) {
  const scoreResult = await scoreItem(item, window);
  const score = extractScore(scoreResult);

  if (score == null) {
    throw new TypeError("scoreItem must resolve to a finite number or an object with score");
  }

  const providedBreakdown =
    extractScoreBreakdown(scoreResult) ??
    (typeof scoreItem.getBreakdown === "function"
      ? await scoreItem.getBreakdown(item, window)
      : null);
  const scoreVersion =
    extractScoreVersion(scoreResult) ??
    extractScoreVersion(providedBreakdown) ??
    extractScoreVersion(scoreItem) ??
    DEFAULT_RELEVANCE_SCORE_VERSION;
  const scoreInterpretation =
    extractScoreInterpretation(scoreResult) ??
    extractScoreInterpretation(providedBreakdown) ??
    extractScoreInterpretation(scoreItem) ??
    DEFAULT_RELEVANCE_SCORE_INTERPRETATION;

  return {
    score,
    scoreVersion,
    scoreInterpretation,
    scoreBreakdown: normalizeScoreBreakdown(
      providedBreakdown,
      score,
      scoreVersion,
      scoreInterpretation,
      item,
    ),
  };
}

function extractScore(scoreResult) {
  if (typeof scoreResult === "number" && Number.isFinite(scoreResult)) {
    return scoreResult;
  }

  if (!scoreResult || typeof scoreResult !== "object" || Array.isArray(scoreResult)) {
    return null;
  }

  for (const fieldName of ["score", "relevanceScore"]) {
    if (
      typeof scoreResult[fieldName] === "number" &&
      Number.isFinite(scoreResult[fieldName])
    ) {
      return scoreResult[fieldName];
    }
  }

  return null;
}

function extractScoreBreakdown(scoreResult) {
  if (!scoreResult || typeof scoreResult !== "object" || Array.isArray(scoreResult)) {
    return null;
  }

  return scoreResult.scoreBreakdown ?? scoreResult.breakdown ?? null;
}

function extractScoreVersion(scoreResult) {
  if (!scoreResult || typeof scoreResult !== "object" || Array.isArray(scoreResult)) {
    return null;
  }

  for (const fieldName of ["scoreVersion", "score_version", "version"]) {
    if (typeof scoreResult[fieldName] === "string" && scoreResult[fieldName].trim().length > 0) {
      return scoreResult[fieldName].trim();
    }
  }

  return null;
}

function extractScoreInterpretation(scoreResult) {
  if (!scoreResult || typeof scoreResult !== "object" || Array.isArray(scoreResult)) {
    return null;
  }

  for (const fieldName of [
    "scoreInterpretation",
    "score_interpretation",
    "interpretation",
  ]) {
    if (
      typeof scoreResult[fieldName] === "string" &&
      scoreResult[fieldName].trim().length > 0
    ) {
      return scoreResult[fieldName].trim();
    }
  }

  return null;
}

function normalizeScoreBreakdown(
  breakdown,
  score,
  scoreVersion,
  scoreInterpretation,
  item,
) {
  const divergenceFlag = hasHighSentimentDivergence(item);

  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) {
    return {
      score,
      scoreVersion,
      scoreInterpretation,
      divergenceFlag,
    };
  }

  return {
    ...breakdown,
    score,
    scoreVersion,
    scoreInterpretation,
    divergenceFlag:
      typeof breakdown.divergenceFlag === "boolean"
        ? breakdown.divergenceFlag
        : divergenceFlag,
  };
}

function createRelevanceCurationDecision(
  item,
  scoreVersion,
  scoreInterpretation,
  scoreBreakdown,
  minRelevanceScore,
) {
  const decision = item.relevanceScore >= minRelevanceScore ? "keep" : "drop";

  return {
    itemId: item.itemId,
    name: item.name,
    sourceUrl: item.sourceUrl,
    relevanceScore: item.relevanceScore,
    scoreVersion,
    scoreInterpretation,
    divergenceFlag: item.divergenceFlag,
    minRelevanceScore,
    decision,
    scoreBreakdown,
  };
}

function createSourceExclusionDecision(item, descriptor, context) {
  const exclusion = createSourceExclusion(item, context);

  if (exclusion) {
    return exclusion;
  }

  return createSourceExclusion(item, {
    ...context,
    minimumItemAuthorityScore:
      context?.minimumItemAuthorityScore ??
      Math.max(0, descriptor?.minimumItemAuthorityScore ?? 0),
  });
}

function createRelevanceExclusionDecision(item, curationDecision) {
  return createRelevanceExclusion(item, curationDecision);
}

function createEvaluationWindowSnapshot(window) {
  if (!window || typeof window !== "object") {
    return null;
  }

  return {
    startsAt: window.startsAt ?? null,
    endsAt: window.endsAt ?? null,
    timezone: window.timezone ?? null,
  };
}

function resolveExclusionTimestamp(window) {
  return window?.endsAt ?? new Date().toISOString();
}

function withCurationDecisionMetadata(item, curationDecision) {
  return {
    ...item,
    metadata: {
      ...item.metadata,
      curation: {
        ...(item.metadata?.curation ?? {}),
        relevanceGate: {
          minRelevanceScore: curationDecision.minRelevanceScore,
          relevanceScore: curationDecision.relevanceScore,
          scoreVersion: curationDecision.scoreVersion,
          scoreInterpretation: curationDecision.scoreInterpretation,
          divergenceFlag: curationDecision.divergenceFlag,
          decision: curationDecision.decision,
          scoreBreakdown: curationDecision.scoreBreakdown,
        },
      },
    },
  };
}
