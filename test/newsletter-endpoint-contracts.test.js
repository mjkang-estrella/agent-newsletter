import test from "node:test";
import assert from "./helpers/legacy-contract-assert.js";

import {
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  createNewsletterApiHandler,
} from "../src/index.js";

const DEFAULT_NOW = "2026-03-12T21:30:00Z";
const DEFAULT_NOW_ISO = "2026-03-12T21:30:00.000Z";
const DEFAULT_RISK_DESCRIPTION =
  "Validate production readiness before enabling autonomous actions.";

function createHandler({
  listReferenceItems = async () => [],
  getItemLifecycle = async () => null,
  listActiveStorylines = async () => [],
  queryExclusionSummary = async () => createExclusionSummaryResult(),
  now = () => DEFAULT_NOW,
} = {}) {
  return createNewsletterApiHandler({
    editionRepository: {
      async getLatestPublishedEdition() {
        return null;
      },
      async listPublishedEditions() {
        return [];
      },
      listReferenceItems,
      getItemLifecycle,
      listActiveStorylines,
      queryExclusionSummary,
    },
    now,
    consumerTracking: false,
    rateLimit: false,
  });
}

function buildItem(overrides = {}) {
  return {
    itemId: "artifact-persistent-agent-runtime",
    name: "Persistent Agent Runtime",
    sourceUrl: "https://example.com/persistent-agent-runtime",
    sourceUrls: [
      "https://example.com/persistent-agent-runtime",
      "https://mirror.example.com/persistent-agent-runtime",
    ],
    category: "library",
    summary: "Persistent Agent Runtime helps autonomous agents extend their toolchain.",
    integrationHint: "Review Persistent Agent Runtime installation docs before rollout.",
    relevanceScore: 88,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
    riskWarning: {
      severity: "medium",
      description: DEFAULT_RISK_DESCRIPTION,
    },
    mentionCount: 2,
    sourceKinds: ["github", "reddit"],
    adapterIds: ["github", "reddit"],
    sourceAuthorityScore: 91,
    discoveredAt: "2026-03-12T20:30:00Z",
    firstSeen: "2026-03-10T20:30:00Z",
    editionCount: 3,
    sentimentSpread: "agree",
    storylineIds: [],
    ...overrides,
  };
}

function serializeExpectedItem(item, { storyline = null } = {}) {
  const storylineIds = item.storylineIds ?? item.storyline_ids ?? [];

  return {
    item_id: item.itemId,
    name: item.name,
    source_urls: [...item.sourceUrls],
    category: item.category,
    summary: item.summary,
    integration_hint: item.integrationHint,
    relevance_score: item.relevanceScore,
    score_version: item.scoreVersion,
    score_interpretation: item.scoreInterpretation,
    divergence_flag: item.sentimentSpread !== "agree",
    risk_warning: {
      security: {
        severity: item.riskWarning.severity,
        description: item.riskWarning.description,
      },
      maturity: {
        severity: item.riskWarning.severity,
        description: item.riskWarning.description,
      },
      adoption_complexity: {
        severity: item.riskWarning.severity,
        description: item.riskWarning.description,
      },
    },
    mention_count: item.mentionCount,
    sentiment_spread:
      item.sentimentSpread === "agree"
        ? {
            classification: "agree",
          }
        : {
            classification: item.sentimentSpread.classification,
            disagreement_dimension: item.sentimentSpread.disagreementDimension,
          },
    first_seen: new Date(item.firstSeen).toISOString(),
    edition_count: item.editionCount,
    storyline_ids: [...storylineIds],
    storyline,
    scope_version: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
  };
}

function createExclusionSummaryResult(overrides = {}) {
  return {
    archiveWindowDays: 7,
    generatedAt: DEFAULT_NOW_ISO,
    filters: {
      publishedFrom: "2026-03-05T21:30:00.000Z",
      publishedTo: DEFAULT_NOW_ISO,
      reason: "relevance_below_threshold",
      category: "library",
      sourceKind: "github",
      adapterId: "github",
      itemId: "artifact-agent-memory-pack",
      phase: "scoring",
    },
    totals: {
      scannedEditionCount: 4,
      matchedEditionCount: 2,
      distinctItemCount: 2,
      totalExcludedItems: 3,
      exclusionGroupCount: 1,
    },
    exclusionSummary: {
      totalExcludedItems: 3,
      countsByCategoryAndReason: [
        {
          category: "library",
          reasonCode: "relevance_below_threshold",
          count: 3,
        },
      ],
    },
    ...overrides,
  };
}

