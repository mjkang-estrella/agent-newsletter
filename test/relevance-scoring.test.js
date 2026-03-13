import test from "node:test";
import assert from "node:assert/strict";

import { createNormalizedItem } from "../src/core/schema.js";
import {
  CURRENT_RELEVANCE_SCORE_VERSION_ENTRY,
  createRelevanceScoreBreakdown,
  compareCuratedItemsByRelevance,
  DEFAULT_MIN_RELEVANCE_SCORE,
  DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  DEFAULT_RELEVANCE_SCORE_RANGE,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  createWeightedRelevanceScorer,
  extractRelevanceSignalInputs,
  getRelevanceScoreVersionHistoryEntry,
  filterCuratedItemsByRelevance,
  hasHighSentimentDivergence,
  normalizeRelevanceSignalInputs,
  normalizeRelevanceSignals,
  RELEVANCE_SCORE_VERSION_HISTORY,
  DEFAULT_RELEVANCE_SCORING_CONFIG,
  resolveRelevanceScoringConfig,
  scoreGitHubActivitySignal,
  scoreGitHubSignal,
  scoreGitHubStarsSignal,
  scoreItemRelevance,
  scoreMentionFrequencySignal,
  scoreRecencySignal,
  scoreSocialEngagementSignal,
  scoreSourceAuthoritySignal,
  sortCuratedItemsByRelevance,
} from "../src/core/relevance-scoring.js";

function buildScoreableItem(overrides = {}) {
  const scoringSignals = {
    recencyHours: 6,
    socialEngagement: 100,
    ...(overrides.scoringSignals ?? {}),
  };

  return createNormalizedItem({
    name: "Agent Toolkit",
    sourceUrl: "https://example.com/agent-toolkit",
    category: "tool",
    summary: "High-signal automation tooling for AI agents.",
    integrationHint: "Wire it into your runtime bootstrap.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 70,
    mentionCount: 2,
    publishedAt: "2026-03-11T15:00:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    ...overrides,
    scoringSignals,
  });
}

function buildRepresentativeNewsletterItems() {
  const buildItem = (overrides = {}) =>
    createNormalizedItem({
      summary: "Representative AI agent newsletter item for relevance scoring.",
      integrationHint: "Evaluate fit before wiring it into an autonomous runtime.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      discoveredAt: "2026-03-11T21:00:00Z",
      ...overrides,
    });

  return {
    libraryRelease: buildItem({
      name: "Open Agent Runtime 2.0",
      sourceUrl: "https://github.com/acme/open-agent-runtime",
      category: "library",
      sourceKinds: ["github"],
      adapterIds: ["github"],
      sourceAuthorityScore: 94,
      mentionCount: 5,
      publishedAt: "2026-03-11T19:00:00Z",
      scoringSignals: {
        recencyHours: 2,
        githubStars: 6200,
        githubActivity: 90,
        socialEngagement: 260,
      },
    }),
    apiLaunch: buildItem({
      name: "Agent Memory API",
      sourceUrl: "https://docs.example.com/agent-memory-api",
      sourceUrls: [
        "https://docs.example.com/agent-memory-api",
        "https://blog.example.com/agent-memory-api-launch",
        "https://news.example.com/agent-memory-api",
      ],
      category: "api",
      sourceAuthorityScore: 90,
      publishedAt: "2026-03-11T15:00:00Z",
      scoringSignals: {
        recencyHours: 6,
        socialEngagement: 140,
      },
    }),
    researchTechnique: buildItem({
      name: "Planner-Critic Loops for Agents",
      sourceUrl: "https://arxiv.org/abs/2603.12345",
      category: "technique",
      sourceKinds: ["arxiv"],
      adapterIds: ["arxiv"],
      sourceAuthorityScore: 96,
      mentionCount: 2,
      publishedAt: "2026-03-11T09:00:00Z",
      scoringSignals: {
        recencyHours: 12,
        socialEngagement: 35,
      },
    }),
    viralToolAnnouncement: buildItem({
      name: "Sandboxed Agent Console",
      sourceUrl: "https://x.com/builder/status/123",
      category: "tool",
      sourceKinds: ["x"],
      adapterIds: ["twitter"],
      sourceAuthorityScore: 25,
      mentionCount: 1,
      publishedAt: "2026-03-11T20:00:00Z",
      scoringSignals: {
        recencyHours: 1,
        socialEngagement: 800,
      },
    }),
  };
}

