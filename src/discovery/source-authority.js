import { DEFAULT_DISCOVERY_CONFIG } from "./config.js";
import {
  SOURCE_LIFECYCLE_STAGES,
  normalizeSourceLifecycle,
} from "./source-lifecycle.js";

const AUTHORITY_MAX_CITATION_POINTS = 64;
const AUTHORITY_MAX_GITHUB_STARS_POINTS = 16;
const AUTHORITY_MAX_GITHUB_ACTIVITY_POINTS = 10;
const AUTHORITY_MAX_EXPERTISE_POINTS = 12;
const AUTHORITY_GITHUB_STARS_SATURATION = 50_000;
const DEFAULT_PROBATIONARY_AUTHORITY_WEIGHT = 0.75;
const DEFAULT_SOURCE_EXPERTISE_RETENTION_WINDOW_DAYS = 7;
const DEFAULT_SOURCE_EXPERTISE_MAX_TRACKED_ITEMS = 50;
const SOURCE_EXPERTISE_STATUS_TRACKING = "tracking";
const SOURCE_EXPERTISE_STATUS_RETAINED = "retained";
const SOURCE_EXPERTISE_STATUS_SHORT_LIVED = "short_lived";

export function evaluateSourceAuthority(
  record,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const newSource = isNewSource(record);

  if (newSource) {
    return evaluateSourceAuthorityBootstrap(record, config);
  }

  const authorityScore = scoreSourceAuthority(record, config);
  const minimumAuthorityScore = resolveMinimumAuthorityScore(record, config);

  return {
    authorityScore,
    minimumAuthorityScore,
    isNewSource: newSource,
    eligible: record?.seed === true || authorityScore >= minimumAuthorityScore,
  };
}

export function evaluateSourceAuthorityBootstrap(
  record,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const newSource = isNewSource(record);
  const authorityScore = scoreSourceAuthorityBootstrap(record, config);
  const minimumAuthorityScore = resolveMinimumAuthorityScore(record, config);

  return {
    authorityScore,
    minimumAuthorityScore,
    isNewSource: newSource,
    eligible: record?.seed === true || authorityScore >= minimumAuthorityScore,
  };
}

export function scoreSourceAuthority(
  record,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  return scoreAuthoritySignals(resolveAuthoritySignals(record, config), {
    includeExpertise: !isNewSource(record),
    config,
  });
}

export function scoreSourceAuthorityBootstrap(
  record,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  return scoreAuthoritySignals(resolveBootstrapAuthoritySignals(record, config), {
    includeExpertise: false,
    config,
  });
}

function scoreAuthoritySignals(
  signals,
  {
    includeExpertise = true,
    config = DEFAULT_DISCOVERY_CONFIG,
  } = {},
) {
  if (!hasBootstrapAuthoritySignals(signals)) {
    return 0;
  }

  if (!includeExpertise) {
    return clamp(scoreBootstrapAuthoritySignals(signals), 0, 100);
  }

  const expertiseAdjustment = scoreSourceExpertise(
    signals.domainExpertiseRetention,
    signals.expertise,
    config,
  );

  return clamp(
    scoreBootstrapAuthoritySignals(signals) +
      expertiseAdjustment,
    0,
    100,
  );
}

function scoreBootstrapAuthoritySignals(signals) {
  const citationCount = finiteMetric(signals.citationCount) ?? 0;
  const githubStars = finiteMetric(signals.githubStars) ?? 0;
  const githubActivity = finiteMetric(signals.githubActivity) ?? 0;

  return (
    Math.min(citationCount * 32, AUTHORITY_MAX_CITATION_POINTS) +
    Math.round(
      normalizeLogarithmic(githubStars, AUTHORITY_GITHUB_STARS_SATURATION) *
        (AUTHORITY_MAX_GITHUB_STARS_POINTS / 100),
    ) +
    Math.round(
      clamp(githubActivity, 0, 100) *
        (AUTHORITY_MAX_GITHUB_ACTIVITY_POINTS / 100),
    )
  );
}

function hasBootstrapAuthoritySignals(signals) {
  return (
    (finiteMetric(signals?.citationCount) ?? 0) > 0 ||
    (finiteMetric(signals?.githubStars) ?? 0) > 0 ||
    (finiteMetric(signals?.githubActivity) ?? 0) > 0
  );
}

