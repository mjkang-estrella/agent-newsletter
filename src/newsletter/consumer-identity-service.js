import { createHash } from "node:crypto";

import { assertNonEmptyString, normalizeTimestamp } from "../core/contracts.js";
import { resolveClientIpMetadata } from "./rate-limit.js";

const DEFAULT_CONSUMER_ID_HEADERS = [
  "x-agent-consumer-id",
  "x-newsletter-consumer-id",
  "x-newsletter-consumer",
  "x-consumer-id",
];

export { DEFAULT_CONSUMER_ID_HEADERS };

export class ConsumerIdentityService {
  constructor({
    repository,
    now = () => new Date().toISOString(),
    trustProxy = false,
    consumerIdHeaders = DEFAULT_CONSUMER_ID_HEADERS,
  } = {}) {
    if (!repository || typeof repository.load !== "function" || typeof repository.save !== "function") {
      throw new TypeError("ConsumerIdentityService requires a repository with load() and save()");
    }

    if (typeof now !== "function") {
      throw new TypeError("ConsumerIdentityService now must be a function");
    }

    if (!Array.isArray(consumerIdHeaders) || consumerIdHeaders.length === 0) {
      throw new TypeError("consumerIdHeaders must be a non-empty array");
    }

    this.repository = repository;
    this.now = now;
    this.trustProxy = Boolean(trustProxy);
    this.consumerIdHeaders = consumerIdHeaders.map((header) =>
      assertNonEmptyString(header, "consumerIdHeaders[]").toLowerCase(),
    );
    this.pendingWrite = Promise.resolve();
  }

  async resolveRequest(request, context = {}) {
    const observedAt = normalizeTimestamp(resolveNow(this.now), "now");
    const identity = resolveConsumerRequestIdentity(request, {
      trustProxy: this.trustProxy,
      consumerIdHeaders: this.consumerIdHeaders,
    });

    await this.pendingWrite;

    const snapshot = await this.repository.load({ now: observedAt });
    const consumers = snapshot.consumers ?? [];
    const existing = findMatchingConsumerIdentityRecord(consumers, identity);

    return mergeConsumerIdentityRecord(existing, identity, observedAt, context);
  }

  async recordRequest(request, context = {}) {
    const observedAt = normalizeTimestamp(resolveNow(this.now), "now");
    const identity = resolveConsumerRequestIdentity(request, {
      trustProxy: this.trustProxy,
      consumerIdHeaders: this.consumerIdHeaders,
    });
    const operation = this.pendingWrite.then(async () => {
      const snapshot = await this.repository.load({ now: observedAt });
      const consumers = snapshot.consumers ?? [];
      const existing = findMatchingConsumerIdentityRecord(consumers, identity);
      const existingIndex =
        existing == null ? -1 : consumers.findIndex((consumer) => consumer.id === existing.id);
      const nextRecord = mergeConsumerIdentityRecord(existing, identity, observedAt, context);
      const nextConsumers =
        existingIndex === -1
          ? [...consumers, nextRecord]
          : consumers.map((consumer, index) => (index === existingIndex ? nextRecord : consumer));

      await this.repository.save({
        ...snapshot,
        updatedAt: observedAt,
        consumers: nextConsumers,
      });

      return nextRecord;
    });

    this.pendingWrite = operation.catch(() => {});

    return operation;
  }
}

export function resolveConsumerRequestIdentity(
  request,
  {
    trustProxy = false,
    consumerIdHeaders = DEFAULT_CONSUMER_ID_HEADERS,
  } = {},
) {
  const userAgent = normalizeOptionalHeaderValue(readHeader(request?.headers, "user-agent"));
  const normalizedUserAgentIdentity = normalizeUserAgentIdentityValue(userAgent);
  const declaredId = resolveDeclaredConsumerId(request?.headers, consumerIdHeaders);
  const clientIp = resolveClientIpMetadata(request, { trustProxy });
  const fallbackIdentity = resolveFallbackIdentity({
    normalizedUserAgentIdentity,
    userAgent,
    clientIp,
  });
  const identitySource = declaredId != null ? "consumer_header" : fallbackIdentity.source;
  const identityValue = declaredId ?? fallbackIdentity.value;

  return {
    id: buildConsumerIdentityId(identitySource, identityValue),
    identitySource,
    declaredId,
    fallbackIdentity,
    userAgent,
    clientIp,
  };
}

