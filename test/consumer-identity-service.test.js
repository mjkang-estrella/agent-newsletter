import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ConsumerIdentityRepository,
  ConsumerIdentityService,
  createNewsletterApiHandler,
  normalizeConsumerIdentitySnapshot,
  resolveConsumerRequestIdentity,
} from "../src/index.js";

async function createRepository() {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-"));

  return new ConsumerIdentityRepository({
    filePath: join(directory, "consumer-identities.json"),
  });
}

function createEditionRepository() {
  const edition = {
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
  url = "/api/newsletter/latest",
  remoteAddress = "10.0.0.3",
  headers = {},
} = {}) {
  return {
    method: "GET",
    url,
    headers,
    socket: {
      remoteAddress,
    },
  };
}

test("resolveConsumerRequestIdentity falls back from declared id to user agent to IP", () => {
  const withDeclaredId = resolveConsumerRequestIdentity(
    createRequest({
      headers: {
        "x-agent-consumer-id": "agent-alpha",
        "user-agent": "agent-alpha/1.0",
      },
    }),
  );
  const withUserAgent = resolveConsumerRequestIdentity(
    createRequest({
      headers: {
        "user-agent": "agent-beta/1.0",
      },
    }),
  );
  const withIpOnly = resolveConsumerRequestIdentity(createRequest());

  assert.equal(withDeclaredId.identitySource, "consumer_header");
  assert.equal(withDeclaredId.declaredId, "agent-alpha");
  assert.deepEqual(withDeclaredId.fallbackIdentity, {
    source: "user_agent",
    value: "agent-alpha",
    observedValue: "agent-alpha/1.0",
  });
  assert.equal(withDeclaredId.userAgent, "agent-alpha/1.0");

  assert.equal(withUserAgent.identitySource, "user_agent");
  assert.equal(withUserAgent.declaredId, null);
  assert.deepEqual(withUserAgent.fallbackIdentity, {
    source: "user_agent",
    value: "agent-beta",
    observedValue: "agent-beta/1.0",
  });
  assert.equal(withUserAgent.userAgent, "agent-beta/1.0");

  assert.equal(withIpOnly.identitySource, "ip");
  assert.deepEqual(withIpOnly.fallbackIdentity, {
    source: "ip",
    value: "10.0.0.3",
    observedValue: "10.0.0.3",
  });
  assert.equal(withIpOnly.clientIp.ip, "10.0.0.3");
  assert.equal(withIpOnly.clientIp.source, "socket");
});

test("resolveConsumerRequestIdentity keeps one fallback identity across user-agent version changes", () => {
  const firstRequestIdentity = resolveConsumerRequestIdentity(
    createRequest({
      headers: {
        "user-agent": "agent-beta/1.0 (+https://example.com/agent-beta)",
      },
    }),
  );
  const secondRequestIdentity = resolveConsumerRequestIdentity(
    createRequest({
      headers: {
        "user-agent": "agent-beta/2.1 (+https://example.com/agent-beta)",
      },
    }),
  );

  assert.equal(firstRequestIdentity.identitySource, "user_agent");
  assert.equal(secondRequestIdentity.identitySource, "user_agent");
  assert.equal(firstRequestIdentity.id, secondRequestIdentity.id);
  assert.equal(firstRequestIdentity.userAgent, "agent-beta/1.0 (+https://example.com/agent-beta)");
  assert.equal(secondRequestIdentity.userAgent, "agent-beta/2.1 (+https://example.com/agent-beta)");
});

