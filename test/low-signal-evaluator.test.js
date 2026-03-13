import test from "node:test";
import assert from "node:assert/strict";

import {
  SOURCE_LIFECYCLE_STAGES,
  SOURCE_LIFECYCLE_STATES,
  SOURCE_RETIREMENT_REASONS,
  evaluateLowSignalSources,
} from "../src/index.js";

function createActiveSource({
  id = "web:domain:docs.example.com",
  status = "approved",
  seed = false,
  lifecycleStage = SOURCE_LIFECYCLE_STATES.active,
  categoryCoverage,
  lowSignalStreak = 2,
  lowSignalCycles = ["2026-03-10", "2026-03-11"],
  performance,
} = {}) {
  return {
    id,
    kind: "web",
    entityType: "domain",
    platform: "web",
    value: id.replace(/^web:domain:/u, ""),
    displayName: id.replace(/^web:domain:/u, ""),
    url: `https://${id.replace(/^web:domain:/u, "")}`,
    canonicalUrl: `https://${id.replace(/^web:domain:/u, "")}`,
    fetchUrl: `https://${id.replace(/^web:domain:/u, "")}`,
    status,
    seed,
    authorityScore: 74,
    signalScore: 61,
    discoveredAt: "2026-03-09T21:00:00.000Z",
    approvedAt: status === "approved" ? "2026-03-10T21:00:00.000Z" : null,
    lastSeenAt: "2026-03-11T21:00:00.000Z",
    lifecycle: {
      state: lifecycleStage,
      stage: lifecycleStage,
      probationStartedAt: "2026-03-09T21:00:00.000Z",
      activatedAt:
        lifecycleStage === SOURCE_LIFECYCLE_STATES.active
          ? "2026-03-10T21:00:00.000Z"
          : null,
      lowSignalStreak,
      lowSignalCycles,
    },
    evidence: {
      discoveryCount: 2,
      referrers: ["github:domain:github.com"],
      trustedReferrers: ["github:domain:github.com"],
      seedReferrers: ["github:domain:github.com"],
      referrerPlatforms: ["web"],
      cyclesSeen: ["2026-03-10", "2026-03-11"],
      topicHits: ["agent", "tool"],
      exampleUrls: [`https://${id.replace(/^web:domain:/u, "")}/agents`],
      ...(categoryCoverage ? { categoryCoverage } : {}),
    },
    discoveredFromUrls: ["https://github.com/trending"],
    ...(performance ? { performance } : {}),
  };
}

function categoryStatusFor(result, category) {
  return result.categoryCoverageStatuses.find((entry) => entry.category === category) ?? null;
}

test("low-signal evaluator retires eligible sources after sustained weak cycles", () => {
  const source = createActiveSource();
  const sourceMap = new Map([[source.id, source]]);
  const result = evaluateLowSignalSources({
    sourceMap,
    approvedAtCycleStart: [source.id],
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
  });

  assert.deepEqual(
    result.newlyRetired.map((entry) => entry.id),
    ["web:domain:docs.example.com"],
  );
  assert.deepEqual(result.lowSignalEvaluations, [
    {
      sourceId: "web:domain:docs.example.com",
      retired: true,
      blocked: false,
      blockedCategories: [],
      lowSignalStreak: 3,
      lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
      lifecycleState: SOURCE_LIFECYCLE_STATES.retired,
    },
  ]);
  assert.equal(source.status, "retired");
  assert.equal(
    source.lifecycle.retirementAudit.current.retiredAt,
    "2026-03-12T21:00:00.000Z",
  );
  assert.equal(
    source.lifecycle.retirementAudit.current.reason,
    SOURCE_RETIREMENT_REASONS.lowSignalStreak,
  );
  assert.deepEqual(source.lifecycle.retirementAudit.current.evidence, {
    cycleId: "2026-03-12",
    threshold: 3,
    lowSignalStreak: 3,
    lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
    evaluationWindowDays: 30,
  });
  assert.equal(source.lifecycle.retirementAudit.current.restoreSnapshot.status, "approved");
  assert.equal(
    source.lifecycle.retirementAudit.current.restoreSnapshot.lifecycle.stage,
    SOURCE_LIFECYCLE_STAGES.active,
  );
  assert.deepEqual(source.governance.retirementDecisions, [
    {
      decidedAt: "2026-03-12T21:00:00.000Z",
      outcome: "retired",
      reason: SOURCE_RETIREMENT_REASONS.lowSignalStreak,
      evidence: {
        cycleId: "2026-03-12",
        threshold: 3,
        lowSignalStreak: 3,
        lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
        evaluationWindowDays: 30,
      },
      blockedCategories: [],
      reversedAt: null,
      reverseReason: null,
      reverseEvidence: null,
      restoredState: null,
      restoreSnapshot: source.lifecycle.retirementAudit.current.restoreSnapshot,
    },
  ]);
});

