import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  NewsletterEditionStore,
} from "../src/index.js";

test("NewsletterEditionStore persists derived sentiment spread on published editions", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  await store.publish({
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        name: "Agent Runtime",
        sourceUrl: "https://github.com/acme/agent-runtime",
        category: "library",
        summary: "Runtime for tool-using agents.",
        integrationHint: "npm install agent-runtime",
        relevanceScore: 82,
        sourceSentiment: "positive",
        sourceKinds: ["github"],
        adapterIds: ["github"],
        sourceAuthorityScore: 92,
        discoveredAt: "2026-03-12T20:30:00.000Z",
      },
    ],
  });

  const raw = JSON.parse(
    await readFile(join(directoryPath, "2026-03-12.json"), "utf8"),
  );

  assert.deepEqual(raw.exclusionSummary, {
    totalExcludedItems: 0,
    countsByCategory: [],
    countsByReasonCode: [],
    countsByCategoryAndReason: [],
  });
  assert.equal(raw.items[0].sourceSentiment, "positive");
  assert.deepEqual(raw.items[0].sentimentSpread, {
    classification: "agree",
  });
  assert.equal(raw.items[0].itemId, "artifact-github-com-acme-agent-runtime");
  assert.equal(raw.items[0].firstSeen, "2026-03-12T20:30:00.000Z");
  assert.equal(raw.items[0].editionCount, 1);
  assert.equal(
    raw.items[0].scopeVersion,
    CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
  );
  assert.deepEqual(raw.items[0].canonicalIdentifiers, {
    entityName: "Agent Runtime",
    repositoryUrl: "https://github.com/acme/agent-runtime",
    doi: null,
    sourceIds: {
      github: "acme/agent-runtime",
    },
  });
  assert.deepEqual(raw.items[0].metadata.sourceSentiments, [
    {
      sourceUrl: "https://github.com/acme/agent-runtime",
      sentiment: "positive",
    },
  ]);
});

test("NewsletterEditionStore persists relevance score provenance on stored items", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  await store.publish({
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        name: "Agent Runtime",
        sourceUrl: "https://github.com/acme/agent-runtime",
        category: "library",
        summary: "Runtime for tool-using agents.",
        integrationHint: "npm install agent-runtime",
        relevanceScore: 87,
        scoreVersion: "2.1.0",
        sourceKinds: ["github"],
        adapterIds: ["github"],
        sourceAuthorityScore: 92,
        discoveredAt: "2026-03-12T20:30:00.000Z",
      },
    ],
  });

  const raw = JSON.parse(
    await readFile(join(directoryPath, "2026-03-12.json"), "utf8"),
  );

  assert.equal(raw.items[0].relevanceScore, 87);
  assert.equal(raw.items[0].scoreVersion, "2.1.0");
  assert.equal(raw.items[0].divergenceFlag, false);
  assert.equal(raw.items[0].metadata.scoring.relevanceScore, 87);
  assert.equal(raw.items[0].metadata.scoring.scoreVersion, "2.1.0");
  assert.equal(raw.items[0].metadata.scoring.divergenceFlag, false);
});

