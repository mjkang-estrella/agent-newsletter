import { normalizeTimestamp } from "../core/contracts.js";
import {
  ConsumerIdentityService,
  findMatchingConsumerIdentityRecord,
  mergeConsumerIdentityRecord,
  resolveConsumerRequestIdentity,
} from "./consumer-identity-service.js";

export const DEFAULT_ANONYMOUS_CONSUMER_ID = "anonymous";

export function createConsumerTracker({
  now = () => new Date().toISOString(),
  repository,
  service,
  store,
  trustProxy = false,
  consumerIdResolver = defaultConsumerIdResolver,
  consumerIdHeaders,
} = {}) {
  if (typeof now !== "function") {
    throw new TypeError("consumerTracking.now must be a function");
  }

  const trackingService = resolveConsumerIdentityService({
    repository,
    service,
    now,
    trustProxy,
    consumerIdHeaders,
  });

  if (trackingService) {
    return async function trackConsumerRequestWithPersistence(request) {
      const requestActivity = createTrackedConsumerActivity(request, {
        now,
        trustProxy,
        consumerIdHeaders,
      });
      const resolvedConsumer = await trackingService.resolveRequest(request, {
        method: requestActivity.method,
        path: requestActivity.path,
      });
      request.newsletterConsumer = resolvedConsumer;
      request.newsletterConsumerActivity = requestActivity;
      attachConsumerTrackingFinalizer(request, async ({ requestContext, response }) => {
        const rateLimitUsage = resolveTrackedRateLimitUsage(requestContext);
        const trackedRequest = await trackingService.recordRequest(request, {
          method: requestActivity.method,
          path: requestActivity.path,
          outcome: resolveTrackedRequestOutcome({ requestContext, response }),
          ...(rateLimitUsage ? { rateLimit: rateLimitUsage } : {}),
        });
        request.newsletterConsumer = replaceTrackedConsumerValue(
          request.newsletterConsumer,
          trackedRequest,
        );
        request.newsletterConsumerActivity = {
          ...requestActivity,
          seenAt: trackedRequest.lastRequest?.at ?? requestActivity.seenAt,
        };

        if (requestContext && typeof requestContext === "object") {
          requestContext.consumer = replaceTrackedConsumerValue(requestContext.consumer, trackedRequest);
          requestContext.consumerActivity = request.newsletterConsumerActivity;
        }
      });

      return {
        requestContext: {
          consumer: resolvedConsumer,
          consumerActivity: request.newsletterConsumerActivity,
        },
      };
    };
  }

  if (typeof consumerIdResolver !== "function") {
    throw new TypeError("consumerTracking.consumerIdResolver must be a function");
  }

  const trackingStore = resolveTrackingStore(store);
  const useTrustedProxy = Boolean(trustProxy);

  return function trackConsumerRequest(request) {
    const requestActivity = createTrackedConsumerActivity(request, {
      now,
      trustProxy: useTrustedProxy,
      consumerIdHeaders,
    });
    const legacyConsumerId = normalizeConsumerId(consumerIdResolver(request));
    const trackedRequest = {
      consumerId: legacyConsumerId,
      identity: requestActivity.identity,
      clientIp: requestActivity.clientIp,
      method: requestActivity.method,
      route: requestActivity.path,
      seenAt: requestActivity.seenAt,
    };

    request.newsletterConsumer = createTransientConsumerEntity(requestActivity);
    request.newsletterConsumerActivity = requestActivity;
    attachConsumerTrackingFinalizer(request, ({ requestContext, response }) => {
      const outcome = resolveTrackedRequestOutcome({ requestContext, response });
      const rateLimitUsage = resolveTrackedRateLimitUsage(requestContext);
      trackingStore.record({
        ...trackedRequest,
        outcome,
        ...(rateLimitUsage ? { rateLimit: rateLimitUsage } : {}),
      });

      const finalizedConsumer = createTransientConsumerEntity(requestActivity, {
        outcome,
        rateLimit: rateLimitUsage,
      });
      request.newsletterConsumer = replaceTrackedConsumerValue(
        request.newsletterConsumer,
        finalizedConsumer,
      );

      if (requestContext && typeof requestContext === "object") {
        requestContext.consumer = replaceTrackedConsumerValue(
          requestContext.consumer,
          finalizedConsumer,
        );
        requestContext.consumerActivity = request.newsletterConsumerActivity;
      }
    });

    return {
      requestContext: {
        consumer: request.newsletterConsumer,
        consumerActivity: requestActivity,
      },
    };
  };
}

