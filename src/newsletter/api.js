import { publicationFreshness } from "./publication-status.js";
import { createServer } from "node:http";

import { normalizeTimestamp } from "../core/contracts.js";
import { SourceRepository } from "../discovery/source-repository.js";
import {
  buildSourceCoverageMap,
  SOURCE_COVERAGE_STATUSES,
  resolveMinimumActiveCategorySources,
} from "../discovery/source-coverage.js";
import { formatNewsletterCoverageMapResponse } from "./coverage-map.js";
import { ConsumerIdentityRepository } from "./consumer-identity-repository.js";
import { createConsumerTracker } from "./consumer-tracking.js";
import { resolvePublicationRuntimePaths } from "./default-publication-task.js";
import { NewsletterEditionStore } from "./edition-store.js";
import { formatNewsletterExclusionAnalyticsResponse } from "./exclusion-analytics.js";
import { formatNewsletterExclusionReportResponse } from "./exclusion-report.js";
import {
  API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME,
  API_RATE_LIMIT_TRUST_PROXY_ENV_NAME,
  API_RATE_LIMIT_WINDOW_MS_ENV_NAME,
  createIpRateLimiter,
  resolveRateLimitConfigFromEnv,
} from "./rate-limit.js";
import {
  formatNewsletterArchiveResponse,
  serializeNewsletterEdition,
  serializeNewsletterItem,
  serializeNewsletterItemLifecycle,
  formatNewsletterStorylinesResponse,
  serializeNewsletterStorylineGroup,
} from "./edition.js";
import {
  buildNewsletterExclusionSummaryResult,
  formatNewsletterExclusionSummaryResponse,
} from "./exclusion-summary.js";
import {
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  createNewsletterScopeDefinition,
  formatNewsletterScopeDefinitionResponse,
} from "./scope-definition.js";
import { DEFAULT_ARCHIVE_WINDOW_DAYS } from "./schema.js";
import { buildItemLifecycleFromEditions } from "./item-lifecycle.js";
import { selectActiveStorylinesFromEditions } from "./storyline-index.js";

const LATEST_ROUTE = "/api/newsletter/latest";
const HISTORY_ROUTE = "/api/newsletter/history";
const ITEM_ROUTE_PREFIX = "/api/newsletter/item/";
const REFERENCE_ROUTE = "/api/newsletter/reference";
const STORYLINES_ROUTE = "/api/newsletter/storylines";
const SCOPE_ROUTE = "/api/newsletter/scope";
const EXCLUSIONS_ROUTE = "/api/newsletter/exclusions";
const EXCLUSION_ANALYTICS_ROUTE = "/api/newsletter/exclusions/analytics";
const EXCLUSION_REPORT_ROUTE = "/api/newsletter/exclusions/report";
const COVERAGE_MAP_ROUTE = "/api/newsletter/coverage-map";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export {
  formatNewsletterArchiveResponse,
  NEWSLETTER_ITEM_RESPONSE_SCHEMA,
  NEWSLETTER_ITEM_RESPONSE_SCHEMA_VERSION,
  REQUIRED_NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  formatNewsletterStorylinesResponse,
  serializeNewsletterEdition,
  serializeNewsletterItem,
  serializeNewsletterItemLifecycle,
  serializeNewsletterStorylineGroup,
  SUPPLEMENTAL_NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
} from "./edition.js";
export { formatNewsletterExclusionAnalyticsResponse } from "./exclusion-analytics.js";
export { formatNewsletterExclusionReportResponse } from "./exclusion-report.js";
export { formatNewsletterExclusionSummaryResponse } from "./exclusion-summary.js";
export { formatNewsletterCoverageMapResponse } from "./coverage-map.js";
export { formatNewsletterScopeDefinitionResponse } from "./scope-definition.js";

export function createNewsletterApiHandler(options = {}) {
  const config = createApiConfig(options);

  return async function handleNewsletterApiRequest(request, response) {
    const middlewareResult = await runRequestMiddleware(request, config.requestMiddlewares);
    const result =
      middlewareResult.response ??
      applyResponseHeaders(await buildApiResponse(request, config), middlewareResult.headers);
    await finalizeConsumerTracking(request, result);

    if (response) {
      sendApiResponse(response, result);
      return;
    }

    return result;
  };
}