function parseJson(response) {
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  return JSON.parse(response.body);
}

test("GET /api/newsletter/reference returns the public reference contract", async () => {
  const item = buildItem();
  const handler = createHandler({
    listReferenceItems: async () => [item],
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/reference",
  });
  const body = parseJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    archive_window_days: 7,
    generated_at: DEFAULT_NOW_ISO,
    item_count: 1,
    items: [serializeExpectedItem(item)],
  });
});

test("GET /api/newsletter/reference returns a JSON 500 error when lookup fails", async () => {
  const handler = createHandler({
    listReferenceItems: async () => {
      throw new Error("reference index unavailable");
    },
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/reference",
  });
  const body = parseJson(response);

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    error: "internal_server_error",
    message: "reference index unavailable",
  });
});

test("GET /api/newsletter/item/:id returns the public lifecycle payload", async () => {
  const item = buildItem({
    itemId: "artifact-persistent-agent-runtime",
    storylineIds: ["storyline-agent-runtime"],
    editionCount: 1,
  });
  const handler = createHandler({
    getItemLifecycle: async () => ({
      itemId: item.itemId,
      firstSeen: item.firstSeen,
      editionCount: 1,
      storyline: {
        storylineId: "storyline-agent-runtime",
        title: "Agent Runtime rollout",
        status: "stable",
        memberItemIds: ["artifact-persistent-agent-runtime", "artifact-agent-runtime-cloud"],
        firstSeen: "2026-03-10T20:30:00Z",
        lastSeen: "2026-03-12T20:30:00Z",
        updatedAt: "2026-03-12T21:00:00Z",
        lastEvolutionAt: "2026-03-12T21:00:00Z",
        evolutionCount: 1,
        repetitionCount: 0,
        repetitionStreak: 0,
      },
      appearances: [
        {
          editionId: "2026-03-12",
          publishedAt: "2026-03-12T21:00:00Z",
          window: {
            startsAt: "2026-03-11T21:00:00Z",
            endsAt: "2026-03-12T21:00:00Z",
            timezone: "UTC",
          },
          item,
          storyline: {
            storylineId: "storyline-agent-runtime",
            title: "Agent Runtime rollout",
            status: "stable",
            position: 1,
            memberItemIds: ["artifact-persistent-agent-runtime", "artifact-agent-runtime-cloud"],
            firstSeen: "2026-03-10T20:30:00Z",
            lastSeen: "2026-03-12T20:30:00Z",
            updatedAt: "2026-03-12T21:00:00Z",
            lastEvolutionAt: "2026-03-12T21:00:00Z",
            evolutionCount: 1,
            repetitionCount: 0,
            repetitionStreak: 0,
            relationship: {
              decision: "origin",
              explanation: "First tracked appearance in the storyline.",
              priorAppearanceCount: 0,
              previousAppearance: null,
              signals: {
                factOverlapRatio: 0,
                novelFactCount: 0,
                novelTokenRatio: 0,
                newSourceClusterCount: 0,
              },
            },
          },
        },
      ],
    }),
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/item/artifact-persistent-agent-runtime",
  });
  const body = parseJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    item_id: "artifact-persistent-agent-runtime",
    first_seen: "2026-03-10T20:30:00.000Z",
    edition_count: 1,
    first_appearance: {
      edition_id: "2026-03-12",
      published_at: "2026-03-12T21:00:00.000Z",
      appearance_number: 1,
      relevance_score: 88,
      score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
      divergence_flag: false,
      storyline_ids: ["storyline-agent-runtime"],
    },
    repeat_appearances: [],
    score_evolution: [
      {
        edition_id: "2026-03-12",
        published_at: "2026-03-12T21:00:00.000Z",
        relevance_score: 88,
        score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
        divergence_flag: false,
        delta_from_previous: null,
        delta_from_first_appearance: 0,
      },
    ],
    storyline: {
      storyline_id: "storyline-agent-runtime",
      title: "Agent Runtime rollout",
      status: "stable",
      member_item_ids: ["artifact-persistent-agent-runtime", "artifact-agent-runtime-cloud"],
      related_item_ids: ["artifact-agent-runtime-cloud"],
      first_seen: "2026-03-10T20:30:00.000Z",
      last_seen: "2026-03-12T20:30:00.000Z",
      updated_at: "2026-03-12T21:00:00.000Z",
      last_evolution_at: "2026-03-12T21:00:00.000Z",
      evolution_count: 1,
      repetition_count: 0,
      repetition_streak: 0,
    },
    storyline_membership: [
      {
        edition_id: "2026-03-12",
        published_at: "2026-03-12T21:00:00.000Z",
        storyline_ids: ["storyline-agent-runtime"],
        primary_storyline_id: "storyline-agent-runtime",
        primary_storyline_title: "Agent Runtime rollout",
        primary_storyline_status: "stable",
        position: 1,
        relationship_decision: "origin",
      },
    ],
    appearances: [
      {
        edition_id: "2026-03-12",
        published_at: "2026-03-12T21:00:00.000Z",
        content_window: {
          starts_at: "2026-03-11T21:00:00.000Z",
          ends_at: "2026-03-12T21:00:00.000Z",
          timezone: "UTC",
        },
        item: serializeExpectedItem(item, {
          storyline: {
            storyline_id: "storyline-agent-runtime",
            title: "Agent Runtime rollout",
            status: "stable",
            position: 1,
            member_item_ids: [
              "artifact-persistent-agent-runtime",
              "artifact-agent-runtime-cloud",
            ],
            related_item_ids: ["artifact-agent-runtime-cloud"],
            relationship: {
              decision: "origin",
              explanation: "First tracked appearance in the storyline.",
              prior_appearance_count: 0,
              previous_appearance: null,
              signals: {
                fact_overlap_ratio: 0,
                novel_fact_count: 0,
                novel_token_ratio: 0,
                new_source_cluster_count: 0,
              },
            },
          },
        }),
        storyline: {
          storyline_id: "storyline-agent-runtime",
          title: "Agent Runtime rollout",
          status: "stable",
          position: 1,
          member_item_ids: [
            "artifact-persistent-agent-runtime",
            "artifact-agent-runtime-cloud",
          ],
          related_item_ids: ["artifact-agent-runtime-cloud"],
          relationship: {
            decision: "origin",
            explanation: "First tracked appearance in the storyline.",
            prior_appearance_count: 0,
            previous_appearance: null,
            signals: {
              fact_overlap_ratio: 0,
              novel_fact_count: 0,
              novel_token_ratio: 0,
              new_source_cluster_count: 0,
            },
          },
        },
      },
    ],
  });
});