export function resolveMinimumAuthorityScore(
  record,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const baselineThreshold = config.minAuthorityScore;
  const newSourceThreshold = Math.max(
    baselineThreshold,
    config.minNewSourceAuthorityScore ?? baselineThreshold,
  );

  if (!isNewSource(record)) {
    return baselineThreshold;
  }

  return newSourceThreshold;
}

export function isNewSource(record) {
  if (record?.seed === true) {
    return false;
  }

  return (
    normalizeSourceLifecycle(record).stage === SOURCE_LIFECYCLE_STAGES.probation
  );
}

export function resolveSourceAuthorityWeight(
  record,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const lifecycle = normalizeSourceLifecycle(record);

  if (lifecycle.stage === SOURCE_LIFECYCLE_STAGES.active) {
    return 1;
  }

  if (lifecycle.stage === SOURCE_LIFECYCLE_STAGES.retired) {
    return 0;
  }

  return clamp(
    finiteMetric(config?.probationaryAuthorityWeight) ??
      DEFAULT_PROBATIONARY_AUTHORITY_WEIGHT,
    0,
    1,
  );
}

export function resolveWeightedSourceAuthorityScore(
  record,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const authorityScore =
    finiteMetric(record?.authorityScore) ??
    evaluateSourceAuthority(record, config).authorityScore;

  return clamp(
    Math.round(authorityScore * resolveSourceAuthorityWeight(record, config)),
    0,
    100,
  );
}

export function recordSourceExpertiseObservation(
  source,
  {
    itemId,
    cycleId,
    observedAt = new Date().toISOString(),
    relevanceScore,
    domains,
  } = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const normalizedItemId =
    typeof itemId === "string" && itemId.length > 0 ? itemId : null;
  const normalizedCycleId = normalizeCycleId(cycleId);
  const normalizedObservedAt = normalizeTimestamp(observedAt);
  const score = finiteMetric(relevanceScore);
  const normalizedDomains = normalizeTrackedItemDomains(domains);

  if (
    !source ||
    normalizedItemId == null ||
    normalizedCycleId == null ||
    normalizedObservedAt == null ||
    score == null
  ) {
    return null;
  }

  const highSignalThreshold = resolveHighSignalThreshold(config);
  const expertise = ensureSourceExpertise(source, config);
  const existing = expertise.trackedItems.find(
    (entry) => entry.itemId === normalizedItemId,
  );
  const normalizedScore = clamp(score, 0, 100);

  if (!existing && normalizedScore < highSignalThreshold) {
    return null;
  }

  const nextOccurrence = createTrackedItemOccurrence({
    cycleId: normalizedCycleId,
    observedAt: normalizedObservedAt,
    relevanceScore: normalizedScore,
  });

  if (!existing) {
    expertise.trackedItems.push({
      itemId: normalizedItemId,
      firstCycleId: normalizedCycleId,
      firstObservedAt: normalizedObservedAt,
      lastCycleId: normalizedCycleId,
      lastObservedAt: normalizedObservedAt,
      firstScore: normalizedScore,
      totalScore: normalizedScore,
      averageScore: normalizedScore,
      bestScore: normalizedScore,
      appearanceCount: 1,
      occurrences: [nextOccurrence],
      status: SOURCE_EXPERTISE_STATUS_TRACKING,
      resolvedAt: null,
      ...(normalizedDomains.length > 0 ? { domains: normalizedDomains } : {}),
    });
  } else {
    const previousAppearanceCount = Math.max(1, existing.appearanceCount ?? 1);
    const previousTotalScore = resolveTrackedItemTotalScore(existing, previousAppearanceCount);
    const previousOccurrenceScore = findTrackedItemOccurrenceScore(
      existing.occurrences,
      normalizedCycleId,
    );
    const isNewCycle = existing.lastCycleId !== normalizedCycleId;
    const nextAppearanceCount = isNewCycle
      ? previousAppearanceCount + 1
      : previousAppearanceCount;
    const nextTotalScore = clamp(
      isNewCycle
        ? previousTotalScore + normalizedScore
        : previousTotalScore +
            Math.max(0, normalizedScore - (previousOccurrenceScore ?? normalizedScore)),
      0,
      Number.MAX_SAFE_INTEGER,
    );

    existing.totalScore = nextTotalScore;
    existing.averageScore = resolveAverageScore(nextAppearanceCount, nextTotalScore);
    existing.bestScore = Math.max(existing.bestScore ?? 0, normalizedScore);
    existing.domains = mergeTrackedItemDomains(existing.domains, normalizedDomains);
    existing.occurrences = upsertTrackedItemOccurrences(existing.occurrences, nextOccurrence);

    if (isNewCycle) {
      existing.appearanceCount = nextAppearanceCount;
      existing.lastCycleId = normalizedCycleId;
      existing.lastObservedAt = normalizedObservedAt;
    } else {
      existing.appearanceCount = nextAppearanceCount;
      existing.lastObservedAt = normalizedObservedAt;
    }

    if (nextAppearanceCount >= 2) {
      if (normalizedScore >= highSignalThreshold) {
        existing.status = SOURCE_EXPERTISE_STATUS_RETAINED;
        existing.resolvedAt = normalizedObservedAt;
      }
    }

    if (
      existing.status === SOURCE_EXPERTISE_STATUS_RETAINED &&
      existing.resolvedAt == null
    ) {
      existing.status = SOURCE_EXPERTISE_STATUS_RETAINED;
      existing.resolvedAt = normalizedObservedAt;
    }
  }

  expertise.lastUpdatedAt = normalizedObservedAt;
  expertise.trackedItems = trimTrackedItems(
    expertise.trackedItems,
    resolveSourceExpertiseMaxTrackedItems(config),
  );
  refreshSourceExpertiseRetentionSignal(source, normalizedObservedAt, config);
  source.authorityScore = scoreSourceAuthority(source, config);

  return expertise;
}