export function createNewsletterApiServer(options = {}) {
  const handler = createNewsletterApiHandler(options);

  return createServer((request, response) => handler(request, response));
}

export function createDefaultNewsletterApiHandler(options = {}) {
  return createNewsletterApiHandler(resolveDefaultNewsletterApiOptions(options));
}

export function createDefaultNewsletterApiServer(options = {}) {
  return createNewsletterApiServer(resolveDefaultNewsletterApiOptions(options));
}

function createApiConfig({
  editionRepository,
  newsletterStore,
  sourceRepository,
  archiveWindowDays = DEFAULT_ARCHIVE_WINDOW_DAYS,
  scopeDefinition = CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  now = () => new Date().toISOString(),
  env = process.env,
  consumerTracking = {},
  consumerTracker,
  rateLimit = {},
  rateLimiter,
} = {}) {
  if (!Number.isInteger(archiveWindowDays) || archiveWindowDays <= 0) {
    throw new TypeError("archiveWindowDays must be a positive integer");
  }

  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  return {
    editionRepository: resolveEditionRepository({ editionRepository, newsletterStore }),
    sourceRepository: resolveSourceRepository(sourceRepository),
    archiveWindowDays,
    scopeDefinition: createNewsletterScopeDefinition(scopeDefinition),
    now,
    requestMiddlewares: resolveRequestMiddlewares({
      consumerTracking,
      consumerTracker,
      env,
      rateLimit,
      rateLimiter,
      now,
    }),
  };
}

function resolveRequestMiddlewares({
  consumerTracking,
  consumerTracker,
  env,
  rateLimit,
  rateLimiter,
  now,
}) {
  return [
    resolveConsumerTracker({ consumerTracking, consumerTracker, now }),
    resolveRateLimiter({ env, rateLimit, rateLimiter }),
  ].filter(Boolean);
}

function resolveConsumerTracker({ consumerTracking, consumerTracker, now }) {
  if (consumerTracker === false || consumerTracking === false) {
    return null;
  }

  if (consumerTracker != null) {
    if (typeof consumerTracker !== "function") {
      throw new TypeError("consumerTracker must be a function");
    }

    return consumerTracker;
  }

  if (consumerTracking == null) {
    return createConsumerTracker({ now });
  }

  if (typeof consumerTracking !== "object") {
    throw new TypeError("consumerTracking must be an object");
  }

  return createConsumerTracker({
    now,
    ...consumerTracking,
  });
}

function resolveDefaultNewsletterApiOptions({
  env = process.env,
  cwd = process.cwd(),
  editionRepository,
  newsletterStore,
  consumerTracking,
  sourceRepository,
  ...options
} = {}) {
  const paths = resolvePublicationRuntimePaths({ env, cwd });
  const resolvedNewsletterStore =
    editionRepository == null
      ? newsletterStore ??
        new NewsletterEditionStore({
          directoryPath: paths.editionsDirectoryPath,
        })
      : newsletterStore;

  return {
    ...options,
    env,
    ...(sourceRepository === undefined
      ? {
          sourceRepository: new SourceRepository({
            filePath: paths.sourceRegistryPath,
          }),
        }
      : {
          sourceRepository,
        }),
    ...(editionRepository ? { editionRepository } : {}),
    ...(editionRepository == null ? { newsletterStore: resolvedNewsletterStore } : {}),
    ...(consumerTracking === undefined
      ? {
          consumerTracking: {
            repository: new ConsumerIdentityRepository({
              filePath: paths.consumerIdentityRegistryPath,
            }),
          },
        }
      : {
          consumerTracking: resolveDefaultConsumerTracking({
            consumerTracking,
            paths,
          }),
        }),
  };
}

function resolveDefaultConsumerTracking({ consumerTracking, paths }) {
  if (consumerTracking === false) {
    return consumerTracking;
  }

  if (consumerTracking == null) {
    return {
      repository: new ConsumerIdentityRepository({
        filePath: paths.consumerIdentityRegistryPath,
      }),
    };
  }

  if (typeof consumerTracking !== "object") {
    return consumerTracking;
  }

  if (
    consumerTracking.repository != null ||
    consumerTracking.repository === false ||
    consumerTracking.service != null ||
    consumerTracking.service === false ||
    consumerTracking.store != null ||
    consumerTracking.consumerIdResolver != null
  ) {
    return consumerTracking;
  }

  return {
    repository: new ConsumerIdentityRepository({
      filePath: paths.consumerIdentityRegistryPath,
    }),
    ...consumerTracking,
  };
}

