import test from "node:test";
import assert from "./helpers/legacy-contract-assert.js";

import {
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  createNormalizedItem,
  formatNewsletterArchiveResponse,
  formatNewsletterExclusionAnalyticsResponse,
  formatNewsletterExclusionSummaryResponse,
  formatNewsletterStorylinesResponse,
  serializeNewsletterEdition,
  serializeNewsletterItem,
  serializeNewsletterItemLifecycle,
} from "../src/index.js";

test("serializeNewsletterItem exposes the published item contract in JSON", () => {
  const scoreVersion = "2.1.0";
  const item = createNormalizedItem({
    itemId: "artifact-acme-open-agent-platform",
    name: "open-agent-platform",
    sourceUrl: "https://github.com/acme/open-agent-platform",
    sourceUrls: [
      "https://docs.example.com/open-agent-platform",
      "https://github.com/acme/open-agent-platform",
    ],
    category: "library",
    summary: "Framework for agent orchestration with tracing and memory.",
    integrationHint: "Install with npm or pnpm and review the typed examples.",
    relevanceScore: 83,
    scoreVersion,
    riskWarning: {
      severity: "medium",
      description: "Requires review before enabling autonomous code changes.",
    },
    mentionCount: 3,
    sourceKinds: ["github", "web"],
    adapterIds: ["github", "web-discovery"],
    sourceAuthorityScore: 95,
    publishedAt: "2026-03-11T21:00:00.000Z",
    discoveredAt: "2026-03-11T21:00:00.000Z",
    firstSeen: "2026-03-10T19:00:00.000Z",
    editionCount: 4,
    storylineId: "storyline-open-agent-platform",
    sentimentSpread: {
      classification: "mixed",
      disagreementDimension: "utility",
    },
  });

  const payload = serializeNewsletterItem(item);

  assert.deepEqual(payload, {
    item_id: "artifact-acme-open-agent-platform",
    name: "open-agent-platform",
    source_urls: [
      "https://github.com/acme/open-agent-platform",
      "https://docs.example.com/open-agent-platform",
    ],
    category: "library",
    summary: "Framework for agent orchestration with tracing and memory.",
    integration_hint: "Install with npm or pnpm and review the typed examples.",
    relevance_score: 83,
    score_version: scoreVersion,
    score_interpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
    divergence_flag: true,
    risk_warning: {
      security: {
        severity: "medium",
        description: "Requires review before enabling autonomous code changes.",
      },
      maturity: {
        severity: "medium",
        description: "Requires review before enabling autonomous code changes.",
      },
      adoption_complexity: {
        severity: "medium",
        description: "Requires review before enabling autonomous code changes.",
      },
    },
    mention_count: 3,
    sentiment_spread: {
      classification: "mixed",
      disagreement_dimension: "utility",
    },
    first_seen: "2026-03-10T19:00:00.000Z",
    edition_count: 4,
    storyline_ids: ["storyline-open-agent-platform"],
    storyline: null,
    scope_version: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
  });
  assert.equal("sourceUrl" in payload, false);
  assert.equal("source_url" in payload, false);
  assert.equal("integrationHint" in payload, false);
  assert.equal(item.divergenceFlag, true);
  assert.equal(item.metadata.scoring.divergenceFlag, true);
});

test("serializeNewsletterItem rejects unpublished items without a relevance score", () => {
  const item = createNormalizedItem({
    name: "AgentOps",
    sourceUrl: "https://github.com/example/agentops",
    category: "tool",
    summary: "Open source observability for agent systems.",
    integrationHint: "Review the setup guide before rollout.",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 95,
  });

  assert.throws(
    () => serializeNewsletterItem(item),
    /relevanceScore is required for published newsletter items/,
  );
});

test("createNormalizedItem rejects contested sentiment spreads without a disagreement dimension", () => {
  assert.throws(
    () =>
      createNormalizedItem({
        name: "AgentOps",
        sourceUrl: "https://github.com/example/agentops",
        category: "tool",
        summary: "Open source observability for agent systems.",
        integrationHint: "Review the setup guide before rollout.",
        sourceKinds: ["github"],
        adapterIds: ["github"],
        sourceAuthorityScore: 95,
        sentimentSpread: "mixed",
      }),
    /sentimentSpread\.disagreementDimension is required for contested sentiment/,
  );
});

