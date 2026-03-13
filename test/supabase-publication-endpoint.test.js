import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemorySupabaseNewsletterDataStore,
  SupabaseNewsletterEditionStore,
  createSupabasePublicationRequestHandler,
} from "../src/index.js";

function createEnv(overrides = {}) {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "supabase-secret",
    CRON_SECRET: "cron-secret",
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    ...overrides,
  };
}

function buildEdition({
  publishedAt = "2026-03-12T21:00:00.000Z",
  itemName = "Agent Runtime",
} = {}) {
  return {
    id: publishedAt.slice(0, 10),
    publishedAt,
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: publishedAt,
      timezone: "UTC",
    },
    items: [
      {
        itemId: "artifact-agent-runtime",
        name: itemName,
        sourceUrl: "https://github.com/acme/agent-runtime",
        sourceUrls: [
          "https://github.com/acme/agent-runtime",
          "https://docs.example.com/agent-runtime",
        ],
        category: "library",
        summary: "Runtime primitives for tool-using agents.",
        integrationHint: "npm install agent-runtime",
        relevanceScore: 88,
        riskWarning: {
          severity: "medium",
          description: "Review sandbox settings before rollout.",
        },
        mentionCount: 2,
        sourceKinds: ["github", "web"],
        adapterIds: ["github", "web-discovery"],
        sourceAuthorityScore: 95,
        discoveredAt: "2026-03-12T20:30:00.000Z",
        firstSeen: "2026-03-12T20:30:00.000Z",
        editionCount: 1,
        sentimentSpread: "agree",
      },
    ],
  };
}

function createRuntime(dataStore, { publishEdition = buildEdition() } = {}) {
  const editionStore = new SupabaseNewsletterEditionStore({
    dataStore,
  });
  let publishCount = 0;

  return {
    editionStore,
    get publishCount() {
      return publishCount;
    },
    async publishNewsletterEdition() {
      publishCount += 1;
      return editionStore.publish(publishEdition);
    },
  };
}

function createRequest({
  method = "POST",
  token = "cron-secret",
  url = "/api/internal/publish",
} = {}) {
  return {
    method,
    url,
    headers: {
      authorization: `Bearer ${token}`,
    },
  };
}

test("internal publish endpoint rejects an invalid bearer token", async () => {
  const dataStore = new InMemorySupabaseNewsletterDataStore();
  const handler = createSupabasePublicationRequestHandler({
    env: createEnv(),
    dataStore,
    runtime: createRuntime(dataStore),
    now: () => "2026-03-12T21:05:00.000Z",
  });

  const response = await handler(
    createRequest({
      token: "wrong-token",
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    error: "unauthorized",
    message: "Invalid or missing bearer token.",
  });
});

test("internal publish endpoint skips publication outside the schedule window", async () => {
  const dataStore = new InMemorySupabaseNewsletterDataStore();
  const runtime = createRuntime(dataStore);
  const handler = createSupabasePublicationRequestHandler({
    env: createEnv(),
    dataStore,
    runtime,
    now: () => "2026-03-12T20:00:00.000Z",
  });

  const response = await handler(createRequest());
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    ok: true,
    published: false,
    forced: false,
    next_run_at: "2026-03-12T21:00:00.000Z",
  });
  assert.equal(runtime.publishCount, 0);
});

test("internal publish endpoint publishes once per slot and returns the existing edition on retries", async () => {
  const dataStore = new InMemorySupabaseNewsletterDataStore();
  const runtime = createRuntime(dataStore);
  const handler = createSupabasePublicationRequestHandler({
    env: createEnv(),
    dataStore,
    runtime,
    now: () => "2026-03-12T21:05:00.000Z",
  });

  const firstResponse = await handler(createRequest());
  const firstPayload = JSON.parse(firstResponse.body);

  assert.equal(firstResponse.status, 200);
  assert.deepEqual(firstPayload, {
    ok: true,
    published: true,
    forced: false,
    edition_id: "2026-03-12",
    published_at: "2026-03-12T21:00:00.000Z",
    item_count: 1,
  });
  assert.equal(runtime.publishCount, 1);

  const secondResponse = await handler(createRequest());
  const secondPayload = JSON.parse(secondResponse.body);

  assert.equal(secondResponse.status, 200);
  assert.deepEqual(secondPayload, {
    ok: true,
    published: false,
    forced: false,
    edition_id: "2026-03-12",
    published_at: "2026-03-12T21:00:00.000Z",
    item_count: 1,
  });
  assert.equal(runtime.publishCount, 1);
});