test("NewsletterEditionStore persists exclusion records with identity, context, reason, and timestamp", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  await store.publish({
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [],
    exclusions: [
      {
        itemIdentity: {
          id: "artifact-github-com-example-low-signal-agent",
          itemId: "artifact-github-com-example-low-signal-agent",
          name: "Low-Signal Agent Repo",
          sourceUrl: "https://github.com/example/low-signal-agent",
          sourceUrls: ["https://github.com/example/low-signal-agent"],
          canonicalIdentifiers: {
            entityName: "Low Signal Agent Repo",
            repositoryUrl: "https://github.com/example/low-signal-agent",
            doi: null,
            sourceIds: {
              github: "example/low-signal-agent",
            },
          },
        },
        itemId: "artifact-github-com-example-low-signal-agent",
        name: "Low-Signal Agent Repo",
        sourceUrl: "https://github.com/example/low-signal-agent",
        category: "tool",
        exclusionReasonCode: "relevance_below_threshold",
        reasonCode: "relevance_below_threshold",
        timestamp: "2026-03-12T21:00:00.000Z",
        evaluationContext: {
          stage: "relevance_gate",
          window: {
            startsAt: "2026-03-11T21:00:00.000Z",
            endsAt: "2026-03-12T21:00:00.000Z",
            timezone: "UTC",
          },
          relevance: {
            minRelevanceScore: 60,
            relevanceScore: 59,
            scoreVersion: "1.0.0",
            scoreBreakdown: {
              score: 59,
              scoreVersion: "1.0.0",
              divergenceFlag: false,
            },
          },
        },
        sourceKinds: ["github"],
        adapterIds: ["github"],
        reason: "relevance_below_threshold",
        phase: "scoring",
        relevanceScore: 59,
        minRelevanceScore: 60,
        scoreVersion: "1.0.0",
        sourceAuthorityScore: 95,
      },
    ],
  });

  const latest = await store.loadLatest({
    now: "2026-03-12T21:30:00.000Z",
  });
  const raw = JSON.parse(
    await readFile(join(directoryPath, "2026-03-12.json"), "utf8"),
  );

  assert.equal(raw.exclusions.length, 1);
  assert.deepEqual(latest?.exclusions, raw.exclusions);
  assert.deepEqual(raw.exclusions[0].itemIdentity, {
    id: "artifact-github-com-example-low-signal-agent",
    itemId: "artifact-github-com-example-low-signal-agent",
    name: "Low-Signal Agent Repo",
    sourceUrl: "https://github.com/example/low-signal-agent",
    sourceUrls: ["https://github.com/example/low-signal-agent"],
    canonicalIdentifiers: {
      entityName: "Low Signal Agent Repo",
      repositoryUrl: "https://github.com/example/low-signal-agent",
      doi: null,
      sourceIds: {
        github: "example/low-signal-agent",
      },
    },
  });
  assert.equal(raw.exclusions[0].category, "tool");
  assert.equal(raw.exclusions[0].exclusionReasonCode, "relevance_below_threshold");
  assert.equal(raw.exclusions[0].timestamp, "2026-03-12T21:00:00.000Z");
  assert.deepEqual(raw.exclusions[0].evaluationContext, {
    stage: "relevance_gate",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    relevance: {
      minRelevanceScore: 60,
      relevanceScore: 59,
      scoreVersion: "1.0.0",
      scoreBreakdown: {
        score: 59,
        scoreVersion: "1.0.0",
        divergenceFlag: false,
      },
    },
  });
  assert.deepEqual(raw.exclusions[0].editionContext, {
    editionId: "2026-03-12",
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
  });
});

