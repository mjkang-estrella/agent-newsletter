import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  NewsletterEditionRepository,
  createNewsletterApiHandler,
} from "../src/index.js";

function buildStorylineItem({
  itemId,
  name,
  sourceUrl,
  category = "tool",
  summary,
  integrationHint,
  relevanceScore = 84,
  discoveredAt,
  firstSeen = discoveredAt,
  editionCount = 1,
  storylineId,
  storylineTitle,
  storylineStatus,
  memberItemIds,
  parentStorylineIds = [],
  childStorylineIds = [],
  mergedStorylineIds = [],
  mergedIntoStorylineId = null,
  narrativeType = null,
  updatedAt,
  lastEvolutionAt = updatedAt,
  evolutionCount = 1,
  repetitionCount = 0,
  repetitionStreak = 0,
  disagreementDimension = null,
} = {}) {
  return {
    itemId,
    name,
    sourceUrl,
    sourceUrls: [sourceUrl, `${sourceUrl}/docs`],
    category,
    summary,
    integrationHint,
    relevanceScore,
    riskWarning: {
      severity: "medium",
      description: "Validate production readiness before enabling autonomous actions.",
    },
    mentionCount: 2,
    sourceKinds: ["github", "reddit"],
    adapterIds: ["github", "reddit"],
    sourceAuthorityScore: 91,
    discoveredAt,
    firstSeen,
    editionCount,
    storylineId,
    sentimentSpread:
      disagreementDimension == null
        ? "agree"
        : {
            classification: "mixed",
            disagreementDimension,
          },
    metadata: {
      storyline: {
        storylineId,
        title: storylineTitle,
        status: storylineStatus,
        member_item_ids: memberItemIds,
        ...(parentStorylineIds.length > 0
          ? { parent_storyline_ids: parentStorylineIds }
          : {}),
        ...(childStorylineIds.length > 0
          ? { child_storyline_ids: childStorylineIds }
          : {}),
        ...(mergedStorylineIds.length > 0
          ? { merged_storyline_ids: mergedStorylineIds }
          : {}),
        ...(mergedIntoStorylineId
          ? { merged_into_storyline_id: mergedIntoStorylineId }
          : {}),
        ...(narrativeType ? { narrative_type: narrativeType } : {}),
        first_seen: firstSeen,
        last_seen: discoveredAt,
        updated_at: updatedAt,
        last_evolution_at: lastEvolutionAt,
        evolution_count: evolutionCount,
        repetition_count: repetitionCount,
        repetition_streak: repetitionStreak,
      },
    },
  };
}

function buildEdition(day, items, { timezone = "UTC" } = {}) {
  const publishedAt = `2026-03-${String(day).padStart(2, "0")}T21:00:00Z`;

  return {
    id: `2026-03-${String(day).padStart(2, "0")}`,
    publishedAt,
    window: {
      startsAt: `2026-03-${String(day - 1).padStart(2, "0")}T21:00:00Z`,
      endsAt: publishedAt,
      timezone,
    },
    items,
    storylines: items.map((item) => ({
      storylineId: item.storylineId,
      title: item.metadata.storyline.title,
      memberItemIds: [item.itemId],
      ...(item.metadata.storyline.parent_storyline_ids
        ? { parentStorylineIds: item.metadata.storyline.parent_storyline_ids }
        : {}),
      ...(item.metadata.storyline.child_storyline_ids
        ? { childStorylineIds: item.metadata.storyline.child_storyline_ids }
        : {}),
      ...(item.metadata.storyline.merged_storyline_ids
        ? { mergedStorylineIds: item.metadata.storyline.merged_storyline_ids }
        : {}),
      ...(item.metadata.storyline.merged_into_storyline_id
        ? { mergedIntoStorylineId: item.metadata.storyline.merged_into_storyline_id }
        : {}),
      ...(item.metadata.storyline.narrative_type
        ? { narrativeType: item.metadata.storyline.narrative_type }
        : {}),
      status: item.metadata.storyline.status,
    })),
  };
}

