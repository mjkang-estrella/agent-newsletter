import test from "node:test";
import assert from "node:assert/strict";

import {
  AggregationPipeline,
  DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  DEFAULT_SOURCE_DESCRIPTORS,
  SourceRegistry,
  defineSourceAdapter,
} from "../src/index.js";

const descriptorById = new Map(
  DEFAULT_SOURCE_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

const WINDOW = {
  startsAt: "2026-03-10T21:00:00.000Z",
  endsAt: "2026-03-11T21:00:00.000Z",
  timezone: "UTC",
};

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

test("ingestion pipeline ranks valid items from scorer object output and preserves score metadata", async () => {
  const registry = createRegistry([
    {
      id: "github",
      async fetch() {
        return {
          items: [
            {
              name: "Agent Runtime",
              sourceUrl: "https://github.com/acme/agent-runtime",
              category: "library",
              summary: "Runtime primitives for autonomous agent systems.",
              integrationHint: "npm install agent-runtime",
            },
          ],
        };
      },
    },
    {
      id: "arxiv",
      async fetch() {
        return {
          items: [
            {
              name: "Planner-Critic Loops",
              sourceUrl: "https://arxiv.org/abs/2603.12345",
              category: "technique",
              summary: "Research on planner-critic loops for tool-using agents.",
              integrationHint: "Port the evaluation loop into your planner.",
            },
          ],
        };
      },
    },
  ]);

  const scoreItem = async (item) =>
    item.name === "Agent Runtime"
      ? {
          relevanceScore: 91,
          version: "2.3.0",
          breakdown: {
            signals: {
              recency: 95,
              sourceAuthority: 95,
              mentionFrequency: 40,
              github: 90,
              socialEngagement: 25,
            },
          },
        }
      : {
          relevanceScore: 76,
          version: "2.3.0",
          breakdown: {
            signals: {
              recency: 80,
              sourceAuthority: 90,
              mentionFrequency: 25,
              github: 0,
              socialEngagement: 10,
            },
          },
        };

  const pipeline = new AggregationPipeline({
    registry,
    minRelevanceScore: 0,
    scoreItem,
  });

  const result = await pipeline.aggregate(WINDOW);

  assert.deepEqual(
    result.items.map((item) => [item.name, item.relevanceScore]),
    [
      ["Agent Runtime", 91],
      ["Planner-Critic Loops", 76],
    ],
  );
  assert.deepEqual(
    result.curationDecisions.map((decision) => [
      decision.name,
      decision.relevanceScore,
      decision.scoreVersion,
    ]),
    [
      ["Agent Runtime", 91, "2.3.0"],
      ["Planner-Critic Loops", 76, "2.3.0"],
    ],
  );
  assert.deepEqual(result.items[0].metadata.curation.relevanceGate, {
    minRelevanceScore: 0,
    relevanceScore: 91,
    scoreVersion: "2.3.0",
    scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
    divergenceFlag: false,
    decision: "keep",
    scoreBreakdown: {
      score: 91,
      scoreVersion: "2.3.0",
      scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
      divergenceFlag: false,
      signals: {
        recency: 95,
        sourceAuthority: 95,
        mentionFrequency: 40,
        github: 90,
        socialEngagement: 25,
      },
    },
  });
  assert.equal(result.items[0].divergenceFlag, false);
  assert.equal(result.items[0].metadata.scoring.divergenceFlag, false);
});

test("ingestion pipeline preserves an explicit score interpretation from the scorer", async () => {
  const registry = createRegistry([
    {
      id: "github",
      async fetch() {
        return {
          items: [
            {
              name: "Agent Forecast Feed",
              sourceUrl: "https://github.com/acme/agent-forecast-feed",
              category: "tool",
              summary: "Signals likely agent tooling adoption before it lands broadly.",
              integrationHint: "Use it as an early-watch capability source.",
            },
          ],
        };
      },
    },
  ]);

  const pipeline = new AggregationPipeline({
    registry,
    minRelevanceScore: 0,
    scoreItem: async () => ({
      relevanceScore: 88,
      scoreVersion: "2.4.0",
      scoreInterpretation: "predictive",
    }),
  });

  const result = await pipeline.aggregate(WINDOW);

  assert.equal(result.items[0].scoreInterpretation, "predictive");
  assert.equal(
    result.items[0].metadata.curation.relevanceGate.scoreInterpretation,
    "predictive",
  );
  assert.equal(
    result.items[0].metadata.curation.relevanceGate.scoreBreakdown.scoreInterpretation,
    "predictive",
  );
});

test("ingestion pipeline consolidates duplicate mentions before scoring and ranking", async () => {
  const registry = createRegistry([
    {
      id: "github",
      async fetch() {
        return {
          items: [
            {
              name: "agent-runtime",
              sourceUrl: "https://github.com/acme/agent-runtime",
              category: "library",
              summary: "Official runtime repository for tool-using agents.",
              integrationHint: "npm install agent-runtime",
            },
          ],
        };
      },
    },
    {
      id: "reddit",
      async fetch() {
        return {
          items: [
            {
              name: "Agent Runtime release thread",
              sourceUrl:
                "https://www.reddit.com/r/LocalLLaMA/comments/dup123/agent_runtime_release/",
              category: "library",
              summary: "Operator thread with rollout notes and a repo link.",
              integrationHint: "Compare the operator notes with upstream docs.",
              metadata: {
                outboundUrls: [
                  "https://github.com/Acme/Agent-Runtime?utm_source=reddit",
                ],
              },
            },
          ],
        };
      },
    },
    {
      id: "arxiv",
      async fetch() {
        return {
          items: [
            {
              name: "Tool Memory for Agents",
              sourceUrl: "https://arxiv.org/abs/2603.33333",
              category: "technique",
              summary: "Research on persistent tool memory for agents.",
              integrationHint: "Evaluate the memory loop before production use.",
            },
          ],
        };
      },
    },
  ]);

  const pipeline = new AggregationPipeline({
    registry,
    minRelevanceScore: 0,
    scoreItem: async (item) => ({
      score: item.scoringSignals.mentionCount * 40,
      scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    }),
  });

  const result = await pipeline.aggregate(WINDOW);
  const [mergedDuplicate, standaloneItem] = result.items;

  assert.equal(result.candidateGroups.length, 2);
  assert.equal(mergedDuplicate.name, "agent-runtime");
  assert.equal(mergedDuplicate.mentionCount, 2);
  assert.equal(mergedDuplicate.relevanceScore, 80);
  assert.equal(
    mergedDuplicate.scoreInterpretation,
    DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  );
  assert.deepEqual(mergedDuplicate.sourceKinds.sort(), ["github", "reddit"]);
  assert.deepEqual(mergedDuplicate.sourceUrls.sort(), [
    "https://github.com/acme/agent-runtime",
    "https://www.reddit.com/r/LocalLLaMA/comments/dup123/agent_runtime_release",
  ]);
  assert.equal(standaloneItem.name, "Tool Memory for Agents");
  assert.equal(standaloneItem.relevanceScore, 40);
});

test("ingestion pipeline preserves fetcher order and suppresses duplicate raw mentions in ranked output", async () => {
  const fetchCalls = [];
  const registry = createRegistry([
    {
      id: "github",
      async fetch(window) {
        fetchCalls.push({
          adapterId: "github",
          window,
        });

        return {
          items: [
            {
              name: "Agent Runtime",
              sourceUrl: "https://github.com/acme/agent-runtime",
              category: "library",
              summary: "Official runtime repository for tool-using agents.",
              integrationHint: "npm install agent-runtime",
              sourceAuthorityScore: 88,
            },
            {
              name: "Agent Sandbox",
              sourceUrl: "https://github.com/acme/agent-sandbox",
              category: "tool",
              summary: "Sandboxing primitives for agent tool execution.",
              integrationHint: "npm install agent-sandbox",
              sourceAuthorityScore: 72,
            },
          ],
        };
      },
    },
    {
      id: "reddit",
      async fetch(window) {
        fetchCalls.push({
          adapterId: "reddit",
          window,
        });

        return {
          items: [
            {
              name: "Agent Runtime rollout thread",
              sourceUrl:
                "https://www.reddit.com/r/LocalLLaMA/comments/runtime123/agent_runtime_rollout/",
              category: "library",
              summary: "Operator thread with rollout notes and a repo link.",
              integrationHint: "Compare the operator notes with upstream docs.",
              sourceAuthorityScore: 64,
              metadata: {
                outboundUrls: [
                  "https://github.com/acme/agent-runtime?utm_source=reddit",
                ],
              },
            },
          ],
        };
      },
    },
    {
      id: "arxiv",
      async fetch(window) {
        fetchCalls.push({
          adapterId: "arxiv",
          window,
        });

        return {
          items: [
            {
              name: "Planner-Critic Memory",
              sourceUrl: "https://arxiv.org/abs/2603.22222",
              category: "technique",
              summary: "Research on planner-critic memory loops for agents.",
              integrationHint: "Evaluate the memory loop before production use.",
              sourceAuthorityScore: 78,
            },
          ],
        };
      },
    },
  ]);

  const pipeline = new AggregationPipeline({
    registry,
    minRelevanceScore: 0,
    scoreItem: async (item) => ({
      score: item.scoringSignals.mentionCount * 25 + item.scoringSignals.sourceAuthority / 2,
      scoreVersion: "2.4.1",
    }),
  });

  const result = await pipeline.aggregate(WINDOW);

  assert.deepEqual(
    fetchCalls.map((call) => call.adapterId),
    ["github", "reddit", "arxiv"],
  );
  assert.deepEqual(
    fetchCalls.map((call) => call.window),
    [WINDOW, WINDOW, WINDOW],
  );
  assert.deepEqual(
    result.fetchPlan.map((step) => step.adapterId),
    ["github", "reddit", "arxiv"],
  );
  assert.deepEqual(
    result.fetchReports.map((report) => report.adapterId),
    ["github", "reddit", "arxiv"],
  );
  assert.equal(result.fetchedItems.length, 4);
  assert.equal(result.candidateGroups.length, 3);
  assert.deepEqual(
    result.items.map((item) => [item.name, item.relevanceScore]),
    [
      ["Agent Runtime", 94],
      ["Planner-Critic Memory", 64],
      ["Agent Sandbox", 61],
    ],
  );

  const duplicateCluster = result.items[0];

  assert.equal(duplicateCluster.mentionCount, 2);
  assert.deepEqual(duplicateCluster.sourceKinds.sort(), ["github", "reddit"]);
  assert.deepEqual(duplicateCluster.adapterIds.sort(), ["github", "reddit"]);
  assert.deepEqual(duplicateCluster.sourceUrls.sort(), [
    "https://github.com/acme/agent-runtime",
    "https://www.reddit.com/r/LocalLLaMA/comments/runtime123/agent_runtime_rollout",
  ]);
  assert.equal(
    result.items.map((item) => item.name).includes("Agent Runtime rollout thread"),
    false,
  );
});

test("ingestion pipeline records malformed fetch payloads as partial failures when another source succeeds", async () => {
  const registry = createRegistry([
    {
      id: "github",
      async fetch() {
        return {
          items: [
            {
              name: "Agent Toolkit",
              sourceUrl: "https://github.com/acme/agent-toolkit",
              category: "tool",
              summary: "Composable utilities for autonomous agent runtimes.",
              integrationHint: "npm install agent-toolkit",
            },
          ],
        };
      },
    },
    {
      id: "web-discovery",
      async fetch() {
        return {
          items: {
            broken: true,
          },
        };
      },
    },
  ]);

  const pipeline = new AggregationPipeline({
    registry,
    minRelevanceScore: 0,
    scoreItem: async () => 82,
  });

  const result = await pipeline.aggregate(WINDOW);

  assert.deepEqual(result.items.map((item) => item.name), ["Agent Toolkit"]);
  assert.equal(result.fetchVerification.status, "partial");
  assert.equal(result.fetchVerification.readyForCuration, true);
  assert.deepEqual(
    result.fetchReports.map((report) => [report.adapterId, report.status]),
    [
      ["github", "succeeded"],
      ["web-discovery", "failed"],
    ],
  );
  assert.deepEqual(result.fetchReports[1].error, {
    name: "TypeError",
    message: "source fetch result items must be an array",
  });
});

test("ingestion pipeline rejects malformed scorer output before publishing curated items", async () => {
  const registry = createRegistry([
    {
      id: "github",
      async fetch() {
        return {
          items: [
            {
              name: "Broken Scoring Candidate",
              sourceUrl: "https://github.com/acme/broken-scoring-candidate",
              category: "tool",
              summary: "Valid fetched item with invalid scorer output.",
              integrationHint: "Do not use this test fixture in production.",
            },
          ],
        };
      },
    },
  ]);

  const pipeline = new AggregationPipeline({
    registry,
    scoreItem: async () => ({
      breakdown: {
        signals: {
          recency: 100,
        },
      },
    }),
  });

  await assert.rejects(
    pipeline.aggregate(WINDOW),
    /scoreItem must resolve to a finite number or an object with score/,
  );
});
