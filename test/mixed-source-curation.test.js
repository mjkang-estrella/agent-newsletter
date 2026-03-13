import test from "node:test";
import assert from "node:assert/strict";

import {
  ContentFetcherCore,
  DEFAULT_SOURCE_DESCRIPTORS,
  SourceRegistry,
  createNormalizedItem,
  createWeightedRelevanceScorer,
  deduplicateItems,
  defineSourceAdapter,
  sortCuratedItemsByRelevance,
} from "../src/index.js";

const WINDOW = {
  startsAt: "2026-03-11T21:00:00.000Z",
  endsAt: "2026-03-12T21:00:00.000Z",
  timezone: "UTC",
};

const descriptorById = new Map(
  DEFAULT_SOURCE_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

function createRegistry(entries) {
  return new SourceRegistry(
    entries.map(({ id, fetch }) =>
      defineSourceAdapter({
        descriptor: descriptorById.get(id),
        fetch,
      }),
    ),
  );
}

function createMixedSourceSeedItems() {
  return [
    createNormalizedItem({
      id: "x-agent-mesh",
      name: "Agent Mesh launch thread",
      sourceUrl: "https://x.com/builder/status/9001?utm_source=feed",
      category: "library",
      summary: "Launch thread for the Agent Mesh orchestration runtime.",
      integrationHint: "Review the rollout thread before integrating Agent Mesh.",
      publishedAt: "2026-03-12T19:00:00.000Z",
      discoveredAt: WINDOW.endsAt,
      sourceKinds: ["x"],
      adapterIds: ["x"],
      sourceAuthorityScore: 72,
      scoringSignals: {
        recencyHours: 2,
        socialEngagement: 420,
      },
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-mesh?utm_source=x"],
      },
    }),
    createNormalizedItem({
      id: "web-agent-mesh",
      name: "Agent Mesh setup guide",
      sourceUrl: "https://docs.example.com/agent-mesh/get-started?ref=nav",
      category: "library",
      summary: "Official setup guide for the Agent Mesh runtime.",
      integrationHint: "Follow the setup steps after validating the repo release notes.",
      publishedAt: "2026-03-12T17:00:00.000Z",
      discoveredAt: WINDOW.endsAt,
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 86,
      scoringSignals: {
        recencyHours: 4,
        socialEngagement: 90,
      },
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-mesh"],
      },
    }),
    createNormalizedItem({
      id: "x-agent-mesh-cloud",
      name: "Agent Mesh Cloud launch thread",
      sourceUrl: "https://x.com/builder/status/9002?ref=timeline",
      category: "library",
      summary: "Launch thread for the managed Agent Mesh Cloud runtime.",
      integrationHint: "Review the launch notes before integrating Agent Mesh Cloud.",
      publishedAt: "2026-03-12T17:00:00.000Z",
      discoveredAt: WINDOW.endsAt,
      sourceKinds: ["x"],
      adapterIds: ["x"],
      sourceAuthorityScore: 70,
      scoringSignals: {
        recencyHours: 4,
        socialEngagement: 120,
      },
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-mesh-cloud?utm_source=x"],
      },
    }),
    createNormalizedItem({
      id: "web-agent-mesh-cloud",
      name: "Agent Mesh Cloud migration guide",
      sourceUrl: "https://docs.example.com/agent-mesh-cloud/migrate?utm_source=blog",
      category: "library",
      summary: "Migration guide for Agent Mesh Cloud.",
      integrationHint: "Use the migration checklist before switching managed runtimes.",
      publishedAt: "2026-03-12T15:00:00.000Z",
      discoveredAt: WINDOW.endsAt,
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 80,
      scoringSignals: {
        recencyHours: 6,
        socialEngagement: 60,
      },
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-mesh-cloud"],
      },
    }),
  ];
}