test("NewsletterEditionStore makes source-gate exclusion logs queryable by phase, source kind, adapter, and item id", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  await store.publish({
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [],
    exclusions: [
      {
        itemIdentity: {
          id: "artifact-unknown-agent-sdk",
          itemId: "artifact-unknown-agent-sdk",
          name: "Unknown Agent SDK",
          sourceUrl: "https://unknown.example.com/post",
          sourceUrls: ["https://unknown.example.com/post"],
          canonicalIdentifiers: null,
        },
        itemId: "artifact-unknown-agent-sdk",
        name: "Unknown Agent SDK",
        sourceUrl: "https://unknown.example.com/post",
        category: "library",
        exclusionReasonCode: "source_not_approved",
        reasonCode: "source_not_approved",
        timestamp: "2026-03-12T21:00:00.000Z",
        evaluationContext: {
          stage: "source_gate",
          source: {
            sourceId: "web:domain:unknown.example.com",
            sourceStatus: "candidate",
            sourceLifecycleState: "probation",
            requiresSourceApproval: true,
            minimumItemAuthorityScore: 50,
            sourceAuthorityScore: 47,
            weightedSourceAuthorityScore: 24,
          },
        },
        sourceKinds: ["web"],
        adapterIds: ["web-discovery"],
        reason: "source_not_approved",
        phase: "source",
        relevanceScore: null,
        minRelevanceScore: null,
        scoreVersion: null,
        sourceAuthorityScore: 47,
        minSourceAuthorityScore: 50,
        sourceStatus: "candidate",
        sourceLifecycleState: "probation",
      },
      {
        itemIdentity: {
          id: "artifact-github-com-acme-agent-runtime-lite",
          itemId: "artifact-github-com-acme-agent-runtime-lite",
          name: "Agent Runtime Lite",
          sourceUrl: "https://github.com/acme/agent-runtime-lite",
          sourceUrls: ["https://github.com/acme/agent-runtime-lite"],
          canonicalIdentifiers: null,
        },
        itemId: "artifact-github-com-acme-agent-runtime-lite",
        name: "Agent Runtime Lite",
        sourceUrl: "https://github.com/acme/agent-runtime-lite",
        category: "library",
        exclusionReasonCode: "relevance_below_threshold",
        reasonCode: "relevance_below_threshold",
        timestamp: "2026-03-12T21:00:00.000Z",
        evaluationContext: {
          stage: "relevance_gate",
        },
        sourceKinds: ["github"],
        adapterIds: ["github"],
        reason: "relevance_below_threshold",
        phase: "scoring",
        relevanceScore: 58,
        minRelevanceScore: 60,
        scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        sourceAuthorityScore: 88,
      },
    ],
  });

  const analytics = await store.loadExclusionAnalytics({
    now: "2026-03-12T21:30:00.000Z",
    phase: "source",
    sourceKind: "web",
    adapterId: "web-discovery",
    itemId: "artifact-unknown-agent-sdk",
  });

  assert.deepEqual(analytics.filters, {
    publishedFrom: "2026-03-05T21:30:00.000Z",
    publishedTo: "2026-03-12T21:30:00.000Z",
    reason: null,
    category: null,
    sourceKind: "web",
    adapterId: "web-discovery",
    itemId: "artifact-unknown-agent-sdk",
    phase: "source",
    minRecurringEditions: 2,
  });
  assert.deepEqual(analytics.totals, {
    scannedEditionCount: 1,
    matchedEditionCount: 1,
    exclusionCount: 1,
    distinctItemCount: 1,
    recurringItemCount: 0,
    blindSpotCount: 0,
  });
  assert.equal(analytics.exclusions.length, 1);
  assert.deepEqual(analytics.exclusions[0], {
    editionId: "2026-03-12",
    publishedAt: "2026-03-12T21:00:00.000Z",
    editionContext: {
      editionId: "2026-03-12",
      publishedAt: "2026-03-12T21:00:00.000Z",
      window: {
        startsAt: "2026-03-11T21:00:00.000Z",
        endsAt: "2026-03-12T21:00:00.000Z",
        timezone: "UTC",
      },
    },
    itemIdentity: {
      id: "artifact-unknown-agent-sdk",
      itemId: "artifact-unknown-agent-sdk",
      name: "Unknown Agent SDK",
      sourceUrl: "https://unknown.example.com/post",
      sourceUrls: ["https://unknown.example.com/post"],
      canonicalIdentifiers: null,
    },
    itemId: "artifact-unknown-agent-sdk",
    name: "Unknown Agent SDK",
    sourceUrl: "https://unknown.example.com/post",
    category: "library",
    exclusionReasonCode: "source_not_approved",
    reasonCode: "source_not_approved",
    timestamp: "2026-03-12T21:00:00.000Z",
    evaluationContext: {
      stage: "source_gate",
      source: {
        sourceId: "web:domain:unknown.example.com",
        sourceStatus: "candidate",
        sourceLifecycleState: "probation",
        requiresSourceApproval: true,
        minimumItemAuthorityScore: 50,
        sourceAuthorityScore: 47,
        weightedSourceAuthorityScore: 24,
      },
    },
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    reason: "source_not_approved",
    phase: "source",
    relevanceScore: null,
    minRelevanceScore: null,
    scoreVersion: null,
    sourceAuthorityScore: 47,
    minSourceAuthorityScore: 50,
    sourceStatus: "candidate",
    sourceLifecycleState: "probation",
  });
});

test("NewsletterEditionStore persists contested sentiment spread dimensions for canonical items", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  await store.publish({
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        name: "Agent Guard",
        sourceUrl: "https://github.com/acme/agent-guard",
        sourceUrls: [
          "https://github.com/acme/agent-guard",
          "https://audit.example.com/agent-guard",
        ],
        category: "library",
        summary: "Agent Guard hardens runtime isolation for agent workloads.",
        integrationHint: "Review the audit before enabling the default policies.",
        relevanceScore: 80,
        sourceSentiment: "positive",
        sourceKinds: ["github", "web"],
        adapterIds: ["github", "web-discovery"],
        sourceAuthorityScore: 92,
        discoveredAt: "2026-03-12T20:30:00.000Z",
        metadata: {
          sourceSentiments: [
            {
              sourceUrl: "https://github.com/acme/agent-guard",
              sentiment: "positive",
              disagreementDimension: "security",
            },
            {
              sourceUrl: "https://github.com/acme/agent-guard",
              sentiment: "positive",
            },
            {
              sourceUrl: "https://audit.example.com/agent-guard",
              sentiment: "negative",
            },
          ],
        },
      },
    ],
  });

  const raw = JSON.parse(
    await readFile(join(directoryPath, "2026-03-12.json"), "utf8"),
  );

  assert.deepEqual(raw.items[0].sentimentSpread, {
    classification: "disagree",
    disagreementDimension: "security",
  });
  assert.deepEqual(raw.items[0].metadata.sourceSentiments, [
    {
      sourceUrl: "https://github.com/acme/agent-guard",
      sentiment: "positive",
      disagreementDimension: "security",
    },
    {
      sourceUrl: "https://audit.example.com/agent-guard",
      sentiment: "negative",
      disagreementDimension: "security",
    },
  ]);
});

