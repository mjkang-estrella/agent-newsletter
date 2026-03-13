import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DISCOVERY_CONFIG,
  evaluateSourceAuthority,
  evaluateSourceAuthorityBootstrap,
  finalizeSourceExpertiseSignal,
  recordSourceExpertiseObservation,
  resolveMinimumAuthorityScore,
  resolveWeightedSourceAuthorityScore,
  scoreSource,
  scoreSourceAuthorityBootstrap,
  scoreSourceAuthority,
} from "../src/index.js";

function buildSourceRecord(overrides = {}) {
  const { evidence: evidenceOverrides = {}, ...recordOverrides } = overrides;

  return {
    canonicalUrl: "https://docs.example.com",
    entityType: "domain",
    seed: false,
    approvedAt: null,
    status: "candidate",
    evidence: {
      discoveryCount: 2,
      referrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
      trustedReferrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
      seedReferrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
      referrerPlatforms: ["web"],
      cyclesSeen: ["2026-03-12"],
      topicHits: [],
      exampleUrls: [],
      authoritySignals: {
        observed: true,
        citationCount: 2,
        referrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
        sourceKinds: ["github", "reddit"],
        cyclesSeen: ["2026-03-12"],
        githubStars: 0,
        githubActivity: 0,
      },
      ...evidenceOverrides,
      authoritySignals: {
        observed: true,
        citationCount: 2,
        referrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
        sourceKinds: ["github", "reddit"],
        cyclesSeen: ["2026-03-12"],
        githubStars: 0,
        githubActivity: 0,
        ...(evidenceOverrides.authoritySignals ?? {}),
      },
    },
    ...recordOverrides,
  };
}

function buildActiveSourceRecord(overrides = {}) {
  const { lifecycle: lifecycleOverrides = {}, ...recordOverrides } = overrides;

  return buildSourceRecord({
    approvedAt: "2026-03-11T21:00:00.000Z",
    status: "approved",
    lifecycle: {
      state: "active",
      stage: "active",
      probationStartedAt: "2026-03-11T21:00:00.000Z",
      activatedAt: "2026-03-12T21:00:00.000Z",
      ...lifecycleOverrides,
    },
    ...recordOverrides,
  });
}

test("source authority applies the stricter eligibility threshold to unseen sources", () => {
  const config = {
    ...DEFAULT_DISCOVERY_CONFIG,
    minAuthorityScore: 55,
    minNewSourceAuthorityScore: 65,
  };
  const result = evaluateSourceAuthority(buildSourceRecord(), config);

  assert.equal(result.authorityScore, 64);
  assert.equal(result.minimumAuthorityScore, 65);
  assert.equal(result.isNewSource, true);
  assert.equal(result.eligible, false);
});

test("source authority falls back to the baseline threshold after activation", () => {
  const config = {
    ...DEFAULT_DISCOVERY_CONFIG,
    minAuthorityScore: 55,
    minNewSourceAuthorityScore: 65,
  };
  const result = evaluateSourceAuthority(
    buildSourceRecord({
      approvedAt: "2026-03-11T21:00:00.000Z",
      status: "approved",
      lifecycle: {
        state: "active",
        stage: "active",
        probationStartedAt: "2026-03-11T21:00:00.000Z",
        activatedAt: "2026-03-12T21:00:00.000Z",
      },
    }),
    config,
  );

  assert.equal(result.minimumAuthorityScore, 55);
  assert.equal(result.isNewSource, false);
  assert.equal(result.eligible, true);
});

test("approved probationary sources keep the new-source threshold and reduced weight until activation", () => {
  const config = {
    ...DEFAULT_DISCOVERY_CONFIG,
    minAuthorityScore: 55,
    minNewSourceAuthorityScore: 65,
  };
  const record = buildSourceRecord({
    approvedAt: "2026-03-11T21:00:00.000Z",
    status: "approved",
    lifecycle: {
      state: "probation",
      stage: "probation",
      probationStartedAt: "2026-03-11T21:00:00.000Z",
      activatedAt: null,
    },
  });
  const authority = evaluateSourceAuthority(record, config);
  const score = scoreSource(record, config);

  assert.equal(authority.isNewSource, true);
  assert.equal(authority.minimumAuthorityScore, 65);
  assert.equal(score.authorityWeight, 0.75);
  assert.equal(score.weightedAuthorityScore, 48);
});

