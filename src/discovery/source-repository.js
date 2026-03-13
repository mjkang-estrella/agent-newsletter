import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { CONTENT_CATEGORIES } from "../core/contracts.js";
import { DEFAULT_DISCOVERY_CONFIG, DEFAULT_SEED_SOURCES } from "./config.js";
import { normalizeUrl } from "./link-extractor.js";
import {
  countActiveSourcesByTopicArea,
  findRetirementBlockedCategories,
} from "./source-coverage.js";
import {
  resolveWeightedSourceAuthorityScore,
  summarizeSourceExpertiseRetentionSignal,
} from "./source-authority.js";
import {
  activateSource,
  isSourceFetchEligible,
  normalizeSourceLifecycle,
  normalizeSourceGovernance,
  normalizeSourcePerformance,
  recordSourceRetirementDecision,
  retireSource as retireSourceLifecycle,
  restoreSource as restoreSourceLifecycle,
  SOURCE_RETIREMENT_REASONS,
} from "./source-lifecycle.js";

const SOURCE_STATUS_ORDER = {
  approved: 0,
  candidate: 1,
  retired: 2,
};

export class SourceRepository {
  constructor({ filePath, seedSources = DEFAULT_SEED_SOURCES, config = {} } = {}) {
    if (!filePath) {
      throw new Error("SourceRepository requires a filePath");
    }

    this.filePath = filePath;
    this.seedSources = seedSources;
    this.config = {
      ...DEFAULT_DISCOVERY_CONFIG,
      ...config,
    };
  }

  async load({ now = new Date().toISOString() } = {}) {
    const snapshot = await this.readSnapshot(now);

    return this.withSeedSources(snapshot, now);
  }

  async save(snapshot) {
    const normalizedSnapshot = normalizeSourceRepositorySnapshot(
      snapshot,
      snapshot?.updatedAt ?? new Date().toISOString(),
      this.config,
    );

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      `${JSON.stringify(normalizedSnapshot, null, 2)}\n`,
      "utf8",
    );
  }

  async listFetchableSources(options) {
    const snapshot = await this.load(options);
    const now = options?.now ?? new Date().toISOString();

    return snapshot.sources.filter((source) => isSourceFetchEligible(source, { now }));
  }

  async countActiveSourcesByTopicArea(options) {
    const snapshot = await this.load(options);

    return countActiveSourcesByTopicArea(snapshot.sources, this.config);
  }

  async restoreSource(
    sourceId,
    {
      now = new Date().toISOString(),
      reason,
      evidence = null,
      targetState,
    } = {},
  ) {
    const snapshot = await this.load({ now });
    const source = snapshot.sources.find((entry) => entry.id === sourceId);

    if (!source) {
      throw new Error(`Unknown source: ${sourceId}`);
    }

    if (normalizeSourceLifecycle(source, this.config).state !== "retired") {
      throw new Error(`Source is not retired: ${sourceId}`);
    }

    restoreSourceLifecycle(
      source,
      {
        now,
        reason,
        evidence,
        targetState,
      },
      this.config,
    );
    snapshot.updatedAt = now;
    await this.save(snapshot);

    return source;
  }

  async retireSource(
    sourceId,
    {
      now = new Date().toISOString(),
      reason = SOURCE_RETIREMENT_REASONS.manual,
      evidence = null,
    } = {},
  ) {
    const snapshot = await this.load({ now });
    const source = snapshot.sources.find((entry) => entry.id === sourceId);

    if (!source) {
      throw new Error(`Unknown source: ${sourceId}`);
    }

    if (normalizeSourceLifecycle(source, this.config).state === "retired") {
      throw new Error(`Source is already retired: ${sourceId}`);
    }

    const blockedCategories = findRetirementBlockedCategories(
      snapshot.sources,
      source,
      this.config,
    );

    if (blockedCategories.length > 0) {
      recordSourceRetirementDecision(
        source,
        {
          decidedAt: now,
          outcome: "blocked",
          reason,
          evidence,
          blockedCategories,
        },
        this.config,
      );
      snapshot.updatedAt = now;
      await this.save(snapshot);

      return {
        source,
        retired: false,
        blocked: true,
        blockedCategories,
      };
    }

    retireSourceLifecycle(
      source,
      {
        now,
        reason,
        evidence,
      },
      this.config,
    );
    snapshot.updatedAt = now;
    await this.save(snapshot);

    return {
      source,
      retired: true,
      blocked: false,
      blockedCategories: [],
    };
  }

  async readSnapshot(now) {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);

        return normalizeSourceRepositorySnapshot(parsed, now, this.config);
      } catch (error) {
      if (error && error.code === "ENOENT") {
        return normalizeSourceRepositorySnapshot(null, now, this.config);
      }

      throw error;
    }
  }

  withSeedSources(snapshot, now) {
    const byId = new Map(snapshot.sources.map((source) => [source.id, source]));

    for (const seed of this.seedSources) {
      const id = seed.id;
      const existing = byId.get(id);

      if (existing) {
        existing.seed = true;
        existing.status = "approved";
        existing.authorityScore = 100;
        existing.signalScore = Math.max(existing.signalScore ?? 0, 100);
        existing.approvedAt ??= now;
        existing.kind = seed.kind;
        existing.entityType = seed.entityType;
        existing.displayName = seed.displayName;
        existing.url = seed.url;
        existing.fetchUrl = seed.fetchUrl;
        existing.canonicalUrl = seed.canonicalUrl;
        existing.evidence.signalQuality.preferredFetchUrl = null;
        existing.evidence.signalQuality.preferredFetchScore = 0;
        activateSource(existing, existing.approvedAt ?? now, this.config);
        continue;
      }

      const seededRecord = {
        id,
        kind: seed.kind,
        entityType: seed.entityType,
        platform: seed.platform,
        value: seed.value,
        displayName: seed.displayName,
        url: seed.url,
        canonicalUrl: seed.canonicalUrl,
        fetchUrl: seed.fetchUrl,
        status: "approved",
        seed: true,
        authorityScore: 100,
        signalScore: 100,
        discoveredAt: now,
        approvedAt: now,
        lastSeenAt: now,
        evidence: {
          ...normalizeEvidence({}, this.config)
        },
        discoveredFromUrls: []
      };

      activateSource(seededRecord, now, this.config);
      byId.set(id, seededRecord);
    }

    return {
      version: 1,
      updatedAt: snapshot.updatedAt ?? now,
      sources: Array.from(byId.values()).sort((left, right) =>
        sortSources(left, right, this.config),
      )
    };
  }
}

