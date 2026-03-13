import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  DEFAULT_DISCOVERY_CONFIG,
  SOURCE_RESTORE_REASONS,
  SOURCE_RETIREMENT_REASONS,
  SOURCE_LIFECYCLE_STATES,
  SOURCE_LIFECYCLE_STAGES,
  SourceDiscoveryService,
  SourceRepository,
  buildSourceCandidate,
  createNormalizedItemFromSourceRecord,
  extractOutboundLinks,
  scoreSource
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
  retirementEvaluationWindowDays = 30,
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
      retirementEvaluationWindowDays,
      lastEvaluatedAt,
      qualifyingCycles: [],
    },
    performance: {
      discoveryObservationCount: 2,
      qualifyingObservationCount: 0,
      lastObservedAt: "2026-03-12T21:00:00.000Z",
      lastQualifyingObservationAt: null,
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

async function createService(config = undefined) {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new SourceRepository({
    filePath: join(directory, "source-registry.json")
  });

  return {
    directory,
    repository,
    service: new SourceDiscoveryService({ repository, ...(config ? { config } : {}) })
  };
}

function buildScoreableSourceRecord(overrides = {}) {
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
        ...(evidenceOverrides.authoritySignals ?? {})
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
        ...(evidenceOverrides.signalQuality ?? {}),
      },
    },
    ...recordOverrides
  };
}

function buildApprovedProbationarySource(overrides = {}) {
  const { lifecycle: lifecycleOverrides = {}, evidence: evidenceOverrides = {}, ...recordOverrides } =
    overrides;

  return {
    id: "web:domain:docs.example.com",
    kind: "web",
    entityType: "domain",
    platform: "web",
    value: "docs.example.com",
    displayName: "docs.example.com",
    url: "https://docs.example.com",
    canonicalUrl: "https://docs.example.com",
    fetchUrl: "https://docs.example.com",
    status: "approved",
    seed: false,
    authorityScore: 72,
    signalScore: 61,
    discoveredAt: "2026-03-10T21:00:00.000Z",
    approvedAt: "2026-03-10T21:00:00.000Z",
    lastSeenAt: "2026-03-10T21:00:00.000Z",
    lifecycle: {
      stage: SOURCE_LIFECYCLE_STAGES.probation,
      probationStartedAt: "2026-03-10T21:00:00.000Z",
      activatedAt: null,
      qualifyingCycles: [],
      ...lifecycleOverrides,
    },
    evidence: {
      discoveryCount: 2,
      referrers: ["github:domain:github.com"],
      trustedReferrers: ["github:domain:github.com"],
      seedReferrers: ["github:domain:github.com"],
      referrerPlatforms: ["web"],
      cyclesSeen: ["2026-03-10"],
      topicHits: ["agent", "tool"],
      exampleUrls: ["https://docs.example.com/agents"],
      authoritySignals: {
        observed: true,
        citationCount: 2,
        referrers: ["github:domain:github.com"],
        sourceKinds: ["github"],
        cyclesSeen: ["2026-03-10"],
        githubStars: 0,
        githubActivity: 0,
      },
      ...evidenceOverrides,
      authoritySignals: {
        observed: true,
        citationCount: 2,
        referrers: ["github:domain:github.com"],
        sourceKinds: ["github"],
        cyclesSeen: ["2026-03-10"],
        githubStars: 0,
        githubActivity: 0,
        ...(evidenceOverrides.authoritySignals ?? {}),
      },
    },
    discoveredFromUrls: ["https://github.com/trending"],
    ...recordOverrides,
  };
}

function buildProbationaryScoredItem({
  sourceId = "web:domain:docs.example.com",
  externalId = null,
  title = "Agent docs update",
  sourceUrl = "https://docs.example.com/agents",
  summary = "An approved source published a relevant agent update.",
  relevanceScore = 68,
  publishedAt = "2026-03-12T21:00:00.000Z",
} = {}) {
  return createNormalizedItemFromSourceRecord({
    adapterId: "web-discovery",
    sourceType: "web",
    externalId: externalId ?? `${sourceId}:${publishedAt}`,
    title,
    sourceName: "docs.example.com",
    sourceUrl,
    publishedAt,
    discoveredAt: publishedAt,
    summary,
    outboundUrls: [],
    tags: ["agent", "tool"],
    category: "tool",
    integrationHint: "Review before integrating.",
    author: null,
    relevanceScore,
    metrics: {
      mentions: 1,
      upvotes: 0,
      comments: 0,
      shares: 0,
    },
    sourceAuthority: {
      authority: 72,
    },
    metadata: {
      approvedSourceId: sourceId,
    },
    raw: {},
  });
}

function buildDiscoveryItem({
  externalId = "agent-sdk",
  title = "Agent SDK roundup",
  sourceUrl = "https://github.com/example/agent-sdk",
  summary = "A GitHub project with strong agent-tooling momentum.",
  outboundUrls = ["https://docs.example.com/platform/agents"],
  publishedAt = "2026-03-12T20:00:00.000Z",
  mentions = 3,
  authority = 95,
  githubStars = 18_000,
  githubActivity = 88,
  socialEngagement = 320,
} = {}) {
  return createNormalizedItemFromSourceRecord({
    adapterId: "github",
    sourceType: "github",
    externalId,
    title,
    sourceName: "GitHub",
    sourceUrl,
    publishedAt,
    discoveredAt: publishedAt,
    summary,
    outboundUrls,
    tags: ["agent", "sdk", "tool"],
    category: "library",
    integrationHint: "Review the install flow before integrating.",
    author: "example",
    metrics: {
      mentions,
      upvotes: socialEngagement,
      comments: 0,
      shares: 0,
    },
    sourceAuthority: {
      authority,
    },
    scoringSignals: {
      githubStars,
      githubActivity,
      socialEngagement,
    },
    raw: {},
  });
}

test("extracts outbound links from explicit lists and embedded content", () => {
  const links = extractOutboundLinks({
    outboundLinks: ["https://docs.example.com/agents?utm_source=x"],
    outboundUrls: ["https://x.com/OpenAI"],
    content:
      "New release notes at https://example.org/post and a duplicate https://x.com/OpenAI"
  });

  assert.deepEqual(links, [
    "https://docs.example.com/agents?utm_source=x",
    "https://x.com/OpenAI",
    "https://example.org/post"
  ]);
});

test("extracts outbound links from normalized item metadata", () => {
  const item = createNormalizedItemFromSourceRecord({
    adapterId: "reddit",
    sourceType: "reddit",
    externalId: "t3_meta123",
    title: "Agent toolkit thread",
    sourceName: "r/LocalLLaMA",
    sourceUrl: "https://www.reddit.com/r/LocalLLaMA/comments/meta123/agent_toolkit_thread/",
    publishedAt: "2026-03-12T20:00:00.000Z",
    summary: "Operator notes without inline links.",
    outboundUrls: [
      "https://docs.example.com/agent-toolkit?utm_source=reddit",
      "https://github.com/example/agent-toolkit",
    ],
    tags: ["reddit", "ai-agents"],
    author: "builder",
    metrics: {
      mentions: 1,
      upvotes: 10,
      comments: 2,
      shares: 0
    },
    sourceAuthority: {
      authority: 62
    },
    raw: {}
  });

  assert.deepEqual(extractOutboundLinks(item), [
    "https://docs.example.com/agent-toolkit?utm_source=reddit",
    "https://github.com/example/agent-toolkit"
  ]);
});

