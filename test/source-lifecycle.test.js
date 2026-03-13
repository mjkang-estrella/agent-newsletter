import test from "node:test";
import assert from "node:assert/strict";

import {
  SOURCE_LIFECYCLE_STATES,
  SOURCE_LIFECYCLE_STAGES,
  SOURCE_RESTORE_REASONS,
  SOURCE_RETIREMENT_REASONS,
  activateSource,
  evaluateSourcePromotion,
  isSourceFetchEligible,
  recordSourceFetchFailure,
  recordSourceFetchSuccess,
  normalizeSourceLifecycle,
  normalizeSourcePerformance,
  recordSourceLowSignalCycle,
  recordSourcePromotionObservation,
  resolveSourceFetchBackoffMs,
  retireSource,
  restoreSource,
  startSourceProbation,
  resolveSourcePromotionRequirements,
  resolveSourceRetirementRequirements,
} from "../src/index.js";

function buildRestoreSnapshot({
  status = "approved",
  state = SOURCE_LIFECYCLE_STATES.active,
  probationStartedAt = null,
  activatedAt = null,
  retiredAt = null,
  lowSignalStreak = 0,
  lowSignalCycles = [],
  promotionEvaluationWindowDays = 3,
  retirementEvaluationWindowDays = 30,
  lastEvaluatedAt = null,
  qualifyingCycles = [],
  performance = {},
} = {}) {
  return {
    status,
    lifecycle: {
      state,
      stage: state,
      probationStartedAt,
      activatedAt,
      retiredAt,
      lowSignalStreak,
      lowSignalCycles,
      promotionEvaluationWindowDays,
      retirementEvaluationWindowDays,
      lastEvaluatedAt,
      qualifyingCycles,
    },
    performance: {
      discoveryObservationCount: 0,
      qualifyingObservationCount: qualifyingCycles.length,
      lastObservedAt: null,
      lastQualifyingObservationAt: qualifyingCycles.at(-1)?.observedAt ?? null,
      lastFetchedAt: null,
      lastSuccessfulFetchAt: null,
      lastFailedFetchAt: null,
      successfulFetchCount: 0,
      failedFetchCount: 0,
      consecutiveFetchFailures: 0,
      nextEligibleFetchAt: null,
      ...performance,
    },
  };
}

test("approved non-seed sources normalize as probationary until explicitly activated", () => {
  const lifecycle = normalizeSourceLifecycle({
    status: "approved",
    seed: false,
    approvedAt: "2026-03-10T21:00:00.000Z",
  });

  assert.deepEqual(lifecycle, {
    state: SOURCE_LIFECYCLE_STATES.probation,
    stage: SOURCE_LIFECYCLE_STAGES.probation,
    probationStartedAt: "2026-03-10T21:00:00.000Z",
    activatedAt: null,
    retiredAt: null,
    lowSignalStreak: 0,
    lowSignalCycles: [],
    promotionEvaluationWindowDays: 3,
    retirementEvaluationWindowDays: 30,
    lastEvaluatedAt: null,
    qualifyingCycles: [],
    retirementAudit: {
      current: null,
      history: [],
    },
  });
});

test("promotion requirements default to a 60-point floor across the evaluation window", () => {
  assert.deepEqual(resolveSourcePromotionRequirements(), {
    evaluationWindowDays: 3,
    evaluationWindowCycles: 3,
    minQualifyingCycles: 3,
    minScore: 60,
  });
});

test("promotion requirements honor lifecycle window overrides before config defaults", () => {
  const source = {
    status: "approved",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.probation,
      stage: SOURCE_LIFECYCLE_STAGES.probation,
      promotionEvaluationWindowDays: 2,
    },
  };

  assert.deepEqual(
    resolveSourcePromotionRequirements(source, {
      promotionEvaluationWindowDays: 4,
      probationEvaluationWindowCycles: 4,
      probationMinQualifyingCycles: 3,
      probationPromotionMinScore: 63,
    }),
    {
      evaluationWindowDays: 2,
      evaluationWindowCycles: 2,
      minQualifyingCycles: 2,
      minScore: 63,
    },
  );
});

test("retirement requirements default to three low-signal cycles within a 30-day window", () => {
  assert.deepEqual(resolveSourceRetirementRequirements(), {
    evaluationWindowDays: 30,
    minLowSignalCycles: 3,
  });
});