export function finalizeSourceExpertiseSignal(
  source,
  {
    cycleId,
    observedAt = new Date().toISOString(),
  } = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const expertise = source?.evidence?.authoritySignals?.expertise;
  const normalizedCycleId = normalizeCycleId(cycleId);
  const normalizedObservedAt = normalizeTimestamp(observedAt);

  if (
    !source ||
    !expertise ||
    !Array.isArray(expertise.trackedItems) ||
    expertise.trackedItems.length === 0 ||
    normalizedCycleId == null ||
    normalizedObservedAt == null
  ) {
    return null;
  }

  const retentionWindowDays = resolveSourceExpertiseRetentionWindowDays(config);
  let changed = false;

  for (const entry of expertise.trackedItems) {
    if (entry.status !== SOURCE_EXPERTISE_STATUS_TRACKING) {
      continue;
    }

    if (
      !isCycleWithinWindow(entry.firstCycleId, normalizedCycleId, retentionWindowDays)
    ) {
      entry.status = SOURCE_EXPERTISE_STATUS_SHORT_LIVED;
      entry.resolvedAt = normalizedObservedAt;
      changed = true;
    }
  }

  expertise.lastUpdatedAt = normalizedObservedAt;
  expertise.trackedItems = trimTrackedItems(
    expertise.trackedItems,
    resolveSourceExpertiseMaxTrackedItems(config),
  );
  refreshSourceExpertiseRetentionSignal(source, normalizedObservedAt, config);
  source.authorityScore = scoreSourceAuthority(source, config);

  return expertise;
}

function sizeOf(listLike) {
  return Array.isArray(listLike) ? new Set(listLike).size : 0;
}

function resolveAuthoritySignals(record, config = DEFAULT_DISCOVERY_CONFIG) {
  return resolveBootstrapAuthoritySignals(record, config);
}

function resolveBootstrapAuthoritySignals(
  record,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const authoritySignals = record?.evidence?.authoritySignals;

  if (!hasExplicitAuthoritySignals(record)) {
    return createEmptyAuthoritySignals(config);
  }

  return readAuthoritySignals(authoritySignals, config);
}

function createEmptyAuthoritySignals(config = DEFAULT_DISCOVERY_CONFIG) {
  const expertise = normalizeSourceExpertise(null);

  return {
    citationCount: 0,
    referrers: [],
    sourceKinds: [],
    cyclesSeen: [],
    githubStars: 0,
    githubActivity: 0,
    expertise,
    domainExpertiseRetention: summarizeSourceExpertiseRetentionSignal(
      null,
      expertise,
      config,
    ),
  };
}

function readAuthoritySignals(
  authoritySignals,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const expertise = normalizeSourceExpertise(authoritySignals?.expertise);

  return {
    citationCount: finiteMetric(authoritySignals?.citationCount) ?? 0,
    referrers: Array.isArray(authoritySignals?.referrers)
      ? authoritySignals.referrers
      : [],
    sourceKinds: Array.isArray(authoritySignals?.sourceKinds)
      ? authoritySignals.sourceKinds
      : [],
    cyclesSeen: Array.isArray(authoritySignals?.cyclesSeen)
      ? authoritySignals.cyclesSeen
      : [],
    githubStars: finiteMetric(authoritySignals?.githubStars) ?? 0,
    githubActivity: finiteMetric(authoritySignals?.githubActivity) ?? 0,
    expertise,
    domainExpertiseRetention: summarizeSourceExpertiseRetentionSignal(
      authoritySignals?.domainExpertiseRetention,
      expertise,
      config,
    ),
  };
}

