import test from "node:test";
import assert from "node:assert/strict";

import {
  AggregationPipeline,
  DEFAULT_SOURCE_DESCRIPTORS,
  SourceRegistry,
  defineSourceAdapter,
} from "../src/index.js";

const descriptorById = new Map(
  DEFAULT_SOURCE_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

test("aggregation pipeline groups X and web mentions into one canonical item identity", async () => {
  const canonicalIdentifiers = {
    entityName: "Nova Planner",
    repositoryUrl: null,
    doi: null,
    sourceIds: {
      generic: "nova-planner",
    },
  };
  const pipeline = new AggregationPipeline({
    registry: new SourceRegistry([
      defineSourceAdapter({
        descriptor: descriptorById.get("x"),
        async fetch() {
          return {
            items: [
              {
                name: "Nova Planner launch thread",
                sourceUrl: "https://x.com/acme/status/1001?ref=timeline",
                category: "library",
                summary: "Launch thread for Nova Planner.",
                integrationHint: "Review the rollout thread before integrating Nova Planner.",
                canonicalIdentifiers,
              },
            ],
          };
        },
      }),
      defineSourceAdapter({
        descriptor: descriptorById.get("web-discovery"),
        async fetch() {
          return {
            items: [
              {
                name: "Nova Planner setup guide",
                sourceUrl: "https://docs.example.com/nova-planner/get-started?utm_source=nav",
                category: "library",
                summary: "Setup guide for Nova Planner.",
                integrationHint: "Follow the setup guide after validating prerequisites.",
                sourceAuthorityScore: 68,
                canonicalIdentifiers,
              },
            ],
          };
        },
      }),
    ]),
    minRelevanceScore: 0,
    scoreItem: async () => 85,
    requiresSourceApproval: () => false,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-11T21:00:00.000Z",
    endsAt: "2026-03-12T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.candidateGroups.length, 1);
  assert.equal(result.candidateGroups[0].length, 2);
  assert.equal(result.items[0].itemId, "artifact-generic-nova-planner");
  assert.equal(result.items[0].sourceUrl, "https://x.com/acme/status/1001");
  assert.deepEqual(result.items[0].sourceKinds.sort(), ["web", "x"]);
  assert.deepEqual(result.items[0].sourceUrls.sort(), [
    "https://docs.example.com/nova-planner/get-started",
    "https://x.com/acme/status/1001",
  ]);
});

test("aggregation pipeline resolves homepage-linked X posts and generic docs pages on the same product domain to one item", async () => {
  const pipeline = new AggregationPipeline({
    registry: new SourceRegistry([
      defineSourceAdapter({
        descriptor: descriptorById.get("x"),
        async fetch() {
          return {
            items: [
              {
                name: "Launch thread",
                sourceUrl: "https://x.com/acme/status/7100?ref=timeline",
                category: "tool",
                summary: "Operator notes for the latest rollout.",
                integrationHint: "Review the rollout notes before adoption.",
                metadata: {
                  outboundUrls: ["https://agent-runtime.dev/?utm_source=x"],
                },
              },
            ],
          };
        },
      }),
      defineSourceAdapter({
        descriptor: descriptorById.get("web-discovery"),
        async fetch() {
          return {
            items: [
              {
                name: "Getting started",
                sourceUrl: "https://agent-runtime.dev/docs/getting-started?ref=nav",
                category: "tool",
                summary: "Setup steps for the latest runtime release.",
                integrationHint: "Follow the guide after validating prerequisites.",
                sourceAuthorityScore: 70,
              },
            ],
          };
        },
      }),
    ]),
    minRelevanceScore: 0,
    scoreItem: async () => 82,
    requiresSourceApproval: () => false,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-11T21:00:00.000Z",
    endsAt: "2026-03-12T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.candidateGroups.length, 1);
  assert.equal(result.candidateGroups[0].length, 2);
  assert.equal(result.items[0].itemId, "artifact-agent-runtime");
  assert.deepEqual(result.items[0].sourceKinds.sort(), ["web", "x"]);
  assert.deepEqual(result.items[0].sourceUrls.sort(), [
    "https://agent-runtime.dev/docs/getting-started",
    "https://x.com/acme/status/7100",
  ]);
});