test("retired lifecycle records normalize performance metadata and keep evaluation windows", () => {
  const source = {
    status: "retired",
    discoveredAt: "2026-03-08T21:00:00.000Z",
    lastSeenAt: "2026-03-11T21:00:00.000Z",
    evidence: {
      discoveryCount: 4,
    },
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.retired,
      probationStartedAt: "2026-03-08T21:00:00.000Z",
      activatedAt: "2026-03-09T21:00:00.000Z",
      retiredAt: "2026-03-11T21:00:00.000Z",
      promotionEvaluationWindowDays: 5,
      retirementEvaluationWindowDays: 14,
      lowSignalStreak: 3,
      lowSignalCycles: ["2026-03-09", "2026-03-10", "2026-03-11"],
    },
  };

  const lifecycle = normalizeSourceLifecycle(source);

  assert.equal(lifecycle.state, SOURCE_LIFECYCLE_STATES.retired);
  assert.deepEqual(lifecycle.retirementAudit, {
    current: {
      retiredAt: "2026-03-11T21:00:00.000Z",
      reason: SOURCE_RETIREMENT_REASONS.lowSignalStreak,
      evidence: {
        lowSignalStreak: 3,
        lowSignalCycles: ["2026-03-09", "2026-03-10", "2026-03-11"],
      },
      restoredAt: null,
      restoreReason: null,
      restoreEvidence: null,
      restoredState: null,
      restoreSnapshot: null,
    },
    history: [
      {
        retiredAt: "2026-03-11T21:00:00.000Z",
        reason: SOURCE_RETIREMENT_REASONS.lowSignalStreak,
        evidence: {
          lowSignalStreak: 3,
          lowSignalCycles: ["2026-03-09", "2026-03-10", "2026-03-11"],
        },
        restoredAt: null,
        restoreReason: null,
        restoreEvidence: null,
        restoredState: null,
        restoreSnapshot: null,
      },
    ],
  });
  assert.deepEqual(normalizeSourcePerformance(source), {
    discoveryObservationCount: 4,
    qualifyingObservationCount: 0,
    lastObservedAt: "2026-03-11T21:00:00.000Z",
    lastQualifyingObservationAt: null,
    lastFetchedAt: null,
    lastSuccessfulFetchAt: null,
    lastFailedFetchAt: null,
    successfulFetchCount: 0,
    failedFetchCount: 0,
    consecutiveFetchFailures: 0,
    nextEligibleFetchAt: null,
  });
});

test("startSourceProbation creates an approved probationary lifecycle from a new source", () => {
  const source = {
    status: "candidate",
    discoveredAt: "2026-03-12T18:00:00.000Z",
  };

  startSourceProbation(source, "2026-03-12T21:00:00.000Z");

  assert.equal(source.status, "approved");
  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.equal(source.lifecycle.probationStartedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(source.lifecycle.activatedAt, null);
  assert.equal(source.performance.consecutiveFetchFailures, 0);
  assert.equal(source.performance.nextEligibleFetchAt, null);
});

test("probationary sources promote only after an unbroken streak of qualifying cycles", () => {
  const source = {
    status: "approved",
    seed: false,
    approvedAt: "2026-03-10T21:00:00.000Z",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.probation,
      stage: SOURCE_LIFECYCLE_STAGES.probation,
      probationStartedAt: "2026-03-10T21:00:00.000Z",
      activatedAt: null,
      qualifyingCycles: [],
    },
  };
  const config = {
    probationEvaluationWindowCycles: 2,
    probationMinQualifyingCycles: 2,
    probationPromotionMinScore: 60,
  };

  const firstObservation = recordSourcePromotionObservation(
    source,
    {
      cycleId: "2026-03-12",
      observedAt: "2026-03-12T21:00:00.000Z",
      relevanceScore: 67,
    },
    config,
  );
  const lowScoreObservation = recordSourcePromotionObservation(
    source,
    {
      cycleId: "2026-03-13",
      observedAt: "2026-03-13T21:00:00.000Z",
      relevanceScore: 59,
    },
    config,
  );
  assert.equal(firstObservation.qualified, true);
  assert.equal(firstObservation.promoted, false);
  assert.equal(lowScoreObservation.qualified, false);
  assert.equal(lowScoreObservation.promoted, false);
  assert.deepEqual(source.lifecycle.qualifyingCycles, []);

  const recoveryObservation = recordSourcePromotionObservation(
    source,
    {
      cycleId: "2026-03-14",
      observedAt: "2026-03-14T21:00:00.000Z",
      relevanceScore: 73,
    },
    config,
  );
  const secondObservation = recordSourcePromotionObservation(
    source,
    {
      cycleId: "2026-03-15",
      observedAt: "2026-03-15T21:00:00.000Z",
      relevanceScore: 75,
    },
    config,
  );
  assert.equal(recoveryObservation.qualified, true);
  assert.equal(recoveryObservation.promoted, false);
  assert.deepEqual(source.lifecycle.qualifyingCycles, [
    {
      cycleId: "2026-03-14",
      observedAt: "2026-03-14T21:00:00.000Z",
      score: 73,
    },
    {
      cycleId: "2026-03-15",
      observedAt: "2026-03-15T21:00:00.000Z",
      score: 75,
    },
  ]);
  assert.equal(secondObservation.qualified, true);
  assert.equal(secondObservation.promoted, true);
  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
});