test("ConsumerIdentityService persists consumer entities with observed client IP metadata", async () => {
  const repository = await createRepository();
  let currentTime = "2026-03-11T21:30:00Z";
  const service = new ConsumerIdentityService({
    repository,
    now: () => currentTime,
    trustProxy: true,
  });
  const initialRequest = createRequest({
    headers: {
      "x-agent-consumer-id": "agent-alpha",
      "user-agent": "agent-alpha/1.0",
      "x-forwarded-for": "203.0.113.42, 10.0.0.3",
    },
    remoteAddress: "10.0.0.3",
  });
  const expectedIdentity = resolveConsumerRequestIdentity(initialRequest, {
    trustProxy: true,
  });

  await service.recordRequest(initialRequest, {
    method: "GET",
    path: "/api/newsletter/latest",
  });

  currentTime = "2026-03-12T21:30:00Z";

  await service.recordRequest(
    createRequest({
      url: "/api/newsletter/history",
      headers: {
        "x-agent-consumer-id": "agent-alpha",
        "user-agent": "agent-alpha/1.0",
        "x-forwarded-for": "198.51.100.20, 10.0.0.4",
      },
      remoteAddress: "10.0.0.4",
    }),
    {
      method: "GET",
      path: "/api/newsletter/history",
    },
  );

  const snapshot = await repository.load({ now: currentTime });

  assert.equal(snapshot.consumers.length, 1);
  assert.deepEqual(snapshot.consumers[0], {
    id: expectedIdentity.id,
    identitySource: "consumer_header",
    declaredId: "agent-alpha",
    fallbackIdentity: {
      source: "user_agent",
      value: "agent-alpha",
      observedValue: "agent-alpha/1.0",
    },
    userAgent: "agent-alpha/1.0",
    firstSeenAt: "2026-03-11T21:30:00.000Z",
    lastSeenAt: "2026-03-12T21:30:00.000Z",
    requestCount: 2,
    successfulRequestCount: 2,
    throttledRequestCount: 0,
    observedClientIps: [
      {
        address: "198.51.100.20",
        source: "x-forwarded-for",
        directIp: "10.0.0.4",
        forwardedChain: ["198.51.100.20", "10.0.0.4"],
        trustProxy: true,
        firstSeenAt: "2026-03-12T21:30:00.000Z",
        lastSeenAt: "2026-03-12T21:30:00.000Z",
        requestCount: 1,
        successfulRequestCount: 1,
        throttledRequestCount: 0,
      },
      {
        address: "203.0.113.42",
        source: "x-forwarded-for",
        directIp: "10.0.0.3",
        forwardedChain: ["203.0.113.42", "10.0.0.3"],
        trustProxy: true,
        firstSeenAt: "2026-03-11T21:30:00.000Z",
        lastSeenAt: "2026-03-11T21:30:00.000Z",
        requestCount: 1,
        successfulRequestCount: 1,
        throttledRequestCount: 0,
      },
    ],
    requestActivity: [
      {
        date: "2026-03-12",
        firstRequestAt: "2026-03-12T21:30:00.000Z",
        lastRequestAt: "2026-03-12T21:30:00.000Z",
        requestCount: 1,
        successfulRequestCount: 1,
        throttledRequestCount: 0,
        methods: ["GET"],
        paths: ["/api/newsletter/history"],
      },
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
      at: "2026-03-12T21:30:00.000Z",
      method: "GET",
      path: "/api/newsletter/history",
      outcome: "successful",
    },
  });
});

test("ConsumerIdentityService records per-consumer rate-limit usage for allowed and blocked requests", async () => {
  const repository = await createRepository();
  const service = new ConsumerIdentityService({
    repository,
    now: () => "2026-03-11T21:30:00Z",
  });

  await service.recordRequest(
    createRequest({
      headers: {
        "x-agent-consumer-id": "agent-rate-limit",
        "user-agent": "agent-rate-limit/1.0",
      },
      remoteAddress: "203.0.113.55",
    }),
    {
      method: "GET",
      path: "/api/newsletter/latest",
      rateLimit: {
        key: "203.0.113.55",
        limited: false,
        limit: 2,
        remaining: 1,
        resetAt: 90,
      },
    },
  );

  await service.recordRequest(
    createRequest({
      headers: {
        "x-agent-consumer-id": "agent-rate-limit",
        "user-agent": "agent-rate-limit/1.0",
      },
      remoteAddress: "203.0.113.55",
    }),
    {
      method: "GET",
      path: "/api/newsletter/history",
      outcome: "throttled",
      rateLimit: {
        key: "203.0.113.55",
        limited: true,
        limit: 2,
        remaining: 0,
        resetAt: 90,
      },
    },
  );

  const snapshot = await repository.load({ now: "2026-03-11T21:30:00Z" });

  assert.deepEqual(snapshot.consumers[0].rateLimitUsage, {
    evaluatedRequestCount: 2,
    allowedRequestCount: 1,
    blockedRequestCount: 1,
    keys: ["203.0.113.55"],
    lastDecision: {
      at: "2026-03-11T21:30:00.000Z",
      key: "203.0.113.55",
      limited: true,
      limit: 2,
      remaining: 0,
      resetAt: 90,
    },
  });
  assert.deepEqual(snapshot.consumers[0].lastRequest, {
    at: "2026-03-11T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/history",
    outcome: "throttled",
  });
});