export function normalizeSourceRepositorySnapshot(snapshot, now, config) {
  const sources = Array.isArray(snapshot?.sources)
    ? snapshot.sources.map((source) => {
        const lifecycle = normalizeSourceLifecycle(source, config);
        const evidence = {
          ...normalizeEvidence(source.evidence, config)
        };

        return {
          ...source,
          fetchUrl:
            normalizeStoredUrl(source.fetchUrl) ??
            normalizeStoredUrl(source.evidence?.signalQuality?.preferredFetchUrl) ??
            source.fetchUrl ??
            source.url,
          evidence,
          discoveredFromUrls: normalizeStoredUrls(source.discoveredFromUrls),
          governance: normalizeSourceGovernance(source, config),
          lifecycle,
          performance: normalizeSourcePerformance(
            {
              ...source,
              evidence,
              lifecycle,
            },
            config,
          ),
        };
      })
    : [];

  return {
    version: 1,
    updatedAt: snapshot?.updatedAt ?? now,
    sources
  };
}

function normalizeEvidence(evidence = {}, config = DEFAULT_DISCOVERY_CONFIG) {
  return {
    discoveryCount: 0,
    referrers: [],
    trustedReferrers: [],
    seedReferrers: [],
    referrerPlatforms: [],
    cyclesSeen: [],
    topicHits: [],
    categoryCoverage: [],
    exampleUrls: [],
    ...evidence,
    categoryCoverage: normalizeCategoryCoverage(evidence.categoryCoverage),
    exampleUrls: normalizeStoredUrls(evidence.exampleUrls),
    authoritySignals: normalizeAuthoritySignals(evidence, config),
    signalQuality: normalizeSignalQuality(evidence)
  };
}

function normalizeAuthoritySignals(
  evidence = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const signals = evidence.authoritySignals ?? {};
  const hasExplicitSignals =
    evidence.authoritySignals != null && typeof evidence.authoritySignals === "object";
  const expertise = normalizeExpertiseSignals(signals.expertise);

  return {
    observed:
      typeof signals.observed === "boolean" ? signals.observed : hasExplicitSignals,
    citationCount: toNonNegativeNumber(signals.citationCount) ?? 0,
    referrers: Array.isArray(signals.referrers) ? signals.referrers : [],
    sourceKinds: Array.isArray(signals.sourceKinds) ? signals.sourceKinds : [],
    cyclesSeen: Array.isArray(signals.cyclesSeen) ? signals.cyclesSeen : [],
    githubStars: toNonNegativeNumber(signals.githubStars) ?? 0,
    githubActivity: toNonNegativeNumber(signals.githubActivity) ?? 0,
    expertise,
    domainExpertiseRetention: summarizeSourceExpertiseRetentionSignal(
      signals.domainExpertiseRetention,
      expertise,
      config,
    ),
  };
}