test("evaluateSourcePromotion prunes stale qualifying cycles using the source lifecycle window", () => {
  const source = {
    status: "approved",
    approvedAt: "2026-03-10T21:00:00.000Z",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.probation,
      stage: SOURCE_LIFECYCLE_STAGES.probation,
      probationStartedAt: "2026-03-10T21:00:00.000Z",
      activatedAt: null,
      promotionEvaluationWindowDays: 2,
      qualifyingCycles: [
        {
          cycleId: "2026-03-12",
          observedAt: "2026-03-12T21:00:00.000Z",
          score: 68,
        },
        {
          cycleId: "2026-03-13",
          observedAt: "2026-03-13T21:00:00.000Z",
          score: 72,
        },
      ],
    },
  };

  const result = evaluateSourcePromotion(
    source,
    {
      cycleId: "2026-03-14",
      observedAt: "2026-03-14T21:00:00.000Z",
    },
    {
      probationEvaluationWindowCycles: 4,
      probationMinQualifyingCycles: 3,
      probationPromotionMinScore: 60,
    },
  );

  assert.equal(result.promoted, false);
  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.deepEqual(source.lifecycle.qualifyingCycles, [
    {
      cycleId: "2026-03-13",
      observedAt: "2026-03-13T21:00:00.000Z",
      score: 72,
    },
  ]);
  assert.equal(source.performance.qualifyingObservationCount, 1);
  assert.equal(
    source.performance.lastQualifyingObservationAt,
    "2026-03-13T21:00:00.000Z",
  );
});

test("activateSource clears fetch backoff when a probationary source becomes active", () => {
  const source = {
    status: "approved",
    approvedAt: "2026-03-10T21:00:00.000Z",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.probation,
      stage: SOURCE_LIFECYCLE_STAGES.probation,
      probationStartedAt: "2026-03-10T21:00:00.000Z",
      activatedAt: null,
    },
    performance: {
      failedFetchCount: 2,
      consecutiveFetchFailures: 2,
      nextEligibleFetchAt: "2026-03-13T01:00:00.000Z",
    },
  };

  activateSource(source, "2026-03-12T21:00:00.000Z");

  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(source.lifecycle.activatedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(source.performance.consecutiveFetchFailures, 0);
  assert.equal(source.performance.nextEligibleFetchAt, null);
});

test("recordSourceFetchSuccess updates fetch timestamps and clears backoff", () => {
  const source = {
    status: "approved",
    performance: {
      lastFetchedAt: "2026-03-11T21:00:00.000Z",
      lastFailedFetchAt: "2026-03-11T21:00:00.000Z",
      successfulFetchCount: 1,
      failedFetchCount: 2,
      consecutiveFetchFailures: 2,
      nextEligibleFetchAt: "2026-03-12T23:00:00.000Z",
    },
  };

  recordSourceFetchSuccess(source, "2026-03-12T21:00:00.000Z");

  assert.equal(source.performance.lastFetchedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(source.performance.lastSuccessfulFetchAt, "2026-03-12T21:00:00.000Z");
  assert.equal(source.performance.successfulFetchCount, 2);
  assert.equal(source.performance.failedFetchCount, 2);
  assert.equal(source.performance.consecutiveFetchFailures, 0);
  assert.equal(source.performance.nextEligibleFetchAt, null);
});

test("recordSourceFetchFailure increments failures and schedules capped backoff", () => {
  const source = {
    status: "approved",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.active,
      stage: SOURCE_LIFECYCLE_STAGES.active,
    },
    performance: {
      failedFetchCount: 1,
      consecutiveFetchFailures: 1,
    },
  };
  const config = {
    fetchFailureBackoffBaseMs: 60 * 60 * 1000,
    fetchFailureBackoffMaxMs: 4 * 60 * 60 * 1000,
  };

  recordSourceFetchFailure(source, "2026-03-12T21:00:00.000Z", config);

  assert.equal(source.performance.lastFetchedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(source.performance.lastFailedFetchAt, "2026-03-12T21:00:00.000Z");
  assert.equal(source.performance.failedFetchCount, 2);
  assert.equal(source.performance.consecutiveFetchFailures, 2);
  assert.equal(resolveSourceFetchBackoffMs(source, config), 2 * 60 * 60 * 1000);
  assert.equal(source.performance.nextEligibleFetchAt, "2026-03-12T23:00:00.000Z");
  assert.equal(
    isSourceFetchEligible(source, { now: "2026-03-12T22:59:59.000Z" }),
    false,
  );
  assert.equal(
    isSourceFetchEligible(source, { now: "2026-03-12T23:00:00.000Z" }),
    true,
  );
});

test("recordSourceFetchFailure retires approved sources after sustained poor performance", () => {
  const source = {
    status: "approved",
    approvedAt: "2026-03-10T21:00:00.000Z",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.active,
      stage: SOURCE_LIFECYCLE_STAGES.active,
      probationStartedAt: "2026-03-09T21:00:00.000Z",
      activatedAt: "2026-03-10T21:00:00.000Z",
    },
    performance: {
      lastFetchedAt: "2026-03-12T21:00:00.000Z",
      lastFailedFetchAt: "2026-03-12T21:00:00.000Z",
      successfulFetchCount: 1,
      failedFetchCount: 2,
      consecutiveFetchFailures: 2,
      nextEligibleFetchAt: "2026-03-12T23:00:00.000Z",
    },
  };
  const config = {
    retirementConsecutiveFetchFailures: 3,
    fetchFailureBackoffBaseMs: 60 * 60 * 1000,
    fetchFailureBackoffMaxMs: 4 * 60 * 60 * 1000,
  };

  recordSourceFetchFailure(source, "2026-03-13T21:00:00.000Z", config);

  assert.equal(source.status, "retired");
  assert.equal(source.lifecycle.state, SOURCE_LIFECYCLE_STATES.retired);
  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.retired);
  assert.equal(source.lifecycle.lastEvaluatedAt, "2026-03-13T21:00:00.000Z");
  assert.equal(source.performance.failedFetchCount, 3);
  assert.equal(source.performance.consecutiveFetchFailures, 3);
  assert.equal(source.performance.nextEligibleFetchAt, "2026-03-14T01:00:00.000Z");
  assert.equal(
    isSourceFetchEligible(source, { now: "2026-03-14T21:00:00.000Z" }),
    false,
  );
  assert.deepEqual(source.lifecycle.retirementAudit.current, {
    retiredAt: "2026-03-13T21:00:00.000Z",
    reason: SOURCE_RETIREMENT_REASONS.poorPerformance,
    evidence: {
      threshold: 3,
      consecutiveFetchFailures: 3,
      failedFetchCount: 3,
      successfulFetchCount: 1,
      lastFetchedAt: "2026-03-13T21:00:00.000Z",
      lastFailedFetchAt: "2026-03-13T21:00:00.000Z",
      nextEligibleFetchAt: "2026-03-14T01:00:00.000Z",
    },
    restoredAt: null,
    restoreReason: null,
    restoreEvidence: null,
    restoredState: null,
    restoreSnapshot: buildRestoreSnapshot({
      probationStartedAt: "2026-03-09T21:00:00.000Z",
      activatedAt: "2026-03-10T21:00:00.000Z",
      lastEvaluatedAt: "2026-03-13T21:00:00.000Z",
      performance: {
        lastFetchedAt: "2026-03-13T21:00:00.000Z",
        lastFailedFetchAt: "2026-03-13T21:00:00.000Z",
        successfulFetchCount: 1,
        failedFetchCount: 3,
        consecutiveFetchFailures: 3,
        nextEligibleFetchAt: "2026-03-14T01:00:00.000Z",
      },
    }),
  });
});