function hasExplicitAuthoritySignals(record) {
  const evidence = record?.evidence;

  if (
    !evidence ||
    !Object.prototype.hasOwnProperty.call(evidence, "authoritySignals")
  ) {
    return false;
  }

  const authoritySignals = evidence.authoritySignals;

  if (!authoritySignals || typeof authoritySignals !== "object") {
    return false;
  }

  if (authoritySignals.observed === false) {
    return false;
  }

  return true;
}

function scoreSourceExpertise(
  retention,
  expertise,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  return summarizeSourceExpertiseRetentionSignal(retention, expertise, config)
    .authorityAdjustment;
}

function resolveTrackedItemOutcome(
  entry,
  highSignalThreshold = resolveHighSignalThreshold(),
) {
  if (entry.status === SOURCE_EXPERTISE_STATUS_SHORT_LIVED) {
    return -1;
  }

  const appearanceCount = finiteMetric(entry.appearanceCount) ?? 1;
  const persistenceOutcome = appearanceCount >= 3 ? 1 : 0.5;

  return clamp(
    persistenceOutcome *
      resolveTrackedItemRelevanceRetention(entry, highSignalThreshold),
    0,
    1,
  );
}

function ensureSourceAuthoritySignals(source) {
  source.evidence ??= {};
  source.evidence.authoritySignals ??= {};

  return source.evidence.authoritySignals;
}

function ensureSourceExpertise(source, config = DEFAULT_DISCOVERY_CONFIG) {
  const authoritySignals = ensureSourceAuthoritySignals(source);

  authoritySignals.expertise = normalizeSourceExpertise(authoritySignals.expertise);
  authoritySignals.domainExpertiseRetention =
    summarizeSourceExpertiseRetentionSignal(
      authoritySignals.domainExpertiseRetention,
      authoritySignals.expertise,
      config,
    );

  return authoritySignals.expertise;
}

function refreshSourceExpertiseRetentionSignal(
  source,
  lastUpdatedAt = null,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const authoritySignals = ensureSourceAuthoritySignals(source);
  const expertise = ensureSourceExpertise(source, config);

  authoritySignals.domainExpertiseRetention =
    summarizeSourceExpertiseRetentionSignal(
      {
        ...authoritySignals.domainExpertiseRetention,
        lastUpdatedAt:
          lastUpdatedAt ?? authoritySignals.domainExpertiseRetention?.lastUpdatedAt,
      },
      expertise,
      config,
    );

  return authoritySignals.domainExpertiseRetention;
}

function normalizeSourceExpertise(expertise) {
  const trackedItems = Array.isArray(expertise?.trackedItems)
    ? expertise.trackedItems
        .map(normalizeTrackedItem)
        .filter(Boolean)
        .sort(compareTrackedItemsByLastObservedAtDesc)
    : [];

  return {
    trackedItems,
    lastUpdatedAt: normalizeTimestamp(expertise?.lastUpdatedAt),
  };
}

