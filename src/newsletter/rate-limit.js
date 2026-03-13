import { isIP } from "node:net";

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 60;
const API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME = "NEWSLETTER_API_RATE_LIMIT_MAX_REQUESTS";
const API_RATE_LIMIT_WINDOW_MS_ENV_NAME = "NEWSLETTER_API_RATE_LIMIT_WINDOW_MS";
const API_RATE_LIMIT_TRUST_PROXY_ENV_NAME = "NEWSLETTER_API_RATE_LIMIT_TRUST_PROXY";

export {
  API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME,
  API_RATE_LIMIT_TRUST_PROXY_ENV_NAME,
  API_RATE_LIMIT_WINDOW_MS_ENV_NAME,
  DEFAULT_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
};

export function createIpRateLimiter({
  maxRequests = DEFAULT_RATE_LIMIT_MAX_REQUESTS,
  windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
  now = () => Date.now(),
  store,
  trustProxy = false,
  keyGenerator = defaultKeyGenerator,
} = {}) {
  const normalizedMaxRequests = normalizePositiveInteger(maxRequests, "maxRequests");
  const normalizedWindowMs = normalizePositiveInteger(windowMs, "windowMs");

  if (typeof now !== "function") {
    throw new TypeError("rateLimit.now must be a function");
  }

  if (typeof keyGenerator !== "function") {
    throw new TypeError("rateLimit.keyGenerator must be a function");
  }

  const rateLimitStore = resolveRateLimitStore(store);
  const useTrustedProxy = Boolean(trustProxy);
  let nextPruneAt = 0;

  return function rateLimitRequest(request, requestContext = {}) {
    const timestamp = resolveTimestamp(now);

    if (rateLimitStore instanceof Map && timestamp >= nextPruneAt) {
      pruneExpiredEntries(rateLimitStore, timestamp);
      nextPruneAt = timestamp + normalizedWindowMs;
    }

    const key = normalizeRateLimitKey(
      keyGenerator(request, {
        trustProxy: useTrustedProxy,
        requestContext,
        consumer: requestContext.consumer ?? null,
        consumerActivity: requestContext.consumerActivity ?? null,
      }),
    );
    const record = readRateLimitRecord(rateLimitStore, key, timestamp, normalizedWindowMs);
    record.count += 1;
    rateLimitStore.set(key, record);

    const remaining = Math.max(normalizedMaxRequests - record.count, 0);
    const headers = buildRateLimitHeaders({
      maxRequests: normalizedMaxRequests,
      remaining,
      resetAt: record.resetAt,
      windowMs: normalizedWindowMs,
    });
    const rateLimit = createRateLimitEvaluation({
      key,
      limited: record.count > normalizedMaxRequests,
      maxRequests: normalizedMaxRequests,
      remaining,
      resetAt: record.resetAt,
    });

    if (record.count > normalizedMaxRequests) {
      return {
        headers,
        requestContext: { rateLimit },
        response: createRateLimitResponse({ headers, resetAt: record.resetAt, timestamp }),
      };
    }

    return {
      headers,
      requestContext: { rateLimit },
    };
  };
}

export function resolveRateLimitConfigFromEnv(env = process.env) {
  return Object.freeze({
    maxRequests: resolveEnvPositiveInteger(
      env?.[API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME],
      API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME,
      DEFAULT_RATE_LIMIT_MAX_REQUESTS,
    ),
    windowMs: resolveEnvPositiveInteger(
      env?.[API_RATE_LIMIT_WINDOW_MS_ENV_NAME],
      API_RATE_LIMIT_WINDOW_MS_ENV_NAME,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
    ),
    trustProxy: resolveEnvBoolean(
      env?.[API_RATE_LIMIT_TRUST_PROXY_ENV_NAME],
      API_RATE_LIMIT_TRUST_PROXY_ENV_NAME,
      false,
    ),
  });
}

export function resolveClientIp(request, { trustProxy = false } = {}) {
  return resolveClientIpMetadata(request, { trustProxy }).ip;
}