test("recordSourceFetchFailure blocks poor-performance retirement when coverage must be preserved", () => {
  const source = {
    status: "approved",
    approvedAt: "2026-03-10T21:00:00.000Z",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.active,
      stage: SOURCE_LIFECYCLE_STAGES.active,
      probationStartedAt: "2026-03-09T21:00:00.000Z",
      activatedAt: "2026-03-10T21:00:00.000Z",
    },
    performance: {
      lastFetchedAt: "2026-03-12T21:00:00.000Z",
      lastFailedFetchAt: "2026-03-12T21:00:00.000Z",
      successfulFetchCount: 1,
      failedFetchCount: 2,
      consecutiveFetchFailures: 2,
      nextEligibleFetchAt: "2026-03-12T23:00:00.000Z",
    },
  };
  const config = {
    retirementConsecutiveFetchFailures: 3,
    fetchFailureBackoffBaseMs: 60 * 60 * 1000,
    fetchFailureBackoffMaxMs: 4 * 60 * 60 * 1000,
  };

  recordSourceFetchFailure(
    source,
    "2026-03-13T21:00:00.000Z",
    config,
    {
      retirementGuard: {
        blockedCategories: ["technique"],
      },
    },
  );

  assert.equal(source.status, "approved");
  assert.equal(source.lifecycle.state, SOURCE_LIFECYCLE_STATES.active);
  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(source.lifecycle.lastEvaluatedAt, "2026-03-13T21:00:00.000Z");
  assert.equal(source.lifecycle.retirementAudit.current, null);
  assert.equal(source.performance.failedFetchCount, 3);
  assert.equal(source.performance.consecutiveFetchFailures, 3);
  assert.equal(source.performance.nextEligibleFetchAt, "2026-03-14T01:00:00.000Z");
  assert.deepEqual(source.governance.retirementDecisions, [
    {
      decidedAt: "2026-03-13T21:00:00.000Z",
      outcome: "blocked",
      reason: SOURCE_RETIREMENT_REASONS.poorPerformance,
      evidence: {
        threshold: 3,
        consecutiveFetchFailures: 3,
        failedFetchCount: 3,
        successfulFetchCount: 1,
        lastFetchedAt: "2026-03-13T21:00:00.000Z",
        lastFailedFetchAt: "2026-03-13T21:00:00.000Z",
        nextEligibleFetchAt: "2026-03-14T01:00:00.000Z",
      },
      blockedCategories: ["technique"],
      reversedAt: null,
      reverseReason: null,
      reverseEvidence: null,
      restoredState: null,
      restoreSnapshot: null,
    },
  ]);
  assert.equal(
    isSourceFetchEligible(source, { now: "2026-03-14T21:00:00.000Z", config }),
    true,
  );
});