test("ConsumerIdentityService keeps one stable fallback consumer across user-agent version changes", async () => {
  const repository = await createRepository();
  let currentTime = "2026-03-11T21:30:00Z";
  const service = new ConsumerIdentityService({
    repository,
    now: () => currentTime,
    trustProxy: true,
  });
  const firstRequest = createRequest({
    headers: {
      "user-agent": "agent-drift/1.0 (+https://example.com/agent-drift)",
      "x-forwarded-for": "203.0.113.42, 10.0.0.3",
    },
    remoteAddress: "10.0.0.3",
  });
  const firstIdentity = resolveConsumerRequestIdentity(firstRequest, {
    trustProxy: true,
  });

  await service.recordRequest(firstRequest, {
    method: "GET",
    path: "/api/newsletter/latest",
  });

  currentTime = "2026-03-12T21:30:00Z";

  await service.recordRequest(
    createRequest({
      url: "/api/newsletter/history",
      headers: {
        "user-agent": "agent-drift/1.1 (+https://example.com/agent-drift)",
        "x-forwarded-for": "198.51.100.20, 10.0.0.4",
      },
      remoteAddress: "10.0.0.4",
    }),
    {
      method: "GET",
      path: "/api/newsletter/history",
    },
  );

  const snapshot = await repository.load({ now: currentTime });

  assert.equal(snapshot.consumers.length, 1);
  assert.equal(snapshot.consumers[0].id, firstIdentity.id);
  assert.equal(snapshot.consumers[0].identitySource, "user_agent");
  assert.equal(snapshot.consumers[0].declaredId, null);
  assert.deepEqual(snapshot.consumers[0].fallbackIdentity, {
    source: "user_agent",
    value: "agent-drift",
    observedValue: "agent-drift/1.1 (+https://example.com/agent-drift)",
  });
  assert.equal(snapshot.consumers[0].userAgent, "agent-drift/1.1 (+https://example.com/agent-drift)");
  assert.equal(snapshot.consumers[0].requestCount, 2);
  assert.equal(snapshot.consumers[0].successfulRequestCount, 2);
  assert.equal(snapshot.consumers[0].throttledRequestCount, 0);
  assert.deepEqual(
    snapshot.consumers[0].observedClientIps.map((entry) => entry.address),
    ["198.51.100.20", "203.0.113.42"],
  );
  assert.deepEqual(snapshot.consumers[0].lastRequest, {
    at: "2026-03-12T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/history",
    outcome: "successful",
  });
});