test("NewsletterEditionStore preserves stored storyline relationship metadata", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  await store.publish({
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        itemId: "persistent-agent-sdk-item",
        name: "Persistent Agent SDK",
        sourceUrl: "https://github.com/acme/agent-sdk",
        category: "library",
        summary: "Agent SDK now adds evaluation loops and resumable memory.",
        integrationHint: "Upgrade and enable the evaluation and memory modules.",
        relevanceScore: 84,
        sourceKinds: ["github"],
        adapterIds: ["github"],
        sourceAuthorityScore: 92,
        discoveredAt: "2026-03-12T20:30:00.000Z",
        metadata: {
          storyline: {
            storylineId: "storyline-persistent-agent-sdk-item",
            position: 2,
            relationship: {
              decision: "evolution",
              explanation:
                "Introduces 2 novel fact clauses with 50% novel tokens across 1 prior appearance.",
              priorAppearanceCount: 1,
              previousAppearance: {
                editionId: "2026-03-11",
                publishedAt: "2026-03-11T21:00:00.000Z",
                sourceUrl: "https://github.com/acme/agent-sdk",
              },
              signals: {
                factOverlapRatio: 0.4,
                novelFactCount: 2,
                novelTokenRatio: 0.5,
                newSourceClusterCount: 0,
              },
            },
          },
        },
      },
    ],
  });

  const latest = await store.loadLatest({
    now: "2026-03-12T21:30:00.000Z",
  });
  const raw = JSON.parse(
    await readFile(join(directoryPath, "2026-03-12.json"), "utf8"),
  );

  assert.deepEqual(latest?.items[0].metadata.storyline, raw.items[0].metadata.storyline);
  assert.equal(raw.items[0].metadata.storyline.relationship.decision, "evolution");
  assert.equal(raw.items[0].metadata.storyline.position, 2);
});

test("NewsletterEditionStore persists storyline snapshots and item linkage fields", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  await store.publish({
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        itemId: "agent-runtime-v1",
        name: "Agent Runtime",
        sourceUrl: "https://github.com/acme/agent-runtime",
        category: "library",
        summary: "Runtime for tool-using agents.",
        integrationHint: "npm install agent-runtime",
        relevanceScore: 82,
        sourceKinds: ["github"],
        adapterIds: ["github"],
        sourceAuthorityScore: 92,
        discoveredAt: "2026-03-12T20:30:00.000Z",
        storylineId: "storyline-agent-runtime",
        storylineMemberPosition: 1,
      },
      {
        itemId: "agent-runtime-cloud",
        name: "Agent Runtime Cloud",
        sourceUrl: "https://acme.example.com/agent-runtime-cloud",
        category: "tool",
        summary: "Managed hosting for the Agent Runtime ecosystem.",
        integrationHint: "Review deployment docs before adoption.",
        relevanceScore: 78,
        sourceKinds: ["web"],
        adapterIds: ["web-discovery"],
        sourceAuthorityScore: 75,
        discoveredAt: "2026-03-12T20:45:00.000Z",
        storylineId: "storyline-agent-runtime",
        storylineMemberPosition: 2,
      },
    ],
    storylines: [
      {
        storylineId: "storyline-agent-runtime",
        title: "Agent Runtime expands from SDK to managed platform",
        memberItemIds: ["agent-runtime-v1", "agent-runtime-cloud"],
        parentStorylineIds: ["storyline-agent-runtime-sdk"],
        narrativeType: {
          key: "managed-hosting-expansion",
          label: "Managed hosting expansion",
          metadata: {
            focus: "deployment",
          },
        },
        status: "developing",
      },
    ],
  });

  const raw = JSON.parse(
    await readFile(join(directoryPath, "2026-03-12.json"), "utf8"),
  );
  const latestEdition = await store.loadLatest({
    now: "2026-03-12T21:30:00.000Z",
  });

  assert.deepEqual(raw.storylines, [
    {
      storylineId: "storyline-agent-runtime",
      title: "Agent Runtime expands from SDK to managed platform",
      memberItemIds: ["agent-runtime-v1", "agent-runtime-cloud"],
      parentStorylineIds: ["storyline-agent-runtime-sdk"],
      narrativeType: {
        key: "managed-hosting-expansion",
        label: "Managed hosting expansion",
        metadata: {
          focus: "deployment",
        },
      },
      status: "developing",
    },
  ]);
  assert.equal(raw.items[0].storylineId, "storyline-agent-runtime");
  assert.equal(raw.items[0].storylineMemberPosition, 1);
  assert.equal(raw.items[1].storylineId, "storyline-agent-runtime");
  assert.equal(raw.items[1].storylineMemberPosition, 2);
  assert.deepEqual(latestEdition?.storylines, raw.storylines);
});