test("recency and mention scorers normalize explicit item signals to 0-100", () => {
  const item = createNormalizedItem({
    name: "Agent Digest",
    sourceUrl: "https://example.com/agent-digest",
    category: "technique",
    summary: "A daily digest for agent engineering news.",
    integrationHint: "Adapt the workflow to your own runtime.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 70,
    mentionCount: 3,
    publishedAt: "2026-03-10T21:00:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    scoringSignals: {
      recencyHours: 24,
    },
  });

  assert.equal(scoreRecencySignal(item), 50);
  assert.equal(scoreMentionFrequencySignal(item), 63);
});

test("GitHub and social scorers honor explicit normalized item metadata", () => {
  const item = createNormalizedItem({
    name: "open-agent-platform",
    sourceUrl: "https://github.com/acme/open-agent-platform",
    category: "library",
    summary: "Framework for agent orchestration with tracing and memory.",
    integrationHint: "Install with npm or pnpm.",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 95,
    mentionCount: 2,
    publishedAt: "2026-03-11T19:00:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    scoringSignals: {
      recencyHours: 2,
      githubStars: 4250,
      githubActivity: 92,
      socialEngagement: 275,
    },
  });

  assert.equal(scoreGitHubStarsSignal(item), 77);
  assert.equal(scoreGitHubActivitySignal(item), 92);
  assert.equal(scoreGitHubSignal(item), 83);
  assert.equal(scoreSocialEngagementSignal(item), 81);
});

test("signal input extraction and normalization preserve stable item-level values", () => {
  const item = createNormalizedItem({
    name: "open-agent-platform",
    sourceUrl: "https://github.com/acme/open-agent-platform",
    category: "library",
    summary: "Framework for agent orchestration with tracing and memory.",
    integrationHint: "Install with npm or pnpm.",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 95,
    mentionCount: 2,
    publishedAt: "2026-03-11T19:00:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    scoringSignals: {
      recencyHours: 2,
      githubStars: 4250,
      githubActivity: 92,
      socialEngagement: 275,
    },
  });

  assert.deepEqual(extractRelevanceSignalInputs(item), {
    recencyHours: 2,
    mentionCount: 2,
    githubStars: 4250,
    githubActivity: 92,
    socialEngagement: 275,
  });
  assert.deepEqual(normalizeRelevanceSignalInputs(item), {
    recency: 94,
    mentionFrequency: 50,
    githubStars: 77,
    githubActivity: 92,
    socialEngagement: 81,
  });
});

test("GitHub scoring supports configurable weighting between stars and activity", () => {
  const item = createNormalizedItem({
    name: "open-agent-platform",
    sourceUrl: "https://github.com/acme/open-agent-platform",
    category: "library",
    summary: "Framework for agent orchestration with tracing and memory.",
    integrationHint: "Install with npm or pnpm.",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 95,
    mentionCount: 2,
    discoveredAt: "2026-03-11T21:00:00Z",
    scoringSignals: {
      githubStars: 50000,
      githubActivity: 10,
    },
  });

  assert.equal(scoreGitHubSignal(item), 64);
  assert.equal(
    scoreItemRelevance(item, null, {
      weights: {
        recency: 0,
        sourceAuthority: 0,
        mentionFrequency: 0,
        github: 1,
        socialEngagement: 0,
      },
      githubSignalWeights: {
        stars: 0.1,
        activity: 0.9,
      },
    }),
    19,
  );
});

test("source authority scoring honors an explicit normalized authority override", () => {
  const item = createNormalizedItem({
    name: "Probationary Agent Docs",
    sourceUrl: "https://docs.example.com/agent-runtime/install",
    category: "tool",
    summary: "Installation guide from a probationary-but-approved source.",
    integrationHint: "Validate the docs before automating the setup path.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 78,
    discoveredAt: "2026-03-11T21:00:00Z",
    scoringSignals: {
      sourceAuthority: 59,
    },
  });

  assert.equal(item.sourceAuthorityScore, 78);
  assert.equal(item.scoringSignals.sourceAuthority, 59);
  assert.equal(scoreSourceAuthoritySignal(item), 59);
  assert.equal(normalizeRelevanceSignals(item).sourceAuthority, 59);
});

