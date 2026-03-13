import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemorySupabaseNewsletterDataStore,
  createSupabaseRateLimiter,
} from "../src/index.js";

test("Supabase rate limiter enforces a shared window and resets after expiry", async () => {
  let nowMs = Date.parse("2026-03-12T21:00:00.000Z");
  const dataStore = new InMemorySupabaseNewsletterDataStore({
    now: () => new Date(nowMs).toISOString(),
  });
  const rateLimiter = createSupabaseRateLimiter({
    dataStore,
    maxRequests: 1,
    windowMs: 60_000,
    now: () => nowMs,
    trustProxy: true,
  });
  const request = {
    method: "GET",
    url: "/api/newsletter/latest",
    headers: {
      "x-forwarded-for": "203.0.113.8",
    },
  };

  const firstResult = await rateLimiter(request, {});

  assert.equal(firstResult.response, undefined);
  assert.equal(firstResult.headers["x-ratelimit-limit"], "1");
  assert.equal(firstResult.headers["x-ratelimit-remaining"], "0");
  assert.deepEqual(firstResult.requestContext.rateLimit, {
    key: "203.0.113.8",
    limited: false,
    limit: 1,
    remaining: 0,
    resetAt: Math.ceil((nowMs + 60_000) / 1000),
  });

  const secondResult = await rateLimiter(request, {});

  assert.equal(secondResult.response.status, 429);
  assert.equal(secondResult.headers["x-ratelimit-remaining"], "0");
  assert.deepEqual(secondResult.requestContext.rateLimit, {
    key: "203.0.113.8",
    limited: true,
    limit: 1,
    remaining: 0,
    resetAt: Math.ceil((nowMs + 60_000) / 1000),
  });

  nowMs += 60_001;

  const thirdResult = await rateLimiter(request, {});

  assert.equal(thirdResult.response, undefined);
  assert.equal(thirdResult.requestContext.rateLimit.limited, false);
  assert.equal(thirdResult.requestContext.rateLimit.remaining, 0);
});