test("NewsletterEditionStore persists edition exclusion summaries generated at finalization", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  await store.publish({
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    exclusionSummary: {
      totalExcludedItems: 3,
      countsByCategory: [
        {
          category: "tool",
          count: 1,
        },
        {
          category: "library",
          count: 2,
        },
      ],
      countsByReasonCode: [
        {
          reasonCode: "relevance_below_threshold",
          count: 1,
        },
        {
          reasonCode: "source_not_approved",
          count: 2,
        },
      ],
      countsByCategoryAndReason: [
        {
          category: "tool",
          reasonCode: "relevance_below_threshold",
          count: 1,
        },
        {
          category: "library",
          reasonCode: "source_not_approved",
          count: 2,
        },
      ],
    },
    items: [],
  });

  const latestEdition = await store.loadLatest({
    now: "2026-03-12T21:30:00.000Z",
  });
  const raw = JSON.parse(
    await readFile(join(directoryPath, "2026-03-12.json"), "utf8"),
  );

  assert.deepEqual(raw.exclusionSummary, {
    totalExcludedItems: 3,
    countsByCategory: [
      {
        category: "tool",
        count: 1,
      },
      {
        category: "library",
        count: 2,
      },
    ],
    countsByReasonCode: [
      {
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
      {
        reasonCode: "source_not_approved",
        count: 2,
      },
    ],
    countsByCategoryAndReason: [
      {
        category: "tool",
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
      {
        category: "library",
        reasonCode: "source_not_approved",
        count: 2,
      },
    ],
  });
  assert.deepEqual(latestEdition?.exclusionSummary, raw.exclusionSummary);
});

test("NewsletterEditionStore aggregates recurring exclusion patterns across editions", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  await store.publish({
    publishedAt: "2026-03-10T21:00:00.000Z",
    window: {
      startsAt: "2026-03-09T21:00:00.000Z",
      endsAt: "2026-03-10T21:00:00.000Z",
      timezone: "UTC",
    },
    exclusions: [
      {
        itemIdentity: {
          id: "artifact-github-com-acme-agent-runtime-lite",
          itemId: "artifact-github-com-acme-agent-runtime-lite",
          name: "Agent Runtime Lite",
          sourceUrl: "https://github.com/acme/agent-runtime-lite",
          sourceUrls: ["https://github.com/acme/agent-runtime-lite"],
          canonicalIdentifiers: null,
        },
        itemId: "artifact-github-com-acme-agent-runtime-lite",
        name: "Agent Runtime Lite",
        sourceUrl: "https://github.com/acme/agent-runtime-lite",
        category: "library",
        exclusionReasonCode: "relevance_below_threshold",
        reasonCode: "relevance_below_threshold",
        timestamp: "2026-03-10T21:00:00.000Z",
        evaluationContext: {
          stage: "relevance_gate",
        },
        sourceKinds: ["github"],
        adapterIds: ["github"],
        reason: "relevance_below_threshold",
        phase: "scoring",
        timestamp: "2026-03-10T21:00:00.000Z",
        relevanceScore: 58,
        minRelevanceScore: 60,
        scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        sourceAuthorityScore: 89,
      },
    ],
    items: [],
  });

  await store.publish({
    publishedAt: "2026-03-11T21:00:00.000Z",
    window: {
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
    exclusions: [
      {
        itemIdentity: {
          id: "artifact-github-com-acme-agent-runtime-lite",
          itemId: "artifact-github-com-acme-agent-runtime-lite",
          name: "Agent Runtime Lite",
          sourceUrl: "https://github.com/acme/agent-runtime-lite",
          sourceUrls: ["https://github.com/acme/agent-runtime-lite"],
          canonicalIdentifiers: null,
        },
        itemId: "artifact-github-com-acme-agent-runtime-lite",
        name: "Agent Runtime Lite",
        sourceUrl: "https://github.com/acme/agent-runtime-lite",
        category: "library",
        exclusionReasonCode: "relevance_below_threshold",
        reasonCode: "relevance_below_threshold",
        timestamp: "2026-03-11T21:00:00.000Z",
        evaluationContext: {
          stage: "relevance_gate",
        },
        sourceKinds: ["github"],
        adapterIds: ["github"],
        reason: "relevance_below_threshold",
        phase: "scoring",
        timestamp: "2026-03-11T21:00:00.000Z",
        relevanceScore: 55,
        minRelevanceScore: 60,
        scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        sourceAuthorityScore: 92,
      },
      {
        itemIdentity: {
          id: "artifact-github-com-acme-planning-kit-beta",
          itemId: "artifact-github-com-acme-planning-kit-beta",
          name: "Planning Kit Beta",
          sourceUrl: "https://github.com/acme/planning-kit-beta",
          sourceUrls: ["https://github.com/acme/planning-kit-beta"],
          canonicalIdentifiers: null,
        },
        itemId: "artifact-github-com-acme-planning-kit-beta",
        name: "Planning Kit Beta",
        sourceUrl: "https://github.com/acme/planning-kit-beta",
        category: "library",
        exclusionReasonCode: "relevance_below_threshold",
        reasonCode: "relevance_below_threshold",
        timestamp: "2026-03-11T21:00:00.000Z",
        evaluationContext: {
          stage: "relevance_gate",
        },
        sourceKinds: ["github"],
        adapterIds: ["github"],
        reason: "relevance_below_threshold",
        phase: "scoring",
        timestamp: "2026-03-11T21:00:00.000Z",
        relevanceScore: 52,
        minRelevanceScore: 60,
        scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        sourceAuthorityScore: 83,
      },
    ],
    items: [],
  });

  const analytics = await store.loadExclusionAnalytics({
    now: "2026-03-12T21:30:00.000Z",
    category: "library",
    reason: "relevance_below_threshold",
    minRecurringEditions: 2,
  });

  assert.deepEqual(analytics.totals, {
    scannedEditionCount: 2,
    matchedEditionCount: 2,
    exclusionCount: 3,
    distinctItemCount: 2,
    recurringItemCount: 1,
    blindSpotCount: 1,
  });
  assert.deepEqual(analytics.aggregations.sourceKinds, [
    {
      source_kind: "github",
      exclusionCount: 3,
      distinctItemCount: 2,
      editionCount: 2,
    },
  ]);
  assert.deepEqual(analytics.aggregations.categoryReasonCodes, [
    {
      category: "library",
      reasonCode: "relevance_below_threshold",
      exclusionCount: 3,
      distinctItemCount: 2,
      editionCount: 2,
      firstExcludedAt: "2026-03-10T21:00:00.000Z",
      lastExcludedAt: "2026-03-11T21:00:00.000Z",
    },
  ]);
  assert.deepEqual(analytics.aggregations.editions, [
    {
      editionId: "2026-03-11",
      publishedAt: "2026-03-11T21:00:00.000Z",
      exclusionCount: 2,
      distinctItemCount: 2,
    },
    {
      editionId: "2026-03-10",
      publishedAt: "2026-03-10T21:00:00.000Z",
      exclusionCount: 1,
      distinctItemCount: 1,
    },
  ]);
  assert.deepEqual(analytics.recurringItems, [
    {
      itemId: "artifact-github-com-acme-agent-runtime-lite",
      name: "Agent Runtime Lite",
      category: "library",
      exclusionCount: 2,
      editionCount: 2,
      reasons: ["relevance_below_threshold"],
      firstExcludedAt: "2026-03-10T21:00:00.000Z",
      lastExcludedAt: "2026-03-11T21:00:00.000Z",
    },
  ]);
  assert.deepEqual(analytics.blindSpots, [
    {
      blindSpotKey: "category:library|reason:relevance_below_threshold",
      category: "library",
      reason: "relevance_below_threshold",
      exclusionCount: 3,
      distinctItemCount: 2,
      editionCount: 2,
      firstExcludedAt: "2026-03-10T21:00:00.000Z",
      lastExcludedAt: "2026-03-11T21:00:00.000Z",
    },
  ]);

  const summary = await store.loadExclusionSummary({
    now: "2026-03-12T21:30:00.000Z",
    category: "library",
    reason: "relevance_below_threshold",
  });

  assert.deepEqual(summary.totals, {
    scannedEditionCount: 2,
    matchedEditionCount: 2,
    distinctItemCount: 2,
    totalExcludedItems: 3,
    exclusionGroupCount: 1,
  });
  assert.deepEqual(summary.exclusionSummary, {
    totalExcludedItems: 3,
    countsByCategory: [
      {
        category: "library",
        count: 3,
      },
    ],
    countsByReasonCode: [
      {
        reasonCode: "relevance_below_threshold",
        count: 3,
      },
    ],
    countsByCategoryAndReason: [
      {
        category: "library",
        reasonCode: "relevance_below_threshold",
        count: 3,
      },
    ],
  });
});

test("NewsletterEditionStore derives tracked item state across prior editions", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  await store.publish({
    publishedAt: "2026-03-10T21:00:00.000Z",
    window: {
      startsAt: "2026-03-09T21:00:00.000Z",
      endsAt: "2026-03-10T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        name: "Agent Runtime",
        sourceUrl: "https://github.com/acme/agent-runtime",
        category: "library",
        summary: "Runtime for tool-using agents.",
        integrationHint: "npm install agent-runtime",
        relevanceScore: 71,
        sourceKinds: ["github"],
        adapterIds: ["github"],
        sourceAuthorityScore: 92,
        discoveredAt: "2026-03-10T20:30:00.000Z",
        scopeVersion: "1.0.0",
      },
    ],
  });

  await store.publish({
    publishedAt: "2026-03-11T21:00:00.000Z",
    window: {
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        name: "Agent Runtime",
        sourceUrl: "https://github.com/acme/agent-runtime",
        category: "library",
        summary: "Runtime for tool-using agents.",
        integrationHint: "npm install agent-runtime",
        relevanceScore: 78,
        sourceKinds: ["github"],
        adapterIds: ["github"],
        sourceAuthorityScore: 92,
        discoveredAt: "2026-03-11T20:30:00.000Z",
        scopeVersion: "1.1.0",
      },
    ],
  });

  const trackedItemStates = await store.loadTrackedItemStates({
    before: "2026-03-12T21:00:00.000Z",
  });

  assert.deepEqual(
    trackedItemStates.get("artifact-github-com-acme-agent-runtime"),
    {
      firstSeen: "2026-03-10T20:30:00.000Z",
      editionCount: 2,
      scopeVersion: "1.1.0",
      canonicalIdentifiers: {
        entityName: "Agent Runtime",
        repositoryUrl: "https://github.com/acme/agent-runtime",
        doi: null,
        sourceIds: {
          github: "acme/agent-runtime",
        },
      },
    },
  );
});