test("config resolution keeps explicit non-negative overrides and falls back on invalid values", () => {
  assert.deepEqual(
    resolveRelevanceScoringConfig({
      scoreVersion: "2.1.0",
      recencyHalfLifeHours: 12,
      recencyMaxAgeHours: Number.POSITIVE_INFINITY,
      mentionCountSaturation: -1,
      githubStarsSaturation: 10_000,
      githubStarsTodaySaturation: NaN,
      socialEngagementSaturation: 500,
      githubSignalWeights: {
        stars: 0,
        activity: -1,
      },
      weights: {
        recency: 0,
        sourceAuthority: -1,
        mentionFrequency: 0.5,
        github: Number.NaN,
        socialEngagement: 0.25,
      },
    }),
    {
      scoreVersion: "2.1.0",
      scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
      scoreRange: DEFAULT_RELEVANCE_SCORE_RANGE,
      recencyHalfLifeHours: 12,
      recencyMaxAgeHours: 24 * 7,
      mentionCountSaturation: 8,
      githubStarsSaturation: 10_000,
      githubStarsTodaySaturation: 250,
      socialEngagementSaturation: 500,
      githubSignalWeights: {
        stars: 0,
        activity: 0.4,
      },
      weights: {
        recency: 0,
        sourceAuthority: 0.28,
        mentionFrequency: 0.5,
        github: 0.2,
        socialEngagement: 0.25,
      },
    },
  );
});

test("signal scorers fall back to raw item metadata when normalized fields are missing", () => {
  const item = {
    sourceUrl: "https://github.com/acme/open-agent-platform",
    sourceUrls: [
      "https://github.com/acme/open-agent-platform",
      "https://blog.example.com/open-agent-platform",
      "https://news.example.com/open-agent-platform",
    ],
    sourceKinds: ["github"],
    sourceAuthorityScore: 88,
    publishedAt: "2026-03-11T18:00:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    metrics: {
      upvotes: 125,
      comments: 14,
      shares: 0,
    },
    metadata: {
      github: {
        stars: 5000,
        starsToday: 120,
        pushedAt: "2026-03-11T15:00:00Z",
      },
    },
  };

  assert.equal(scoreRecencySignal(item), 92);
  assert.equal(scoreMentionFrequencySignal(item), 63);
  assert.equal(scoreGitHubActivitySignal(item), 86);
  assert.equal(scoreGitHubSignal(item), 82);
  assert.equal(scoreSocialEngagementSignal(item), 72);
  assert.deepEqual(normalizeRelevanceSignals(item), {
    recency: 92,
    sourceAuthority: 88,
    mentionFrequency: 63,
    github: 82,
    socialEngagement: 72,
  });
});

test("mention-frequency extraction counts distinct source clusters instead of raw source urls", () => {
  const item = {
    sourceUrl: "https://docs.example.com/open-agent-platform",
    sourceUrls: [
      "https://docs.example.com/open-agent-platform",
      "https://docs.example.com/open-agent-platform/print",
      "https://twitter.com/builder/status/123",
      "https://x.com/builder/status/456",
    ],
    publishedAt: "2026-03-11T18:00:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    metrics: {
      upvotes: 125,
      comments: 14,
      shares: 0,
    },
    metadata: {
      github: {
        stars: 5000,
        starsToday: 120,
        pushedAt: "2026-03-11T15:00:00Z",
      },
    },
  };

  assert.deepEqual(extractRelevanceSignalInputs(item), {
    recencyHours: 3,
    mentionCount: 2,
    githubStars: 5000,
    githubActivity: 86,
    socialEngagement: 139,
  });
  assert.deepEqual(normalizeRelevanceSignalInputs(item), {
    recency: 92,
    mentionFrequency: 50,
    githubStars: 79,
    githubActivity: 86,
    socialEngagement: 72,
  });
  assert.equal(scoreMentionFrequencySignal(item), 50);
});

