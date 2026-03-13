import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  SOURCE_RESTORE_REASONS,
  SOURCE_RETIREMENT_REASONS,
  SOURCE_LIFECYCLE_STATES,
  SourceRepository,
} from "../src/index.js";

function buildRestoreSnapshot({
  status = "approved",
  state = SOURCE_LIFECYCLE_STATES.active,
  probationStartedAt = null,
  activatedAt = null,
  retiredAt = null,
  lowSignalStreak = 0,
  lowSignalCycles = [],
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
      promotionEvaluationWindowDays: 3,
      retirementEvaluationWindowDays: 30,
      lastEvaluatedAt,
      qualifyingCycles,
    },
    performance: {
      discoveryObservationCount: 2,
      qualifyingObservationCount: qualifyingCycles.length,
      lastObservedAt: "2026-03-12T21:00:00.000Z",
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

async function createRepository(config = {}) {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-"));

  return new SourceRepository({
    filePath: join(directory, "source-registry.json"),
    config,
  });
}

function createTrackedSource({
  id,
  status,
  lifecycle,
  performance,
  categoryCoverage = ["tool"],
  lastSeenAt = "2026-03-12T21:00:00.000Z",
}) {
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
    seed: false,
    authorityScore: 72,
    signalScore: 61,
    discoveredAt: "2026-03-10T21:00:00.000Z",
    approvedAt: status === "approved" ? "2026-03-11T21:00:00.000Z" : null,
    lastSeenAt,
    lifecycle,
    evidence: {
      discoveryCount: 2,
      referrers: ["github:domain:github.com"],
      trustedReferrers: ["github:domain:github.com"],
      seedReferrers: ["github:domain:github.com"],
      referrerPlatforms: ["web"],
      cyclesSeen: ["2026-03-10", "2026-03-11"],
      topicHits: ["agent", "tool"],
      categoryCoverage,
      exampleUrls: [`https://${id.replace(/^web:domain:/u, "")}/agents`],
      authoritySignals: {
        observed: true,
        citationCount: 2,
        referrers: ["github:domain:github.com"],
        sourceKinds: ["github"],
        cyclesSeen: ["2026-03-10", "2026-03-11"],
        githubStars: 0,
        githubActivity: 0,
      },
    },
    discoveredFromUrls: ["https://github.com/trending"],
    ...(performance ? { performance } : {}),
  };
}

test("source repository backfills lifecycle windows and performance metadata", async () => {
  const repository = await createRepository({
    promotionEvaluationWindowDays: 5,
    retirementEvaluationWindowDays: 14,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [
      createTrackedSource({
        id: "web:domain:docs.example.com",
        status: "candidate",
      }),
    ],
  });

  const snapshot = await repository.load({
    now: "2026-03-12T21:00:00.000Z",
  });
  const source = snapshot.sources.find(
    (entry) => entry.id === "web:domain:docs.example.com",
  );

  assert.equal(source.lifecycle.state, SOURCE_LIFECYCLE_STATES.probation);
  assert.equal(source.lifecycle.promotionEvaluationWindowDays, 5);
  assert.equal(source.lifecycle.retirementEvaluationWindowDays, 14);
  assert.equal(source.performance.discoveryObservationCount, 2);
  assert.equal(source.performance.lastObservedAt, "2026-03-12T21:00:00.000Z");
});

test("source repository preserves normalized domain-expertise retention summaries", async () => {
  const repository = await createRepository();
  const source = createTrackedSource({
    id: "web:domain:docs.example.com",
    status: "approved",
    lifecycle: {
      state: SOURCE_LIFECYCLE_STATES.active,
      stage: SOURCE_LIFECYCLE_STATES.active,
      probationStartedAt: "2026-03-10T21:00:00.000Z",
      activatedAt: "2026-03-11T21:00:00.000Z",
    },
  });

  source.evidence.authoritySignals.expertise = {
    trackedItems: [
      {
        itemId: "artifact-acme-agent-runtime",
        firstCycleId: "2026-03-10",
        firstObservedAt: "2026-03-10T21:00:00.000Z",
        lastCycleId: "2026-03-11",
        lastObservedAt: "2026-03-11T21:00:00.000Z",
        firstScore: 81,
        bestScore: 85,
        appearanceCount: 2,
        domains: ["tool", "runtime"],
        status: "retained",
        resolvedAt: "2026-03-11T21:00:00.000Z",
      },
    ],
    lastUpdatedAt: "2026-03-11T21:00:00.000Z",
  };

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [source],
  });

  const snapshot = await repository.load({
    now: "2026-03-12T21:00:00.000Z",
  });
  const storedSource = snapshot.sources.find(
    (entry) => entry.id === "web:domain:docs.example.com",
  );

  assert.deepEqual(
    storedSource.evidence.authoritySignals.domainExpertiseRetention,
    {
      trackedItemCount: 1,
      resolvedItemCount: 1,
      retainedItemCount: 1,
      shortLivedItemCount: 0,
      retentionRate: 1,
      relevanceRetentionRate: 1,
      weightedOutcome: 0.5,
      authorityAdjustment: 6,
      domains: {
        runtime: {
          trackedItemCount: 1,
          resolvedItemCount: 1,
          retainedItemCount: 1,
          shortLivedItemCount: 0,
          retentionRate: 1,
          relevanceRetentionRate: 1,
          weightedOutcome: 0.5,
          authorityAdjustment: 6,
        },
        tool: {
          trackedItemCount: 1,
          resolvedItemCount: 1,
          retainedItemCount: 1,
          shortLivedItemCount: 0,
          retentionRate: 1,
          relevanceRetentionRate: 1,
          weightedOutcome: 0.5,
          authorityAdjustment: 6,
        },
      },
      lastUpdatedAt: "2026-03-11T21:00:00.000Z",
    },
  );
  assert.deepEqual(storedSource.evidence.authoritySignals.expertise.trackedItems, [
    {
      itemId: "artifact-acme-agent-runtime",
      firstCycleId: "2026-03-10",
      firstObservedAt: "2026-03-10T21:00:00.000Z",
      lastCycleId: "2026-03-11",
      lastObservedAt: "2026-03-11T21:00:00.000Z",
      firstScore: 81,
      totalScore: 166,
      averageScore: 83,
      bestScore: 85,
      appearanceCount: 2,
      domains: ["tool", "runtime"],
      status: "retained",
      resolvedAt: "2026-03-11T21:00:00.000Z",
    },
  ]);
});