function resolveRateLimiter({ env, rateLimit, rateLimiter }) {
  if (rateLimiter === false || rateLimit === false) {
    return null;
  }

  if (rateLimiter != null) {
    if (typeof rateLimiter !== "function") {
      throw new TypeError("rateLimiter must be a function");
    }

    return rateLimiter;
  }

  if (rateLimit == null) {
    return createIpRateLimiter(resolveRateLimitConfigFromEnv(env));
  }

  if (typeof rateLimit !== "object") {
    throw new TypeError("rateLimit must be an object");
  }

  return createIpRateLimiter(resolveRateLimitOptions({ env, rateLimit }));
}

function resolveRateLimitOptions({ env, rateLimit }) {
  const envConfig = resolveRateLimitConfigFromEnv(
    pickRateLimitEnvOverrides(env, {
      maxRequests: hasOwnRateLimitOption(rateLimit, "maxRequests"),
      windowMs: hasOwnRateLimitOption(rateLimit, "windowMs"),
      trustProxy: hasOwnRateLimitOption(rateLimit, "trustProxy"),
    }),
  );

  return {
    ...envConfig,
    ...rateLimit,
  };
}

function pickRateLimitEnvOverrides(env, explicitOptions) {
  return {
    ...(explicitOptions.maxRequests
      ? {}
      : {
          [API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME]:
            env?.[API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME],
        }),
    ...(explicitOptions.windowMs
      ? {}
      : {
          [API_RATE_LIMIT_WINDOW_MS_ENV_NAME]: env?.[API_RATE_LIMIT_WINDOW_MS_ENV_NAME],
        }),
    ...(explicitOptions.trustProxy
      ? {}
      : {
          [API_RATE_LIMIT_TRUST_PROXY_ENV_NAME]:
            env?.[API_RATE_LIMIT_TRUST_PROXY_ENV_NAME],
        }),
  };
}

function hasOwnRateLimitOption(rateLimit, key) {
  return Object.prototype.hasOwnProperty.call(rateLimit, key);
}

async function runRequestMiddleware(request, requestMiddlewares) {
  let headers = null;
  const requestContext = ensureRequestPipelineContext(request);

  for (const middleware of requestMiddlewares) {
    const result = await middleware(request, requestContext);

    if (!result) {
      continue;
    }

    if ("requestContext" in result) {
      applyRequestContextUpdate(request, requestContext, result.requestContext);
    }

    if (result.headers) {
      headers = {
        ...(headers ?? {}),
        ...result.headers,
      };
    }

    if (result.response) {
      return {
        headers,
        response: applyResponseHeaders(result.response, headers),
      };
    }
  }

  return { headers };
}

async function finalizeConsumerTracking(request, response) {
  if (!request || typeof request !== "object") {
    return;
  }

  const finalize =
    typeof request.newsletterFinalizeConsumerTracking === "function"
      ? request.newsletterFinalizeConsumerTracking
      : null;

  if (!finalize) {
    return;
  }

  request.newsletterFinalizeConsumerTracking = null;
  await finalize({
    requestContext: ensureRequestPipelineContext(request),
    response,
  });
}