test("ConsumerIdentityService upgrades a previously anonymous user-agent record when a later request declares a consumer id", async () => {
  const repository = await createRepository();
  let currentTime = "2026-03-11T21:30:00Z";
  const service = new ConsumerIdentityService({
    repository,
    now: () => currentTime,
    trustProxy: true,
  });
  const initialRequest = createRequest({
    headers: {
      "user-agent": "agent-upgrade/1.0",
      "x-forwarded-for": "203.0.113.42, 10.0.0.3",
    },
    remoteAddress: "10.0.0.3",
  });
  const initialIdentity = resolveConsumerRequestIdentity(initialRequest, {
    trustProxy: true,
  });

  await service.recordRequest(initialRequest, {
    method: "GET",
    path: "/api/newsletter/latest",
  });

  currentTime = "2026-03-12T21:30:00Z";

  await service.recordRequest(
    createRequest({
      url: "/api/newsletter/history",
      headers: {
        "x-agent-consumer-id": "agent-upgrade",
        "user-agent": "agent-upgrade/1.0",
        "x-forwarded-for": "198.51.100.20, 10.0.0.4",
      },
      remoteAddress: "10.0.0.4",
    }),
    {
      method: "GET",
      path: "/api/newsletter/history",
    },
  );

  const snapshot = await repository.load({ now: currentTime });

  assert.equal(snapshot.consumers.length, 1);
  assert.equal(snapshot.consumers[0].id, initialIdentity.id);
  assert.equal(snapshot.consumers[0].identitySource, "consumer_header");
  assert.equal(snapshot.consumers[0].declaredId, "agent-upgrade");
  assert.deepEqual(snapshot.consumers[0].fallbackIdentity, {
    source: "user_agent",
    value: "agent-upgrade",
    observedValue: "agent-upgrade/1.0",
  });
  assert.equal(snapshot.consumers[0].userAgent, "agent-upgrade/1.0");
  assert.equal(snapshot.consumers[0].requestCount, 2);
  assert.equal(snapshot.consumers[0].successfulRequestCount, 2);
  assert.equal(snapshot.consumers[0].throttledRequestCount, 0);
  assert.deepEqual(snapshot.consumers[0].lastRequest, {
    at: "2026-03-12T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/history",
    outcome: "successful",
  });
});

test("ConsumerIdentityService serializes durable writes so concurrent requests do not lose consumer history", async () => {
  let snapshot = normalizeConsumerIdentitySnapshot(null, "2026-03-11T21:30:00Z");
  const repository = {
    async load({ now }) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return normalizeConsumerIdentitySnapshot(structuredClone(snapshot), now);
    },
    async save(nextSnapshot) {
      snapshot = normalizeConsumerIdentitySnapshot(structuredClone(nextSnapshot), nextSnapshot.updatedAt);
    },
  };
  const service = new ConsumerIdentityService({
    repository,
    now: () => "2026-03-11T21:30:00Z",
  });
  const request = createRequest({
    headers: {
      "x-agent-consumer-id": "agent-concurrent",
      "user-agent": "agent-concurrent/1.0",
    },
  });

  await Promise.all([
    service.recordRequest(request, {
      method: "GET",
      path: "/api/newsletter/latest",
    }),
    service.recordRequest(request, {
      method: "GET",
      path: "/api/newsletter/reference",
    }),
  ]);

  assert.equal(snapshot.consumers.length, 1);
  assert.equal(snapshot.consumers[0].declaredId, "agent-concurrent");
  assert.equal(snapshot.consumers[0].requestCount, 2);
  assert.equal(snapshot.consumers[0].successfulRequestCount, 2);
  assert.equal(snapshot.consumers[0].throttledRequestCount, 0);
  assert.deepEqual(snapshot.consumers[0].requestActivity, [
    {
      date: "2026-03-11",
      firstRequestAt: "2026-03-11T21:30:00.000Z",
      lastRequestAt: "2026-03-11T21:30:00.000Z",
      requestCount: 2,
      successfulRequestCount: 2,
      throttledRequestCount: 0,
      methods: ["GET"],
      paths: ["/api/newsletter/latest", "/api/newsletter/reference"],
    },
  ]);
});

test("normalizeConsumerIdentitySnapshot backfills requestActivity for legacy consumer records", () => {
  const snapshot = normalizeConsumerIdentitySnapshot(
    {
      updatedAt: "2026-03-12T21:30:00Z",
      consumers: [
        {
          id: "consumer-user_agent-123",
          identitySource: "user_agent",
          declaredId: null,
          userAgent: "agent-theta/1.0",
          firstSeenAt: "2026-03-10T20:00:00Z",
          lastSeenAt: "2026-03-12T21:30:00Z",
          requestCount: 4,
          observedClientIps: [
            {
              address: "203.0.113.90",
              source: "socket",
              directIp: "203.0.113.90",
              forwardedChain: [],
              trustProxy: false,
              firstSeenAt: "2026-03-10T20:00:00Z",
              lastSeenAt: "2026-03-12T21:30:00Z",
              requestCount: 4,
            },
          ],
          lastRequest: {
            at: "2026-03-12T21:30:00Z",
            method: "GET",
            path: "/api/newsletter/latest",
          },
        },
      ],
    },
    "2026-03-12T21:30:00Z",
  );

  assert.deepEqual(snapshot.consumers[0].requestActivity, [
    {
      date: "2026-03-12",
      firstRequestAt: "2026-03-10T20:00:00.000Z",
      lastRequestAt: "2026-03-12T21:30:00.000Z",
      requestCount: 4,
      successfulRequestCount: 4,
      throttledRequestCount: 0,
      methods: ["GET"],
      paths: ["/api/newsletter/latest"],
    },
  ]);
  assert.deepEqual(snapshot.consumers[0].fallbackIdentity, {
    source: "user_agent",
    value: "agent-theta",
    observedValue: "agent-theta/1.0",
  });
});