async function createRepository(editions) {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new NewsletterEditionRepository({
    filePath: join(directory, "newsletter-editions.json"),
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:05:00Z",
    editions,
  });

  return repository;
}

function buildStorylineFallbackEditions() {
  return [
    buildEdition(10, [
      buildStorylineItem({
        itemId: "artifact-agent-runtime-sdk",
        name: "Agent Runtime SDK",
        sourceUrl: "https://github.com/acme/agent-runtime-sdk",
        category: "library",
        summary: "SDK for the first generation of Agent Runtime integrations.",
        integrationHint: "npm install @acme/agent-runtime-sdk",
        discoveredAt: "2026-03-10T20:30:00Z",
        storylineId: "storyline-agent-runtime-sdk",
        storylineTitle: "Agent Runtime SDK rollout",
        storylineStatus: "developing",
        memberItemIds: ["artifact-agent-runtime-sdk"],
        updatedAt: "2026-03-10T21:00:00Z",
      }),
    ]),
    buildEdition(11, [
      buildStorylineItem({
        itemId: "artifact-agent-runtime-platform",
        name: "Agent Runtime Platform",
        sourceUrl: "https://example.com/agent-runtime-platform",
        summary: "Platform layer that absorbs the SDK rollout into a managed runtime.",
        integrationHint: "Review platform migration docs before consolidating runtimes.",
        discoveredAt: "2026-03-11T20:45:00Z",
        firstSeen: "2026-03-11T20:45:00Z",
        editionCount: 1,
        storylineId: "storyline-agent-runtime-platform",
        storylineTitle: "Agent Runtime platform consolidation",
        storylineStatus: "stable",
        memberItemIds: [
          "artifact-agent-runtime-sdk",
          "artifact-agent-runtime-platform",
        ],
        parentStorylineIds: ["storyline-agent-runtime-origins"],
        childStorylineIds: ["storyline-agent-runtime-ops"],
        mergedStorylineIds: ["storyline-agent-runtime-sdk"],
        narrativeType: {
          key: "platform-consolidation",
          label: "Platform consolidation",
          metadata: {
            phase: "migration",
          },
        },
        updatedAt: "2026-03-11T21:00:00Z",
        lastEvolutionAt: "2026-03-11T21:00:00Z",
        evolutionCount: 2,
      }),
    ]),
  ];
}

