import {
  DEFAULT_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  resolveClientIp,
} from "../newsletter/rate-limit.js";

export function createSupabaseRateLimiter({
  dataStore,
  maxRequests = DEFAULT_RATE_LIMIT_MAX_REQUESTS,
  windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
  now = () => new Date(),
  trustProxy = false,
} = {}) {
  if (!dataStore || typeof dataStore.consumeRateLimit !== "function") {
    throw new TypeError("dataStore must expose consumeRateLimit()");
  }

  if (!Number.isInteger(maxRequests) || maxRequests <= 0) {
    throw new TypeError("maxRequests must be a positive integer");
  }

  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new TypeError("windowMs must be a positive integer");
  }

  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  return async function rateLimitRequest(request, requestContext = {}) {
    const timestamp = resolveTimestamp(now);
    const key = resolveRateLimitKey(request, requestContext, trustProxy);
    const record = await dataStore.consumeRateLimit({
      key,
      maxRequests,
      windowMs,
      now: new Date(timestamp).toISOString(),
    });
    const resetAtMs = new Date(record.resetAt).getTime();
    const remaining = Math.max(record.remaining, 0);
    const headers = buildRateLimitHeaders({
      maxRequests,
      remaining,
      resetAt: resetAtMs,
      windowMs,
    });
    const rateLimit = {
      key,
      limited: Boolean(record.limited),
      limit: maxRequests,
      remaining,
      resetAt: Math.ceil(resetAtMs / 1000),
    };

    if (record.limited) {
      const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - timestamp) / 1000));
      return {
        headers,
        requestContext: {
          rateLimit,
        },
        response: {
          status: 429,
          headers: {
            ...headers,
            "content-type": "application/json; charset=utf-8",
            "retry-after": String(retryAfterSeconds),
          },
          body: JSON.stringify(
            {
              error: "rate_limited",
              message: "Too many requests from this IP. Try again later.",
              retry_after_seconds: retryAfterSeconds,
            },
            null,
            2,
          ),
        },
      };
    }

    return {
      headers,
      requestContext: {
        rateLimit,
      },
    };
  };
}

function resolveTimestamp(now) {
  const value = now();

  if (value instanceof Date) {
    return value.getTime();
  }

  return new Date(value).getTime();
}

function resolveRateLimitKey(request, requestContext, trustProxy) {
  const trackedIp = requestContext?.consumerActivity?.clientIp?.ip;

  if (typeof trackedIp === "string" && trackedIp.trim().length > 0) {
    return trackedIp.trim();
  }

  return resolveClientIp(request, {
    trustProxy,
  });
}

function buildRateLimitHeaders({ maxRequests, remaining, resetAt, windowMs }) {
  const policy = `${maxRequests};w=${Math.ceil(windowMs / 1000)}`;
  const resetAtSeconds = String(Math.ceil(resetAt / 1000));

  return {
    "ratelimit-limit": String(maxRequests),
    "ratelimit-policy": policy,
    "ratelimit-remaining": String(remaining),
    "ratelimit-reset": resetAtSeconds,
    "x-ratelimit-limit": String(maxRequests),
    "x-ratelimit-policy": policy,
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": resetAtSeconds,
  };
}
