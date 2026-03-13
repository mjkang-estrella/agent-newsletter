import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  NewsletterEditionRepository,
  SourceRepository,
  createNewsletterApiServer,
} from "../src/index.js";

function buildReferenceItem({ day, editionCount, relevanceScore }) {
  return {
    itemId: "artifact-github-com-acme-persistent-agent-runtime",
    name: "Persistent Agent Runtime",
    sourceUrl: "https://github.com/acme/persistent-agent-runtime",
    sourceUrls: [
      "https://github.com/acme/persistent-agent-runtime",
      "https://reddit.com/r/LocalLLaMA/comments/persistent-agent-runtime",
    ],
    category: "library",
    summary: "Runtime for agents that plan, use tools, and recover state between runs.",
    integrationHint: "Review the runtime install guide before wiring it into agent workers.",
    relevanceScore,
    riskWarning: {
      severity: "medium",
      description: "Validate sandboxing before enabling autonomous execution.",
    },
    mentionCount: 2,
    sourceKinds: ["github", "reddit"],
    adapterIds: ["github", "reddit"],
    sourceAuthorityScore: 91,
    discoveredAt: `2026-03-${String(day).padStart(2, "0")}T20:30:00Z`,
    firstSeen: "2026-03-02T20:30:00Z",
    editionCount,
    sentimentSpread: "agree",
  };
}

function buildStorylineItem({
  itemId,
  name,
  sourceUrl,
  category = "tool",
  summary,
  integrationHint,
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
  updatedAt,
  lastEvolutionAt = updatedAt,
  evolutionCount = 1,
  disagreementDimension = null,
}) {
  return {
    itemId,
    name,
    sourceUrl,
    sourceUrls: [sourceUrl, `${sourceUrl}/docs`],
    category,
    summary,
    integrationHint,
    relevanceScore: 84,
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
        first_seen: firstSeen,
        last_seen: discoveredAt,
        updated_at: updatedAt,
        last_evolution_at: lastEvolutionAt,
        evolution_count: evolutionCount,
        repetition_count: 0,
        repetition_streak: 0,
      },
    },
  };
}

function buildEdition(day, items) {
  const publishedAt = `2026-03-${String(day).padStart(2, "0")}T21:00:00Z`;
  const storylines = items
    .filter((item) => item.storylineId && item.metadata?.storyline)
    .map((item) => ({
      storylineId: item.storylineId,
      title: item.metadata.storyline.title,
      memberItemIds: item.metadata.storyline.member_item_ids,
      ...(item.metadata.storyline.parent_storyline_ids
        ? { parentStorylineIds: item.metadata.storyline.parent_storyline_ids }
        : {}),
      ...(item.metadata.storyline.child_storyline_ids
        ? { childStorylineIds: item.metadata.storyline.child_storyline_ids }
        : {}),
      ...(item.metadata.storyline.merged_storyline_ids
        ? { mergedStorylineIds: item.metadata.storyline.merged_storyline_ids }
        : {}),
      status: item.metadata.storyline.status,
    }));

  return {
    id: `2026-03-${String(day).padStart(2, "0")}`,
    publishedAt,
    window: {
      startsAt: `2026-03-${String(day - 1).padStart(2, "0")}T21:00:00Z`,
      endsAt: publishedAt,
      timezone: "UTC",
    },
    items,
    ...(storylines.length > 0 ? { storylines } : {}),
  };
}

function buildExclusion({
  itemId,
  name,
  sourceUrl,
  category = "library",
  sourceKinds = ["github"],
  adapterIds = ["github"],
  reason = "relevance_below_threshold",
  phase = "scoring",
  relevanceScore = 54,
  minRelevanceScore = 60,
  sourceAuthorityScore = 88,
  timestamp = "2026-03-12T21:00:00.000Z",
}) {
  return {
    itemIdentity: {
      id: itemId,
      itemId,
      name,
      sourceUrl,
      sourceUrls: [sourceUrl],
      canonicalIdentifiers: null,
    },
    itemId,
    name,
    sourceUrl,
    category,
    exclusionReasonCode: reason,
    reasonCode: reason,
    timestamp,
    evaluationContext: {
      stage: phase === "source" ? "source_gate" : "relevance_gate",
    },
    sourceKinds,
    adapterIds,
    reason,
    phase,
    relevanceScore,
    minRelevanceScore,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    sourceAuthorityScore,
  };
}