test("probationary sources without a persisted authority score still use the reduced weighted authority", () => {
  const record = buildSourceRecord({
    lifecycle: {
      state: "probation",
      stage: "probation",
      probationStartedAt: "2026-03-12T21:00:00.000Z",
      activatedAt: null,
    },
  });

  assert.equal(resolveWeightedSourceAuthorityScore(record), 48);
});

test("bootstrap authority excludes retained-item expertise until a source becomes active", () => {
  const recordWithRetainedExpertise = buildSourceRecord({
    approvedAt: "2026-03-11T21:00:00.000Z",
    status: "approved",
    lifecycle: {
      state: "probation",
      stage: "probation",
      probationStartedAt: "2026-03-11T21:00:00.000Z",
      activatedAt: null,
    },
    evidence: {
      authoritySignals: {
        expertise: {
          trackedItems: [
            {
              itemId: "artifact-acme-agent-runtime",
              firstCycleId: "2026-03-12",
              firstObservedAt: "2026-03-12T21:00:00.000Z",
              lastCycleId: "2026-03-13",
              lastObservedAt: "2026-03-13T21:00:00.000Z",
              firstScore: 83,
              bestScore: 87,
              appearanceCount: 2,
              status: "retained",
              resolvedAt: "2026-03-13T21:00:00.000Z",
            },
          ],
        },
      },
    },
  });
  const activeRecord = {
    ...recordWithRetainedExpertise,
    lifecycle: {
      state: "active",
      stage: "active",
      probationStartedAt: "2026-03-11T21:00:00.000Z",
      activatedAt: "2026-03-13T21:00:00.000Z",
    },
  };

  assert.equal(scoreSourceAuthorityBootstrap(recordWithRetainedExpertise), 64);
  assert.equal(scoreSourceAuthority(recordWithRetainedExpertise), 64);
  assert.equal(evaluateSourceAuthority(recordWithRetainedExpertise).authorityScore, 64);
  assert.equal(scoreSourceAuthority(activeRecord), 70);
  assert.equal(evaluateSourceAuthority(activeRecord).authorityScore, 70);
});

test("seed sources bypass the probation threshold even with weak evidence", () => {
  const config = {
    ...DEFAULT_DISCOVERY_CONFIG,
    minAuthorityScore: 55,
    minNewSourceAuthorityScore: 85,
  };
  const weakSeed = buildSourceRecord({
    seed: true,
    evidence: {
      discoveryCount: 0,
      referrers: [],
      trustedReferrers: [],
      seedReferrers: [],
      referrerPlatforms: [],
      cyclesSeen: [],
      topicHits: [],
      exampleUrls: [],
      authoritySignals: {
        citationCount: 0,
        referrers: [],
        sourceKinds: [],
        cyclesSeen: [],
        githubStars: 0,
        githubActivity: 0,
      },
    },
  });

  assert.equal(scoreSourceAuthority(weakSeed, config), 0);
  assert.equal(resolveMinimumAuthorityScore(weakSeed, config), 55);
  assert.equal(evaluateSourceAuthority(weakSeed, config).eligible, true);
});

test("bootstrap authority ignores internal discovery evidence when no external authority signals were observed", () => {
  const record = {
    canonicalUrl: "https://docs.example.com",
    entityType: "domain",
    seed: false,
    approvedAt: null,
    status: "candidate",
    evidence: {
      discoveryCount: 4,
      referrers: [
        "github:domain:github.com",
        "reddit:domain:reddit.com",
        "x:account:openai",
      ],
      cyclesSeen: ["2026-03-10", "2026-03-11", "2026-03-12"],
      authoritySignals: {
        observed: false,
        citationCount: 0,
        referrers: [],
        sourceKinds: [],
        cyclesSeen: [],
        githubStars: 0,
        githubActivity: 0,
      },
    },
  };

  assert.equal(scoreSourceAuthorityBootstrap(record), 0);
  assert.equal(scoreSourceAuthority(record), 0);
  assert.equal(evaluateSourceAuthorityBootstrap(record).eligible, false);
});