export function mergeConsumerIdentityRecord(existing, identity, observedAt, context = {}) {
  const requestOutcome = normalizeTrackedRequestOutcome(context?.outcome);
  const requestDetails = buildLastRequest(observedAt, context, requestOutcome);
  const observedClientIps = mergeObservedClientIps(
    existing?.observedClientIps ?? [],
    identity.clientIp,
    observedAt,
    requestOutcome,
  );
  const requestActivity = mergeRequestActivity(
    existing?.requestActivity ?? [],
    observedAt,
    requestDetails,
  );
  const rateLimitUsage = mergeRateLimitUsage(existing?.rateLimitUsage, observedAt, context?.rateLimit);

  const nextRecord = {
    id: existing?.id ?? identity.id,
    identitySource: resolveStoredIdentitySource(existing, identity),
    declaredId: identity.declaredId ?? existing?.declaredId ?? null,
    fallbackIdentity: resolveStoredFallbackIdentity(existing, identity),
    userAgent: identity.userAgent ?? existing?.userAgent ?? null,
    firstSeenAt: existing?.firstSeenAt ?? observedAt,
    lastSeenAt: observedAt,
    requestCount: (existing?.requestCount ?? 0) + 1,
    successfulRequestCount:
      (existing?.successfulRequestCount ?? existing?.requestCount ?? 0) +
      (requestOutcome === "throttled" ? 0 : 1),
    throttledRequestCount:
      (existing?.throttledRequestCount ?? 0) + (requestOutcome === "throttled" ? 1 : 0),
    observedClientIps,
    requestActivity,
    lastRequest: requestDetails,
  };

  if (rateLimitUsage) {
    nextRecord.rateLimitUsage = rateLimitUsage;
  }

  return nextRecord;
}

export function findMatchingConsumerIdentityRecord(consumers, identity) {
  const exactIdentityMatch = consumers.find((consumer) => consumer.id === identity.id);

  if (exactIdentityMatch) {
    return exactIdentityMatch;
  }

  if (identity.declaredId != null) {
    const declaredIdMatch = consumers.find((consumer) => consumer.declaredId === identity.declaredId);

    if (declaredIdMatch) {
      return declaredIdMatch;
    }
  }

  const fallbackIdentityMatches = consumers.filter((consumer) =>
    consumerFallbackMatches(consumer, identity.fallbackIdentity),
  );

  if (identity.declaredId != null) {
    const promotableFallbackMatches = fallbackIdentityMatches.filter(
      (consumer) => consumer.declaredId == null,
    );

    if (promotableFallbackMatches.length === 1) {
      return promotableFallbackMatches[0];
    }
  }

  if (identity.userAgent != null) {
    const userAgentMatches = consumers.filter((consumer) =>
      userAgentsMatch(consumer.userAgent, identity.userAgent),
    );
    const sameIpUserAgentMatches = userAgentMatches.filter((consumer) =>
      hasObservedClientIp(consumer, identity.clientIp.ip),
    );

    if (sameIpUserAgentMatches.length === 1) {
      return sameIpUserAgentMatches[0];
    }

    if (identity.declaredId != null) {
      const promotableMatches = userAgentMatches.filter((consumer) => consumer.declaredId == null);

      if (promotableMatches.length === 1) {
        return promotableMatches[0];
      }
    }

    if (identity.declaredId == null && userAgentMatches.length === 1) {
      return userAgentMatches[0];
    }
  }

  if (identity.declaredId == null && fallbackIdentityMatches.length === 1) {
    return fallbackIdentityMatches[0];
  }

  return null;
}