test("low-signal evaluator blocks retirement when it would remove the last active category source", () => {
  const source = createActiveSource({
    id: "web:domain:techniques.example.com",
    categoryCoverage: ["technique"],
  });
  const sourceMap = new Map([[source.id, source]]);
  const result = evaluateLowSignalSources({
    sourceMap,
    approvedAtCycleStart: [source.id],
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
  });

  assert.deepEqual(result.newlyRetired, []);
  assert.deepEqual(result.lowSignalEvaluations, [
    {
      sourceId: "web:domain:techniques.example.com",
      retired: false,
      blocked: true,
      blockedCategories: ["technique"],
      lowSignalStreak: 3,
      lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
      lifecycleState: SOURCE_LIFECYCLE_STATES.active,
    },
  ]);
  assert.equal(source.status, "approved");
  assert.deepEqual(categoryStatusFor(result, "technique"), {
    category: "technique",
    activeSourceCount: 1,
    status: "fragile_coverage",
  });
  assert.deepEqual(categoryStatusFor(result, "tool"), {
    category: "tool",
    activeSourceCount: 0,
    status: "blind_spot",
  });
  assert.deepEqual(source.governance.retirementDecisions, [
    {
      decidedAt: "2026-03-12T21:00:00.000Z",
      outcome: "blocked",
      reason: SOURCE_RETIREMENT_REASONS.lowSignalStreak,
      evidence: {
        cycleId: "2026-03-12",
        threshold: 3,
        lowSignalStreak: 3,
        lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
        evaluationWindowDays: 30,
      },
      blockedCategories: ["technique"],
      reversedAt: null,
      reverseReason: null,
      reverseEvidence: null,
      restoredState: null,
      restoreSnapshot: null,
    },
  ]);
});

test("low-signal evaluator derives blind spots from active-source coverage only", () => {
  const active = createActiveSource({
    id: "web:domain:techniques.example.com",
    categoryCoverage: ["technique"],
  });
  const probationary = createActiveSource({
    id: "web:domain:library-probation.example.com",
    categoryCoverage: ["library"],
    lifecycleStage: SOURCE_LIFECYCLE_STATES.probation,
    lowSignalStreak: 0,
    lowSignalCycles: [],
  });
  const sourceMap = new Map([
    [active.id, active],
    [probationary.id, probationary],
  ]);
  const result = evaluateLowSignalSources({
    sourceMap,
    approvedAtCycleStart: [],
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
  });

  assert.deepEqual(result.categoryCoverageStatuses, [
    {
      category: "tool",
      activeSourceCount: 0,
      status: "blind_spot",
    },
    {
      category: "api",
      activeSourceCount: 0,
      status: "blind_spot",
    },
    {
      category: "library",
      activeSourceCount: 0,
      status: "blind_spot",
    },
    {
      category: "technique",
      activeSourceCount: 1,
      status: "fragile_coverage",
    },
  ]);
  assert.deepEqual(result.lowSignalEvaluations, []);
});

test("low-signal evaluator skips observed, seed, and non-approved sources", () => {
  const observed = createActiveSource();
  const seed = createActiveSource({
    id: "github:domain:github.com",
    seed: true,
  });
  const candidate = createActiveSource({
    id: "web:domain:candidate.example.com",
    status: "candidate",
  });
  const sourceMap = new Map([
    [observed.id, observed],
    [seed.id, seed],
    [candidate.id, candidate],
  ]);
  const result = evaluateLowSignalSources({
    sourceMap,
    approvedAtCycleStart: [observed.id, seed.id, candidate.id],
    observedSourceIds: [observed.id],
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
  });

  assert.deepEqual(result.newlyRetired, []);
  assert.deepEqual(result.lowSignalEvaluations, []);
  assert.equal(observed.status, "approved");
  assert.equal(seed.status, "approved");
  assert.equal(candidate.status, "candidate");
});

