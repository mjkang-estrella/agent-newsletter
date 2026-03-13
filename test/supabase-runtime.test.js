import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemorySupabaseNewsletterDataStore,
  ITEM_IDENTITY_REGISTRY_STATE_KEY,
  SOURCE_REGISTRY_STATE_KEY,
  createNormalizedItemFromSourceRecord,
  createSupabaseNewsletterApiHandler,
  createSupabasePublicationTask,
  defineSourceAdapter,
} from "../src/index.js";

function createEnv(overrides = {}) {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "supabase-secret",
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    NEWSLETTER_API_RATE_LIMIT_MAX_REQUESTS: "2",
    ...overrides,
  };
}

function createGithubAdapter() {
  return defineSourceAdapter({
    descriptor: {
      id: "github",
      kind: "github",
      displayName: "GitHub",
      authorityScore: 95,
      seeded: true,
      supportsDiscovery: true,
      minimumItemAuthorityScore: 70,
    },
    async fetch() {
      return {
        items: [
          createNormalizedItemFromSourceRecord({
            adapterId: "github",
            sourceType: "github",
            externalId: "agent-runtime",
            title: "Agent Runtime",
            sourceName: "GitHub",
            sourceUrl: "https://github.com/acme/agent-runtime",
            publishedAt: "2026-03-12T20:30:00.000Z",
            discoveredAt: "2026-03-12T20:30:00.000Z",
            summary: "Runtime primitives for autonomous agent execution.",
            outboundUrls: ["https://docs.example.com/agent-runtime"],
            tags: ["agent", "runtime", "sdk"],
            category: "library",
            integrationHint: "npm install agent-runtime",
            author: null,
            metrics: {
              mentions: 2,
              upvotes: 0,
              comments: 0,
              shares: 0,
            },
            sourceAuthority: {
              authority: 95,
            },
            riskWarning: {
              severity: "medium",
              description: "Review runtime sandboxing before rollout.",
            },
            raw: {},
          }),
        ],
      };
    },
  });
}

function createApiRequest(overrides = {}) {
  return {
    method: "GET",
    url: "/api/newsletter/latest",
    headers: {
      "x-forwarded-for": "203.0.113.20",
      "x-newsletter-consumer": "reader-1",
      ...overrides.headers,
    },
    ...overrides,
  };
}

test("Supabase publication task persists editions and runtime state into the shared store", async () => {
  const dataStore = new InMemorySupabaseNewsletterDataStore();
  const task = createSupabasePublicationTask({
    env: createEnv(),
    dataStore,
    now: () => "2026-03-12T21:05:00.000Z",
    createAdapters() {
      return {
        github: createGithubAdapter(),
      };
    },
  });

  const edition = await task.publishNewsletterEdition();
  const snapshot = dataStore.snapshot();

  assert.equal(edition.id, "2026-03-12");
  assert.equal(snapshot.editions.length, 1);
  assert.ok(snapshot.runtimeStates[SOURCE_REGISTRY_STATE_KEY]);
  assert.ok(snapshot.runtimeStates[ITEM_IDENTITY_REGISTRY_STATE_KEY]);
});

test("Supabase API handler serves the published edition and records consumer telemetry", async () => {
  const dataStore = new InMemorySupabaseNewsletterDataStore();
  const task = createSupabasePublicationTask({
    env: createEnv(),
    dataStore,
    now: () => "2026-03-12T21:05:00.000Z",
    createAdapters() {
      return {
        github: createGithubAdapter(),
      };
    },
  });

  await task.publishNewsletterEdition();

  const handler = createSupabaseNewsletterApiHandler({
    env: createEnv(),
    dataStore,
    now: () => "2026-03-12T21:30:00.000Z",
  });
  const response = await handler(createApiRequest());
  const payload = JSON.parse(response.body);
  const snapshot = dataStore.snapshot();

  assert.equal(response.status, 200);
  assert.equal(payload.edition_id, "2026-03-12");
  assert.equal(response.headers["x-ratelimit-limit"], "2");
  assert.equal(response.headers["x-ratelimit-remaining"], "1");
  assert.equal(snapshot.consumerEvents.length, 1);
  assert.deepEqual(snapshot.consumerEvents[0], {
    occurredAt: "2026-03-12T21:30:00.000Z",
    consumerId: snapshot.consumerEvents[0].consumerId,
    identitySource: "consumer_header",
    declaredId: "reader-1",
    userAgent: null,
    clientIp: "203.0.113.20",
    method: "GET",
    path: "/api/newsletter/latest",
    outcome: "successful",
    rateLimit: {
      key: "203.0.113.20",
      limited: false,
      limit: 2,
      remaining: 1,
      resetAt: snapshot.consumerEvents[0].rateLimit.resetAt,
    },
    metadata: {
      fallbackIdentity: {
        source: "ip",
        value: "203.0.113.20",
        observedValue: "203.0.113.20",
      },
      clientIp: {
        ip: "203.0.113.20",
        source: "x-forwarded-for",
        directIp: "unknown",
        forwardedChain: ["203.0.113.20"],
        trustProxy: true,
      },
      responseStatus: 200,
    },
  });
});

test("Supabase consumer tracking failures do not break the API response path", async () => {
  const baseStore = new InMemorySupabaseNewsletterDataStore();
  const task = createSupabasePublicationTask({
    env: createEnv(),
    dataStore: baseStore,
    now: () => "2026-03-12T21:05:00.000Z",
    createAdapters() {
      return {
        github: createGithubAdapter(),
      };
    },
  });

  await task.publishNewsletterEdition();

  const failingStore = Object.create(baseStore);
  failingStore.insertConsumerEvent = async () => {
    throw new Error("consumer event failure");
  };
  const handler = createSupabaseNewsletterApiHandler({
    env: createEnv(),
    dataStore: failingStore,
    now: () => "2026-03-12T21:30:00.000Z",
  });

  const response = await handler(createApiRequest());

  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).edition_id, "2026-03-12");
});