test("content fetcher ingests mixed X and web duplicate and near-duplicate inputs with canonical identity hints", async () => {
  const registry = createRegistry([
    {
      id: "x",
      async fetch() {
        return {
          items: [
            {
              name: "Agent Mesh launch thread",
              sourceUrl: "https://x.com/builder/status/9001?utm_source=feed",
              category: "library",
              summary: "Launch thread for the Agent Mesh orchestration runtime.",
              integrationHint: "Review the rollout thread before integrating Agent Mesh.",
              sourceAuthorityScore: 72,
              metadata: {
                outboundUrls: ["https://github.com/acme/agent-mesh?utm_source=x"],
              },
            },
            {
              name: "Agent Mesh Cloud launch thread",
              sourceUrl: "https://x.com/builder/status/9002?ref=timeline",
              category: "library",
              summary: "Launch thread for the managed Agent Mesh Cloud runtime.",
              integrationHint: "Review the launch notes before integrating Agent Mesh Cloud.",
              sourceAuthorityScore: 70,
              metadata: {
                outboundUrls: ["https://github.com/acme/agent-mesh-cloud?utm_source=x"],
              },
            },
          ],
        };
      },
    },
    {
      id: "web-discovery",
      async fetch() {
        return {
          items: [
            {
              name: "Agent Mesh setup guide",
              sourceUrl: "https://docs.example.com/agent-mesh/get-started?ref=nav",
              category: "library",
              summary: "Official setup guide for the Agent Mesh runtime.",
              integrationHint:
                "Follow the setup steps after validating the repo release notes.",
              sourceAuthorityScore: 86,
              metadata: {
                outboundUrls: ["https://github.com/acme/agent-mesh"],
              },
            },
            {
              name: "Agent Mesh Cloud migration guide",
              sourceUrl: "https://docs.example.com/agent-mesh-cloud/migrate?utm_source=blog",
              category: "library",
              summary: "Migration guide for Agent Mesh Cloud.",
              integrationHint:
                "Use the migration checklist before switching managed runtimes.",
              sourceAuthorityScore: 80,
              metadata: {
                outboundUrls: ["https://github.com/acme/agent-mesh-cloud"],
              },
            },
          ],
        };
      },
    },
  ]);

  const result = await new ContentFetcherCore({ registry }).fetch(WINDOW);
  const itemByName = new Map(result.items.map((item) => [item.name, item]));

  assert.equal(result.items.length, 4);
  assert.deepEqual(
    result.items.map((item) => item.sourceUrl),
    [
      "https://x.com/builder/status/9001?utm_source=feed",
      "https://x.com/builder/status/9002?ref=timeline",
      "https://docs.example.com/agent-mesh/get-started?ref=nav",
      "https://docs.example.com/agent-mesh-cloud/migrate?utm_source=blog",
    ],
  );
  assert.deepEqual(itemByName.get("Agent Mesh launch thread").sourceKinds, ["x"]);
  assert.deepEqual(itemByName.get("Agent Mesh setup guide").sourceKinds, ["web"]);
  assert.equal(
    itemByName.get("Agent Mesh launch thread").canonicalIdentifiers.repositoryUrl,
    "https://github.com/acme/agent-mesh",
  );
  assert.equal(
    itemByName.get("Agent Mesh Cloud migration guide").canonicalIdentifiers.repositoryUrl,
    "https://github.com/acme/agent-mesh-cloud",
  );
  assert.ok(
    itemByName
      .get("Agent Mesh launch thread")
      .metadata.identitySignals.includes(
        "identity:repo_root:https://github.com/acme/agent-mesh",
      ),
  );
  assert.ok(
    itemByName
      .get("Agent Mesh Cloud migration guide")
      .metadata.identitySignals.includes(
        "identity:repo_root:https://github.com/acme/agent-mesh-cloud",
      ),
  );
});

test("weighted relevance scoring ranks corroborated X and web duplicate clusters above near-duplicate clusters", async () => {
  const mergedItems = deduplicateItems(createMixedSourceSeedItems()).map((item) => ({
    ...item,
    relevanceScore: null,
  }));
  const scorer = createWeightedRelevanceScorer();
  const scoredItems = await Promise.all(
    mergedItems.map(async (item) => {
      const scoreResult = await scorer(item, WINDOW);

      return {
        ...item,
        relevanceScore: scoreResult.score,
        scoreVersion: scoreResult.scoreVersion,
        scoreInterpretation: scoreResult.scoreInterpretation,
        scoreBreakdown: scoreResult.scoreBreakdown,
      };
    }),
  );
  const sortedItems = sortCuratedItemsByRelevance(scoredItems);

  assert.equal(sortedItems.length, 2);
  assert.ok(sortedItems[0].relevanceScore > sortedItems[1].relevanceScore);
  assert.deepEqual(
    sortedItems.map((item) => item.itemId),
    [
      "artifact-github-com-acme-agent-mesh",
      "artifact-github-com-acme-agent-mesh-cloud",
    ],
  );
  assert.ok(sortedItems[0].relevanceScore >= 60);
  assert.ok(sortedItems[1].relevanceScore >= 60);
});

test("deduplicateItems merges X and web duplicates while keeping similar-looking neighboring entities separate", () => {
  const deduplicated = deduplicateItems(createMixedSourceSeedItems()).sort((left, right) =>
    left.itemId.localeCompare(right.itemId),
  );

  assert.equal(deduplicated.length, 2);
  assert.deepEqual(
    deduplicated.map((item) => item.itemId),
    [
      "artifact-github-com-acme-agent-mesh",
      "artifact-github-com-acme-agent-mesh-cloud",
    ],
  );
  assert.deepEqual(
    deduplicated.map((item) => item.mentionCount),
    [2, 2],
  );
  assert.deepEqual(
    deduplicated.map((item) => item.sourceKinds.sort()),
    [
      ["web", "x"],
      ["web", "x"],
    ],
  );
  assert.deepEqual(deduplicated[0].sourceUrls.sort(), [
    "https://docs.example.com/agent-mesh/get-started",
    "https://x.com/builder/status/9001",
  ]);
  assert.deepEqual(deduplicated[1].sourceUrls.sort(), [
    "https://docs.example.com/agent-mesh-cloud/migrate",
    "https://x.com/builder/status/9002",
  ]);
});

test("deduplicateItems synthesizes per-source provenance for corroborated X and web mentions", () => {
  const [agentMesh] = deduplicateItems(createMixedSourceSeedItems()).sort((left, right) =>
    left.itemId.localeCompare(right.itemId),
  );

  assert.deepEqual(
    agentMesh.metadata.sourceProvenance
      .map((entry) => ({
        adapterId: entry.adapterId,
        contributedMentionCount: entry.contributedMentionCount,
        sourceItemId: entry.sourceItemId,
        sourceKind: entry.sourceKind,
        sourceUrl: entry.sourceUrl,
      }))
      .sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl)),
    [
      {
        adapterId: "web-discovery",
        contributedMentionCount: 1,
        sourceItemId: "web-agent-mesh",
        sourceKind: "web",
        sourceUrl: "https://docs.example.com/agent-mesh/get-started",
      },
      {
        adapterId: "x",
        contributedMentionCount: 1,
        sourceItemId: "x-agent-mesh",
        sourceKind: "x",
        sourceUrl: "https://x.com/builder/status/9001",
      },
    ],
  );
});
