import { createRelevanceScoreBreakdown } from "../core/relevance-scoring.js";
import { CONTENT_CATEGORIES } from "../core/contracts.js";
import { createDiscoveredSource } from "../core/schema.js";
import { DEFAULT_DISCOVERY_CONFIG } from "./config.js";
import {
  buildSourceCandidate,
  extractOutboundLinks,
  normalizeUrl,
} from "./link-extractor.js";
import { evaluateLowSignalSources as evaluateLowSignalSourcesForMap } from "./low-signal-evaluator.js";
import { collectTopicHits, scoreSource } from "./scoring.js";
import {
  finalizeSourceExpertiseSignal,
  recordSourceExpertiseObservation,
  resolveWeightedSourceAuthorityScore,
  scoreSourceAuthority,
} from "./source-authority.js";
import {
  SOURCE_LIFECYCLE_STAGES,
  SOURCE_LIFECYCLE_STATES,
  SOURCE_RESTORE_REASONS,
  markSourceCandidate,
  normalizeSourceLifecycle,
  normalizeSourcePerformance,
  recordSourcePromotionObservation,
  recordSourceSignalObservation,
  restoreSource,
  startSourceProbation,
} from "./source-lifecycle.js";

const SOURCE_STATUS_ORDER = {
  approved: 0,
  candidate: 1,
  retired: 2,
};
const LOW_VALUE_WEB_PATH_SEGMENTS = new Set([
  "about",
  "account",
  "auth",
  "billing",
  "careers",
  "contact",
  "cookies",
  "faq",
  "help",
  "home",
  "legal",
  "login",
  "pricing",
  "privacy",
  "register",
  "share",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "status",
  "subscribe",
  "support",
  "terms",
]);
const HIGH_VALUE_WEB_PATH_SEGMENTS = new Set([
  "agent",
  "agents",
  "api",
  "apis",
  "docs",
  "documentation",
  "framework",
  "frameworks",
  "get-started",
  "getting-started",
  "guide",
  "guides",
  "install",
  "integration",
  "integrations",
  "library",
  "libraries",
  "mcp",
  "quickstart",
  "reference",
  "references",
  "sdk",
  "sdks",
  "tool",
  "tools",
  "tutorial",
  "tutorials",
]);

export class SourceDiscoveryService {
  constructor({ repository, config = {} }) {
    if (!repository) {
      throw new Error("SourceDiscoveryService requires a repository");
    }

    this.repository = repository;
    this.config = resolveDiscoveryConfig(repository.config, config);
    this.repository.config = this.config;
  }