export function createInMemoryConsumerTrackingStore() {
  const consumers = new Map();
  const consumerAliases = new Map();
  const ipAddresses = new Map();

  return {
    record({
      consumerId,
      identity,
      clientIp,
      ipAddress,
      method,
      route,
      seenAt,
      outcome = "successful",
      rateLimit,
    }) {
      const normalizedClientIp = normalizeTrackedClientIp(clientIp, ipAddress);
      const normalizedIdentity = normalizeTrackedIdentity(identity, {
        consumerId,
        clientIp: normalizedClientIp,
      });
      const existingRecord =
        findMatchingConsumerIdentityRecord([...consumers.values()], normalizedIdentity) ??
        findConsumerRecordByAlias(consumers, consumerAliases, consumerId);
      const nextRecord = mergeConsumerIdentityRecord(existingRecord, normalizedIdentity, seenAt, {
        method,
        path: route,
        outcome,
        rateLimit,
      });

      consumers.set(nextRecord.id, nextRecord);
      consumerAliases.set(
        nextRecord.id,
        mergeConsumerAliases(consumerAliases.get(nextRecord.id), nextRecord, consumerId),
      );

      const observedIpAddress = normalizedClientIp.ip;
      const ipRecord = ipAddresses.get(observedIpAddress) ?? createIpRecord(observedIpAddress, seenAt);
      ipRecord.lastSeenAt = seenAt;
      ipRecord.requestCount += 1;
      incrementOutcomeCounters(ipRecord, outcome);
      ipRecord.consumerIds.add(resolveLegacyConsumerId(nextRecord, consumerId));
      ipRecord.consumerEntityIds.add(nextRecord.id);
      ipAddresses.set(observedIpAddress, ipRecord);
    },

    getConsumer(consumerId) {
      const record =
        consumers.get(normalizeConsumerId(consumerId)) ??
        findConsumerRecordByAlias(consumers, consumerAliases, consumerId);

      return record ? serializeConsumerRecord(record) : null;
    },

    getIp(ipAddress) {
      const record = ipAddresses.get(normalizeIpAddress(ipAddress));
      return record ? serializeIpRecord(record) : null;
    },

    snapshot() {
      return {
        consumers: [...consumers.values()]
          .map((record) => serializeConsumerRecord(record))
          .sort((left, right) => left.consumerId.localeCompare(right.consumerId)),
        ipAddresses: [...ipAddresses.values()]
          .map((record) => serializeIpRecord(record))
          .sort((left, right) => left.ipAddress.localeCompare(right.ipAddress)),
      };
    },
  };
}

export function resolveConsumerId(request, consumerIdResolver = defaultConsumerIdResolver) {
  if (typeof consumerIdResolver !== "function") {
    throw new TypeError("consumerIdResolver must be a function");
  }

  return normalizeConsumerId(consumerIdResolver(request));
}

function resolveTrackingStore(store) {
  if (store == null) {
    return createInMemoryConsumerTrackingStore();
  }

  if (typeof store.record !== "function") {
    throw new TypeError("consumerTracking.store must expose record(entry)");
  }

  return store;
}