test("source repository normalizes persisted discovery origins and example urls", async () => {
  const repository = await createRepository();

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [
      {
        ...createTrackedSource({
          id: "web:domain:docs.example.com",
          status: "approved",
          lifecycle: {
            state: SOURCE_LIFECYCLE_STATES.active,
            stage: SOURCE_LIFECYCLE_STATES.active,
            probationStartedAt: "2026-03-10T21:00:00.000Z",
            activatedAt: "2026-03-11T21:00:00.000Z",
          },
        }),
        discoveredFromUrls: [
          "https://github.com/trending?utm_source=feed",
          "https://github.com/trending",
          "https://reddit.com/r/LocalLLaMA/comments/docs123?utm_source=home",
        ],
        evidence: {
          ...createTrackedSource({
            id: "web:domain:docs.example.com",
            status: "approved",
            lifecycle: {
              state: SOURCE_LIFECYCLE_STATES.active,
              stage: SOURCE_LIFECYCLE_STATES.active,
              probationStartedAt: "2026-03-10T21:00:00.000Z",
              activatedAt: "2026-03-11T21:00:00.000Z",
            },
          }).evidence,
          exampleUrls: [
            "https://docs.example.com/agents?utm_source=github",
            "https://docs.example.com/agents",
            "https://docs.example.com/guides/agent-sdk?utm_source=reddit",
          ],
        },
      },
    ],
  });

  const snapshot = await repository.load({
    now: "2026-03-12T21:00:00.000Z",
  });
  const source = snapshot.sources.find(
    (entry) => entry.id === "web:domain:docs.example.com",
  );

  assert.deepEqual(source.discoveredFromUrls, [
    "https://github.com/trending",
    "https://reddit.com/r/LocalLLaMA/comments/docs123",
  ]);
  assert.deepEqual(source.evidence.exampleUrls, [
    "https://docs.example.com/agents",
    "https://docs.example.com/guides/agent-sdk",
  ]);
});