test("retireSource marks the lifecycle as retired without dropping prior activation data", () => {
  const source = {
    status: "approved",
    approvedAt: "2026-03-10T21:00:00.000Z",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.active,
      stage: SOURCE_LIFECYCLE_STAGES.active,
      probationStartedAt: "2026-03-09T21:00:00.000Z",
      activatedAt: "2026-03-10T21:00:00.000Z",
    },
  };

  retireSource(source, "2026-03-12T21:00:00.000Z");

  assert.equal(source.status, "retired");
  assert.equal(source.lifecycle.state, SOURCE_LIFECYCLE_STATES.retired);
  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.retired);
  assert.equal(source.lifecycle.activatedAt, "2026-03-10T21:00:00.000Z");
  assert.equal(source.lifecycle.retiredAt, "2026-03-12T21:00:00.000Z");
  assert.deepEqual(source.lifecycle.retirementAudit, {
    current: {
      retiredAt: "2026-03-12T21:00:00.000Z",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: null,
      restoredAt: null,
      restoreReason: null,
      restoreEvidence: null,
      restoredState: null,
      restoreSnapshot: buildRestoreSnapshot({
        probationStartedAt: "2026-03-09T21:00:00.000Z",
        activatedAt: "2026-03-10T21:00:00.000Z",
      }),
    },
    history: [
      {
        retiredAt: "2026-03-12T21:00:00.000Z",
        reason: SOURCE_RETIREMENT_REASONS.manual,
        evidence: null,
        restoredAt: null,
        restoreReason: null,
        restoreEvidence: null,
        restoredState: null,
        restoreSnapshot: buildRestoreSnapshot({
          probationStartedAt: "2026-03-09T21:00:00.000Z",
          activatedAt: "2026-03-10T21:00:00.000Z",
        }),
      },
    ],
  });
  assert.deepEqual(source.governance.retirementDecisions, [
    {
      decidedAt: "2026-03-12T21:00:00.000Z",
      outcome: "retired",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: null,
      blockedCategories: [],
      reversedAt: null,
      reverseReason: null,
      reverseEvidence: null,
      restoredState: null,
      restoreSnapshot: buildRestoreSnapshot({
        probationStartedAt: "2026-03-09T21:00:00.000Z",
        activatedAt: "2026-03-10T21:00:00.000Z",
      }),
    },
  ]);
});

test("restoreSource can replay governance restore snapshots when the audit snapshot is absent", () => {
  const governanceRestoreSnapshot = buildRestoreSnapshot({
    probationStartedAt: "2026-03-09T21:00:00.000Z",
    activatedAt: "2026-03-10T21:00:00.000Z",
    lastEvaluatedAt: "2026-03-12T21:00:00.000Z",
    qualifyingCycles: [
      {
        cycleId: "2026-03-12",
        observedAt: "2026-03-12T21:00:00.000Z",
        score: 74,
      },
    ],
    performance: {
      discoveryObservationCount: 4,
      qualifyingObservationCount: 1,
      lastObservedAt: "2026-03-12T21:00:00.000Z",
      lastQualifyingObservationAt: "2026-03-12T21:00:00.000Z",
      failedFetchCount: 2,
      consecutiveFetchFailures: 2,
      nextEligibleFetchAt: "2026-03-13T01:00:00.000Z",
    },
  });
  const source = {
    status: "retired",
    approvedAt: "2026-03-10T21:00:00.000Z",
    retiredAt: "2026-03-13T21:00:00.000Z",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.retired,
      stage: SOURCE_LIFECYCLE_STAGES.retired,
      probationStartedAt: "2026-03-09T21:00:00.000Z",
      activatedAt: "2026-03-10T21:00:00.000Z",
      retiredAt: "2026-03-13T21:00:00.000Z",
      qualifyingCycles: [
        {
          cycleId: "2026-03-12",
          observedAt: "2026-03-12T21:00:00.000Z",
          score: 74,
        },
      ],
      lastEvaluatedAt: "2026-03-12T21:00:00.000Z",
      retirementAudit: {
        current: {
          retiredAt: "2026-03-13T21:00:00.000Z",
          reason: SOURCE_RETIREMENT_REASONS.manual,
          evidence: {
            operator: "ops",
          },
        },
      },
    },
    performance: {
      discoveryObservationCount: 4,
      qualifyingObservationCount: 1,
      lastObservedAt: "2026-03-12T21:00:00.000Z",
      lastQualifyingObservationAt: "2026-03-12T21:00:00.000Z",
      failedFetchCount: 2,
      consecutiveFetchFailures: 2,
      nextEligibleFetchAt: "2026-03-13T01:00:00.000Z",
    },
    governance: {
      retirementDecisions: [
        {
          decidedAt: "2026-03-13T21:00:00.000Z",
          outcome: "retired",
          reason: SOURCE_RETIREMENT_REASONS.manual,
          evidence: {
            operator: "ops",
          },
          blockedCategories: [],
          reversedAt: null,
          reverseReason: null,
          reverseEvidence: null,
          restoredState: null,
          restoreSnapshot: governanceRestoreSnapshot,
        },
      ],
    },
  };

  restoreSource(source, {
    now: "2026-03-14T21:00:00.000Z",
    reason: SOURCE_RESTORE_REASONS.manualReview,
    evidence: {
      reviewer: "ops",
      ticket: "SRC-77",
    },
  });

  assert.equal(source.status, "approved");
  assert.equal(source.retiredAt, null);
  assert.equal(source.lifecycle.state, SOURCE_LIFECYCLE_STATES.active);
  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(source.lifecycle.lastEvaluatedAt, "2026-03-12T21:00:00.000Z");
  assert.deepEqual(source.lifecycle.qualifyingCycles, [
    {
      cycleId: "2026-03-12",
      observedAt: "2026-03-12T21:00:00.000Z",
      score: 74,
    },
  ]);
  assert.equal(source.performance.consecutiveFetchFailures, 2);
  assert.equal(source.performance.nextEligibleFetchAt, "2026-03-13T01:00:00.000Z");
  assert.deepEqual(source.lifecycle.retirementAudit.history, [
    {
      retiredAt: "2026-03-13T21:00:00.000Z",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: {
        operator: "ops",
      },
      restoredAt: "2026-03-14T21:00:00.000Z",
      restoreReason: SOURCE_RESTORE_REASONS.manualReview,
      restoreEvidence: {
        reviewer: "ops",
        ticket: "SRC-77",
      },
      restoredState: SOURCE_LIFECYCLE_STATES.active,
      restoreSnapshot: governanceRestoreSnapshot,
    },
  ]);
  assert.deepEqual(source.governance.retirementDecisions, [
    {
      decidedAt: "2026-03-13T21:00:00.000Z",
      outcome: "retired",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: {
        operator: "ops",
      },
      blockedCategories: [],
      reversedAt: "2026-03-14T21:00:00.000Z",
      reverseReason: SOURCE_RESTORE_REASONS.manualReview,
      reverseEvidence: {
        reviewer: "ops",
        ticket: "SRC-77",
      },
      restoredState: SOURCE_LIFECYCLE_STATES.active,
      restoreSnapshot: governanceRestoreSnapshot,
    },
  ]);
});