  async discoverFromItems(
    items,
    {
      now = new Date().toISOString(),
      cycleId,
      scoredItems = [],
      discoveredSources = [],
    } = {},
  ) {
    const snapshot = await this.repository.load({ now });
    const sourceMap = new Map(snapshot.sources.map((source) => [source.id, source]));
    const effectiveCycleId = cycleId ?? now.slice(0, 10);
    const approvedAtCycleStart = buildApprovedSourceIdSet(snapshot.sources);
    const observedSourceIds = new Set();
    const newlyApproved = [];
    const restoredSources = [];
    const discoveryInputs = [
      ...(Array.isArray(items) ? items : []),
      ...expandDiscoveredSourcesIntoDiscoveryItems(discoveredSources, this.config),
    ];

    for (const item of discoveryInputs) {
      const observedSource = this.resolveObservedSource(item, sourceMap);

      if (observedSource) {
        observeSource(observedSource, item, effectiveCycleId, now);
        observedSourceIds.add(observedSource.id);
      }

      const referrer = this.resolveReferrer(item.sourceUrl, sourceMap);

      for (const candidate of collectSourceCandidates(item, this.config)) {

        if (candidate.id === referrer?.id) {
          continue;
        }

        const existing = sourceMap.get(candidate.id);
        const merged = mergeEvidence({
          existing,
          candidate,
          referrer,
          item,
          now,
          cycleId: effectiveCycleId,
          config: this.config
        });
        const previousStatus = existing?.status;
        const scores = scoreSource(merged, this.config);

        merged.signalScore = scores.signalScore;
        merged.authorityScore = scores.authorityScore;
        merged.status = scores.approved ? "approved" : "candidate";
        observedSourceIds.add(merged.id);

        if (merged.status === "approved") {
          merged.approvedAt ??= now;

          if (previousStatus === "retired" && !merged.seed) {
            restoreSource(
              merged,
              {
                now,
                reason: SOURCE_RESTORE_REASONS.renewedSignal,
                targetState: SOURCE_LIFECYCLE_STATES.probation,
                evidence: {
                  cycleId: effectiveCycleId,
                  sourceUrl: item.sourceUrl,
                  itemExternalId:
                    item.metadata?.externalId ?? item.externalId ?? item.id ?? null,
                  relevanceScore:
                    typeof item.relevanceScore === "number"
                      ? item.relevanceScore
                      : null,
                  authorityScore: merged.authorityScore,
                  signalScore: merged.signalScore,
                },
              },
              this.config,
            );
            newlyApproved.push(merged);
            restoredSources.push(merged);
          } else if (previousStatus !== "approved" && !merged.seed) {
            startSourceProbation(merged, now, this.config);
            newlyApproved.push(merged);
          }

          recordSourceSignalObservation(merged, effectiveCycleId, now, this.config);
        } else {
          markSourceCandidate(merged, now, this.config);
        }

        sourceMap.set(merged.id, merged);
      }
    }

    const newlyPromoted = applyPromotionObservations({
      sourceMap,
      items: scoredItems,
      observedSourceIds,
      now,
      cycleId: effectiveCycleId,
      config: this.config,
    });
    const retirementEvaluation = evaluateLowSignalSourcesForMap({
      sourceMap,
      approvedAtCycleStart,
      observedSourceIds,
      now,
      cycleId: effectiveCycleId,
      config: this.config,
    });
    const nextSnapshot = buildPersistedSnapshot(sourceMap, now, this.config);

    await this.repository.save(nextSnapshot);

    return buildSourceStateResult(nextSnapshot, this.config, {
      newlyApproved,
      restoredSources: deduplicateSources(restoredSources),
      newlyPromoted,
      newlyRetired: retirementEvaluation.newlyRetired,
      categoryCoverageStatuses: retirementEvaluation.categoryCoverageStatuses,
      lowSignalEvaluations: retirementEvaluation.lowSignalEvaluations,
    });
  }

  async evaluateLowSignalSources({
    now = new Date().toISOString(),
    cycleId,
    observedSourceIds = [],
    approvedSourceIds = null,
  } = {}) {
    const snapshot = await this.repository.load({ now });
    const sourceMap = new Map(snapshot.sources.map((source) => [source.id, source]));
    const effectiveCycleId = cycleId ?? now.slice(0, 10);
    const retirementEvaluation = evaluateLowSignalSourcesForMap({
      sourceMap,
      approvedAtCycleStart:
        approvedSourceIds == null
          ? buildApprovedSourceIdSet(snapshot.sources)
          : approvedSourceIds,
      observedSourceIds,
      now,
      cycleId: effectiveCycleId,
      config: this.config,
    });
    const nextSnapshot = buildPersistedSnapshot(sourceMap, now, this.config);

    await this.repository.save(nextSnapshot);

    return buildSourceStateResult(nextSnapshot, this.config, {
      newlyRetired: retirementEvaluation.newlyRetired,
      categoryCoverageStatuses: retirementEvaluation.categoryCoverageStatuses,
      lowSignalEvaluations: retirementEvaluation.lowSignalEvaluations,
    });
  }

  resolveReferrer(sourceUrl, sourceMap) {
    if (!sourceUrl) {
      return null;
    }

    const candidate = buildSourceCandidate(sourceUrl, this.config);

    if (!candidate) {
      return null;
    }

    return sourceMap.get(candidate.id) ?? {
      ...candidate,
      status: "external",
      seed: false
    };
  }

  resolveObservedSource(item, sourceMap) {
    const approvedSourceId = item?.metadata?.approvedSourceId;

    if (typeof approvedSourceId === "string" && approvedSourceId.length > 0) {
      return sourceMap.get(approvedSourceId) ?? null;
    }

    if (!item?.sourceUrl) {
      return null;
    }

    const candidate = buildSourceCandidate(item.sourceUrl, this.config);

    if (!candidate) {
      return null;
    }

    return sourceMap.get(candidate.id) ?? null;
  }
}

