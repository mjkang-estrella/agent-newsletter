import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ConsumerIdentityRepository,
  NEWSLETTER_DATA_DIR_ENV_NAME,
  createDefaultNewsletterApiHandler,
  createNewsletterApiHandler,
  resolvePublicationRuntimePaths,
} from "../src/index.js";

function buildEdition() {
  return {
    id: "2026-03-11",
    publishedAt: "2026-03-11T21:00:00Z",
    window: {
      startsAt: "2026-03-10T21:00:00Z",
      endsAt: "2026-03-11T21:00:00Z",
      timezone: "UTC",
    },
    items: [
      {
        itemId: "artifact-agent-runtime-kit",
        name: "Agent Runtime Kit",
        sourceUrl: "https://example.com/agent-runtime-kit",
        sourceUrls: [
          "https://example.com/agent-runtime-kit",
          "https://mirror.example.com/agent-runtime-kit",
        ],
        category: "tool",
        summary: "Composable runtime for agent integrations and orchestration.",
        integrationHint: "Review the quickstart before enabling autonomous actions.",
        relevanceScore: 88,
        riskWarning: {
          severity: "medium",
          description: "Validate sandboxing and approval flows before rollout.",
        },
        mentionCount: 2,
        sourceKinds: ["github", "reddit"],
        adapterIds: ["github", "reddit"],
        sourceAuthorityScore: 92,
        discoveredAt: "2026-03-11T20:10:00Z",
        firstSeen: "2026-03-11T20:10:00Z",
        editionCount: 1,
        sentimentSpread: "agree",
      },
    ],
  };
}

async function createConsumerRepository() {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-consumer-flow-"));

  return new ConsumerIdentityRepository({
    filePath: join(directory, "consumer-identities.json"),
  });
}

function createEditionRepository(edition = buildEdition()) {
  const calls = {
    latest: [],
    history: [],
    reference: [],
  };

  return {
    calls,

    async getLatestPublishedEdition(context) {
      calls.latest.push(context);
      return edition;
    },

    async listPublishedEditions(context) {
      calls.history.push(context);
      return [edition];
    },

    async listReferenceItems(context) {
      calls.reference.push(context);
      return edition.items;
    },

    async getItemLifecycle() {
      return null;
    },
  };
}

function createRequest({
  url,
  remoteAddress = "203.0.113.10",
  consumerId,
  userAgent = "agent-newsletter-test/1.0",
  forwardedFor,
} = {}) {
  const headers = {
    "user-agent": userAgent,
  };

  if (consumerId) {
    headers["x-agent-consumer-id"] = consumerId;
  }

  if (forwardedFor) {
    headers["x-forwarded-for"] = forwardedFor;
  }

  return {
    method: "GET",
    url,
    headers,
    socket: {
      remoteAddress,
    },
  };
}

