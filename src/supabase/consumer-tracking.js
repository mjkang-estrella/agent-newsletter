import { normalizeTimestamp } from "../core/contracts.js";
import {
  DEFAULT_CONSUMER_ID_HEADERS,
  resolveConsumerRequestIdentity,
} from "../newsletter/consumer-identity-service.js";

export function createSupabaseConsumerTracker({
  dataStore,
  now = () => new Date().toISOString(),
  trustProxy = false,
  consumerIdHeaders = DEFAULT_CONSUMER_ID_HEADERS,
} = {}) {
  if (!dataStore || typeof dataStore.insertConsumerEvent !== "function") {
    throw new TypeError("dataStore must expose insertConsumerEvent(event)");
  }

  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  if (!Array.isArray(consumerIdHeaders) || consumerIdHeaders.length === 0) {
    throw new TypeError("consumerIdHeaders must be a non-empty array");
  }

  return async function trackConsumerRequest(request) {
    const seenAt = normalizeTimestamp(resolveNow(now), "now");
    const identity = resolveConsumerRequestIdentity(request, {
      trustProxy,
      consumerIdHeaders,
    });
    const method = String(request?.method ?? "GET").toUpperCase();
    const path = resolvePathname(request?.url);
    const consumerActivity = {
      seenAt,
      method,
      path,
      identity,
      clientIp: identity.clientIp,
    };
    const consumer = {
      id: identity.id,
      identitySource: identity.identitySource,
      declaredId: identity.declaredId ?? null,
      fallbackIdentity: identity.fallbackIdentity,
      userAgent: identity.userAgent,
      observedClientIps: [
        {
          address: identity.clientIp.ip,
          source: identity.clientIp.source,
          directIp: identity.clientIp.directIp ?? null,
          forwardedChain: [...(identity.clientIp.forwardedChain ?? [])],
          trustProxy: Boolean(identity.clientIp.trustProxy),
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          requestCount: 1,
          successfulRequestCount: 0,
          throttledRequestCount: 0,
        },
      ],
    };

    request.newsletterConsumer = consumer;
    request.newsletterConsumerActivity = consumerActivity;
    request.newsletterFinalizeConsumerTracking = async ({ requestContext, response }) => {
      try {
        await dataStore.insertConsumerEvent({
          occurredAt: normalizeTimestamp(resolveNow(now), "occurredAt"),
          consumerId: identity.id,
          identitySource: identity.identitySource,
          declaredId: identity.declaredId ?? null,
          userAgent: identity.userAgent ?? null,
          clientIp: identity.clientIp.ip,
          method,
          path,
          outcome: response?.status === 429 ? "throttled" : "successful",
          rateLimit: requestContext?.rateLimit ?? null,
          metadata: {
            fallbackIdentity: identity.fallbackIdentity,
            clientIp: identity.clientIp,
            responseStatus: response?.status ?? null,
          },
        });
      } catch {
        // Consumer telemetry must never break the API response path.
      }
    };

    return {
      requestContext: {
        consumer,
        consumerActivity,
      },
    };
  };
}

function resolveNow(now) {
  const value = now();
  return value instanceof Date ? value.toISOString() : value;
}

function resolvePathname(url) {
  const parsedUrl = new URL(url ?? "/", "http://localhost");
  return parsedUrl.pathname;
}