function mergeEvidence({ existing, candidate, referrer, item, now, cycleId, config }) {
  const record = existing
    ? structuredClone(existing)
    : {
        id: candidate.id,
        kind: candidate.kind,
        entityType: candidate.entityType,
        platform: candidate.platform,
        value: candidate.value,
        displayName: candidate.displayName,
        url: candidate.url,
        canonicalUrl: candidate.canonicalUrl,
        fetchUrl: candidate.fetchUrl,
        status: "candidate",
        seed: false,
        authorityScore: 0,
        signalScore: 0,
        discoveredAt: now,
        approvedAt: null,
        lastSeenAt: now,
        lifecycle: {
          state: SOURCE_LIFECYCLE_STATES.probation,
          stage: SOURCE_LIFECYCLE_STAGES.probation,
          probationStartedAt: now,
          activatedAt: null,
          retiredAt: null,
          qualifyingCycles: [],
        },
        evidence: {
          discoveryCount: 0,
          referrers: [],
          trustedReferrers: [],
          seedReferrers: [],
          referrerPlatforms: [],
          cyclesSeen: [],
          topicHits: [],
          categoryCoverage: [],
          exampleUrls: [],
          authoritySignals: {
            observed: false,
            citationCount: 0,
            referrers: [],
            sourceKinds: [],
            cyclesSeen: [],
            githubStars: 0,
            githubActivity: 0
          },
          signalQuality: {
            observationCount: 0,
            totalScore: 0,
            averageScore: 0,
            bestScore: 0,
            highSignalObservationCount: 0,
            highSignalCycles: [],
            preferredFetchUrl: null,
            preferredFetchScore: 0,
            lastObservedAt: null,
          }
        },
        discoveredFromUrls: []
      };

  record.canonicalUrl = candidate.canonicalUrl;
  record.fetchUrl ??= candidate.fetchUrl;
  record.lastSeenAt = now;
  record.kind = candidate.kind;
  record.entityType = candidate.entityType;
  record.platform = candidate.platform;
  record.value = candidate.value;
  record.displayName = candidate.displayName;
  record.url = candidate.url;

  record.evidence.discoveryCount += 1;
  pushUnique(record.evidence.cyclesSeen, cycleId, 14);
  pushUnique(record.evidence.exampleUrls, candidate.discoveredUrl, config.maxExampleUrls);
  pushUnique(
    record.discoveredFromUrls,
    normalizeUrl(item.sourceUrl)?.toString() ?? null,
    config.maxExampleUrls,
  );

  const topicHits = collectTopicHits(
    [
      candidate.canonicalUrl,
      item.title,
      item.summary,
      item.content,
      item.sourceUrl
    ],
    config
  );

  for (const hit of topicHits) {
    pushUnique(record.evidence.topicHits, hit, config.topicalKeywords.length);
  }

  recordSourceCategoryCoverage(record, item);

  if (referrer) {
    pushUnique(record.evidence.referrers, referrer.id, config.maxStoredReferrers);
    pushUnique(
      record.evidence.referrerPlatforms,
      referrer.platform ?? "web",
      config.maxStoredReferrers
    );

    if (referrer.status === "approved") {
      pushUnique(
        record.evidence.trustedReferrers,
        referrer.id,
        config.maxStoredReferrers
      );
    }

    if (referrer.seed) {
      pushUnique(
        record.evidence.seedReferrers,
        referrer.id,
        config.maxStoredReferrers
      );
    }
  }

  applyAuthoritySignals(record, item, referrer, cycleId, config);
  applySignalQualityObservation(record, item, candidate, cycleId, now, config);

  return record;
}

function collectSourceCandidates(item, config = DEFAULT_DISCOVERY_CONFIG) {
  const candidatesById = new Map();

  for (const link of extractOutboundLinks(item)) {
    const candidate = buildSourceCandidate(link, config);

    if (!candidate) {
      continue;
    }

    const existing = candidatesById.get(candidate.id);

    if (!existing || isPreferredCandidate(candidate, existing)) {
      candidatesById.set(candidate.id, candidate);
    }
  }

  return Array.from(candidatesById.values());
}