test("GET /api/newsletter/item/:id returns a JSON 404 error when the item is missing", async () => {
  const handler = createHandler();

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/item/artifact-missing-agent-runtime",
  });
  const body = parseJson(response);

  assert.equal(response.status, 404);
  assert.deepEqual(body, {
    error: "not_found",
    message: "No published newsletter item is available for the requested id.",
  });
});

test("GET /api/newsletter/item/:id returns a JSON 500 error when lifecycle loading fails", async () => {
  const handler = createHandler({
    getItemLifecycle: async () => {
      throw new Error("item lifecycle unavailable");
    },
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/item/artifact-persistent-agent-runtime",
  });
  const body = parseJson(response);

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    error: "internal_server_error",
    message: "item lifecycle unavailable",
  });
});

test("GET /api/newsletter/storylines returns the public storyline payload", async () => {
  const item = buildItem({
    itemId: "artifact-agent-runtime-cloud",
    name: "Agent Runtime Cloud",
    category: "tool",
    summary: "Managed hosting for the Agent Runtime ecosystem.",
    integrationHint: "Review deployment docs before adoption.",
    firstSeen: "2026-03-11T20:45:00Z",
    editionCount: 1,
    sentimentSpread: {
      classification: "mixed",
      disagreementDimension: "utility",
    },
    storylineIds: ["storyline-agent-runtime"],
  });
  const handler = createHandler({
    listActiveStorylines: async () => [
      {
        storylineId: "storyline-agent-runtime",
        title: "Agent Runtime expands into managed hosting",
        status: "stable",
        memberItemIds: ["artifact-agent-runtime-core", "artifact-agent-runtime-cloud"],
        firstSeen: "2026-03-10T20:30:00Z",
        lastSeen: "2026-03-11T20:45:00Z",
        updatedAt: "2026-03-12T21:00:00Z",
        lastEvolutionAt: "2026-03-12T21:00:00Z",
        evolutionCount: 2,
        repetitionCount: 0,
        repetitionStreak: 0,
        items: [item],
      },
    ],
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/storylines",
  });
  const body = parseJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    generated_at: DEFAULT_NOW_ISO,
    storyline_count: 1,
    storylines: [
      {
        storyline_id: "storyline-agent-runtime",
        title: "Agent Runtime expands into managed hosting",
        member_item_ids: ["artifact-agent-runtime-core", "artifact-agent-runtime-cloud"],
        status: "stable",
        relationship_metadata: {
          fork: {
            parent_storyline_ids: [],
            child_storyline_ids: [],
          },
          merge: {
            source_storyline_ids: [],
            target_storyline_id: null,
          },
        },
        first_seen: "2026-03-10T20:30:00.000Z",
        last_seen: "2026-03-11T20:45:00.000Z",
        updated_at: "2026-03-12T21:00:00.000Z",
        last_evolution_at: "2026-03-12T21:00:00.000Z",
        evolution_count: 2,
        repetition_count: 0,
        repetition_streak: 0,
        item_count: 1,
        items: [
          serializeExpectedItem(item, {
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
              relationship: null,
            },
          }),
        ],
      },
    ],
  });
});