function mergeObservedClientIps(existingEntries, clientIp, observedAt, requestOutcome) {
  const existingIndex = existingEntries.findIndex((entry) => entry.address === clientIp.ip);
  const nextEntry = {
    address: clientIp.ip,
    source: clientIp.source,
    directIp: clientIp.directIp ?? null,
    forwardedChain: [...(clientIp.forwardedChain ?? [])],
    trustProxy: Boolean(clientIp.trustProxy),
    firstSeenAt: existingIndex === -1 ? observedAt : existingEntries[existingIndex].firstSeenAt,
    lastSeenAt: observedAt,
    requestCount: (existingIndex === -1 ? 0 : existingEntries[existingIndex].requestCount) + 1,
    successfulRequestCount:
      (existingIndex === -1 ? 0 : existingEntries[existingIndex].successfulRequestCount) +
      (requestOutcome === "throttled" ? 0 : 1),
    throttledRequestCount:
      (existingIndex === -1 ? 0 : existingEntries[existingIndex].throttledRequestCount) +
      (requestOutcome === "throttled" ? 1 : 0),
  };

  if (existingIndex === -1) {
    return [...existingEntries, nextEntry];
  }

  return existingEntries.map((entry, index) => (index === existingIndex ? nextEntry : entry));
}

function buildLastRequest(observedAt, context, outcome) {
  const method = String(context.method ?? "GET").toUpperCase();
  const path = context.path ?? "/";

  return {
    at: observedAt,
    method,
    path: assertNonEmptyString(path, "path"),
    outcome,
  };
}

function mergeRequestActivity(existingEntries, observedAt, requestDetails) {
  const activityDate = observedAt.slice(0, 10);
  const existingIndex = existingEntries.findIndex((entry) => entry.date === activityDate);
  const existing = existingIndex === -1 ? null : existingEntries[existingIndex];
  const nextEntry = {
    date: activityDate,
    firstRequestAt: existing?.firstRequestAt ?? observedAt,
    lastRequestAt: observedAt,
    requestCount: (existing?.requestCount ?? 0) + 1,
    successfulRequestCount:
      (existing?.successfulRequestCount ?? existing?.requestCount ?? 0) +
      (requestDetails.outcome === "throttled" ? 0 : 1),
    throttledRequestCount:
      (existing?.throttledRequestCount ?? 0) + (requestDetails.outcome === "throttled" ? 1 : 0),
    methods: mergeUniqueStrings(existing?.methods ?? [], requestDetails.method),
    paths: mergeUniqueStrings(existing?.paths ?? [], requestDetails.path),
  };

  if (existingIndex === -1) {
    return [...existingEntries, nextEntry];
  }

  return existingEntries.map((entry, index) => (index === existingIndex ? nextEntry : entry));
}

function resolveDeclaredConsumerId(headers, consumerIdHeaders) {
  for (const header of consumerIdHeaders) {
    const value = normalizeOptionalHeaderValue(readHeader(headers, header));

    if (value) {
      return value;
    }
  }

  return null;
}

function buildConsumerIdentityId(identitySource, identityValue) {
  const hash = createHash("sha256")
    .update(identitySource)
    .update(":")
    .update(identityValue)
    .digest("hex")
    .slice(0, 16);

  return `consumer-${identitySource}-${hash}`;
}

function normalizeOptionalHeaderValue(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value.trim();
}

export function normalizeUserAgentIdentityValue(userAgent) {
  if (userAgent == null) {
    return null;
  }

  const normalizedProducts = userAgent
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.split("/", 1)[0])
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9._-]+$/gi, ""))
    .filter((token) => token.length > 0)
    .filter((token) => !/^v?\d+(?:[._-]\d+)*$/i.test(token))
    .map((token) => token.toLowerCase());

  if (normalizedProducts.length > 0) {
    return [...new Set(normalizedProducts)].join(" ");
  }

  return userAgent.toLowerCase();
}

