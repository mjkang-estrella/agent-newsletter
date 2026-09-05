import test from "node:test";
import assert from "./helpers/legacy-contract-assert.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  CONTENT_CATEGORIES,
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  DISAGREEMENT_DIMENSIONS,
  NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  NewsletterEditionRepository,
  RISK_SEVERITIES,
  RISK_WARNING_DIMENSIONS,
  SCORE_INTERPRETATIONS,
  SENTIMENT_SPREADS,
  createNewsletterApiHandler,
} from "../src/index.js";

function buildTrackedItem({
  itemId,
  name,
  sourceUrl,
  category = "library",
  corroboratingUrls = [
    "https://reddit.com/r/LocalLLaMA/comments/persistent-agent-runtime",
  ],
  relevanceScore,
  editionCount,
  firstSeen,
}) {
  return {
    itemId,
    name,
    sourceUrl,
    sourceUrls: [sourceUrl, ...corroboratingUrls],
    category,
    summary: `${name} helps autonomous agents extend their toolchain.`,
    integrationHint: `Review ${name} installation docs before rollout.`,
    relevanceScore,
    riskWarning: {
      severity: "medium",
      description: "Validate production readiness before enabling autonomous actions.",
    },
    mentionCount: 2,
    sourceKinds: ["github", "reddit"],
    adapterIds: ["github", "reddit"],
    sourceAuthorityScore: 91,
    discoveredAt: firstSeen,
    firstSeen,
    editionCount,
    sentimentSpread: "agree",
  };
}