test("stale GitHub metadata still counts as an observed signal in the composite score", () => {
  const item = createNormalizedItem({
    name: "Dormant Agent Repo",
    sourceUrl: "https://github.com/acme/dormant-agent-repo",
    category: "library",
    summary: "A dormant repository with strong source authority but no fresh activity.",
    integrationHint: "Review maintenance status before depending on it.",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 90,
    mentionCount: 1,
    discoveredAt: "2026-03-11T21:00:00Z",
    metadata: {
      github: {
        stars: 0,
        starsToday: 0,
        pushedAt: "2026-03-01T21:00:00Z",
      },
    },
  });

  assert.equal(scoreGitHubSignal(item), 0);
  assert.equal(
    scoreItemRelevance(item, null, {
      weights: {
        recency: 0,
        sourceAuthority: 0.5,
        mentionFrequency: 0,
        github: 0.5,
        socialEngagement: 0,
      },
    }),
    45,
  );
});

test("relevance score version history documents the active scoring formula", () => {
  const entry = getRelevanceScoreVersionHistoryEntry();

  assert.equal(entry.version, DEFAULT_RELEVANCE_SCORE_VERSION);
  assert.equal(entry, CURRENT_RELEVANCE_SCORE_VERSION_ENTRY);
  assert.equal(RELEVANCE_SCORE_VERSION_HISTORY.includes(entry), true);
  assert.equal(entry.scoreInterpretation, DEFAULT_RELEVANCE_SCORE_INTERPRETATION);
  assert.deepEqual(entry.scoreRange, DEFAULT_RELEVANCE_SCORE_RANGE);
  assert.equal(entry.formula.length > 0, true);
  assert.equal(entry.weightingPolicy.length > 0, true);
  assert.equal(entry.rationale.length > 0, true);
  assert.equal(entry.minimumPublishedScore, DEFAULT_MIN_RELEVANCE_SCORE);
  assert.deepEqual(
    Object.fromEntries(entry.fields.map((field) => [field.name, field.weight])),
    DEFAULT_RELEVANCE_SCORING_CONFIG.weights,
  );
  assert.equal(
    entry.fields
      .find((field) => field.name === "recency")
      .rules.includes("Use a 24-hour half-life."),
    true,
  );
  assert.equal(
    entry.rules.some((rule) => rule.name === "publication-threshold"),
    true,
  );
  assert.deepEqual(
    Object.fromEntries(entry.factors.map((factor) => [factor.name, factor.weight])),
    DEFAULT_RELEVANCE_SCORING_CONFIG.weights,
  );
  assert.equal(
    entry.factors.find((factor) => factor.name === "recency").details.includes("24-hour"),
    true,
  );
  assert.equal(
    entry.factors
      .find((factor) => factor.name === "github")
      .details.includes(String(DEFAULT_RELEVANCE_SCORING_CONFIG.githubSignalWeights.stars)),
    true,
  );
});

test("relevance score version history lookup returns null for unknown versions", () => {
  assert.equal(getRelevanceScoreVersionHistoryEntry("9.9.9"), null);
});

test("weighted relevance scorer produces a stable composite score for normalized items", async () => {
  const item = createNormalizedItem({
    name: "open-agent-platform",
    sourceUrl: "https://github.com/acme/open-agent-platform",
    category: "library",
    summary: "Framework for agent orchestration with tracing and memory.",
    integrationHint: "Install with npm or pnpm.",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 95,
    mentionCount: 2,
    publishedAt: "2026-03-11T19:00:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    scoringSignals: {
      recencyHours: 2,
      githubStars: 4250,
      githubActivity: 92,
      socialEngagement: 275,
    },
  });

  assert.equal(scoreItemRelevance(item), 83);

  const scorer = createWeightedRelevanceScorer();

  assert.deepEqual(await scorer(item), {
    score: 83,
    relevanceScore: 83,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
    scoreBreakdown: createRelevanceScoreBreakdown(item),
  });
  assert.equal(scorer.scoreInterpretation, DEFAULT_RELEVANCE_SCORE_INTERPRETATION);
  assert.deepEqual(scorer.scoreRange, DEFAULT_RELEVANCE_SCORE_RANGE);
});

test("weighted relevance scorer exposes the score breakdown used to compute the composite", () => {
  const item = createNormalizedItem({
    name: "open-agent-platform",
    sourceUrl: "https://github.com/acme/open-agent-platform",
    category: "library",
    summary: "Framework for agent orchestration with tracing and memory.",
    integrationHint: "Install with npm or pnpm.",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 95,
    mentionCount: 2,
    publishedAt: "2026-03-11T19:00:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    scoringSignals: {
      recencyHours: 2,
      githubStars: 4250,
      githubActivity: 92,
      socialEngagement: 275,
    },
  });
  const scorer = createWeightedRelevanceScorer();

  assert.deepEqual(scorer.getBreakdown(item), createRelevanceScoreBreakdown(item));
});