test("createNormalizedItem resolves contested sentiment to the most corroborated disagreement dimension", () => {
  const item = createNormalizedItem({
    name: "Agent Market Watch",
    sourceUrl: "https://github.com/acme/agent-market-watch",
    sourceUrls: [
      "https://briefing.example.com/agent-market-watch",
      "https://analyst.example.com/agent-market-watch",
    ],
    category: "library",
    summary: "Agent framework with divergent source coverage across rollout and adoption.",
    integrationHint: "Validate the rollout plan before enabling it in production.",
    sourceSentiment: "positive",
    sourceKinds: ["github", "web"],
    adapterIds: ["github", "web-discovery"],
    sourceAuthorityScore: 95,
    metadata: {
      sourceSentiments: [
        {
          sourceUrl: "https://github.com/acme/agent-market-watch",
          sentiment: "positive",
          disagreementDimension: "security",
        },
        {
          sourceUrl: "https://briefing.example.com/agent-market-watch",
          sentiment: "negative",
          disagreementDimension: "market",
        },
        {
          sourceUrl: "https://analyst.example.com/agent-market-watch",
          sentiment: "neutral",
          disagreementDimension: "market",
        },
      ],
    },
  });

  assert.deepEqual(item.sentimentSpread, {
    classification: "mixed",
    disagreementDimension: "market",
  });
  assert.deepEqual(item.metadata.sourceSentiments, [
    {
      sourceUrl: "https://github.com/acme/agent-market-watch",
      sentiment: "positive",
      disagreementDimension: "security",
    },
    {
      sourceUrl: "https://briefing.example.com/agent-market-watch",
      sentiment: "negative",
      disagreementDimension: "market",
    },
    {
      sourceUrl: "https://analyst.example.com/agent-market-watch",
      sentiment: "neutral",
      disagreementDimension: "market",
    },
  ]);
});

test("serializeNewsletterEdition wraps published items with edition metadata", () => {
  const response = serializeNewsletterEdition({
    publishedAt: "2026-03-11T21:00:00.000Z",
    window: {
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        itemId: "artifact-example-agentkit",
        name: "AgentKit",
        sourceUrl: "https://github.com/example/agentkit",
        sourceUrls: [
          "https://github.com/example/agentkit",
          "https://blog.example.com/agentkit-launch",
        ],
        category: "tool",
        summary: "Composable agent runtime with tracing and memory modules.",
        integrationHint: "npm install agentkit and start with the quickstart.",
        relevanceScore: 78,
        riskWarning: {
          severity: "low",
          description: "Self-host if traces contain sensitive execution data.",
        },
        mentionCount: 2,
        sourceKinds: ["github", "web"],
        adapterIds: ["github", "web-discovery"],
        sourceAuthorityScore: 91,
        publishedAt: "2026-03-11T21:00:00.000Z",
        discoveredAt: "2026-03-11T21:00:00.000Z",
        firstSeen: "2026-03-09T21:00:00.000Z",
        editionCount: 3,
        sentimentSpread: "agree",
      },
    ],
  });

  assert.deepEqual(response, {
    edition_id: "2026-03-11",
    published_at: "2026-03-11T21:00:00.000Z",
    content_window: {
      starts_at: "2026-03-10T21:00:00.000Z",
      ends_at: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
    item_count: 1,
    items: [
      {
        item_id: "artifact-example-agentkit",
        name: "AgentKit",
        source_urls: [
          "https://github.com/example/agentkit",
          "https://blog.example.com/agentkit-launch",
        ],
        category: "tool",
        summary: "Composable agent runtime with tracing and memory modules.",
        integration_hint: "npm install agentkit and start with the quickstart.",
        relevance_score: 78,
        score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
        score_interpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
        divergence_flag: false,
        risk_warning: {
          security: {
            severity: "low",
            description: "Self-host if traces contain sensitive execution data.",
          },
          maturity: {
            severity: "low",
            description: "Self-host if traces contain sensitive execution data.",
          },
          adoption_complexity: {
            severity: "low",
            description: "Self-host if traces contain sensitive execution data.",
          },
        },
        mention_count: 2,
        sentiment_spread: {
          classification: "agree",
        },
        first_seen: "2026-03-09T21:00:00.000Z",
        edition_count: 3,
        storyline_ids: [],
        storyline: null,
        scope_version: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
      },
    ],
    storyline_count: 0,
    storylines: [],
  });
});