function buildEdition(day, items) {
  return {
    id: `2026-03-${String(day).padStart(2, "0")}`,
    publishedAt: `2026-03-${String(day).padStart(2, "0")}T21:00:00Z`,
    window: {
      startsAt: `2026-03-${String(day - 1).padStart(2, "0")}T21:00:00Z`,
      endsAt: `2026-03-${String(day).padStart(2, "0")}T21:00:00Z`,
      timezone: "UTC",
    },
    items,
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

function assertIsoUtcTimestamp(value) {
  assert.equal(typeof value, "string");
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
}

function assertReferenceItemSchema(item) {
  assert.deepEqual(Object.keys(item).sort(), [...NEWSLETTER_ITEM_API_RESPONSE_FIELDS].sort());
  assert.equal(typeof item.item_id, "string");
  assert.ok(item.item_id.length > 0);
  assert.equal(typeof item.name, "string");
  assert.ok(item.name.length > 0);
  assert.ok(Array.isArray(item.source_urls));
  assert.ok(item.source_urls.length > 0);
  for (const sourceUrl of item.source_urls) {
    assert.equal(typeof sourceUrl, "string");
    assert.ok(new URL(sourceUrl));
  }
  assert.ok(CONTENT_CATEGORIES.includes(item.category));
  assert.equal(typeof item.summary, "string");
  assert.ok(item.summary.length > 0);
  assert.equal(typeof item.integration_hint, "string");
  assert.ok(item.integration_hint.length > 0);
  assert.equal(typeof item.relevance_score, "number");
  assert.ok(item.relevance_score >= 0 && item.relevance_score <= 100);
  assert.equal(item.score_version, DEFAULT_RELEVANCE_SCORE_VERSION);
  assert.ok(SCORE_INTERPRETATIONS.includes(item.score_interpretation));
  assert.equal(typeof item.divergence_flag, "boolean");
  assert.equal(typeof item.mention_count, "number");
  assert.ok(Number.isInteger(item.mention_count));
  assert.ok(item.mention_count >= 1);
  assertSentimentSpreadSchema(item.sentiment_spread);
  assertIsoUtcTimestamp(item.first_seen);
  assert.equal(typeof item.edition_count, "number");
  assert.ok(Number.isInteger(item.edition_count));
  assert.ok(item.edition_count >= 1);
  assert.ok(Array.isArray(item.storyline_ids));
  assert.deepEqual(item.storyline_ids, [...new Set(item.storyline_ids)]);
  for (const storylineId of item.storyline_ids) {
    assert.equal(typeof storylineId, "string");
    assert.ok(storylineId.length > 0);
  }
  assert.equal(typeof item.scope_version, "string");
  assert.ok(item.scope_version.length > 0);
  assert.deepEqual(Object.keys(item.risk_warning).sort(), [...RISK_WARNING_DIMENSIONS].sort());
  for (const dimension of RISK_WARNING_DIMENSIONS) {
    assert.deepEqual(Object.keys(item.risk_warning[dimension]).sort(), ["description", "severity"]);
    assert.ok(RISK_SEVERITIES.includes(item.risk_warning[dimension].severity));
    assert.equal(typeof item.risk_warning[dimension].description, "string");
    assert.ok(item.risk_warning[dimension].description.length > 0);
  }
}

function assertSentimentSpreadSchema(sentimentSpread) {
  assert.equal(typeof sentimentSpread, "object");
  assert.ok(sentimentSpread);
  assert.ok(SENTIMENT_SPREADS.includes(sentimentSpread.classification));

  if (sentimentSpread.classification === "agree") {
    assert.deepEqual(Object.keys(sentimentSpread).sort(), ["classification"]);
    return;
  }

  assert.deepEqual(Object.keys(sentimentSpread).sort(), [
    "classification",
    "disagreement_dimension",
  ]);
  assert.ok(DISAGREEMENT_DIMENSIONS.includes(sentimentSpread.disagreement_dimension));
}

function assertReferenceResponseSchema(body) {
  assert.deepEqual(Object.keys(body).sort(), [
    "archive_window_days",
    "generated_at",
    "item_count",
    "items",
  ]);
  assert.equal(typeof body.archive_window_days, "number");
  assert.ok(Number.isInteger(body.archive_window_days));
  assert.ok(body.archive_window_days > 0);
  assertIsoUtcTimestamp(body.generated_at);
  assert.equal(typeof body.item_count, "number");
  assert.ok(Number.isInteger(body.item_count));
  assert.ok(body.item_count >= 0);
  assert.ok(Array.isArray(body.items));
  assert.equal(body.item_count, body.items.length);
  for (const item of body.items) {
    assertReferenceItemSchema(item);
  }
}

test("NewsletterEditionRepository promotes only outlived high-signal items into the reference index", async () => {
  const repository = await createRepository([
    buildEdition(2, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        relevanceScore: 78,
        editionCount: 1,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
    buildEdition(3, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        relevanceScore: 82,
        editionCount: 2,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
    buildEdition(5, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        relevanceScore: 88,
        editionCount: 3,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
      buildTrackedItem({
        itemId: "artifact-github-com-acme-low-signal-agent-runtime",
        name: "Low Signal Agent Runtime",
        sourceUrl: "https://github.com/acme/low-signal-agent-runtime",
        relevanceScore: 59,
        editionCount: 4,
        firstSeen: "2026-03-02T18:00:00Z",
      }),
    ]),
    buildEdition(7, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-recent-agent-runtime",
        name: "Recent Agent Runtime",
        sourceUrl: "https://github.com/acme/recent-agent-runtime",
        relevanceScore: 84,
        editionCount: 1,
        firstSeen: "2026-03-07T20:30:00Z",
      }),
    ]),
    buildEdition(8, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-recent-agent-runtime",
        name: "Recent Agent Runtime",
        sourceUrl: "https://github.com/acme/recent-agent-runtime",
        relevanceScore: 87,
        editionCount: 2,
        firstSeen: "2026-03-07T20:30:00Z",
      }),
    ]),
    buildEdition(10, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-recent-agent-runtime",
        name: "Recent Agent Runtime",
        sourceUrl: "https://github.com/acme/recent-agent-runtime",
        relevanceScore: 92,
        editionCount: 3,
        firstSeen: "2026-03-07T20:30:00Z",
      }),
    ]),
  ]);

  const items = await repository.listReferenceItems({
    now: "2026-03-12T21:30:00Z",
    underrepresentedCategories: ["technique"],
  });

  assert.deepEqual(items.map((item) => item.itemId), [
    "artifact-github-com-acme-persistent-agent-runtime",
  ]);
  assert.equal(items[0].editionCount, 3);
  assert.equal(items[0].relevanceScore, 88);
  assert.equal(items[0].firstSeen, "2026-03-02T20:30:00.000Z");
  assert.equal(items[0].publishedAt, "2026-03-05T21:00:00.000Z");
});