test("score breakdown reports normalized signals and applied weights for observed data", () => {
  const item = createNormalizedItem({
    name: "Signal Sparse Toolkit",
    sourceUrl: "https://example.com/signal-sparse-toolkit",
    category: "tool",
    summary: "Sparse metadata with clear authority and mention counts.",
    integrationHint: "Inspect the docs before adoption.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 80,
    mentionCount: 4,
    discoveredAt: "2026-03-11T21:00:00Z",
  });

  assert.deepEqual(createRelevanceScoreBreakdown(item), {
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
    score: 77,
    divergenceFlag: false,
    signals: {
      recency: 0,
      sourceAuthority: 80,
      mentionFrequency: 73,
      github: 0,
      socialEngagement: 0,
    },
    observedSignals: {
      recency: false,
      sourceAuthority: true,
      mentionFrequency: true,
      github: false,
      socialEngagement: false,
    },
    configuredWeights: {
      recency: 0.24,
      sourceAuthority: 0.28,
      mentionFrequency: 0.18,
      github: 0.2,
      socialEngagement: 0.1,
    },
    appliedWeights: {
      recency: 0,
      sourceAuthority: 0.28,
      mentionFrequency: 0.18,
      github: 0,
      socialEngagement: 0,
    },
    effectiveWeights: {
      recency: 0,
      sourceAuthority: 0.6087,
      mentionFrequency: 0.3913,
      github: 0,
      socialEngagement: 0,
    },
  });
});

test("high sentiment divergence is flagged for contested source sentiment", () => {
  const contestedItem = buildScoreableItem({
    sentimentSpread: {
      classification: "mixed",
      disagreementDimension: "utility",
    },
  });

  assert.equal(hasHighSentimentDivergence(contestedItem), true);
  assert.equal(createRelevanceScoreBreakdown(contestedItem).divergenceFlag, true);
});

test("score breakdown falls back to the default score version when overrides are invalid", () => {
  assert.equal(
    createRelevanceScoreBreakdown(buildScoreableItem(), null, {
      scoreVersion: "   ",
    }).scoreVersion,
    DEFAULT_RELEVANCE_SCORE_VERSION,
  );
});

test("normalized items without a supplied authority signal omit authority from applied weights", () => {
  const item = createNormalizedItem({
    name: "Sparse Agent Notes",
    sourceUrl: "https://example.com/sparse-agent-notes",
    category: "technique",
    summary: "Sparse scoring metadata without a provided authority signal.",
    integrationHint: "Validate the source before using it for automation decisions.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    scoringSignals: {
      recencyHours: 4,
      socialEngagement: 100,
    },
  });

  assert.equal(item.sourceAuthorityScore, 0);
  assert.equal(item.scoringSignals.sourceAuthority, null);
  assert.deepEqual(createRelevanceScoreBreakdown(item).observedSignals, {
    recency: true,
    sourceAuthority: false,
    mentionFrequency: true,
    github: false,
    socialEngagement: true,
  });
  assert.equal(scoreItemRelevance(item), 65);
});

test("weighted relevance scores rank stronger curated items ahead of weaker ones", () => {
  const breakoutItem = buildScoreableItem({
    name: "Agent Control Plane",
    sourceUrl: "https://example.com/agent-control-plane",
    sourceAuthorityScore: 96,
    mentionCount: 6,
    publishedAt: "2026-03-11T20:00:00Z",
    scoringSignals: {
      recencyHours: 1,
      socialEngagement: 300,
    },
  });
  const steadyItem = buildScoreableItem({
    name: "Agent Debugging Notes",
    sourceUrl: "https://example.com/agent-debugging-notes",
    sourceAuthorityScore: 74,
    mentionCount: 3,
    publishedAt: "2026-03-11T09:00:00Z",
    scoringSignals: {
      recencyHours: 12,
      socialEngagement: 200,
    },
  });
  const lowSignalItem = buildScoreableItem({
    name: "Old Agent Post",
    sourceUrl: "https://example.com/old-agent-post",
    sourceAuthorityScore: 52,
    mentionCount: 1,
    publishedAt: "2026-03-07T21:00:00Z",
    scoringSignals: {
      recencyHours: 96,
      socialEngagement: 5,
    },
  });

  const scoredItems = [breakoutItem, steadyItem, lowSignalItem].map((item) => ({
    ...item,
    relevanceScore: scoreItemRelevance(item),
  }));

  assert.deepEqual(
    scoredItems.map((item) => item.relevanceScore),
    [93, 71, 30],
  );
  assert.deepEqual(
    sortCuratedItemsByRelevance(scoredItems).map((item) => item.name),
    ["Agent Control Plane", "Agent Debugging Notes", "Old Agent Post"],
  );
});

