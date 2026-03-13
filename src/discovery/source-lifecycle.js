import { DEFAULT_DISCOVERY_CONFIG } from "./config.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const SOURCE_LIFECYCLE_STATES = Object.freeze({
  probation: "probation",
  active: "active",
  retired: "retired",
});
export const SOURCE_LIFECYCLE_STAGES = SOURCE_LIFECYCLE_STATES;
export const SOURCE_RETIREMENT_REASONS = Object.freeze({
  lowSignalStreak: "low_signal_streak",
  poorPerformance: "sustained_poor_performance",
  manual: "manual_retirement",
  legacy: "legacy_retirement",
});
export const SOURCE_RESTORE_REASONS = Object.freeze({
  manualReview: "manual_review",
  renewedSignal: "renewed_signal",
});
const SOURCE_RETIREMENT_DECISION_OUTCOMES = Object.freeze({
  retired: "retired",
  blocked: "blocked",
});

export function normalizeSourceLifecycle(
  source = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const lifecycle = source?.lifecycle ?? {};
  const state = resolveLifecycleState(source, lifecycle.state ?? lifecycle.stage);
  const qualifyingCycles = normalizeQualifyingCycles(lifecycle.qualifyingCycles);
  const probationStartedAt =
    normalizeTimestampOrNull(lifecycle.probationStartedAt) ??
    (state === SOURCE_LIFECYCLE_STATES.probation
      ? normalizeTimestampOrNull(source.approvedAt ?? source.discoveredAt)
      : null);
  const activatedAt =
    normalizeTimestampOrNull(lifecycle.activatedAt) ??
    (state === SOURCE_LIFECYCLE_STATES.active
      ? normalizeTimestampOrNull(source.approvedAt)
      : null);
  const lowSignalCycles = normalizeCycleIds(lifecycle.lowSignalCycles);
  const retiredAt =
    normalizeTimestampOrNull(lifecycle.retiredAt) ??
    (state === SOURCE_LIFECYCLE_STATES.retired
      ? normalizeTimestampOrNull(source.retiredAt ?? source.lastSeenAt)
      : null);
  const lowSignalStreak = normalizeNonNegativeInteger(
    lifecycle.lowSignalStreak,
    lowSignalCycles.length,
    "lifecycle.lowSignalStreak",
  );

  return {
    state,
    stage: state,
    probationStartedAt,
    activatedAt,
    retiredAt,
    lowSignalStreak,
    lowSignalCycles,
    promotionEvaluationWindowDays: resolvePromotionEvaluationWindowDays(
      lifecycle,
      config,
    ),
    retirementEvaluationWindowDays: resolveRetirementEvaluationWindowDays(
      lifecycle,
      config,
    ),
    lastEvaluatedAt:
      normalizeTimestampOrNull(lifecycle.lastEvaluatedAt) ??
      qualifyingCycles.at(-1)?.observedAt ??
      null,
    qualifyingCycles,
    retirementAudit: normalizeRetirementAudit(
      lifecycle.retirementAudit,
      {
        state,
        retiredAt,
        lowSignalStreak,
        lowSignalCycles,
      },
      config,
    ),
  };
}

export function normalizeSourcePerformance(
  source = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const performance = source?.performance ?? {};
  const lifecycle = normalizeSourceLifecycle(source, config);
  const discoveryObservationCount = Math.max(
    normalizeNonNegativeInteger(
      performance.discoveryObservationCount,
      0,
      "performance.discoveryObservationCount",
    ),
    source?.evidence?.discoveryCount ?? 0,
  );
  const qualifyingObservationCount = Math.max(
    normalizeNonNegativeInteger(
      performance.qualifyingObservationCount,
      0,
      "performance.qualifyingObservationCount",
    ),
    lifecycle.qualifyingCycles.length,
  );

  return {
    discoveryObservationCount,
    qualifyingObservationCount,
    lastObservedAt:
      normalizeTimestampOrNull(performance.lastObservedAt) ??
      normalizeTimestampOrNull(source.lastSeenAt) ??
      normalizeTimestampOrNull(source.discoveredAt) ??
      null,
    lastQualifyingObservationAt:
      normalizeTimestampOrNull(performance.lastQualifyingObservationAt) ??
      lifecycle.qualifyingCycles.at(-1)?.observedAt ??
      null,
    lastFetchedAt: normalizeTimestampOrNull(performance.lastFetchedAt),
    lastSuccessfulFetchAt: normalizeTimestampOrNull(
      performance.lastSuccessfulFetchAt,
    ),
    lastFailedFetchAt: normalizeTimestampOrNull(performance.lastFailedFetchAt),
    successfulFetchCount: normalizeNonNegativeInteger(
      performance.successfulFetchCount,
      0,
      "performance.successfulFetchCount",
    ),
    failedFetchCount: normalizeNonNegativeInteger(
      performance.failedFetchCount,
      0,
      "performance.failedFetchCount",
    ),
    consecutiveFetchFailures: normalizeNonNegativeInteger(
      performance.consecutiveFetchFailures,
      0,
      "performance.consecutiveFetchFailures",
    ),
    nextEligibleFetchAt: normalizeTimestampOrNull(performance.nextEligibleFetchAt),
  };
}

export function ensureSourceLifecycle(
  source,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  source.lifecycle = normalizeSourceLifecycle(source, config);
  return source.lifecycle;
}

export function ensureSourcePerformance(
  source,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  source.performance = normalizeSourcePerformance(source, config);
  return source.performance;
}

export function normalizeSourceGovernance(
  source = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  return normalizeRetirementGovernance(source?.governance, config);
}

export function startSourceProbation(
  source,
  now = new Date().toISOString(),
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const lifecycle = ensureSourceLifecycle(source, config);
  const performance = ensureSourcePerformance(source, config);

  source.status = "approved";
  source.retiredAt = null;
  lifecycle.state = SOURCE_LIFECYCLE_STATES.probation;
  lifecycle.stage = SOURCE_LIFECYCLE_STATES.probation;
  lifecycle.probationStartedAt = now;
  lifecycle.activatedAt = null;
  resetRetirementTracking(lifecycle, config);
  resetFetchBackoff(performance);

  return lifecycle;
}

