import test from "node:test";
import assert from "node:assert/strict";

import { createNewsletterEdition } from "../src/index.js";

function buildConsolidatedItem(overrides = {}) {
  return {
    itemId: "artifact-github-com-acme-agent-runtime",
    name: "Agent Runtime",
    sourceUrl: "https://github.com/acme/agent-runtime",
    category: "library",
    summary: "Runtime for long-lived tool-using agents.",
    integrationHint: "npm install agent-runtime",
    relevanceScore: 86,
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 92,
    discoveredAt: "2026-03-12T20:30:00.000Z",
    firstSeen: "2026-03-12T20:30:00.000Z",
    ...overrides,
  };
}

function buildEdition(itemOverrides = {}) {
  return createNewsletterEdition({
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [buildConsolidatedItem(itemOverrides)],
  });
}

test("createNewsletterEdition preserves aggregated source urls and mention count aliases on consolidated items", () => {
  const edition = buildEdition({
    source_urls: [
      "https://github.com/acme/agent-runtime",
      "https://docs.example.com/agent-runtime/get-started",
    ],
    mention_count: 2,
  });

  assert.deepEqual(edition.items[0].sourceUrls.sort(), [
    "https://docs.example.com/agent-runtime/get-started",
    "https://github.com/acme/agent-runtime",
  ]);
  assert.equal(edition.items[0].mentionCount, 2);
});

test("createNewsletterEdition infers consolidated mention counts from merged duplicate provenance", () => {
  const edition = buildEdition({
    sourceUrls: [
      "https://github.com/acme/agent-runtime",
      "https://github.com/acme/agent-runtime/releases/tag/v1.2.0",
      "https://github.com/acme/agent-runtime/issues/42",
    ],
    metadata: {
      mergedFrom: ["official-repo", "release-notes", "issue-thread"],
    },
  });

  assert.deepEqual(edition.items[0].sourceUrls.sort(), [
    "https://github.com/acme/agent-runtime",
    "https://github.com/acme/agent-runtime/issues/42",
    "https://github.com/acme/agent-runtime/releases/tag/v1.2.0",
  ]);
  assert.equal(edition.items[0].mentionCount, 3);
});

test("createNewsletterEdition preserves storyline lineage and narrative metadata", () => {
  const edition = createNewsletterEdition({
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      buildConsolidatedItem({
        itemId: "artifact-agent-runtime-core",
        name: "Agent Runtime Core",
        sourceUrl: "https://github.com/acme/agent-runtime",
        storylineId: "storyline-agent-runtime",
      }),
      buildConsolidatedItem({
        itemId: "artifact-agent-runtime-cloud",
        name: "Agent Runtime Cloud",
        sourceUrl: "https://example.com/agent-runtime-cloud",
        firstSeen: "2026-03-12T20:45:00.000Z",
        discoveredAt: "2026-03-12T20:45:00.000Z",
        storylineId: "storyline-agent-runtime",
      }),
    ],
    storylines: [
      {
        storyline_id: "storyline-agent-runtime",
        title: "Agent Runtime expands into managed hosting",
        member_item_ids: [
          "artifact-agent-runtime-core",
          "artifact-agent-runtime-cloud",
        ],
        parent_storyline_ids: ["storyline-agent-runtime-sdk"],
        narrative_type: {
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

  assert.deepEqual(edition.storylines, [
    {
      storylineId: "storyline-agent-runtime",
      title: "Agent Runtime expands into managed hosting",
      memberItemIds: [
        "artifact-agent-runtime-core",
        "artifact-agent-runtime-cloud",
      ],
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
});

test("createNewsletterEdition rejects storyline member_item_ids that are out of chronological order", () => {
  assert.throws(
    () =>
      createNewsletterEdition({
        publishedAt: "2026-03-12T21:00:00.000Z",
        window: {
          startsAt: "2026-03-11T21:00:00.000Z",
          endsAt: "2026-03-12T21:00:00.000Z",
          timezone: "UTC",
        },
        items: [
          buildConsolidatedItem({
            itemId: "artifact-agent-runtime-core",
            name: "Agent Runtime Core",
            sourceUrl: "https://github.com/acme/agent-runtime",
            firstSeen: "2026-03-12T20:30:00.000Z",
            discoveredAt: "2026-03-12T20:30:00.000Z",
            storylineId: "storyline-agent-runtime",
          }),
          buildConsolidatedItem({
            itemId: "artifact-agent-runtime-cloud",
            name: "Agent Runtime Cloud",
            sourceUrl: "https://example.com/agent-runtime-cloud",
            firstSeen: "2026-03-12T20:45:00.000Z",
            discoveredAt: "2026-03-12T20:45:00.000Z",
            storylineId: "storyline-agent-runtime",
          }),
        ],
        storylines: [
          {
            storylineId: "storyline-agent-runtime",
            title: "Agent Runtime expands into managed hosting",
            memberItemIds: [
              "artifact-agent-runtime-cloud",
              "artifact-agent-runtime-core",
            ],
            status: "developing",
          },
        ],
      }),
    /memberItemIds must be ordered chronologically/,
  );
});

test("createNewsletterEdition backfills exclusion edition context and standardizes out-of-scope reason codes", () => {
  const edition = createNewsletterEdition({
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [],
    exclusions: [
      {
        itemId: "artifact-example-chat-ui",
        name: "Prompt Helper Chat UI",
        sourceUrl: "https://example.com/prompt-helper",
        category: "tool",
        sourceKinds: ["web"],
        adapterIds: ["web-discovery"],
        reasonCode: "out-of-scope",
        timestamp: "2026-03-12T21:00:00.000Z",
      },
    ],
  });

  assert.equal(edition.exclusions[0].reason, "out_of_scope");
  assert.equal(edition.exclusions[0].reasonCode, "out_of_scope");
  assert.equal(edition.exclusions[0].exclusionReasonCode, "out_of_scope");
  assert.equal(edition.exclusions[0].phase, "scope");
  assert.deepEqual(edition.exclusions[0].editionContext, {
    editionId: "2026-03-12",
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
  });
});
