import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { NewsletterEditionRepository } from "../src/index.js";

test("NewsletterEditionRepository round-trips storyline snapshots with item linkage", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new NewsletterEditionRepository({
    filePath: join(directoryPath, "newsletter-snapshot.json"),
  });

  await repository.save({
    updatedAt: "2026-03-12T21:05:00.000Z",
    editions: [
      {
        id: "2026-03-12",
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
            relevanceScore: 85,
            sourceKinds: ["github"],
            adapterIds: ["github"],
            sourceAuthorityScore: 92,
            discoveredAt: "2026-03-12T20:30:00.000Z",
            storyline_id: "storyline-agent-runtime",
            storyline_member_position: 1,
          },
        ],
        storylines: [
          {
            storyline_id: "storyline-agent-runtime",
            title: "Agent Runtime expands from SDK to managed platform",
            member_item_ids: ["agent-runtime-v1"],
            parent_storyline_ids: ["storyline-agent-runtime-sdk"],
            narrative_type: {
              key: "managed-hosting-expansion",
              label: "Managed hosting expansion",
              metadata: {
                focus: "deployment",
              },
            },
            status: "stable",
          },
        ],
      },
    ],
  });

  const snapshot = await repository.load({
    now: "2026-03-12T21:30:00.000Z",
  });

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.editions[0].items[0].storylineId, "storyline-agent-runtime");
  assert.equal(snapshot.editions[0].items[0].storylineMemberPosition, 1);
  assert.deepEqual(snapshot.editions[0].storylines, [
    {
      storylineId: "storyline-agent-runtime",
      title: "Agent Runtime expands from SDK to managed platform",
      memberItemIds: ["agent-runtime-v1"],
      parentStorylineIds: ["storyline-agent-runtime-sdk"],
      narrativeType: {
        key: "managed-hosting-expansion",
        label: "Managed hosting expansion",
        metadata: {
          focus: "deployment",
        },
      },
      status: "stable",
    },
  ]);
});

test("NewsletterEditionRepository derives and stores per-edition exclusion summaries", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new NewsletterEditionRepository({
    filePath: join(directoryPath, "newsletter-snapshot.json"),
  });

  await repository.save({
    updatedAt: "2026-03-12T21:05:00.000Z",
    editions: [
      {
        id: "2026-03-12",
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
              canonicalIdentifiers: null,
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
          {
            itemIdentity: {
              id: "artifact-docs-unknown-example-sdk",
              itemId: "artifact-docs-unknown-example-sdk",
              name: "Unknown Agent SDK",
              sourceUrl: "https://unknown.example.com/post",
              sourceUrls: ["https://unknown.example.com/post"],
              canonicalIdentifiers: null,
            },
            itemId: "artifact-docs-unknown-example-sdk",
            name: "Unknown Agent SDK",
            sourceUrl: "https://unknown.example.com/post",
            category: "library",
            exclusionReasonCode: "source_not_approved",
            reasonCode: "source_not_approved",
            timestamp: "2026-03-12T21:00:00.000Z",
            evaluationContext: {
              stage: "source_gate",
            },
            sourceKinds: ["web"],
            adapterIds: ["web-discovery"],
            reason: "source_not_approved",
            phase: "source",
            sourceAuthorityScore: 47,
            minSourceAuthorityScore: 50,
            sourceStatus: "candidate",
            sourceLifecycleState: "probation",
          },
          {
            itemIdentity: {
              id: "artifact-docs-unknown-example-api",
              itemId: "artifact-docs-unknown-example-api",
              name: "Unknown Agent API",
              sourceUrl: "https://unknown.example.com/api",
              sourceUrls: ["https://unknown.example.com/api"],
              canonicalIdentifiers: null,
            },
            itemId: "artifact-docs-unknown-example-api",
            name: "Unknown Agent API",
            sourceUrl: "https://unknown.example.com/api",
            category: "library",
            exclusionReasonCode: "source_not_approved",
            reasonCode: "source_not_approved",
            timestamp: "2026-03-12T21:00:00.000Z",
            evaluationContext: {
              stage: "source_gate",
            },
            sourceKinds: ["web"],
            adapterIds: ["web-discovery"],
            reason: "source_not_approved",
            phase: "source",
            sourceAuthorityScore: 46,
            minSourceAuthorityScore: 50,
            sourceStatus: "candidate",
            sourceLifecycleState: "probation",
          },
        ],
      },
    ],
  });

  const snapshot = await repository.load({
    now: "2026-03-12T21:30:00.000Z",
  });

  assert.deepEqual(snapshot.editions[0].exclusionSummary, {
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
});

test("NewsletterEditionRepository queries grouped exclusion statistics by category and reason", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new NewsletterEditionRepository({
    filePath: join(directoryPath, "newsletter-snapshot.json"),
  });

  await repository.save({
    updatedAt: "2026-03-12T21:05:00.000Z",
    editions: [
      {
        id: "2026-03-10",
        publishedAt: "2026-03-10T21:00:00.000Z",
        window: {
          startsAt: "2026-03-09T21:00:00.000Z",
          endsAt: "2026-03-10T21:00:00.000Z",
          timezone: "UTC",
        },
        items: [],
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
            relevanceScore: 58,
            minRelevanceScore: 60,
            scoreVersion: "1.0.0",
            sourceAuthorityScore: 89,
          },
        ],
      },
      {
        id: "2026-03-11",
        publishedAt: "2026-03-11T21:00:00.000Z",
        window: {
          startsAt: "2026-03-10T21:00:00.000Z",
          endsAt: "2026-03-11T21:00:00.000Z",
          timezone: "UTC",
        },
        items: [],
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
            relevanceScore: 55,
            minRelevanceScore: 60,
            scoreVersion: "1.0.0",
            sourceAuthorityScore: 91,
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
            relevanceScore: 52,
            minRelevanceScore: 60,
            scoreVersion: "1.0.0",
            sourceAuthorityScore: 84,
          },
        ],
      },
    ],
  });

  const summary = await repository.queryExclusionSummary({
    now: "2026-03-12T21:30:00.000Z",
    category: "library",
    reason: "relevance_below_threshold",
  });

  assert.deepEqual(summary.filters, {
    publishedFrom: "2026-03-05T21:30:00.000Z",
    publishedTo: "2026-03-12T21:30:00.000Z",
    reason: "relevance_below_threshold",
    category: "library",
    sourceKind: null,
    adapterId: null,
    itemId: null,
    phase: null,
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
