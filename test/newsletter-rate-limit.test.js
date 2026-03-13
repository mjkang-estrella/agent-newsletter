import test from "node:test";
import assert from "node:assert/strict";

import {
  API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME,
  API_RATE_LIMIT_TRUST_PROXY_ENV_NAME,
  API_RATE_LIMIT_WINDOW_MS_ENV_NAME,
  createIpRateLimiter,
  createNewsletterApiHandler,
  resolveRateLimitConfigFromEnv,
  resolveClientIp,
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
  };
}

function createRequest(ip, headers = {}) {
  return {
    method: "GET",
    url: "/api/newsletter/latest",
    headers,
    socket: {
      remoteAddress: ip,
    },
  };
}

function assertRateLimitHeaders(response, { limit, remaining, reset, policy }) {
  assert.equal(response.headers["ratelimit-limit"], limit);
  assert.equal(response.headers["ratelimit-remaining"], remaining);
  assert.equal(response.headers["ratelimit-reset"], reset);
  assert.equal(response.headers["ratelimit-policy"], policy);
  assert.equal(response.headers["x-ratelimit-limit"], limit);
  assert.equal(response.headers["x-ratelimit-remaining"], remaining);
  assert.equal(response.headers["x-ratelimit-reset"], reset);
  assert.equal(response.headers["x-ratelimit-policy"], policy);
}

test("newsletter API rate limits repeated requests from the same IP", async () => {
  const handler = createNewsletterApiHandler({
    editionRepository: createEditionRepository(),
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: {
      maxRequests: 2,
      windowMs: 60_000,
      now: () => 1_000,
    },
  });

  const firstResponse = await handler(createRequest("203.0.113.10"));
  const secondResponse = await handler(createRequest("203.0.113.10"));
  const thirdResponse = await handler(createRequest("203.0.113.10"));
  const thirdBody = JSON.parse(thirdResponse.body);

  assert.equal(firstResponse.status, 200);
  assertRateLimitHeaders(firstResponse, {
    limit: "2",
    remaining: "1",
    reset: "61",
    policy: "2;w=60",
  });

  assert.equal(secondResponse.status, 200);
  assertRateLimitHeaders(secondResponse, {
    limit: "2",
    remaining: "0",
    reset: "61",
    policy: "2;w=60",
  });

  assert.equal(thirdResponse.status, 429);
  assert.equal(thirdResponse.headers["retry-after"], "60");
  assertRateLimitHeaders(thirdResponse, {
    limit: "2",
    remaining: "0",
    reset: "61",
    policy: "2;w=60",
  });
  assert.deepEqual(thirdBody, {
    error: "rate_limited",
    message: "Too many requests from this IP. Try again later.",
    retry_after_seconds: 60,
  });
});

test("resolveRateLimitConfigFromEnv returns the default deployment rate-limit settings", () => {
  assert.deepEqual(resolveRateLimitConfigFromEnv({}), {
    maxRequests: 60,
    windowMs: 60_000,
    trustProxy: false,
  });
});

test("resolveRateLimitConfigFromEnv reads and validates env overrides", () => {
  assert.deepEqual(
    resolveRateLimitConfigFromEnv({
      [API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME]: "5",
      [API_RATE_LIMIT_WINDOW_MS_ENV_NAME]: "15000",
      [API_RATE_LIMIT_TRUST_PROXY_ENV_NAME]: "yes",
    }),
    {
      maxRequests: 5,
      windowMs: 15_000,
      trustProxy: true,
    },
  );

  assert.throws(
    () =>
      resolveRateLimitConfigFromEnv({
        [API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME]: "0",
      }),
    /NEWSLETTER_API_RATE_LIMIT_MAX_REQUESTS must be a positive integer/,
  );
  assert.throws(
    () =>
      resolveRateLimitConfigFromEnv({
        [API_RATE_LIMIT_WINDOW_MS_ENV_NAME]: "60ms",
      }),
    /NEWSLETTER_API_RATE_LIMIT_WINDOW_MS must be a positive integer/,
  );
  assert.throws(
    () =>
      resolveRateLimitConfigFromEnv({
        [API_RATE_LIMIT_TRUST_PROXY_ENV_NAME]: "sometimes",
      }),
    /NEWSLETTER_API_RATE_LIMIT_TRUST_PROXY must be one of: true, false, 1, 0, yes, no, on, off/,
  );
});

