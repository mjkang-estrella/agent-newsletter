import { createSourceRegistry } from "../core/adapters.js";
import { AggregationPipeline } from "../core/pipeline.js";
import { SourceDiscoveryService } from "../discovery/source-discovery-service.js";
import { createNewsletterApiHandler } from "../newsletter/api.js";
import { createPublicationFlow, createPublicationPlan } from "../newsletter/publication-flow.js";
import { createNewsletterRuntimeConfig } from "../newsletter/runtime-config.js";
import {
  getNextPublicationTime,
  resolvePublicationScheduleFromRuntimeConfig,
} from "../newsletter/publication-schedule.js";
import {
  resolveForcedPublicationFromEnv,
  resolveScheduledPublicationGraceMinutesFromEnv,
  runScheduledPublication,
  shouldPublishScheduledEdition,
} from "../newsletter/run-scheduled-publication.js";
import {
  API_RATE_LIMIT_TRUST_PROXY_ENV_NAME,
  resolveRateLimitConfigFromEnv,
} from "../newsletter/rate-limit.js";
import { createSourceAdapters } from "../sources/create-source-adapters.js";
import { WebDiscoverySourceAdapter } from "../sources/web-discovery-source-adapter.js";
import { createSupabaseAdminClient } from "./client.js";
import {
  InMemorySupabaseNewsletterDataStore,
  SupabaseNewsletterDataStore,
  createSerializedErrorRecord,
} from "./data-store.js";
import { SupabaseNewsletterEditionStore } from "./edition-store.js";
import { SupabaseItemIdentityRepository } from "./item-identity-repository.js";
import { SupabasePublicationRunRepository } from "./publication-runs.js";
import { createSupabaseConsumerTracker } from "./consumer-tracking.js";
import { createSupabaseRateLimiter } from "./rate-limit.js";
import { SupabaseSourceRepository } from "./source-repository.js";
import {
  resolveCronSecret,
  resolveNowTimestamp,
} from "./shared.js";