function expandDiscoveredSourcesIntoDiscoveryItems(
  discoveredSources,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  if (!Array.isArray(discoveredSources) || discoveredSources.length === 0) {
    return [];
  }

  const discoveryItems = [];

  for (const discoveredSource of discoveredSources) {
    const candidate = buildSourceCandidate(discoveredSource?.url, config);

    if (!candidate) {
      continue;
    }

    const normalizedOrigins = normalizeDiscoveredSourceOrigins(
      discoveredSource?.discoveredFromUrls,
    ).filter((originUrl) => {
      const referrer = buildSourceCandidate(originUrl, config);
      return referrer?.id !== candidate.id;
    });

    if (normalizedOrigins.length === 0) {
      discoveryItems.push(
        createSyntheticDiscoveryItem({
          discoveredSource,
          candidate,
          relevanceScore: resolveDiscoveredSourceRelevanceScore(discoveredSource),
        }),
      );
      continue;
    }

    for (const sourceUrl of normalizedOrigins) {
      discoveryItems.push(
        createSyntheticDiscoveryItem({
          discoveredSource,
          candidate,
          sourceUrl,
          relevanceScore: resolveDiscoveredSourceRelevanceScore(discoveredSource),
        }),
      );
    }
  }

  return discoveryItems;
}

function createSyntheticDiscoveryItem({
  discoveredSource,
  candidate,
  sourceUrl = null,
  relevanceScore = null,
}) {
  const targetUrl = candidate.discoveredUrl ?? discoveredSource?.url ?? candidate.url;
  const content = [
    targetUrl,
    ...(Array.isArray(discoveredSource?.discoveredFromUrls)
      ? discoveredSource.discoveredFromUrls
      : []),
  ]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join(" ");
  const item = {
    title: discoveredSource?.displayName ?? candidate.displayName,
    summary: `Discovered source candidate ${discoveredSource?.displayName ?? candidate.displayName}`,
    content,
    outboundLinks: [targetUrl],
    metadata: {
      syntheticDiscoveredSource: true,
    },
  };

  if (typeof sourceUrl === "string" && sourceUrl.length > 0) {
    item.sourceUrl = sourceUrl;
  }

  if (typeof relevanceScore === "number" && Number.isFinite(relevanceScore)) {
    item.relevanceScore = clampScore(relevanceScore);
  }

  return item;
}

function normalizeDiscoveredSourceOrigins(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const normalized = [];

  for (const value of values) {
    const url = normalizeUrl(value)?.toString();

    if (!url || normalized.includes(url)) {
      continue;
    }

    normalized.push(url);
  }

  return normalized;
}

function resolveDiscoveredSourceRelevanceScore(discoveredSource) {
  const score =
    discoveredSource?.weightedAuthorityScore ?? discoveredSource?.authorityScore ?? null;

  if (typeof score !== "number" || !Number.isFinite(score)) {
    return null;
  }

  return clampScore(score);
}

function isPreferredCandidate(candidate, existing) {
  const candidatePreference = measureCandidatePreference(candidate);
  const existingPreference = measureCandidatePreference(existing);

  if (candidatePreference !== existingPreference) {
    return candidatePreference > existingPreference;
  }

  return String(candidate?.discoveredUrl ?? "").length >
    String(existing?.discoveredUrl ?? "").length;
}

function measureCandidatePreference(candidate) {
  return (
    measureUrlSpecificity(candidate?.discoveredUrl) +
    measurePathSignalQuality(candidate)
  );
}

function pushUnique(list, value, maxSize) {
  if (value == null || list.includes(value)) {
    return;
  }

  list.push(value);

  if (list.length > maxSize) {
    list.splice(0, list.length - maxSize);
  }
}

function applyAuthoritySignals(record, item, referrer, cycleId, config) {
  const authoritySignals = ensureAuthoritySignals(record);
  const observation = buildAuthorityObservation(item, referrer);

  if (!observation) {
    return;
  }

  authoritySignals.observed = true;
  authoritySignals.citationCount += 1;
  pushUnique(authoritySignals.referrers, observation.referrerId, config.maxStoredReferrers);
  pushUnique(authoritySignals.sourceKinds, observation.sourceKind, config.maxStoredReferrers);
  pushUnique(authoritySignals.cyclesSeen, cycleId, 14);
  authoritySignals.githubStars = Math.max(
    authoritySignals.githubStars ?? 0,
    observation.githubStars ?? 0
  );
  authoritySignals.githubActivity = Math.max(
    authoritySignals.githubActivity ?? 0,
    observation.githubActivity ?? 0
  );
}

function ensureAuthoritySignals(record) {
  record.evidence.authoritySignals ??= {
    observed: false,
    citationCount: 0,
    referrers: [],
    sourceKinds: [],
    cyclesSeen: [],
    githubStars: 0,
    githubActivity: 0
  };
  record.evidence.authoritySignals.observed ??= false;

  return record.evidence.authoritySignals;
}