test("newsletter API tracks request limits independently for each IP", async () => {
  const handler = createNewsletterApiHandler({
    editionRepository: createEditionRepository(),
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: {
      maxRequests: 1,
      windowMs: 60_000,
      now: () => 5_000,
    },
  });

  const firstIpResponse = await handler(createRequest("198.51.100.7"));
  const secondIpResponse = await handler(createRequest("198.51.100.8"));
  const repeatedFirstIpResponse = await handler(createRequest("198.51.100.7"));

  assert.equal(firstIpResponse.status, 200);
  assert.equal(secondIpResponse.status, 200);
  assert.equal(repeatedFirstIpResponse.status, 429);
});

test("newsletter API reads env-based rate limit settings when explicit config is omitted", async () => {
  const handler = createNewsletterApiHandler({
    editionRepository: createEditionRepository(),
    env: {
      [API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME]: "1",
      [API_RATE_LIMIT_WINDOW_MS_ENV_NAME]: "60000",
      [API_RATE_LIMIT_TRUST_PROXY_ENV_NAME]: "true",
    },
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: null,
  });

  const firstResponse = await handler(
    createRequest("10.0.0.3", {
      "x-forwarded-for": "203.0.113.42, 10.0.0.3",
    }),
  );
  const secondResponse = await handler(
    createRequest("10.0.0.4", {
      "x-forwarded-for": "203.0.113.42, 10.0.0.4",
    }),
  );

  assert.equal(firstResponse.status, 200);
  assert.equal(firstResponse.headers["x-ratelimit-limit"], "1");
  assert.equal(secondResponse.status, 429);
  assert.equal(secondResponse.headers["retry-after"], "60");
});

test("newsletter API ignores invalid overridden env rate-limit values when explicit config is provided", async () => {
  const handler = createNewsletterApiHandler({
    editionRepository: createEditionRepository(),
    env: {
      [API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME]: "invalid",
      [API_RATE_LIMIT_WINDOW_MS_ENV_NAME]: "not-a-number",
      [API_RATE_LIMIT_TRUST_PROXY_ENV_NAME]: "sometimes",
    },
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: {
      maxRequests: 1,
      windowMs: 60_000,
      now: () => 8_000,
      trustProxy: true,
    },
  });

  const firstResponse = await handler(
    createRequest("10.0.0.3", {
      "x-forwarded-for": "203.0.113.42, 10.0.0.3",
    }),
  );
  const secondResponse = await handler(
    createRequest("10.0.0.4", {
      "x-forwarded-for": "203.0.113.42, 10.0.0.4",
    }),
  );

  assert.equal(firstResponse.status, 200);
  assert.equal(firstResponse.headers["x-ratelimit-limit"], "1");
  assert.equal(secondResponse.status, 429);
  assert.equal(secondResponse.headers["retry-after"], "60");
});

test("newsletter API can rate limit on forwarded client IPs when trusted proxies are enabled", async () => {
  const handler = createNewsletterApiHandler({
    editionRepository: createEditionRepository(),
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: {
      maxRequests: 1,
      windowMs: 60_000,
      now: () => 9_000,
      trustProxy: true,
    },
  });

  const firstResponse = await handler(
    createRequest("10.0.0.3", {
      "x-forwarded-for": "203.0.113.42, 10.0.0.3",
    }),
  );
  const secondResponse = await handler(
    createRequest("10.0.0.4", {
      "x-forwarded-for": "203.0.113.42, 10.0.0.4",
    }),
  );

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 429);
});

test("newsletter API normalizes trusted forwarded IPs before enforcing the limit", async () => {
  const handler = createNewsletterApiHandler({
    editionRepository: createEditionRepository(),
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: {
      maxRequests: 1,
      windowMs: 60_000,
      now: () => 9_500,
      trustProxy: true,
    },
  });

  const firstResponse = await handler(
    createRequest("10.0.0.3", {
      "x-forwarded-for": "203.0.113.42:4100, 10.0.0.3",
    }),
  );
  const secondResponse = await handler(
    createRequest("10.0.0.4", {
      "x-forwarded-for": "203.0.113.42:5100, 10.0.0.4",
    }),
  );

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 429);
});

test("newsletter API rate limit resets after the configured window elapses", async () => {
  let timestamp = 25_000;
  const handler = createNewsletterApiHandler({
    editionRepository: createEditionRepository(),
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: {
      maxRequests: 1,
      windowMs: 10_000,
      now: () => timestamp,
    },
  });

  const initialResponse = await handler(createRequest("192.0.2.9"));
  const limitedResponse = await handler(createRequest("192.0.2.9"));
  timestamp = 35_000;
  const resetResponse = await handler(createRequest("192.0.2.9"));

  assert.equal(initialResponse.status, 200);
  assert.equal(limitedResponse.status, 429);
  assert.equal(resetResponse.status, 200);
  assert.equal(resetResponse.headers["x-ratelimit-remaining"], "0");
});