test("NewsletterEditionRepository returns only active storylines with chronologically grouped items", async () => {
  const runtimeCore = buildStorylineItem({
    itemId: "artifact-agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    category: "library",
    summary: "Runtime for tool-using agents.",
    integrationHint: "npm install agent-runtime",
    discoveredAt: "2026-03-10T20:30:00Z",
    storylineId: "storyline-agent-runtime",
    storylineTitle: "Agent Runtime expands into managed hosting",
    storylineStatus: "developing",
    memberItemIds: ["artifact-agent-runtime-core"],
    updatedAt: "2026-03-10T21:00:00Z",
  });
  const runtimeCloud = buildStorylineItem({
    itemId: "artifact-agent-runtime-cloud",
    name: "Agent Runtime Cloud",
    sourceUrl: "https://example.com/agent-runtime-cloud",
    summary: "Managed hosting for the Agent Runtime ecosystem.",
    integrationHint: "Review deployment docs before adoption.",
    discoveredAt: "2026-03-11T20:45:00Z",
    firstSeen: "2026-03-11T20:45:00Z",
    editionCount: 1,
    storylineId: "storyline-agent-runtime",
    storylineTitle: "Agent Runtime expands into managed hosting",
    storylineStatus: "stable",
    memberItemIds: ["artifact-agent-runtime-core", "artifact-agent-runtime-cloud"],
    parentStorylineIds: ["storyline-agent-runtime-sdk"],
    childStorylineIds: ["storyline-agent-runtime-ops"],
    mergedStorylineIds: ["storyline-agent-hosting-beta"],
    narrativeType: {
      key: "managed-hosting-expansion",
      label: "Managed hosting expansion",
      metadata: {
        phase: "launch",
      },
    },
    updatedAt: "2026-03-11T21:00:00Z",
    lastEvolutionAt: "2026-03-11T21:00:00Z",
    evolutionCount: 2,
    disagreementDimension: "utility",
  });
  const sandboxHardening = buildStorylineItem({
    itemId: "artifact-agent-sandbox-hardening",
    name: "Agent Sandbox Hardening",
    sourceUrl: "https://example.com/agent-sandbox-hardening",
    summary: "Hardening guide for tool-using agent sandboxes.",
    integrationHint: "Start in a staging environment.",
    discoveredAt: "2026-03-10T18:00:00Z",
    storylineId: "storyline-agent-sandbox",
    storylineTitle: "Agent Sandbox Hardening",
    storylineStatus: "developing",
    memberItemIds: ["artifact-agent-sandbox-hardening"],
    updatedAt: "2026-03-10T21:00:00Z",
  });
  const archivedRouter = buildStorylineItem({
    itemId: "artifact-prompt-router",
    name: "Prompt Router",
    sourceUrl: "https://example.com/prompt-router",
    summary: "Router for prompt-only workflows.",
    integrationHint: "Evaluate if you need routing before adoption.",
    discoveredAt: "2026-03-10T19:00:00Z",
    storylineId: "storyline-prompt-router",
    storylineTitle: "Prompt Router rollout",
    storylineStatus: "archived",
    memberItemIds: ["artifact-prompt-router"],
    updatedAt: "2026-03-10T21:00:00Z",
    lastEvolutionAt: "2026-03-08T21:00:00Z",
    evolutionCount: 1,
    repetitionCount: 2,
    repetitionStreak: 2,
  });
  const repository = await createRepository([
    buildEdition(10, [runtimeCore, sandboxHardening, archivedRouter]),
    buildEdition(11, [runtimeCloud]),
    {
      ...buildEdition(12, [
        buildStorylineItem({
          itemId: "artifact-future-agent-release",
          name: "Future Agent Release",
          sourceUrl: "https://example.com/future-agent-release",
          summary: "Future release notes.",
          integrationHint: "Ignore until published.",
          discoveredAt: "2026-03-12T20:30:00Z",
          storylineId: "storyline-future-agent-release",
          storylineTitle: "Future Agent Release",
          storylineStatus: "developing",
          memberItemIds: ["artifact-future-agent-release"],
          updatedAt: "2026-03-12T21:00:00Z",
        }),
      ]),
      publishedAt: "2026-03-12T21:00:00Z",
      window: {
        startsAt: "2026-03-11T21:00:00Z",
        endsAt: "2026-03-12T21:00:00Z",
        timezone: "UTC",
      },
    },
  ]);

  const storylines = await repository.listActiveStorylines({
    now: "2026-03-11T21:30:00Z",
  });

  assert.deepEqual(storylines.map((storyline) => storyline.storylineId), [
    "storyline-agent-runtime",
    "storyline-agent-sandbox",
  ]);
  assert.equal(storylines[0].status, "stable");
  assert.deepEqual(storylines[0].memberItemIds, [
    "artifact-agent-runtime-core",
    "artifact-agent-runtime-cloud",
  ]);
  assert.deepEqual(storylines[0].parentStorylineIds, ["storyline-agent-runtime-sdk"]);
  assert.deepEqual(storylines[0].childStorylineIds, ["storyline-agent-runtime-ops"]);
  assert.deepEqual(storylines[0].mergedStorylineIds, ["storyline-agent-hosting-beta"]);
  assert.deepEqual(storylines[0].narrativeType, {
    key: "managed-hosting-expansion",
    label: "Managed hosting expansion",
    metadata: {
      phase: "launch",
    },
  });
  assert.deepEqual(
    storylines[0].items.map((item) => item.itemId),
    ["artifact-agent-runtime-core", "artifact-agent-runtime-cloud"],
  );
  assert.equal(storylines[0].items[0].publishedAt, "2026-03-10T21:00:00.000Z");
  assert.equal(storylines[0].items[1].publishedAt, "2026-03-11T21:00:00.000Z");
  assert.equal(storylines[1].status, "developing");
});