test("source repository keeps approved probationary sources fetchable but excludes retired sources", async () => {
  const repository = await createRepository();

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [
      createTrackedSource({
        id: "web:domain:active.example.com",
        status: "approved",
        lifecycle: {
          state: SOURCE_LIFECYCLE_STATES.active,
          stage: SOURCE_LIFECYCLE_STATES.active,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
        },
      }),
      createTrackedSource({
        id: "web:domain:probation.example.com",
        status: "approved",
        lifecycle: {
          state: SOURCE_LIFECYCLE_STATES.probation,
          stage: SOURCE_LIFECYCLE_STATES.probation,
          probationStartedAt: "2026-03-11T21:00:00.000Z",
          activatedAt: null,
        },
      }),
      createTrackedSource({
        id: "web:domain:retired.example.com",
        status: "retired",
        lifecycle: {
          state: SOURCE_LIFECYCLE_STATES.retired,
          stage: SOURCE_LIFECYCLE_STATES.retired,
          probationStartedAt: "2026-03-09T21:00:00.000Z",
          activatedAt: "2026-03-10T21:00:00.000Z",
          retiredAt: "2026-03-12T21:00:00.000Z",
          lowSignalStreak: 3,
          lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
        },
      }),
    ],
  });

  const fetchable = await repository.listFetchableSources({
    now: "2026-03-12T21:30:00.000Z",
  });

  const fetchableIds = fetchable.map((source) => source.id);

  assert.ok(fetchableIds.includes("web:domain:active.example.com"));
  assert.ok(fetchableIds.includes("web:domain:probation.example.com"));
  assert.ok(
    !fetchableIds.includes("web:domain:retired.example.com"),
    "retired sources should not remain fetchable",
  );
});

test("source repository ranks active sources ahead of equally authoritative probationary sources", async () => {
  const repository = await createRepository();

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [
      createTrackedSource({
        id: "web:domain:probation.example.com",
        status: "approved",
        lifecycle: {
          state: SOURCE_LIFECYCLE_STATES.probation,
          stage: SOURCE_LIFECYCLE_STATES.probation,
          probationStartedAt: "2026-03-11T21:00:00.000Z",
          activatedAt: null,
        },
      }),
      createTrackedSource({
        id: "web:domain:active.example.com",
        status: "approved",
        lifecycle: {
          state: SOURCE_LIFECYCLE_STATES.active,
          stage: SOURCE_LIFECYCLE_STATES.active,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
        },
      }),
    ],
  });

  const snapshot = await repository.load({
    now: "2026-03-12T21:00:00.000Z",
  });

  assert.deepEqual(
    snapshot.sources
      .filter((source) => source.status === "approved" && source.seed !== true)
      .map((source) => source.id),
    [
      "web:domain:active.example.com",
      "web:domain:probation.example.com",
    ],
  );
});

test("source repository excludes approved sources while they are in fetch backoff", async () => {
  const repository = await createRepository();

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [
      createTrackedSource({
        id: "web:domain:ready.example.com",
        status: "approved",
        lifecycle: {
          state: SOURCE_LIFECYCLE_STATES.active,
          stage: SOURCE_LIFECYCLE_STATES.active,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
        },
      }),
      createTrackedSource({
        id: "web:domain:backoff.example.com",
        status: "approved",
        lifecycle: {
          state: SOURCE_LIFECYCLE_STATES.active,
          stage: SOURCE_LIFECYCLE_STATES.active,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
        },
        performance: {
          lastFetchedAt: "2026-03-12T21:00:00.000Z",
          lastFailedFetchAt: "2026-03-12T21:00:00.000Z",
          failedFetchCount: 1,
          consecutiveFetchFailures: 1,
          nextEligibleFetchAt: "2026-03-12T22:00:00.000Z",
        },
      }),
    ],
  });

  const beforeBackoffExpiry = await repository.listFetchableSources({
    now: "2026-03-12T21:30:00.000Z",
  });
  const afterBackoffExpiry = await repository.listFetchableSources({
    now: "2026-03-12T22:00:00.000Z",
  });

  assert.deepEqual(
    beforeBackoffExpiry.map((source) => source.id).sort(),
    [
      "arxiv:domain:arxiv.org",
      "github:domain:github.com",
      "reddit:domain:reddit.com",
      "web:domain:ready.example.com",
    ],
  );
  assert.ok(
    afterBackoffExpiry.some((source) => source.id === "web:domain:backoff.example.com"),
  );
});

