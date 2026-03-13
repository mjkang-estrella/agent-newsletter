import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { assertNonEmptyString, normalizeTimestamp } from "../core/contracts.js";
import { normalizeUserAgentIdentityValue } from "./consumer-identity-service.js";

const CONSUMER_IDENTITY_SOURCES = ["consumer_header", "user_agent", "ip"];
const FALLBACK_IDENTITY_SOURCES = ["user_agent", "ip"];
const CLIENT_IP_SOURCES = ["x-forwarded-for", "forwarded", "socket", "unknown"];
const REQUEST_OUTCOMES = ["successful", "throttled"];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export { CLIENT_IP_SOURCES, CONSUMER_IDENTITY_SOURCES, FALLBACK_IDENTITY_SOURCES };

export class ConsumerIdentityRepository {
  constructor({ filePath } = {}) {
    if (!filePath) {
      throw new Error("ConsumerIdentityRepository requires a filePath");
    }

    this.filePath = filePath;
  }

  async load({ now = new Date().toISOString() } = {}) {
    return this.readSnapshot(now);
  }

  async save(snapshot) {
    const normalizedSnapshot = normalizeConsumerIdentitySnapshot(
      snapshot,
      snapshot?.updatedAt ?? new Date().toISOString(),
    );

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(normalizedSnapshot, null, 2)}\n`, "utf8");
  }

  async readSnapshot(now) {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);

      return normalizeConsumerIdentitySnapshot(parsed, now);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return normalizeConsumerIdentitySnapshot(null, now);
      }

      throw error;
    }
  }
}

export function normalizeConsumerIdentitySnapshot(snapshot, now = new Date().toISOString()) {
  const updatedAt = normalizeTimestamp(snapshot?.updatedAt ?? now, "updatedAt");
  const consumers = Array.isArray(snapshot?.consumers)
    ? snapshot.consumers.map((consumer) => normalizeConsumerIdentityRecord(consumer)).sort(sortConsumers)
    : [];

  return {
    version: 1,
    updatedAt,
    consumers,
  };
}

export function normalizeConsumerIdentityRecord(record) {
  const firstSeenAt = normalizeTimestamp(record?.firstSeenAt, "consumer.firstSeenAt");
  const lastSeenAt = normalizeTimestamp(
    record?.lastSeenAt ?? record?.firstSeenAt,
    "consumer.lastSeenAt",
  );
  const requestCount = normalizePositiveInteger(record?.requestCount, "consumer.requestCount");
  const {
    successfulRequestCount,
    throttledRequestCount,
  } = normalizeRequestOutcomeCounts(
    {
      successfulRequestCount: record?.successfulRequestCount,
      throttledRequestCount: record?.throttledRequestCount,
    },
    {
      requestCount,
      fieldName: "consumer",
    },
  );
  const observedClientIps = Array.isArray(record?.observedClientIps)
    ? record.observedClientIps.map((entry) => normalizeObservedClientIp(entry)).sort(sortObservedClientIps)
    : [];
  const fallbackIdentity = normalizeFallbackIdentity(record?.fallbackIdentity, {
    userAgent: record?.userAgent,
    observedClientIps,
  });
  const lastRequest = record?.lastRequest == null ? null : normalizeLastRequest(record.lastRequest);
  const rateLimitUsage =
    record?.rateLimitUsage == null ? null : normalizeRateLimitUsage(record.rateLimitUsage);
  const requestActivity = Array.isArray(record?.requestActivity)
    ? record.requestActivity
        .map((entry) => normalizeConsumerRequestActivityEntry(entry))
        .sort(sortRequestActivity)
    : buildLegacyRequestActivity({
        firstSeenAt,
        lastSeenAt,
        lastRequest,
        requestCount,
      });

  const normalizedRecord = {
    id: assertNonEmptyString(record?.id, "consumer.id"),
    identitySource: normalizeAllowedValue(
      record?.identitySource,
      CONSUMER_IDENTITY_SOURCES,
      "consumer.identitySource",
    ),
    declaredId: normalizeNullableString(record?.declaredId),
    fallbackIdentity,
    userAgent: normalizeNullableString(record?.userAgent),
    firstSeenAt,
    lastSeenAt,
    requestCount,
    successfulRequestCount,
    throttledRequestCount,
    observedClientIps,
    requestActivity,
    lastRequest,
  };

  if (rateLimitUsage) {
    normalizedRecord.rateLimitUsage = rateLimitUsage;
  }

  return normalizedRecord;
}

export function normalizeObservedClientIp(entry) {
  const requestCount = normalizePositiveInteger(
    entry?.requestCount,
    "consumer.observedClientIps[].requestCount",
  );
  const {
    successfulRequestCount,
    throttledRequestCount,
  } = normalizeRequestOutcomeCounts(
    {
      successfulRequestCount: entry?.successfulRequestCount,
      throttledRequestCount: entry?.throttledRequestCount,
    },
    {
      requestCount,
      fieldName: "consumer.observedClientIps[]",
    },
  );

  return {
    address: assertNonEmptyString(entry?.address, "consumer.observedClientIps[].address"),
    source: normalizeAllowedValue(
      entry?.source,
      CLIENT_IP_SOURCES,
      "consumer.observedClientIps[].source",
    ),
    directIp: normalizeNullableString(entry?.directIp),
    forwardedChain: normalizeStringArray(
      entry?.forwardedChain,
      "consumer.observedClientIps[].forwardedChain",
    ),
    trustProxy: Boolean(entry?.trustProxy),
    firstSeenAt: normalizeTimestamp(
      entry?.firstSeenAt,
      "consumer.observedClientIps[].firstSeenAt",
    ),
    lastSeenAt: normalizeTimestamp(
      entry?.lastSeenAt ?? entry?.firstSeenAt,
      "consumer.observedClientIps[].lastSeenAt",
    ),
    requestCount,
    successfulRequestCount,
    throttledRequestCount,
  };
}

export function normalizeConsumerRequestActivityEntry(entry) {
  const firstRequestAt = normalizeTimestamp(
    entry?.firstRequestAt,
    "consumer.requestActivity[].firstRequestAt",
  );
  const lastRequestAt = normalizeTimestamp(
    entry?.lastRequestAt ?? entry?.firstRequestAt,
    "consumer.requestActivity[].lastRequestAt",
  );
  const requestCount = normalizePositiveInteger(
    entry?.requestCount,
    "consumer.requestActivity[].requestCount",
  );

  if (new Date(firstRequestAt).getTime() > new Date(lastRequestAt).getTime()) {
    throw new RangeError(
      "consumer.requestActivity[].firstRequestAt must be earlier than or equal to lastRequestAt",
    );
  }

  return {
    date: normalizeIsoDate(entry?.date, "consumer.requestActivity[].date"),
    firstRequestAt,
    lastRequestAt,
    requestCount,
    ...normalizeRequestOutcomeCounts(
      {
        successfulRequestCount: entry?.successfulRequestCount,
        throttledRequestCount: entry?.throttledRequestCount,
      },
      {
        requestCount,
        fieldName: "consumer.requestActivity[]",
      },
    ),
    methods: normalizeMethodArray(
      entry?.methods,
      "consumer.requestActivity[].methods",
    ),
    paths: normalizePathArray(entry?.paths, "consumer.requestActivity[].paths"),
  };
}

function normalizeLastRequest(entry) {
  return {
    at: normalizeTimestamp(entry?.at, "consumer.lastRequest.at"),
    method: assertNonEmptyString(entry?.method, "consumer.lastRequest.method").toUpperCase(),
    path: assertNonEmptyString(entry?.path, "consumer.lastRequest.path"),
    outcome: normalizeAllowedValue(
      entry?.outcome ?? "successful",
      REQUEST_OUTCOMES,
      "consumer.lastRequest.outcome",
    ),
  };
}

function normalizeFallbackIdentity(fallbackIdentity, { userAgent, observedClientIps }) {
  if (fallbackIdentity == null) {
    return deriveLegacyFallbackIdentity({ userAgent, observedClientIps });
  }

  return {
    source: normalizeAllowedValue(
      fallbackIdentity?.source,
      FALLBACK_IDENTITY_SOURCES,
      "consumer.fallbackIdentity.source",
    ),
    value: assertNonEmptyString(
      fallbackIdentity?.value,
      "consumer.fallbackIdentity.value",
    ),
    observedValue:
      normalizeNullableString(fallbackIdentity?.observedValue) ??
      assertNonEmptyString(
        fallbackIdentity?.value,
        "consumer.fallbackIdentity.value",
      ),
  };
}

function deriveLegacyFallbackIdentity({ userAgent, observedClientIps }) {
  if (userAgent != null) {
    return {
      source: "user_agent",
      value: normalizeUserAgentIdentityValue(userAgent) ?? userAgent.toLowerCase(),
      observedValue: userAgent,
    };
  }

  const observedIp = observedClientIps[0]?.address ?? "unknown";

  return {
    source: "ip",
    value: observedIp,
    observedValue: observedIp,
  };
}

function normalizeRateLimitUsage(entry) {
  const evaluatedRequestCount = normalizePositiveInteger(
    entry?.evaluatedRequestCount,
    "consumer.rateLimitUsage.evaluatedRequestCount",
  );
  const allowedRequestCount = normalizeNonNegativeInteger(
    entry?.allowedRequestCount,
    "consumer.rateLimitUsage.allowedRequestCount",
  );
  const blockedRequestCount = normalizeNonNegativeInteger(
    entry?.blockedRequestCount,
    "consumer.rateLimitUsage.blockedRequestCount",
  );

  if (allowedRequestCount + blockedRequestCount !== evaluatedRequestCount) {
    throw new RangeError(
      "consumer.rateLimitUsage.allowedRequestCount + consumer.rateLimitUsage.blockedRequestCount must equal consumer.rateLimitUsage.evaluatedRequestCount",
    );
  }

  return {
    evaluatedRequestCount,
    allowedRequestCount,
    blockedRequestCount,
    keys: normalizeStringArray(entry?.keys, "consumer.rateLimitUsage.keys").sort(),
    lastDecision: normalizeRateLimitDecision(entry?.lastDecision),
  };
}

function normalizeRateLimitDecision(entry) {
  return {
    at: normalizeTimestamp(entry?.at, "consumer.rateLimitUsage.lastDecision.at"),
    key: assertNonEmptyString(entry?.key, "consumer.rateLimitUsage.lastDecision.key"),
    limited: Boolean(entry?.limited),
    limit: normalizePositiveInteger(entry?.limit, "consumer.rateLimitUsage.lastDecision.limit"),
    remaining: normalizeNonNegativeInteger(
      entry?.remaining,
      "consumer.rateLimitUsage.lastDecision.remaining",
    ),
    resetAt: normalizePositiveInteger(
      entry?.resetAt,
      "consumer.rateLimitUsage.lastDecision.resetAt",
    ),
  };
}

function normalizeAllowedValue(value, allowedValues, fieldName) {
  const normalizedValue = assertNonEmptyString(value, fieldName);

  if (!allowedValues.includes(normalizedValue)) {
    throw new TypeError(`${fieldName} must be one of: ${allowedValues.join(", ")}`);
  }

  return normalizedValue;
}

function normalizeNullableString(value) {
  if (value == null) {
    return null;
  }

  return assertNonEmptyString(value, "value");
}

function normalizeIsoDate(value, fieldName) {
  const normalizedValue = assertNonEmptyString(value, fieldName);

  if (!ISO_DATE_PATTERN.test(normalizedValue)) {
    throw new TypeError(`${fieldName} must be an ISO-8601 calendar date`);
  }

  const parsed = new Date(`${normalizedValue}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalizedValue) {
    throw new TypeError(`${fieldName} must be a valid calendar date`);
  }

  return normalizedValue;
}