export function activateSource(
  source,
  now = new Date().toISOString(),
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const lifecycle = ensureSourceLifecycle(source, config);
  const performance = ensureSourcePerformance(source, config);

  source.status = "approved";
  source.retiredAt = null;
  lifecycle.state = SOURCE_LIFECYCLE_STATES.active;
  lifecycle.stage = SOURCE_LIFECYCLE_STATES.active;
  lifecycle.activatedAt ??= now;
  lifecycle.probationStartedAt ??= source.approvedAt ?? now;
  resetRetirementTracking(lifecycle, config);
  resetFetchBackoff(performance);

  return lifecycle;
}

export function retireSource(
  source,
  nowOrOptions = new Date().toISOString(),
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const { now, reason, evidence } = resolveRetirementOptions(nowOrOptions);
  const lifecycle = ensureSourceLifecycle(source, config);
  const performance = ensureSourcePerformance(source, config);
  const restoreSnapshot = createRetirementRestoreSnapshot(
    source,
    lifecycle,
    performance,
    config,
  );

  source.status = "retired";
  source.retiredAt = now;
  lifecycle.state = SOURCE_LIFECYCLE_STATES.retired;
  lifecycle.stage = SOURCE_LIFECYCLE_STATES.retired;
  lifecycle.retiredAt = now;
  recordRetirementAudit(
    lifecycle,
    {
      retiredAt: now,
      reason,
      evidence,
      restoreSnapshot,
    },
    config,
  );
  recordSourceRetirementDecision(
    source,
    {
      decidedAt: now,
      outcome: SOURCE_RETIREMENT_DECISION_OUTCOMES.retired,
      reason,
      evidence,
      restoreSnapshot,
    },
    config,
  );

  return lifecycle;
}

export function restoreSource(
  source,
  {
    now = new Date().toISOString(),
    reason = SOURCE_RESTORE_REASONS.manualReview,
    evidence = null,
    targetState,
  } = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const lifecycle = ensureSourceLifecycle(source, config);
  ensureSourcePerformance(source, config);

  if (lifecycle.state !== SOURCE_LIFECYCLE_STATES.retired) {
    throw new Error("restoreSource requires a retired source");
  }

  const requestedTargetState =
    targetState == null ? undefined : normalizeRestoredState(targetState);

  if (targetState != null && requestedTargetState == null) {
    throw new TypeError(
      "restoreSource targetState must be 'probation' or 'active'",
    );
  }

  const currentAuditEntry = getOpenRetirementAuditEntry(lifecycle, config);
  const reversibleDecision = findReversibleRetirementDecision(
    source,
    {
      retiredAt:
        currentAuditEntry?.retiredAt ??
        lifecycle.retiredAt ??
        source.retiredAt ??
        null,
    },
    config,
  );
  const restoreSnapshot =
    currentAuditEntry?.restoreSnapshot ??
    reversibleDecision?.restoreSnapshot ??
    null;
  const auditEntryForClosure =
    currentAuditEntry == null
      ? null
      : createRetirementAuditEntry(
          {
            ...currentAuditEntry,
            restoreSnapshot,
          },
          config,
        );
  const restoredState =
    requestedTargetState ??
    restoreSnapshot?.lifecycle?.state ??
    SOURCE_LIFECYCLE_STATES.probation;
  const expectedClosedAuditEntry =
    auditEntryForClosure == null
      ? null
      : createRetirementAuditEntry(
          {
            ...auditEntryForClosure,
            restoredAt: now,
            restoreReason: reason,
            restoreEvidence: evidence,
            restoredState,
          },
          config,
        );
  const closedAuditEntry = closeCurrentRetirementAudit(
    lifecycle,
    {
      restoredAt: now,
      restoreReason: reason,
      restoreEvidence: evidence,
      restoredState,
      restoreSnapshot,
    },
    config,
  );

  if (requestedTargetState == null && restoreSnapshot) {
    applyRetirementRestoreSnapshot(
      source,
      closedAuditEntry?.restoreSnapshot ?? restoreSnapshot,
      lifecycle.retirementAudit,
      config,
    );
  } else if (restoredState === SOURCE_LIFECYCLE_STATES.active) {
    activateSource(source, now, config);
  } else if (restoredState === SOURCE_LIFECYCLE_STATES.probation) {
    startSourceProbation(source, now, config);
    source.lifecycle.qualifyingCycles = [];
    source.performance.qualifyingObservationCount = 0;
    source.performance.lastQualifyingObservationAt = null;
  } else {
    throw new TypeError(
      "restoreSource targetState must be 'probation' or 'active'",
    );
  }

  if (requestedTargetState != null || !restoreSnapshot) {
    source.lifecycle.lastEvaluatedAt = now;
  }

  if (expectedClosedAuditEntry) {
    source.lifecycle.retirementAudit = normalizeRetirementAudit(
      {
        current: null,
        history: upsertRetirementAuditEntry(
          (source.lifecycle.retirementAudit?.history ?? []).filter(
            (entry) => !sameRetirementAuditEntry(entry, expectedClosedAuditEntry),
          ),
          closedAuditEntry ?? expectedClosedAuditEntry,
        ),
      },
      {
        state: source.lifecycle.state,
        retiredAt: source.lifecycle.retiredAt,
        lowSignalStreak: source.lifecycle.lowSignalStreak,
        lowSignalCycles: source.lifecycle.lowSignalCycles,
      },
      config,
    );
  }
  markRetirementDecisionReversed(
    source,
    {
      retirementEntry:
        closedAuditEntry ?? expectedClosedAuditEntry ?? currentAuditEntry ?? null,
      reversedAt: now,
      reverseReason: reason,
      reverseEvidence: evidence,
      restoredState,
    },
    config,
  );

  return source.lifecycle;
}

export function markSourceCandidate(
  source,
  now = new Date().toISOString(),
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const lifecycle = ensureSourceLifecycle(source, config);
  const performance = ensureSourcePerformance(source, config);

  source.status = "candidate";
  source.retiredAt = null;
  lifecycle.state = SOURCE_LIFECYCLE_STATES.probation;
  lifecycle.stage = SOURCE_LIFECYCLE_STATES.probation;
  lifecycle.probationStartedAt ??= source.discoveredAt ?? now;
  lifecycle.activatedAt = null;
  lifecycle.qualifyingCycles = [];
  resetRetirementTracking(lifecycle, config);
  resetFetchBackoff(performance);

  return lifecycle;
}