test("approved sources require explicit external authority signals instead of legacy discovery fallbacks", () => {
  const record = {
    canonicalUrl: "https://docs.example.com",
    entityType: "domain",
    seed: false,
    approvedAt: "2026-03-11T21:00:00.000Z",
    status: "approved",
    evidence: {
      discoveryCount: 2,
      referrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
      cyclesSeen: ["2026-03-12"],
    },
  };

  assert.equal(scoreSourceAuthority(record), 0);
  assert.equal(evaluateSourceAuthority(record).eligible, false);
});

test("candidate and approved sources require bootstrap citations or GitHub metrics before expertise can affect authority", () => {
  const recordWithExpertiseOnly = {
    evidence: {
      authoritySignals: {
        citationCount: 0,
        referrers: [],
        sourceKinds: [],
        cyclesSeen: [],
        githubStars: 0,
        githubActivity: 0,
        expertise: {
          trackedItems: [
            {
              itemId: "artifact-acme-agent-runtime",
              firstCycleId: "2026-03-10",
              firstObservedAt: "2026-03-10T21:00:00.000Z",
              lastCycleId: "2026-03-12",
              lastObservedAt: "2026-03-12T21:00:00.000Z",
              firstScore: 82,
              bestScore: 88,
              appearanceCount: 3,
              status: "retained",
              resolvedAt: "2026-03-12T21:00:00.000Z",
            },
          ],
        },
      },
    },
  };
  const candidate = buildSourceRecord(recordWithExpertiseOnly);
  const approved = buildSourceRecord({
    ...recordWithExpertiseOnly,
    approvedAt: "2026-03-11T21:00:00.000Z",
    status: "approved",
  });

  assert.equal(scoreSourceAuthority(candidate), 0);
  assert.equal(evaluateSourceAuthority(candidate).eligible, false);
  assert.equal(scoreSourceAuthority(approved), 0);
  assert.equal(evaluateSourceAuthority(approved).eligible, false);
});

test("retired sources keep their authority score but drop their weighted authority to zero", () => {
  const result = scoreSource(
    buildSourceRecord({
      status: "retired",
      lifecycle: {
        state: "retired",
        stage: "retired",
        retiredAt: "2026-03-12T21:00:00.000Z",
      },
    }),
  );

  assert.equal(result.authorityScore, 64);
  assert.equal(result.authorityWeight, 0);
  assert.equal(result.weightedAuthorityScore, 0);
});

test("source authority rewards retained high-signal items and penalizes short-lived noise", () => {
  const retained = scoreSourceAuthority(
    buildActiveSourceRecord({
      evidence: {
        authoritySignals: {
          expertise: {
            trackedItems: [
              {
                itemId: "artifact-acme-agent-runtime",
                firstCycleId: "2026-03-10",
                firstObservedAt: "2026-03-10T21:00:00.000Z",
                lastCycleId: "2026-03-12",
                lastObservedAt: "2026-03-12T21:00:00.000Z",
                firstScore: 82,
                bestScore: 88,
                appearanceCount: 3,
                status: "retained",
                resolvedAt: "2026-03-12T21:00:00.000Z",
              },
            ],
          },
        },
      },
    }),
  );
  const shortLived = scoreSourceAuthority(
    buildActiveSourceRecord({
      evidence: {
        authoritySignals: {
          expertise: {
            trackedItems: [
              {
                itemId: "artifact-acme-agent-runtime",
                firstCycleId: "2026-03-10",
                firstObservedAt: "2026-03-10T21:00:00.000Z",
                lastCycleId: "2026-03-10",
                lastObservedAt: "2026-03-10T21:00:00.000Z",
                firstScore: 82,
                bestScore: 82,
                appearanceCount: 1,
                status: "short_lived",
                resolvedAt: "2026-03-12T21:00:00.000Z",
              },
            ],
          },
        },
      },
    }),
  );

  assert.equal(retained, 76);
  assert.equal(shortLived, 52);
});