function normalizeStringArray(values, fieldName) {
  if (values == null) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new TypeError(`${fieldName} must be an array`);
  }

  return [...new Set(values.map((value) => assertNonEmptyString(value, fieldName)))];
}

function normalizeMethodArray(values, fieldName) {
  return normalizeStringArray(values, fieldName)
    .map((value) => value.toUpperCase())
    .sort();
}

function normalizePathArray(values, fieldName) {
  return normalizeStringArray(values, fieldName).sort();
}

function normalizePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }

  return value;
}

function normalizeNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }

  return value;
}

function normalizeRequestOutcomeCounts(
  { successfulRequestCount, throttledRequestCount },
  { requestCount, fieldName },
) {
  const normalizedSuccessfulRequestCount = normalizeNonNegativeInteger(
    successfulRequestCount ?? requestCount,
    `${fieldName}.successfulRequestCount`,
  );
  const normalizedThrottledRequestCount = normalizeNonNegativeInteger(
    throttledRequestCount ?? 0,
    `${fieldName}.throttledRequestCount`,
  );

  if (normalizedSuccessfulRequestCount + normalizedThrottledRequestCount !== requestCount) {
    throw new RangeError(
      `${fieldName}.successfulRequestCount + ${fieldName}.throttledRequestCount must equal ${fieldName}.requestCount`,
    );
  }

  return {
    successfulRequestCount: normalizedSuccessfulRequestCount,
    throttledRequestCount: normalizedThrottledRequestCount,
  };
}