test("restoreSource reopens a retired source through probation and closes the audit entry", () => {
  const source = {
    status: "retired",
    approvedAt: "2026-03-10T21:00:00.000Z",
    retiredAt: "2026-03-12T21:00:00.000Z",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.retired,
      stage: SOURCE_LIFECYCLE_STAGES.retired,
      probationStartedAt: "2026-03-09T21:00:00.000Z",
      activatedAt: "2026-03-10T21:00:00.000Z",
      retiredAt: "2026-03-12T21:00:00.000Z",
      qualifyingCycles: [
        {
          cycleId: "2026-03-11",
          observedAt: "2026-03-11T21:00:00.000Z",
          score: 67,
        },
      ],
      retirementAudit: {
        current: {
          retiredAt: "2026-03-12T21:00:00.000Z",
          reason: SOURCE_RETIREMENT_REASONS.lowSignalStreak,
          evidence: {
            lowSignalStreak: 3,
            lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
          },
        },
      },
    },
  };

  restoreSource(source, {
    now: "2026-03-13T21:00:00.000Z",
    reason: SOURCE_RESTORE_REASONS.manualReview,
    evidence: {
      reviewer: "ops",
      ticket: "SRC-42",
    },
    targetState: SOURCE_LIFECYCLE_STATES.probation,
  });

  assert.equal(source.status, "approved");
  assert.equal(source.retiredAt, null);
  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.equal(source.lifecycle.probationStartedAt, "2026-03-13T21:00:00.000Z");
  assert.equal(source.lifecycle.retirementAudit.current, null);
  assert.deepEqual(source.lifecycle.qualifyingCycles, []);
  assert.equal(source.performance.qualifyingObservationCount, 0);
  assert.equal(source.lifecycle.retirementAudit.history.length, 1);
  assert.deepEqual(source.lifecycle.retirementAudit.history[0], {
    retiredAt: "2026-03-12T21:00:00.000Z",
    reason: SOURCE_RETIREMENT_REASONS.lowSignalStreak,
    evidence: {
      lowSignalStreak: 3,
      lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
    },
    restoredAt: "2026-03-13T21:00:00.000Z",
    restoreReason: SOURCE_RESTORE_REASONS.manualReview,
    restoreEvidence: {
      reviewer: "ops",
      ticket: "SRC-42",
    },
    restoredState: SOURCE_LIFECYCLE_STATES.probation,
    restoreSnapshot: null,
  });
});