test("source authority carries forward persisted domain-expertise retention history", () => {
  const score = scoreSourceAuthority(
    buildActiveSourceRecord({
      evidence: {
        authoritySignals: {
          expertise: {
            trackedItems: [],
          },
          domainExpertiseRetention: {
            trackedItemCount: 4,
            resolvedItemCount: 3,
            retainedItemCount: 2,
            shortLivedItemCount: 1,
            retentionRate: 2 / 3,
            relevanceRetentionRate: 2 / 3,
            weightedOutcome: 1 / 3,
            authorityAdjustment: 4,
            domains: {
              tool: {
                trackedItemCount: 3,
                resolvedItemCount: 2,
                retainedItemCount: 2,
                shortLivedItemCount: 0,
                retentionRate: 1,
                relevanceRetentionRate: 1,
                weightedOutcome: 0.75,
                authorityAdjustment: 9,
              },
            },
            lastUpdatedAt: "2026-03-14T21:00:00.000Z",
          },
        },
      },
    }),
  );

  assert.equal(score, 68);
});

test("source authority discounts retained items when their follow-up relevance decays", () => {
  const score = scoreSourceAuthority(
    buildActiveSourceRecord({
      evidence: {
        authoritySignals: {
          expertise: {
            trackedItems: [
              {
                itemId: "artifact-acme-agent-runtime",
                firstCycleId: "2026-03-10",
                firstObservedAt: "2026-03-10T21:00:00.000Z",
                lastCycleId: "2026-03-11",
                lastObservedAt: "2026-03-11T21:00:00.000Z",
                firstScore: 90,
                bestScore: 90,
                appearanceCount: 2,
                occurrences: [
                  {
                    cycleId: "2026-03-10",
                    observedAt: "2026-03-10T21:00:00.000Z",
                    relevanceScore: 90,
                  },
                  {
                    cycleId: "2026-03-11",
                    observedAt: "2026-03-11T21:00:00.000Z",
                    relevanceScore: 75,
                  },
                ],
                status: "retained",
                resolvedAt: "2026-03-11T21:00:00.000Z",
              },
            ],
          },
        },
      },
    }),
  );

  assert.equal(score, 67);
});

test("expertise retention summaries include domain-level outcomes when provided", () => {
  const source = buildSourceRecord({
    approvedAt: "2026-03-11T21:00:00.000Z",
    status: "approved",
  });

  recordSourceExpertiseObservation(
    source,
    {
      itemId: "artifact-acme-agent-runtime",
      cycleId: "2026-03-12",
      observedAt: "2026-03-12T21:00:00.000Z",
      relevanceScore: 83,
      domains: ["tool", "runtime"],
    },
    DEFAULT_DISCOVERY_CONFIG,
  );

  recordSourceExpertiseObservation(
    source,
    {
      itemId: "artifact-acme-agent-runtime",
      cycleId: "2026-03-13",
      observedAt: "2026-03-13T21:00:00.000Z",
      relevanceScore: 87,
      domains: ["tool", "runtime"],
    },
    DEFAULT_DISCOVERY_CONFIG,
  );

  assert.deepEqual(source.evidence.authoritySignals.domainExpertiseRetention, {
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
    lastUpdatedAt: "2026-03-13T21:00:00.000Z",
  });
  assert.deepEqual(source.evidence.authoritySignals.expertise.trackedItems, [
    {
      itemId: "artifact-acme-agent-runtime",
      firstCycleId: "2026-03-12",
      firstObservedAt: "2026-03-12T21:00:00.000Z",
      lastCycleId: "2026-03-13",
      lastObservedAt: "2026-03-13T21:00:00.000Z",
      firstScore: 83,
      totalScore: 170,
      averageScore: 85,
      bestScore: 87,
      appearanceCount: 2,
      occurrences: [
        {
          cycleId: "2026-03-12",
          observedAt: "2026-03-12T21:00:00.000Z",
          relevanceScore: 83,
        },
        {
          cycleId: "2026-03-13",
          observedAt: "2026-03-13T21:00:00.000Z",
          relevanceScore: 87,
        },
      ],
      domains: ["tool", "runtime"],
      status: "retained",
      resolvedAt: "2026-03-13T21:00:00.000Z",
    },
  ]);
});