test("source repository restores retired sources and persists the closed retirement audit", async () => {
  const repository = await createRepository();

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [
      createTrackedSource({
        id: "web:domain:retired.example.com",
        status: "retired",
        lifecycle: {
          state: SOURCE_LIFECYCLE_STATES.retired,
          stage: SOURCE_LIFECYCLE_STATES.retired,
          probationStartedAt: "2026-03-09T21:00:00.000Z",
          activatedAt: "2026-03-10T21:00:00.000Z",
          retiredAt: "2026-03-12T21:00:00.000Z",
          lowSignalStreak: 3,
          lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
          retirementAudit: {
            current: {
              retiredAt: "2026-03-12T21:00:00.000Z",
              reason: SOURCE_RETIREMENT_REASONS.lowSignalStreak,
              evidence: {
                lowSignalStreak: 3,
                lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
              },
              restoreSnapshot: buildRestoreSnapshot({
                probationStartedAt: "2026-03-09T21:00:00.000Z",
                activatedAt: "2026-03-10T21:00:00.000Z",
                lowSignalStreak: 3,
                lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
              }),
            },
          },
        },
      }),
    ],
  });

  const restored = await repository.restoreSource("web:domain:retired.example.com", {
    now: "2026-03-13T21:00:00.000Z",
    reason: SOURCE_RESTORE_REASONS.manualReview,
    evidence: {
      reviewer: "ops",
      ticket: "SRC-88",
    },
  });

  assert.equal(restored.status, "approved");
  assert.equal(restored.lifecycle.state, SOURCE_LIFECYCLE_STATES.active);
  assert.equal(restored.lifecycle.retirementAudit.current, null);
  assert.equal(restored.lifecycle.retirementAudit.history.length, 1);
  assert.deepEqual(restored.lifecycle.retirementAudit.history[0], {
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
      ticket: "SRC-88",
    },
    restoredState: SOURCE_LIFECYCLE_STATES.active,
    restoreSnapshot: buildRestoreSnapshot({
      probationStartedAt: "2026-03-09T21:00:00.000Z",
      activatedAt: "2026-03-10T21:00:00.000Z",
      lowSignalStreak: 3,
      lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
    }),
  });

  const reloaded = await repository.load({
    now: "2026-03-13T21:00:00.000Z",
  });
  const stored = reloaded.sources.find(
    (source) => source.id === "web:domain:retired.example.com",
  );

  assert.equal(stored.status, "approved");
  assert.equal(stored.lifecycle.state, SOURCE_LIFECYCLE_STATES.active);
  assert.equal(stored.lifecycle.retirementAudit.current, null);
  assert.equal(stored.lifecycle.retirementAudit.history.length, 1);
});