function buildApiFixtureEditions() {
  return [
    buildEdition(2, [
      buildReferenceItem({
        day: 2,
        editionCount: 1,
        relevanceScore: 78,
      }),
    ]),
    buildEdition(3, [
      buildReferenceItem({
        day: 3,
        editionCount: 2,
        relevanceScore: 82,
      }),
    ]),
    buildEdition(5, [
      buildReferenceItem({
        day: 5,
        editionCount: 3,
        relevanceScore: 88,
      }),
    ]),
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
        memberItemIds: [
          "artifact-agent-runtime-core",
          "artifact-agent-runtime-cloud",
        ],
        parentStorylineIds: ["storyline-agent-runtime-sdk"],
        childStorylineIds: ["storyline-agent-runtime-ops"],
        mergedStorylineIds: ["storyline-agent-hosting-beta"],
        updatedAt: "2026-03-11T21:00:00Z",
        lastEvolutionAt: "2026-03-11T21:00:00Z",
        evolutionCount: 2,
        disagreementDimension: "utility",
      }),
    ]),
  ];
}

function buildCoverageSource({
  id,
  categoryCoverage,
  state = "active",
  status = state === "retired" ? "retired" : "approved",
  seed = false,
} = {}) {
  const value = id.replace(/^[^:]+:domain:/u, "");

  return {
    id,
    kind: "web",
    entityType: "domain",
    platform: "web",
    value,
    displayName: value,
    url: `https://${value}`,
    canonicalUrl: `https://${value}`,
    fetchUrl: `https://${value}`,
    status,
    seed,
    authorityScore: 78,
    signalScore: 64,
    discoveredAt: "2026-03-10T21:00:00.000Z",
    approvedAt: status === "approved" ? "2026-03-10T21:00:00.000Z" : null,
    lastSeenAt: "2026-03-11T21:00:00.000Z",
    lifecycle: {
      state,
      stage: state,
      probationStartedAt: "2026-03-10T21:00:00.000Z",
      activatedAt: state === "active" ? "2026-03-11T21:00:00.000Z" : null,
      retiredAt: state === "retired" ? "2026-03-11T21:00:00.000Z" : null,
      lowSignalStreak: 0,
      lowSignalCycles: [],
    },
    evidence: {
      discoveryCount: 1,
      referrers: ["github:domain:github.com"],
      trustedReferrers: ["github:domain:github.com"],
      seedReferrers: [],
      referrerPlatforms: ["web"],
      cyclesSeen: ["2026-03-11"],
      topicHits: ["agent", "tool"],
      categoryCoverage,
      exampleUrls: [`https://${value}/agents`],
    },
    discoveredFromUrls: ["https://github.com/trending"],
  };
}

function buildCoverageFixtureSources() {
  return [
    buildCoverageSource({
      id: "web:domain:tool-api.example.com",
      categoryCoverage: ["tool", "api"],
    }),
    buildCoverageSource({
      id: "web:domain:tool.example.com",
      categoryCoverage: ["tool"],
    }),
    buildCoverageSource({
      id: "web:domain:library.example.com",
      categoryCoverage: ["library"],
    }),
    buildCoverageSource({
      id: "web:domain:probation-library.example.com",
      categoryCoverage: ["library"],
      state: "probation",
    }),
  ];
}

async function createRepository(editions) {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-http-"));
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

async function createSourceRepository(sources) {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-sources-"));
  const repository = new SourceRepository({
    filePath: join(directory, "source-registry.json"),
    config: {
      minimumActiveCategorySources: 2,
    },
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:05:00Z",
    sources,
  });

  return repository;
}

async function createApiServer({
  editions = buildApiFixtureEditions(),
  sources = buildCoverageFixtureSources(),
  now = "2026-03-12T21:30:00Z",
  rateLimit = false,
} = {}) {
  const repository = await createRepository(editions);
  const sourceRepository = await createSourceRepository(sources);

  return createNewsletterApiServer({
    editionRepository: repository,
    sourceRepository,
    now: () => now,
    consumerTracking: false,
    rateLimit,
  });
}

function createMockResponse() {
  return {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body += body;
    },
  };
}