test("GET /api/newsletter/latest attributes the request to a persisted consumer entity", async () => {
  const consumerRepository = await createConsumerRepository();
  const editionRepository = createEditionRepository();
  const handler = createNewsletterApiHandler({
    editionRepository,
    now: () => "2026-03-11T21:30:00Z",
    consumerTracking: {
      repository: consumerRepository,
    },
    rateLimit: {
      maxRequests: 3,
      windowMs: 60_000,
      now: () => 1_000,
    },
  });

  const response = await handler(
    createRequest({
      url: "/api/newsletter/latest",
      consumerId: "agent-alpha",
      remoteAddress: "203.0.113.10",
    }),
  );
  const snapshot = await consumerRepository.load({
    now: "2026-03-11T21:30:00Z",
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers["x-ratelimit-limit"], "3");
  assert.equal(response.headers["x-ratelimit-remaining"], "2");
  assert.equal(editionRepository.calls.latest.length, 1);
  assert.equal(snapshot.consumers.length, 1);
  assert.equal(editionRepository.calls.latest[0].now, "2026-03-11T21:30:00.000Z");
  assert.equal(editionRepository.calls.latest[0].consumer.id, snapshot.consumers[0].id);
  assert.equal(editionRepository.calls.latest[0].consumer.declaredId, snapshot.consumers[0].declaredId);
  assert.equal(
    editionRepository.calls.latest[0].consumer.rateLimitUsage,
    undefined,
    "route handlers should receive the request-time consumer snapshot before tracking finalization",
  );
  assert.equal(snapshot.consumers[0].identitySource, "consumer_header");
  assert.equal(snapshot.consumers[0].declaredId, "agent-alpha");
  assert.equal(snapshot.consumers[0].requestCount, 1);
  assert.equal(snapshot.consumers[0].successfulRequestCount, 1);
  assert.equal(snapshot.consumers[0].throttledRequestCount, 0);
  assert.deepEqual(snapshot.consumers[0].lastRequest, {
    at: "2026-03-11T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/latest",
    outcome: "successful",
  });
  assert.deepEqual(snapshot.consumers[0].rateLimitUsage, {
    evaluatedRequestCount: 1,
    allowedRequestCount: 1,
    blockedRequestCount: 0,
    keys: ["203.0.113.10"],
    lastDecision: {
      at: "2026-03-11T21:30:00.000Z",
      key: "203.0.113.10",
      limited: false,
      limit: 3,
      remaining: 2,
      resetAt: 61,
    },
  });
});

test("GET /api/newsletter/history throttles repeated requests while still attributing them to one consumer entity", async () => {
  const consumerRepository = await createConsumerRepository();
  const editionRepository = createEditionRepository();
  const handler = createNewsletterApiHandler({
    editionRepository,
    now: () => "2026-03-11T21:30:00Z",
    consumerTracking: {
      repository: consumerRepository,
    },
    rateLimit: {
      maxRequests: 1,
      windowMs: 60_000,
      now: () => 5_000,
    },
  });

  const firstResponse = await handler(
    createRequest({
      url: "/api/newsletter/history",
      consumerId: "agent-beta",
      remoteAddress: "198.51.100.8",
    }),
  );
  const secondResponse = await handler(
    createRequest({
      url: "/api/newsletter/history",
      consumerId: "agent-beta",
      remoteAddress: "198.51.100.8",
    }),
  );
  const secondBody = JSON.parse(secondResponse.body);
  const snapshot = await consumerRepository.load({
    now: "2026-03-11T21:30:00Z",
  });

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 429);
  assert.deepEqual(secondBody, {
    error: "rate_limited",
    message: "Too many requests from this IP. Try again later.",
    retry_after_seconds: 60,
  });
  assert.equal(editionRepository.calls.history.length, 1);
  assert.equal(snapshot.consumers.length, 1);
  assert.equal(snapshot.consumers[0].declaredId, "agent-beta");
  assert.equal(snapshot.consumers[0].requestCount, 2);
  assert.equal(snapshot.consumers[0].successfulRequestCount, 1);
  assert.equal(snapshot.consumers[0].throttledRequestCount, 1);
  assert.deepEqual(snapshot.consumers[0].lastRequest, {
    at: "2026-03-11T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/history",
    outcome: "throttled",
  });
  assert.deepEqual(snapshot.consumers[0].rateLimitUsage, {
    evaluatedRequestCount: 2,
    allowedRequestCount: 1,
    blockedRequestCount: 1,
    keys: ["198.51.100.8"],
    lastDecision: {
      at: "2026-03-11T21:30:00.000Z",
      key: "198.51.100.8",
      limited: true,
      limit: 1,
      remaining: 0,
      resetAt: 65,
    },
  });
  assert.equal(snapshot.consumers[0].observedClientIps[0].requestCount, 2);
  assert.equal(snapshot.consumers[0].observedClientIps[0].successfulRequestCount, 1);
  assert.equal(snapshot.consumers[0].observedClientIps[0].throttledRequestCount, 1);
});