test("source repository can restore from governance snapshots when the audit snapshot is missing", async () => {
  const repository = await createRepository();
  const governanceRestoreSnapshot = buildRestoreSnapshot({
    probationStartedAt: "2026-03-09T21:00:00.000Z",
    activatedAt: "2026-03-10T21:00:00.000Z",
    lastEvaluatedAt: "2026-03-12T21:00:00.000Z",
    qualifyingCycles: [
      {
        cycleId: "2026-03-12",
        observedAt: "2026-03-12T21:00:00.000Z",
        score: 67,
      },
    ],
    performance: {
      discoveryObservationCount: 2,
      qualifyingObservationCount: 1,
      lastObservedAt: "2026-03-12T21:00:00.000Z",
      lastQualifyingObservationAt: "2026-03-12T21:00:00.000Z",
      failedFetchCount: 2,
      consecutiveFetchFailures: 2,
      nextEligibleFetchAt: "2026-03-13T01:00:00.000Z",
    },
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [
      {
        ...createTrackedSource({
          id: "web:domain:governance-restore.example.com",
          status: "retired",
          lifecycle: {
            state: SOURCE_LIFECYCLE_STATES.retired,
            stage: SOURCE_LIFECYCLE_STATES.retired,
            probationStartedAt: "2026-03-09T21:00:00.000Z",
            activatedAt: "2026-03-10T21:00:00.000Z",
            retiredAt: "2026-03-12T21:00:00.000Z",
            retirementAudit: {
              current: {
                retiredAt: "2026-03-12T21:00:00.000Z",
                reason: SOURCE_RETIREMENT_REASONS.manual,
                evidence: {
                  operator: "ops",
                },
              },
            },
          },
          performance: governanceRestoreSnapshot.performance,
        }),
        governance: {
          retirementDecisions: [
            {
              decidedAt: "2026-03-12T21:00:00.000Z",
              outcome: "retired",
              reason: SOURCE_RETIREMENT_REASONS.manual,
              evidence: {
                operator: "ops",
              },
              blockedCategories: [],
              restoreSnapshot: governanceRestoreSnapshot,
            },
          ],
        },
      },
    ],
  });

  const restored = await repository.restoreSource(
    "web:domain:governance-restore.example.com",
    {
      now: "2026-03-13T21:00:00.000Z",
      reason: SOURCE_RESTORE_REASONS.manualReview,
      evidence: {
        reviewer: "ops",
        ticket: "SRC-112",
      },
    },
  );

  assert.equal(restored.status, "approved");
  assert.equal(restored.lifecycle.state, SOURCE_LIFECYCLE_STATES.active);
  assert.deepEqual(restored.governance.retirementDecisions, [
    {
      decidedAt: "2026-03-12T21:00:00.000Z",
      outcome: "retired",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: {
        operator: "ops",
      },
      blockedCategories: [],
      reversedAt: "2026-03-13T21:00:00.000Z",
      reverseReason: SOURCE_RESTORE_REASONS.manualReview,
      reverseEvidence: {
        reviewer: "ops",
        ticket: "SRC-112",
      },
      restoredState: SOURCE_LIFECYCLE_STATES.active,
      restoreSnapshot: governanceRestoreSnapshot,
    },
  ]);
  assert.deepEqual(restored.lifecycle.retirementAudit.history, [
    {
      retiredAt: "2026-03-12T21:00:00.000Z",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: {
        operator: "ops",
      },
      restoredAt: "2026-03-13T21:00:00.000Z",
      restoreReason: SOURCE_RESTORE_REASONS.manualReview,
      restoreEvidence: {
        reviewer: "ops",
        ticket: "SRC-112",
      },
      restoredState: SOURCE_LIFECYCLE_STATES.active,
      restoreSnapshot: governanceRestoreSnapshot,
    },
  ]);
});