async function buildApiResponse(request, config) {
  try {
    const method = String(request?.method ?? "GET").toUpperCase();
    const url = new URL(request?.url ?? "/", "http://localhost");
    const generatedAt = normalizeTimestamp(resolveNow(config.now), "now");
    const requestPipelineContext = ensureRequestPipelineContext(request);
    const requestContext = {
      now: generatedAt,
      consumer: cloneConsumerRequestContextValue(
        requestPipelineContext.consumer ?? request?.newsletterConsumer ?? null,
      ),
    };
    const itemId = matchItemRoute(url.pathname);

    if (url.pathname === LATEST_ROUTE) {
      if (method !== "GET") {
        return createJsonResponse(405, {
          error: "method_not_allowed",
          message: "Use GET /api/newsletter/latest.",
        });
      }

      const latestEdition =
        await config.editionRepository.getLatestPublishedEdition(requestContext);

      if (!latestEdition) {
        return createJsonResponse(404, {
          error: "not_found",
          message: "No published newsletter edition is available.",
        });
      }

      return createJsonResponse(
        200,
        { ...serializeNewsletterEdition(latestEdition, {
          scopeVersionFallback: config.scopeDefinition.currentVersion,
        }), freshness: publicationFreshness(latestEdition, generatedAt) },
      );
    }

    if (url.pathname === HISTORY_ROUTE) {
      if (method !== "GET") {
        return createJsonResponse(405, {
          error: "method_not_allowed",
          message: "Use GET /api/newsletter/history.",
        });
      }

      const editions = await config.editionRepository.listPublishedEditions({
        ...requestContext,
        days: config.archiveWindowDays,
      });

      return createJsonResponse(
        200,
        formatNewsletterArchiveResponse({
          archiveWindowDays: config.archiveWindowDays,
          generatedAt,
          editions,
          scopeVersionFallback: config.scopeDefinition.currentVersion,
        }),
      );
    }

    if (url.pathname === EXCLUSIONS_ROUTE) {
      if (method !== "GET") {
        return createJsonResponse(405, {
          error: "method_not_allowed",
          message: "Use GET /api/newsletter/exclusions.",
        });
      }

      const summary = await queryExclusionSummary(config.editionRepository, {
        ...requestContext,
        ...readExclusionAnalyticsQuery(url, config.archiveWindowDays),
      });

      return createJsonResponse(200, formatNewsletterExclusionSummaryResponse(summary));
    }

    if (url.pathname === EXCLUSION_ANALYTICS_ROUTE) {
      if (method !== "GET") {
        return createJsonResponse(405, {
          error: "method_not_allowed",
          message: "Use GET /api/newsletter/exclusions/analytics.",
        });
      }

      const analytics = await queryExclusionAnalytics(config.editionRepository, {
        ...requestContext,
        ...readExclusionAnalyticsQuery(url, config.archiveWindowDays),
      });

      return createJsonResponse(200, formatNewsletterExclusionAnalyticsResponse(analytics));
    }

    if (url.pathname === EXCLUSION_REPORT_ROUTE) {
      if (method !== "GET") {
        return createJsonResponse(405, {
          error: "method_not_allowed",
          message: "Use GET /api/newsletter/exclusions/report.",
        });
      }

      const report = await queryExclusionReport(config.editionRepository, {
        ...requestContext,
        ...readExclusionAnalyticsQuery(url, config.archiveWindowDays),
      });

      return createJsonResponse(200, formatNewsletterExclusionReportResponse(report));
    }

    if (url.pathname === STORYLINES_ROUTE) {
      if (method !== "GET") {
        return createJsonResponse(405, {
          error: "method_not_allowed",
          message: "Use GET /api/newsletter/storylines.",
        });
      }

      const storylines = await listActiveStorylines(config.editionRepository, {
        ...requestContext,
      });

      return createJsonResponse(
        200,
        formatNewsletterStorylinesResponse({
          generatedAt,
          storylines,
          scopeVersionFallback: config.scopeDefinition.currentVersion,
        }),
      );
    }

    if (url.pathname === SCOPE_ROUTE) {
      if (method !== "GET") {
        return createJsonResponse(405, {
          error: "method_not_allowed",
          message: "Use GET /api/newsletter/scope.",
        });
      }

      return createJsonResponse(
        200,
        formatNewsletterScopeDefinitionResponse({
          generatedAt,
          scopeDefinition: config.scopeDefinition,
        }),
      );
    }

    if (url.pathname === COVERAGE_MAP_ROUTE) {
      if (method !== "GET") {
        return createJsonResponse(405, {
          error: "method_not_allowed",
          message: "Use GET /api/newsletter/coverage-map.",
        });
      }

      return createJsonResponse(
        200,
        await queryCoverageMap(config.sourceRepository, {
          now: generatedAt,
        }),
      );
    }

    if (itemId != null) {
      if (method !== "GET") {
        return createJsonResponse(405, {
          error: "method_not_allowed",
          message: "Use GET /api/newsletter/item/:id.",
        });
      }

      const lifecycle = await getItemLifecycle(config.editionRepository, {
        itemId,
        ...requestContext,
      });

      if (!lifecycle) {
        return createJsonResponse(404, {
          error: "not_found",
          message: "No published newsletter item is available for the requested id.",
        });
      }

      return createJsonResponse(
        200,
        serializeNewsletterItemLifecycle(lifecycle, {
          scopeVersionFallback: config.scopeDefinition.currentVersion,
        }),
      );
    }

    if (url.pathname === REFERENCE_ROUTE) {
      if (method !== "GET") {
        return createJsonResponse(405, {
          error: "method_not_allowed",
          message: "Use GET /api/newsletter/reference.",
        });
      }

      const referenceItems = await listReferenceItems(config.editionRepository, {
        ...requestContext,
        days: config.archiveWindowDays,
        underrepresentedCategories: await listUnderrepresentedReferenceCategories(
          config.sourceRepository,
        ),
      });

      return createJsonResponse(200, {
        archive_window_days: config.archiveWindowDays,
        generated_at: generatedAt,
        item_count: referenceItems.length,
        items: referenceItems.map((item) =>
          serializeNewsletterItem(item, {
            scopeVersionFallback: config.scopeDefinition.currentVersion,
          }),
        ),
      });
    }

    return createJsonResponse(404, {
      error: "not_found",
      message: "Route not found.",
    });
  } catch (error) {
    return createJsonResponse(500, {
      error: "internal_server_error",
      message: error instanceof Error ? error.message : "Unexpected server error.",
    });
  }
}