function ensureSignalQuality(record) {
  record.evidence.signalQuality ??= {
    observationCount: 0,
    totalScore: 0,
    averageScore: 0,
    bestScore: 0,
    highSignalObservationCount: 0,
    highSignalCycles: [],
    preferredFetchUrl: null,
    preferredFetchScore: 0,
    lastObservedAt: null,
  };

  return record.evidence.signalQuality;
}

function buildAuthorityObservation(item, referrer) {
  if (!contributesExternalAuthority(item)) {
    return null;
  }

  const sourceKind = referrer?.kind ?? resolveItemSourceKind(item);
  const referrerId = referrer?.id ?? item?.sourceUrl ?? null;

  if (!sourceKind || !referrerId) {
    return null;
  }

  return {
    referrerId,
    sourceKind,
    githubStars: toNonNegativeMetric(
      item?.scoringSignals?.githubStars ?? item?.metadata?.github?.stars
    ) ?? 0,
    githubActivity: toNonNegativeMetric(item?.scoringSignals?.githubActivity) ?? 0
  };
}

function applySignalQualityObservation(
  record,
  item,
  candidate,
  cycleId,
  now,
  config,
) {
  const signalQuality = ensureSignalQuality(record);
  const qualityScore = resolveSignalQualityScore(item, candidate, now);

  if (qualityScore == null) {
    return;
  }

  signalQuality.observationCount += 1;
  signalQuality.totalScore += qualityScore;
  signalQuality.averageScore = Math.round(
    signalQuality.totalScore / signalQuality.observationCount,
  );
  signalQuality.bestScore = Math.max(signalQuality.bestScore ?? 0, qualityScore);
  signalQuality.lastObservedAt = now;

  if (qualityScore >= resolveHighSignalItemScore(config)) {
    signalQuality.highSignalObservationCount += 1;
    pushUnique(signalQuality.highSignalCycles, cycleId, 14);
  }

  if (candidate.kind !== "web") {
    return;
  }

  const currentPreferredFetchScore = signalQuality.preferredFetchScore ?? 0;

  if (
    signalQuality.preferredFetchUrl == null ||
    qualityScore > currentPreferredFetchScore ||
    (qualityScore === currentPreferredFetchScore &&
      isMoreSpecificUrl(candidate.discoveredUrl, signalQuality.preferredFetchUrl))
  ) {
    signalQuality.preferredFetchUrl = candidate.discoveredUrl;
    signalQuality.preferredFetchScore = qualityScore;
    record.fetchUrl = candidate.discoveredUrl;
  }
}

function contributesExternalAuthority(item) {
  const adapterIds = resolveAdapterIds(item);

  if (adapterIds.includes("web-discovery")) {
    return false;
  }

  return item?.metadata?.approvedSourceId == null;
}

function resolveAdapterIds(item) {
  if (Array.isArray(item?.adapterIds)) {
    return item.adapterIds.filter((value) => typeof value === "string" && value.length);
  }

  return typeof item?.adapterId === "string" && item.adapterId.length ? [item.adapterId] : [];
}

function resolveItemSourceKind(item) {
  if (Array.isArray(item?.sourceKinds) && item.sourceKinds.length > 0) {
    return item.sourceKinds.find((value) => typeof value === "string" && value.length) ?? null;
  }

  return typeof item?.sourceType === "string" && item.sourceType.length
    ? item.sourceType
    : null;
}

function resolveSignalQualityScore(item, candidate, now) {
  const itemScore =
    typeof item?.relevanceScore === "number" && Number.isFinite(item.relevanceScore)
      ? clampScore(item.relevanceScore)
      : createRelevanceScoreBreakdown(item, { endsAt: now }).score;

  return clampScore(itemScore + measureCandidateSignalQuality(candidate));
}

function resolveHighSignalItemScore(config = DEFAULT_DISCOVERY_CONFIG) {
  const threshold = config.highSignalItemScore ?? DEFAULT_DISCOVERY_CONFIG.highSignalItemScore;

  return clampScore(threshold);
}

function resolveSourceExpertiseDomains(item) {
  const domains = [];

  if (
    typeof item?.category === "string" &&
    CONTENT_CATEGORIES.includes(item.category)
  ) {
    domains.push(item.category);
  }

  if (Array.isArray(item?.metadata?.categories)) {
    for (const value of item.metadata.categories) {
      if (typeof value === "string" && value.trim().length > 0) {
        domains.push(value.trim().toLowerCase());
      }
    }
  }

  return [...new Set(domains)];
}