test("representative newsletter items receive stable composite scores across categories", () => {
  const {
    libraryRelease,
    apiLaunch,
    researchTechnique,
    viralToolAnnouncement,
  } = buildRepresentativeNewsletterItems();

  assert.deepEqual(
    [
      [libraryRelease.name, scoreItemRelevance(libraryRelease)],
      [apiLaunch.name, scoreItemRelevance(apiLaunch)],
      [researchTechnique.name, scoreItemRelevance(researchTechnique)],
      [viralToolAnnouncement.name, scoreItemRelevance(viralToolAnnouncement)],
    ],
    [
      ["Open Agent Runtime 2.0", 89],
      ["Agent Memory API", 80],
      ["Planner-Critic Loops for Agents", 73],
      ["Sandboxed Agent Console", 57],
    ],
  );
});

test("representative newsletter ranking keeps corroborated releases ahead of viral low-authority announcements", () => {
  const {
    libraryRelease,
    apiLaunch,
    researchTechnique,
    viralToolAnnouncement,
  } = buildRepresentativeNewsletterItems();
  const scoredItems = [
    libraryRelease,
    apiLaunch,
    researchTechnique,
    viralToolAnnouncement,
  ].map((item) => ({
    ...item,
    relevanceScore: scoreItemRelevance(item),
  }));

  assert.deepEqual(
    filterCuratedItemsByRelevance(sortCuratedItemsByRelevance(scoredItems)).map((item) => [
      item.name,
      item.relevanceScore,
    ]),
    [
      ["Open Agent Runtime 2.0", 89],
      ["Agent Memory API", 80],
      ["Planner-Critic Loops for Agents", 73],
    ],
  );
});

test("mention frequency ranking input is backfilled from corroborating source urls", () => {
  const singleSourceItem = {
    name: "Agent Registry",
    sourceUrl: "https://example.com/agent-registry",
    category: "tool",
    summary: "Registry of tools and runtimes for autonomous AI agents.",
    integrationHint: "Use the registry to identify candidate dependencies.",
    sourceAuthorityScore: 80,
    publishedAt: "2026-03-11T17:00:00Z",
    scoringSignals: {
      recencyHours: 4,
      socialEngagement: 120,
    },
  };
  const corroboratedItem = {
    name: "Agent Registry",
    sourceUrl: "https://example.com/agent-registry",
    sourceUrls: [
      "https://blog.example.com/agent-registry",
      "https://news.example.com/agent-registry",
      "https://x.com/builder/status/777",
    ],
    category: "tool",
    summary: "Registry of tools and runtimes for autonomous AI agents.",
    integrationHint: "Use the registry to identify candidate dependencies.",
    sourceAuthorityScore: 80,
    publishedAt: "2026-03-11T17:00:00Z",
    scoringSignals: {
      recencyHours: 4,
      socialEngagement: 120,
    },
  };

  assert.ok(scoreMentionFrequencySignal(corroboratedItem) > scoreMentionFrequencySignal(singleSourceItem));
  assert.ok(scoreItemRelevance(corroboratedItem) > scoreItemRelevance(singleSourceItem));
});