function cloneConsumerRequestContextValue(consumer) {
  if (!consumer || typeof consumer !== "object" || Array.isArray(consumer)) {
    return consumer ?? null;
  }

  return {
    ...consumer,
  };
}

function ensureRequestPipelineContext(request) {
  if (!request || typeof request !== "object") {
    return {};
  }

  if (
    !request.newsletterRequestContext ||
    typeof request.newsletterRequestContext !== "object" ||
    Array.isArray(request.newsletterRequestContext)
  ) {
    request.newsletterRequestContext = {};
  }

  return request.newsletterRequestContext;
}

function applyRequestContextUpdate(request, requestContext, update) {
  const normalizedUpdate = normalizeRequestContextUpdate(update);

  if (!normalizedUpdate) {
    return;
  }

  Object.assign(requestContext, normalizedUpdate);

  if (!request || typeof request !== "object") {
    return;
  }

  if ("consumer" in normalizedUpdate && request.newsletterConsumer == null) {
    request.newsletterConsumer = normalizedUpdate.consumer;
  }

  if ("consumerActivity" in normalizedUpdate) {
    request.newsletterConsumerActivity = normalizedUpdate.consumerActivity;
  }

  if ("rateLimit" in normalizedUpdate) {
    request.newsletterRateLimit = normalizedUpdate.rateLimit;
  }
}

function normalizeRequestContextUpdate(update) {
  if (update == null) {
    return null;
  }

  if (typeof update !== "object" || Array.isArray(update)) {
    return {
      consumer: update,
    };
  }

  if ("consumer" in update || "consumerActivity" in update || "rateLimit" in update) {
    return update;
  }

  return {
    consumer: update,
  };
}

function resolveEditionRepository({ editionRepository, newsletterStore }) {
  if (editionRepository) {
    return normalizeEditionRepository(editionRepository, {
      label: "editionRepository",
      allowStoreAdapter: true,
    });
  }

  if (newsletterStore) {
    return normalizeEditionRepository(newsletterStore, {
      label: "newsletterStore",
      allowStoreAdapter: true,
    });
  }

  throw new TypeError(
    "createNewsletterApiHandler requires either an editionRepository or newsletterStore",
  );
}

function resolveSourceRepository(sourceRepository) {
  if (sourceRepository == null || sourceRepository === false) {
    return null;
  }

  if (typeof sourceRepository.load !== "function") {
    throw new TypeError("sourceRepository must expose load({ now })");
  }

  return sourceRepository;
}