export function recordSourceFetchSuccess(
  source,
  fetchedAt = new Date().toISOString(),
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const performance = ensureSourcePerformance(source, config);

  performance.lastFetchedAt = fetchedAt;
  performance.lastSuccessfulFetchAt = fetchedAt;
  performance.successfulFetchCount += 1;
  resetFetchBackoff(performance);

  return performance;
}

export function recordSourceFetchFailure(
  source,
  fetchedAt = new Date().toISOString(),
  config = DEFAULT_DISCOVERY_CONFIG,
  {
    retirementGuard = null,
  } = {},
) {
  const performance = ensureSourcePerformance(source, config);

  performance.lastFetchedAt = fetchedAt;
  performance.lastFailedFetchAt = fetchedAt;
  performance.failedFetchCount += 1;
  performance.consecutiveFetchFailures += 1;
  performance.nextEligibleFetchAt = resolveNextEligibleFetchAt(
    fetchedAt,
    resolveSourceFetchBackoffMs(source, config),
  );
  evaluateSourcePerformanceRetirement(
    source,
    {
      observedAt: fetchedAt,
      retirementGuard,
    },
    config,
  );

  return performance;
}

export function evaluateSourcePerformanceRetirement(
  source,
  {
    observedAt = new Date().toISOString(),
    retirementGuard = null,
  } = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const requirements = resolveSourcePerformanceRetirementRequirements(config);

  if (!source || source.seed === true || source.status !== "approved") {
    return {
      retired: false,
      lifecycle: source?.lifecycle ?? null,
      performance: source?.performance ?? null,
      requirements,
    };
  }

  const lifecycle = ensureSourceLifecycle(source, config);
  const performance = ensureSourcePerformance(source, config);

  lifecycle.lastEvaluatedAt = observedAt;

  if (
    performance.consecutiveFetchFailures <
    requirements.maxConsecutiveFetchFailures
  ) {
    return {
      retired: false,
      lifecycle,
      performance,
      requirements,
    };
  }

  const blockedCategories = normalizeRetirementGuardedCategories(
    retirementGuard?.blockedCategories,
  );
  const retirementEvidence = {
    threshold: requirements.maxConsecutiveFetchFailures,
    consecutiveFetchFailures: performance.consecutiveFetchFailures,
    failedFetchCount: performance.failedFetchCount,
    successfulFetchCount: performance.successfulFetchCount,
    lastFetchedAt: performance.lastFetchedAt,
    lastFailedFetchAt: performance.lastFailedFetchAt,
    nextEligibleFetchAt: performance.nextEligibleFetchAt,
  };

  if (blockedCategories.length > 0) {
    recordSourceRetirementDecision(
      source,
      {
        decidedAt: observedAt,
        outcome: SOURCE_RETIREMENT_DECISION_OUTCOMES.blocked,
        reason: SOURCE_RETIREMENT_REASONS.poorPerformance,
        evidence: retirementEvidence,
        blockedCategories,
      },
      config,
    );

    return {
      retired: false,
      blocked: true,
      blockedCategories,
      lifecycle,
      performance,
      requirements,
    };
  }

  retireSource(
    source,
    {
      now: observedAt,
      reason: SOURCE_RETIREMENT_REASONS.poorPerformance,
      evidence: retirementEvidence,
    },
    config,
  );

  return {
    retired: true,
    lifecycle: source.lifecycle,
    performance: source.performance,
    requirements,
  };
}

export function resolveSourceFetchBackoffMs(
  source,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const performance = normalizeSourcePerformance(
    typeof source === "object" && source !== null && "performance" in source
      ? source
      : { performance: source },
  );
  const consecutiveFailures = Math.max(
    0,
    performance.consecutiveFetchFailures - 1,
  );
  const baseBackoffMs = normalizePositiveInteger(
    config.fetchFailureBackoffBaseMs,
    60 * 60 * 1000,
    "fetchFailureBackoffBaseMs",
  );
  const maxBackoffMs = normalizePositiveInteger(
    config.fetchFailureBackoffMaxMs,
    24 * 60 * 60 * 1000,
    "fetchFailureBackoffMaxMs",
  );

  return Math.min(maxBackoffMs, baseBackoffMs * 2 ** consecutiveFailures);
}

export function isSourceFetchEligible(
  source,
  {
    now = new Date().toISOString(),
    config = DEFAULT_DISCOVERY_CONFIG,
  } = {},
) {
  if (!source || source.status !== "approved") {
    return false;
  }

  if (resolveSourceLifecycleState(source) === SOURCE_LIFECYCLE_STATES.retired) {
    return false;
  }

  const performance = ensureSourcePerformance(source, config);
  const nextEligibleFetchTime = parseTimestamp(performance.nextEligibleFetchAt);
  const currentTime = parseTimestamp(now);

  if (nextEligibleFetchTime == null || currentTime == null) {
    return true;
  }

  return nextEligibleFetchTime <= currentTime;
}

export function recordSourceSignalObservation(
  source,
  cycleId,
  observedAt = new Date().toISOString(),
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  if (!source) {
    return null;
  }

  const lifecycle = ensureSourceLifecycle(source, config);
  const performance = ensureSourcePerformance(source, config);

  lifecycle.lastEvaluatedAt = observedAt;

  if (source.status !== "retired") {
    resetRetirementTracking(lifecycle, config);
    source.retiredAt = null;
  }

  if (typeof observedAt === "string" && observedAt.length > 0) {
    source.lastSeenAt = observedAt;
    performance.lastObservedAt = observedAt;
  }

  if (typeof cycleId === "string" && cycleId.length > 0) {
    lifecycle.lowSignalCycles = [];
  }

  return lifecycle;
}