test("NewsletterEditionRepository requires corroboration across source clusters before promoting a reference item", async () => {
  const repository = await createRepository([
    buildEdition(2, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-single-cluster-runtime",
        name: "Single Cluster Runtime",
        sourceUrl: "https://github.com/acme/single-cluster-runtime",
        corroboratingUrls: ["https://github.com/acme/single-cluster-runtime/releases"],
        relevanceScore: 78,
        editionCount: 1,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
    buildEdition(3, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-single-cluster-runtime",
        name: "Single Cluster Runtime",
        sourceUrl: "https://github.com/acme/single-cluster-runtime",
        corroboratingUrls: ["https://github.com/acme/single-cluster-runtime/issues"],
        relevanceScore: 82,
        editionCount: 2,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
    buildEdition(5, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-single-cluster-runtime",
        name: "Single Cluster Runtime",
        sourceUrl: "https://github.com/acme/single-cluster-runtime",
        corroboratingUrls: ["https://github.com/acme/single-cluster-runtime/docs"],
        relevanceScore: 88,
        editionCount: 3,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
  ]);

  const items = await repository.listReferenceItems({
    now: "2026-03-12T21:30:00Z",
    underrepresentedCategories: ["technique"],
  });

  assert.deepEqual(items, []);
});

test("NewsletterEditionRepository can preserve an underrepresented category with relaxed corroboration once the item ages out", async () => {
  const repository = await createRepository([
    buildEdition(2, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        category: "library",
        relevanceScore: 78,
        editionCount: 1,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
      buildTrackedItem({
        itemId: "artifact-example-com-agent-memory-pattern",
        name: "Agent Memory Pattern",
        sourceUrl: "https://patterns.example.com/agent-memory-pattern",
        category: "technique",
        corroboratingUrls: [],
        relevanceScore: 74,
        editionCount: 1,
        firstSeen: "2026-03-02T19:45:00Z",
      }),
    ]),
    buildEdition(3, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        category: "library",
        relevanceScore: 82,
        editionCount: 2,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
      buildTrackedItem({
        itemId: "artifact-example-com-agent-memory-pattern",
        name: "Agent Memory Pattern",
        sourceUrl: "https://patterns.example.com/agent-memory-pattern",
        category: "technique",
        corroboratingUrls: [],
        relevanceScore: 76,
        editionCount: 2,
        firstSeen: "2026-03-02T19:45:00Z",
      }),
    ]),
    buildEdition(5, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        category: "library",
        relevanceScore: 88,
        editionCount: 3,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
      buildTrackedItem({
        itemId: "artifact-example-com-agent-memory-pattern",
        name: "Agent Memory Pattern",
        sourceUrl: "https://patterns.example.com/agent-memory-pattern",
        category: "technique",
        corroboratingUrls: [],
        relevanceScore: 81,
        editionCount: 3,
        firstSeen: "2026-03-02T19:45:00Z",
      }),
    ]),
  ]);

  const items = await repository.listReferenceItems({
    now: "2026-03-12T21:30:00Z",
    underrepresentedCategories: ["technique"],
  });

  assert.deepEqual(items.map((item) => item.itemId), [
    "artifact-github-com-acme-persistent-agent-runtime",
    "artifact-example-com-agent-memory-pattern",
  ]);
  assert.equal(
    items.find((item) => item.itemId === "artifact-example-com-agent-memory-pattern")?.category,
    "technique",
  );
});

test("NewsletterEditionRepository keeps relaxed corroboration out of categories that already have a strict reference item", async () => {
  const repository = await createRepository([
    buildEdition(2, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        category: "library",
        relevanceScore: 78,
        editionCount: 1,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
      buildTrackedItem({
        itemId: "artifact-example-com-lite-agent-runtime",
        name: "Lite Agent Runtime",
        sourceUrl: "https://blog.example.com/lite-agent-runtime",
        category: "library",
        corroboratingUrls: [],
        relevanceScore: 74,
        editionCount: 1,
        firstSeen: "2026-03-02T19:45:00Z",
      }),
    ]),
    buildEdition(3, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        category: "library",
        relevanceScore: 82,
        editionCount: 2,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
      buildTrackedItem({
        itemId: "artifact-example-com-lite-agent-runtime",
        name: "Lite Agent Runtime",
        sourceUrl: "https://blog.example.com/lite-agent-runtime",
        category: "library",
        corroboratingUrls: [],
        relevanceScore: 76,
        editionCount: 2,
        firstSeen: "2026-03-02T19:45:00Z",
      }),
    ]),
    buildEdition(5, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        category: "library",
        relevanceScore: 88,
        editionCount: 3,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
      buildTrackedItem({
        itemId: "artifact-example-com-lite-agent-runtime",
        name: "Lite Agent Runtime",
        sourceUrl: "https://blog.example.com/lite-agent-runtime",
        category: "library",
        corroboratingUrls: [],
        relevanceScore: 81,
        editionCount: 3,
        firstSeen: "2026-03-02T19:45:00Z",
      }),
    ]),
  ]);

  const items = await repository.listReferenceItems({
    now: "2026-03-12T21:30:00Z",
  });

  assert.deepEqual(items.map((item) => item.itemId), [
    "artifact-github-com-acme-persistent-agent-runtime",
  ]);
});