test("expertise observations reuse an existing item record and upsert per-cycle occurrences", () => {
  const source = buildSourceRecord({
    approvedAt: "2026-03-11T21:00:00.000Z",
    status: "approved",
  });

  recordSourceExpertiseObservation(
    source,
    {
      itemId: "artifact-acme-agent-runtime",
      cycleId: "2026-03-12",
      observedAt: "2026-03-12T21:00:00.000Z",
      relevanceScore: 83,
      domains: ["tool"],
    },
    DEFAULT_DISCOVERY_CONFIG,
  );

  recordSourceExpertiseObservation(
    source,
    {
      itemId: "artifact-acme-agent-runtime",
      cycleId: "2026-03-12",
      observedAt: "2026-03-12T22:00:00.000Z",
      relevanceScore: 91,
      domains: ["tool"],
    },
    DEFAULT_DISCOVERY_CONFIG,
  );

  recordSourceExpertiseObservation(
    source,
    {
      itemId: "artifact-acme-agent-runtime",
      cycleId: "2026-03-13",
      observedAt: "2026-03-13T21:00:00.000Z",
      relevanceScore: 87,
      domains: ["tool"],
    },
    DEFAULT_DISCOVERY_CONFIG,
  );

  assert.equal(source.evidence.authoritySignals.expertise.trackedItems.length, 1);
  assert.deepEqual(source.evidence.authoritySignals.expertise.trackedItems[0], {
    itemId: "artifact-acme-agent-runtime",
    firstCycleId: "2026-03-12",
    firstObservedAt: "2026-03-12T21:00:00.000Z",
    lastCycleId: "2026-03-13",
    lastObservedAt: "2026-03-13T21:00:00.000Z",
    firstScore: 83,
    totalScore: 178,
    averageScore: 89,
    bestScore: 91,
    appearanceCount: 2,
    occurrences: [
      {
        cycleId: "2026-03-12",
        observedAt: "2026-03-12T22:00:00.000Z",
        relevanceScore: 91,
      },
      {
        cycleId: "2026-03-13",
        observedAt: "2026-03-13T21:00:00.000Z",
        relevanceScore: 87,
      },
    ],
    domains: ["tool"],
    status: "retained",
    resolvedAt: "2026-03-13T21:00:00.000Z",
  });
});

test("expertise observations immediately feed retained items back into source authority", () => {
  const source = buildActiveSourceRecord();

  recordSourceExpertiseObservation(
    source,
    {
      itemId: "artifact-acme-agent-runtime",
      cycleId: "2026-03-12",
      observedAt: "2026-03-12T21:00:00.000Z",
      relevanceScore: 83,
    },
    DEFAULT_DISCOVERY_CONFIG,
  );

  assert.equal(source.authorityScore, 64);
  assert.deepEqual(source.evidence.authoritySignals.domainExpertiseRetention, {
    trackedItemCount: 1,
    resolvedItemCount: 0,
    retainedItemCount: 0,
    shortLivedItemCount: 0,
    retentionRate: 0,
    relevanceRetentionRate: 0,
    weightedOutcome: 0,
    authorityAdjustment: 0,
    lastUpdatedAt: "2026-03-12T21:00:00.000Z",
  });

  recordSourceExpertiseObservation(
    source,
    {
      itemId: "artifact-acme-agent-runtime",
      cycleId: "2026-03-13",
      observedAt: "2026-03-13T21:00:00.000Z",
      relevanceScore: 87,
    },
    DEFAULT_DISCOVERY_CONFIG,
  );

  assert.equal(source.authorityScore, 70);
  assert.deepEqual(source.evidence.authoritySignals.domainExpertiseRetention, {
    trackedItemCount: 1,
    resolvedItemCount: 1,
    retainedItemCount: 1,
    shortLivedItemCount: 0,
    retentionRate: 1,
    relevanceRetentionRate: 1,
    weightedOutcome: 0.5,
    authorityAdjustment: 6,
    lastUpdatedAt: "2026-03-13T21:00:00.000Z",
  });
});