export function recordSourceLowSignalCycle(
  source,
  {
    cycleId,
    observedAt = new Date().toISOString(),
    retirementGuard = null,
  } = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  if (!source || source.seed === true || source.status !== "approved") {
    return {
      retired: false,
      lifecycle: source?.lifecycle ?? null,
    };
  }

  const lifecycleOverrides = source?.lifecycle ?? {};
  const lifecycle = ensureSourceLifecycle(source, config);
  const performance = ensureSourcePerformance(source, config);
  const requirements = resolveSourceRetirementRequirements({
    ...config,
    retirementEvaluationWindowDays: resolveRetirementEvaluationWindowDays(
      lifecycleOverrides,
      config,
      { preferExplicitLifecycle: true },
    ),
  });

  lifecycle.lastEvaluatedAt = observedAt;
  performance.lastObservedAt = observedAt;
  lifecycle.lowSignalCycles = Array.from(
    new Set([...lifecycle.lowSignalCycles, cycleId].filter(Boolean)),
  )
    .filter((entry) =>
      isCycleWithinWindow(
        entry,
        cycleId,
        resolveRetirementEvaluationWindowDays(lifecycleOverrides, config, {
          preferExplicitLifecycle: true,
        }),
      ),
    )
    .sort();
  lifecycle.lowSignalStreak = calculateLowSignalStreak(
    lifecycle.lowSignalCycles,
    cycleId,
  );

  if (lifecycle.lowSignalStreak < requirements.minLowSignalCycles) {
    return {
      retired: false,
      lifecycle,
    };
  }

  const blockedCategories = normalizeRetirementGuardedCategories(
    retirementGuard?.blockedCategories,
  );
  const retirementEvidence = {
    cycleId,
    threshold: requirements.minLowSignalCycles,
    lowSignalStreak: lifecycle.lowSignalStreak,
    lowSignalCycles: lifecycle.lowSignalCycles,
    evaluationWindowDays: resolveRetirementEvaluationWindowDays(
      lifecycleOverrides,
      config,
      { preferExplicitLifecycle: true },
    ),
  };

  if (blockedCategories.length > 0) {
    recordSourceRetirementDecision(
      source,
      {
        decidedAt: observedAt,
        outcome: SOURCE_RETIREMENT_DECISION_OUTCOMES.blocked,
        reason: SOURCE_RETIREMENT_REASONS.lowSignalStreak,
        evidence: retirementEvidence,
        blockedCategories,
      },
      config,
    );
    return {
      retired: false,
      blocked: true,
      blockedCategories,
      lifecycle,
    };
  }

  retireSource(
    source,
    {
      now: observedAt,
      reason: SOURCE_RETIREMENT_REASONS.lowSignalStreak,
      evidence: retirementEvidence,
    },
    config,
  );

  return {
    retired: true,
    lifecycle: source.lifecycle,
  };
}

export function resolveSourcePromotionRequirements(
  sourceOrConfig = DEFAULT_DISCOVERY_CONFIG,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const { source, config: effectiveConfig } = resolvePromotionRequirementContext(
    sourceOrConfig,
    config,
  );
  const lifecycleOverrides = source?.lifecycle ?? {};
  const lifecycle = source
    ? normalizeSourceLifecycle(source, effectiveConfig)
    : null;
  const evaluationWindowCycles = normalizePositiveInteger(
    resolvePromotionEvaluationWindowDays(lifecycleOverrides, effectiveConfig, {
      preferExplicitLifecycle: true,
    }),
    3,
    "promotionEvaluationWindowDays",
  );
  const minQualifyingCycles = Math.min(
    evaluationWindowCycles,
    normalizePositiveInteger(
      effectiveConfig.probationMinQualifyingCycles,
      evaluationWindowCycles,
      "probationMinQualifyingCycles",
    ),
  );
  const minScore = clampScore(effectiveConfig.probationPromotionMinScore ?? 60);

  return {
    evaluationWindowDays: evaluationWindowCycles,
    evaluationWindowCycles,
    minQualifyingCycles,
    minScore,
  };
}

export function evaluateSourcePromotion(
  source,
  {
    cycleId,
    observedAt = new Date().toISOString(),
  } = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  if (!source) {
    return {
      promoted: false,
      lifecycle: null,
      requirements: resolveSourcePromotionRequirements(config),
    };
  }

  const lifecycle = ensureSourceLifecycle(source, config);
  const performance = ensureSourcePerformance(source, config);
  const requirements = resolveSourcePromotionRequirements(source, config);
  const evaluationCycleId =
    normalizePromotionEvaluationCycleId(cycleId) ??
    lifecycle.qualifyingCycles.at(-1)?.cycleId ??
    null;

  if (typeof observedAt === "string" && observedAt.length > 0) {
    lifecycle.lastEvaluatedAt = observedAt;
  }

  if (evaluationCycleId != null) {
    lifecycle.qualifyingCycles = lifecycle.qualifyingCycles.filter((entry) =>
      isCycleWithinWindow(
        entry.cycleId,
        evaluationCycleId,
        requirements.evaluationWindowDays,
      ),
    );
  }

  performance.qualifyingObservationCount = lifecycle.qualifyingCycles.length;
  performance.lastQualifyingObservationAt =
    lifecycle.qualifyingCycles.at(-1)?.observedAt ?? null;

  if (
    lifecycle.state !== SOURCE_LIFECYCLE_STATES.probation ||
    evaluationCycleId == null ||
    lifecycle.qualifyingCycles.length < requirements.minQualifyingCycles
  ) {
    return {
      promoted: false,
      lifecycle,
      requirements,
    };
  }

  activateSource(source, observedAt, config);

  return {
    promoted: true,
    lifecycle: source.lifecycle,
    requirements,
  };
}

export function resolveSourceRetirementRequirements(
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const evaluationWindowDays = normalizePositiveInteger(
    config.retirementEvaluationWindowDays,
    30,
    "retirementEvaluationWindowDays",
  );
  const minLowSignalCycles = Math.min(
    evaluationWindowDays,
    normalizePositiveInteger(
      config.retirementLowSignalCycles,
      3,
      "retirementLowSignalCycles",
    ),
  );

  return {
    evaluationWindowDays,
    minLowSignalCycles,
  };
}

export function resolveSourcePerformanceRetirementRequirements(
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  return {
    maxConsecutiveFetchFailures: normalizePositiveInteger(
      config.retirementConsecutiveFetchFailures,
      3,
      "retirementConsecutiveFetchFailures",
    ),
  };
}