test("serializeNewsletterEdition derives the edition id from the publication timezone", () => {
  const response = serializeNewsletterEdition({
    publishedAt: "2026-03-12T04:00:00.000Z",
    window: {
      startsAt: "2026-03-11T04:00:00.000Z",
      endsAt: "2026-03-12T04:00:00.000Z",
      timezone: "America/Los_Angeles",
    },
    items: [],
  });

  assert.deepEqual(response, {
    edition_id: "2026-03-11",
    published_at: "2026-03-12T04:00:00.000Z",
    content_window: {
      starts_at: "2026-03-11T04:00:00.000Z",
      ends_at: "2026-03-12T04:00:00.000Z",
      timezone: "America/Los_Angeles",
    },
    item_count: 0,
    items: [],
    storyline_count: 0,
    storylines: [],
  });
});

test("formatNewsletterArchiveResponse wraps editions with shared archive metadata", () => {
  const response = formatNewsletterArchiveResponse({
    archiveWindowDays: 7,
    generatedAt: "2026-03-12T21:30:00.000Z",
    editions: [
      {
        publishedAt: "2026-03-12T21:00:00.000Z",
        window: {
          startsAt: "2026-03-11T21:00:00.000Z",
          endsAt: "2026-03-12T21:00:00.000Z",
          timezone: "UTC",
        },
        items: [],
      },
    ],
  });

  assert.deepEqual(response, {
    archive_window_days: 7,
    generated_at: "2026-03-12T21:30:00.000Z",
    editions: [
      {
        edition_id: "2026-03-12",
        published_at: "2026-03-12T21:00:00.000Z",
        content_window: {
          starts_at: "2026-03-11T21:00:00.000Z",
          ends_at: "2026-03-12T21:00:00.000Z",
          timezone: "UTC",
        },
        item_count: 0,
        items: [],
        storyline_count: 0,
        storylines: [],
      },
    ],
  });
});