test("newsletter API normalizes IPv4-mapped IPv6 addresses into the same rate-limit bucket", async () => {
  const handler = createNewsletterApiHandler({
    editionRepository: createEditionRepository(),
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: {
      maxRequests: 1,
      windowMs: 60_000,
      now: () => 45_000,
    },
  });

  const ipv6MappedResponse = await handler(createRequest("::ffff:203.0.113.91"));
  const ipv4Response = await handler(createRequest("203.0.113.91"));

  assert.equal(ipv6MappedResponse.status, 200);
  assert.equal(ipv4Response.status, 429);
});

test("resolveClientIp ignores forwarded headers unless trusted proxies are enabled", () => {
  const request = createRequest("10.0.0.10", {
    "x-forwarded-for": "203.0.113.55, 10.0.0.10",
  });

  assert.equal(resolveClientIp(request), "10.0.0.10");
  assert.equal(resolveClientIp(request, { trustProxy: true }), "203.0.113.55");
});

test("resolveClientIp strips forwarded ports when trusted proxies are enabled", () => {
  const request = createRequest("10.0.0.10", {
    "x-forwarded-for": "203.0.113.55:4100, 10.0.0.10",
  });

  assert.equal(resolveClientIp(request, { trustProxy: true }), "203.0.113.55");
});

test("resolveClientIp normalizes IPv4-mapped IPv6 addresses", () => {
  assert.equal(resolveClientIp(createRequest("::ffff:203.0.113.55")), "203.0.113.55");
  assert.equal(
    resolveClientIp(
      createRequest("10.0.0.10", {
        "x-forwarded-for": "::ffff:203.0.113.55, 10.0.0.10",
      }),
      { trustProxy: true },
    ),
    "203.0.113.55",
  );
});

test("resolveClientIp reads forwarded headers from WHATWG Headers instances", () => {
  const request = createRequest(
    "10.0.0.10",
    new Headers({
      "x-forwarded-for": "203.0.113.55:4100, 10.0.0.10",
    }),
  );

  assert.equal(resolveClientIp(request, { trustProxy: true }), "203.0.113.55");
});

test("createIpRateLimiter reads RFC 7239 Forwarded headers for trusted proxies", () => {
  const rateLimiter = createIpRateLimiter({
    maxRequests: 1,
    windowMs: 60_000,
    now: () => 20_000,
    trustProxy: true,
  });

  const firstRequest = createRequest("10.0.0.20", {
    forwarded: 'for="[2001:db8:cafe::17]:4711";proto=https;by=203.0.113.60',
  });
  const secondRequest = createRequest("10.0.0.21", {
    forwarded: 'for="[2001:db8:cafe::17]:8910";proto=https;by=203.0.113.61',
  });

  const firstResult = rateLimiter(firstRequest);
  const secondResult = rateLimiter(secondRequest);

  assert.equal(firstResult.response, undefined);
  assert.equal(secondResult.response?.status, 429);
});

test("createIpRateLimiter reads forwarded headers from WHATWG Headers instances", () => {
  const rateLimiter = createIpRateLimiter({
    maxRequests: 1,
    windowMs: 60_000,
    now: () => 30_000,
    trustProxy: true,
  });

  const firstResult = rateLimiter(
    createRequest(
      "10.0.0.30",
      new Headers({
        "x-forwarded-for": "203.0.113.77, 10.0.0.30",
      }),
    ),
  );
  const secondResult = rateLimiter(
    createRequest(
      "10.0.0.31",
      new Headers({
        "x-forwarded-for": "203.0.113.77, 10.0.0.31",
      }),
    ),
  );

  assert.equal(firstResult.response, undefined);
  assert.equal(secondResult.response?.status, 429);
});

test("createIpRateLimiter reuses tracked consumer IP metadata from the request pipeline", () => {
  const rateLimiter = createIpRateLimiter({
    maxRequests: 1,
    windowMs: 60_000,
    now: () => 40_000,
  });

  const firstResult = rateLimiter(createRequest("10.0.0.30"), {
    consumerActivity: {
      clientIp: {
        ip: "203.0.113.90",
      },
    },
  });
  const secondResult = rateLimiter(createRequest("10.0.0.31"), {
    consumerActivity: {
      clientIp: {
        ip: "203.0.113.90",
      },
    },
  });

  assert.deepEqual(firstResult.requestContext.rateLimit, {
    key: "203.0.113.90",
    limited: false,
    limit: 1,
    remaining: 0,
    resetAt: 100,
  });
  assert.deepEqual(secondResult.requestContext.rateLimit, {
    key: "203.0.113.90",
    limited: true,
    limit: 1,
    remaining: 0,
    resetAt: 100,
  });
  assert.equal(secondResult.response?.status, 429);
});