test("GET /api/newsletter/storylines returns active storylines grouped by the shared item schema", async () => {
  const repository = await createRepository([
    buildEdition(10, [
      buildStorylineItem({
        itemId: "artifact-agent-runtime-core",
        name: "Agent Runtime Core",
        sourceUrl: "https://github.com/acme/agent-runtime",
        category: "library",
        summary: "Runtime for tool-using agents.",
        integrationHint: "npm install agent-runtime",
        discoveredAt: "2026-03-10T20:30:00Z",
        storylineId: "storyline-agent-runtime",
        storylineTitle: "Agent Runtime expands into managed hosting",
        storylineStatus: "developing",
        memberItemIds: ["artifact-agent-runtime-core"],
        updatedAt: "2026-03-10T21:00:00Z",
      }),
    ]),
    buildEdition(11, [
      buildStorylineItem({
        itemId: "artifact-agent-runtime-cloud",
        name: "Agent Runtime Cloud",
        sourceUrl: "https://example.com/agent-runtime-cloud",
        summary: "Managed hosting for the Agent Runtime ecosystem.",
        integrationHint: "Review deployment docs before adoption.",
        discoveredAt: "2026-03-11T20:45:00Z",
        firstSeen: "2026-03-11T20:45:00Z",
        storylineId: "storyline-agent-runtime",
        storylineTitle: "Agent Runtime expands into managed hosting",
        storylineStatus: "stable",
        memberItemIds: ["artifact-agent-runtime-core", "artifact-agent-runtime-cloud"],
        parentStorylineIds: ["storyline-agent-runtime-sdk"],
        childStorylineIds: ["storyline-agent-runtime-ops"],
        mergedStorylineIds: ["storyline-agent-hosting-beta"],
        narrativeType: {
          key: "managed-hosting-expansion",
          label: "Managed hosting expansion",
          metadata: {
            phase: "launch",
          },
        },
        updatedAt: "2026-03-11T21:00:00Z",
        lastEvolutionAt: "2026-03-11T21:00:00Z",
        evolutionCount: 2,
        disagreementDimension: "utility",
      }),
    ]),
  ]);
  const handler = createNewsletterApiHandler({
    editionRepository: repository,
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/storylines",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(body, {
    generated_at: "2026-03-11T21:30:00.000Z",
    storyline_count: 1,
    storylines: [
      {
        storyline_id: "storyline-agent-runtime",
        title: "Agent Runtime expands into managed hosting",
        member_item_ids: ["artifact-agent-runtime-core", "artifact-agent-runtime-cloud"],
        status: "stable",
        relationship_metadata: {
          fork: {
            parent_storyline_ids: ["storyline-agent-runtime-sdk"],
            child_storyline_ids: ["storyline-agent-runtime-ops"],
          },
          merge: {
            source_storyline_ids: ["storyline-agent-hosting-beta"],
            target_storyline_id: null,
          },
        },
        parent_storyline_ids: ["storyline-agent-runtime-sdk"],
        child_storyline_ids: ["storyline-agent-runtime-ops"],
        merged_storyline_ids: ["storyline-agent-hosting-beta"],
        narrative_type: {
          key: "managed-hosting-expansion",
          label: "Managed hosting expansion",
          metadata: {
            phase: "launch",
          },
        },
        first_seen: "2026-03-10T20:30:00.000Z",
        last_seen: "2026-03-11T20:45:00.000Z",
        updated_at: "2026-03-11T21:00:00.000Z",
        last_evolution_at: "2026-03-11T21:00:00.000Z",
        evolution_count: 2,
        repetition_count: 0,
        repetition_streak: 0,
        item_count: 2,
        items: [
          {
            item_id: "artifact-agent-runtime-core",
            name: "Agent Runtime Core",
            source_urls: [
              "https://github.com/acme/agent-runtime",
              "https://github.com/acme/agent-runtime/docs",
            ],
            category: "library",
            summary: "Runtime for tool-using agents.",
            integration_hint: "npm install agent-runtime",
            relevance_score: 84,
            score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
            score_interpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
            divergence_flag: false,
            risk_warning: {
              security: {
                severity: "medium",
                description:
                  "Validate production readiness before enabling autonomous actions.",
              },
              maturity: {
                severity: "medium",
                description:
                  "Validate production readiness before enabling autonomous actions.",
              },
              adoption_complexity: {
                severity: "medium",
                description:
                  "Validate production readiness before enabling autonomous actions.",
              },
            },
            mention_count: 2,
            sentiment_spread: {
              classification: "agree",
            },
            first_seen: "2026-03-10T20:30:00.000Z",
            edition_count: 1,
            storyline_ids: ["storyline-agent-runtime"],
            storyline: {
              storyline_id: "storyline-agent-runtime",
              title: "Agent Runtime expands into managed hosting",
              status: "developing",
              position: 1,
              member_item_ids: [
                "artifact-agent-runtime-core",
                "artifact-agent-runtime-cloud",
              ],
              related_item_ids: ["artifact-agent-runtime-cloud"],
              parent_storyline_ids: ["storyline-agent-runtime-sdk"],
              narrative_type: {
                key: "managed-hosting-expansion",
                label: "Managed hosting expansion",
                metadata: {
                  phase: "launch",
                },
              },
              relationship: null,
            },
            scope_version: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
          },
          {
            item_id: "artifact-agent-runtime-cloud",
            name: "Agent Runtime Cloud",
            source_urls: [
              "https://example.com/agent-runtime-cloud",
              "https://example.com/agent-runtime-cloud/docs",
            ],
            category: "tool",
            summary: "Managed hosting for the Agent Runtime ecosystem.",
            integration_hint: "Review deployment docs before adoption.",
            relevance_score: 84,
            score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
            score_interpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
            divergence_flag: true,
            risk_warning: {
              security: {
                severity: "medium",
                description:
                  "Validate production readiness before enabling autonomous actions.",
              },
              maturity: {
                severity: "medium",
                description:
                  "Validate production readiness before enabling autonomous actions.",
              },
              adoption_complexity: {
                severity: "medium",
                description:
                  "Validate production readiness before enabling autonomous actions.",
              },
            },
            mention_count: 2,
            sentiment_spread: {
              classification: "mixed",
              disagreement_dimension: "utility",
            },
            first_seen: "2026-03-11T20:45:00.000Z",
            edition_count: 1,
            storyline_ids: ["storyline-agent-runtime"],
            storyline: {
              storyline_id: "storyline-agent-runtime",
              title: "Agent Runtime expands into managed hosting",
              status: "stable",
              position: 2,
              member_item_ids: [
                "artifact-agent-runtime-core",
                "artifact-agent-runtime-cloud",
              ],
              related_item_ids: ["artifact-agent-runtime-core"],
              parent_storyline_ids: ["storyline-agent-runtime-sdk"],
              narrative_type: {
                key: "managed-hosting-expansion",
                label: "Managed hosting expansion",
                metadata: {
                  phase: "launch",
                },
              },
              relationship: null,
            },
            scope_version: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
          },
        ],
      },
    ],
  });
});