export function summarizeSourceExpertiseRetentionSignal(
  retention,
  expertise,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const trackedItems = Array.isArray(expertise?.trackedItems)
    ? expertise.trackedItems.map(normalizeTrackedItem).filter(Boolean)
    : [];
  const highSignalThreshold = resolveHighSignalThreshold(config);
  if (trackedItems.length === 0) {
    const domains = normalizeRetentionDomainSummaries(retention?.domains);

    return {
      trackedItemCount: normalizeNonNegativeInteger(
        retention?.trackedItemCount,
        0,
      ),
      resolvedItemCount: normalizeNonNegativeInteger(
        retention?.resolvedItemCount,
        0,
      ),
      retainedItemCount: normalizeNonNegativeInteger(
        retention?.retainedItemCount,
        0,
      ),
      shortLivedItemCount: normalizeNonNegativeInteger(
        retention?.shortLivedItemCount,
        0,
      ),
      retentionRate: clamp(finiteMetric(retention?.retentionRate) ?? 0, 0, 1),
      relevanceRetentionRate: clamp(
        finiteMetric(retention?.relevanceRetentionRate) ??
          finiteMetric(retention?.retentionRate) ??
          0,
        0,
        1,
      ),
      weightedOutcome: clamp(finiteMetric(retention?.weightedOutcome) ?? 0, -1, 1),
      authorityAdjustment: clamp(
        Math.round(finiteMetric(retention?.authorityAdjustment) ?? 0),
        -AUTHORITY_MAX_EXPERTISE_POINTS,
        AUTHORITY_MAX_EXPERTISE_POINTS,
      ),
      ...(Object.keys(domains).length > 0 ? { domains } : {}),
      lastUpdatedAt: normalizeTimestamp(retention?.lastUpdatedAt),
    };
  }
  const resolvedItems = trackedItems.filter(
    (entry) =>
      entry.status === SOURCE_EXPERTISE_STATUS_RETAINED ||
      entry.status === SOURCE_EXPERTISE_STATUS_SHORT_LIVED,
  );
  const retainedItemCount = resolvedItems.filter(
    (entry) => entry.status === SOURCE_EXPERTISE_STATUS_RETAINED,
  ).length;
  const shortLivedItemCount = resolvedItems.filter(
    (entry) => entry.status === SOURCE_EXPERTISE_STATUS_SHORT_LIVED,
  ).length;
  const resolvedItemCount = retainedItemCount + shortLivedItemCount;
  const relevanceRetentionRate =
    resolvedItemCount === 0
      ? 0
      : resolvedItems.reduce(
          (sum, entry) =>
            sum +
            resolveTrackedItemRelevanceRetention(entry, highSignalThreshold),
          0,
        ) / resolvedItemCount;
  const weightedOutcome =
    resolvedItemCount === 0
      ? 0
      : resolvedItems.reduce(
          (sum, entry) =>
            sum + resolveTrackedItemOutcome(entry, highSignalThreshold),
          0,
        ) / resolvedItemCount;
  const normalizedWeightedOutcome = clamp(weightedOutcome, -1, 1);
  const domains = summarizeTrackedItemDomains(trackedItems, highSignalThreshold);

  return {
    trackedItemCount: trackedItems.length,
    resolvedItemCount,
    retainedItemCount,
    shortLivedItemCount,
    retentionRate: clamp(
      resolvedItemCount === 0 ? 0 : retainedItemCount / resolvedItemCount,
      0,
      1,
    ),
    relevanceRetentionRate: clamp(relevanceRetentionRate, 0, 1),
    weightedOutcome: normalizedWeightedOutcome,
    authorityAdjustment: clamp(
      Math.round(normalizedWeightedOutcome * AUTHORITY_MAX_EXPERTISE_POINTS),
      -AUTHORITY_MAX_EXPERTISE_POINTS,
      AUTHORITY_MAX_EXPERTISE_POINTS,
    ),
    ...(Object.keys(domains).length > 0 ? { domains } : {}),
    lastUpdatedAt:
      normalizeTimestamp(expertise?.lastUpdatedAt) ??
      normalizeTimestamp(retention?.lastUpdatedAt) ??
      trackedItems[0]?.lastObservedAt ??
      null,
  };
}

function normalizeTrackedItem(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const itemId =
    typeof entry.itemId === "string" && entry.itemId.length > 0 ? entry.itemId : null;
  const firstCycleId = normalizeCycleId(entry.firstCycleId);
  const firstObservedAt = normalizeTimestamp(entry.firstObservedAt);
  const lastCycleId = normalizeCycleId(entry.lastCycleId ?? entry.firstCycleId);
  const lastObservedAt = normalizeTimestamp(
    entry.lastObservedAt ?? entry.firstObservedAt,
  );
  const occurrences = normalizeTrackedItemOccurrences(entry.occurrences);
  const appearanceCount = Math.max(
    1,
    Math.trunc(
      Math.max(
        finiteMetric(entry.appearanceCount) ?? 1,
        occurrences.length,
      ),
    ),
  );
  const totalScore = resolveTrackedItemTotalScore(entry, appearanceCount, occurrences);
  const averageScore = resolveAverageScore(appearanceCount, totalScore);
  const bestScore = clamp(
    Math.max(
      finiteMetric(entry.bestScore) ?? 0,
      finiteMetric(entry.firstScore) ?? 0,
      ...occurrences.map((occurrence) => occurrence.relevanceScore),
    ),
    0,
    100,
  );

  if (
    itemId == null ||
    firstCycleId == null ||
    firstObservedAt == null ||
    lastCycleId == null ||
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
    firstScore: clamp(finiteMetric(entry.firstScore) ?? 0, 0, 100),
    totalScore,
    averageScore,
    bestScore,
    appearanceCount,
    ...(occurrences.length > 0 ? { occurrences } : {}),
    ...(normalizeTrackedItemDomains(entry.domains).length > 0
      ? { domains: normalizeTrackedItemDomains(entry.domains) }
      : {}),
    status: normalizeTrackedItemStatus(entry.status),
    resolvedAt: normalizeTimestamp(entry.resolvedAt),
  };
}