test("restoreSource can return a retired source directly to active while preserving prior activation history", () => {
  const source = {
    status: "retired",
    approvedAt: "2026-03-10T21:00:00.000Z",
    retiredAt: "2026-03-13T21:00:00.000Z",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.retired,
      stage: SOURCE_LIFECYCLE_STAGES.retired,
      probationStartedAt: "2026-03-09T21:00:00.000Z",
      activatedAt: "2026-03-10T21:00:00.000Z",
      retiredAt: "2026-03-13T21:00:00.000Z",
      qualifyingCycles: [
        {
          cycleId: "2026-03-12",
          observedAt: "2026-03-12T21:00:00.000Z",
          score: 74,
        },
      ],
      retirementAudit: {
        current: {
          retiredAt: "2026-03-13T21:00:00.000Z",
          reason: SOURCE_RETIREMENT_REASONS.manual,
          evidence: {
            operator: "ops",
          },
        },
      },
    },
    performance: {
      failedFetchCount: 2,
      consecutiveFetchFailures: 2,
      nextEligibleFetchAt: "2026-03-14T01:00:00.000Z",
    },
  };

  restoreSource(source, {
    now: "2026-03-14T21:00:00.000Z",
    reason: SOURCE_RESTORE_REASONS.renewedSignal,
    evidence: {
      score: 88,
    },
    targetState: SOURCE_LIFECYCLE_STATES.active,
  });

  assert.equal(source.status, "approved");
  assert.equal(source.retiredAt, null);
  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(source.lifecycle.state, SOURCE_LIFECYCLE_STATES.active);
  assert.equal(source.lifecycle.probationStartedAt, "2026-03-09T21:00:00.000Z");
  assert.equal(source.lifecycle.activatedAt, "2026-03-10T21:00:00.000Z");
  assert.deepEqual(source.lifecycle.qualifyingCycles, [
    {
      cycleId: "2026-03-12",
      observedAt: "2026-03-12T21:00:00.000Z",
      score: 74,
    },
  ]);
  assert.equal(source.performance.consecutiveFetchFailures, 0);
  assert.equal(source.performance.nextEligibleFetchAt, null);
  assert.equal(source.lifecycle.retirementAudit.current, null);
  assert.deepEqual(source.lifecycle.retirementAudit.history, [
    {
      retiredAt: "2026-03-13T21:00:00.000Z",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: {
        operator: "ops",
      },
      restoredAt: "2026-03-14T21:00:00.000Z",
      restoreReason: SOURCE_RESTORE_REASONS.renewedSignal,
      restoreEvidence: {
        score: 88,
      },
      restoredState: SOURCE_LIFECYCLE_STATES.active,
      restoreSnapshot: null,
    },
  ]);
});

test("restoreSource replays the retirement snapshot when no targetState is supplied", () => {
  const source = {
    status: "approved",
    approvedAt: "2026-03-10T21:00:00.000Z",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.active,
      stage: SOURCE_LIFECYCLE_STAGES.active,
      probationStartedAt: "2026-03-09T21:00:00.000Z",
      activatedAt: "2026-03-10T21:00:00.000Z",
      qualifyingCycles: [
        {
          cycleId: "2026-03-12",
          observedAt: "2026-03-12T21:00:00.000Z",
          score: 74,
        },
      ],
      lastEvaluatedAt: "2026-03-12T21:00:00.000Z",
    },
    performance: {
      discoveryObservationCount: 4,
      qualifyingObservationCount: 1,
      lastObservedAt: "2026-03-12T21:00:00.000Z",
      lastQualifyingObservationAt: "2026-03-12T21:00:00.000Z",
      failedFetchCount: 2,
      consecutiveFetchFailures: 2,
      nextEligibleFetchAt: "2026-03-13T01:00:00.000Z",
    },
  };

  retireSource(source, {
    now: "2026-03-13T21:00:00.000Z",
    reason: SOURCE_RETIREMENT_REASONS.manual,
    evidence: {
      operator: "ops",
    },
  });

  restoreSource(source, {
    now: "2026-03-14T21:00:00.000Z",
    reason: SOURCE_RESTORE_REASONS.manualReview,
    evidence: {
      reviewer: "ops",
      ticket: "SRC-77",
    },
  });

  assert.equal(source.status, "approved");
  assert.equal(source.retiredAt, null);
  assert.equal(source.lifecycle.state, SOURCE_LIFECYCLE_STATES.active);
  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(source.lifecycle.probationStartedAt, "2026-03-09T21:00:00.000Z");
  assert.equal(source.lifecycle.activatedAt, "2026-03-10T21:00:00.000Z");
  assert.equal(source.lifecycle.lastEvaluatedAt, "2026-03-12T21:00:00.000Z");
  assert.deepEqual(source.lifecycle.qualifyingCycles, [
    {
      cycleId: "2026-03-12",
      observedAt: "2026-03-12T21:00:00.000Z",
      score: 74,
    },
  ]);
  assert.equal(source.performance.consecutiveFetchFailures, 2);
  assert.equal(source.performance.nextEligibleFetchAt, "2026-03-13T01:00:00.000Z");
  assert.equal(source.lifecycle.retirementAudit.current, null);
  assert.deepEqual(source.lifecycle.retirementAudit.history, [
    {
      retiredAt: "2026-03-13T21:00:00.000Z",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: {
        operator: "ops",
      },
      restoredAt: "2026-03-14T21:00:00.000Z",
      restoreReason: SOURCE_RESTORE_REASONS.manualReview,
      restoreEvidence: {
        reviewer: "ops",
        ticket: "SRC-77",
      },
      restoredState: SOURCE_LIFECYCLE_STATES.active,
      restoreSnapshot: buildRestoreSnapshot({
        probationStartedAt: "2026-03-09T21:00:00.000Z",
        activatedAt: "2026-03-10T21:00:00.000Z",
        lastEvaluatedAt: "2026-03-12T21:00:00.000Z",
        qualifyingCycles: [
          {
            cycleId: "2026-03-12",
            observedAt: "2026-03-12T21:00:00.000Z",
            score: 74,
          },
        ],
        performance: {
          discoveryObservationCount: 4,
          qualifyingObservationCount: 1,
          lastObservedAt: "2026-03-12T21:00:00.000Z",
          lastQualifyingObservationAt: "2026-03-12T21:00:00.000Z",
          failedFetchCount: 2,
          consecutiveFetchFailures: 2,
          nextEligibleFetchAt: "2026-03-13T01:00:00.000Z",
        },
      }),
    },
  ]);
});