test("NewsletterEditionStore returns persistent reference items that aged out of the archive", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  for (const { day, startsAt, editionCount } of [
    { day: 1, startsAt: "2026-02-28T21:00:00.000Z", editionCount: 1 },
    { day: 2, startsAt: "2026-03-01T21:00:00.000Z", editionCount: 2 },
    { day: 4, startsAt: "2026-03-03T21:00:00.000Z", editionCount: 3 },
  ]) {
    await store.publish({
      publishedAt: `2026-03-${String(day).padStart(2, "0")}T21:00:00.000Z`,
      window: {
        startsAt,
        endsAt: `2026-03-${String(day).padStart(2, "0")}T21:00:00.000Z`,
        timezone: "UTC",
      },
      items: [
        {
          itemId: "artifact-github-com-acme-persistent-agent-runtime",
          name: "Persistent Agent Runtime",
          sourceUrl: "https://github.com/acme/persistent-agent-runtime",
          sourceUrls: [
            "https://github.com/acme/persistent-agent-runtime",
            "https://reddit.com/r/LocalLLaMA/comments/persistent-agent-runtime",
          ],
          category: "library",
          summary: "Runtime for long-lived tool-using agents.",
          integrationHint: "npm install persistent-agent-runtime",
          relevanceScore: 86,
          sourceKinds: ["github"],
          adapterIds: ["github"],
          sourceAuthorityScore: 92,
          discoveredAt: "2026-03-01T20:30:00.000Z",
          firstSeen: "2026-03-01T20:30:00.000Z",
          editionCount,
        },
      ],
    });
  }

  for (const [day, editionCount] of [
    [7, 1],
    [8, 2],
    [10, 3],
  ]) {
    await store.publish({
      publishedAt: `2026-03-${String(day).padStart(2, "0")}T21:00:00.000Z`,
      window: {
        startsAt: `2026-03-${String(day - 1).padStart(2, "0")}T21:00:00.000Z`,
        endsAt: `2026-03-${String(day).padStart(2, "0")}T21:00:00.000Z`,
        timezone: "UTC",
      },
      items: [
        {
          itemId: "artifact-github-com-acme-recent-agent-runtime",
          name: "Recent Agent Runtime",
          sourceUrl: "https://github.com/acme/recent-agent-runtime",
          sourceUrls: [
            "https://github.com/acme/recent-agent-runtime",
            "https://x.com/agentbuilder/status/9988776655",
          ],
          category: "library",
          summary: "Runtime that is still inside the rolling archive window.",
          integrationHint: "npm install recent-agent-runtime",
          relevanceScore: 91,
          sourceKinds: ["github"],
          adapterIds: ["github"],
          sourceAuthorityScore: 92,
          discoveredAt: "2026-03-07T20:30:00.000Z",
          firstSeen: "2026-03-07T20:30:00.000Z",
          editionCount,
        },
      ],
    });
  }

  const items = await store.loadReferenceItems({
    now: "2026-03-12T21:30:00.000Z",
    underrepresentedCategories: ["technique"],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].itemId, "artifact-github-com-acme-persistent-agent-runtime");
  assert.equal(items[0].name, "Persistent Agent Runtime");
  assert.equal(items[0].editionCount, 3);
  assert.equal(items[0].publishedAt, "2026-03-04T21:00:00.000Z");
});

