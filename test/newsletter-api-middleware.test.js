import test from "node:test";
import assert from "node:assert/strict";

import {
  createInMemoryConsumerTrackingStore,
  createNewsletterApiHandler,
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

function createEditionRepository(edition = buildEdition()) {
  return {
    async getLatestPublishedEdition() {
      return edition;
    },

    async listPublishedEditions() {
      return [edition];
    },

    async getItemLifecycle() {
      return null;
    },

    async listReferenceItems() {
      return [];
    },
  };
}

function createRequest({
  ipAddress,
  route = "/api/newsletter/latest",
  consumerId,
  userAgent,
}) {
  const headers = {};

  if (consumerId) {
    headers["x-newsletter-consumer"] = consumerId;
  }

  if (userAgent) {
    headers["user-agent"] = userAgent;
  }

  return {
    method: "GET",
    url: route,
    headers,
    socket: {
      remoteAddress: ipAddress,
    },
  };
}

function createHandler({
  consumerStore = createInMemoryConsumerTrackingStore(),
  rateLimit = false,
} = {}) {
  return {
    consumerStore,
    handler: createNewsletterApiHandler({
      editionRepository: createEditionRepository(),
      now: () => "2026-03-11T21:30:00Z",
      consumerTracking: {
        store: consumerStore,
      },
      rateLimit,
    }),
  };
}

test("newsletter API middleware allows requests and records the consumer and IP", async () => {
  const { handler, consumerStore } = createHandler({
    rateLimit: {
      maxRequests: 3,
      windowMs: 60_000,
      now: () => 1_000,
    },
  });
  const request = createRequest({
    ipAddress: "203.0.113.10",
    consumerId: "agent-alpha",
  });

  const response = await handler(request);

  assert.equal(response.status, 200);
  assert.equal(response.headers["x-ratelimit-limit"], "3");
  assert.equal(response.headers["x-ratelimit-remaining"], "2");
  assert.deepEqual(request.newsletterConsumer?.lastRequest, {
    at: "2026-03-11T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/latest",
    outcome: "successful",
  });
  assert.deepEqual(request.newsletterConsumer?.rateLimitUsage, {
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
  assert.deepEqual(request.newsletterRequestContext.consumer?.lastRequest, {
    at: "2026-03-11T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/latest",
    outcome: "successful",
  });
  assert.deepEqual(request.newsletterRequestContext.consumer?.rateLimitUsage, {
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
  const trackedConsumer = consumerStore.getConsumer("agent-alpha");

  assert.match(trackedConsumer.id, /^consumer-consumer_header-/);
  assert.deepEqual(trackedConsumer, {
    id: trackedConsumer.id,
    consumerId: "agent-alpha",
    identitySource: "consumer_header",
    declaredId: "agent-alpha",
    fallbackIdentity: {
      source: "ip",
      value: "203.0.113.10",
      observedValue: "203.0.113.10",
    },
    userAgent: null,
    firstSeenAt: "2026-03-11T21:30:00.000Z",
    lastSeenAt: "2026-03-11T21:30:00.000Z",
    requestCount: 1,
    successfulRequestCount: 1,
    throttledRequestCount: 0,
    ipAddresses: ["203.0.113.10"],
    observedClientIps: [
      {
        address: "203.0.113.10",
        source: "socket",
        directIp: "203.0.113.10",
        forwardedChain: [],
        trustProxy: false,
        firstSeenAt: "2026-03-11T21:30:00.000Z",
        lastSeenAt: "2026-03-11T21:30:00.000Z",
        requestCount: 1,
        successfulRequestCount: 1,
        throttledRequestCount: 0,
      },
    ],
    methods: ["GET"],
    routes: ["/api/newsletter/latest"],
    requestActivity: [
      {
        date: "2026-03-11",
        firstRequestAt: "2026-03-11T21:30:00.000Z",
        lastRequestAt: "2026-03-11T21:30:00.000Z",
        requestCount: 1,
        successfulRequestCount: 1,
        throttledRequestCount: 0,
        methods: ["GET"],
        paths: ["/api/newsletter/latest"],
      },
    ],
    lastRequest: {
      at: "2026-03-11T21:30:00.000Z",
      method: "GET",
      path: "/api/newsletter/latest",
      outcome: "successful",
    },
    rateLimitUsage: {
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
    },
  });
  assert.deepEqual(consumerStore.getIp("203.0.113.10"), {
    ipAddress: "203.0.113.10",
    firstSeenAt: "2026-03-11T21:30:00.000Z",
    lastSeenAt: "2026-03-11T21:30:00.000Z",
    requestCount: 1,
    successfulRequestCount: 1,
    throttledRequestCount: 0,
    consumerIds: ["agent-alpha"],
    consumerEntityIds: [trackedConsumer.id],
  });
});

test("newsletter API middleware enforces the IP rate limit and still tracks the blocked consumer", async () => {
  const { handler, consumerStore } = createHandler({
    rateLimit: {
      maxRequests: 1,
      windowMs: 60_000,
      now: () => 5_000,
    },
  });
  const firstRequest = createRequest({
    ipAddress: "198.51.100.7",
    consumerId: "agent-beta",
  });
  const secondRequest = createRequest({
    ipAddress: "198.51.100.7",
    consumerId: "agent-beta",
  });

  const firstResponse = await handler(firstRequest);
  const secondResponse = await handler(secondRequest);
  const secondBody = JSON.parse(secondResponse.body);

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 429);
  assert.deepEqual(secondBody, {
    error: "rate_limited",
    message: "Too many requests from this IP. Try again later.",
    retry_after_seconds: 60,
  });
  assert.deepEqual(secondRequest.newsletterConsumer?.lastRequest, {
    at: "2026-03-11T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/latest",
    outcome: "throttled",
  });
  assert.deepEqual(secondRequest.newsletterConsumer?.rateLimitUsage, {
    evaluatedRequestCount: 1,
    allowedRequestCount: 0,
    blockedRequestCount: 1,
    keys: ["198.51.100.7"],
    lastDecision: {
      at: "2026-03-11T21:30:00.000Z",
      key: "198.51.100.7",
      limited: true,
      limit: 1,
      remaining: 0,
      resetAt: 65,
    },
  });
  assert.deepEqual(secondRequest.newsletterRequestContext.consumer?.lastRequest, {
    at: "2026-03-11T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/latest",
    outcome: "throttled",
  });
  assert.deepEqual(secondRequest.newsletterRequestContext.consumer?.rateLimitUsage, {
    evaluatedRequestCount: 1,
    allowedRequestCount: 0,
    blockedRequestCount: 1,
    keys: ["198.51.100.7"],
    lastDecision: {
      at: "2026-03-11T21:30:00.000Z",
      key: "198.51.100.7",
      limited: true,
      limit: 1,
      remaining: 0,
      resetAt: 65,
    },
  });
  const trackedBlockedConsumer = consumerStore.getConsumer("agent-beta");

  assert.equal(trackedBlockedConsumer.requestCount, 2);
  assert.match(trackedBlockedConsumer.id, /^consumer-consumer_header-/);
  assert.deepEqual(trackedBlockedConsumer, {
    id: trackedBlockedConsumer.id,
    consumerId: "agent-beta",
    identitySource: "consumer_header",
    declaredId: "agent-beta",
    fallbackIdentity: {
      source: "ip",
      value: "198.51.100.7",
      observedValue: "198.51.100.7",
    },
    userAgent: null,
    firstSeenAt: "2026-03-11T21:30:00.000Z",
    lastSeenAt: "2026-03-11T21:30:00.000Z",
    requestCount: 2,
    successfulRequestCount: 1,
    throttledRequestCount: 1,
    ipAddresses: ["198.51.100.7"],
    observedClientIps: [
      {
        address: "198.51.100.7",
        source: "socket",
        directIp: "198.51.100.7",
        forwardedChain: [],
        trustProxy: false,
        firstSeenAt: "2026-03-11T21:30:00.000Z",
        lastSeenAt: "2026-03-11T21:30:00.000Z",
        requestCount: 2,
        successfulRequestCount: 1,
        throttledRequestCount: 1,
      },
    ],
    methods: ["GET"],
    routes: ["/api/newsletter/latest"],
    requestActivity: [
      {
        date: "2026-03-11",
        firstRequestAt: "2026-03-11T21:30:00.000Z",
        lastRequestAt: "2026-03-11T21:30:00.000Z",
        requestCount: 2,
        successfulRequestCount: 1,
        throttledRequestCount: 1,
        methods: ["GET"],
        paths: ["/api/newsletter/latest"],
      },
    ],
    lastRequest: {
      at: "2026-03-11T21:30:00.000Z",
      method: "GET",
      path: "/api/newsletter/latest",
      outcome: "throttled",
    },
    rateLimitUsage: {
      evaluatedRequestCount: 2,
      allowedRequestCount: 1,
      blockedRequestCount: 1,
      keys: ["198.51.100.7"],
      lastDecision: {
        at: "2026-03-11T21:30:00.000Z",
        key: "198.51.100.7",
        limited: true,
        limit: 1,
        remaining: 0,
        resetAt: 65,
      },
    },
  });
  assert.deepEqual(consumerStore.getIp("198.51.100.7"), {
    ipAddress: "198.51.100.7",
    firstSeenAt: "2026-03-11T21:30:00.000Z",
    lastSeenAt: "2026-03-11T21:30:00.000Z",
    requestCount: 2,
    successfulRequestCount: 1,
    throttledRequestCount: 1,
    consumerIds: ["agent-beta"],
    consumerEntityIds: [trackedBlockedConsumer.id],
  });
});

test("newsletter API middleware keeps consumer and IP associations across endpoints", async () => {
  const { handler, consumerStore } = createHandler();

  await handler(
    createRequest({
      ipAddress: "192.0.2.10",
      consumerId: "agent-gamma",
      route: "/api/newsletter/latest",
    }),
  );
  await handler(
    createRequest({
      ipAddress: "192.0.2.11",
      consumerId: "agent-gamma",
      route: "/api/newsletter/history",
    }),
  );
  await handler(
    createRequest({
      ipAddress: "192.0.2.11",
      userAgent: "agent-delta/1.0",
      route: "/api/newsletter/reference",
    }),
  );

  const trackedGamma = consumerStore.getConsumer("agent-gamma");
  const trackedDelta = consumerStore.getConsumer("agent-delta/1.0");

  assert.match(trackedGamma.id, /^consumer-consumer_header-/);
  assert.deepEqual(trackedGamma, {
    id: trackedGamma.id,
    consumerId: "agent-gamma",
    identitySource: "consumer_header",
    declaredId: "agent-gamma",
    fallbackIdentity: {
      source: "ip",
      value: "192.0.2.11",
      observedValue: "192.0.2.11",
    },
    userAgent: null,
    firstSeenAt: "2026-03-11T21:30:00.000Z",
    lastSeenAt: "2026-03-11T21:30:00.000Z",
    requestCount: 2,
    successfulRequestCount: 2,
    throttledRequestCount: 0,
    ipAddresses: ["192.0.2.10", "192.0.2.11"],
    observedClientIps: [
      {
        address: "192.0.2.10",
        source: "socket",
        directIp: "192.0.2.10",
        forwardedChain: [],
        trustProxy: false,
        firstSeenAt: "2026-03-11T21:30:00.000Z",
        lastSeenAt: "2026-03-11T21:30:00.000Z",
        requestCount: 1,
        successfulRequestCount: 1,
        throttledRequestCount: 0,
      },
      {
        address: "192.0.2.11",
        source: "socket",
        directIp: "192.0.2.11",
        forwardedChain: [],
        trustProxy: false,
        firstSeenAt: "2026-03-11T21:30:00.000Z",
        lastSeenAt: "2026-03-11T21:30:00.000Z",
        requestCount: 1,
        successfulRequestCount: 1,
        throttledRequestCount: 0,
      },
    ],
    methods: ["GET"],
    routes: ["/api/newsletter/history", "/api/newsletter/latest"],
    requestActivity: [
      {
        date: "2026-03-11",
        firstRequestAt: "2026-03-11T21:30:00.000Z",
        lastRequestAt: "2026-03-11T21:30:00.000Z",
        requestCount: 2,
        successfulRequestCount: 2,
        throttledRequestCount: 0,
        methods: ["GET"],
        paths: ["/api/newsletter/history", "/api/newsletter/latest"],
      },
    ],
    lastRequest: {
      at: "2026-03-11T21:30:00.000Z",
      method: "GET",
      path: "/api/newsletter/history",
      outcome: "successful",
    },
  });
  assert.match(trackedDelta.id, /^consumer-user_agent-/);
  assert.deepEqual(trackedDelta, {
    id: trackedDelta.id,
    consumerId: "agent-delta/1.0",
    identitySource: "user_agent",
    declaredId: null,
    fallbackIdentity: {
      source: "user_agent",
      value: "agent-delta",
      observedValue: "agent-delta/1.0",
    },
    userAgent: "agent-delta/1.0",
    firstSeenAt: "2026-03-11T21:30:00.000Z",
    lastSeenAt: "2026-03-11T21:30:00.000Z",
    requestCount: 1,
    successfulRequestCount: 1,
    throttledRequestCount: 0,
    ipAddresses: ["192.0.2.11"],
    observedClientIps: [
      {
        address: "192.0.2.11",
        source: "socket",
        directIp: "192.0.2.11",
        forwardedChain: [],
        trustProxy: false,
        firstSeenAt: "2026-03-11T21:30:00.000Z",
        lastSeenAt: "2026-03-11T21:30:00.000Z",
        requestCount: 1,
        successfulRequestCount: 1,
        throttledRequestCount: 0,
      },
    ],
    methods: ["GET"],
    routes: ["/api/newsletter/reference"],
    requestActivity: [
      {
        date: "2026-03-11",
        firstRequestAt: "2026-03-11T21:30:00.000Z",
        lastRequestAt: "2026-03-11T21:30:00.000Z",
        requestCount: 1,
        successfulRequestCount: 1,
        throttledRequestCount: 0,
        methods: ["GET"],
        paths: ["/api/newsletter/reference"],
      },
    ],
    lastRequest: {
      at: "2026-03-11T21:30:00.000Z",
      method: "GET",
      path: "/api/newsletter/reference",
      outcome: "successful",
    },
  });
  assert.deepEqual(consumerStore.getIp("192.0.2.11"), {
    ipAddress: "192.0.2.11",
    firstSeenAt: "2026-03-11T21:30:00.000Z",
    lastSeenAt: "2026-03-11T21:30:00.000Z",
    requestCount: 2,
    successfulRequestCount: 2,
    throttledRequestCount: 0,
    consumerIds: ["agent-delta/1.0", "agent-gamma"],
    consumerEntityIds: [trackedDelta.id, trackedGamma.id].sort(),
  });
});

test("newsletter API middleware keeps one fallback store entity across user-agent version changes", async () => {
  const { handler, consumerStore } = createHandler();

  await handler(
    createRequest({
      ipAddress: "203.0.113.80",
      userAgent: "agent-drift/1.0 (+https://example.com/agent-drift)",
      route: "/api/newsletter/latest",
    }),
  );
  await handler(
    createRequest({
      ipAddress: "198.51.100.80",
      userAgent: "agent-drift/1.1 (+https://example.com/agent-drift)",
      route: "/api/newsletter/history",
    }),
  );

  const snapshot = consumerStore.snapshot();
  const trackedConsumer = consumerStore.getConsumer(
    "agent-drift/1.0 (+https://example.com/agent-drift)",
  );

  assert.equal(snapshot.consumers.length, 1);
  assert.match(trackedConsumer.id, /^consumer-user_agent-/);
  assert.equal(
    consumerStore.getConsumer("agent-drift/1.1 (+https://example.com/agent-drift)")?.id,
    trackedConsumer.id,
  );
  assert.equal(trackedConsumer.identitySource, "user_agent");
  assert.equal(trackedConsumer.declaredId, null);
  assert.deepEqual(trackedConsumer.fallbackIdentity, {
    source: "user_agent",
    value: "agent-drift",
    observedValue: "agent-drift/1.1 (+https://example.com/agent-drift)",
  });
  assert.equal(trackedConsumer.requestCount, 2);
  assert.deepEqual(trackedConsumer.ipAddresses, ["198.51.100.80", "203.0.113.80"]);
  assert.deepEqual(trackedConsumer.routes, [
    "/api/newsletter/history",
    "/api/newsletter/latest",
  ]);
});

test("newsletter API middleware can promote an IP-only fallback consumer to a declared store entity", async () => {
  const { handler, consumerStore } = createHandler();

  await handler(
    createRequest({
      ipAddress: "203.0.113.91",
      route: "/api/newsletter/latest",
    }),
  );
  await handler(
    createRequest({
      ipAddress: "203.0.113.91",
      consumerId: "agent-promoted-from-ip",
      route: "/api/newsletter/history",
    }),
  );

  const snapshot = consumerStore.snapshot();
  const trackedConsumer = consumerStore.getConsumer("agent-promoted-from-ip");

  assert.equal(snapshot.consumers.length, 1);
  assert.match(trackedConsumer.id, /^consumer-ip-/);
  assert.equal(trackedConsumer.identitySource, "consumer_header");
  assert.equal(trackedConsumer.declaredId, "agent-promoted-from-ip");
  assert.deepEqual(trackedConsumer.fallbackIdentity, {
    source: "ip",
    value: "203.0.113.91",
    observedValue: "203.0.113.91",
  });
  assert.equal(consumerStore.getConsumer("203.0.113.91")?.id, trackedConsumer.id);
  assert.equal(trackedConsumer.requestCount, 2);
  assert.deepEqual(trackedConsumer.routes, [
    "/api/newsletter/history",
    "/api/newsletter/latest",
  ]);
});

test("newsletter API middleware passes the tracked consumer context into rate-limit evaluation", async () => {
  const request = createRequest({
    ipAddress: "203.0.113.44",
    consumerId: "agent-epsilon",
  });
  let observedContext = null;

  const handler = createNewsletterApiHandler({
    editionRepository: createEditionRepository(),
    now: () => "2026-03-11T21:30:00Z",
    consumerTracking: {
      store: createInMemoryConsumerTrackingStore(),
    },
    rateLimiter(_request, context) {
      observedContext = context;

      return {
        headers: {
          "x-ratelimit-limit": "4",
          "x-ratelimit-remaining": "3",
          "x-ratelimit-reset": "60",
        },
        requestContext: {
          rateLimit: {
            key: context.consumerActivity.clientIp.ip,
            limited: false,
            limit: 4,
            remaining: 3,
            resetAt: 60,
          },
        },
      };
    },
  });

  const response = await handler(request);

  assert.equal(response.status, 200);
  assert.equal(response.headers["x-ratelimit-limit"], "4");
  assert.equal(observedContext.consumer.declaredId, "agent-epsilon");
  assert.match(observedContext.consumer.id, /^consumer-consumer_header-/);
  assert.equal(observedContext.consumerActivity.clientIp.ip, "203.0.113.44");
  assert.deepEqual(request.newsletterRequestContext.rateLimit, {
    key: "203.0.113.44",
    limited: false,
    limit: 4,
    remaining: 3,
    resetAt: 60,
  });
});