test("GET /api/newsletter/reference returns the persistent reference index using the shared item contract", async () => {
  const repository = await createRepository([
    buildEdition(2, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        relevanceScore: 78,
        editionCount: 1,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
    buildEdition(3, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        relevanceScore: 82,
        editionCount: 2,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
    buildEdition(5, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        relevanceScore: 88,
        editionCount: 3,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
  ]);
  const handler = createNewsletterApiHandler({
    editionRepository: repository,
    now: () => "2026-03-12T21:30:00Z",
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/reference",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assertReferenceResponseSchema(body);
  assert.deepEqual(body, {
    archive_window_days: 7,
    generated_at: "2026-03-12T21:30:00.000Z",
    item_count: 1,
    items: [
      {
        item_id: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        source_urls: [
          "https://github.com/acme/persistent-agent-runtime",
          "https://reddit.com/r/LocalLLaMA/comments/persistent-agent-runtime",
        ],
        category: "library",
        summary: "Persistent Agent Runtime helps autonomous agents extend their toolchain.",
        integration_hint: "Review Persistent Agent Runtime installation docs before rollout.",
        relevance_score: 88,
        score_version: DEFAULT_RELEVANCE_SCORE_VERSION,
        score_interpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
        divergence_flag: false,
        risk_warning: {
          security: {
            severity: "medium",
            description: "Validate production readiness before enabling autonomous actions.",
          },
          maturity: {
            severity: "medium",
            description: "Validate production readiness before enabling autonomous actions.",
          },
          adoption_complexity: {
            severity: "medium",
            description: "Validate production readiness before enabling autonomous actions.",
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
    ],
  });
});

test("GET /api/newsletter/reference excludes items whose latest appearance is still in the rolling archive", async () => {
  const repository = await createRepository([
    buildEdition(2, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        relevanceScore: 78,
        editionCount: 1,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
    buildEdition(3, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        relevanceScore: 82,
        editionCount: 2,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
    buildEdition(5, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        relevanceScore: 88,
        editionCount: 3,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
    buildEdition(9, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-recent-agent-runtime",
        name: "Recent Agent Runtime",
        sourceUrl: "https://github.com/acme/recent-agent-runtime",
        relevanceScore: 84,
        editionCount: 1,
        firstSeen: "2026-03-09T20:30:00Z",
      }),
    ]),
    buildEdition(10, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-recent-agent-runtime",
        name: "Recent Agent Runtime",
        sourceUrl: "https://github.com/acme/recent-agent-runtime",
        relevanceScore: 87,
        editionCount: 2,
        firstSeen: "2026-03-09T20:30:00Z",
      }),
    ]),
    buildEdition(11, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-recent-agent-runtime",
        name: "Recent Agent Runtime",
        sourceUrl: "https://github.com/acme/recent-agent-runtime",
        relevanceScore: 92,
        editionCount: 3,
        firstSeen: "2026-03-09T20:30:00Z",
      }),
    ]),
  ]);
  const handler = createNewsletterApiHandler({
    editionRepository: repository,
    now: () => "2026-03-12T21:30:00Z",
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/reference",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assertReferenceResponseSchema(body);
  assert.deepEqual(body.items.map((item) => item.item_id), [
    "artifact-github-com-acme-persistent-agent-runtime",
  ]);
});

test("GET /api/newsletter/reference excludes aged-out items without independent corroboration", async () => {
  const repository = await createRepository([
    buildEdition(2, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-single-cluster-runtime",
        name: "Single Cluster Runtime",
        sourceUrl: "https://github.com/acme/single-cluster-runtime",
        corroboratingUrls: ["https://github.com/acme/single-cluster-runtime/releases"],
        relevanceScore: 78,
        editionCount: 1,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
    buildEdition(3, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-single-cluster-runtime",
        name: "Single Cluster Runtime",
        sourceUrl: "https://github.com/acme/single-cluster-runtime",
        corroboratingUrls: ["https://github.com/acme/single-cluster-runtime/issues"],
        relevanceScore: 82,
        editionCount: 2,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
    buildEdition(5, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-single-cluster-runtime",
        name: "Single Cluster Runtime",
        sourceUrl: "https://github.com/acme/single-cluster-runtime",
        corroboratingUrls: ["https://github.com/acme/single-cluster-runtime/docs"],
        relevanceScore: 88,
        editionCount: 3,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
    ]),
  ]);
  const handler = createNewsletterApiHandler({
    editionRepository: repository,
    now: () => "2026-03-12T21:30:00Z",
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/reference",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assertReferenceResponseSchema(body);
  assert.deepEqual(body.items, []);
});

test("GET /api/newsletter/reference can preserve an underrepresented category with relaxed corroboration", async () => {
  const repository = await createRepository([
    buildEdition(2, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        category: "library",
        relevanceScore: 78,
        editionCount: 1,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
      buildTrackedItem({
        itemId: "artifact-example-com-agent-memory-pattern",
        name: "Agent Memory Pattern",
        sourceUrl: "https://patterns.example.com/agent-memory-pattern",
        category: "technique",
        corroboratingUrls: [],
        relevanceScore: 74,
        editionCount: 1,
        firstSeen: "2026-03-02T19:45:00Z",
      }),
    ]),
    buildEdition(3, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        category: "library",
        relevanceScore: 82,
        editionCount: 2,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
      buildTrackedItem({
        itemId: "artifact-example-com-agent-memory-pattern",
        name: "Agent Memory Pattern",
        sourceUrl: "https://patterns.example.com/agent-memory-pattern",
        category: "technique",
        corroboratingUrls: [],
        relevanceScore: 76,
        editionCount: 2,
        firstSeen: "2026-03-02T19:45:00Z",
      }),
    ]),
    buildEdition(5, [
      buildTrackedItem({
        itemId: "artifact-github-com-acme-persistent-agent-runtime",
        name: "Persistent Agent Runtime",
        sourceUrl: "https://github.com/acme/persistent-agent-runtime",
        category: "library",
        relevanceScore: 88,
        editionCount: 3,
        firstSeen: "2026-03-02T20:30:00Z",
      }),
      buildTrackedItem({
        itemId: "artifact-example-com-agent-memory-pattern",
        name: "Agent Memory Pattern",
        sourceUrl: "https://patterns.example.com/agent-memory-pattern",
        category: "technique",
        corroboratingUrls: [],
        relevanceScore: 81,
        editionCount: 3,
        firstSeen: "2026-03-02T19:45:00Z",
      }),
    ]),
  ]);
  const handler = createNewsletterApiHandler({
    editionRepository: repository,
    sourceRepository: {
      config: {
        minimumActiveCategorySources: 2,
      },
      async load() {
        return {
          sources: [
            {
              id: "web:domain:patterns.example.com",
              kind: "web",
              entityType: "domain",
              platform: "web",
              value: "patterns.example.com",
              displayName: "patterns.example.com",
              url: "https://patterns.example.com",
              canonicalUrl: "https://patterns.example.com",
              fetchUrl: "https://patterns.example.com",
              status: "approved",
              seed: false,
              authorityScore: 78,
              signalScore: 64,
              discoveredAt: "2026-03-10T21:00:00.000Z",
              approvedAt: "2026-03-10T21:00:00.000Z",
              lastSeenAt: "2026-03-11T21:00:00.000Z",
              lifecycle: {
                state: "active",
                stage: "active",
                probationStartedAt: "2026-03-10T21:00:00.000Z",
                activatedAt: "2026-03-11T21:00:00.000Z",
                retiredAt: null,
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
                topicHits: ["agent", "memory"],
                categoryCoverage: ["technique"],
                exampleUrls: ["https://patterns.example.com/agent-memory-pattern"],
              },
              discoveredFromUrls: ["https://github.com/trending"],
            },
          ],
        };
      },
    },
    now: () => "2026-03-12T21:30:00Z",
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/reference",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assertReferenceResponseSchema(body);
  assert.deepEqual(body.items.map((item) => item.item_id), [
    "artifact-github-com-acme-persistent-agent-runtime",
    "artifact-example-com-agent-memory-pattern",
  ]);
  assert.equal(body.items[1].category, "technique");
});

test("GET /api/newsletter/reference forwards the configured archive window to the reference lookup", async () => {
  const calls = [];
  const handler = createNewsletterApiHandler({
    editionRepository: {
      async getLatestPublishedEdition() {
        return null;
      },
      async listPublishedEditions() {
        return [];
      },
      async listReferenceItems(input) {
        calls.push(input);
        return [];
      },
    },
    archiveWindowDays: 14,
    now: () => "2026-03-12T21:30:00Z",
    consumerTracking: false,
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/reference",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assertReferenceResponseSchema(body);
  assert.equal(body.archive_window_days, 14);
  assert.deepEqual(calls, [
    {
      now: "2026-03-12T21:30:00.000Z",
      days: 14,
      consumer: null,
      underrepresentedCategories: [],
    },
  ]);
});