export function recordSourcePromotionObservation(
  source,
  {
    cycleId,
    observedAt = new Date().toISOString(),
    relevanceScore,
  } = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const lifecycle = ensureSourceLifecycle(source, config);
  const performance = ensureSourcePerformance(source, config);
  const requirements = resolveSourcePromotionRequirements(source, config);
  const score = toFiniteScore(relevanceScore);

  lifecycle.lastEvaluatedAt = observedAt;
  performance.lastObservedAt = observedAt;
  let qualified = false;

  if (
    lifecycle.state !== SOURCE_LIFECYCLE_STATES.probation ||
    normalizePromotionEvaluationCycleId(cycleId) == null
  ) {
    return {
      qualified,
      promoted: false,
      lifecycle,
      requirements,
    };
  }

  if (score != null && score >= requirements.minScore) {
    const observations = new Map(
      lifecycle.qualifyingCycles.map((entry) => [entry.cycleId, entry]),
    );
    const existing = observations.get(cycleId);

    if (!existing || score > existing.score) {
      observations.set(cycleId, {
        cycleId,
        observedAt,
        score,
      });
    }

    lifecycle.qualifyingCycles = Array.from(observations.values()).sort(
      compareCycleEntries,
    );
    performance.lastQualifyingObservationAt = observedAt;
    qualified = true;
  } else if (
    !lifecycle.qualifyingCycles.some((entry) => entry.cycleId === cycleId)
  ) {
    lifecycle.qualifyingCycles = [];
  }

  const evaluation = evaluateSourcePromotion(
    source,
    {
      cycleId,
      observedAt,
    },
    config,
  );

  return {
    qualified,
    promoted: evaluation.promoted,
    lifecycle: evaluation.lifecycle,
    requirements,
  };
}

export function resolveSourceLifecycleState(source) {
  return normalizeSourceLifecycle(source).state;
}

function resolveLifecycleState(source, rawState) {
  if (
    rawState === SOURCE_LIFECYCLE_STATES.probation ||
    rawState === SOURCE_LIFECYCLE_STATES.active ||
    rawState === SOURCE_LIFECYCLE_STATES.retired
  ) {
    return rawState;
  }

  if (rawState === "candidate") {
    return SOURCE_LIFECYCLE_STATES.probation;
  }

  if (source?.seed === true) {
    return SOURCE_LIFECYCLE_STATES.active;
  }

  if (source?.retiredAt != null) {
    return SOURCE_LIFECYCLE_STATES.retired;
  }

  if (source?.status === "retired") {
    return SOURCE_LIFECYCLE_STATES.retired;
  }

  if (normalizeTimestampOrNull(source?.lifecycle?.activatedAt) != null) {
    return SOURCE_LIFECYCLE_STATES.active;
  }

  if (normalizeTimestampOrNull(source?.lifecycle?.probationStartedAt) != null) {
    return SOURCE_LIFECYCLE_STATES.probation;
  }

  if (source?.status === "approved") {
    return SOURCE_LIFECYCLE_STATES.probation;
  }

  return SOURCE_LIFECYCLE_STATES.probation;
}

function normalizeQualifyingCycles(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const cycleId =
        typeof entry.cycleId === "string" && entry.cycleId.length
          ? entry.cycleId
          : null;
      const observedAt = normalizeTimestampOrNull(entry.observedAt);
      const score = toFiniteScore(entry.score);

      if (!cycleId || observedAt == null || score == null) {
        return null;
      }

      return {
        cycleId,
        observedAt,
        score,
      };
    })
    .filter(Boolean)
    .sort(compareCycleEntries);
}

function normalizeRetirementAudit(
  retirementAudit = {},
  {
    state,
    retiredAt,
    lowSignalStreak,
    lowSignalCycles,
  } = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const currentEntry = normalizeRetirementAuditEntry(retirementAudit?.current, config);
  let history = Array.isArray(retirementAudit?.history)
    ? retirementAudit.history.map((entry) => normalizeRetirementAuditEntry(entry, config))
    : [];

  history = history.filter(Boolean);
  const current = currentEntry?.restoredAt == null ? currentEntry : null;
  const matchingHistoricalEntry =
    retiredAt == null
      ? null
      : history.find((entry) => entry.retiredAt === retiredAt) ?? null;

  const inferredCurrent =
    state === SOURCE_LIFECYCLE_STATES.retired
      ? current ??
        (matchingHistoricalEntry?.restoredAt == null
          ? matchingHistoricalEntry
          : null) ??
        (matchingHistoricalEntry == null
          ? createRetirementAuditEntry({
              retiredAt,
              reason:
                lowSignalCycles?.length > 0
                  ? SOURCE_RETIREMENT_REASONS.lowSignalStreak
                  : SOURCE_RETIREMENT_REASONS.legacy,
              evidence:
                lowSignalStreak > 0 || (lowSignalCycles?.length ?? 0) > 0
                  ? {
                      lowSignalStreak,
                      lowSignalCycles,
                    }
                  : null,
            }, config)
          : null)
      : null;

  if (inferredCurrent) {
    history = upsertRetirementAuditEntry(history, inferredCurrent);
  }

  return {
    current: inferredCurrent,
    history: history.sort(compareRetirementAuditEntries),
  };
}

function createRetirementAuditEntry({
  retiredAt,
  reason,
  evidence = null,
  restoredAt = null,
  restoreReason = null,
  restoreEvidence = null,
  restoredState = null,
  restoreSnapshot = null,
} = {},
config = DEFAULT_DISCOVERY_CONFIG,
) {
  return normalizeRetirementAuditEntry({
    retiredAt,
    reason,
    evidence,
    restoredAt,
    restoreReason,
    restoreEvidence,
    restoredState,
    restoreSnapshot,
  }, config);
}

function normalizeRetirementAuditEntry(
  entry,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const retiredAt = normalizeTimestampOrNull(entry.retiredAt);
  const reason = normalizeAuditReason(entry.reason);

  if (retiredAt == null || reason == null) {
    return null;
  }

  return {
    retiredAt,
    reason,
    evidence: normalizeAuditEvidence(entry.evidence),
    restoredAt: normalizeTimestampOrNull(entry.restoredAt),
    restoreReason: normalizeAuditReason(entry.restoreReason),
    restoreEvidence: normalizeAuditEvidence(entry.restoreEvidence),
    restoredState: normalizeRestoredState(entry.restoredState),
    restoreSnapshot: normalizeRetirementRestoreSnapshot(entry.restoreSnapshot, config),
  };
}