function normalizeEditionRepository(repositoryLike, { label, allowStoreAdapter = false }) {
  if (
    typeof repositoryLike.listPublishedEditions === "function" &&
    typeof repositoryLike.getLatestPublishedEdition === "function"
  ) {
    if (
      "listReferenceItems" in repositoryLike &&
      typeof repositoryLike.listReferenceItems !== "function"
    ) {
      throw new TypeError(`${label}.listReferenceItems must be a function`);
    }

    if (
      "getItemLifecycle" in repositoryLike &&
      typeof repositoryLike.getItemLifecycle !== "function"
    ) {
      throw new TypeError(`${label}.getItemLifecycle must be a function`);
    }

    if (
      "listActiveStorylines" in repositoryLike &&
      typeof repositoryLike.listActiveStorylines !== "function"
    ) {
      throw new TypeError(`${label}.listActiveStorylines must be a function`);
    }

    if (
      "queryExclusionAnalytics" in repositoryLike &&
      typeof repositoryLike.queryExclusionAnalytics !== "function"
    ) {
      throw new TypeError(`${label}.queryExclusionAnalytics must be a function`);
    }

    if (
      "queryExclusionSummary" in repositoryLike &&
      typeof repositoryLike.queryExclusionSummary !== "function"
    ) {
      throw new TypeError(`${label}.queryExclusionSummary must be a function`);
    }

    if (
      "queryExclusionReport" in repositoryLike &&
      typeof repositoryLike.queryExclusionReport !== "function"
    ) {
      throw new TypeError(`${label}.queryExclusionReport must be a function`);
    }

    return repositoryLike;
  }

  if (allowStoreAdapter) {
    return createEditionRepositoryFromStore(repositoryLike, { label });
  }

  throw new TypeError(
    `${label} must expose listPublishedEditions() and getLatestPublishedEdition()`,
  );
}

function createEditionRepositoryFromStore(newsletterStore, { label }) {
  if (typeof newsletterStore.loadLatest !== "function") {
    throw new TypeError(
      label === "editionRepository"
        ? "editionRepository must expose listPublishedEditions() and getLatestPublishedEdition(), or loadLatest() and loadHistory()"
        : "newsletterStore must expose loadLatest({ now })",
    );
  }

  return {
    getLatestPublishedEdition({ now }) {
      return newsletterStore.loadLatest({ now });
    },

    listPublishedEditions({ now, days }) {
      if (typeof newsletterStore.loadHistory !== "function") {
        throw new TypeError(
          label === "editionRepository"
            ? "editionRepository must expose listPublishedEditions() and getLatestPublishedEdition(), or loadLatest() and loadHistory()"
            : "newsletterStore must expose loadHistory({ now, days })",
        );
      }

      return newsletterStore.loadHistory({ now, days });
    },

    ...(typeof newsletterStore.loadReferenceItems === "function"
      ? {
          listReferenceItems({ now, days, underrepresentedCategories }) {
            return newsletterStore.loadReferenceItems({
              now,
              days,
              underrepresentedCategories,
            });
          },
        }
      : {}),
    ...(typeof newsletterStore.loadItemLifecycle === "function"
      ? {
          getItemLifecycle({ itemId, now }) {
            return newsletterStore.loadItemLifecycle({ itemId, now });
          },
        }
      : {}),
    ...(typeof newsletterStore.loadActiveStorylines === "function"
      ? {
          listActiveStorylines({ now }) {
            return newsletterStore.loadActiveStorylines({ now });
          },
        }
      : {}),
    ...(typeof newsletterStore.loadExclusionAnalytics === "function"
      ? {
          queryExclusionAnalytics({
            now,
            days,
            from,
            to,
            reason,
            category,
            sourceKind,
            adapterId,
            itemId,
            phase,
            minRecurringEditions,
          }) {
            return newsletterStore.loadExclusionAnalytics({
              now,
              days,
              from,
              to,
              reason,
              category,
              sourceKind,
              adapterId,
              itemId,
              phase,
              minRecurringEditions,
            });
          },
        }
      : {}),
    ...(typeof newsletterStore.loadExclusionSummary === "function"
      ? {
          queryExclusionSummary({
            now,
            days,
            from,
            to,
            reason,
            category,
            sourceKind,
            adapterId,
            itemId,
            phase,
            minRecurringEditions,
          }) {
            return newsletterStore.loadExclusionSummary({
              now,
              days,
              from,
              to,
              reason,
              category,
              sourceKind,
              adapterId,
              itemId,
              phase,
              minRecurringEditions,
            });
          },
        }
      : {}),
    ...(typeof newsletterStore.loadExclusionReport === "function"
      ? {
          queryExclusionReport({
            now,
            days,
            from,
            to,
            reason,
            category,
            sourceKind,
            adapterId,
            itemId,
            phase,
            minRecurringEditions,
          }) {
            return newsletterStore.loadExclusionReport({
              now,
              days,
              from,
              to,
              reason,
              category,
              sourceKind,
              adapterId,
              itemId,
              phase,
              minRecurringEditions,
            });
          },
        }
      : {}),
  };
}