test("repeat consumers keep the same consumer entity across newsletter endpoints", async () => {
  const consumerRepository = await createConsumerRepository();
  const editionRepository = createEditionRepository();
  const handler = createNewsletterApiHandler({
    editionRepository,
    now: () => "2026-03-11T21:30:00Z",
    consumerTracking: {
      repository: consumerRepository,
      trustProxy: true,
    },
    rateLimit: {
      maxRequests: 5,
      windowMs: 60_000,
      now: () => 9_000,
      trustProxy: true,
    },
  });

  const latestResponse = await handler(
    createRequest({
      url: "/api/newsletter/latest",
      consumerId: "agent-gamma",
      remoteAddress: "10.0.0.3",
      forwardedFor: "203.0.113.42, 10.0.0.3",
      userAgent: "agent-gamma/1.0",
    }),
  );
  const referenceResponse = await handler(
    createRequest({
      url: "/api/newsletter/reference",
      consumerId: "agent-gamma",
      remoteAddress: "10.0.0.4",
      forwardedFor: "198.51.100.20, 10.0.0.4",
      userAgent: "agent-gamma/1.0",
    }),
  );
  const snapshot = await consumerRepository.load({
    now: "2026-03-11T21:30:00Z",
  });

  assert.equal(latestResponse.status, 200);
  assert.equal(referenceResponse.status, 200);
  assert.equal(snapshot.consumers.length, 1);
  assert.equal(snapshot.consumers[0].declaredId, "agent-gamma");
  assert.equal(snapshot.consumers[0].requestCount, 2);
  assert.equal(snapshot.consumers[0].successfulRequestCount, 2);
  assert.equal(snapshot.consumers[0].throttledRequestCount, 0);
  assert.equal(snapshot.consumers[0].observedClientIps.length, 2);
  assert.equal(
    editionRepository.calls.latest[0].consumer.id,
    editionRepository.calls.reference[0].consumer.id,
  );
  assert.deepEqual(snapshot.consumers[0].lastRequest, {
    at: "2026-03-11T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/reference",
    outcome: "successful",
  });
  assert.deepEqual(snapshot.consumers[0].rateLimitUsage, {
    evaluatedRequestCount: 2,
    allowedRequestCount: 2,
    blockedRequestCount: 0,
    keys: ["198.51.100.20", "203.0.113.42"],
    lastDecision: {
      at: "2026-03-11T21:30:00.000Z",
      key: "198.51.100.20",
      limited: false,
      limit: 5,
      remaining: 4,
      resetAt: 69,
    },
  });
});

test("repeat consumers keep one fallback entity across user-agent version changes", async () => {
  const consumerRepository = await createConsumerRepository();
  const editionRepository = createEditionRepository();
  const handler = createNewsletterApiHandler({
    editionRepository,
    now: () => "2026-03-11T21:30:00Z",
    consumerTracking: {
      repository: consumerRepository,
      trustProxy: true,
    },
    rateLimit: {
      maxRequests: 5,
      windowMs: 60_000,
      now: () => 11_000,
      trustProxy: true,
    },
  });

  const latestResponse = await handler(
    createRequest({
      url: "/api/newsletter/latest",
      remoteAddress: "10.0.0.3",
      forwardedFor: "203.0.113.42, 10.0.0.3",
      userAgent: "agent-drift/1.0 (+https://example.com/agent-drift)",
    }),
  );
  const historyResponse = await handler(
    createRequest({
      url: "/api/newsletter/history",
      remoteAddress: "10.0.0.4",
      forwardedFor: "198.51.100.20, 10.0.0.4",
      userAgent: "agent-drift/1.1 (+https://example.com/agent-drift)",
    }),
  );
  const snapshot = await consumerRepository.load({
    now: "2026-03-11T21:30:00Z",
  });

  assert.equal(latestResponse.status, 200);
  assert.equal(historyResponse.status, 200);
  assert.equal(snapshot.consumers.length, 1);
  assert.equal(snapshot.consumers[0].identitySource, "user_agent");
  assert.equal(snapshot.consumers[0].declaredId, null);
  assert.equal(snapshot.consumers[0].requestCount, 2);
  assert.equal(snapshot.consumers[0].successfulRequestCount, 2);
  assert.equal(snapshot.consumers[0].throttledRequestCount, 0);
  assert.equal(snapshot.consumers[0].userAgent, "agent-drift/1.1 (+https://example.com/agent-drift)");
  assert.deepEqual(
    snapshot.consumers[0].observedClientIps.map((entry) => entry.address),
    ["198.51.100.20", "203.0.113.42"],
  );
  assert.equal(editionRepository.calls.latest[0].consumer.id, editionRepository.calls.history[0].consumer.id);
  assert.deepEqual(snapshot.consumers[0].lastRequest, {
    at: "2026-03-11T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/history",
    outcome: "successful",
  });
  assert.deepEqual(snapshot.consumers[0].rateLimitUsage, {
    evaluatedRequestCount: 2,
    allowedRequestCount: 2,
    blockedRequestCount: 0,
    keys: ["198.51.100.20", "203.0.113.42"],
    lastDecision: {
      at: "2026-03-11T21:30:00.000Z",
      key: "198.51.100.20",
      limited: false,
      limit: 5,
      remaining: 4,
      resetAt: 71,
    },
  });
});