test("normalizes X profile URLs into account sources", () => {
  const candidate = buildSourceCandidate("https://twitter.com/OpenAI/status/12345");

  assert.deepEqual(candidate, {
    id: "x:account:openai",
    kind: "x",
    entityType: "account",
    platform: "x",
    value: "openai",
    displayName: "@openai on X",
    url: "https://x.com/openai",
    canonicalUrl: "https://x.com/openai",
    fetchUrl: "https://x.com/openai",
    discoveredUrl: "https://x.com/openai/status/12345"
  });
});

test("applies a stricter authority threshold before a newly discovered source is first activated", () => {
  const config = {
    ...DEFAULT_DISCOVERY_CONFIG,
    minAuthorityScore: 55,
    minNewSourceAuthorityScore: 65,
    minSignalScore: 45
  };
  const candidateScore = scoreSource(buildScoreableSourceRecord(), config);

  assert.equal(candidateScore.authorityScore, 64);
  assert.equal(candidateScore.authorityWeight, 0.75);
  assert.equal(candidateScore.weightedAuthorityScore, 48);
  assert.equal(candidateScore.signalScore, 52);
  assert.equal(candidateScore.minimumAuthorityScore, 65);
  assert.equal(candidateScore.approved, false);

  const approvedScore = scoreSource(
    buildScoreableSourceRecord({
      approvedAt: "2026-03-11T21:00:00.000Z",
      status: "approved",
      lifecycle: {
        state: SOURCE_LIFECYCLE_STATES.active,
        stage: SOURCE_LIFECYCLE_STAGES.active,
        probationStartedAt: "2026-03-11T21:00:00.000Z",
        activatedAt: "2026-03-12T21:00:00.000Z",
      },
    }),
    config
  );

  assert.equal(approvedScore.authorityWeight, 1);
  assert.equal(approvedScore.weightedAuthorityScore, 64);
  assert.equal(approvedScore.minimumAuthorityScore, 55);
  assert.equal(approvedScore.approved, true);
});

test("authority scoring only uses external citation signals and boosts strong GitHub evidence", () => {
  const baseline = scoreSource(
    buildScoreableSourceRecord({
      evidence: {
        authoritySignals: {
          citationCount: 1,
          referrers: ["github:domain:github.com"],
          sourceKinds: ["github"],
          cyclesSeen: ["2026-03-12"],
          githubStars: 0,
          githubActivity: 0
        },
        trustedReferrers: ["github:domain:github.com", "reddit:domain:reddit.com", "x:account:openai"],
        seedReferrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
        referrerPlatforms: ["web", "x"],
        topicHits: ["agent", "tool", "sdk"]
      }
    })
  );
  const boosted = scoreSource(
    buildScoreableSourceRecord({
      evidence: {
        authoritySignals: {
          citationCount: 1,
          referrers: ["github:domain:github.com"],
          sourceKinds: ["github"],
          cyclesSeen: ["2026-03-12"],
          githubStars: 50_000,
          githubActivity: 95
        }
      }
    })
  );

  assert.equal(baseline.authorityScore, 32);
  assert.equal(boosted.authorityScore, 58);
});

test("signal scoring rewards repeated high-quality discovery observations", () => {
  const baseline = scoreSource(
    buildScoreableSourceRecord({
      evidence: {
        signalQuality: {
          observationCount: 1,
          totalScore: 28,
          averageScore: 28,
          bestScore: 28,
          highSignalObservationCount: 0,
          highSignalCycles: [],
          preferredFetchUrl: "https://docs.example.com",
          preferredFetchScore: 28,
          lastObservedAt: "2026-03-12T21:00:00.000Z",
        },
      },
    }),
  );
  const boosted = scoreSource(
    buildScoreableSourceRecord({
      evidence: {
        signalQuality: {
          observationCount: 2,
          totalScore: 176,
          averageScore: 88,
          bestScore: 93,
          highSignalObservationCount: 2,
          highSignalCycles: ["2026-03-12", "2026-03-13"],
          preferredFetchUrl: "https://docs.example.com/platform/agents",
          preferredFetchScore: 93,
          lastObservedAt: "2026-03-13T21:00:00.000Z",
        },
      },
    }),
  );

  assert.ok(boosted.signalScore > baseline.signalScore);
  assert.ok(boosted.signalScore >= 60);
});

test("accepts adapter-emitted discovered sources and persists them for future fetch cycles", async () => {
  const { repository, service } = await createService();

  const result = await service.discoverFromItems([], {
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
    discoveredSources: [
      {
        id: "web:domain:docs.agno.com",
        kind: "web",
        displayName: "docs.agno.com",
        url: "https://docs.agno.com/platform/agents?utm_source=github",
        authorityScore: 68,
        discoveredFromUrls: [
          "https://github.com/trending",
          "https://reddit.com/r/LocalLLaMA/comments/abc123?utm_source=home",
        ],
      },
    ],
  });

  const approved = result.newlyApproved.find(
    (source) => source.id === "web:domain:docs.agno.com",
  );
  assert.ok(approved);
  assert.equal(approved.status, "approved");
  assert.equal(approved.fetchUrl, "https://docs.agno.com/platform/agents");
  assert.equal(approved.evidence.discoveryCount, 2);
  assert.equal(approved.evidence.authoritySignals.citationCount, 2);
  assert.deepEqual(approved.discoveredFromUrls, [
    "https://github.com/trending",
    "https://reddit.com/r/LocalLLaMA/comments/abc123",
  ]);

  const persisted = await repository.listFetchableSources({
    now: "2026-03-12T21:05:00.000Z",
  });
  const stored = persisted.find(
    (source) => source.id === "web:domain:docs.agno.com",
  );

  assert.ok(stored);
  assert.equal(stored.status, "approved");
  assert.equal(stored.fetchUrl, "https://docs.agno.com/platform/agents");
});