test("expertise observations keep below-threshold follow-ups in the retention history", () => {
  const config = {
    ...DEFAULT_DISCOVERY_CONFIG,
    sourceExpertiseRetentionWindowDays: 2,
  };
  const source = buildActiveSourceRecord();

  recordSourceExpertiseObservation(
    source,
    {
      itemId: "artifact-decaying-agent-runtime",
      cycleId: "2026-03-12",
      observedAt: "2026-03-12T21:00:00.000Z",
      relevanceScore: 83,
      domains: ["tool"],
    },
    config,
  );

  recordSourceExpertiseObservation(
    source,
    {
      itemId: "artifact-decaying-agent-runtime",
      cycleId: "2026-03-13",
      observedAt: "2026-03-13T21:00:00.000Z",
      relevanceScore: 58,
      domains: ["tool"],
    },
    config,
  );

  assert.deepEqual(source.evidence.authoritySignals.expertise.trackedItems, [
    {
      itemId: "artifact-decaying-agent-runtime",
      firstCycleId: "2026-03-12",
      firstObservedAt: "2026-03-12T21:00:00.000Z",
      lastCycleId: "2026-03-13",
      lastObservedAt: "2026-03-13T21:00:00.000Z",
      firstScore: 83,
      totalScore: 141,
      averageScore: 71,
      bestScore: 83,
      appearanceCount: 2,
      occurrences: [
        {
          cycleId: "2026-03-12",
          observedAt: "2026-03-12T21:00:00.000Z",
          relevanceScore: 83,
        },
        {
          cycleId: "2026-03-13",
          observedAt: "2026-03-13T21:00:00.000Z",
          relevanceScore: 58,
        },
      ],
      domains: ["tool"],
      status: "tracking",
      resolvedAt: null,
    },
  ]);

  finalizeSourceExpertiseSignal(
    source,
    {
      cycleId: "2026-03-15",
      observedAt: "2026-03-15T21:00:00.000Z",
    },
    config,
  );

  assert.equal(source.authorityScore, 52);
  assert.deepEqual(source.evidence.authoritySignals.domainExpertiseRetention, {
    trackedItemCount: 1,
    resolvedItemCount: 1,
    retainedItemCount: 0,
    shortLivedItemCount: 1,
    retentionRate: 0,
    relevanceRetentionRate: 0,
    weightedOutcome: -1,
    authorityAdjustment: -12,
    domains: {
      tool: {
        trackedItemCount: 1,
        resolvedItemCount: 1,
        retainedItemCount: 0,
        shortLivedItemCount: 1,
        retentionRate: 0,
        relevanceRetentionRate: 0,
        weightedOutcome: -1,
        authorityAdjustment: -12,
      },
    },
    lastUpdatedAt: "2026-03-15T21:00:00.000Z",
  });
});

test("expertise finalization immediately penalizes short-lived noise in source authority", () => {
  const config = {
    ...DEFAULT_DISCOVERY_CONFIG,
    sourceExpertiseRetentionWindowDays: 2,
  };
  const source = buildActiveSourceRecord();

  recordSourceExpertiseObservation(
    source,
    {
      itemId: "artifact-noisy-agent-thread",
      cycleId: "2026-03-12",
      observedAt: "2026-03-12T21:00:00.000Z",
      relevanceScore: 81,
    },
    config,
  );

  finalizeSourceExpertiseSignal(
    source,
    {
      cycleId: "2026-03-14",
      observedAt: "2026-03-14T21:00:00.000Z",
    },
    config,
  );

  assert.equal(source.authorityScore, 52);
  assert.deepEqual(source.evidence.authoritySignals.domainExpertiseRetention, {
    trackedItemCount: 1,
    resolvedItemCount: 1,
    retainedItemCount: 0,
    shortLivedItemCount: 1,
    retentionRate: 0,
    relevanceRetentionRate: 0,
    weightedOutcome: -1,
    authorityAdjustment: -12,
    lastUpdatedAt: "2026-03-14T21:00:00.000Z",
  });
});