test("NewsletterEditionStore preserves an underrepresented category in the reference index with relaxed corroboration", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  for (const { day, startsAt, editionCount } of [
    { day: 1, startsAt: "2026-02-28T21:00:00.000Z", editionCount: 1 },
    { day: 2, startsAt: "2026-03-01T21:00:00.000Z", editionCount: 2 },
    { day: 4, startsAt: "2026-03-03T21:00:00.000Z", editionCount: 3 },
  ]) {
    await store.publish({
      publishedAt: `2026-03-${String(day).padStart(2, "0")}T21:00:00.000Z`,
      window: {
        startsAt,
        endsAt: `2026-03-${String(day).padStart(2, "0")}T21:00:00.000Z`,
        timezone: "UTC",
      },
      items: [
        {
          itemId: "artifact-github-com-acme-persistent-agent-runtime",
          name: "Persistent Agent Runtime",
          sourceUrl: "https://github.com/acme/persistent-agent-runtime",
          sourceUrls: [
            "https://github.com/acme/persistent-agent-runtime",
            "https://reddit.com/r/LocalLLaMA/comments/persistent-agent-runtime",
          ],
          category: "library",
          summary: "Runtime for long-lived tool-using agents.",
          integrationHint: "npm install persistent-agent-runtime",
          relevanceScore: 86,
          sourceKinds: ["github"],
          adapterIds: ["github"],
          sourceAuthorityScore: 92,
          discoveredAt: "2026-03-01T20:30:00.000Z",
          firstSeen: "2026-03-01T20:30:00.000Z",
          editionCount,
        },
        {
          itemId: "artifact-example-com-agent-memory-pattern",
          name: "Agent Memory Pattern",
          sourceUrl: "https://patterns.example.com/agent-memory-pattern",
          sourceUrls: ["https://patterns.example.com/agent-memory-pattern"],
          category: "technique",
          summary: "Technique for persistent agent memory updates.",
          integrationHint: "Review the memory pattern before adopting it in production.",
          relevanceScore: 79,
          sourceKinds: ["web"],
          adapterIds: ["web-discovery"],
          sourceAuthorityScore: 66,
          discoveredAt: "2026-03-01T20:00:00.000Z",
          firstSeen: "2026-03-01T20:00:00.000Z",
          editionCount,
        },
      ],
    });
  }

  const items = await store.loadReferenceItems({
    now: "2026-03-12T21:30:00.000Z",
    underrepresentedCategories: ["technique"],
  });

  assert.deepEqual(items.map((item) => item.itemId), [
    "artifact-github-com-acme-persistent-agent-runtime",
    "artifact-example-com-agent-memory-pattern",
  ]);
  assert.equal(items[1].category, "technique");
});