test("low-signal evaluator retires approved sources with sustained poor fetch performance", () => {
  const source = createActiveSource({
    lowSignalStreak: 0,
    lowSignalCycles: [],
    performance: {
      lastFetchedAt: "2026-03-12T21:00:00.000Z",
      lastFailedFetchAt: "2026-03-12T21:00:00.000Z",
      successfulFetchCount: 1,
      failedFetchCount: 3,
      consecutiveFetchFailures: 3,
      nextEligibleFetchAt: "2026-03-13T01:00:00.000Z",
    },
  });
  const sourceMap = new Map([[source.id, source]]);
  const result = evaluateLowSignalSources({
    sourceMap,
    approvedAtCycleStart: [source.id],
    now: "2026-03-12T22:00:00.000Z",
    cycleId: "2026-03-12",
    config: {
      retirementConsecutiveFetchFailures: 3,
    },
  });

  assert.deepEqual(
    result.newlyRetired.map((entry) => entry.id),
    ["web:domain:docs.example.com"],
  );
  assert.deepEqual(result.lowSignalEvaluations, [
    {
      sourceId: "web:domain:docs.example.com",
      retired: true,
      blocked: false,
      blockedCategories: [],
      lowSignalStreak: 0,
      lowSignalCycles: [],
      lifecycleState: SOURCE_LIFECYCLE_STATES.retired,
      reason: SOURCE_RETIREMENT_REASONS.poorPerformance,
      consecutiveFetchFailures: 3,
      failedFetchCount: 3,
    },
  ]);
  assert.equal(source.status, "retired");
  assert.equal(
    source.lifecycle.retirementAudit.current.reason,
    SOURCE_RETIREMENT_REASONS.poorPerformance,
  );
  assert.deepEqual(source.lifecycle.retirementAudit.current.evidence, {
    threshold: 3,
    consecutiveFetchFailures: 3,
    failedFetchCount: 3,
    successfulFetchCount: 1,
    lastFetchedAt: "2026-03-12T21:00:00.000Z",
    lastFailedFetchAt: "2026-03-12T21:00:00.000Z",
    nextEligibleFetchAt: "2026-03-13T01:00:00.000Z",
  });
});

test("low-signal evaluator blocks poor-performance retirement for the last active category source", () => {
  const source = createActiveSource({
    id: "web:domain:fragile-techniques.example.com",
    categoryCoverage: ["technique"],
    lowSignalStreak: 0,
    lowSignalCycles: [],
    performance: {
      lastFetchedAt: "2026-03-12T21:00:00.000Z",
      lastFailedFetchAt: "2026-03-12T21:00:00.000Z",
      successfulFetchCount: 1,
      failedFetchCount: 3,
      consecutiveFetchFailures: 3,
      nextEligibleFetchAt: "2026-03-13T01:00:00.000Z",
    },
  });
  const sourceMap = new Map([[source.id, source]]);
  const result = evaluateLowSignalSources({
    sourceMap,
    approvedAtCycleStart: [source.id],
    now: "2026-03-12T22:00:00.000Z",
    cycleId: "2026-03-12",
    config: {
      retirementConsecutiveFetchFailures: 3,
      minimumActiveCategorySources: 2,
    },
  });

  assert.deepEqual(result.newlyRetired, []);
  assert.deepEqual(result.lowSignalEvaluations, [
    {
      sourceId: "web:domain:fragile-techniques.example.com",
      retired: false,
      blocked: true,
      blockedCategories: ["technique"],
      lowSignalStreak: 0,
      lowSignalCycles: [],
      lifecycleState: SOURCE_LIFECYCLE_STATES.active,
      reason: SOURCE_RETIREMENT_REASONS.poorPerformance,
      consecutiveFetchFailures: 3,
      failedFetchCount: 3,
    },
  ]);
  assert.equal(source.status, "approved");
  assert.deepEqual(source.governance.retirementDecisions, [
    {
      decidedAt: "2026-03-12T22:00:00.000Z",
      outcome: "blocked",
      reason: SOURCE_RETIREMENT_REASONS.poorPerformance,
      evidence: {
        threshold: 3,
        consecutiveFetchFailures: 3,
        failedFetchCount: 3,
        successfulFetchCount: 1,
        lastFetchedAt: "2026-03-12T21:00:00.000Z",
        lastFailedFetchAt: "2026-03-12T21:00:00.000Z",
        nextEligibleFetchAt: "2026-03-13T01:00:00.000Z",
      },
      blockedCategories: ["technique"],
      reversedAt: null,
      reverseReason: null,
      reverseEvidence: null,
      restoredState: null,
      restoreSnapshot: null,
    },
  ]);
});