function normalizeRetirementRestoreSnapshot(
  snapshot,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }

  const status = normalizeRestorableStatus(snapshot.status);

  if (status == null) {
    return null;
  }

  const normalizedLifecycle = normalizeSourceLifecycle(
    {
      status,
      retiredAt: snapshot.lifecycle?.retiredAt ?? snapshot.retiredAt ?? null,
      lifecycle: snapshot.lifecycle,
    },
    config,
  );
  const normalizedPerformance = normalizeSourcePerformance(
    {
      status,
      retiredAt: snapshot.lifecycle?.retiredAt ?? snapshot.retiredAt ?? null,
      lifecycle: snapshot.lifecycle,
      performance: snapshot.performance,
    },
    config,
  );

  return {
    status,
    lifecycle: selectRetirementRestoreLifecycleFields(normalizedLifecycle),
    performance: normalizedPerformance,
  };
}

function normalizeRestorableStatus(value) {
  return value === "approved" || value === "candidate" ? value : null;
}

function selectRetirementRestoreLifecycleFields(lifecycle) {
  return {
    state: lifecycle.state,
    stage: lifecycle.stage,
    probationStartedAt: lifecycle.probationStartedAt,
    activatedAt: lifecycle.activatedAt,
    retiredAt: lifecycle.retiredAt,
    lowSignalStreak: lifecycle.lowSignalStreak,
    lowSignalCycles: lifecycle.lowSignalCycles,
    promotionEvaluationWindowDays: lifecycle.promotionEvaluationWindowDays,
    retirementEvaluationWindowDays: lifecycle.retirementEvaluationWindowDays,
    lastEvaluatedAt: lifecycle.lastEvaluatedAt,
    qualifyingCycles: lifecycle.qualifyingCycles,
  };
}

function normalizeAuditEvidence(value) {
  if (value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeAuditEvidence(entry));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, normalizeAuditEvidence(entry)]),
    );
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return String(value);
}

function normalizeAuditReason(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRestoredState(value) {
  return value === SOURCE_LIFECYCLE_STATES.probation ||
    value === SOURCE_LIFECYCLE_STATES.active
    ? value
    : null;
}

function compareRetirementAuditEntries(left, right) {
  return left.retiredAt.localeCompare(right.retiredAt);
}

function upsertRetirementAuditEntry(history, entry) {
  return [
    ...history.filter((candidate) => !sameRetirementAuditEntry(candidate, entry)),
    entry,
  ];
}

function sameRetirementAuditEntry(left, right) {
  return left.retiredAt === right.retiredAt;
}

function normalizeCycleIds(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return Array.from(
    new Set(entries.filter((entry) => typeof entry === "string" && parseCycleId(entry) != null)),
  ).sort();
}

function calculateLowSignalStreak(cycleIds, currentCycleId) {
  const currentTime = parseCycleId(currentCycleId);

  if (currentTime == null) {
    return 0;
  }

  let streak = 0;

  for (let offset = 0; offset < cycleIds.length; offset += 1) {
    const expectedCycleId = new Date(currentTime - offset * DAY_IN_MS)
      .toISOString()
      .slice(0, 10);

    if (!cycleIds.includes(expectedCycleId)) {
      break;
    }

    streak += 1;
  }

  return streak;
}

function compareCycleEntries(left, right) {
  return left.cycleId.localeCompare(right.cycleId);
}

function isCycleWithinWindow(candidateCycleId, currentCycleId, windowCycles) {
  const candidateTime = parseCycleId(candidateCycleId);
  const currentTime = parseCycleId(currentCycleId);

  if (candidateTime == null || currentTime == null || candidateTime > currentTime) {
    return false;
  }

  return candidateTime >= currentTime - (windowCycles - 1) * DAY_IN_MS;
}

function normalizePromotionEvaluationCycleId(value) {
  return parseCycleId(value) == null ? null : value;
}

function parseCycleId(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function parseTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function normalizeTimestampOrNull(value) {
  const timestamp = parseTimestamp(value);
  return timestamp == null ? null : new Date(timestamp).toISOString();
}

function toFiniteScore(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? clampScore(value)
    : null;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, value));
}

function resolvePromotionEvaluationWindowDays(
  lifecycle,
  config = DEFAULT_DISCOVERY_CONFIG,
  { preferExplicitLifecycle = false } = {},
) {
  return normalizePositiveInteger(
    readLifecycleWindowDays(
      lifecycle,
      "promotionEvaluationWindowDays",
      preferExplicitLifecycle,
    ) ??
      resolveConfiguredPromotionEvaluationWindowDays(config),
    3,
    "promotionEvaluationWindowDays",
  );
}

function resolveConfiguredPromotionEvaluationWindowDays(
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const probationEvaluationWindowCycles = normalizePositiveInteger(
    config.probationEvaluationWindowCycles,
    DEFAULT_DISCOVERY_CONFIG.probationEvaluationWindowCycles,
    "promotionEvaluationWindowDays",
  );
  const promotionEvaluationWindowDays = normalizePositiveInteger(
    config.promotionEvaluationWindowDays,
    DEFAULT_DISCOVERY_CONFIG.promotionEvaluationWindowDays,
    "promotionEvaluationWindowDays",
  );
  const hasCustomProbationWindow =
    probationEvaluationWindowCycles !==
    DEFAULT_DISCOVERY_CONFIG.probationEvaluationWindowCycles;
  const hasCustomPromotionWindow =
    promotionEvaluationWindowDays !==
    DEFAULT_DISCOVERY_CONFIG.promotionEvaluationWindowDays;

  return normalizePositiveInteger(
    hasCustomProbationWindow
      ? probationEvaluationWindowCycles
      : hasCustomPromotionWindow
        ? promotionEvaluationWindowDays
        : probationEvaluationWindowCycles ?? promotionEvaluationWindowDays,
    3,
    "promotionEvaluationWindowDays",
  );
}

function resolvePromotionRequirementContext(
  sourceOrConfig,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  if (isSourceRecord(sourceOrConfig)) {
    return {
      source: sourceOrConfig,
      config,
    };
  }

  return {
    source: null,
    config: sourceOrConfig ?? DEFAULT_DISCOVERY_CONFIG,
  };
}