test("relevance weight overrides change the ranking emphasis predictably", () => {
  const authorityLedItem = buildScoreableItem({
    name: "Trusted Agent Release",
    sourceUrl: "https://example.com/trusted-agent-release",
    sourceAuthorityScore: 95,
    scoringSignals: {
      recencyHours: 6,
      socialEngagement: 10,
    },
  });
  const sociallyValidatedItem = buildScoreableItem({
    name: "Viral Agent Thread",
    sourceUrl: "https://example.com/viral-agent-thread",
    sourceAuthorityScore: 40,
    scoringSignals: {
      recencyHours: 6,
      socialEngagement: 900,
    },
  });
  const socialFirstWeights = {
    weights: {
      recency: 0.1,
      sourceAuthority: 0.05,
      mentionFrequency: 0.1,
      github: 0,
      socialEngagement: 0.75,
    },
  };

  assert.equal(scoreItemRelevance(authorityLedItem), 74);
  assert.equal(scoreItemRelevance(sociallyValidatedItem), 63);
  assert.equal(scoreItemRelevance(authorityLedItem, null, socialFirstWeights), 44);
  assert.equal(scoreItemRelevance(sociallyValidatedItem, null, socialFirstWeights), 89);
});

test("curation filter keeps only items meeting the 60-point relevance floor", () => {
  const belowFloorItem = buildScoreableItem({
    name: "Low-Signal Agent Repo",
    sourceUrl: "https://example.com/low-signal-agent-repo",
    relevanceScore: 59,
  });
  const atFloorItem = buildScoreableItem({
    name: "Floor Agent Repo",
    sourceUrl: "https://example.com/floor-agent-repo",
    relevanceScore: DEFAULT_MIN_RELEVANCE_SCORE,
  });
  const aboveFloorItem = buildScoreableItem({
    name: "High-Signal Agent Repo",
    sourceUrl: "https://example.com/high-signal-agent-repo",
    relevanceScore: 84,
  });

  assert.deepEqual(
    filterCuratedItemsByRelevance([belowFloorItem, atFloorItem, aboveFloorItem]).map(
      (item) => item.name,
    ),
    ["Floor Agent Repo", "High-Signal Agent Repo"],
  );
});

test("curated item ordering is deterministic across score ties", () => {
  const higherMentionCount = buildScoreableItem({
    name: "Beta Agents",
    sourceUrl: "https://example.com/beta-agents",
    sourceAuthorityScore: 70,
    mentionCount: 3,
    publishedAt: "2026-03-11T18:00:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    relevanceScore: 81,
  });
  const alphabeticTieBreaker = buildScoreableItem({
    name: "Alpha Agents",
    sourceUrl: "https://example.com/alpha-agents",
    sourceAuthorityScore: 70,
    mentionCount: 2,
    publishedAt: "2026-03-11T18:00:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    relevanceScore: 81,
  });
  const urlTieBreaker = buildScoreableItem({
    name: "Alpha Agents",
    sourceUrl: "https://example.com/zeta-alpha-agents",
    sourceAuthorityScore: 70,
    mentionCount: 2,
    publishedAt: "2026-03-11T18:00:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    relevanceScore: 81,
  });

  assert.ok(compareCuratedItemsByRelevance(higherMentionCount, alphabeticTieBreaker) < 0);
  assert.ok(compareCuratedItemsByRelevance(alphabeticTieBreaker, urlTieBreaker) < 0);
  assert.deepEqual(
    sortCuratedItemsByRelevance([
      urlTieBreaker,
      higherMentionCount,
      alphabeticTieBreaker,
    ]).map((item) => item.sourceUrl),
    [
      "https://example.com/beta-agents",
      "https://example.com/alpha-agents",
      "https://example.com/zeta-alpha-agents",
    ],
  );
});

test("curated item ordering always prefers higher relevance before downstream tie breakers", () => {
  const higherRelevance = buildScoreableItem({
    name: "Zulu Agents",
    sourceUrl: "https://example.com/zulu-agents",
    sourceAuthorityScore: 40,
    mentionCount: 1,
    publishedAt: "2026-03-10T18:00:00Z",
    discoveredAt: "2026-03-10T20:00:00Z",
    relevanceScore: 82,
  });
  const lowerRelevanceButStrongerMetadata = buildScoreableItem({
    name: "Alpha Agents",
    sourceUrl: "https://example.com/alpha-agents-primary",
    sourceAuthorityScore: 99,
    mentionCount: 8,
    publishedAt: "2026-03-11T20:00:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    relevanceScore: 81,
  });

  assert.ok(compareCuratedItemsByRelevance(higherRelevance, lowerRelevanceButStrongerMetadata) < 0);
  assert.deepEqual(
    sortCuratedItemsByRelevance([lowerRelevanceButStrongerMetadata, higherRelevance]).map(
      (item) => item.name,
    ),
    ["Zulu Agents", "Alpha Agents"],
  );
});