function normalizeSignalQuality(evidence = {}) {
  const signalQuality = evidence.signalQuality ?? {};
  const observationCount = toNonNegativeNumber(signalQuality.observationCount) ?? 0;
  const averageScore = toNonNegativeNumber(signalQuality.averageScore) ?? 0;
  const totalScore =
    toNonNegativeNumber(signalQuality.totalScore) ??
    resolveTotalScore(observationCount, averageScore);

  return {
    observationCount,
    totalScore,
    averageScore: averageScore || resolveAverageScore(observationCount, totalScore),
    bestScore: toNonNegativeNumber(signalQuality.bestScore) ?? 0,
    highSignalObservationCount:
      toNonNegativeNumber(signalQuality.highSignalObservationCount) ?? 0,
    highSignalCycles: Array.isArray(signalQuality.highSignalCycles)
      ? signalQuality.highSignalCycles
      : [],
    preferredFetchUrl: normalizeStoredUrl(signalQuality.preferredFetchUrl),
    preferredFetchScore: toNonNegativeNumber(signalQuality.preferredFetchScore) ?? 0,
    lastObservedAt:
      typeof signalQuality.lastObservedAt === "string" &&
      signalQuality.lastObservedAt.length > 0
        ? signalQuality.lastObservedAt
        : null,
  };
}

function normalizeExpertiseSignals(expertise = {}) {
  return {
    trackedItems: normalizeTrackedExpertiseItems(expertise.trackedItems),
    lastUpdatedAt: normalizeStoredTimestamp(expertise.lastUpdatedAt),
  };
}

function normalizeTrackedExpertiseItems(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => normalizeTrackedExpertiseItem(entry))
    .filter(Boolean)
    .sort(compareTrackedExpertiseItemsByLastObservedAtDesc);
}

function normalizeTrackedExpertiseItem(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const itemId =
    typeof entry.itemId === "string" && entry.itemId.length > 0 ? entry.itemId : null;
  const firstCycleId = normalizeCycleId(entry.firstCycleId);
  const lastCycleId = normalizeCycleId(entry.lastCycleId ?? entry.firstCycleId);
  const firstObservedAt = normalizeStoredTimestamp(entry.firstObservedAt);
  const lastObservedAt = normalizeStoredTimestamp(entry.lastObservedAt ?? entry.firstObservedAt);
  const status = normalizeTrackedExpertiseStatus(entry.status);
  const occurrences = normalizeTrackedExpertiseOccurrences(entry.occurrences);
  const appearanceCount = Math.max(
    1,
    Math.trunc(
      Math.max(
        toNonNegativeNumber(entry.appearanceCount) ?? 1,
        occurrences.length,
      ),
    ),
  );
  const totalScore = resolveTrackedExpertiseTotalScore(entry, appearanceCount, occurrences);
  const averageScore = resolveAverageScore(appearanceCount, totalScore);
  const bestScore = clampScore(
    Math.max(
      toNonNegativeNumber(entry.bestScore) ?? 0,
      toNonNegativeNumber(entry.firstScore) ?? 0,
      ...occurrences.map((occurrence) => occurrence.relevanceScore),
    ),
  );

  if (
    itemId == null ||
    firstCycleId == null ||
    lastCycleId == null ||
    firstObservedAt == null ||
    lastObservedAt == null
  ) {
    return null;
  }

  return {
    itemId,
    firstCycleId,
    firstObservedAt,
    lastCycleId,
    lastObservedAt,
    firstScore: clampScore(toNonNegativeNumber(entry.firstScore) ?? 0),
    totalScore,
    averageScore,
    bestScore,
    appearanceCount,
    ...(occurrences.length > 0 ? { occurrences } : {}),
    ...(normalizeTrackedExpertiseDomains(entry.domains).length > 0
      ? { domains: normalizeTrackedExpertiseDomains(entry.domains) }
      : {}),
    status,
    resolvedAt: normalizeStoredTimestamp(entry.resolvedAt),
  };
}

function normalizeTrackedExpertiseStatus(value) {
  return value === "retained" || value === "short_lived" ? value : "tracking";
}

function normalizeTrackedExpertiseOccurrences(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const occurrencesByCycle = new Map();

  for (const entry of entries) {
    const occurrence = normalizeTrackedExpertiseOccurrence(entry);

    if (!occurrence) {
      continue;
    }

    const current = occurrencesByCycle.get(occurrence.cycleId);
    occurrencesByCycle.set(
      occurrence.cycleId,
      current == null
        ? occurrence
        : preferTrackedExpertiseOccurrence(current, occurrence),
    );
  }

  return [...occurrencesByCycle.values()].sort(compareTrackedExpertiseOccurrencesByCycleAsc);
}