function normalizeTrackedItemStatus(value) {
  if (
    value === SOURCE_EXPERTISE_STATUS_RETAINED ||
    value === SOURCE_EXPERTISE_STATUS_SHORT_LIVED
  ) {
    return value;
  }

  return SOURCE_EXPERTISE_STATUS_TRACKING;
}

function createTrackedItemOccurrence({ cycleId, observedAt, relevanceScore }) {
  const normalizedCycleId = normalizeCycleId(cycleId);
  const normalizedObservedAt = normalizeTimestamp(observedAt);
  const normalizedScore = finiteMetric(relevanceScore);

  if (
    normalizedCycleId == null ||
    normalizedObservedAt == null ||
    normalizedScore == null
  ) {
    return null;
  }

  return {
    cycleId: normalizedCycleId,
    observedAt: normalizedObservedAt,
    relevanceScore: clamp(normalizedScore, 0, 100),
  };
}

function normalizeTrackedItemOccurrences(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const occurrencesByCycle = new Map();

  for (const entry of entries) {
    const occurrence = createTrackedItemOccurrence(entry);

    if (!occurrence) {
      continue;
    }

    const current = occurrencesByCycle.get(occurrence.cycleId);
    occurrencesByCycle.set(
      occurrence.cycleId,
      current == null
        ? occurrence
        : preferTrackedItemOccurrence(current, occurrence),
    );
  }

  return [...occurrencesByCycle.values()].sort(compareTrackedItemOccurrencesByCycleAsc);
}

function upsertTrackedItemOccurrences(existingEntries, nextEntry) {
  const occurrence = createTrackedItemOccurrence(nextEntry);

  if (!occurrence) {
    return normalizeTrackedItemOccurrences(existingEntries);
  }

  return normalizeTrackedItemOccurrences([...(existingEntries ?? []), occurrence]);
}

function preferTrackedItemOccurrence(left, right) {
  if (right.relevanceScore !== left.relevanceScore) {
    return right.relevanceScore > left.relevanceScore ? right : left;
  }

  return new Date(right.observedAt).getTime() >= new Date(left.observedAt).getTime()
    ? right
    : left;
}

function compareTrackedItemOccurrencesByCycleAsc(left, right) {
  const cycleDelta =
    parseCycleId(left.cycleId) - parseCycleId(right.cycleId);

  if (cycleDelta !== 0) {
    return cycleDelta;
  }

  return new Date(left.observedAt).getTime() - new Date(right.observedAt).getTime();
}

function findTrackedItemOccurrenceScore(entries, cycleId) {
  return normalizeTrackedItemOccurrences(entries).find(
    (entry) => entry.cycleId === cycleId,
  )?.relevanceScore ?? null;
}

function resolveTrackedItemTotalScore(
  entry,
  appearanceCount,
  occurrences = normalizeTrackedItemOccurrences(entry?.occurrences),
) {
  if (occurrences.length > 0) {
    return clamp(
      occurrences.reduce((sum, occurrence) => sum + occurrence.relevanceScore, 0),
      0,
      Number.MAX_SAFE_INTEGER,
    );
  }

  const explicitTotalScore = finiteMetric(entry?.totalScore);

  if (explicitTotalScore != null) {
    return Math.max(0, explicitTotalScore);
  }

  const explicitAverageScore = finiteMetric(entry?.averageScore);

  if (explicitAverageScore != null) {
    return resolveTotalScore(appearanceCount, explicitAverageScore);
  }

  if (appearanceCount <= 1) {
    return clamp(finiteMetric(entry?.firstScore) ?? 0, 0, 100);
  }

  if (appearanceCount === 2) {
    return clamp(
      clamp(finiteMetric(entry?.firstScore) ?? 0, 0, 100) +
        clamp(
          finiteMetric(entry?.bestScore) ?? finiteMetric(entry?.firstScore) ?? 0,
          0,
          100,
        ),
      0,
      Number.MAX_SAFE_INTEGER,
    );
  }

  return 0;
}