async function requestJson(
  server,
  path,
  {
    headers = {},
    method = "GET",
    remoteAddress = "203.0.113.10",
  } = {},
) {
  const [handleRequest] = server.listeners("request");

  if (typeof handleRequest !== "function") {
    throw new TypeError("Expected the newsletter API server to expose a request listener");
  }

  const response = createMockResponse();

  await handleRequest(
    {
      method,
      url: path,
      headers,
      socket: {
        remoteAddress,
      },
    },
    response,
  );

  return {
    status: response.status,
    headers: response.headers,
    body: JSON.parse(response.body),
  };
}

test("HTTP GET /api/newsletter/reference serves the promoted reference index", async () => {
  const server = await createApiServer();

  const response = await requestJson(server, "/api/newsletter/reference");

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.body.generated_at, "2026-03-12T21:30:00.000Z");
  assert.equal(response.body.archive_window_days, 7);
  assert.equal(response.body.item_count, 1);
  assert.deepEqual(response.body.items, [
    {
      item_id: "artifact-github-com-acme-persistent-agent-runtime",
      name: "Persistent Agent Runtime",
      source_urls: [
        "https://github.com/acme/persistent-agent-runtime",
        "https://reddit.com/r/LocalLLaMA/comments/persistent-agent-runtime",
      ],
      category: "library",
      summary: "Runtime for agents that plan, use tools, and recover state between runs.",
      integration_hint:
        "Review the runtime install guide before wiring it into agent workers.",
      relevance_score: 88,
      score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
      score_interpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
      divergence_flag: false,
      risk_warning: {
        security: {
          severity: "medium",
          description: "Validate sandboxing before enabling autonomous execution.",
        },
        maturity: {
          severity: "medium",
          description: "Validate sandboxing before enabling autonomous execution.",
        },
        adoption_complexity: {
          severity: "medium",
          description: "Validate sandboxing before enabling autonomous execution.",
        },
      },
      mention_count: 2,
      sentiment_spread: {
        classification: "agree",
      },
      first_seen: "2026-03-02T20:30:00.000Z",
      edition_count: 3,
      storyline_ids: [],
      storyline: null,
      scope_version: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
    },
  ]);
});

test("HTTP GET /api/newsletter/reference returns an empty collection when nothing has been promoted", async () => {
  const server = await createApiServer({
    editions: [],
  });

  const response = await requestJson(server, "/api/newsletter/reference");

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(response.body, {
    archive_window_days: 7,
    generated_at: "2026-03-12T21:30:00.000Z",
    item_count: 0,
    items: [],
  });
});