test("GET /api/newsletter/storylines derives active storyline groups from published editions when the repository omits listActiveStorylines", async () => {
  const editions = buildStorylineFallbackEditions();
  const listPublishedEditionsCalls = [];
  const handler = createNewsletterApiHandler({
    editionRepository: {
      async getLatestPublishedEdition() {
        return editions[1];
      },
      async listPublishedEditions(input) {
        listPublishedEditionsCalls.push(input);
        return [...editions].reverse();
      },
    },
    now: () => "2026-03-11T21:30:00Z",
    consumerTracking: false,
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/storylines",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(body.storyline_count, 1);
  assert.deepEqual(body.storylines.map((storyline) => storyline.storyline_id), [
    "storyline-agent-runtime-platform",
  ]);
  assert.deepEqual(body.storylines[0].member_item_ids, [
    "artifact-agent-runtime-sdk",
    "artifact-agent-runtime-platform",
  ]);
  assert.deepEqual(body.storylines[0].relationship_metadata, {
    fork: {
      parent_storyline_ids: ["storyline-agent-runtime-origins"],
      child_storyline_ids: ["storyline-agent-runtime-ops"],
    },
    merge: {
      source_storyline_ids: ["storyline-agent-runtime-sdk"],
      target_storyline_id: null,
    },
  });
  assert.deepEqual(
    body.storylines[0].items.map((item) => item.item_id),
    ["artifact-agent-runtime-sdk", "artifact-agent-runtime-platform"],
  );
  assert.equal(listPublishedEditionsCalls.length, 1);
  assert.equal(listPublishedEditionsCalls[0].now, "2026-03-11T21:30:00.000Z");
  assert.equal(listPublishedEditionsCalls[0].consumer, null);
  assert.ok(Number.isInteger(listPublishedEditionsCalls[0].days));
  assert.ok(listPublishedEditionsCalls[0].days >= 20000);
});

test("GET /api/newsletter/storylines derives active storyline groups when the API is backed by a newsletter store without loadActiveStorylines", async () => {
  const editions = buildStorylineFallbackEditions();
  const loadHistoryCalls = [];
  const handler = createNewsletterApiHandler({
    newsletterStore: {
      async loadLatest() {
        return editions[1];
      },
      async loadHistory(input) {
        loadHistoryCalls.push(input);
        return [...editions].reverse();
      },
    },
    now: () => "2026-03-11T21:30:00Z",
    consumerTracking: false,
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/storylines",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(body.storyline_count, 1);
  assert.equal(body.storylines[0].storyline_id, "storyline-agent-runtime-platform");
  assert.deepEqual(body.storylines[0].relationship_metadata.merge.source_storyline_ids, [
    "storyline-agent-runtime-sdk",
  ]);
  assert.deepEqual(body.storylines[0].relationship_metadata.fork, {
    parent_storyline_ids: ["storyline-agent-runtime-origins"],
    child_storyline_ids: ["storyline-agent-runtime-ops"],
  });
  assert.equal(loadHistoryCalls.length, 1);
  assert.equal(loadHistoryCalls[0].now, "2026-03-11T21:30:00.000Z");
  assert.ok(Number.isInteger(loadHistoryCalls[0].days));
  assert.ok(loadHistoryCalls[0].days >= 20000);
});

test("GET /api/newsletter/storylines returns an empty response shape when no active storylines are found", async () => {
  const calls = [];
  const handler = createNewsletterApiHandler({
    editionRepository: {
      async getLatestPublishedEdition() {
        return null;
      },
      async listPublishedEditions() {
        return [];
      },
      async listActiveStorylines(input) {
        calls.push(input);
        return [];
      },
    },
    now: () => "2026-03-11T21:30:00Z",
    consumerTracking: false,
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/storylines",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    generated_at: "2026-03-11T21:30:00.000Z",
    storyline_count: 0,
    storylines: [],
  });
  assert.deepEqual(calls, [
    {
      now: "2026-03-11T21:30:00.000Z",
      consumer: null,
    },
  ]);
});