export function resolveClientIpMetadata(request, { trustProxy = false } = {}) {
  const directIp =
    normalizeClientAddress(
      request?.ip ??
        request?.socket?.remoteAddress ??
        request?.connection?.remoteAddress ??
        request?.info?.remoteAddress,
    ) ?? "unknown";

  if (trustProxy) {
    const forwardedFor = readHeader(request?.headers, "x-forwarded-for");

    if (forwardedFor) {
      const forwardedChain = extractForwardedIpChain(forwardedFor);

      return {
        ip: forwardedChain[0] ?? "unknown",
        source: "x-forwarded-for",
        directIp,
        forwardedChain,
        trustProxy: true,
      };
    }

    const forwarded = readHeader(request?.headers, "forwarded");

    if (forwarded) {
      const forwardedChain = extractProxyForwardedIpChain(forwarded);

      if (forwardedChain.length > 0) {
        return {
          ip: forwardedChain[0],
          source: "forwarded",
          directIp,
          forwardedChain,
          trustProxy: true,
        };
      }
    }
  }

  return {
    ip: directIp,
    source: directIp === "unknown" ? "unknown" : "socket",
    directIp,
    forwardedChain: [],
    trustProxy: Boolean(trustProxy),
  };
}

function defaultKeyGenerator(request, { trustProxy, consumerActivity, requestContext }) {
  const trackedIp =
    resolveTrackedConsumerIpForRateLimit(consumerActivity?.clientIp, trustProxy) ??
    resolveTrackedConsumerIpForRateLimit(requestContext?.consumerActivity?.clientIp, trustProxy) ??
    resolveTrackedConsumerIpForRateLimit(request?.newsletterConsumerActivity?.clientIp, trustProxy);

  if (trackedIp) {
    return trackedIp;
  }

  return resolveClientIp(request, { trustProxy });
}

function createRateLimitEvaluation({ key, limited, maxRequests, remaining, resetAt }) {
  return {
    key,
    limited: Boolean(limited),
    limit: maxRequests,
    remaining,
    resetAt: Math.ceil(resetAt / 1000),
  };
}

function createRateLimitResponse({ headers, resetAt, timestamp }) {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - timestamp) / 1000));

  return {
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
  };
}

function buildRateLimitHeaders({
  maxRequests,
  remaining,
  resetAt,
  windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
}) {
  const resetAtSeconds = String(Math.ceil(resetAt / 1000));
  const rateLimitPolicy = createRateLimitPolicy({
    maxRequests,
    windowMs:
      Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_RATE_LIMIT_WINDOW_MS,
  });

  return {
    "ratelimit-limit": String(maxRequests),
    "ratelimit-policy": rateLimitPolicy,
    "ratelimit-remaining": String(remaining),
    "ratelimit-reset": resetAtSeconds,
    "x-ratelimit-limit": String(maxRequests),
    "x-ratelimit-policy": rateLimitPolicy,
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": resetAtSeconds,
  };
}

function createRateLimitPolicy({ maxRequests, windowMs }) {
  return `${maxRequests};w=${Math.ceil(windowMs / 1000)}`;
}

function readRateLimitRecord(store, key, timestamp, windowMs) {
  const record = store.get(key);

  if (!isActiveRecord(record, timestamp)) {
    return {
      count: 0,
      resetAt: timestamp + windowMs,
    };
  }

  return {
    count: record.count,
    resetAt: record.resetAt,
  };
}

function pruneExpiredEntries(store, timestamp) {
  for (const [key, record] of store.entries()) {
    if (!isActiveRecord(record, timestamp)) {
      store.delete(key);
    }
  }
}

function isActiveRecord(record, timestamp) {
  return (
    Boolean(record) &&
    Number.isFinite(record.count) &&
    Number.isFinite(record.resetAt) &&
    record.resetAt > timestamp
  );
}

function resolveRateLimitStore(store) {
  if (store == null) {
    return new Map();
  }

  if (
    typeof store.get !== "function" ||
    typeof store.set !== "function" ||
    typeof store.delete !== "function"
  ) {
    throw new TypeError("rateLimit.store must expose get(), set(), and delete()");
  }

  return store;
}

function normalizePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`rateLimit.${label} must be a positive integer`);
  }

  return value;
}