test("NewsletterEditionStore returns a stored item's lifecycle across editions", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  await store.publish({
    publishedAt: "2026-03-10T21:00:00.000Z",
    window: {
      startsAt: "2026-03-09T21:00:00.000Z",
      endsAt: "2026-03-10T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        itemId: "persistent-agent-runtime-item",
        name: "Agent Runtime",
        sourceUrl: "https://github.com/acme/agent-runtime",
        category: "library",
        summary: "Runtime for tool-using agents.",
        integrationHint: "npm install agent-runtime",
        relevanceScore: 71,
        sourceKinds: ["github"],
        adapterIds: ["github"],
        sourceAuthorityScore: 92,
        discoveredAt: "2026-03-10T20:30:00.000Z",
        firstSeen: "2026-03-10T20:30:00.000Z",
        editionCount: 1,
      },
    ],
  });

  await store.publish({
    publishedAt: "2026-03-11T21:00:00.000Z",
    window: {
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        itemId: "persistent-agent-runtime-item",
        name: "Agent Runtime",
        sourceUrl: "https://github.com/acme/agent-runtime",
        category: "library",
        summary: "Runtime for tool-using agents.",
        integrationHint: "npm install agent-runtime",
        relevanceScore: 78,
        sourceKinds: ["github"],
        adapterIds: ["github"],
        sourceAuthorityScore: 92,
        discoveredAt: "2026-03-11T20:30:00.000Z",
        firstSeen: "2026-03-10T20:30:00.000Z",
        editionCount: 2,
      },
    ],
  });

  const lifecycle = await store.loadItemLifecycle({
    itemId: "persistent-agent-runtime-item",
    now: "2026-03-11T21:30:00.000Z",
  });

  assert.equal(lifecycle?.itemId, "persistent-agent-runtime-item");
  assert.equal(lifecycle?.firstSeen, "2026-03-10T20:30:00.000Z");
  assert.equal(lifecycle?.editionCount, 2);
  assert.deepEqual(
    lifecycle?.appearances.map((appearance) => appearance.editionId),
    ["2026-03-10", "2026-03-11"],
  );
});