test("HTTP GET /api/newsletter/latest returns a consistent 429 payload when rate limited", async () => {
  const server = await createApiServer({
    rateLimit: {
      maxRequests: 1,
      windowMs: 60_000,
      now: () => 1_000,
    },
  });

  const firstResponse = await requestJson(server, "/api/newsletter/latest", {
    remoteAddress: "198.51.100.21",
  });
  const secondResponse = await requestJson(server, "/api/newsletter/latest", {
    remoteAddress: "198.51.100.21",
  });

  assert.equal(firstResponse.status, 200);
  assert.equal(firstResponse.headers["ratelimit-limit"], "1");
  assert.equal(firstResponse.headers["ratelimit-policy"], "1;w=60");
  assert.equal(firstResponse.headers["ratelimit-remaining"], "0");
  assert.equal(firstResponse.headers["x-ratelimit-limit"], "1");
  assert.equal(firstResponse.headers["x-ratelimit-remaining"], "0");

  assert.equal(secondResponse.status, 429);
  assert.equal(secondResponse.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(secondResponse.headers["retry-after"], "60");
  assert.equal(secondResponse.headers["ratelimit-limit"], "1");
  assert.equal(secondResponse.headers["ratelimit-policy"], "1;w=60");
  assert.equal(secondResponse.headers["ratelimit-remaining"], "0");
  assert.equal(secondResponse.headers["x-ratelimit-limit"], "1");
  assert.equal(secondResponse.headers["x-ratelimit-remaining"], "0");
  assert.deepEqual(secondResponse.body, {
    error: "rate_limited",
    message: "Too many requests from this IP. Try again later.",
    retry_after_seconds: 60,
  });
});

test("HTTP GET /api/newsletter/item/:id serves the full item lifecycle", async () => {
  const server = await createApiServer();

  const response = await requestJson(
    server,
    "/api/newsletter/item/artifact-github-com-acme-persistent-agent-runtime",
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.body.item_id, "artifact-github-com-acme-persistent-agent-runtime");
  assert.equal(response.body.first_seen, "2026-03-02T20:30:00.000Z");
  assert.equal(response.body.edition_count, 3);
  assert.equal(response.body.first_appearance.edition_id, "2026-03-02");
  assert.deepEqual(
    response.body.repeat_appearances.map((appearance) => appearance.edition_id),
    ["2026-03-03", "2026-03-05"],
  );
  assert.equal(response.body.storyline, null);
  assert.deepEqual(
    response.body.storyline_membership.map((entry) => entry.storyline_ids),
    [[], [], []],
  );
  assert.deepEqual(
    response.body.appearances.map((appearance) => appearance.edition_id),
    ["2026-03-02", "2026-03-03", "2026-03-05"],
  );
  assert.equal(response.body.appearances[0].item.relevance_score, 78);
  assert.equal(
    response.body.appearances[0].item.score_version,
    DEFAULT_RELEVANCE_SCORE_VERSION,
  );
  assert.equal(response.body.appearances.at(-1).item.relevance_score, 88);
  assert.equal(
    response.body.appearances.at(-1).item.score_version,
    DEFAULT_RELEVANCE_SCORE_VERSION,
  );
  assert.equal(response.body.appearances.at(-1).item.edition_count, 3);
});

test("HTTP GET /api/newsletter/item/:id returns a JSON 404 error when the item is missing", async () => {
  const server = await createApiServer();

  const response = await requestJson(
    server,
    "/api/newsletter/item/artifact-github-com-acme-missing-agent-runtime",
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(response.body, {
    error: "not_found",
    message: "No published newsletter item is available for the requested id.",
  });
});

test("HTTP GET /api/newsletter/storylines serves active storyline groups", async () => {
  const server = await createApiServer({
    now: "2026-03-11T21:30:00Z",
  });

  const response = await requestJson(server, "/api/newsletter/storylines");

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.body.generated_at, "2026-03-11T21:30:00.000Z");
  assert.equal(response.body.storyline_count, 1);
  assert.equal(response.body.storylines[0].storyline_id, "storyline-agent-runtime");
  assert.equal(
    response.body.storylines[0].title,
    "Agent Runtime expands into managed hosting",
  );
  assert.equal(response.body.storylines[0].status, "stable");
  assert.equal(response.body.storylines[0].item_count, 2);
  assert.deepEqual(response.body.storylines[0].member_item_ids, [
    "artifact-agent-runtime-core",
    "artifact-agent-runtime-cloud",
  ]);
  assert.deepEqual(response.body.storylines[0].parent_storyline_ids, [
    "storyline-agent-runtime-sdk",
  ]);
  assert.deepEqual(response.body.storylines[0].child_storyline_ids, [
    "storyline-agent-runtime-ops",
  ]);
  assert.deepEqual(response.body.storylines[0].merged_storyline_ids, [
    "storyline-agent-hosting-beta",
  ]);
  assert.deepEqual(response.body.storylines[0].relationship_metadata, {
    fork: {
      parent_storyline_ids: ["storyline-agent-runtime-sdk"],
      child_storyline_ids: ["storyline-agent-runtime-ops"],
    },
    merge: {
      source_storyline_ids: ["storyline-agent-hosting-beta"],
      target_storyline_id: null,
    },
  });
  assert.deepEqual(
    response.body.storylines[0].items.map((item) => item.item_id),
    ["artifact-agent-runtime-core", "artifact-agent-runtime-cloud"],
  );
  assert.deepEqual(response.body.storylines[0].items[0].storyline_ids, [
    "storyline-agent-runtime",
  ]);
  assert.deepEqual(response.body.storylines[0].items[1].sentiment_spread, {
    classification: "mixed",
    disagreement_dimension: "utility",
  });
});

test("HTTP GET /api/newsletter/storylines returns an empty collection when no active storylines exist", async () => {
  const server = await createApiServer({
    editions: [],
  });

  const response = await requestJson(server, "/api/newsletter/storylines");

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(response.body, {
    generated_at: "2026-03-12T21:30:00.000Z",
    storyline_count: 0,
    storylines: [],
  });
});

test("HTTP GET /api/newsletter/exclusions serves grouped exclusion summary statistics", async () => {
  const editions = [
    {
      ...buildEdition(10, []),
      exclusions: [
        buildExclusion({
          itemId: "artifact-github-com-acme-agent-runtime-lite",
          name: "Agent Runtime Lite",
          sourceUrl: "https://github.com/acme/agent-runtime-lite",
          relevanceScore: 58,
          timestamp: "2026-03-10T21:00:00.000Z",
        }),
      ],
    },
    {
      ...buildEdition(11, []),
      exclusions: [
        buildExclusion({
          itemId: "artifact-github-com-acme-agent-runtime-lite",
          name: "Agent Runtime Lite",
          sourceUrl: "https://github.com/acme/agent-runtime-lite",
          relevanceScore: 55,
          sourceAuthorityScore: 91,
          timestamp: "2026-03-11T21:00:00.000Z",
        }),
        buildExclusion({
          itemId: "artifact-github-com-acme-planning-kit-beta",
          name: "Planning Kit Beta",
          sourceUrl: "https://github.com/acme/planning-kit-beta",
          relevanceScore: 52,
          sourceAuthorityScore: 84,
          timestamp: "2026-03-11T21:00:00.000Z",
        }),
      ],
    },
  ];
  const server = await createApiServer({
    editions,
    now: "2026-03-12T21:30:00.000Z",
  });

  const response = await requestJson(
    server,
    "/api/newsletter/exclusions?category=library&reason=relevance_below_threshold",
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.body.archive_window_days, 7);
  assert.deepEqual(response.body.filters, {
    published_from: "2026-03-05T21:30:00.000Z",
    published_to: "2026-03-12T21:30:00.000Z",
    reason: "relevance_below_threshold",
    category: "library",
    source_kind: null,
    adapter_id: null,
    item_id: null,
    phase: null,
  });
  assert.deepEqual(response.body.totals, {
    scanned_edition_count: 2,
    matched_edition_count: 2,
    distinct_item_count: 2,
    total_excluded_items: 3,
    exclusion_group_count: 1,
  });
  assert.deepEqual(response.body.exclusion_summary, {
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
  });
});

test("HTTP GET /api/newsletter/exclusions filters by source kind, adapter, item id, and phase", async () => {
  const editions = [
    {
      ...buildEdition(10, []),
      exclusions: [
        buildExclusion({
          itemId: "artifact-unknown-agent-sdk",
          name: "Unknown Agent SDK",
          sourceUrl: "https://unknown.example.com/post",
          sourceKinds: ["web"],
          adapterIds: ["web-discovery"],
          reason: "source_not_approved",
          phase: "source",
          sourceAuthorityScore: 47,
          category: "library",
          timestamp: "2026-03-10T21:00:00.000Z",
        }),
        buildExclusion({
          itemId: "artifact-github-com-acme-agent-runtime-lite",
          name: "Agent Runtime Lite",
          sourceUrl: "https://github.com/acme/agent-runtime-lite",
          sourceKinds: ["github"],
          adapterIds: ["github"],
          reason: "relevance_below_threshold",
          phase: "scoring",
          relevanceScore: 58,
          sourceAuthorityScore: 88,
          category: "library",
          timestamp: "2026-03-10T21:00:00.000Z",
        }),
      ],
    },
    {
      ...buildEdition(11, []),
      exclusions: [
        buildExclusion({
          itemId: "artifact-unknown-agent-sdk",
          name: "Unknown Agent SDK",
          sourceUrl: "https://unknown.example.com/post",
          sourceKinds: ["web"],
          adapterIds: ["web-discovery"],
          reason: "source_not_approved",
          phase: "source",
          sourceAuthorityScore: 49,
          category: "library",
          timestamp: "2026-03-11T21:00:00.000Z",
        }),
      ],
    },
  ];
  const server = await createApiServer({
    editions,
    now: "2026-03-12T21:30:00.000Z",
  });

  const response = await requestJson(
    server,
    "/api/newsletter/exclusions?item_id=artifact-unknown-agent-sdk&source_kind=web&adapter_id=web-discovery&phase=source",
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(response.body.filters, {
    published_from: "2026-03-05T21:30:00.000Z",
    published_to: "2026-03-12T21:30:00.000Z",
    reason: null,
    category: null,
    source_kind: "web",
    adapter_id: "web-discovery",
    item_id: "artifact-unknown-agent-sdk",
    phase: "source",
  });
  assert.deepEqual(response.body.totals, {
    scanned_edition_count: 2,
    matched_edition_count: 2,
    distinct_item_count: 1,
    total_excluded_items: 2,
    exclusion_group_count: 1,
  });
  assert.deepEqual(response.body.exclusion_summary, {
    total_excluded_items: 2,
    counts_by_category: [
      {
        category: "library",
        count: 2,
      },
    ],
    counts_by_reason_code: [
      {
        reason_code: "source_not_approved",
        count: 2,
      },
    ],
    counts_by_category_and_reason: [
      {
        category: "library",
        reason_code: "source_not_approved",
        count: 2,
      },
    ],
  });
});

test("HTTP GET /api/newsletter/exclusions returns an empty filtered summary when nothing matches", async () => {
  const editions = [
    {
      ...buildEdition(10, []),
      exclusions: [
        buildExclusion({
          itemId: "artifact-github-com-acme-agent-runtime-lite",
          name: "Agent Runtime Lite",
          sourceUrl: "https://github.com/acme/agent-runtime-lite",
          sourceKinds: ["github"],
          adapterIds: ["github"],
          reason: "relevance_below_threshold",
          phase: "scoring",
          category: "library",
          timestamp: "2026-03-10T21:00:00.000Z",
        }),
      ],
    },
    {
      ...buildEdition(11, []),
      exclusions: [
        buildExclusion({
          itemId: "artifact-unknown-agent-sdk",
          name: "Unknown Agent SDK",
          sourceUrl: "https://unknown.example.com/post",
          sourceKinds: ["web"],
          adapterIds: ["web-discovery"],
          reason: "source_not_approved",
          phase: "source",
          sourceAuthorityScore: 49,
          category: "library",
          timestamp: "2026-03-11T21:00:00.000Z",
        }),
      ],
    },
  ];
  const server = await createApiServer({
    editions,
    now: "2026-03-12T21:30:00.000Z",
  });

  const response = await requestJson(
    server,
    "/api/newsletter/exclusions?category=tool&reason=source_not_approved&source_kind=reddit&adapter_id=reddit&item_id=artifact-missing&phase=scoring",
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(response.body, {
    archive_window_days: 7,
    generated_at: "2026-03-12T21:30:00.000Z",
    filters: {
      published_from: "2026-03-05T21:30:00.000Z",
      published_to: "2026-03-12T21:30:00.000Z",
      reason: "source_not_approved",
      category: "tool",
      source_kind: "reddit",
      adapter_id: "reddit",
      item_id: "artifact-missing",
      phase: "scoring",
    },
    totals: {
      scanned_edition_count: 2,
      matched_edition_count: 0,
      distinct_item_count: 0,
      total_excluded_items: 0,
      exclusion_group_count: 0,
    },
    exclusion_summary: {
      total_excluded_items: 0,
      counts_by_category: [],
      counts_by_reason_code: [],
      counts_by_category_and_reason: [],
    },
  });
});

test("HTTP GET /api/newsletter/exclusions/analytics exposes recurring blind spots across editions", async () => {
  const editions = [
    {
      ...buildEdition(10, []),
      exclusions: [
        buildExclusion({
          itemId: "artifact-github-com-acme-agent-runtime-lite",
          name: "Agent Runtime Lite",
          sourceUrl: "https://github.com/acme/agent-runtime-lite",
          sourceKinds: ["github"],
          adapterIds: ["github"],
          reason: "relevance_below_threshold",
          phase: "scoring",
          relevanceScore: 58,
          sourceAuthorityScore: 89,
          category: "library",
          timestamp: "2026-03-10T21:00:00.000Z",
        }),
      ],
    },
    {
      ...buildEdition(11, []),
      exclusions: [
        buildExclusion({
          itemId: "artifact-github-com-acme-agent-runtime-lite",
          name: "Agent Runtime Lite",
          sourceUrl: "https://github.com/acme/agent-runtime-lite",
          sourceKinds: ["github"],
          adapterIds: ["github"],
          reason: "relevance_below_threshold",
          phase: "scoring",
          relevanceScore: 55,
          sourceAuthorityScore: 92,
          category: "library",
          timestamp: "2026-03-11T21:00:00.000Z",
        }),
        buildExclusion({
          itemId: "artifact-github-com-acme-planning-kit-beta",
          name: "Planning Kit Beta",
          sourceUrl: "https://github.com/acme/planning-kit-beta",
          sourceKinds: ["github"],
          adapterIds: ["github"],
          reason: "relevance_below_threshold",
          phase: "scoring",
          relevanceScore: 52,
          sourceAuthorityScore: 83,
          category: "library",
          timestamp: "2026-03-11T21:00:00.000Z",
        }),
      ],
    },
  ];
  const server = await createApiServer({
    editions,
    now: "2026-03-12T21:30:00.000Z",
  });

  const response = await requestJson(
    server,
    "/api/newsletter/exclusions/analytics?category=library&reason_code=relevance_below_threshold&source_kind=github&phase=scoring",
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(response.body.filters, {
    published_from: "2026-03-05T21:30:00.000Z",
    published_to: "2026-03-12T21:30:00.000Z",
    reason_code: "relevance_below_threshold",
    category: "library",
    source_kind: "github",
    adapter_id: null,
    item_id: null,
    phase: "scoring",
    min_recurring_editions: 2,
  });
  assert.deepEqual(response.body.totals, {
    scanned_edition_count: 2,
    matched_edition_count: 2,
    exclusion_count: 3,
    distinct_item_count: 2,
    recurring_item_count: 1,
    blind_spot_count: 1,
  });
  assert.deepEqual(response.body.aggregations.category_reason_codes, [
    {
      category: "library",
      reason_code: "relevance_below_threshold",
      exclusion_count: 3,
      distinct_item_count: 2,
      edition_count: 2,
      first_excluded_at: "2026-03-10T21:00:00.000Z",
      last_excluded_at: "2026-03-11T21:00:00.000Z",
    },
  ]);
  assert.deepEqual(response.body.recurring_items, [
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
  ]);
  assert.deepEqual(response.body.blind_spots, [
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
  ]);
  assert.deepEqual(
    response.body.exclusions.map((entry) => ({
      edition_id: entry.edition_id,
      item_id: entry.item_id,
      reason_code: entry.reason_code,
    })),
    [
      {
        edition_id: "2026-03-11",
        item_id: "artifact-github-com-acme-agent-runtime-lite",
        reason_code: "relevance_below_threshold",
      },
      {
        edition_id: "2026-03-11",
        item_id: "artifact-github-com-acme-planning-kit-beta",
        reason_code: "relevance_below_threshold",
      },
      {
        edition_id: "2026-03-10",
        item_id: "artifact-github-com-acme-agent-runtime-lite",
        reason_code: "relevance_below_threshold",
      },
    ],
  );
});

test("HTTP GET /api/newsletter/scope serves the current versioned editorial boundary", async () => {
  const server = await createApiServer();
  const response = await requestJson(server, "/api/newsletter/scope");

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.body.generated_at, "2026-03-12T21:30:00.000Z");
  assert.equal(response.body.current_version, "1.0.1");
  assert.equal(response.body.scope_definition.version, "1.0.1");
  assert.equal(response.body.scope_definition.review_cadence, "quarterly");
  assert.equal(typeof response.body.scope_definition.inclusion_policy.qualification_rule, "string");
  assert.ok(Array.isArray(response.body.scope_definition.coverage_boundaries.in_scope));
  assert.ok(Array.isArray(response.body.changelog));
  assert.equal(response.body.changelog.at(-1).change_type, "patch");
});

test("HTTP GET /api/newsletter/coverage-map serves active source coverage by topic area", async () => {
  const server = await createApiServer();
  const response = await requestJson(server, "/api/newsletter/coverage-map");

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.body.generated_at, "2026-03-12T21:30:00.000Z");
  assert.equal(response.body.minimum_active_source_count, 2);
  assert.equal(response.body.topic_count, 4);
  assert.deepEqual(response.body.topics, [
    {
      topic_area: "tool",
      active_source_count: 2,
      coverage_status: "covered",
    },
    {
      topic_area: "api",
      active_source_count: 1,
      coverage_status: "underrepresented",
    },
    {
      topic_area: "library",
      active_source_count: 1,
      coverage_status: "underrepresented",
    },
    {
      topic_area: "technique",
      active_source_count: 0,
      coverage_status: "uncovered",
    },
  ]);
});
