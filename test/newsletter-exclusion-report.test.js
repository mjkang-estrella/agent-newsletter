import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_RELEVANCE_SCORE_VERSION,
  NewsletterEditionRepository,
  NewsletterEditionStore,
  buildNewsletterExclusionReport,
  createNewsletterApiHandler,
  createNewsletterApiServer,
  formatNewsletterExclusionReportResponse,
} from "../src/index.js";

function buildPublishedItem({ itemId, name, sourceUrl, publishedAt, firstSeen, editionCount = 1 }) {
  return {
    itemId,
    name,
    sourceUrl,
    sourceUrls: [sourceUrl],
    category: "library",
    summary: `${name} helps autonomous agents extend their capabilities.`,
    integrationHint: `Review ${name} installation docs before rollout.`,
    relevanceScore: 84,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    riskWarning: {
      severity: "medium",
      description: "Validate production readiness before enabling autonomous actions.",
    },
    mentionCount: 2,
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 91,
    discoveredAt: publishedAt,
    firstSeen,
    editionCount,
    sentimentSpread: "agree",
  };
}

function buildExclusion({
  itemId,
  name,
  sourceUrl,
  timestamp,
  relevanceScore,
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
    category: "library",
    exclusionReasonCode: "relevance_below_threshold",
    reasonCode: "relevance_below_threshold",
    timestamp,
    evaluationContext: {
      stage: "relevance_gate",
    },
    sourceKinds: ["github"],
    adapterIds: ["github"],
    reason: "relevance_below_threshold",
    phase: "scoring",
    relevanceScore,
    minRelevanceScore: 60,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    sourceAuthorityScore: 89,
  };
}

function buildEdition({ day, items = [], exclusions = [] }) {
  const publishedAt = `2026-03-${String(day).padStart(2, "0")}T21:00:00.000Z`;

  return {
    id: `2026-03-${String(day).padStart(2, "0")}`,
    publishedAt,
    window: {
      startsAt: `2026-03-${String(day - 1).padStart(2, "0")}T21:00:00.000Z`,
      endsAt: publishedAt,
      timezone: "UTC",
    },
    items,
    ...(exclusions.length > 0 ? { exclusions } : {}),
  };
}

