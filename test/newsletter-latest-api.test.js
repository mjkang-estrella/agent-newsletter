import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  NewsletterEditionStore,
  NewsletterEditionRepository,
  createNewsletterApiHandler,
} from "../src/index.js";

function buildEdition(day, itemName) {
  return {
    id: `2026-03-${String(day).padStart(2, "0")}`,
    publishedAt: `2026-03-${String(day).padStart(2, "0")}T21:00:00Z`,
    window: {
      startsAt: `2026-03-${String(day - 1).padStart(2, "0")}T21:00:00Z`,
      endsAt: `2026-03-${String(day).padStart(2, "0")}T21:00:00Z`,
      timezone: "UTC",
    },
    items: [
      {
        itemId: `artifact-${itemName.toLowerCase().replace(/\s+/g, "-")}`,
        name: itemName,
        sourceUrl: `https://example.com/${itemName.toLowerCase().replace(/\s+/g, "-")}`,
        sourceUrls: [
          `https://example.com/${itemName.toLowerCase().replace(/\s+/g, "-")}`,
          `https://mirror.example.com/${itemName.toLowerCase().replace(/\s+/g, "-")}`,
        ],
        category: "tool",
        summary: `${itemName} helps agents ship integrations faster.`,
        integrationHint: `Review ${itemName} installation docs before rollout.`,
        relevanceScore: 84,
        riskWarning: {
          severity: "medium",
          description: "Validate production readiness before enabling autonomous actions.",
        },
        mentionCount: 2,
        sourceKinds: ["github", "reddit"],
        adapterIds: ["github", "reddit"],
        sourceAuthorityScore: 91,
        discoveredAt: `2026-03-${String(day).padStart(2, "0")}T20:30:00Z`,
        firstSeen: `2026-03-${String(Math.max(1, day - 2)).padStart(2, "0")}T20:30:00Z`,
        editionCount: 3,
        sentimentSpread: {
          classification: "mixed",
          disagreementDimension: "utility",
        },
      },
    ],
  };
}

async function createRepository(editions) {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new NewsletterEditionRepository({
    filePath: join(directory, "newsletter-editions.json"),
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:05:00Z",
    editions,
  });

  return repository;
}

async function createStore(editions) {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-store-"));
  const store = new NewsletterEditionStore({ directoryPath: directory });

  for (const edition of editions) {
    await store.publish(edition);
  }

  return store;
}

function createLatestRequestHandler(repository, now = "2026-03-11T21:30:00Z") {
  return createNewsletterApiHandler({
    editionRepository: repository,
    now: () => now,
  });
}

test("NewsletterEditionRepository returns the most recent published edition", async () => {
  const repository = await createRepository([
    buildEdition(10, "Archive Day Six"),
    buildEdition(11, "Archive Day Seven"),
    {
      ...buildEdition(12, "Future Agent Toolkit"),
      publishedAt: "2026-03-12T21:00:00Z",
      window: {
        startsAt: "2026-03-11T21:00:00Z",
        endsAt: "2026-03-12T21:00:00Z",
        timezone: "UTC",
      },
    },
  ]);

  const edition = await repository.getLatestPublishedEdition({
    now: "2026-03-12T12:00:00Z",
  });

  assert.equal(edition?.id, "2026-03-11");
  assert.equal(edition?.publishedAt, "2026-03-11T21:00:00.000Z");
});

test("GET /api/newsletter/latest returns the most recent published edition", async () => {
  const repository = await createRepository([
    buildEdition(10, "Archive Day Six"),
    buildEdition(11, "Archive Day Seven"),
    {
      ...buildEdition(12, "Future Agent Toolkit"),
      publishedAt: "2026-03-12T21:00:00Z",
      window: {
        startsAt: "2026-03-11T21:00:00Z",
        endsAt: "2026-03-12T21:00:00Z",
        timezone: "UTC",
      },
    },
  ]);
  const handler = createLatestRequestHandler(repository);
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/latest",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(body, {
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
        item_id: "artifact-archive-day-seven",
        name: "Archive Day Seven",
        source_urls: [
          "https://example.com/archive-day-seven",
          "https://mirror.example.com/archive-day-seven",
        ],
        category: "tool",
        summary: "Archive Day Seven helps agents ship integrations faster.",
        integration_hint: "Review Archive Day Seven installation docs before rollout.",
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
        first_seen: "2026-03-09T20:30:00.000Z",
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

test("GET /api/newsletter/latest works when NewsletterEditionStore is passed as editionRepository", async () => {
  const newsletterStore = await createStore([
    buildEdition(10, "Archive Day Six"),
    buildEdition(11, "Archive Day Seven"),
    {
      ...buildEdition(12, "Future Agent Toolkit"),
      publishedAt: "2026-03-12T21:00:00Z",
      window: {
        startsAt: "2026-03-11T21:00:00Z",
        endsAt: "2026-03-12T21:00:00Z",
        timezone: "UTC",
      },
    },
  ]);
  const handler = createNewsletterApiHandler({
    editionRepository: newsletterStore,
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/latest",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(body.edition_id, "2026-03-11");
  assert.equal(body.item_count, 1);
  assert.equal(body.items[0].item_id, "artifact-archive-day-seven");
});

test("GET /api/newsletter/latest returns 404 when no edition has been published yet", async () => {
  const repository = await createRepository([
    {
      ...buildEdition(12, "Future Agent Toolkit"),
      publishedAt: "2026-03-12T21:00:00Z",
      window: {
        startsAt: "2026-03-11T21:00:00Z",
        endsAt: "2026-03-12T21:00:00Z",
        timezone: "UTC",
      },
    },
  ]);
  const handler = createLatestRequestHandler(repository, "2026-03-12T12:00:00Z");
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/latest",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 404);
  assert.deepEqual(body, {
    error: "not_found",
    message: "No published newsletter edition is available.",
  });
});