function mergeTrackedItemDomains(existingDomains, nextDomains) {
  return normalizeTrackedItemDomains([...(existingDomains ?? []), ...(nextDomains ?? [])]);
}

function normalizeTrackedItemDomains(values) {
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

function summarizeTrackedItemDomains(trackedItems, highSignalThreshold) {
  const summaries = new Map();

  for (const entry of trackedItems) {
    const domains = normalizeTrackedItemDomains(entry.domains);

    if (domains.length === 0) {
      continue;
    }

    for (const domain of domains) {
      const summary = summaries.get(domain) ?? createEmptyDomainRetentionSummary();

      summary.trackedItemCount += 1;

      if (entry.status === SOURCE_EXPERTISE_STATUS_RETAINED) {
        summary.resolvedItemCount += 1;
        summary.retainedItemCount += 1;
        summary.relevanceRetentionTotal += resolveTrackedItemRelevanceRetention(
          entry,
          highSignalThreshold,
        );
        summary.weightedOutcomeTotal += resolveTrackedItemOutcome(
          entry,
          highSignalThreshold,
        );
      } else if (entry.status === SOURCE_EXPERTISE_STATUS_SHORT_LIVED) {
        summary.resolvedItemCount += 1;
        summary.shortLivedItemCount += 1;
        summary.relevanceRetentionTotal += resolveTrackedItemRelevanceRetention(
          entry,
          highSignalThreshold,
        );
        summary.weightedOutcomeTotal += resolveTrackedItemOutcome(
          entry,
          highSignalThreshold,
        );
      }

      summaries.set(domain, summary);
    }
  }

  return Object.fromEntries(
    [...summaries.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([domain, summary]) => [domain, finalizeDomainRetentionSummary(summary)]),
  );
}

function normalizeRetentionDomainSummaries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalizedEntries = Object.entries(value)
    .map(([domain, summary]) => {
      const normalizedDomain = normalizeTrackedItemDomains(domain)[0] ?? null;

      if (normalizedDomain == null) {
        return null;
      }

      return [normalizedDomain, normalizeRetentionDomainSummary(summary)];
    })
    .filter(Boolean);

  return Object.fromEntries(normalizedEntries);
}

function normalizeRetentionDomainSummary(summary) {
  const normalizedWeightedOutcome = clamp(
    finiteMetric(summary?.weightedOutcome) ?? 0,
    -1,
    1,
  );

  return {
    trackedItemCount: normalizeNonNegativeInteger(summary?.trackedItemCount, 0),
    resolvedItemCount: normalizeNonNegativeInteger(summary?.resolvedItemCount, 0),
    retainedItemCount: normalizeNonNegativeInteger(summary?.retainedItemCount, 0),
    shortLivedItemCount: normalizeNonNegativeInteger(
      summary?.shortLivedItemCount,
      0,
    ),
    retentionRate: clamp(finiteMetric(summary?.retentionRate) ?? 0, 0, 1),
    relevanceRetentionRate: clamp(
      finiteMetric(summary?.relevanceRetentionRate) ??
        finiteMetric(summary?.retentionRate) ??
        0,
      0,
      1,
    ),
    weightedOutcome: normalizedWeightedOutcome,
    authorityAdjustment: clamp(
      Math.round(
        finiteMetric(summary?.authorityAdjustment) ??
          normalizedWeightedOutcome * AUTHORITY_MAX_EXPERTISE_POINTS,
      ),
      -AUTHORITY_MAX_EXPERTISE_POINTS,
      AUTHORITY_MAX_EXPERTISE_POINTS,
    ),
  };
}

function createEmptyDomainRetentionSummary() {
  return {
    trackedItemCount: 0,
    resolvedItemCount: 0,
    retainedItemCount: 0,
    shortLivedItemCount: 0,
    relevanceRetentionTotal: 0,
    weightedOutcomeTotal: 0,
  };
}

function finalizeDomainRetentionSummary(summary) {
  const normalizedWeightedOutcome =
    summary.resolvedItemCount === 0
      ? 0
      : clamp(
          summary.weightedOutcomeTotal / summary.resolvedItemCount,
          -1,
          1,
        );

  return {
    trackedItemCount: summary.trackedItemCount,
    resolvedItemCount: summary.resolvedItemCount,
    retainedItemCount: summary.retainedItemCount,
    shortLivedItemCount: summary.shortLivedItemCount,
    retentionRate: clamp(
      summary.resolvedItemCount === 0
        ? 0
        : summary.retainedItemCount / summary.resolvedItemCount,
      0,
      1,
    ),
    relevanceRetentionRate: clamp(
      summary.resolvedItemCount === 0
        ? 0
        : summary.relevanceRetentionTotal / summary.resolvedItemCount,
      0,
      1,
    ),
    weightedOutcome: normalizedWeightedOutcome,
    authorityAdjustment: clamp(
      Math.round(normalizedWeightedOutcome * AUTHORITY_MAX_EXPERTISE_POINTS),
      -AUTHORITY_MAX_EXPERTISE_POINTS,
      AUTHORITY_MAX_EXPERTISE_POINTS,
    ),
  };
}