function buildFixtureEditions() {
  return [
    buildEdition({
      day: 10,
      items: [
        buildPublishedItem({
          itemId: "artifact-agent-runtime-core",
          name: "Agent Runtime Core",
          sourceUrl: "https://github.com/acme/agent-runtime-core",
          publishedAt: "2026-03-10T21:00:00.000Z",
          firstSeen: "2026-03-10T20:30:00.000Z",
        }),
      ],
      exclusions: [
        buildExclusion({
          itemId: "artifact-agent-runtime-lite",
          name: "Agent Runtime Lite",
          sourceUrl: "https://github.com/acme/agent-runtime-lite",
          timestamp: "2026-03-10T21:00:00.000Z",
          relevanceScore: 58,
        }),
      ],
    }),
    buildEdition({
      day: 11,
      items: [
        buildPublishedItem({
          itemId: "artifact-agent-memory-pack",
          name: "Agent Memory Pack",
          sourceUrl: "https://github.com/acme/agent-memory-pack",
          publishedAt: "2026-03-11T21:00:00.000Z",
          firstSeen: "2026-03-10T20:45:00.000Z",
          editionCount: 2,
        }),
        buildPublishedItem({
          itemId: "artifact-agent-routing-kit",
          name: "Agent Routing Kit",
          sourceUrl: "https://github.com/acme/agent-routing-kit",
          publishedAt: "2026-03-11T21:00:00.000Z",
          firstSeen: "2026-03-11T20:10:00.000Z",
        }),
      ],
      exclusions: [
        buildExclusion({
          itemId: "artifact-agent-runtime-lite",
          name: "Agent Runtime Lite",
          sourceUrl: "https://github.com/acme/agent-runtime-lite",
          timestamp: "2026-03-11T21:00:00.000Z",
          relevanceScore: 55,
        }),
        buildExclusion({
          itemId: "artifact-planning-kit-beta",
          name: "Planning Kit Beta",
          sourceUrl: "https://github.com/acme/planning-kit-beta",
          timestamp: "2026-03-11T21:00:00.000Z",
          relevanceScore: 52,
        }),
      ],
    }),
  ];
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

async function requestJson(server, path, { method = "GET" } = {}) {
  const [handleRequest] = server.listeners("request");
  const response = createMockResponse();

  await handleRequest(
    {
      method,
      url: path,
      headers: {},
      socket: {
        remoteAddress: "203.0.113.10",
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

test("buildNewsletterExclusionReport correlates exclusion records with per-edition summaries", () => {
  const report = buildNewsletterExclusionReport(buildFixtureEditions(), {
    now: "2026-03-12T21:30:00.000Z",
    category: "library",
    reason: "relevance_below_threshold",
    sourceKind: "github",
    phase: "scoring",
    minRecurringEditions: 2,
  });

  assert.deepEqual(report.totals, {
    scannedEditionCount: 2,
    matchedEditionCount: 2,
    exclusionCount: 3,
    distinctItemCount: 2,
    recurringItemCount: 1,
    blindSpotCount: 1,
    editionSummaryCount: 2,
  });
  assert.equal(report.exclusionSummary.totalExcludedItems, 3);
  assert.deepEqual(report.exclusionSummary.countsByCategoryAndReason, [
    {
      category: "library",
      reasonCode: "relevance_below_threshold",
      count: 3,
    },
  ]);
  assert.deepEqual(
    report.editionSummaries.map((entry) => ({
      editionId: entry.editionId,
      publishedAt: entry.publishedAt,
      window: entry.window,
      publishedItemCount: entry.publishedItemCount,
      editionExclusionSummary: {
        totalExcludedItems: entry.editionExclusionSummary.totalExcludedItems,
        countsByCategoryAndReason: entry.editionExclusionSummary.countsByCategoryAndReason,
      },
      matchingExclusionSummary: {
        totalExcludedItems: entry.matchingExclusionSummary.totalExcludedItems,
        countsByCategoryAndReason: entry.matchingExclusionSummary.countsByCategoryAndReason,
      },
      matchingDistinctItemCount: entry.matchingDistinctItemCount,
    })),
    [
      {
        editionId: "2026-03-11",
        publishedAt: "2026-03-11T21:00:00.000Z",
        window: {
          startsAt: "2026-03-10T21:00:00.000Z",
          endsAt: "2026-03-11T21:00:00.000Z",
          timezone: "UTC",
        },
        publishedItemCount: 2,
        editionExclusionSummary: {
          totalExcludedItems: 2,
          countsByCategoryAndReason: [
            {
              category: "library",
              reasonCode: "relevance_below_threshold",
              count: 2,
            },
          ],
        },
        matchingExclusionSummary: {
          totalExcludedItems: 2,
          countsByCategoryAndReason: [
            {
              category: "library",
              reasonCode: "relevance_below_threshold",
              count: 2,
            },
          ],
        },
        matchingDistinctItemCount: 2,
      },
      {
        editionId: "2026-03-10",
        publishedAt: "2026-03-10T21:00:00.000Z",
        window: {
          startsAt: "2026-03-09T21:00:00.000Z",
          endsAt: "2026-03-10T21:00:00.000Z",
          timezone: "UTC",
        },
        publishedItemCount: 1,
        editionExclusionSummary: {
          totalExcludedItems: 1,
          countsByCategoryAndReason: [
            {
              category: "library",
              reasonCode: "relevance_below_threshold",
              count: 1,
            },
          ],
        },
        matchingExclusionSummary: {
          totalExcludedItems: 1,
          countsByCategoryAndReason: [
            {
              category: "library",
              reasonCode: "relevance_below_threshold",
              count: 1,
            },
          ],
        },
        matchingDistinctItemCount: 1,
      },
    ],
  );
});

test("formatNewsletterExclusionReportResponse exposes the combined reporting payload", () => {
  const response = formatNewsletterExclusionReportResponse(
    buildNewsletterExclusionReport(buildFixtureEditions(), {
      now: "2026-03-12T21:30:00.000Z",
      category: "library",
      reason: "relevance_below_threshold",
      sourceKind: "github",
      phase: "scoring",
      minRecurringEditions: 2,
    }),
  );

  assert.deepEqual(response.totals, {
    scanned_edition_count: 2,
    matched_edition_count: 2,
    exclusion_count: 3,
    distinct_item_count: 2,
    recurring_item_count: 1,
    blind_spot_count: 1,
    edition_summary_count: 2,
  });
  assert.deepEqual(response.exclusion_summary, {
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
  assert.deepEqual(response.edition_summaries, [
    {
      edition_id: "2026-03-11",
      published_at: "2026-03-11T21:00:00.000Z",
      content_window: {
        starts_at: "2026-03-10T21:00:00.000Z",
        ends_at: "2026-03-11T21:00:00.000Z",
        timezone: "UTC",
      },
      published_item_count: 2,
      matching_distinct_item_count: 2,
      edition_exclusion_summary: {
        total_excluded_items: 2,
        counts_by_category: [
          {
            category: "library",
            count: 2,
          },
        ],
        counts_by_reason_code: [
          {
            reason_code: "relevance_below_threshold",
            count: 2,
          },
        ],
        counts_by_category_and_reason: [
          {
            category: "library",
            reason_code: "relevance_below_threshold",
            count: 2,
          },
        ],
      },
      matching_exclusion_summary: {
        total_excluded_items: 2,
        counts_by_category: [
          {
            category: "library",
            count: 2,
          },
        ],
        counts_by_reason_code: [
          {
            reason_code: "relevance_below_threshold",
            count: 2,
          },
        ],
        counts_by_category_and_reason: [
          {
            category: "library",
            reason_code: "relevance_below_threshold",
            count: 2,
          },
        ],
      },
    },
    {
      edition_id: "2026-03-10",
      published_at: "2026-03-10T21:00:00.000Z",
      content_window: {
        starts_at: "2026-03-09T21:00:00.000Z",
        ends_at: "2026-03-10T21:00:00.000Z",
        timezone: "UTC",
      },
      published_item_count: 1,
      matching_distinct_item_count: 1,
      edition_exclusion_summary: {
        total_excluded_items: 1,
        counts_by_category: [
          {
            category: "library",
            count: 1,
          },
        ],
        counts_by_reason_code: [
          {
            reason_code: "relevance_below_threshold",
            count: 1,
          },
        ],
        counts_by_category_and_reason: [
          {
            category: "library",
            reason_code: "relevance_below_threshold",
            count: 1,
          },
        ],
      },
      matching_exclusion_summary: {
        total_excluded_items: 1,
        counts_by_category: [
          {
            category: "library",
            count: 1,
          },
        ],
        counts_by_reason_code: [
          {
            reason_code: "relevance_below_threshold",
            count: 1,
          },
        ],
        counts_by_category_and_reason: [
          {
            category: "library",
            reason_code: "relevance_below_threshold",
            count: 1,
          },
        ],
      },
    },
  ]);
});

test("NewsletterEditionStore exposes exclusion reports with edition summaries", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const store = new NewsletterEditionStore({ directoryPath });

  for (const edition of buildFixtureEditions()) {
    await store.publish(edition);
  }

  const report = await store.loadExclusionReport({
    now: "2026-03-12T21:30:00.000Z",
    category: "library",
    reason: "relevance_below_threshold",
    sourceKind: "github",
    phase: "scoring",
  });

  assert.equal(report.totals.editionSummaryCount, 2);
  assert.equal(report.editionSummaries[0].editionId, "2026-03-11");
  assert.equal(report.editionSummaries[0].publishedItemCount, 2);
  assert.equal(report.editionSummaries[0].matchingExclusionSummary.totalExcludedItems, 2);
});

test("NewsletterEditionRepository exposes exclusion reports with edition summaries", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new NewsletterEditionRepository({
    filePath: join(directoryPath, "newsletter-snapshot.json"),
  });

  await repository.save({
    updatedAt: "2026-03-12T21:05:00.000Z",
    editions: buildFixtureEditions(),
  });

  const report = await repository.queryExclusionReport({
    now: "2026-03-12T21:30:00.000Z",
    category: "library",
    reason: "relevance_below_threshold",
    sourceKind: "github",
    phase: "scoring",
  });

  assert.equal(report.totals.editionSummaryCount, 2);
  assert.equal(report.editionSummaries[1].editionId, "2026-03-10");
  assert.equal(report.editionSummaries[1].matchingDistinctItemCount, 1);
});

test("GET /api/newsletter/exclusions/report returns the combined reporting payload", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new NewsletterEditionRepository({
    filePath: join(directoryPath, "newsletter-snapshot.json"),
  });

  await repository.save({
    updatedAt: "2026-03-12T21:05:00.000Z",
    editions: buildFixtureEditions(),
  });

  const server = createNewsletterApiServer({
    editionRepository: repository,
    now: () => "2026-03-12T21:30:00.000Z",
    consumerTracking: false,
    rateLimit: false,
  });
  const response = await requestJson(
    server,
    "/api/newsletter/exclusions/report?category=library&reason_code=relevance_below_threshold&source_kind=github&phase=scoring",
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
  assert.equal(response.body.totals.edition_summary_count, 2);
  assert.equal(response.body.edition_summaries.length, 2);
  assert.equal(response.body.edition_summaries[0].published_item_count, 2);
  assert.equal(
    response.body.edition_summaries[0].matching_exclusion_summary.total_excluded_items,
    2,
  );
  assert.equal(
    response.body.edition_summaries[1].edition_exclusion_summary.total_excluded_items,
    1,
  );
});

test("GET /api/newsletter/exclusions/report returns JSON 405 and 500 responses", async () => {
  const handler = createNewsletterApiHandler({
    editionRepository: {
      async getLatestPublishedEdition() {
        return null;
      },
      async listPublishedEditions() {
        return [];
      },
      async queryExclusionReport() {
        throw new Error("exclusion report unavailable");
      },
    },
    now: () => "2026-03-12T21:30:00.000Z",
    consumerTracking: false,
    rateLimit: false,
  });

  const methodNotAllowed = await handler({
    method: "POST",
    url: "/api/newsletter/exclusions/report",
  });
  assert.equal(methodNotAllowed.status, 405);
  assert.deepEqual(JSON.parse(methodNotAllowed.body), {
    error: "method_not_allowed",
    message: "Use GET /api/newsletter/exclusions/report.",
  });

  const failure = await handler({
    method: "GET",
    url: "/api/newsletter/exclusions/report",
  });
  assert.equal(failure.status, 500);
  assert.deepEqual(JSON.parse(failure.body), {
    error: "internal_server_error",
    message: "exclusion report unavailable",
  });
});