test("approves newly discovered sources once trusted citations are strong enough", async () => {
  const { repository, service } = await createService();

  const result = await service.discoverFromItems(
    [
      {
        sourceUrl: "https://github.com/trending",
        title: "Agent tooling worth tracking",
        summary: "An agent framework docs site",
        outboundLinks: ["https://docs.agno.com/agents"]
      },
      {
        sourceUrl: "https://reddit.com/r/LocalLLaMA/comments/abc123",
        title: "Useful agent docs",
        summary: "More agent references",
        outboundLinks: ["https://docs.agno.com/agents?utm_source=reddit"]
      }
    ],
    {
      now: "2026-03-12T21:00:00.000Z",
      cycleId: "2026-03-12"
    }
  );

  const approved = result.newlyApproved.find(
    (source) => source.id === "web:domain:docs.agno.com"
  );
  assert.ok(approved);
  assert.equal(approved.status, "approved");
  assert.equal(approved.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.equal(approved.lifecycle.state, SOURCE_LIFECYCLE_STATES.probation);
  assert.equal(approved.lifecycle.promotionEvaluationWindowDays, 3);
  assert.equal(approved.lifecycle.retirementEvaluationWindowDays, 30);
  assert.ok(approved.authorityScore >= 55);
  assert.ok(approved.signalScore >= 45);
  assert.equal(approved.performance.discoveryObservationCount, 2);
  assert.equal(approved.performance.lastObservedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(result.approvedDiscoveredSources[0].kind, "web");
  assert.equal(result.approvedDiscoveredSources[0].status, "approved");
  assert.deepEqual(result.approvedDiscoveredSources[0].lifecycle, {
    state: SOURCE_LIFECYCLE_STATES.probation,
    stage: SOURCE_LIFECYCLE_STAGES.probation,
    probationStartedAt: "2026-03-12T21:00:00.000Z",
    activatedAt: null,
    retiredAt: null,
  });
  assert.equal(result.approvedDiscoveredSources[0].authorityWeight, 0.75);
  assert.equal(
    result.approvedDiscoveredSources[0].weightedAuthorityScore,
    Math.round(result.approvedDiscoveredSources[0].authorityScore * 0.75),
  );

  const persisted = await repository.listFetchableSources({
    now: "2026-03-12T21:05:00.000Z"
  });
  const persistedApproved = persisted.find(
    (source) => source.id === "web:domain:docs.agno.com",
  );
  assert.ok(persistedApproved);
  assert.equal(persistedApproved.performance.discoveryObservationCount, 2);
});

test("persists the highest-signal outbound path as the future fetch target", async () => {
  const { repository, service } = await createService();

  const result = await service.discoverFromItems(
    [
      buildDiscoveryItem({
        externalId: "low-signal-agent-sdk",
        title: "Agent SDK mention",
        summary: "A small mention of agent docs.",
        outboundUrls: ["https://docs.example.com/landing?utm_source=github"],
        githubStars: 120,
        githubActivity: 12,
        socialEngagement: 4,
        mentions: 1,
      }),
      buildDiscoveryItem({
        externalId: "high-signal-agent-sdk",
        title: "Trending agent SDK for tool orchestration",
        summary: "A high-signal agent SDK links directly to the integration docs.",
        outboundUrls: ["https://docs.example.com/platform/agents?utm_source=github"],
        githubStars: 42_000,
        githubActivity: 96,
        socialEngagement: 640,
        mentions: 5,
      }),
    ],
    {
      now: "2026-03-12T21:00:00.000Z",
      cycleId: "2026-03-12",
    },
  );

  const approved = result.approvedSources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.ok(approved);
  assert.equal(approved.fetchUrl, "https://docs.example.com/platform/agents");
  assert.equal(
    approved.evidence.signalQuality.preferredFetchUrl,
    "https://docs.example.com/platform/agents",
  );
  assert.deepEqual(approved.evidence.categoryCoverage, ["library"]);
  assert.equal(approved.evidence.signalQuality.observationCount, 2);
  assert.ok(approved.evidence.signalQuality.highSignalObservationCount >= 1);
  assert.deepEqual(approved.evidence.signalQuality.highSignalCycles, ["2026-03-12"]);
  assert.ok(approved.evidence.signalQuality.averageScore >= 60);

  const persisted = await repository.listFetchableSources({
    now: "2026-03-12T21:05:00.000Z",
  });
  const persistedApproved = persisted.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.ok(persistedApproved);
  assert.equal(persistedApproved.fetchUrl, "https://docs.example.com/platform/agents");
  assert.deepEqual(persistedApproved.evidence.categoryCoverage, ["library"]);
});

test("prefers higher-signal documentation paths over equally scored marketing paths", async () => {
  const { repository, service } = await createService();

  const result = await service.discoverFromItems(
    [
      createNormalizedItemFromSourceRecord({
        adapterId: "github",
        sourceType: "github",
        externalId: "pricing-link",
        title: "Agent platform mention",
        sourceName: "GitHub",
        sourceUrl: "https://github.com/trending?utm_source=feed",
        publishedAt: "2026-03-12T20:00:00.000Z",
        discoveredAt: "2026-03-12T20:00:00.000Z",
        summary: "One source links to a vendor pricing page.",
        outboundUrls: ["https://docs.example.com/pricing/agents?utm_source=github"],
        tags: ["agent", "tool"],
        category: "tool",
        integrationHint: "Review before integrating.",
        author: "github",
        relevanceScore: 72,
        metrics: {
          mentions: 1,
          upvotes: 0,
          comments: 0,
          shares: 0,
        },
        sourceAuthority: {
          authority: 95,
        },
        raw: {},
      }),
      createNormalizedItemFromSourceRecord({
        adapterId: "reddit",
        sourceType: "reddit",
        externalId: "guide-link",
        title: "Agent platform mention",
        sourceName: "r/LocalLLaMA",
        sourceUrl:
          "https://reddit.com/r/LocalLLaMA/comments/guide123?utm_source=home",
        publishedAt: "2026-03-12T20:15:00.000Z",
        discoveredAt: "2026-03-12T20:15:00.000Z",
        summary: "Another source links to the actual integration guide.",
        outboundUrls: ["https://docs.example.com/guides/agents?utm_source=reddit"],
        tags: ["agent", "tool"],
        category: "tool",
        integrationHint: "Review before integrating.",
        author: "builder",
        relevanceScore: 72,
        metrics: {
          mentions: 1,
          upvotes: 0,
          comments: 0,
          shares: 0,
        },
        sourceAuthority: {
          authority: 62,
        },
        raw: {},
      }),
    ],
    {
      now: "2026-03-12T21:00:00.000Z",
      cycleId: "2026-03-12",
    },
  );

  const approved = result.approvedSources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.ok(approved);
  assert.equal(approved.fetchUrl, "https://docs.example.com/guides/agents");
  assert.equal(
    approved.evidence.signalQuality.preferredFetchUrl,
    "https://docs.example.com/guides/agents",
  );
  assert.deepEqual(approved.discoveredFromUrls, [
    "https://github.com/trending",
    "https://reddit.com/r/LocalLLaMA/comments/guide123",
  ]);

  const persisted = await repository.load({
    now: "2026-03-12T21:05:00.000Z",
  });
  const stored = persisted.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.ok(stored);
  assert.equal(stored.fetchUrl, "https://docs.example.com/guides/agents");
  assert.deepEqual(stored.discoveredFromUrls, [
    "https://github.com/trending",
    "https://reddit.com/r/LocalLLaMA/comments/guide123",
  ]);
});

test("deduplicates same-source outbound links inside one item before scoring discovery evidence", async () => {
  const { repository, service } = await createService();

  const result = await service.discoverFromItems(
    [
      {
        sourceUrl: "https://github.com/trending",
        title: "Agent SDK docs",
        summary: "One GitHub item links to both the homepage and the agent docs.",
        outboundLinks: [
          "https://docs.example.com",
          "https://docs.example.com/pricing",
          "https://docs.example.com/platform/agents?utm_source=github",
        ],
      },
    ],
    {
      now: "2026-03-12T21:00:00.000Z",
      cycleId: "2026-03-12",
    },
  );

  const candidate = result.candidateSources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.ok(candidate);
  assert.deepEqual(result.newlyApproved, []);
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.fetchUrl, "https://docs.example.com/platform/agents");
  assert.equal(candidate.evidence.discoveryCount, 1);
  assert.equal(candidate.evidence.authoritySignals.citationCount, 1);
  assert.equal(candidate.evidence.signalQuality.observationCount, 1);

  const persisted = await repository.load({
    now: "2026-03-12T21:05:00.000Z",
  });
  const stored = persisted.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.ok(stored);
  assert.equal(stored.status, "candidate");
  assert.equal(stored.fetchUrl, "https://docs.example.com/platform/agents");
  assert.equal(stored.evidence.discoveryCount, 1);
  assert.equal(stored.evidence.authoritySignals.citationCount, 1);
});

test("keeps weak discoveries as candidates until evidence accumulates across cycles", async () => {
  const { repository, service } = await createService();

  const firstRun = await service.discoverFromItems(
    [
      {
        sourceUrl: "https://github.com/trending",
        title: "Single mention",
        summary: "One agent link",
        outboundLinks: ["https://mcp.so/library/acme-agent-sdk"]
      }
    ],
    {
      now: "2026-03-12T09:00:00.000Z",
      cycleId: "2026-03-12"
    }
  );

  const firstCandidate = firstRun.candidateSources.find(
    (source) => source.id === "web:domain:mcp.so"
  );
  assert.ok(firstCandidate);
  assert.equal(firstCandidate.status, "candidate");

  const secondRun = await service.discoverFromItems(
    [
      {
        sourceUrl: "https://github.com/explore",
        title: "Repeat mention",
        summary: "The same agent SDK appears again",
        outboundLinks: ["https://mcp.so/library/acme-agent-sdk"]
      }
    ],
    {
      now: "2026-03-13T09:00:00.000Z",
      cycleId: "2026-03-13"
    }
  );

  assert.ok(
    secondRun.approvedSources.some((source) => source.id === "web:domain:mcp.so"),
    "source should become approved after repeated trusted discovery"
  );

  const raw = JSON.parse(await readFile(repository.filePath, "utf8"));
  const stored = raw.sources.find((source) => source.id === "web:domain:mcp.so");
  assert.deepEqual(stored.evidence.cyclesSeen, ["2026-03-12", "2026-03-13"]);
  assert.equal(stored.status, "approved");
  assert.equal(stored.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.equal(stored.performance.discoveryObservationCount, 2);
});

test("does not let approved web-discovery items ratchet authority through feedback loops", async () => {
  const { repository, service } = await createService();

  await service.discoverFromItems(
    [
      {
        sourceUrl: "https://github.com/trending",
        title: "Agent SDK mention",
        summary: "One agent link",
        outboundLinks: ["https://docs.guardrail.dev/agents"]
      }
    ],
    {
      now: "2026-03-12T09:00:00.000Z",
      cycleId: "2026-03-12"
    }
  );

  const secondRun = await service.discoverFromItems(
    [
      createNormalizedItemFromSourceRecord({
        adapterId: "web-discovery",
        sourceType: "web",
        externalId: "web:domain:docs.example.com",
        title: "Approved docs roundup of agent tools and APIs",
        sourceName: "docs.example.com",
        sourceUrl: "https://docs.example.com/agents",
        publishedAt: "2026-03-13T09:00:00.000Z",
        discoveredAt: "2026-03-13T09:00:00.000Z",
        summary: "Approved source coverage that links to another SDK.",
        outboundUrls: ["https://docs.guardrail.dev/agents"],
        tags: ["agent", "tool", "api"],
        category: "tool",
        integrationHint: "Review before integrating.",
        author: null,
        metrics: {
          mentions: 1,
          upvotes: 0,
          comments: 0,
          shares: 0
        },
        sourceAuthority: {
          authority: 78
        },
        metadata: {
          approvedSourceId: "web:domain:docs.example.com"
        },
        raw: {}
      })
    ],
    {
      now: "2026-03-13T09:00:00.000Z",
      cycleId: "2026-03-13"
    }
  );

  const candidate = secondRun.candidateSources.find(
    (source) => source.id === "web:domain:docs.guardrail.dev"
  );
  assert.ok(candidate);
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.evidence.discoveryCount, 2);
  assert.equal(candidate.evidence.authoritySignals.citationCount, 1);
  assert.deepEqual(candidate.evidence.authoritySignals.cyclesSeen, ["2026-03-12"]);

  const raw = JSON.parse(await readFile(repository.filePath, "utf8"));
  const stored = raw.sources.find((source) => source.id === "web:domain:docs.guardrail.dev");
  assert.equal(stored.authorityScore, 32);
  assert.equal(stored.status, "candidate");
});

test("promotes probationary sources to active after repeated 60+ editions inside the configured window", async () => {
  const { repository, service } = await createService({
    ...DEFAULT_DISCOVERY_CONFIG,
    probationEvaluationWindowCycles: 2,
    probationMinQualifyingCycles: 2,
    probationPromotionMinScore: 60,
    retirementLowSignalCycles: 10,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:00:00.000Z",
    sources: [buildApprovedProbationarySource()],
  });

  const firstRun = await service.discoverFromItems([], {
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
    scoredItems: [
      buildProbationaryScoredItem({
        relevanceScore: 67,
        publishedAt: "2026-03-12T21:00:00.000Z",
      }),
    ],
  });

  const afterFirstRun = firstRun.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.equal(afterFirstRun.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.deepEqual(afterFirstRun.lifecycle.qualifyingCycles, [
    {
      cycleId: "2026-03-12",
      observedAt: "2026-03-12T21:00:00.000Z",
      score: 67,
    },
  ]);

  const secondRun = await service.discoverFromItems([], {
    now: "2026-03-13T21:00:00.000Z",
    cycleId: "2026-03-13",
    scoredItems: [
      buildProbationaryScoredItem({
        relevanceScore: 74,
        publishedAt: "2026-03-13T21:00:00.000Z",
      }),
    ],
  });

  assert.deepEqual(
    secondRun.newlyPromoted.map((source) => source.id),
    ["web:domain:docs.example.com"],
  );
  assert.equal(secondRun.approvedDiscoveredSources[0].status, "approved");
  assert.deepEqual(secondRun.approvedDiscoveredSources[0].lifecycle, {
    state: SOURCE_LIFECYCLE_STATES.active,
    stage: SOURCE_LIFECYCLE_STAGES.active,
    probationStartedAt: "2026-03-10T21:00:00.000Z",
    activatedAt: "2026-03-13T21:00:00.000Z",
    retiredAt: null,
  });
  assert.equal(secondRun.approvedDiscoveredSources[0].authorityWeight, 1);
  assert.equal(
    secondRun.approvedDiscoveredSources[0].weightedAuthorityScore,
    secondRun.approvedDiscoveredSources[0].authorityScore,
  );

  const raw = JSON.parse(await readFile(repository.filePath, "utf8"));
  const stored = raw.sources.find((source) => source.id === "web:domain:docs.example.com");
  assert.equal(stored.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(stored.lifecycle.activatedAt, "2026-03-13T21:00:00.000Z");
  assert.deepEqual(stored.evidence.categoryCoverage, ["tool"]);
  assert.deepEqual(
    stored.lifecycle.qualifyingCycles.map((entry) => entry.cycleId),
    ["2026-03-12", "2026-03-13"],
  );
});

test("probationary sources keep bootstrap-only authority until activation", async () => {
  const { repository, service } = await createService({
    ...DEFAULT_DISCOVERY_CONFIG,
    probationEvaluationWindowCycles: 3,
    probationMinQualifyingCycles: 3,
    probationPromotionMinScore: 60,
    retirementLowSignalCycles: 10,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:00:00.000Z",
    sources: [buildApprovedProbationarySource({ authorityScore: 64 })],
  });

  await service.discoverFromItems([], {
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
    scoredItems: [
      buildProbationaryScoredItem({
        relevanceScore: 67,
        publishedAt: "2026-03-12T21:00:00.000Z",
      }),
    ],
  });

  const secondRun = await service.discoverFromItems([], {
    now: "2026-03-13T21:00:00.000Z",
    cycleId: "2026-03-13",
    scoredItems: [
      buildProbationaryScoredItem({
        relevanceScore: 74,
        publishedAt: "2026-03-13T21:00:00.000Z",
      }),
    ],
  });

  const probationarySource = secondRun.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.ok(probationarySource);
  assert.equal(probationarySource.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.equal(probationarySource.authorityScore, 64);
  assert.equal(secondRun.approvedDiscoveredSources[0].authorityScore, 64);
  assert.equal(secondRun.approvedDiscoveredSources[0].authorityWeight, 0.75);
  assert.equal(secondRun.approvedDiscoveredSources[0].weightedAuthorityScore, 48);
  assert.deepEqual(
    probationarySource.evidence.authoritySignals.domainExpertiseRetention,
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
    },
  );
});

test("probationary sources stay in probation until they post consecutive 60+ editions", async () => {
  const { repository, service } = await createService({
    ...DEFAULT_DISCOVERY_CONFIG,
    probationEvaluationWindowCycles: 2,
    probationMinQualifyingCycles: 2,
    probationPromotionMinScore: 60,
    retirementLowSignalCycles: 10,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:00:00.000Z",
    sources: [buildApprovedProbationarySource()],
  });

  await service.discoverFromItems([], {
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
    scoredItems: [
      buildProbationaryScoredItem({
        relevanceScore: 67,
        publishedAt: "2026-03-12T21:00:00.000Z",
      }),
    ],
  });

  const lowScoreRun = await service.discoverFromItems([], {
    now: "2026-03-13T21:00:00.000Z",
    cycleId: "2026-03-13",
    scoredItems: [
      buildProbationaryScoredItem({
        relevanceScore: 58,
        publishedAt: "2026-03-13T21:00:00.000Z",
      }),
    ],
  });

  const afterLowScore = lowScoreRun.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.equal(afterLowScore.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.deepEqual(afterLowScore.lifecycle.qualifyingCycles, []);

  const recoveryRun = await service.discoverFromItems([], {
    now: "2026-03-14T21:00:00.000Z",
    cycleId: "2026-03-14",
    scoredItems: [
      buildProbationaryScoredItem({
        relevanceScore: 74,
        publishedAt: "2026-03-14T21:00:00.000Z",
      }),
    ],
  });

  const afterRecovery = recoveryRun.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.equal(afterRecovery.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.deepEqual(
    afterRecovery.lifecycle.qualifyingCycles.map((entry) => entry.cycleId),
    ["2026-03-14"],
  );

  const promotionRun = await service.discoverFromItems([], {
    now: "2026-03-15T21:00:00.000Z",
    cycleId: "2026-03-15",
    scoredItems: [
      buildProbationaryScoredItem({
        relevanceScore: 72,
        publishedAt: "2026-03-15T21:00:00.000Z",
      }),
    ],
  });

  assert.deepEqual(
    promotionRun.newlyPromoted.map((source) => source.id),
    ["web:domain:docs.example.com"],
  );
});

test("promotion uses a source-specific lifecycle window when it differs from service config", async () => {
  const { repository, service } = await createService({
    ...DEFAULT_DISCOVERY_CONFIG,
    probationEvaluationWindowCycles: 4,
    probationMinQualifyingCycles: 4,
    probationPromotionMinScore: 60,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:00:00.000Z",
    sources: [
      buildApprovedProbationarySource({
        lifecycle: {
          promotionEvaluationWindowDays: 2,
        },
      }),
    ],
  });

  await service.discoverFromItems([], {
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
    scoredItems: [
      buildProbationaryScoredItem({
        relevanceScore: 66,
        publishedAt: "2026-03-12T21:00:00.000Z",
      }),
    ],
  });

  const secondRun = await service.discoverFromItems([], {
    now: "2026-03-13T21:00:00.000Z",
    cycleId: "2026-03-13",
    scoredItems: [
      buildProbationaryScoredItem({
        relevanceScore: 71,
        publishedAt: "2026-03-13T21:00:00.000Z",
      }),
    ],
  });

  assert.deepEqual(
    secondRun.newlyPromoted.map((source) => source.id),
    ["web:domain:docs.example.com"],
  );

  const stored = secondRun.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.equal(stored.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(stored.lifecycle.promotionEvaluationWindowDays, 2);
});

test("service promotion window config prunes stale qualifying cycles before promotion", async () => {
  const { repository, service } = await createService({
    ...DEFAULT_DISCOVERY_CONFIG,
    probationEvaluationWindowCycles: 2,
    probationMinQualifyingCycles: 2,
    probationPromotionMinScore: 60,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [
      buildApprovedProbationarySource({
        lifecycle: {
          qualifyingCycles: [
            {
              cycleId: "2026-03-12",
              observedAt: "2026-03-12T21:00:00.000Z",
              score: 68,
            },
          ],
        },
      }),
    ],
  });

  const result = await service.discoverFromItems([], {
    now: "2026-03-14T21:00:00.000Z",
    cycleId: "2026-03-14",
    scoredItems: [
      buildProbationaryScoredItem({
        relevanceScore: 71,
        publishedAt: "2026-03-14T21:00:00.000Z",
      }),
    ],
  });

  assert.deepEqual(result.newlyPromoted, []);

  const stored = result.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.equal(stored.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.deepEqual(stored.lifecycle.qualifyingCycles, [
    {
      cycleId: "2026-03-14",
      observedAt: "2026-03-14T21:00:00.000Z",
      score: 71,
    },
  ]);
});

test("retires approved sources after sustained low-signal cycles and removes them from fetching", async () => {
  const { repository, service } = await createService({
    ...DEFAULT_DISCOVERY_CONFIG,
    retirementLowSignalCycles: 3,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:00:00.000Z",
    sources: [
      buildApprovedProbationarySource({
        lifecycle: {
          stage: SOURCE_LIFECYCLE_STAGES.active,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
          lowSignalStreak: 2,
          lowSignalCycles: ["2026-03-10", "2026-03-11"],
        },
      }),
    ],
  });

  const result = await service.discoverFromItems([], {
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
  });

  assert.deepEqual(
    result.newlyRetired.map((source) => source.id),
    ["web:domain:docs.example.com"],
  );

  const retired = result.retiredSources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.ok(retired);
  assert.equal(retired.status, "retired");
  assert.equal(retired.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.retired);
  assert.equal(retired.lifecycle.state, SOURCE_LIFECYCLE_STAGES.retired);
  assert.equal(retired.lifecycle.retiredAt, "2026-03-12T21:00:00.000Z");
  assert.equal(retired.lifecycle.lowSignalStreak, 3);
  assert.deepEqual(retired.lifecycle.lowSignalCycles, [
    "2026-03-10",
    "2026-03-11",
    "2026-03-12",
  ]);
  assert.deepEqual(retired.lifecycle.retirementAudit.current, {
    retiredAt: "2026-03-12T21:00:00.000Z",
    reason: SOURCE_RETIREMENT_REASONS.lowSignalStreak,
    evidence: {
      cycleId: "2026-03-12",
      threshold: 3,
      lowSignalStreak: 3,
      lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
      evaluationWindowDays: 30,
    },
    restoredAt: null,
    restoreReason: null,
    restoreEvidence: null,
    restoredState: null,
    restoreSnapshot: buildRestoreSnapshot({
      probationStartedAt: "2026-03-10T21:00:00.000Z",
      activatedAt: "2026-03-11T21:00:00.000Z",
      lowSignalStreak: 3,
      lowSignalCycles: ["2026-03-10", "2026-03-11", "2026-03-12"],
      lastEvaluatedAt: "2026-03-12T21:00:00.000Z",
    }),
  });
  assert.equal(retired.performance.lastObservedAt, "2026-03-12T21:00:00.000Z");

  const fetchable = await repository.listFetchableSources({
    now: "2026-03-12T21:05:00.000Z",
  });
  assert.ok(
    fetchable.every((source) => source.id !== "web:domain:docs.example.com"),
    "retired sources should be removed from the active fetch schedule",
  );
});

test("blocks retirement when it would remove the last active source for an underrepresented category", async () => {
  const { repository, service } = await createService({
    ...DEFAULT_DISCOVERY_CONFIG,
    retirementLowSignalCycles: 3,
    minimumActiveCategorySources: 2,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:00:00.000Z",
    sources: [
      buildApprovedProbationarySource({
        id: "web:domain:techniques.example.com",
        value: "techniques.example.com",
        displayName: "techniques.example.com",
        url: "https://techniques.example.com",
        canonicalUrl: "https://techniques.example.com",
        fetchUrl: "https://techniques.example.com",
        evidence: {
          categoryCoverage: ["technique"],
        },
        lifecycle: {
          stage: SOURCE_LIFECYCLE_STAGES.active,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
          lowSignalStreak: 2,
          lowSignalCycles: ["2026-03-10", "2026-03-11"],
        },
      }),
    ],
  });

  const result = await service.discoverFromItems([], {
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
  });

  assert.deepEqual(result.newlyRetired, []);

  const active = result.approvedSources.find(
    (source) => source.id === "web:domain:techniques.example.com",
  );
  assert.ok(active);
  assert.equal(active.status, "approved");
  assert.equal(active.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(active.lifecycle.lowSignalStreak, 3);
  assert.deepEqual(active.lifecycle.lowSignalCycles, [
    "2026-03-10",
    "2026-03-11",
    "2026-03-12",
  ]);
  assert.deepEqual(active.evidence.categoryCoverage, ["technique"]);
  assert.deepEqual(
    result.categoryCoverageStatuses.find((entry) => entry.category === "technique"),
    {
      category: "technique",
      activeSourceCount: 1,
      status: "fragile_coverage",
    },
  );

  const fetchable = await repository.listFetchableSources({
    now: "2026-03-12T21:05:00.000Z",
  });
  assert.ok(
    fetchable.some((source) => source.id === "web:domain:techniques.example.com"),
    "guarded sources should remain in the active fetch schedule",
  );
});

test("service can evaluate low-signal sources directly and persist retired fetch targets", async () => {
  const { repository, service } = await createService({
    ...DEFAULT_DISCOVERY_CONFIG,
    retirementLowSignalCycles: 3,
    minimumActiveCategorySources: 1,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:00:00.000Z",
    sources: [
      buildApprovedProbationarySource({
        evidence: {
          categoryCoverage: ["tool"],
        },
        lifecycle: {
          stage: SOURCE_LIFECYCLE_STAGES.active,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
          lowSignalStreak: 2,
          lowSignalCycles: ["2026-03-10", "2026-03-11"],
        },
      }),
    ],
  });

  const result = await service.evaluateLowSignalSources({
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
  });

  assert.deepEqual(
    result.newlyRetired.map((source) => source.id),
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
  assert.deepEqual(
    result.categoryCoverageStatuses.find((entry) => entry.category === "tool"),
    {
      category: "tool",
      activeSourceCount: 0,
      status: "blind_spot",
    },
  );

  const fetchable = await repository.listFetchableSources({
    now: "2026-03-12T21:05:00.000Z",
  });
  assert.ok(
    fetchable.every((source) => source.id !== "web:domain:docs.example.com"),
    "direct low-signal evaluation should retire the source from active fetching",
  );
});

test("service retires approved sources with sustained poor fetch performance and persists the schedule change", async () => {
  const { repository, service } = await createService({
    ...DEFAULT_DISCOVERY_CONFIG,
    retirementConsecutiveFetchFailures: 3,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [
      buildApprovedProbationarySource({
        lifecycle: {
          stage: SOURCE_LIFECYCLE_STAGES.active,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
          lowSignalStreak: 0,
          lowSignalCycles: [],
        },
        performance: {
          lastFetchedAt: "2026-03-12T20:00:00.000Z",
          lastFailedFetchAt: "2026-03-12T20:00:00.000Z",
          successfulFetchCount: 1,
          failedFetchCount: 3,
          consecutiveFetchFailures: 3,
          nextEligibleFetchAt: "2026-03-13T00:00:00.000Z",
        },
      }),
    ],
  });

  const result = await service.evaluateLowSignalSources({
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
  });

  assert.deepEqual(
    result.newlyRetired.map((source) => source.id),
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

  const retired = result.retiredSources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.ok(retired);
  assert.equal(
    retired.lifecycle.retirementAudit.current.reason,
    SOURCE_RETIREMENT_REASONS.poorPerformance,
  );

  const fetchable = await repository.listFetchableSources({
    now: "2026-03-12T21:05:00.000Z",
  });
  assert.ok(
    fetchable.every((source) => source.id !== "web:domain:docs.example.com"),
    "performance-based retirement should remove the source from active fetching",
  );
});

test("blocks retirement when only probationary peers remain in an underrepresented category", async () => {
  const { repository, service } = await createService({
    ...DEFAULT_DISCOVERY_CONFIG,
    retirementLowSignalCycles: 3,
    minimumActiveCategorySources: 2,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:00:00.000Z",
    sources: [
      buildApprovedProbationarySource({
        id: "web:domain:active-techniques.example.com",
        value: "active-techniques.example.com",
        displayName: "active-techniques.example.com",
        url: "https://active-techniques.example.com",
        canonicalUrl: "https://active-techniques.example.com",
        fetchUrl: "https://active-techniques.example.com",
        evidence: {
          categoryCoverage: ["technique"],
        },
        lifecycle: {
          stage: SOURCE_LIFECYCLE_STAGES.active,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
          lowSignalStreak: 2,
          lowSignalCycles: ["2026-03-10", "2026-03-11"],
        },
      }),
      buildApprovedProbationarySource({
        id: "web:domain:probation-techniques.example.com",
        value: "probation-techniques.example.com",
        displayName: "probation-techniques.example.com",
        url: "https://probation-techniques.example.com",
        canonicalUrl: "https://probation-techniques.example.com",
        fetchUrl: "https://probation-techniques.example.com",
        evidence: {
          categoryCoverage: ["technique"],
        },
        lifecycle: {
          stage: SOURCE_LIFECYCLE_STAGES.probation,
          probationStartedAt: "2026-03-11T21:00:00.000Z",
          activatedAt: null,
          lowSignalStreak: 0,
          lowSignalCycles: [],
        },
      }),
    ],
  });

  const result = await service.discoverFromItems([], {
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
  });

  assert.deepEqual(result.newlyRetired, []);

  const active = result.approvedSources.find(
    (source) => source.id === "web:domain:active-techniques.example.com",
  );
  assert.ok(active);
  assert.equal(active.status, "approved");
  assert.equal(active.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(active.lifecycle.lowSignalStreak, 3);
  assert.deepEqual(active.lifecycle.lowSignalCycles, [
    "2026-03-10",
    "2026-03-11",
    "2026-03-12",
  ]);

  const probationary = result.approvedSources.find(
    (source) => source.id === "web:domain:probation-techniques.example.com",
  );
  assert.ok(probationary);
  assert.equal(probationary.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.equal(probationary.lifecycle.lowSignalStreak, 1);
  assert.deepEqual(probationary.lifecycle.lowSignalCycles, ["2026-03-12"]);
});

test("resets low-signal retirement tracking when an approved source emits fresh signal", async () => {
  const { repository, service } = await createService({
    ...DEFAULT_DISCOVERY_CONFIG,
    retirementLowSignalCycles: 3,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:00:00.000Z",
    sources: [
      buildApprovedProbationarySource({
        lifecycle: {
          stage: SOURCE_LIFECYCLE_STAGES.active,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
          lowSignalStreak: 2,
          lowSignalCycles: ["2026-03-10", "2026-03-11"],
        },
      }),
    ],
  });

  const result = await service.discoverFromItems(
    [
      buildProbationaryScoredItem({
        publishedAt: "2026-03-12T21:00:00.000Z",
      }),
    ],
    {
      now: "2026-03-12T21:00:00.000Z",
      cycleId: "2026-03-12",
    },
  );

  const active = result.approvedSources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.ok(active);
  assert.equal(active.status, "approved");
  assert.equal(active.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(active.lifecycle.lowSignalStreak, 0);
  assert.deepEqual(active.lifecycle.lowSignalCycles, []);
  assert.equal(active.lastSeenAt, "2026-03-12T21:00:00.000Z");
  assert.deepEqual(result.newlyRetired, []);
});

test("restores retired sources when renewed signal requalifies them and closes the audit entry", async () => {
  const { repository, service } = await createService();

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [
      buildApprovedProbationarySource({
        status: "retired",
        retiredAt: "2026-03-12T21:00:00.000Z",
        approvedAt: "2026-03-10T21:00:00.000Z",
        lifecycle: {
          stage: SOURCE_LIFECYCLE_STAGES.retired,
          state: SOURCE_LIFECYCLE_STATES.retired,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
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
            },
          },
        },
      }),
    ],
  });

  const result = await service.discoverFromItems(
    [
      buildDiscoveryItem({
        externalId: "renewed-agent-sdk",
        outboundUrls: ["https://docs.example.com/platform/agents"],
        publishedAt: "2026-03-13T21:00:00.000Z",
      }),
    ],
    {
      now: "2026-03-13T21:00:00.000Z",
      cycleId: "2026-03-13",
    },
  );

  assert.deepEqual(
    result.restoredSources.map((source) => source.id),
    ["web:domain:docs.example.com"],
  );

  const restored = result.approvedSources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.ok(restored);
  assert.equal(restored.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.equal(restored.lifecycle.retirementAudit.current, null);
  assert.equal(restored.lifecycle.retirementAudit.history.length, 1);
  assert.equal(
    restored.lifecycle.retirementAudit.history[0].restoredState,
    SOURCE_LIFECYCLE_STATES.probation,
  );
  assert.equal(
    restored.lifecycle.retirementAudit.history[0].restoreReason,
    SOURCE_RESTORE_REASONS.renewedSignal,
  );
  assert.deepEqual(
    restored.lifecycle.retirementAudit.history[0].restoreEvidence,
    {
      cycleId: "2026-03-13",
      sourceUrl: "https://github.com/example/agent-sdk",
      itemExternalId: "renewed-agent-sdk",
      relevanceScore: null,
      authorityScore: restored.authorityScore,
      signalScore: restored.signalScore,
    },
  );
});

test("persists source status changes across promotion, retirement, and restoration cycles", async () => {
  const { repository, service } = await createService({
    ...DEFAULT_DISCOVERY_CONFIG,
    probationEvaluationWindowCycles: 2,
    probationMinQualifyingCycles: 2,
    probationPromotionMinScore: 60,
    retirementLowSignalCycles: 2,
    minimumActiveCategorySources: 1,
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:00:00.000Z",
    sources: [buildApprovedProbationarySource()],
  });

  const firstQualifyingItem = buildProbationaryScoredItem({
    relevanceScore: 66,
    publishedAt: "2026-03-12T21:00:00.000Z",
  });
  const probationRun = await service.discoverFromItems([firstQualifyingItem], {
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
    scoredItems: [firstQualifyingItem],
  });
  const probationary = probationRun.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.equal(probationary.status, "approved");
  assert.equal(probationary.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.deepEqual(
    probationary.lifecycle.qualifyingCycles.map((entry) => entry.cycleId),
    ["2026-03-12"],
  );

  const secondQualifyingItem = buildProbationaryScoredItem({
    relevanceScore: 73,
    publishedAt: "2026-03-13T21:00:00.000Z",
  });
  const promotionRun = await service.discoverFromItems([secondQualifyingItem], {
    now: "2026-03-13T21:00:00.000Z",
    cycleId: "2026-03-13",
    scoredItems: [secondQualifyingItem],
  });
  const active = promotionRun.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.deepEqual(
    promotionRun.newlyPromoted.map((source) => source.id),
    ["web:domain:docs.example.com"],
  );
  assert.equal(active.status, "approved");
  assert.equal(active.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(active.lifecycle.activatedAt, "2026-03-13T21:00:00.000Z");

  const lowSignalRun = await service.discoverFromItems([], {
    now: "2026-03-14T21:00:00.000Z",
    cycleId: "2026-03-14",
  });
  const lowSignalActive = lowSignalRun.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.equal(lowSignalActive.status, "approved");
  assert.equal(lowSignalActive.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(lowSignalActive.lifecycle.lowSignalStreak, 1);
  assert.deepEqual(lowSignalActive.lifecycle.lowSignalCycles, ["2026-03-14"]);

  const retirementRun = await service.discoverFromItems([], {
    now: "2026-03-15T21:00:00.000Z",
    cycleId: "2026-03-15",
  });
  const retired = retirementRun.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.deepEqual(
    retirementRun.newlyRetired.map((source) => source.id),
    ["web:domain:docs.example.com"],
  );
  assert.equal(retired.status, "retired");
  assert.equal(retired.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.retired);
  assert.equal(retired.lifecycle.retiredAt, "2026-03-15T21:00:00.000Z");
  assert.equal(retired.lifecycle.lowSignalStreak, 2);
  assert.deepEqual(retired.lifecycle.lowSignalCycles, [
    "2026-03-14",
    "2026-03-15",
  ]);

  const restorationRun = await service.discoverFromItems(
    [
      buildDiscoveryItem({
        externalId: "restored-agent-sdk",
        outboundUrls: ["https://docs.example.com/platform/agents"],
        publishedAt: "2026-03-16T21:00:00.000Z",
      }),
    ],
    {
      now: "2026-03-16T21:00:00.000Z",
      cycleId: "2026-03-16",
    },
  );
  const restored = restorationRun.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.deepEqual(
    restorationRun.restoredSources.map((source) => source.id),
    ["web:domain:docs.example.com"],
  );
  assert.equal(restored.status, "approved");
  assert.equal(restored.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.equal(restored.lifecycle.retiredAt, null);
  assert.equal(restored.lifecycle.lowSignalStreak, 0);
  assert.deepEqual(restored.lifecycle.lowSignalCycles, []);
  assert.equal(restored.lifecycle.retirementAudit.current, null);
  assert.equal(restored.lifecycle.retirementAudit.history.length, 1);
  assert.equal(
    restored.lifecycle.retirementAudit.history[0].restoredState,
    SOURCE_LIFECYCLE_STATES.probation,
  );
  assert.equal(
    restored.lifecycle.retirementAudit.history[0].restoredAt,
    "2026-03-16T21:00:00.000Z",
  );

  const reloaded = await repository.load({
    now: "2026-03-16T21:00:00.000Z",
  });
  const persisted = reloaded.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.equal(persisted.status, "approved");
  assert.equal(persisted.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.equal(persisted.lifecycle.retiredAt, null);
  assert.equal(persisted.lifecycle.retirementAudit.history.length, 1);
});

test("tracks recurring items and noise expiry without feeding them back into source authority", async () => {
  const { repository, service } = await createService({
    ...DEFAULT_DISCOVERY_CONFIG,
    sourceExpertiseRetentionWindowDays: 2,
  });
  const recurringItemFirst = buildProbationaryScoredItem({
    sourceId: "web:domain:docs.example.com",
    relevanceScore: 67,
    publishedAt: "2026-03-12T21:00:00.000Z",
  });
  const recurringItemSecond = buildProbationaryScoredItem({
    sourceId: "web:domain:docs.example.com",
    relevanceScore: 74,
    publishedAt: "2026-03-13T21:00:00.000Z",
  });
  const noiseItem = buildProbationaryScoredItem({
    sourceId: "web:domain:docs.example.com",
    externalId: "web:domain:docs.example.com:noise-item",
    title: "Ephemeral docs mention",
    sourceUrl: "https://docs.example.com/noise",
    summary: "A one-off mention that does not hold relevance across editions.",
    relevanceScore: 69,
    publishedAt: "2026-03-14T22:00:00.000Z",
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:00:00.000Z",
    sources: [
      buildApprovedProbationarySource({
        authorityScore: 64,
        lifecycle: {
          stage: SOURCE_LIFECYCLE_STAGES.active,
          state: SOURCE_LIFECYCLE_STAGES.active,
          probationStartedAt: "2026-03-10T21:00:00.000Z",
          activatedAt: "2026-03-11T21:00:00.000Z",
        },
        evidence: {
          authoritySignals: {
            citationCount: 2,
            referrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
            sourceKinds: ["github", "reddit"],
            cyclesSeen: ["2026-03-10"],
            githubStars: 0,
            githubActivity: 0,
          },
        },
      }),
    ],
  });

  await service.discoverFromItems([], {
    now: "2026-03-12T21:00:00.000Z",
    cycleId: "2026-03-12",
    scoredItems: [recurringItemFirst],
  });

  const retainedRun = await service.discoverFromItems([], {
    now: "2026-03-13T21:00:00.000Z",
    cycleId: "2026-03-13",
    scoredItems: [recurringItemSecond],
  });

  const retainedSource = retainedRun.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.ok(retainedSource);
  assert.equal(retainedSource.authorityScore, 70);
  assert.deepEqual(
    retainedSource.evidence.authoritySignals.domainExpertiseRetention,
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
    },
  );
  assert.deepEqual(retainedSource.evidence.authoritySignals.expertise.trackedItems, [
    {
      itemId: recurringItemFirst.itemId,
      firstCycleId: "2026-03-12",
      firstObservedAt: "2026-03-12T21:00:00.000Z",
      lastCycleId: "2026-03-13",
      lastObservedAt: "2026-03-13T21:00:00.000Z",
      firstScore: 67,
      totalScore: 141,
      averageScore: 71,
      bestScore: 74,
      appearanceCount: 2,
      occurrences: [
        {
          cycleId: "2026-03-12",
          observedAt: "2026-03-12T21:00:00.000Z",
          relevanceScore: 67,
        },
        {
          cycleId: "2026-03-13",
          observedAt: "2026-03-13T21:00:00.000Z",
          relevanceScore: 74,
        },
      ],
      domains: ["tool"],
      status: "retained",
      resolvedAt: "2026-03-13T21:00:00.000Z",
    },
  ]);

  const decayedRun = await service.discoverFromItems([], {
    now: "2026-03-14T21:00:00.000Z",
    cycleId: "2026-03-14",
    scoredItems: [noiseItem],
  });

  const afterDecaySeed = decayedRun.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.equal(afterDecaySeed.authorityScore, 70);

  const expiredNoiseRun = await service.discoverFromItems([], {
    now: "2026-03-16T21:00:00.000Z",
    cycleId: "2026-03-16",
    scoredItems: [],
  });

  const penalizedSource = expiredNoiseRun.snapshot.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );
  assert.ok(penalizedSource);
  assert.equal(penalizedSource.authorityScore, 61);
  assert.deepEqual(
    penalizedSource.evidence.authoritySignals.domainExpertiseRetention,
    {
      trackedItemCount: 2,
      resolvedItemCount: 2,
      retainedItemCount: 1,
      shortLivedItemCount: 1,
      retentionRate: 0.5,
      relevanceRetentionRate: 0.5,
      weightedOutcome: -0.25,
      authorityAdjustment: -3,
      domains: {
        tool: {
          trackedItemCount: 2,
          resolvedItemCount: 2,
          retainedItemCount: 1,
          shortLivedItemCount: 1,
          retentionRate: 0.5,
          relevanceRetentionRate: 0.5,
          weightedOutcome: -0.25,
          authorityAdjustment: -3,
        },
      },
      lastUpdatedAt: "2026-03-16T21:00:00.000Z",
    },
  );
  assert.deepEqual(
    penalizedSource.evidence.authoritySignals.expertise.trackedItems.map((entry) => ({
      itemId: entry.itemId,
      appearanceCount: entry.appearanceCount,
      status: entry.status,
    })),
    [
      {
        itemId: noiseItem.itemId,
        appearanceCount: 1,
        status: "short_lived",
      },
      {
        itemId: recurringItemFirst.itemId,
        appearanceCount: 2,
        status: "retained",
      },
    ],
  );
});