function isMoreSpecificUrl(candidateUrl, currentUrl) {
  const candidateSpecificity = measureUrlSpecificity(candidateUrl);
  const currentSpecificity = measureUrlSpecificity(currentUrl);

  return candidateSpecificity > currentSpecificity;
}

function measureUrlSpecificity(value) {
  if (typeof value !== "string" || value.length === 0) {
    return 0;
  }

  try {
    const url = new URL(value);
    const pathSegments = url.pathname.split("/").filter(Boolean).length;
    const searchTerms = [...url.searchParams.keys()].length;

    return pathSegments * 10 + searchTerms;
  } catch {
    return 0;
  }
}

function measurePathSignalQuality(candidate) {
  if (candidate?.kind !== "web" || typeof candidate?.discoveredUrl !== "string") {
    return 0;
  }

  try {
    const url = new URL(candidate.discoveredUrl);
    const pathSegments = url.pathname
      .split("/")
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean);

    if (pathSegments.length === 0) {
      return 0;
    }

    const highValueHits = pathSegments.filter((segment) =>
      HIGH_VALUE_WEB_PATH_SEGMENTS.has(segment),
    ).length;

    if (pathSegments.some((segment) => LOW_VALUE_WEB_PATH_SEGMENTS.has(segment))) {
      return Math.max(-20, highValueHits * 4 - 20);
    }

    return Math.min(highValueHits * 6, 18);
  } catch {
    return 0;
  }
}

function measureCandidateSignalQuality(candidate) {
  return (
    measurePathSignalQuality(candidate) +
    Math.min(measureUrlSpecificity(candidate?.discoveredUrl), 30) / 10
  );
}

function sortSources(left, right, config = DEFAULT_DISCOVERY_CONFIG) {
  if (left.status !== right.status) {
    return statusOrder(left.status) - statusOrder(right.status);
  }

  const leftWeightedAuthorityScore = resolveWeightedSourceAuthorityScore(left, config);
  const rightWeightedAuthorityScore = resolveWeightedSourceAuthorityScore(right, config);

  if (rightWeightedAuthorityScore !== leftWeightedAuthorityScore) {
    return rightWeightedAuthorityScore - leftWeightedAuthorityScore;
  }

  if ((right.authorityScore ?? 0) !== (left.authorityScore ?? 0)) {
    return (right.authorityScore ?? 0) - (left.authorityScore ?? 0);
  }

  return left.id.localeCompare(right.id);
}

function statusOrder(status) {
  return SOURCE_STATUS_ORDER[status] ?? Number.MAX_SAFE_INTEGER;
}

function observeSource(source, item, cycleId, now) {
  if (!source) {
    return null;
  }

  source.lastSeenAt = now;
  pushUnique(source.evidence.cyclesSeen, cycleId, 14);
  recordSourceCategoryCoverage(source, item);
  recordSourceSignalObservation(source, cycleId, now);

  return source;
}

function applyPromotionObservations({
  sourceMap,
  items,
  observedSourceIds,
  now,
  cycleId,
  config,
}) {
  const newlyPromoted = [];
  const expertiseSourceIds = new Set();
  const promotionScoresBySourceId = new Map();

  for (const item of items) {
    const sourceId = item?.metadata?.approvedSourceId;

    if (typeof sourceId !== "string" || sourceId.length === 0) {
      continue;
    }

    const source = sourceMap.get(sourceId);

    if (!source || source.seed || source.status !== "approved") {
      continue;
    }

    observedSourceIds?.add(source.id);
    recordSourceSignalObservation(source, cycleId, now, config);
    recordSourceCategoryCoverage(source, item);
    recordSourceExpertiseObservation(
      source,
      {
        itemId: item?.itemId ?? item?.id,
        cycleId,
        observedAt: now,
        relevanceScore: item?.relevanceScore,
        domains: resolveSourceExpertiseDomains(item),
      },
      config,
    );
    expertiseSourceIds.add(source.id);
    promotionScoresBySourceId.set(
      source.id,
      selectHigherPromotionScore(
        promotionScoresBySourceId.get(source.id),
        item?.relevanceScore,
      ),
    );
  }

  for (const [sourceId, relevanceScore] of promotionScoresBySourceId) {
    const source = sourceMap.get(sourceId);

    if (!source) {
      continue;
    }

    const result = recordSourcePromotionObservation(
      source,
      {
        cycleId,
        observedAt: now,
        relevanceScore,
      },
      config,
    );

    if (result.promoted) {
      newlyPromoted.push(source);
    }
  }

  for (const source of sourceMap.values()) {
    if (
      !expertiseSourceIds.has(source.id) &&
      (source?.evidence?.authoritySignals?.expertise?.trackedItems?.length ?? 0) === 0
    ) {
      continue;
    }

    finalizeSourceExpertiseSignal(
      source,
      {
        cycleId,
        observedAt: now,
      },
      config,
    );

    if (expertiseSourceIds.has(source.id)) {
      source.authorityScore = scoreSourceAuthority(source, config);
    }
  }

  return deduplicateSources(newlyPromoted);
}