function createJsonResponse(status, payload) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload, null, 2),
  };
}

function applyResponseHeaders(result, extraHeaders) {
  if (!extraHeaders || Object.keys(extraHeaders).length === 0) {
    return result;
  }

  return {
    ...result,
    headers: {
      ...result.headers,
      ...extraHeaders,
    },
  };
}

function sendApiResponse(response, result) {
  response.writeHead(result.status, result.headers);
  response.end(result.body);
}

function resolveNow(now) {
  const value = now();

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

async function listReferenceItems(
  editionRepository,
  {
    now,
    days,
    consumer = null,
    underrepresentedCategories = [],
  },
) {
  if (typeof editionRepository.listReferenceItems !== "function") {
    throw new TypeError(
      "editionRepository must expose listReferenceItems({ now, days }) to serve GET /api/newsletter/reference",
    );
  }

  return editionRepository.listReferenceItems({
    now,
    days,
    consumer,
    underrepresentedCategories,
  });
}

async function listUnderrepresentedReferenceCategories(sourceRepository) {
  if (!sourceRepository || typeof sourceRepository.load !== "function") {
    return [];
  }

  try {
    const snapshot = await sourceRepository.load();
    return buildSourceCoverageMap(snapshot?.sources ?? [], sourceRepository.config)
      .filter((topic) => topic.coverageStatus === SOURCE_COVERAGE_STATUSES.underrepresented)
      .map((topic) => topic.topicArea);
  } catch {
    return [];
  }
}

async function getItemLifecycle(editionRepository, { itemId, now, consumer = null }) {
  if (typeof editionRepository.getItemLifecycle === "function") {
    return editionRepository.getItemLifecycle({ itemId, now, consumer });
  }

  if (typeof editionRepository.listPublishedEditions === "function") {
    const editions = await editionRepository.listPublishedEditions({
      now,
      days: resolveLifecycleFallbackDays(now),
      consumer,
    });

    return buildItemLifecycleFromEditions(editions, itemId);
  }

  throw new TypeError(
    "editionRepository must expose getItemLifecycle({ itemId, now }) or listPublishedEditions({ now, days }) to serve GET /api/newsletter/item/:id",
  );
}

function resolveLifecycleFallbackDays(now) {
  const nowMs = new Date(now).getTime();

  if (!Number.isFinite(nowMs)) {
    throw new TypeError("now must be a valid timestamp");
  }

  return Math.max(1, Math.ceil(nowMs / DAY_IN_MS) + 1);
}

async function listActiveStorylines(editionRepository, { now, consumer = null }) {
  if (typeof editionRepository.listActiveStorylines === "function") {
    return editionRepository.listActiveStorylines({ now, consumer });
  }

  if (typeof editionRepository.listPublishedEditions === "function") {
    const editions = await editionRepository.listPublishedEditions({
      now,
      days: resolveLifecycleFallbackDays(now),
      consumer,
    });

    return selectActiveStorylinesFromEditions(editions, { now });
  }

  throw new TypeError(
    "editionRepository must expose listActiveStorylines({ now }) or listPublishedEditions({ now, days }) to serve GET /api/newsletter/storylines",
  );
}

async function queryExclusionSummary(
  editionRepository,
  {
    now,
    days,
    from,
    to,
    reason,
    category,
    sourceKind,
    adapterId,
    itemId,
    phase,
    minRecurringEditions,
    consumer = null,
  },
) {
  if (typeof editionRepository.queryExclusionSummary === "function") {
    return editionRepository.queryExclusionSummary({
      now,
      days,
      from,
      to,
      reason,
      category,
      sourceKind,
      adapterId,
      itemId,
      phase,
      minRecurringEditions,
      consumer,
    });
  }

  if (typeof editionRepository.queryExclusionAnalytics === "function") {
    return buildNewsletterExclusionSummaryResult(
      await editionRepository.queryExclusionAnalytics({
        now,
        days,
        from,
        to,
        reason,
        category,
        sourceKind,
        adapterId,
        itemId,
        phase,
        minRecurringEditions,
        consumer,
      }),
    );
  }

  throw new TypeError(
    "editionRepository must expose queryExclusionSummary({ now, days, from, to, reason, category, sourceKind, adapterId, itemId, phase }) or queryExclusionAnalytics({ now, days, from, to, reason, category, sourceKind, adapterId, itemId, phase, minRecurringEditions }) to serve GET /api/newsletter/exclusions",
  );
}

async function queryExclusionAnalytics(
  editionRepository,
  {
    now,
    days,
    from,
    to,
    reason,
    category,
    sourceKind,
    adapterId,
    itemId,
    phase,
    minRecurringEditions,
    consumer = null,
  },
) {
  if (typeof editionRepository.queryExclusionAnalytics !== "function") {
    throw new TypeError(
      "editionRepository must expose queryExclusionAnalytics({ now, days, from, to, reason, category, sourceKind, adapterId, itemId, phase, minRecurringEditions }) to serve GET /api/newsletter/exclusions/analytics",
    );
  }

  return editionRepository.queryExclusionAnalytics({
    now,
    days,
    from,
    to,
    reason,
    category,
    sourceKind,
    adapterId,
    itemId,
    phase,
    minRecurringEditions,
    consumer,
  });
}

async function queryExclusionReport(
  editionRepository,
  {
    now,
    days,
    from,
    to,
    reason,
    category,
    sourceKind,
    adapterId,
    itemId,
    phase,
    minRecurringEditions,
    consumer = null,
  },
) {
  if (typeof editionRepository.queryExclusionReport !== "function") {
    throw new TypeError(
      "editionRepository must expose queryExclusionReport({ now, days, from, to, reason, category, sourceKind, adapterId, itemId, phase, minRecurringEditions }) to serve GET /api/newsletter/exclusions/report",
    );
  }

  return editionRepository.queryExclusionReport({
    now,
    days,
    from,
    to,
    reason,
    category,
    sourceKind,
    adapterId,
    itemId,
    phase,
    minRecurringEditions,
    consumer,
  });
}

async function queryCoverageMap(sourceRepository, { now }) {
  if (!sourceRepository || typeof sourceRepository.load !== "function") {
    throw new TypeError(
      "sourceRepository must expose load({ now }) to serve GET /api/newsletter/coverage-map",
    );
  }

  const snapshot = await sourceRepository.load({ now });
  const config = sourceRepository.config ?? {};

  return formatNewsletterCoverageMapResponse({
    generatedAt: now,
    minimumActiveSourceCount: resolveMinimumActiveCategorySources(config),
    coverageMap: buildSourceCoverageMap(snapshot?.sources ?? [], config),
  });
}

function matchItemRoute(pathname) {
  if (!pathname.startsWith(ITEM_ROUTE_PREFIX)) {
    return null;
  }

  const encodedItemId = pathname.slice(ITEM_ROUTE_PREFIX.length);

  if (encodedItemId.length === 0 || encodedItemId.includes("/")) {
    return null;
  }

  try {
    return decodeURIComponent(encodedItemId);
  } catch {
    return null;
  }
}

function readExclusionAnalyticsQuery(url, defaultDays) {
  const { searchParams } = url;

  return {
    days: readOptionalPositiveInteger(searchParams, "days") ?? defaultDays,
    from: readOptionalString(searchParams, "from"),
    to: readOptionalString(searchParams, "to"),
    reason:
      readOptionalString(searchParams, "reason_code") ??
      readOptionalString(searchParams, "reason"),
    category: readOptionalString(searchParams, "category"),
    sourceKind: readOptionalString(searchParams, "source_kind"),
    adapterId: readOptionalString(searchParams, "adapter_id"),
    itemId: readOptionalString(searchParams, "item_id"),
    phase: readOptionalString(searchParams, "phase"),
    minRecurringEditions:
      readOptionalPositiveInteger(searchParams, "min_recurring_editions") ?? 2,
  };
}

function readOptionalString(searchParams, name) {
  const raw = searchParams.get(name);

  if (raw == null) {
    return null;
  }

  const value = raw.trim();
  return value.length === 0 ? null : value;
}

function readOptionalPositiveInteger(searchParams, name) {
  const raw = readOptionalString(searchParams, name);

  if (raw == null) {
    return null;
  }

  const value = Number.parseInt(raw, 10);

  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }

  return value;
}