test("low-signal retirement caps the threshold to the configured evaluation window", () => {
  const source = {
    status: "approved",
    seed: false,
    approvedAt: "2026-03-10T21:00:00.000Z",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.active,
      stage: SOURCE_LIFECYCLE_STAGES.active,
      probationStartedAt: "2026-03-10T21:00:00.000Z",
      activatedAt: "2026-03-11T21:00:00.000Z",
      lowSignalStreak: 1,
      lowSignalCycles: ["2026-03-11"],
      retirementEvaluationWindowDays: 2,
    },
  };
  const result = recordSourceLowSignalCycle(
    source,
    {
      cycleId: "2026-03-12",
      observedAt: "2026-03-12T21:00:00.000Z",
    },
    {
      retirementEvaluationWindowDays: 2,
      retirementLowSignalCycles: 3,
    },
  );

  assert.deepEqual(resolveSourceRetirementRequirements({
    retirementEvaluationWindowDays: 2,
    retirementLowSignalCycles: 3,
  }), {
    evaluationWindowDays: 2,
    minLowSignalCycles: 2,
  });
  assert.equal(result.retired, true);
  assert.equal(source.status, "retired");
  assert.deepEqual(source.lifecycle.lowSignalCycles, ["2026-03-11", "2026-03-12"]);
  assert.deepEqual(source.lifecycle.retirementAudit.current, {
    retiredAt: "2026-03-12T21:00:00.000Z",
    reason: SOURCE_RETIREMENT_REASONS.lowSignalStreak,
    evidence: {
      cycleId: "2026-03-12",
      threshold: 2,
      lowSignalStreak: 2,
      lowSignalCycles: ["2026-03-11", "2026-03-12"],
      evaluationWindowDays: 2,
    },
    restoredAt: null,
    restoreReason: null,
    restoreEvidence: null,
    restoredState: null,
    restoreSnapshot: buildRestoreSnapshot({
      probationStartedAt: "2026-03-10T21:00:00.000Z",
      activatedAt: "2026-03-11T21:00:00.000Z",
      lowSignalStreak: 2,
      lowSignalCycles: ["2026-03-11", "2026-03-12"],
      retirementEvaluationWindowDays: 2,
      lastEvaluatedAt: "2026-03-12T21:00:00.000Z",
      performance: {
        lastObservedAt: "2026-03-12T21:00:00.000Z",
      },
    }),
  });
});

test("low-signal retirement stays blocked when diversity coverage would drop to zero", () => {
  const source = {
    status: "approved",
    seed: false,
    approvedAt: "2026-03-10T21:00:00.000Z",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.active,
      stage: SOURCE_LIFECYCLE_STAGES.active,
      probationStartedAt: "2026-03-10T21:00:00.000Z",
      activatedAt: "2026-03-11T21:00:00.000Z",
      lowSignalStreak: 2,
      lowSignalCycles: ["2026-03-10", "2026-03-11"],
    },
  };
  const result = recordSourceLowSignalCycle(
    source,
    {
      cycleId: "2026-03-12",
      observedAt: "2026-03-12T21:00:00.000Z",
      retirementGuard: {
        blockedCategories: ["technique"],
      },
    },
    {
      retirementEvaluationWindowDays: 30,
      retirementLowSignalCycles: 3,
    },
  );

  assert.equal(result.retired, false);
  assert.equal(result.blocked, true);
  assert.deepEqual(result.blockedCategories, ["technique"]);
  assert.equal(source.status, "approved");
  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(source.lifecycle.lowSignalStreak, 3);
  assert.deepEqual(source.lifecycle.lowSignalCycles, [
    "2026-03-10",
    "2026-03-11",
    "2026-03-12",
  ]);
});