function trimTrackedItems(entries, maxItems) {
  return [...entries]
    .map(normalizeTrackedItem)
    .filter(Boolean)
    .sort(compareTrackedItemsByLastObservedAtDesc)
    .slice(0, maxItems);
}

function compareTrackedItemsByLastObservedAtDesc(left, right) {
  return (
    new Date(right.lastObservedAt).getTime() -
    new Date(left.lastObservedAt).getTime()
  );
}

function resolveHighSignalThreshold(config = DEFAULT_DISCOVERY_CONFIG) {
  return clamp(
    finiteMetric(config?.highSignalItemScore) ??
      DEFAULT_DISCOVERY_CONFIG.highSignalItemScore,
    0,
    100,
  );
}

function resolveTrackedItemRelevanceRetention(
  entry,
  highSignalThreshold = resolveHighSignalThreshold(),
) {
  if (entry?.status === SOURCE_EXPERTISE_STATUS_SHORT_LIVED) {
    return 0;
  }

  const firstScore = clamp(finiteMetric(entry?.firstScore) ?? 0, 0, 100);
  const latestScore = resolveTrackedItemLatestScore(entry);

  if (latestScore < highSignalThreshold) {
    return 0;
  }

  if (firstScore <= highSignalThreshold) {
    return 1;
  }

  return clamp(
    (latestScore - highSignalThreshold) / (firstScore - highSignalThreshold),
    0,
    1,
  );
}

function resolveTrackedItemLatestScore(entry) {
  const occurrences = normalizeTrackedItemOccurrences(entry?.occurrences);

  if (occurrences.length > 0) {
    return clamp(
      occurrences[occurrences.length - 1]?.relevanceScore ?? 0,
      0,
      100,
    );
  }

  return clamp(
    finiteMetric(entry?.bestScore) ?? finiteMetric(entry?.firstScore) ?? 0,
    0,
    100,
  );
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

function resolveSourceExpertiseRetentionWindowDays(
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const value =
    finiteMetric(config?.sourceExpertiseRetentionWindowDays) ??
    DEFAULT_DISCOVERY_CONFIG.sourceExpertiseRetentionWindowDays ??
    DEFAULT_SOURCE_EXPERTISE_RETENTION_WINDOW_DAYS;

  return Math.max(1, Math.trunc(value));
}

function resolveSourceExpertiseMaxTrackedItems(
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const value =
    finiteMetric(config?.sourceExpertiseMaxTrackedItems) ??
    DEFAULT_DISCOVERY_CONFIG.sourceExpertiseMaxTrackedItems ??
    DEFAULT_SOURCE_EXPERTISE_MAX_TRACKED_ITEMS;

  return Math.max(1, Math.trunc(value));
}

function isCycleWithinWindow(candidateCycleId, currentCycleId, windowDays) {
  const candidateTime = parseCycleId(candidateCycleId);
  const currentTime = parseCycleId(currentCycleId);

  if (
    candidateTime == null ||
    currentTime == null ||
    candidateTime > currentTime
  ) {
    return false;
  }

  return candidateTime >= currentTime - (windowDays - 1) * 24 * 60 * 60 * 1000;
}

function normalizeCycleId(value) {
  return parseCycleId(value) == null ? null : value;
}

function parseCycleId(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLogarithmic(value, saturationValue) {
  const normalizedValue = Math.max(0, finiteMetric(value) ?? 0);

  if (normalizedValue === 0 || saturationValue <= 0) {
    return 0;
  }

  return (
    (Math.log10(normalizedValue + 1) / Math.log10(saturationValue + 1)) * 100
  );
}

function finiteMetric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeNonNegativeInteger(value, fallback) {
  const normalized = finiteMetric(value);

  if (normalized == null) {
    return Math.max(0, Math.trunc(fallback ?? 0));
  }

  return Math.max(0, Math.trunc(normalized));
}