function resolveConsumerIdentityService({
  repository,
  service,
  now,
  trustProxy,
  consumerIdHeaders,
}) {
  if (service === false || repository === false) {
    return null;
  }

  if (service != null) {
    if (typeof service.recordRequest !== "function") {
      throw new TypeError("consumerTracking.service must expose recordRequest(request, context)");
    }

    return service;
  }

  if (repository == null) {
    return null;
  }

  return new ConsumerIdentityService({
    repository,
    now,
    trustProxy,
    ...(consumerIdHeaders ? { consumerIdHeaders } : {}),
  });
}

function defaultConsumerIdResolver(request) {
  return (
    readHeader(request?.headers, "x-newsletter-consumer") ??
    readHeader(request?.headers, "x-consumer-id") ??
    readHeader(request?.headers, "user-agent") ??
    DEFAULT_ANONYMOUS_CONSUMER_ID
  );
}

function resolveNow(now) {
  const value = now();

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function resolveRoute(request) {
  try {
    const url = new URL(request?.url ?? "/", "http://localhost");
    return url.pathname;
  } catch {
    return "/";
  }
}

function createTrackedConsumerActivity(
  request,
  {
    now,
    trustProxy = false,
    consumerIdHeaders,
  },
) {
  const seenAt = normalizeTimestamp(resolveNow(now), "consumerTracking.now");
  const method = String(request?.method ?? "GET").toUpperCase();
  const path = resolveRoute(request);
  const identity = resolveConsumerRequestIdentity(request, {
    trustProxy,
    ...(consumerIdHeaders ? { consumerIdHeaders } : {}),
  });

  return {
    seenAt,
    method,
    path,
    identity,
    clientIp: identity.clientIp,
  };
}

function createTransientConsumerEntity(
  requestActivity,
  { outcome = "successful", rateLimit } = {},
) {
  const {
    seenAt,
    method,
    path,
    identity: { id, identitySource, declaredId, fallbackIdentity, userAgent, clientIp },
  } = requestActivity;

  const rateLimitUsage = mergeRateLimitUsage(null, {
    seenAt,
    rateLimit,
  });
  const transientConsumer = {
    id,
    identitySource,
    declaredId,
    fallbackIdentity,
    userAgent,
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
    requestCount: 1,
    successfulRequestCount: outcome === "throttled" ? 0 : 1,
    throttledRequestCount: outcome === "throttled" ? 1 : 0,
    observedClientIps: [
      {
        address: clientIp.ip,
        source: clientIp.source,
        directIp: clientIp.directIp ?? null,
        forwardedChain: [...(clientIp.forwardedChain ?? [])],
        trustProxy: Boolean(clientIp.trustProxy),
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        requestCount: 1,
        successfulRequestCount: outcome === "throttled" ? 0 : 1,
        throttledRequestCount: outcome === "throttled" ? 1 : 0,
      },
    ],
    requestActivity: [
      {
        date: seenAt.slice(0, 10),
        firstRequestAt: seenAt,
        lastRequestAt: seenAt,
        requestCount: 1,
        successfulRequestCount: outcome === "throttled" ? 0 : 1,
        throttledRequestCount: outcome === "throttled" ? 1 : 0,
        methods: [method],
        paths: [path],
      },
    ],
    lastRequest: {
      at: seenAt,
      method,
      path,
      outcome,
    },
  };

  if (rateLimitUsage) {
    transientConsumer.rateLimitUsage = serializeRateLimitUsage(rateLimitUsage);
  }

  return transientConsumer;
}

function createIpRecord(ipAddress, seenAt) {
  return {
    ipAddress,
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
    requestCount: 0,
    successfulRequestCount: 0,
    throttledRequestCount: 0,
    consumerIds: new Set(),
    consumerEntityIds: new Set(),
  };
}

function serializeConsumerRecord(record) {
  const methods = collectRequestActivityValues(record.requestActivity, "methods");
  const routes = collectRequestActivityValues(record.requestActivity, "paths");
  const serializedRecord = {
    id: record.id,
    consumerId: resolveLegacyConsumerId(record),
    identitySource: record.identitySource,
    declaredId: record.declaredId,
    fallbackIdentity: record.fallbackIdentity == null ? null : { ...record.fallbackIdentity },
    userAgent: record.userAgent,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    requestCount: record.requestCount,
    successfulRequestCount: record.successfulRequestCount,
    throttledRequestCount: record.throttledRequestCount,
    ipAddresses: record.observedClientIps.map((entry) => entry.address).sort(),
    observedClientIps: record.observedClientIps.map((entry) => ({ ...entry })),
    methods,
    routes,
    requestActivity: record.requestActivity
      .map((entry) => ({
        ...entry,
        methods: [...entry.methods],
        paths: [...entry.paths],
      }))
      .sort(sortRequestActivity),
    lastRequest: record.lastRequest == null ? null : { ...record.lastRequest },
  };

  if (record.rateLimitUsage) {
    serializedRecord.rateLimitUsage = serializeRateLimitUsage(record.rateLimitUsage);
  }

  return serializedRecord;
}

function serializeIpRecord(record) {
  return {
    ipAddress: record.ipAddress,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    requestCount: record.requestCount,
    successfulRequestCount: record.successfulRequestCount,
    throttledRequestCount: record.throttledRequestCount,
    consumerIds: [...record.consumerIds].sort(),
    consumerEntityIds: [...record.consumerEntityIds].sort(),
  };
}

function normalizeConsumerId(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return DEFAULT_ANONYMOUS_CONSUMER_ID;
}

function normalizeIpAddress(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return "unknown";
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

function resolveTrackedRateLimitUsage(requestContext) {
  return normalizeTrackedRateLimit(requestContext?.rateLimit);
}

function attachConsumerTrackingFinalizer(request, finalize) {
  if (!request || typeof request !== "object" || typeof finalize !== "function") {
    return;
  }

  const previousFinalize =
    typeof request.newsletterFinalizeConsumerTracking === "function"
      ? request.newsletterFinalizeConsumerTracking
      : null;

  request.newsletterFinalizeConsumerTracking = async function finalizeConsumerTracking(context) {
    if (previousFinalize) {
      await previousFinalize(context);
    }

    await finalize(context);
  };
}

function resolveTrackedRequestOutcome({ requestContext, response }) {
  if (requestContext?.rateLimit?.limited === true || response?.status === 429) {
    return "throttled";
  }

  return "successful";
}

function incrementOutcomeCounters(record, outcome) {
  if (outcome === "throttled") {
    record.throttledRequestCount += 1;
    return;
  }

  record.successfulRequestCount += 1;
}

function replaceTrackedConsumerValue(currentValue, nextValue) {
  if (!currentValue || typeof currentValue !== "object" || Array.isArray(currentValue)) {
    return nextValue;
  }

  for (const key of Object.keys(currentValue)) {
    delete currentValue[key];
  }

  Object.assign(currentValue, nextValue);
  return currentValue;
}

function mergeRateLimitUsage(existingUsage, { seenAt, rateLimit } = {}) {
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
    keys: [...new Set([...(existingUsage?.keys ?? []), normalizedRateLimit.key])].sort(),
    lastDecision: {
      at: seenAt,
      ...normalizedRateLimit,
    },
  };
}

function normalizeTrackedRateLimit(rateLimit) {
  if (!rateLimit || typeof rateLimit !== "object" || Array.isArray(rateLimit)) {
    return null;
  }

  const key = normalizeIpAddress(rateLimit.key);
  const limit = normalizePositiveNumber(rateLimit.limit);
  const remaining = normalizeNonNegativeNumber(rateLimit.remaining);
  const resetAt = normalizePositiveNumber(rateLimit.resetAt);

  if (limit == null || remaining == null || resetAt == null) {
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

function serializeRateLimitUsage(rateLimitUsage) {
  return {
    evaluatedRequestCount: rateLimitUsage.evaluatedRequestCount,
    allowedRequestCount: rateLimitUsage.allowedRequestCount,
    blockedRequestCount: rateLimitUsage.blockedRequestCount,
    keys: [...rateLimitUsage.keys].sort(),
    lastDecision: {
      ...rateLimitUsage.lastDecision,
    },
  };
}

function normalizePositiveNumber(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

function normalizeNonNegativeNumber(value) {
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  return value;
}

function normalizeTrackedClientIp(clientIp, ipAddress) {
  if (clientIp && typeof clientIp === "object" && !Array.isArray(clientIp)) {
    return {
      ip: normalizeIpAddress(clientIp.ip ?? ipAddress),
      source: clientIp.source ?? "unknown",
      directIp: normalizeIpAddress(clientIp.directIp ?? clientIp.ip ?? ipAddress),
      forwardedChain: Array.isArray(clientIp.forwardedChain)
        ? clientIp.forwardedChain.map((value) => normalizeIpAddress(value))
        : [],
      trustProxy: Boolean(clientIp.trustProxy),
    };
  }

  const normalizedIp = normalizeIpAddress(ipAddress);

  return {
    ip: normalizedIp,
    source: "unknown",
    directIp: normalizedIp,
    forwardedChain: [],
    trustProxy: false,
  };
}

function normalizeTrackedIdentity(identity, { consumerId, clientIp }) {
  if (identity && typeof identity === "object" && !Array.isArray(identity)) {
    return identity;
  }

  const normalizedConsumerId = normalizeConsumerId(consumerId);
  const declaredId =
    normalizedConsumerId === DEFAULT_ANONYMOUS_CONSUMER_ID ? null : normalizedConsumerId;
  const fallbackIdentity = {
    source: "ip",
    value: clientIp.ip,
    observedValue: clientIp.ip,
  };

  return {
    id: declaredId ?? clientIp.ip,
    identitySource: declaredId == null ? "ip" : "consumer_header",
    declaredId,
    fallbackIdentity,
    userAgent: null,
    clientIp,
  };
}

function findConsumerRecordByAlias(consumers, consumerAliases, consumerId) {
  const normalizedConsumerId = normalizeConsumerId(consumerId);

  for (const [id, aliases] of consumerAliases) {
    if (aliases.has(normalizedConsumerId)) {
      return consumers.get(id) ?? null;
    }
  }

  return null;
}

function mergeConsumerAliases(existingAliases, record, consumerId) {
  const aliases = new Set(existingAliases ?? []);
  const nextAliases = [
    consumerId,
    record.id,
    record.declaredId,
    record.userAgent,
    record.fallbackIdentity?.value,
    record.fallbackIdentity?.observedValue,
  ];

  for (const alias of nextAliases) {
    if (typeof alias === "string" && alias.trim().length > 0) {
      aliases.add(alias.trim());
    }
  }

  return aliases;
}

function resolveLegacyConsumerId(record, fallbackConsumerId) {
  const preferredConsumerId =
    record?.declaredId ??
    record?.userAgent ??
    record?.fallbackIdentity?.observedValue ??
    record?.fallbackIdentity?.value ??
    fallbackConsumerId;

  return normalizeConsumerId(preferredConsumerId);
}

function collectRequestActivityValues(requestActivity, fieldName) {
  const values = new Set();

  for (const entry of requestActivity) {
    for (const value of entry[fieldName] ?? []) {
      values.add(value);
    }
  }

  return [...values].sort();
}

function sortRequestActivity(left, right) {
  const leftLastRequestAt = new Date(left.lastRequestAt).getTime();
  const rightLastRequestAt = new Date(right.lastRequestAt).getTime();

  if (rightLastRequestAt !== leftLastRequestAt) {
    return rightLastRequestAt - leftLastRequestAt;
  }

  return right.date.localeCompare(left.date);
}