test("GET /api/newsletter/storylines returns a JSON 500 error when loading fails", async () => {
  const handler = createHandler({
    listActiveStorylines: async () => {
      throw new Error("storylines unavailable");
    },
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/storylines",
  });
  const body = parseJson(response);

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    error: "internal_server_error",
    message: "storylines unavailable",
  });
});

test("GET /api/newsletter/exclusions returns the public exclusion summary payload", async () => {
  const handler = createHandler({
    queryExclusionSummary: async () => createExclusionSummaryResult(),
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/exclusions?category=library&reason=relevance_below_threshold",
  });
  const body = parseJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    archive_window_days: 7,
    generated_at: DEFAULT_NOW_ISO,
    filters: {
      published_from: "2026-03-05T21:30:00.000Z",
      published_to: DEFAULT_NOW_ISO,
      reason: "relevance_below_threshold",
      category: "library",
      source_kind: "github",
      adapter_id: "github",
      item_id: "artifact-agent-memory-pack",
      phase: "scoring",
    },
    totals: {
      scanned_edition_count: 4,
      matched_edition_count: 2,
      distinct_item_count: 2,
      total_excluded_items: 3,
      exclusion_group_count: 1,
    },
    exclusion_summary: {
      total_excluded_items: 3,
      counts_by_category: [
        {
          category: "library",
          count: 3,
        },
      ],
      counts_by_reason_code: [
        {
          reason_code: "relevance_below_threshold",
          count: 3,
        },
      ],
      counts_by_category_and_reason: [
        {
          category: "library",
          reason_code: "relevance_below_threshold",
          count: 3,
        },
      ],
    },
  });
});

test("GET /api/newsletter/exclusions returns a JSON 500 error when loading fails", async () => {
  const handler = createHandler({
    queryExclusionSummary: async () => {
      throw new Error("exclusion summary unavailable");
    },
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/exclusions",
  });
  const body = parseJson(response);

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    error: "internal_server_error",
    message: "exclusion summary unavailable",
  });
});