function resolveRetirementEvaluationWindowDays(
  lifecycle,
  config = DEFAULT_DISCOVERY_CONFIG,
  { preferExplicitLifecycle = false } = {},
) {
  return normalizePositiveInteger(
    readLifecycleWindowDays(
      lifecycle,
      "retirementEvaluationWindowDays",
      preferExplicitLifecycle,
    ) ??
      config.retirementEvaluationWindowDays,
    30,
    "retirementEvaluationWindowDays",
  );
}

function readLifecycleWindowDays(
  lifecycle,
  fieldName,
  preferExplicitLifecycle,
) {
  if (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle)) {
    return null;
  }

  if (preferExplicitLifecycle) {
    return Object.prototype.hasOwnProperty.call(lifecycle, fieldName)
      ? lifecycle[fieldName]
      : null;
  }

  return lifecycle[fieldName];
}

function isSourceRecord(value) {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ("status" in value ||
      "lifecycle" in value ||
      "seed" in value ||
      "approvedAt" in value)
  );
}

function normalizeNonNegativeInteger(value, fallback, fieldName) {
  if (value == null) {
    return Math.max(0, Math.trunc(fallback ?? 0));
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative number when provided`);
  }

  return Math.trunc(value);
}

function normalizePositiveInteger(value, fallback, fieldName) {
  if (value == null) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive number when provided`);
  }

  return Math.trunc(value);
}

function resetRetirementTracking(
  lifecycle,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  lifecycle.retiredAt = null;
  lifecycle.lowSignalStreak = 0;
  lifecycle.lowSignalCycles = [];
  ensureRetirementAudit(lifecycle, config).current = null;
}

function resetFetchBackoff(performance) {
  performance.consecutiveFetchFailures = 0;
  performance.nextEligibleFetchAt = null;
}

function normalizeRetirementGuardedCategories(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return Array.from(
    new Set(
      entries.filter((entry) => typeof entry === "string" && entry.length > 0),
    ),
  ).sort();
}

function resolveNextEligibleFetchAt(fetchedAt, backoffMs) {
  const fetchedAtTimestamp = parseTimestamp(fetchedAt);

  if (fetchedAtTimestamp == null) {
    return null;
  }

  return new Date(fetchedAtTimestamp + backoffMs).toISOString();
}

function ensureRetirementAudit(
  lifecycle,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  lifecycle.retirementAudit = normalizeRetirementAudit(
    lifecycle.retirementAudit,
    {
      state: lifecycle.state,
      retiredAt: lifecycle.retiredAt,
      lowSignalStreak: lifecycle.lowSignalStreak,
      lowSignalCycles: lifecycle.lowSignalCycles,
    },
    config,
  );

  return lifecycle.retirementAudit;
}

function normalizeRetirementGovernance(
  governance = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  return {
    retirementDecisions: normalizeRetirementDecisionEntries(
      governance?.retirementDecisions,
      config,
    ),
  };
}

function ensureRetirementGovernance(
  source,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  source.governance = normalizeRetirementGovernance(source?.governance, config);
  return source.governance;
}

export function recordSourceRetirementDecision(
  source,
  {
    decidedAt,
    outcome,
    reason,
    evidence = null,
    blockedCategories = [],
    restoreSnapshot = null,
  } = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const governance = ensureRetirementGovernance(source, config);
  const entry = createRetirementDecisionEntry({
    decidedAt,
    outcome,
    reason,
    evidence,
    blockedCategories,
    restoreSnapshot,
  }, config);

  if (!entry) {
    return null;
  }

  governance.retirementDecisions = upsertRetirementDecisionEntry(
    governance.retirementDecisions,
    entry,
  ).sort(compareRetirementDecisionEntries);

  return entry;
}

function markRetirementDecisionReversed(
  source,
  {
    retirementEntry = null,
    reversedAt,
    reverseReason,
    reverseEvidence = null,
    restoredState = null,
  } = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const governance = ensureRetirementGovernance(source, config);
  const normalizedRetirementEntry = normalizeRetirementAuditEntry(
    retirementEntry,
    config,
  );
  const matchingDecision = [...governance.retirementDecisions]
    .reverse()
    .find((entry) => {
      if (entry.outcome !== SOURCE_RETIREMENT_DECISION_OUTCOMES.retired) {
        return false;
      }

      if (
        normalizedRetirementEntry?.retiredAt &&
        entry.decidedAt !== normalizedRetirementEntry.retiredAt
      ) {
        return false;
      }

      return entry.reversedAt == null;
    });
  const baseEntry =
    matchingDecision ??
    createRetirementDecisionEntry({
      decidedAt: normalizedRetirementEntry?.retiredAt,
      outcome: SOURCE_RETIREMENT_DECISION_OUTCOMES.retired,
      reason: normalizedRetirementEntry?.reason,
      evidence: normalizedRetirementEntry?.evidence,
      restoreSnapshot: normalizedRetirementEntry?.restoreSnapshot ?? null,
    }, config);

  if (!baseEntry) {
    return null;
  }

  const reversedEntry = createRetirementDecisionEntry({
    ...baseEntry,
    reversedAt,
    reverseReason,
    reverseEvidence,
    restoredState,
  }, config);

  if (!reversedEntry) {
    return null;
  }

  governance.retirementDecisions = upsertRetirementDecisionEntry(
    governance.retirementDecisions.filter(
      (entry) => !sameRetirementDecisionEntry(entry, baseEntry),
    ),
    reversedEntry,
  ).sort(compareRetirementDecisionEntries);

  return reversedEntry;
}

function recordRetirementAudit(
  lifecycle,
  {
    retiredAt,
    reason,
    evidence,
    restoreSnapshot,
  } = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const retirementAudit = ensureRetirementAudit(lifecycle, config);
  const entry = createRetirementAuditEntry({
    retiredAt,
    reason,
    evidence,
    restoreSnapshot,
  }, config);

  if (!entry) {
    return null;
  }

  retirementAudit.current = entry;
  retirementAudit.history = upsertRetirementAuditEntry(retirementAudit.history, entry).sort(
    compareRetirementAuditEntries,
  );

  return entry;
}

