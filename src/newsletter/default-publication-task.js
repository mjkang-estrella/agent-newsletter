import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSourceRegistry } from "../core/adapters.js";
import { assertNonEmptyString } from "../core/contracts.js";
import { AggregationPipeline } from "../core/pipeline.js";
import { SourceDiscoveryService } from "../discovery/source-discovery-service.js";
import { SourceRepository } from "../discovery/source-repository.js";
import { createSourceAdapters } from "../sources/create-source-adapters.js";
import { WebDiscoverySourceAdapter } from "../sources/web-discovery-source-adapter.js";
import { NewsletterEditionStore } from "./edition-store.js";
import { ItemIdentityRepository } from "./item-identity-repository.js";
import { createPublicationFlow } from "./publication-flow.js";

export const NEWSLETTER_DATA_DIR_ENV_NAME = "NEWSLETTER_DATA_DIR";
export const DEFAULT_PUBLICATION_DATA_DIRECTORY = ".data";
export const DEFAULT_EDITIONS_DIRECTORY_NAME = "editions";
export const DEFAULT_SOURCE_REGISTRY_FILE_NAME = "source-registry.json";
export const DEFAULT_ITEM_IDENTITY_REGISTRY_FILE_NAME = "item-identity-registry.json";
export const DEFAULT_CONSUMER_IDENTITY_REGISTRY_FILE_NAME = "consumer-identities.json";
export const DEFAULT_PUBLICATION_TASK_MODULE_PATH = fileURLToPath(
  new URL("./default-publication-task.js", import.meta.url),
);

export function resolvePublicationRuntimePaths({
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const rootPath = assertNonEmptyString(cwd, "cwd");
  const dataDirectory = normalizeDataDirectory(
    env[NEWSLETTER_DATA_DIR_ENV_NAME] ?? DEFAULT_PUBLICATION_DATA_DIRECTORY,
  );
  const dataDirectoryPath = resolve(rootPath, dataDirectory);

  return Object.freeze({
    dataDirectoryPath,
    editionsDirectoryPath: join(dataDirectoryPath, DEFAULT_EDITIONS_DIRECTORY_NAME),
    sourceRegistryPath: join(dataDirectoryPath, DEFAULT_SOURCE_REGISTRY_FILE_NAME),
    itemIdentityRegistryPath: join(
      dataDirectoryPath,
      DEFAULT_ITEM_IDENTITY_REGISTRY_FILE_NAME,
    ),
    consumerIdentityRegistryPath: join(
      dataDirectoryPath,
      DEFAULT_CONSUMER_IDENTITY_REGISTRY_FILE_NAME,
    ),
  });
}

export function createDefaultPublicationTask({
  env = process.env,
  cwd = process.cwd(),
  now,
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

  const paths = resolvePublicationRuntimePaths({ env, cwd });
  const resolvedSourceRepository =
    sourceRepository ??
    new SourceRepository({
      filePath: paths.sourceRegistryPath,
    });
  const resolvedEditionStore =
    editionStore ??
    new NewsletterEditionStore({
      directoryPath: paths.editionsDirectoryPath,
    });
  const resolvedItemIdentityRepository =
    itemIdentityRepository ??
    new ItemIdentityRepository({
      filePath: paths.itemIdentityRegistryPath,
    });
  const resolvedSourceDiscoveryService =
    sourceDiscoveryService ??
    new SourceDiscoveryService({
      repository: resolvedSourceRepository,
    });
  const configuredAdapters = createAdapters(env, {
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
    env,
    ...(now ? { now } : {}),
  });

  return Object.freeze({
    paths,
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

export async function publishNewsletterEdition(options = {}) {
  return createDefaultPublicationTask(options).publishNewsletterEdition();
}

function normalizeDataDirectory(value) {
  return assertNonEmptyString(value, NEWSLETTER_DATA_DIR_ENV_NAME);
}