test("source repository retires approved sources, logs the decision, and records manual reversals", async () => {
  const repository = await createRepository({
    minimumActiveCategorySources: 1,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [
      createTrackedSource({
        id: "web:domain:manual-retire.example.com",
        status: "approved",
        categoryCoverage: ["tool"],
        lifecycle: {
          state: SOURCE_LIFECYCLE_STATES.active,
          stage: SOURCE_LIFECYCLE_STATES.active,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
        },
      }),
    ],
  });

  const retirement = await repository.retireSource(
    "web:domain:manual-retire.example.com",
    {
      now: "2026-03-13T21:00:00.000Z",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: {
        operator: "ops",
        ticket: "SRC-109",
      },
    },
  );

  assert.equal(retirement.retired, true);
  assert.equal(retirement.blocked, false);
  assert.equal(retirement.source.status, "retired");
  assert.deepEqual(retirement.source.governance.retirementDecisions, [
    {
      decidedAt: "2026-03-13T21:00:00.000Z",
      outcome: "retired",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: {
        operator: "ops",
        ticket: "SRC-109",
      },
      blockedCategories: [],
      reversedAt: null,
      reverseReason: null,
      reverseEvidence: null,
      restoredState: null,
      restoreSnapshot: buildRestoreSnapshot({
        probationStartedAt: "2026-03-10T21:00:00.000Z",
        activatedAt: "2026-03-11T21:00:00.000Z",
      }),
    },
  ]);

  const restored = await repository.restoreSource("web:domain:manual-retire.example.com", {
    now: "2026-03-14T21:00:00.000Z",
    reason: SOURCE_RESTORE_REASONS.manualReview,
    evidence: {
      reviewer: "ops",
      ticket: "SRC-110",
    },
  });

  assert.equal(restored.status, "approved");
  assert.equal(restored.lifecycle.state, SOURCE_LIFECYCLE_STATES.active);
  assert.deepEqual(restored.governance.retirementDecisions, [
    {
      decidedAt: "2026-03-13T21:00:00.000Z",
      outcome: "retired",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: {
        operator: "ops",
        ticket: "SRC-109",
      },
      blockedCategories: [],
      reversedAt: "2026-03-14T21:00:00.000Z",
      reverseReason: SOURCE_RESTORE_REASONS.manualReview,
      reverseEvidence: {
        reviewer: "ops",
        ticket: "SRC-110",
      },
      restoredState: SOURCE_LIFECYCLE_STATES.active,
      restoreSnapshot: buildRestoreSnapshot({
        probationStartedAt: "2026-03-10T21:00:00.000Z",
        activatedAt: "2026-03-11T21:00:00.000Z",
      }),
    },
  ]);

  const reloaded = await repository.load({
    now: "2026-03-14T21:00:00.000Z",
  });
  const stored = reloaded.sources.find(
    (source) => source.id === "web:domain:manual-retire.example.com",
  );

  assert.deepEqual(stored.governance.retirementDecisions, [
    {
      decidedAt: "2026-03-13T21:00:00.000Z",
      outcome: "retired",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: {
        operator: "ops",
        ticket: "SRC-109",
      },
      blockedCategories: [],
      reversedAt: "2026-03-14T21:00:00.000Z",
      reverseReason: SOURCE_RESTORE_REASONS.manualReview,
      reverseEvidence: {
        reviewer: "ops",
        ticket: "SRC-110",
      },
      restoredState: SOURCE_LIFECYCLE_STATES.active,
      restoreSnapshot: buildRestoreSnapshot({
        probationStartedAt: "2026-03-10T21:00:00.000Z",
        activatedAt: "2026-03-11T21:00:00.000Z",
      }),
    },
  ]);
});

test("source repository blocks retirement when it would remove the last active source for an underrepresented category", async () => {
  const repository = await createRepository({
    minimumActiveCategorySources: 2,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [
      createTrackedSource({
        id: "web:domain:fragile-technique.example.com",
        status: "approved",
        categoryCoverage: ["technique"],
        lifecycle: {
          state: SOURCE_LIFECYCLE_STATES.active,
          stage: SOURCE_LIFECYCLE_STATES.active,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
        },
      }),
    ],
  });

  const retirement = await repository.retireSource(
    "web:domain:fragile-technique.example.com",
    {
      now: "2026-03-13T21:00:00.000Z",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: {
        operator: "ops",
        ticket: "SRC-111",
      },
    },
  );

  assert.equal(retirement.retired, false);
  assert.equal(retirement.blocked, true);
  assert.deepEqual(retirement.blockedCategories, ["technique"]);
  assert.equal(retirement.source.status, "approved");
  assert.deepEqual(retirement.source.governance.retirementDecisions, [
    {
      decidedAt: "2026-03-13T21:00:00.000Z",
      outcome: "blocked",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: {
        operator: "ops",
        ticket: "SRC-111",
      },
      blockedCategories: ["technique"],
      reversedAt: null,
      reverseReason: null,
      reverseEvidence: null,
      restoredState: null,
      restoreSnapshot: null,
    },
  ]);

  const reloaded = await repository.load({
    now: "2026-03-13T21:00:00.000Z",
  });
  const stored = reloaded.sources.find(
    (source) => source.id === "web:domain:fragile-technique.example.com",
  );

  assert.equal(stored.status, "approved");
  assert.deepEqual(stored.governance.retirementDecisions, [
    {
      decidedAt: "2026-03-13T21:00:00.000Z",
      outcome: "blocked",
      reason: SOURCE_RETIREMENT_REASONS.manual,
      evidence: {
        operator: "ops",
        ticket: "SRC-111",
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