function sortConsumers(left, right) {
  const leftLastSeenAt = new Date(left.lastSeenAt).getTime();
  const rightLastSeenAt = new Date(right.lastSeenAt).getTime();

  if (rightLastSeenAt !== leftLastSeenAt) {
    return rightLastSeenAt - leftLastSeenAt;
  }

  return left.id.localeCompare(right.id);
}

function sortObservedClientIps(left, right) {
  const leftLastSeenAt = new Date(left.lastSeenAt).getTime();
  const rightLastSeenAt = new Date(right.lastSeenAt).getTime();

  if (rightLastSeenAt !== leftLastSeenAt) {
    return rightLastSeenAt - leftLastSeenAt;
  }

  return left.address.localeCompare(right.address);
}

function sortRequestActivity(left, right) {
  const leftLastRequestAt = new Date(left.lastRequestAt).getTime();
  const rightLastRequestAt = new Date(right.lastRequestAt).getTime();

  if (rightLastRequestAt !== leftLastRequestAt) {
    return rightLastRequestAt - leftLastRequestAt;
  }

  return right.date.localeCompare(left.date);
}

function buildLegacyRequestActivity({
  firstSeenAt,
  lastSeenAt,
  lastRequest,
  requestCount,
}) {
  const lastRequestAt = lastRequest?.at ?? lastSeenAt;

  return [
    {
      date: lastRequestAt.slice(0, 10),
      firstRequestAt: firstSeenAt,
      lastRequestAt,
      requestCount,
      successfulRequestCount: requestCount,
      throttledRequestCount: 0,
      methods: lastRequest?.method ? [lastRequest.method] : [],
      paths: lastRequest?.path ? [lastRequest.path] : [],
    },
  ];
}
