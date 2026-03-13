import { AggregationPipeline } from "../core/pipeline.js";
import { createFetchWindow } from "../core/content-fetcher.js";
import { SourceRegistry } from "../core/adapters.js";
import { createNewsletterRuntimeConfig } from "../newsletter/runtime-config.js";
import { resolvePublicationRuntimePaths } from "../newsletter/default-publication-task.js";
import { createSourceAdapters } from "../sources/create-source-adapters.js";
import { WebDiscoverySourceAdapter } from "../sources/web-discovery-source-adapter.js";
import { SourceDiscoveryService } from "./source-discovery-service.js";
import { SourceRepository } from "./source-repository.js";

export function createDefaultSourceDiscoveryTask({
  env = process.env,
  cwd = process.cwd(),
  now,
  createAdapters = createSourceAdapters,
  twitterClient = null,
  twitterClientFactory = null,
  twitterProviderHooks = null,
  webDiscoveryFetch = globalThis.fetch,
  pipeline = null,
  sourceDiscoveryService = null,
  sourceRepository = null,
} = {}) {
  if (typeof createAdapters !== "function") {
    throw new TypeError("createAdapters must be a function");
  }

  if (now !== undefined && typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  if (pipeline && typeof pipeline.aggregate !== "function") {
    throw new TypeError("pipeline must expose aggregate(window)");
  }

  const paths = resolvePublicationRuntimePaths({ env, cwd });
  const runtimeConfig = createNewsletterRuntimeConfig(env);
  const resolvedSourceRepository =
    sourceRepository ??
    new SourceRepository({
      filePath: paths.sourceRegistryPath,
    });
  const resolvedSourceDiscoveryService =
    sourceDiscoveryService ??
    new SourceDiscoveryService({
      repository: resolvedSourceRepository,
    });
  const configuredAdapters = Object.values(
    createAdapters(env, {
      twitterClient,
      twitterClientFactory,
      twitterProviderHooks,
    }),
  ).filter((adapter) => adapter?.enabled !== false);
  const hasWebDiscoveryAdapter = configuredAdapters.some(
    (adapter) => adapter?.descriptor?.id === "web-discovery" || adapter?.id === "web-discovery",
  );
  const resolvedPipeline =
    pipeline ??
    new AggregationPipeline({
      registry: new SourceRegistry([
        ...configuredAdapters,
        ...(
          hasWebDiscoveryAdapter
            ? []
            : [
                new WebDiscoverySourceAdapter({
                  sourceRepository: resolvedSourceRepository,
                  fetch: webDiscoveryFetch,
                }),
              ]
        ),
      ]),
      sourceRepository: resolvedSourceRepository,
    });

  return Object.freeze({
    paths,
    pipeline: resolvedPipeline,
    sourceDiscoveryService: resolvedSourceDiscoveryService,
    sourceRepository: resolvedSourceRepository,
    async discoverSources({ window } = {}) {
      const normalizedWindow =
        window == null
          ? createFetchWindow({
              endsAt: resolveNow(now),
              timezone: runtimeConfig.publication.baseTimezone,
            })
          : createFetchWindow({
              timezone: runtimeConfig.publication.baseTimezone,
              ...window,
            });
      const aggregated = await resolvedPipeline.aggregate(normalizedWindow);
      const discovery = await resolvedSourceDiscoveryService.discoverFromItems(
        aggregated.fetchedItems ?? aggregated.items ?? [],
        {
          now: normalizedWindow.endsAt,
          cycleId: buildDiscoveryCycleId(
            normalizedWindow.endsAt,
            runtimeConfig.publication.baseTimezone,
          ),
          scoredItems: aggregated.scoredItems ?? aggregated.items ?? [],
          discoveredSources: aggregated.discoveredSources ?? [],
        },
      );

      return {
        ...discovery,
        window: normalizedWindow,
        aggregated,
        items: aggregated.items ?? [],
        fetchedItems: aggregated.fetchedItems ?? aggregated.items ?? [],
        curationDecisions: aggregated.curationDecisions ?? [],
        fetchReports: aggregated.fetchReports ?? [],
        fetchVerification: aggregated.fetchVerification ?? null,
      };
    },
  });
}

export async function discoverNewsletterSources(options = {}) {
  return createDefaultSourceDiscoveryTask(options).discoverSources();
}

function resolveNow(now) {
  const value = typeof now === "function" ? now() : new Date().toISOString();

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function buildDiscoveryCycleId(timestamp, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}