export function createSupabasePublicationTask({
  env = process.env,
  now,
  client,
  dataStore,
  createAdapters = createSourceAdapters,
  twitterClient = null,
  twitterClientFactory = null,
  twitterProviderHooks = null,
  webDiscoveryFetch = globalThis.fetch,
  pipeline = null,
  editionStore = null,
  sourceDiscoveryService = null,
  sourceRepository = null,
  itemIdentityRepository = null,
} = {}) {
  if (typeof createAdapters !== "function") {
    throw new TypeError("createAdapters must be a function");
  }

  if (now !== undefined && typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  const effectiveEnv = createSupabaseRuntimeEnv(env);
  const resolvedDataStore = resolveSupabaseDataStore({
    client,
    dataStore,
    env: effectiveEnv,
  });
  const resolvedSourceRepository =
    sourceRepository ??
    new SupabaseSourceRepository({
      dataStore: resolvedDataStore,
    });
  const resolvedEditionStore =
    editionStore ??
    new SupabaseNewsletterEditionStore({
      dataStore: resolvedDataStore,
    });
  const resolvedItemIdentityRepository =
    itemIdentityRepository ??
    new SupabaseItemIdentityRepository({
      dataStore: resolvedDataStore,
    });
  const resolvedSourceDiscoveryService =
    sourceDiscoveryService ??
    new SourceDiscoveryService({
      repository: resolvedSourceRepository,
    });
  const configuredAdapters = createAdapters(effectiveEnv, {
    twitterClient,
    twitterClientFactory,
    twitterProviderHooks,
  });
  const hasWebDiscoveryAdapter = Object.values(configuredAdapters).some(
    (adapter) => adapter?.descriptor?.id === "web-discovery" || adapter?.id === "web-discovery",
  );
  const resolvedPipeline =
    pipeline ??
    new AggregationPipeline({
      registry: createSourceRegistry([
        configuredAdapters,
        hasWebDiscoveryAdapter
          ? null
          : new WebDiscoverySourceAdapter({
              sourceRepository: resolvedSourceRepository,
              fetch: webDiscoveryFetch,
            }),
      ]),
      sourceRepository: resolvedSourceRepository,
      editionHistoryStore: resolvedEditionStore,
    });
  const flow = createPublicationFlow({
    pipeline: resolvedPipeline,
    editionStore: resolvedEditionStore,
    sourceDiscoveryService: resolvedSourceDiscoveryService,
    itemIdentityRepository: resolvedItemIdentityRepository,
    env: effectiveEnv,
    ...(now ? { now } : {}),
  });

  return Object.freeze({
    dataStore: resolvedDataStore,
    flow,
    pipeline: resolvedPipeline,
    editionStore: resolvedEditionStore,
    itemIdentityRepository: resolvedItemIdentityRepository,
    sourceDiscoveryService: resolvedSourceDiscoveryService,
    sourceRepository: resolvedSourceRepository,
    async publishNewsletterEdition() {
      return flow.publishEdition();
    },
  });
}

export function createSupabaseNewsletterApiHandler({
  env = process.env,
  now = () => new Date().toISOString(),
  client,
  dataStore,
  editionStore,
  sourceRepository,
  consumerTracker,
  rateLimiter,
} = {}) {
  const effectiveEnv = createSupabaseApiEnv(env);
  const resolvedDataStore = resolveSupabaseDataStore({
    client,
    dataStore,
    env: effectiveEnv,
  });
  const resolvedEditionStore =
    editionStore ??
    new SupabaseNewsletterEditionStore({
      dataStore: resolvedDataStore,
    });
  const resolvedSourceRepository =
    sourceRepository ??
    new SupabaseSourceRepository({
      dataStore: resolvedDataStore,
    });
  const rateLimitConfig = resolveRateLimitConfigFromEnv(effectiveEnv);

  return createNewsletterApiHandler({
    newsletterStore: resolvedEditionStore,
    sourceRepository: resolvedSourceRepository,
    env: effectiveEnv,
    now,
    consumerTracker:
      consumerTracker ??
      createSupabaseConsumerTracker({
        dataStore: resolvedDataStore,
        now,
        trustProxy: rateLimitConfig.trustProxy,
      }),
    rateLimiter:
      rateLimiter ??
      createSupabaseRateLimiter({
        dataStore: resolvedDataStore,
        maxRequests: rateLimitConfig.maxRequests,
        windowMs: rateLimitConfig.windowMs,
        now,
        trustProxy: rateLimitConfig.trustProxy,
      }),
  });
}

export function createSupabasePublicationRequestHandler({
  env = process.env,
  now = () => new Date().toISOString(),
  client,
  dataStore,
  runtime,
  publicationRunRepository,
  logInfo = (...args) => console.info(...args),
} = {}) {
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  if (typeof logInfo !== "function") {
    throw new TypeError("logInfo must be a function");
  }

  const effectiveEnv = createSupabaseRuntimeEnv(env);
  const resolvedDataStore = resolveSupabaseDataStore({
    client,
    dataStore,
    env: effectiveEnv,
  });
  const resolvedRuntime =
    runtime ??
    createSupabasePublicationTask({
      env: effectiveEnv,
      now,
      dataStore: resolvedDataStore,
    });
  const resolvedPublicationRunRepository =
    publicationRunRepository ??
    new SupabasePublicationRunRepository({
      dataStore: resolvedDataStore,
    });
  const cronSecret = resolveCronSecret(effectiveEnv);

  return async function handlePublicationRequest(request, response) {
    const result = await buildPublicationResponse({
      request,
      runtime: resolvedRuntime,
      publicationRunRepository: resolvedPublicationRunRepository,
      env: effectiveEnv,
      now,
      cronSecret,
      logInfo,
    });

    if (response) {
      sendResult(response, result);
      return;
    }

    return result;
  };
}

export function createSupabaseRuntimeEnv(env = process.env) {
  return {
    ...env,
    ...(env?.TWITTER_ENABLED == null ? { TWITTER_ENABLED: "true" } : {}),
  };
}

export function createSupabaseApiEnv(env = process.env) {
  return {
    ...createSupabaseRuntimeEnv(env),
    ...(env?.[API_RATE_LIMIT_TRUST_PROXY_ENV_NAME] == null
      ? {
          [API_RATE_LIMIT_TRUST_PROXY_ENV_NAME]: "true",
        }
      : {}),
  };
}

export function resolveSupabaseDataStore({
  client,
  dataStore,
  env = process.env,
  now = () => new Date().toISOString(),
} = {}) {
  if (dataStore) {
    return dataStore;
  }

  if (client) {
    return new SupabaseNewsletterDataStore({
      client,
      now,
    });
  }

  return new SupabaseNewsletterDataStore({
    client: createSupabaseAdminClient({
      env,
    }),
    now,
  });
}

export function createInMemorySupabaseRuntime({ now = () => new Date().toISOString() } = {}) {
  return new InMemorySupabaseNewsletterDataStore({
    now,
  });
}

async function buildPublicationResponse({
  request,
  runtime,
  publicationRunRepository,
  env,
  now,
  cronSecret,
  logInfo,
}) {
  const method = String(request?.method ?? "GET").toUpperCase();

  if (method !== "POST") {
    return createJsonResult(405, {
      ok: false,
      error: "method_not_allowed",
      message: "Use POST /api/internal/publish.",
    });
  }

  if (!requestHasAuthorizedSecret(request, cronSecret)) {
    return createJsonResult(401, {
      ok: false,
      error: "unauthorized",
      message: "Invalid or missing bearer token.",
    });
  }

  const normalizedNow = resolveNowTimestamp(now);
  const runtimeConfig = createNewsletterRuntimeConfig(env);
  const schedule = resolvePublicationScheduleFromRuntimeConfig(runtimeConfig);
  const graceMinutes = resolveScheduledPublicationGraceMinutesFromEnv(env);
  const forced = resolveForcedPublicationFromEnv(env);

  if (
    !forced &&
    !shouldPublishScheduledEdition({
      now: normalizedNow,
      schedule,
      graceMinutes,
    })
  ) {
    return createJsonResult(200, {
      ok: true,
      published: false,
      forced,
      next_run_at: getNextPublicationTime({
        now: normalizedNow,
        schedule,
        inclusive: true,
      }),
    });
  }

  const slot = createPublicationPlan({
    now: normalizedNow,
    schedule,
  }).publishedAt;
  const lock = await publicationRunRepository.tryStartRun({
    slot,
    startedAt: normalizedNow,
    forced,
  });

  if (!lock.acquired) {
    const existingEdition =
      (lock.record?.editionId
        ? await runtime.editionStore.getEditionById(lock.record.editionId)
        : null) ?? (await runtime.editionStore.getEditionByPublishedAt(slot));

    return createJsonResult(200, {
      ok: true,
      published: false,
      forced,
      ...(existingEdition
        ? {
            edition_id: existingEdition.id,
            published_at: existingEdition.publishedAt,
            item_count: existingEdition.items.length,
          }
        : {}),
    });
  }

  try {
    const outcome = await runScheduledPublication({
      env,
      now: () => normalizedNow,
      publish: () => runtime.publishNewsletterEdition(),
      runPublication: async ({ publish, logInfo: publicationLogInfo }) => {
        const edition = await publish();
        await publicationRunRepository.markCompleted({
          slot,
          editionId: edition.id,
          finishedAt: resolveNowTimestamp(now),
        });
        publicationLogInfo("Newsletter edition published.", {
          publishedAt: edition.publishedAt,
          itemCount: edition.items.length,
        });
        return edition;
      },
      logInfo,
    });

    if (!outcome.published) {
      return createJsonResult(200, {
        ok: true,
        published: false,
        forced,
        next_run_at: outcome.nextRunAt ?? null,
      });
    }

    return createJsonResult(200, {
      ok: true,
      published: true,
      forced,
      edition_id: outcome.edition.id,
      published_at: outcome.edition.publishedAt,
      item_count: outcome.edition.items.length,
    });
  } catch (error) {
    await publicationRunRepository.markFailed({
      slot,
      error: createSerializedErrorRecord(error),
      finishedAt: resolveNowTimestamp(now),
    });

    return createJsonResult(500, {
      ok: false,
      error: "publication_failed",
      message: error instanceof Error ? error.message : "Unexpected publication error.",
    });
  }
}

function requestHasAuthorizedSecret(request, cronSecret) {
  const authorization = readHeader(request?.headers, "authorization");
  return authorization === `Bearer ${cronSecret}`;
}

function readHeader(headers, name) {
  if (!headers || typeof headers !== "object") {
    return null;
  }

  if (typeof headers.get === "function") {
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? null;
  }

  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];

  if (Array.isArray(value)) {
    return value.join(",");
  }

  return typeof value === "string" ? value : null;
}

function createJsonResult(status, payload) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload, null, 2),
  };
}

function sendResult(response, result) {
  response.writeHead(result.status, result.headers);
  response.end(result.body);
}