function userAgentsMatch(left, right) {
  if (left == null || right == null) {
    return left === right;
  }

  return (
    left === right ||
    normalizeUserAgentIdentityValue(left) === normalizeUserAgentIdentityValue(right)
  );
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

function resolveNow(now) {
  const value = now();

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function mergeUniqueStrings(values, value) {
  return [...new Set([...values, value])].sort();
}

function hasObservedClientIp(consumer, ipAddress) {
  return consumer.observedClientIps?.some((entry) => entry.address === ipAddress) ?? false;
}

function resolveStoredIdentitySource(existing, identity) {
  if (identity.declaredId != null || existing?.declaredId != null) {
    return "consumer_header";
  }

  if (identity.userAgent != null || existing?.userAgent != null) {
    return "user_agent";
  }

  return "ip";
}

function resolveFallbackIdentity({ normalizedUserAgentIdentity, userAgent, clientIp }) {
  if (normalizedUserAgentIdentity != null) {
    return {
      source: "user_agent",
      value: normalizedUserAgentIdentity,
      observedValue: userAgent,
    };
  }

  return {
    source: "ip",
    value: clientIp.ip,
    observedValue: clientIp.ip,
  };
}

function resolveStoredFallbackIdentity(existing, identity) {
  const existingFallbackIdentity = existing?.fallbackIdentity ?? deriveLegacyFallbackIdentity(existing);
  const nextFallbackIdentity = identity.fallbackIdentity;

  if (nextFallbackIdentity?.source === "user_agent") {
    return nextFallbackIdentity;
  }

  if (existingFallbackIdentity?.source === "user_agent") {
    return existingFallbackIdentity;
  }

  return nextFallbackIdentity ?? existingFallbackIdentity ?? null;
}

function deriveLegacyFallbackIdentity(consumer) {
  if (!consumer || typeof consumer !== "object") {
    return null;
  }

  if (consumer.userAgent != null) {
    return {
      source: "user_agent",
      value: normalizeUserAgentIdentityValue(consumer.userAgent),
      observedValue: consumer.userAgent,
    };
  }

  const observedIp = consumer.observedClientIps?.[0]?.address ?? null;

  if (observedIp != null) {
    return {
      source: "ip",
      value: observedIp,
      observedValue: observedIp,
    };
  }

  return null;
}

function consumerFallbackMatches(consumer, fallbackIdentity) {
  if (!fallbackIdentity) {
    return false;
  }

  const storedFallbackIdentity =
    consumer?.fallbackIdentity ?? deriveLegacyFallbackIdentity(consumer);

  if (fallbackIdentity.source === "user_agent") {
    return (
      storedFallbackIdentity?.source === "user_agent" &&
      storedFallbackIdentity.value === fallbackIdentity.value
    ) || userAgentsMatch(consumer?.userAgent, fallbackIdentity.observedValue);
  }

  return (
    (storedFallbackIdentity?.source === "ip" && storedFallbackIdentity.value === fallbackIdentity.value) ||
    hasObservedClientIp(consumer, fallbackIdentity.value)
  );
}

function normalizeTrackedRequestOutcome(outcome) {
  return outcome === "throttled" ? "throttled" : "successful";
}

function mergeRateLimitUsage(existingUsage, observedAt, rateLimit) {
  const normalizedRateLimit = normalizeTrackedRateLimit(rateLimit);

  if (!normalizedRateLimit) {
    return existingUsage ?? null;
  }

  return {
    evaluatedRequestCount: (existingUsage?.evaluatedRequestCount ?? 0) + 1,
    allowedRequestCount:
      (existingUsage?.allowedRequestCount ?? 0) + (normalizedRateLimit.limited ? 0 : 1),
    blockedRequestCount:
      (existingUsage?.blockedRequestCount ?? 0) + (normalizedRateLimit.limited ? 1 : 0),
    keys: mergeUniqueStrings(existingUsage?.keys ?? [], normalizedRateLimit.key),
    lastDecision: {
      at: observedAt,
      ...normalizedRateLimit,
    },
  };
}

function normalizeTrackedRateLimit(rateLimit) {
  if (!rateLimit || typeof rateLimit !== "object" || Array.isArray(rateLimit)) {
    return null;
  }

  const key = normalizeOptionalHeaderValue(rateLimit.key);
  const limit = normalizePositiveInteger(rateLimit.limit);
  const remaining = normalizeNonNegativeInteger(rateLimit.remaining);
  const resetAt = normalizePositiveInteger(rateLimit.resetAt);

  if (key == null || limit == null || remaining == null || resetAt == null) {
    return null;
  }

  return {
    key,
    limited: Boolean(rateLimit.limited),
    limit,
    remaining,
    resetAt,
  };
}

function normalizePositiveInteger(value) {
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function normalizeNonNegativeInteger(value) {
  if (!Number.isInteger(value) || value < 0) {
    return null;
  }

  return value;
}