test("repeat consumers can be recognized after later declaring an explicit consumer id", async () => {
  const consumerRepository = await createConsumerRepository();
  const editionRepository = createEditionRepository();
  const handler = createNewsletterApiHandler({
    editionRepository,
    now: () => "2026-03-11T21:30:00Z",
    consumerTracking: {
      repository: consumerRepository,
      trustProxy: true,
    },
    rateLimit: {
      maxRequests: 5,
      windowMs: 60_000,
      now: () => 12_000,
      trustProxy: true,
    },
  });

  const firstResponse = await handler(
    createRequest({
      url: "/api/newsletter/latest",
      remoteAddress: "10.0.0.3",
      forwardedFor: "203.0.113.42, 10.0.0.3",
      userAgent: "agent-upgrade/1.0",
    }),
  );
  const secondResponse = await handler(
    createRequest({
      url: "/api/newsletter/history",
      consumerId: "agent-upgrade",
      remoteAddress: "10.0.0.4",
      forwardedFor: "198.51.100.20, 10.0.0.4",
      userAgent: "agent-upgrade/1.0",
    }),
  );
  const snapshot = await consumerRepository.load({
    now: "2026-03-11T21:30:00Z",
  });

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(snapshot.consumers.length, 1);
  assert.equal(snapshot.consumers[0].identitySource, "consumer_header");
  assert.equal(snapshot.consumers[0].declaredId, "agent-upgrade");
  assert.equal(snapshot.consumers[0].userAgent, "agent-upgrade/1.0");
  assert.equal(snapshot.consumers[0].requestCount, 2);
  assert.equal(snapshot.consumers[0].successfulRequestCount, 2);
  assert.equal(snapshot.consumers[0].throttledRequestCount, 0);
  assert.equal(editionRepository.calls.latest[0].consumer.id, editionRepository.calls.history[0].consumer.id);
  assert.deepEqual(snapshot.consumers[0].lastRequest, {
    at: "2026-03-11T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/history",
    outcome: "successful",
  });
});

test("createDefaultNewsletterApiHandler persists consumer records in the runtime data directory by default", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-default-api-"));
  const env = {
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };
  const paths = resolvePublicationRuntimePaths({ cwd, env });
  const editionRepository = createEditionRepository();
  const handler = createDefaultNewsletterApiHandler({
    cwd,
    env,
    editionRepository,
    now: () => "2026-03-11T21:30:00Z",
    consumerTracking: {
      trustProxy: true,
    },
    rateLimit: false,
  });

  const response = await handler(
    createRequest({
      url: "/api/newsletter/latest",
      consumerId: "agent-default",
      remoteAddress: "10.0.0.8",
      forwardedFor: "203.0.113.77, 10.0.0.8",
      userAgent: "agent-default/1.0",
    }),
  );
  const consumerRepository = new ConsumerIdentityRepository({
    filePath: paths.consumerIdentityRegistryPath,
  });
  const snapshot = await consumerRepository.load({
    now: "2026-03-11T21:30:00Z",
  });

  assert.equal(response.status, 200);
  assert.equal(snapshot.consumers.length, 1);
  assert.equal(snapshot.consumers[0].declaredId, "agent-default");
  assert.equal(snapshot.consumers[0].requestCount, 1);
  assert.equal(snapshot.consumers[0].successfulRequestCount, 1);
  assert.equal(snapshot.consumers[0].throttledRequestCount, 0);
  assert.deepEqual(snapshot.consumers[0].observedClientIps, [
    {
      address: "203.0.113.77",
      source: "x-forwarded-for",
      directIp: "10.0.0.8",
      forwardedChain: ["203.0.113.77", "10.0.0.8"],
      trustProxy: true,
      firstSeenAt: "2026-03-11T21:30:00.000Z",
      lastSeenAt: "2026-03-11T21:30:00.000Z",
      requestCount: 1,
      successfulRequestCount: 1,
      throttledRequestCount: 0,
    },
  ]);
  assert.deepEqual(snapshot.consumers[0].lastRequest, {
    at: "2026-03-11T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/latest",
    outcome: "successful",
  });
});