function normalizeTrackedExpertiseOccurrence(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const cycleId = normalizeCycleId(entry.cycleId);
  const observedAt = normalizeStoredTimestamp(entry.observedAt);
  const relevanceScore = toNonNegativeNumber(entry.relevanceScore);

  if (cycleId == null || observedAt == null || relevanceScore == null) {
    return null;
  }

  return {
    cycleId,
    observedAt,
    relevanceScore: clampScore(relevanceScore),
  };
}

function preferTrackedExpertiseOccurrence(left, right) {
  if (right.relevanceScore !== left.relevanceScore) {
    return right.relevanceScore > left.relevanceScore ? right : left;
  }

  return new Date(right.observedAt).getTime() >= new Date(left.observedAt).getTime()
    ? right
    : left;
}

function compareTrackedExpertiseOccurrencesByCycleAsc(left, right) {
  const cycleDelta = parseCycleId(left.cycleId) - parseCycleId(right.cycleId);

  if (cycleDelta !== 0) {
    return cycleDelta;
  }

  return new Date(left.observedAt).getTime() - new Date(right.observedAt).getTime();
}

function resolveTrackedExpertiseTotalScore(
  entry,
  appearanceCount,
  occurrences = normalizeTrackedExpertiseOccurrences(entry?.occurrences),
) {
  if (occurrences.length > 0) {
    return occurrences.reduce((sum, occurrence) => sum + occurrence.relevanceScore, 0);
  }

  const explicitTotalScore = toNonNegativeNumber(entry?.totalScore);

  if (explicitTotalScore != null) {
    return explicitTotalScore;
  }

  const explicitAverageScore = toNonNegativeNumber(entry?.averageScore);

  if (explicitAverageScore != null) {
    return resolveTotalScore(appearanceCount, explicitAverageScore);
  }

  if (appearanceCount <= 1) {
    return clampScore(toNonNegativeNumber(entry?.firstScore) ?? 0);
  }

  if (appearanceCount === 2) {
    return (
      clampScore(toNonNegativeNumber(entry?.firstScore) ?? 0) +
      clampScore(
        toNonNegativeNumber(entry?.bestScore) ??
          toNonNegativeNumber(entry?.firstScore) ??
          0,
      )
    );
  }

  return 0;
}

function normalizeTrackedExpertiseDomains(values) {
  const normalized = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? [values]
      : [];

  return [
    ...new Set(
      normalized
        .map((value) =>
          typeof value === "string" && value.trim().length > 0
            ? value.trim().toLowerCase()
            : null,
        )
        .filter(Boolean),
    ),
  ];
}

function normalizeCategoryCoverage(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return CONTENT_CATEGORIES.filter((category) => values.includes(category));
}

function compareTrackedExpertiseItemsByLastObservedAtDesc(left, right) {
  return new Date(right.lastObservedAt).getTime() - new Date(left.lastObservedAt).getTime();
}

function sortSources(left, right, config = DEFAULT_DISCOVERY_CONFIG) {
  const leftRetired = left.lifecycle?.state === "retired";
  const rightRetired = right.lifecycle?.state === "retired";

  if (leftRetired !== rightRetired) {
    return leftRetired ? 1 : -1;
  }

  if (left.status !== right.status) {
    return statusOrder(left.status) - statusOrder(right.status);
  }

  const leftWeightedAuthorityScore = resolveWeightedSourceAuthorityScore(
    left,
    config,
  );
  const rightWeightedAuthorityScore = resolveWeightedSourceAuthorityScore(
    right,
    config,
  );

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

function toNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : null;
}

function resolveAverageScore(observationCount, totalScore) {
  if (observationCount <= 0 || totalScore <= 0) {
    return 0;
  }

  return Math.round(totalScore / observationCount);
}

function resolveTotalScore(observationCount, averageScore) {
  if (observationCount <= 0 || averageScore <= 0) {
    return 0;
  }

  return observationCount * averageScore;
}

function normalizeStoredUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const normalized = normalizeUrl(value);

  if (!normalized) {
    return null;
  }

  if (normalized.pathname === "/" && !normalized.search) {
    return `https://${normalized.hostname}`;
  }

  return normalized.toString();
}

function normalizeStoredUrls(values) {
  const candidates = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? [values]
      : [];
  const normalized = [];

  for (const value of candidates) {
    const url = normalizeStoredUrl(value);

    if (!url || normalized.includes(url)) {
      continue;
    }

    normalized.push(url);
  }

  return normalized;
}

function normalizeStoredTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function normalizeCycleId(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return parseCycleId(value) == null ? null : value;
}

function parseCycleId(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, value));
}