function closeCurrentRetirementAudit(
  lifecycle,
  {
    restoredAt,
    restoreReason,
    restoreEvidence,
    restoredState,
    restoreSnapshot = null,
  } = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const retirementAudit = ensureRetirementAudit(lifecycle, config);
  const current = getOpenRetirementAuditEntry(lifecycle, config);

  if (!current) {
    return null;
  }

  const restoredEntry = createRetirementAuditEntry({
    ...current,
    restoreSnapshot: restoreSnapshot ?? current.restoreSnapshot ?? null,
    restoredAt,
    restoreReason,
    restoreEvidence,
    restoredState,
  }, config);

  retirementAudit.current = null;
  retirementAudit.history = upsertRetirementAuditEntry(
    retirementAudit.history.filter(
      (entry) => !sameRetirementAuditEntry(entry, current),
    ),
    restoredEntry,
  ).sort(compareRetirementAuditEntries);

  return restoredEntry;
}

function getOpenRetirementAuditEntry(
  lifecycle,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const retirementAudit = ensureRetirementAudit(lifecycle, config);

  return (
    retirementAudit.current ??
    [...retirementAudit.history]
      .reverse()
      .find((entry) => entry.restoredAt == null) ??
    null
  );
}

function findReversibleRetirementDecision(
  source,
  {
    retiredAt = null,
  } = {},
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const governance = ensureRetirementGovernance(source, config);

  return (
    [...governance.retirementDecisions]
      .reverse()
      .find((entry) => {
        if (
          entry.outcome !== SOURCE_RETIREMENT_DECISION_OUTCOMES.retired ||
          entry.reversedAt != null
        ) {
          return false;
        }

        if (retiredAt != null && entry.decidedAt !== retiredAt) {
          return false;
        }

        return true;
      }) ?? null
  );
}

function createRetirementDecisionEntry({
  decidedAt,
  outcome,
  reason,
  evidence = null,
  blockedCategories = [],
  reversedAt = null,
  reverseReason = null,
  reverseEvidence = null,
  restoredState = null,
  restoreSnapshot = null,
} = {},
config = DEFAULT_DISCOVERY_CONFIG,
) {
  return normalizeRetirementDecisionEntry({
    decidedAt,
    outcome,
    reason,
    evidence,
    blockedCategories,
    reversedAt,
    reverseReason,
    reverseEvidence,
    restoredState,
    restoreSnapshot,
  }, config);
}

function normalizeRetirementDecisionEntries(
  entries,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => normalizeRetirementDecisionEntry(entry, config))
    .filter(Boolean)
    .sort(compareRetirementDecisionEntries);
}

function normalizeRetirementDecisionEntry(
  entry,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const decidedAt = normalizeTimestampOrNull(entry.decidedAt ?? entry.retiredAt);
  const outcome = normalizeRetirementDecisionOutcome(entry.outcome);
  const reason = normalizeAuditReason(entry.reason);

  if (decidedAt == null || outcome == null || reason == null) {
    return null;
  }

  return {
    decidedAt,
    outcome,
    reason,
    evidence: normalizeAuditEvidence(entry.evidence),
    blockedCategories: normalizeRetirementGuardedCategories(
      entry.blockedCategories,
    ),
    reversedAt: normalizeTimestampOrNull(entry.reversedAt),
    reverseReason: normalizeAuditReason(entry.reverseReason),
    reverseEvidence: normalizeAuditEvidence(entry.reverseEvidence),
    restoredState: normalizeRestoredState(entry.restoredState),
    restoreSnapshot: normalizeRetirementRestoreSnapshot(entry.restoreSnapshot, config),
  };
}

function normalizeRetirementDecisionOutcome(value) {
  return value === SOURCE_RETIREMENT_DECISION_OUTCOMES.retired ||
    value === SOURCE_RETIREMENT_DECISION_OUTCOMES.blocked
    ? value
    : null;
}

function upsertRetirementDecisionEntry(entries, candidate) {
  return [
    ...entries.filter((entry) => !sameRetirementDecisionEntry(entry, candidate)),
    candidate,
  ];
}

function sameRetirementDecisionEntry(left, right) {
  return (
    left?.decidedAt === right?.decidedAt &&
    left?.outcome === right?.outcome &&
    left?.reason === right?.reason
  );
}

function compareRetirementDecisionEntries(left, right) {
  if (left.decidedAt !== right.decidedAt) {
    return left.decidedAt.localeCompare(right.decidedAt);
  }

  return left.outcome.localeCompare(right.outcome);
}

function createRetirementRestoreSnapshot(
  source,
  lifecycle,
  performance,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  return normalizeRetirementRestoreSnapshot(
    {
      status: source.status,
      lifecycle: selectRetirementRestoreLifecycleFields(lifecycle),
      performance: {
        ...performance,
      },
    },
    config,
  );
}

function applyRetirementRestoreSnapshot(
  source,
  restoreSnapshot,
  retirementAudit,
  config = DEFAULT_DISCOVERY_CONFIG,
) {
  const normalizedSnapshot = normalizeRetirementRestoreSnapshot(
    restoreSnapshot,
    config,
  );

  if (!normalizedSnapshot) {
    return false;
  }

  source.status = normalizedSnapshot.status;
  source.retiredAt = normalizedSnapshot.lifecycle.retiredAt;
  source.lifecycle = {
    ...normalizedSnapshot.lifecycle,
    retirementAudit: normalizeRetirementAudit(
      retirementAudit,
      {
        state: normalizedSnapshot.lifecycle.state,
        retiredAt: normalizedSnapshot.lifecycle.retiredAt,
        lowSignalStreak: normalizedSnapshot.lifecycle.lowSignalStreak,
        lowSignalCycles: normalizedSnapshot.lifecycle.lowSignalCycles,
      },
      config,
    ),
  };
  source.performance = normalizedSnapshot.performance;

  return true;
}

function resolveRetirementOptions(nowOrOptions) {
  if (typeof nowOrOptions === "string" || nowOrOptions == null) {
    return {
      now: nowOrOptions ?? new Date().toISOString(),
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: null,
    };
  }

  if (typeof nowOrOptions !== "object" || Array.isArray(nowOrOptions)) {
    throw new TypeError("retireSource options must be a timestamp or object");
  }

  return {
    now:
      normalizeTimestampOrNull(nowOrOptions.now) ?? new Date().toISOString(),
    reason:
      normalizeAuditReason(nowOrOptions.reason) ??
      SOURCE_RETIREMENT_REASONS.manual,
    evidence: normalizeAuditEvidence(nowOrOptions.evidence),
  };
}