test("curated item ordering walks the full tie-break ladder after relevance score", () => {
  const higherAuthority = buildScoreableItem({
    name: "Gamma Agents",
    sourceUrl: "https://example.com/gamma-agents-authority",
    sourceAuthorityScore: 80,
    mentionCount: 1,
    publishedAt: "2026-03-11T18:00:00Z",
    discoveredAt: "2026-03-11T20:00:00Z",
    relevanceScore: 81,
  });
  const higherMentionCount = buildScoreableItem({
    name: "Gamma Agents",
    sourceUrl: "https://example.com/gamma-agents-mentions",
    sourceAuthorityScore: 70,
    mentionCount: 3,
    publishedAt: "2026-03-11T18:00:00Z",
    discoveredAt: "2026-03-11T20:00:00Z",
    relevanceScore: 81,
  });
  const newerPublished = buildScoreableItem({
    name: "Gamma Agents",
    sourceUrl: "https://example.com/gamma-agents-published",
    sourceAuthorityScore: 70,
    mentionCount: 2,
    publishedAt: "2026-03-11T20:00:00Z",
    discoveredAt: "2026-03-11T20:00:00Z",
    relevanceScore: 81,
  });
  const newerDiscovered = buildScoreableItem({
    name: "Gamma Agents",
    sourceUrl: "https://example.com/gamma-agents-discovered",
    sourceAuthorityScore: 70,
    mentionCount: 2,
    publishedAt: "2026-03-11T18:00:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    relevanceScore: 81,
  });
  const alphabeticNameFirst = buildScoreableItem({
    name: "Alpha Agents",
    sourceUrl: "https://example.com/alpha-agents",
    sourceAuthorityScore: 70,
    mentionCount: 2,
    publishedAt: "2026-03-11T18:00:00Z",
    discoveredAt: "2026-03-11T20:00:00Z",
    relevanceScore: 81,
  });
  const urlTieBreaker = buildScoreableItem({
    name: "Alpha Agents",
    sourceUrl: "https://example.com/zeta-alpha-agents",
    sourceAuthorityScore: 70,
    mentionCount: 2,
    publishedAt: "2026-03-11T18:00:00Z",
    discoveredAt: "2026-03-11T20:00:00Z",
    relevanceScore: 81,
  });
  const alphabeticNameLast = buildScoreableItem({
    name: "Beta Agents",
    sourceUrl: "https://example.com/beta-agents-name",
    sourceAuthorityScore: 70,
    mentionCount: 2,
    publishedAt: "2026-03-11T18:00:00Z",
    discoveredAt: "2026-03-11T20:00:00Z",
    relevanceScore: 81,
  });

  assert.ok(compareCuratedItemsByRelevance(higherAuthority, higherMentionCount) < 0);
  assert.ok(compareCuratedItemsByRelevance(higherMentionCount, newerPublished) < 0);
  assert.ok(compareCuratedItemsByRelevance(newerPublished, newerDiscovered) < 0);
  assert.ok(compareCuratedItemsByRelevance(newerDiscovered, alphabeticNameFirst) < 0);
  assert.ok(compareCuratedItemsByRelevance(alphabeticNameFirst, urlTieBreaker) < 0);
  assert.ok(compareCuratedItemsByRelevance(urlTieBreaker, alphabeticNameLast) < 0);
  assert.deepEqual(
    sortCuratedItemsByRelevance([
      alphabeticNameLast,
      urlTieBreaker,
      higherMentionCount,
      newerDiscovered,
      newerPublished,
      alphabeticNameFirst,
      higherAuthority,
    ]).map((item) => item.sourceUrl),
    [
      "https://example.com/gamma-agents-authority",
      "https://example.com/gamma-agents-mentions",
      "https://example.com/gamma-agents-published",
      "https://example.com/gamma-agents-discovered",
      "https://example.com/alpha-agents",
      "https://example.com/zeta-alpha-agents",
      "https://example.com/beta-agents-name",
    ],
  );
});