test("formatNewsletterExclusionSummaryResponse exposes grouped counts by category and reason", () => {
  const response = formatNewsletterExclusionSummaryResponse({
    archiveWindowDays: 7,
    generatedAt: "2026-03-12T21:30:00.000Z",
    filters: {
      publishedFrom: "2026-03-05T21:30:00.000Z",
      publishedTo: "2026-03-12T21:30:00.000Z",
      reason: "relevance_below_threshold",
      category: "library",
      sourceKind: null,
      adapterId: null,
      itemId: null,
      phase: null,
    },
    totals: {
      scannedEditionCount: 2,
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
  });

  assert.deepEqual(response, {
    archive_window_days: 7,
    generated_at: "2026-03-12T21:30:00.000Z",
    filters: {
      published_from: "2026-03-05T21:30:00.000Z",
      published_to: "2026-03-12T21:30:00.000Z",
      reason: "relevance_below_threshold",
      category: "library",
      source_kind: null,
      adapter_id: null,
      item_id: null,
      phase: null,
    },
    totals: {
      scanned_edition_count: 2,
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

test("formatNewsletterExclusionAnalyticsResponse exposes cross-edition blind spots and recurring exclusions", () => {
  const response = formatNewsletterExclusionAnalyticsResponse({
    archiveWindowDays: 7,
    generatedAt: "2026-03-12T21:30:00.000Z",
    filters: {
      publishedFrom: "2026-03-05T21:30:00.000Z",
      publishedTo: "2026-03-12T21:30:00.000Z",
      reason: "relevance_below_threshold",
      category: "library",
      sourceKind: "github",
      adapterId: "github",
      itemId: null,
      phase: "scoring",
      minRecurringEditions: 2,
    },
    totals: {
      scannedEditionCount: 2,
      matchedEditionCount: 2,
      exclusionCount: 3,
      distinctItemCount: 2,
      recurringItemCount: 1,
      blindSpotCount: 1,
    },
    exclusions: [
      {
        editionId: "2026-03-11",
        publishedAt: "2026-03-11T21:00:00.000Z",
        itemId: "artifact-github-com-acme-agent-runtime-lite",
        name: "Agent Runtime Lite",
        sourceUrl: "https://github.com/acme/agent-runtime-lite",
        category: "library",
        sourceKinds: ["github"],
        adapterIds: ["github"],
        reason: "relevance_below_threshold",
        phase: "scoring",
        relevanceScore: 55,
        minRelevanceScore: 60,
        scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        sourceAuthorityScore: 92,
        minSourceAuthorityScore: null,
        sourceStatus: null,
        sourceLifecycleState: null,
      },
    ],
    aggregations: {
      reasons: [
        {
          reason: "relevance_below_threshold",
          exclusionCount: 3,
          distinctItemCount: 2,
          editionCount: 2,
        },
      ],
      categories: [
        {
          category: "library",
          exclusionCount: 3,
          distinctItemCount: 2,
          editionCount: 2,
        },
      ],
      phases: [
        {
          phase: "scoring",
          exclusionCount: 3,
          distinctItemCount: 2,
          editionCount: 2,
        },
      ],
      sourceKinds: [
        {
          source_kind: "github",
          exclusionCount: 3,
          distinctItemCount: 2,
          editionCount: 2,
        },
      ],
      adapterIds: [
        {
          adapter_id: "github",
          exclusionCount: 3,
          distinctItemCount: 2,
          editionCount: 2,
        },
      ],
      categoryReasonCodes: [
        {
          category: "library",
          reasonCode: "relevance_below_threshold",
          exclusionCount: 3,
          distinctItemCount: 2,
          editionCount: 2,
          firstExcludedAt: "2026-03-10T21:00:00.000Z",
          lastExcludedAt: "2026-03-11T21:00:00.000Z",
        },
      ],
      editions: [
        {
          editionId: "2026-03-11",
          publishedAt: "2026-03-11T21:00:00.000Z",
          exclusionCount: 2,
          distinctItemCount: 2,
        },
      ],
    },
    recurringItems: [
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
    ],
    blindSpots: [
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
    ],
  });

  assert.deepEqual(response, {
    archive_window_days: 7,
    generated_at: "2026-03-12T21:30:00.000Z",
    filters: {
      published_from: "2026-03-05T21:30:00.000Z",
      published_to: "2026-03-12T21:30:00.000Z",
      reason_code: "relevance_below_threshold",
      category: "library",
      source_kind: "github",
      adapter_id: "github",
      item_id: null,
      phase: "scoring",
      min_recurring_editions: 2,
    },
    totals: {
      scanned_edition_count: 2,
      matched_edition_count: 2,
      exclusion_count: 3,
      distinct_item_count: 2,
      recurring_item_count: 1,
      blind_spot_count: 1,
    },
    exclusions: [
      {
        edition_id: "2026-03-11",
        published_at: "2026-03-11T21:00:00.000Z",
        item_id: "artifact-github-com-acme-agent-runtime-lite",
        name: "Agent Runtime Lite",
        source_url: "https://github.com/acme/agent-runtime-lite",
        category: "library",
        source_kinds: ["github"],
        adapter_ids: ["github"],
        reason_code: "relevance_below_threshold",
        phase: "scoring",
        relevance_score: 55,
        min_relevance_score: 60,
        score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
        source_authority_score: 92,
        min_source_authority_score: null,
        source_status: null,
        source_lifecycle_state: null,
      },
    ],
    aggregations: {
      reason_codes: [
        {
          reason_code: "relevance_below_threshold",
          exclusion_count: 3,
          distinct_item_count: 2,
          edition_count: 2,
        },
      ],
      categories: [
        {
          category: "library",
          exclusion_count: 3,
          distinct_item_count: 2,
          edition_count: 2,
        },
      ],
      phases: [
        {
          phase: "scoring",
          exclusion_count: 3,
          distinct_item_count: 2,
          edition_count: 2,
        },
      ],
      source_kinds: [
        {
          source_kind: "github",
          exclusion_count: 3,
          distinct_item_count: 2,
          edition_count: 2,
        },
      ],
      adapter_ids: [
        {
          adapter_id: "github",
          exclusion_count: 3,
          distinct_item_count: 2,
          edition_count: 2,
        },
      ],
      category_reason_codes: [
        {
          category: "library",
          reason_code: "relevance_below_threshold",
          exclusion_count: 3,
          distinct_item_count: 2,
          edition_count: 2,
          first_excluded_at: "2026-03-10T21:00:00.000Z",
          last_excluded_at: "2026-03-11T21:00:00.000Z",
        },
      ],
      editions: [
        {
          edition_id: "2026-03-11",
          published_at: "2026-03-11T21:00:00.000Z",
          exclusion_count: 2,
          distinct_item_count: 2,
        },
      ],
    },
    recurring_items: [
      {
        item_id: "artifact-github-com-acme-agent-runtime-lite",
        name: "Agent Runtime Lite",
        category: "library",
        exclusion_count: 2,
        edition_count: 2,
        reason_codes: ["relevance_below_threshold"],
        first_excluded_at: "2026-03-10T21:00:00.000Z",
        last_excluded_at: "2026-03-11T21:00:00.000Z",
      },
    ],
    blind_spots: [
      {
        blind_spot_key: "category:library|reason:relevance_below_threshold",
        category: "library",
        reason_code: "relevance_below_threshold",
        exclusion_count: 3,
        distinct_item_count: 2,
        edition_count: 2,
        first_excluded_at: "2026-03-10T21:00:00.000Z",
        last_excluded_at: "2026-03-11T21:00:00.000Z",
      },
    ],
  });
});

test("formatNewsletterStorylinesResponse groups active storylines with the shared item schema", () => {
  const response = formatNewsletterStorylinesResponse({
    generatedAt: "2026-03-12T21:30:00.000Z",
    storylines: [
      {
        storylineId: "storyline-agent-runtime",
        title: "Agent Runtime expands into managed hosting",
        status: "stable",
        parentStorylineIds: [
          "storyline-agent-runtime-sdk",
          "storyline-agent-hosting-beta",
        ],
        childStorylineIds: ["storyline-agent-runtime-ops"],
        mergedStorylineIds: ["storyline-agent-hosting-beta"],
        firstSeen: "2026-03-10T20:30:00.000Z",
        lastSeen: "2026-03-12T20:45:00.000Z",
        updatedAt: "2026-03-12T21:00:00.000Z",
        lastEvolutionAt: "2026-03-11T21:00:00.000Z",
        evolutionCount: 2,
        repetitionCount: 1,
        repetitionStreak: 0,
        items: [
          createNormalizedItem({
            itemId: "artifact-agent-runtime-core",
            name: "Agent Runtime Core",
            sourceUrl: "https://github.com/acme/agent-runtime",
            category: "library",
            summary: "Runtime for tool-using agents.",
            integrationHint: "npm install agent-runtime",
            relevanceScore: 84,
            riskWarning: {
              severity: "medium",
              description: "Validate isolation before rollout.",
            },
            mentionCount: 2,
            sourceKinds: ["github"],
            adapterIds: ["github"],
            sourceAuthorityScore: 92,
            discoveredAt: "2026-03-10T20:30:00.000Z",
            firstSeen: "2026-03-10T20:30:00.000Z",
            publishedAt: "2026-03-10T21:00:00.000Z",
            editionCount: 1,
            storylineId: "storyline-agent-runtime",
            sentimentSpread: "agree",
          }),
          createNormalizedItem({
            itemId: "artifact-agent-runtime-cloud",
            name: "Agent Runtime Cloud",
            sourceUrl: "https://example.com/agent-runtime-cloud",
            category: "tool",
            summary: "Managed hosting for the Agent Runtime ecosystem.",
            integrationHint: "Review deployment docs before adoption.",
            relevanceScore: 87,
            riskWarning: {
              severity: "medium",
              description: "Review sandbox boundaries before use.",
            },
            mentionCount: 2,
            sourceKinds: ["web"],
            adapterIds: ["web-discovery"],
            sourceAuthorityScore: 80,
            discoveredAt: "2026-03-12T20:45:00.000Z",
            firstSeen: "2026-03-11T20:40:00.000Z",
            publishedAt: "2026-03-12T21:00:00.000Z",
            editionCount: 2,
            storylineId: "storyline-agent-runtime",
            sentimentSpread: {
              classification: "mixed",
              disagreementDimension: "utility",
            },
          }),
        ],
      },
    ],
  });

  assert.deepEqual(response, {
    generated_at: "2026-03-12T21:30:00.000Z",
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
        parent_storyline_ids: [
          "storyline-agent-runtime-sdk",
          "storyline-agent-hosting-beta",
        ],
        child_storyline_ids: ["storyline-agent-runtime-ops"],
        merged_storyline_ids: ["storyline-agent-hosting-beta"],
        first_seen: "2026-03-10T20:30:00.000Z",
        last_seen: "2026-03-12T20:45:00.000Z",
        updated_at: "2026-03-12T21:00:00.000Z",
        last_evolution_at: "2026-03-11T21:00:00.000Z",
        evolution_count: 2,
        repetition_count: 1,
        repetition_streak: 0,
        item_count: 2,
        items: [
          {
            item_id: "artifact-agent-runtime-core",
            name: "Agent Runtime Core",
            source_urls: ["https://github.com/acme/agent-runtime"],
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
                description: "Validate isolation before rollout.",
              },
              maturity: {
                severity: "medium",
                description: "Validate isolation before rollout.",
              },
              adoption_complexity: {
                severity: "medium",
                description: "Validate isolation before rollout.",
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
              status: "stable",
              position: 1,
              member_item_ids: [
                "artifact-agent-runtime-core",
                "artifact-agent-runtime-cloud",
              ],
              related_item_ids: ["artifact-agent-runtime-cloud"],
              parent_storyline_ids: [
                "storyline-agent-runtime-sdk",
                "storyline-agent-hosting-beta",
              ],
              relationship: null,
            },
            scope_version: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
          },
          {
            item_id: "artifact-agent-runtime-cloud",
            name: "Agent Runtime Cloud",
            source_urls: ["https://example.com/agent-runtime-cloud"],
            category: "tool",
            summary: "Managed hosting for the Agent Runtime ecosystem.",
            integration_hint: "Review deployment docs before adoption.",
            relevance_score: 87,
            score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
            score_interpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
            divergence_flag: true,
            risk_warning: {
              security: {
                severity: "medium",
                description: "Review sandbox boundaries before use.",
              },
              maturity: {
                severity: "medium",
                description: "Review sandbox boundaries before use.",
              },
              adoption_complexity: {
                severity: "medium",
                description: "Review sandbox boundaries before use.",
              },
            },
            mention_count: 2,
            sentiment_spread: {
              classification: "mixed",
              disagreement_dimension: "utility",
            },
            first_seen: "2026-03-11T20:40:00.000Z",
            edition_count: 2,
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
              parent_storyline_ids: [
                "storyline-agent-runtime-sdk",
                "storyline-agent-hosting-beta",
              ],
              relationship: null,
            },
            scope_version: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
          },
        ],
      },
    ],
  });
});

test("serializeNewsletterItemLifecycle wraps an item's edition appearances", () => {
  const response = serializeNewsletterItemLifecycle({
    itemId: "artifact-example-agentkit",
    firstSeen: "2026-03-09T21:00:00.000Z",
    editionCount: 2,
    storyline: {
      storylineId: "storyline-agentkit-rollout",
      title: "AgentKit rollout",
      status: "stable",
      memberItemIds: ["artifact-example-agentkit", "artifact-agentkit-memory"],
      relatedItemIds: ["artifact-agentkit-memory"],
      firstSeen: "2026-03-09T21:00:00.000Z",
      lastSeen: "2026-03-11T21:00:00.000Z",
      updatedAt: "2026-03-11T21:00:00.000Z",
      lastEvolutionAt: "2026-03-11T21:00:00.000Z",
      evolutionCount: 2,
      repetitionCount: 0,
      repetitionStreak: 0,
    },
    appearances: [
      {
        editionId: "2026-03-10",
        publishedAt: "2026-03-10T21:00:00.000Z",
        window: {
          startsAt: "2026-03-09T21:00:00.000Z",
          endsAt: "2026-03-10T21:00:00.000Z",
          timezone: "UTC",
        },
        item: {
          itemId: "artifact-example-agentkit",
          name: "AgentKit",
          sourceUrl: "https://github.com/example/agentkit",
          sourceUrls: [
            "https://github.com/example/agentkit",
            "https://blog.example.com/agentkit-launch",
          ],
          category: "tool",
          summary: "Composable agent runtime with tracing and memory modules.",
          integrationHint: "npm install agentkit and start with the quickstart.",
          relevanceScore: 78,
          riskWarning: {
            severity: "low",
            description: "Self-host if traces contain sensitive execution data.",
          },
          mentionCount: 2,
          sourceKinds: ["github", "web"],
          adapterIds: ["github", "web-discovery"],
          sourceAuthorityScore: 91,
          publishedAt: "2026-03-10T21:00:00.000Z",
          discoveredAt: "2026-03-10T21:00:00.000Z",
          firstSeen: "2026-03-09T21:00:00.000Z",
          editionCount: 1,
          sentimentSpread: "agree",
        },
        storyline: {
          storylineId: "storyline-agentkit-rollout",
          title: "AgentKit rollout",
          status: "developing",
          memberItemIds: ["artifact-example-agentkit"],
          relatedItemIds: [],
          position: 1,
          relationship: {
            decision: "origin",
            explanation: "First appearance in this storyline.",
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
      {
        editionId: "2026-03-11",
        publishedAt: "2026-03-11T21:00:00.000Z",
        window: {
          startsAt: "2026-03-10T21:00:00.000Z",
          endsAt: "2026-03-11T21:00:00.000Z",
          timezone: "UTC",
        },
        item: {
          itemId: "artifact-example-agentkit",
          name: "AgentKit",
          sourceUrl: "https://github.com/example/agentkit",
          sourceUrls: [
            "https://github.com/example/agentkit",
            "https://blog.example.com/agentkit-launch",
          ],
          category: "tool",
          summary: "Composable agent runtime with tracing and memory modules.",
          integrationHint: "npm install agentkit and start with the quickstart.",
          relevanceScore: 78,
          riskWarning: {
            severity: "low",
            description: "Self-host if traces contain sensitive execution data.",
          },
          mentionCount: 2,
          sourceKinds: ["github", "web"],
          adapterIds: ["github", "web-discovery"],
          sourceAuthorityScore: 91,
          publishedAt: "2026-03-11T21:00:00.000Z",
          discoveredAt: "2026-03-11T21:00:00.000Z",
          firstSeen: "2026-03-09T21:00:00.000Z",
          editionCount: 2,
          sentimentSpread: "agree",
        },
        storyline: {
          storylineId: "storyline-agentkit-rollout",
          title: "AgentKit rollout",
          status: "stable",
          memberItemIds: ["artifact-example-agentkit", "artifact-agentkit-memory"],
          relatedItemIds: ["artifact-agentkit-memory"],
          position: 1,
          relationship: {
            decision: "evolution",
            explanation: "Introduces 1 novel fact clause with 25% novel tokens.",
            priorAppearanceCount: 1,
            previousAppearance: {
              editionId: "2026-03-10",
              publishedAt: "2026-03-10T21:00:00.000Z",
              sourceUrl: "https://github.com/example/agentkit",
            },
            signals: {
              factOverlapRatio: 0.4,
              novelFactCount: 1,
              novelTokenRatio: 0.25,
              newSourceClusterCount: 1,
            },
          },
        },
      },
    ],
  });

  assert.deepEqual(response, {
    item_id: "artifact-example-agentkit",
    first_seen: "2026-03-09T21:00:00.000Z",
    edition_count: 2,
    first_appearance: {
      edition_id: "2026-03-10",
      published_at: "2026-03-10T21:00:00.000Z",
      appearance_number: 1,
      relevance_score: 78,
      score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
      divergence_flag: false,
      storyline_ids: [],
    },
    repeat_appearances: [
      {
        edition_id: "2026-03-11",
        published_at: "2026-03-11T21:00:00.000Z",
        appearance_number: 2,
        relevance_score: 78,
        score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
        divergence_flag: false,
        storyline_ids: [],
      },
    ],
    score_evolution: [
      {
        edition_id: "2026-03-10",
        published_at: "2026-03-10T21:00:00.000Z",
        relevance_score: 78,
        score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
        divergence_flag: false,
        delta_from_previous: null,
        delta_from_first_appearance: 0,
      },
      {
        edition_id: "2026-03-11",
        published_at: "2026-03-11T21:00:00.000Z",
        relevance_score: 78,
        score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
        divergence_flag: false,
        delta_from_previous: 0,
        delta_from_first_appearance: 0,
      },
    ],
    storyline: {
      storyline_id: "storyline-agentkit-rollout",
      title: "AgentKit rollout",
      status: "stable",
      member_item_ids: ["artifact-example-agentkit", "artifact-agentkit-memory"],
      related_item_ids: ["artifact-agentkit-memory"],
      first_seen: "2026-03-09T21:00:00.000Z",
      last_seen: "2026-03-11T21:00:00.000Z",
      updated_at: "2026-03-11T21:00:00.000Z",
      last_evolution_at: "2026-03-11T21:00:00.000Z",
      evolution_count: 2,
      repetition_count: 0,
      repetition_streak: 0,
    },
    storyline_membership: [
      {
        edition_id: "2026-03-10",
        published_at: "2026-03-10T21:00:00.000Z",
        primary_storyline_id: "storyline-agentkit-rollout",
        primary_storyline_title: "AgentKit rollout",
        primary_storyline_status: "developing",
        position: 1,
        relationship_decision: "origin",
        storyline_ids: [],
      },
      {
        edition_id: "2026-03-11",
        published_at: "2026-03-11T21:00:00.000Z",
        primary_storyline_id: "storyline-agentkit-rollout",
        primary_storyline_title: "AgentKit rollout",
        primary_storyline_status: "stable",
        position: 1,
        relationship_decision: "evolution",
        storyline_ids: [],
      },
    ],
    appearances: [
      {
        edition_id: "2026-03-10",
        published_at: "2026-03-10T21:00:00.000Z",
        content_window: {
          starts_at: "2026-03-09T21:00:00.000Z",
          ends_at: "2026-03-10T21:00:00.000Z",
          timezone: "UTC",
        },
        item: {
          item_id: "artifact-example-agentkit",
          name: "AgentKit",
          source_urls: [
            "https://github.com/example/agentkit",
            "https://blog.example.com/agentkit-launch",
          ],
          category: "tool",
          summary: "Composable agent runtime with tracing and memory modules.",
          integration_hint: "npm install agentkit and start with the quickstart.",
          relevance_score: 78,
          score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
          score_interpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
          divergence_flag: false,
          risk_warning: {
            security: {
              severity: "low",
              description: "Self-host if traces contain sensitive execution data.",
            },
            maturity: {
              severity: "low",
              description: "Self-host if traces contain sensitive execution data.",
            },
            adoption_complexity: {
              severity: "low",
              description: "Self-host if traces contain sensitive execution data.",
            },
          },
          mention_count: 2,
          sentiment_spread: {
            classification: "agree",
          },
          first_seen: "2026-03-09T21:00:00.000Z",
          edition_count: 1,
          storyline_ids: [],
          storyline: {
            storyline_id: "storyline-agentkit-rollout",
            title: "AgentKit rollout",
            status: "developing",
            position: 1,
            member_item_ids: ["artifact-example-agentkit"],
            related_item_ids: [],
            relationship: {
              decision: "origin",
              explanation: "First appearance in this storyline.",
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
          scope_version: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
        },
        storyline: {
          storyline_id: "storyline-agentkit-rollout",
          title: "AgentKit rollout",
          status: "developing",
          position: 1,
          member_item_ids: ["artifact-example-agentkit"],
          related_item_ids: [],
          relationship: {
            decision: "origin",
            explanation: "First appearance in this storyline.",
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
      {
        edition_id: "2026-03-11",
        published_at: "2026-03-11T21:00:00.000Z",
        content_window: {
          starts_at: "2026-03-10T21:00:00.000Z",
          ends_at: "2026-03-11T21:00:00.000Z",
          timezone: "UTC",
        },
        item: {
          item_id: "artifact-example-agentkit",
          name: "AgentKit",
          source_urls: [
            "https://github.com/example/agentkit",
            "https://blog.example.com/agentkit-launch",
          ],
          category: "tool",
          summary: "Composable agent runtime with tracing and memory modules.",
          integration_hint: "npm install agentkit and start with the quickstart.",
          relevance_score: 78,
          score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
          score_interpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
          divergence_flag: false,
          risk_warning: {
            security: {
              severity: "low",
              description: "Self-host if traces contain sensitive execution data.",
            },
            maturity: {
              severity: "low",
              description: "Self-host if traces contain sensitive execution data.",
            },
            adoption_complexity: {
              severity: "low",
              description: "Self-host if traces contain sensitive execution data.",
            },
          },
          mention_count: 2,
          sentiment_spread: {
            classification: "agree",
          },
          first_seen: "2026-03-09T21:00:00.000Z",
          edition_count: 2,
          storyline_ids: [],
          storyline: {
            storyline_id: "storyline-agentkit-rollout",
            title: "AgentKit rollout",
            status: "stable",
            position: 1,
            member_item_ids: ["artifact-example-agentkit", "artifact-agentkit-memory"],
            related_item_ids: ["artifact-agentkit-memory"],
            relationship: {
              decision: "evolution",
              explanation: "Introduces 1 novel fact clause with 25% novel tokens.",
              prior_appearance_count: 1,
              previous_appearance: {
                edition_id: "2026-03-10",
                published_at: "2026-03-10T21:00:00.000Z",
                source_url: "https://github.com/example/agentkit",
              },
              signals: {
                fact_overlap_ratio: 0.4,
                novel_fact_count: 1,
                novel_token_ratio: 0.25,
                new_source_cluster_count: 1,
              },
            },
          },
          scope_version: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
        },
        storyline: {
          storyline_id: "storyline-agentkit-rollout",
          title: "AgentKit rollout",
          status: "stable",
          position: 1,
          member_item_ids: ["artifact-example-agentkit", "artifact-agentkit-memory"],
          related_item_ids: ["artifact-agentkit-memory"],
          relationship: {
            decision: "evolution",
            explanation: "Introduces 1 novel fact clause with 25% novel tokens.",
            prior_appearance_count: 1,
            previous_appearance: {
              edition_id: "2026-03-10",
              published_at: "2026-03-10T21:00:00.000Z",
              source_url: "https://github.com/example/agentkit",
            },
            signals: {
              fact_overlap_ratio: 0.4,
              novel_fact_count: 1,
              novel_token_ratio: 0.25,
              new_source_cluster_count: 1,
            },
          },
        },
      },
    ],
  });
});