function deduplicateSources(sources) {
  return Array.from(new Map(sources.map((source) => [source.id, source])).values());
}

function selectHigherPromotionScore(currentScore, nextScore) {
  if (typeof nextScore !== "number" || !Number.isFinite(nextScore)) {
    return currentScore;
  }

  if (typeof currentScore !== "number" || !Number.isFinite(currentScore)) {
    return nextScore;
  }

  return nextScore > currentScore ? nextScore : currentScore;
}

function buildApprovedSourceIdSet(sources) {
  return new Set(
    sources
      .filter((source) => source.status === "approved" && source.seed !== true)
      .map((source) => source.id),
  );
}

function buildPersistedSnapshot(sourceMap, now, config) {
  return {
    version: 1,
    updatedAt: now,
    sources: Array.from(sourceMap.values())
      .map((source) => {
        const lifecycle = normalizeSourceLifecycle(source, config);
        const performance = normalizeSourcePerformance(source);

        return {
          ...source,
          authorityScore:
            source.seed === true
              ? source.authorityScore
              : scoreSourceAuthority(
                  {
                    ...source,
                    lifecycle,
                  },
                  config,
                ),
          lifecycle,
          performance,
        };
      })
      .sort((left, right) => sortSources(left, right, config)),
  };
}

function buildSourceStateResult(
  snapshot,
  config,
  {
    newlyApproved = [],
    restoredSources = [],
    newlyPromoted = [],
    newlyRetired = [],
    categoryCoverageStatuses = [],
    lowSignalEvaluations = [],
  } = {},
) {
  return {
    approvedSources: snapshot.sources.filter((source) => source.status === "approved"),
    candidateSources: snapshot.sources.filter((source) => source.status === "candidate"),
    retiredSources: snapshot.sources.filter((source) => source.status === "retired"),
    approvedDiscoveredSources: snapshot.sources
      .filter((source) => source.status === "approved" && !source.seed)
      .map((source) => toDiscoveredSource(source, config)),
    newlyApproved,
    restoredSources,
    newlyPromoted,
    newlyRetired,
    categoryCoverageStatuses,
    lowSignalEvaluations,
    snapshot,
  };
}

function toDiscoveredSource(source, config = DEFAULT_DISCOVERY_CONFIG) {
  return createDiscoveredSource(source, { config });
}

function toNonNegativeMetric(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function resolveDiscoveryConfig(repositoryConfig = {}, config = {}) {
  return {
    ...DEFAULT_DISCOVERY_CONFIG,
    ...(repositoryConfig ?? {}),
    ...config,
    ignoredDomains: new Set([
      ...DEFAULT_DISCOVERY_CONFIG.ignoredDomains,
      ...toDiscoveryConfigList(repositoryConfig?.ignoredDomains),
      ...toDiscoveryConfigList(config?.ignoredDomains),
    ]),
  };
}

function toDiscoveryConfigList(value) {
  if (value instanceof Set) {
    return Array.from(value);
  }

  return Array.isArray(value) ? value : [];
}

function recordSourceCategoryCoverage(source, item) {
  const category = normalizeCategory(item?.category);

  if (!source || category == null) {
    return [];
  }

  source.evidence ??= {};
  source.evidence.categoryCoverage ??= [];
  pushUnique(source.evidence.categoryCoverage, category, CONTENT_CATEGORIES.length);

  return source.evidence.categoryCoverage;
}

function normalizeCategory(value) {
  return CONTENT_CATEGORIES.includes(value) ? value : null;
}