test("ConsumerIdentityService upgrades an IP-only fallback consumer when a later request declares a consumer id", async () => {
  const repository = await createRepository();
  let currentTime = "2026-03-11T21:30:00Z";
  const service = new ConsumerIdentityService({
    repository,
    now: () => currentTime,
    trustProxy: true,
  });
  const initialRequest = createRequest({
    headers: {
      "x-forwarded-for": "203.0.113.42, 10.0.0.3",
    },
    remoteAddress: "10.0.0.3",
  });
  const initialIdentity = resolveConsumerRequestIdentity(initialRequest, {
    trustProxy: true,
  });

  await service.recordRequest(initialRequest, {
    method: "GET",
    path: "/api/newsletter/latest",
  });

  currentTime = "2026-03-12T21:30:00Z";

  await service.recordRequest(
    createRequest({
      url: "/api/newsletter/history",
      headers: {
        "x-agent-consumer-id": "agent-from-ip",
        "x-forwarded-for": "203.0.113.42, 10.0.0.4",
      },
      remoteAddress: "10.0.0.4",
    }),
    {
      method: "GET",
      path: "/api/newsletter/history",
    },
  );

  const snapshot = await repository.load({ now: currentTime });

  assert.equal(snapshot.consumers.length, 1);
  assert.equal(snapshot.consumers[0].id, initialIdentity.id);
  assert.equal(snapshot.consumers[0].identitySource, "consumer_header");
  assert.equal(snapshot.consumers[0].declaredId, "agent-from-ip");
  assert.deepEqual(snapshot.consumers[0].fallbackIdentity, {
    source: "ip",
    value: "203.0.113.42",
    observedValue: "203.0.113.42",
  });
  assert.equal(snapshot.consumers[0].requestCount, 2);
});

test("newsletter API consumer tracking can persist request identities through the middleware", async () => {
  const repository = await createRepository();
  const handler = createNewsletterApiHandler({
    editionRepository: createEditionRepository(),
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: false,
    consumerTracking: {
      repository,
      trustProxy: true,
    },
  });

  const response = await handler(
    createRequest({
      headers: {
        "x-newsletter-consumer-id": "agent-zeta",
        "user-agent": "agent-zeta/2.0",
        "x-forwarded-for": "203.0.113.77, 10.0.0.8",
      },
      remoteAddress: "10.0.0.8",
    }),
  );
  const snapshot = await repository.load({
    now: "2026-03-11T21:30:00Z",
  });

  assert.equal(response.status, 200);
  assert.equal(snapshot.consumers.length, 1);
  assert.equal(snapshot.consumers[0].identitySource, "consumer_header");
  assert.equal(snapshot.consumers[0].declaredId, "agent-zeta");
  assert.deepEqual(snapshot.consumers[0].fallbackIdentity, {
    source: "user_agent",
    value: "agent-zeta",
    observedValue: "agent-zeta/2.0",
  });
  assert.equal(snapshot.consumers[0].userAgent, "agent-zeta/2.0");
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
  assert.deepEqual(snapshot.consumers[0].requestActivity, [
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
  ]);
  assert.deepEqual(snapshot.consumers[0].lastRequest, {
    at: "2026-03-11T21:30:00.000Z",
    method: "GET",
    path: "/api/newsletter/latest",
    outcome: "successful",
  });
});