function resolveEnvPositiveInteger(value, envName, fallback) {
  if (value == null || value === "") {
    return fallback;
  }

  let normalizedValue = value;

  if (typeof normalizedValue !== "number") {
    const normalizedString = String(normalizedValue).trim();

    if (!/^\d+$/.test(normalizedString)) {
      throw new TypeError(`${envName} must be a positive integer`);
    }

    normalizedValue = Number.parseInt(normalizedString, 10);
  }

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new TypeError(`${envName} must be a positive integer`);
  }

  return normalizedValue;
}

function resolveEnvBoolean(value, envName, fallback) {
  if (value == null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalizedValue = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  throw new TypeError(
    `${envName} must be one of: true, false, 1, 0, yes, no, on, off`,
  );
}

function resolveTimestamp(now) {
  const value = now();

  if (value instanceof Date) {
    return value.getTime();
  }

  if (!Number.isFinite(value)) {
    throw new TypeError("rateLimit.now must return a timestamp or Date");
  }

  return value;
}

function normalizeRateLimitKey(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return "unknown";
}

function normalizeTrackedConsumerIp(value) {
  return normalizeClientAddress(value);
}

function resolveTrackedConsumerIpForRateLimit(clientIp, trustProxy) {
  if (!clientIp || typeof clientIp !== "object") {
    return null;
  }

  if ("trustProxy" in clientIp && Boolean(clientIp.trustProxy) !== Boolean(trustProxy)) {
    return null;
  }

  return normalizeTrackedConsumerIp(clientIp.ip);
}

function readHeader(headers, name) {
  if (!headers || typeof headers !== "object") {
    return null;
  }

  if (typeof headers.get === "function") {
    const value =
      headers.get(name) ??
      headers.get(name.toLowerCase()) ??
      headers.get(name.toUpperCase());
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];

  if (Array.isArray(value)) {
    return value.join(",");
  }

  return typeof value === "string" ? value : null;
}

function extractForwardedIp(value) {
  return normalizeForwardedValue(value.split(",")[0]) ?? "unknown";
}

function extractForwardedIpChain(value) {
  return value
    .split(",")
    .map((entry) => normalizeForwardedValue(entry))
    .filter(Boolean);
}

function extractProxyForwardedIp(value) {
  const entries = value.split(",");

  for (const entry of entries) {
    const segments = entry.split(";");

    for (const segment of segments) {
      const [key, rawValue] = segment.split("=");

      if (key?.trim().toLowerCase() !== "for") {
        continue;
      }

      return normalizeForwardedValue(rawValue);
    }
  }

  return null;
}

function extractProxyForwardedIpChain(value) {
  const entries = value.split(",");
  const forwardedIps = [];

  for (const entry of entries) {
    const segments = entry.split(";");

    for (const segment of segments) {
      const [key, rawValue] = segment.split("=");

      if (key?.trim().toLowerCase() !== "for") {
        continue;
      }

      const normalizedValue = normalizeForwardedValue(rawValue);

      if (normalizedValue) {
        forwardedIps.push(normalizedValue);
      }

      break;
    }
  }

  return forwardedIps;
}

function normalizeForwardedValue(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/^"|"$/g, "");

  if (normalized.startsWith("[")) {
    const closingBracketIndex = normalized.indexOf("]");

    if (closingBracketIndex !== -1) {
      return normalizeClientAddress(normalized.slice(1, closingBracketIndex));
    }
  }

  const lastColonIndex = normalized.lastIndexOf(":");
  const hasSingleColon = normalized.indexOf(":") === lastColonIndex;

  if (hasSingleColon && lastColonIndex > -1) {
    return normalizeClientAddress(normalized.slice(0, lastColonIndex));
  }

  return normalizeClientAddress(normalized);
}

function normalizeClientAddress(value) {
  if (typeof value !== "string") {
    return null;
  }

  let normalized = value.trim().replace(/^"|"$/g, "");

  if (normalized.length === 0) {
    return null;
  }

  const zoneIndex = normalized.indexOf("%");

  if (zoneIndex !== -1) {
    normalized = normalized.slice(0, zoneIndex);
  }

  const ipv4MappedMatch = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);

  if (ipv4MappedMatch) {
    normalized = ipv4MappedMatch[1];
  }

  if (isIP(normalized) === 6) {
    return normalized.toLowerCase();
  }

  return normalizeRateLimitKey(normalized);
}
