import {
  ArxivSourceAdapter,
  DEFAULT_ARXIV_BASE_URL,
  DEFAULT_ARXIV_MAX_RESULTS,
  DEFAULT_ARXIV_USER_AGENT,
} from "./arxiv-source-adapter.js";
import {
  DEFAULT_GITHUB_API_BASE_URL,
  DEFAULT_GITHUB_RATE_LIMIT_MAX_RETRIES,
  DEFAULT_GITHUB_RATE_LIMIT_RETRY_AFTER_MS,
  DEFAULT_GITHUB_SEARCH_TERMS,
  DEFAULT_GITHUB_TRENDING_SINCE,
  DEFAULT_GITHUB_USER_AGENT,
  DEFAULT_GITHUB_WEB_BASE_URL,
  GitHubSourceAdapter,
} from "./github-source-adapter.js";
import {
  DEFAULT_AGENT_SUBREDDITS,
  DEFAULT_REDDIT_RATE_LIMIT_MAX_RETRIES,
  DEFAULT_REDDIT_RATE_LIMIT_RETRY_AFTER_MS,
  DEFAULT_REDDIT_USER_AGENT,
  RedditSourceAdapter,
} from "./reddit-source-adapter.js";
import {
  DEFAULT_TWITTER_BASE_URL,
  DEFAULT_TWITTER_MAX_RESULTS,
  DEFAULT_TWITTER_PROVIDER,
  DEFAULT_TWITTER_QUERY,
  TwitterSourceAdapter,
} from "./twitter-source-adapter.js";

function readBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function readList(value, fallback = []) {
  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSourceConnectorKey(value) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    throw new TypeError("source connector key must be a non-empty string");
  }

  return normalized;
}

function normalizeSourceConnectorConfig(value, key) {
  if (value == null) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`source connector "${key}" config must be an object`);
  }

  return value;
}

function isSourceConnectorDefinition(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.createAdapter === "function" &&
      (typeof value.key === "string" || typeof value.id === "string"),
  );
}

function isIterableCollection(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !isSourceConnectorDefinition(value) &&
    typeof value[Symbol.iterator] === "function"
  );
}

function collectSourceConnectorDefinitions(input, collected = []) {
  if (input == null) {
    return collected;
  }

  if (Array.isArray(input)) {
    for (const entry of input) {
      collectSourceConnectorDefinitions(entry, collected);
    }

    return collected;
  }

  if (isIterableCollection(input)) {
    for (const entry of input) {
      collectSourceConnectorDefinitions(entry, collected);
    }

    return collected;
  }

  if (isSourceConnectorDefinition(input)) {
    collected.push(defineSourceConnector(input));
    return collected;
  }

  if (typeof input === "object") {
    for (const entry of Object.values(input)) {
      collectSourceConnectorDefinitions(entry, collected);
    }

    return collected;
  }

  throw new TypeError(
    "source connectors must be definitions, arrays, iterables, or keyed definition objects",
  );
}

function resolveSourceConnectorDefinitions(overrides = {}) {
  const definitions = new Map();

  for (const definition of collectSourceConnectorDefinitions([
    DEFAULT_SOURCE_CONNECTOR_DEFINITIONS,
    overrides.sourceConnectors,
    overrides.sourceConnectorDefinitions,
    overrides.additionalSourceConnectors,
    overrides.additionalSourceConnectorDefinitions,
  ])) {
    definitions.delete(definition.key);
    definitions.set(definition.key, definition);
  }

  return [...definitions.values()];
}

export function defineSourceConnector(input = {}) {
  const key = normalizeSourceConnectorKey(input.key ?? input.id);
  const createConfig = input.createConfig ?? (() => ({}));
  const createAdapter = input.createAdapter;

  if (typeof createConfig !== "function") {
    throw new TypeError(`source connector "${key}" must expose createConfig(env, overrides)`);
  }

  if (typeof createAdapter !== "function") {
    throw new TypeError(`source connector "${key}" must expose createAdapter(config, context)`);
  }

  return Object.freeze({
    key,
    createConfig,
    createAdapter,
  });
}

export const DEFAULT_SOURCE_CONNECTOR_DEFINITIONS = Object.freeze([
  defineSourceConnector({
    key: "arxiv",
    createConfig(env = process.env, overrides = {}) {
      return {
        enabled: readBoolean(env.ARXIV_ENABLED, true),
        baseUrl: env.ARXIV_BASE_URL ?? DEFAULT_ARXIV_BASE_URL,
        userAgent: env.ARXIV_USER_AGENT ?? DEFAULT_ARXIV_USER_AGENT,
        query: env.ARXIV_QUERY ?? undefined,
        maxResults: env.ARXIV_MAX_RESULTS ?? DEFAULT_ARXIV_MAX_RESULTS,
        fetch: overrides.arxivFetch ?? globalThis.fetch,
      };
    },
    createAdapter(config) {
      return new ArxivSourceAdapter(config);
    },
  }),
  defineSourceConnector({
    key: "github",
    createConfig(env = process.env, overrides = {}) {
      return {
        enabled: readBoolean(env.GITHUB_ENABLED, true),
        apiBaseUrl: env.GITHUB_API_BASE_URL ?? DEFAULT_GITHUB_API_BASE_URL,
        webBaseUrl: env.GITHUB_WEB_BASE_URL ?? DEFAULT_GITHUB_WEB_BASE_URL,
        userAgent: env.GITHUB_USER_AGENT ?? DEFAULT_GITHUB_USER_AGENT,
        searchTerms: readList(env.GITHUB_SEARCH_TERMS, DEFAULT_GITHUB_SEARCH_TERMS),
        trendingSince: env.GITHUB_TRENDING_SINCE ?? DEFAULT_GITHUB_TRENDING_SINCE,
        includeTrending: readBoolean(env.GITHUB_INCLUDE_TRENDING, true),
        searchLimit: env.GITHUB_SEARCH_LIMIT,
        githubToken: env.GITHUB_TOKEN ?? "",
        rateLimitMaxRetries:
          env.GITHUB_RATE_LIMIT_MAX_RETRIES ?? DEFAULT_GITHUB_RATE_LIMIT_MAX_RETRIES,
        rateLimitRetryAfterMs:
          env.GITHUB_RATE_LIMIT_RETRY_AFTER_MS ??
          DEFAULT_GITHUB_RATE_LIMIT_RETRY_AFTER_MS,
        fetch: overrides.githubFetch ?? globalThis.fetch,
        sleep: overrides.githubSleep,
      };
    },
    createAdapter(config) {
      return new GitHubSourceAdapter(config);
    },
  }),
  defineSourceConnector({
    key: "reddit",
    createConfig(env = process.env, overrides = {}) {
      return {
        enabled: readBoolean(env.REDDIT_ENABLED, true),
        userAgent: env.REDDIT_USER_AGENT ?? DEFAULT_REDDIT_USER_AGENT,
        subreddits: readList(env.REDDIT_SUBREDDITS, DEFAULT_AGENT_SUBREDDITS),
        baseUrl: env.REDDIT_BASE_URL,
        accessToken: env.REDDIT_ACCESS_TOKEN ?? "",
        rateLimitMaxRetries:
          env.REDDIT_RATE_LIMIT_MAX_RETRIES ?? DEFAULT_REDDIT_RATE_LIMIT_MAX_RETRIES,
        rateLimitRetryAfterMs:
          env.REDDIT_RATE_LIMIT_RETRY_AFTER_MS ??
          DEFAULT_REDDIT_RATE_LIMIT_RETRY_AFTER_MS,
        fetch: overrides.redditFetch ?? globalThis.fetch,
        sleep: overrides.redditSleep,
      };
    },
    createAdapter(config) {
      return new RedditSourceAdapter(config);
    },
  }),
  defineSourceConnector({
    key: "twitter",
    createConfig(env = process.env, overrides = {}) {
      return {
        enabled: readBoolean(env.TWITTER_ENABLED, false),
        client: overrides.twitterClient ?? null,
        clientFactory: overrides.twitterClientFactory ?? null,
        fetch: overrides.twitterFetch ?? globalThis.fetch,
        provider: env.TWITTER_PROVIDER ?? DEFAULT_TWITTER_PROVIDER,
        baseUrl: env.TWITTER_BASE_URL ?? DEFAULT_TWITTER_BASE_URL,
        query: env.TWITTER_QUERY ?? DEFAULT_TWITTER_QUERY,
        maxResults: env.TWITTER_MAX_RESULTS ?? DEFAULT_TWITTER_MAX_RESULTS,
        bearerToken: env.TWITTER_BEARER_TOKEN ?? "",
        apiKey: env.TWITTER_API_KEY ?? "",
        apiSecret: env.TWITTER_API_SECRET ?? "",
        accountId: env.TWITTER_ACCOUNT_ID ?? "",
        rateLimitMaxRetries: env.TWITTER_RATE_LIMIT_MAX_RETRIES,
        rateLimitRetryAfterMs: env.TWITTER_RATE_LIMIT_RETRY_AFTER_MS,
        providerHooks: overrides.twitterProviderHooks ?? {},
      };
    },
    createAdapter(config) {
      return new TwitterSourceAdapter(config);
    },
  }),
]);

export function createSourceAdapterConfigs(
  env = process.env,
  overrides = {},
  connectorDefinitions = resolveSourceConnectorDefinitions(overrides),
) {
  return Object.freeze(
    Object.fromEntries(
      connectorDefinitions.map((definition) => [
        definition.key,
        normalizeSourceConnectorConfig(
          definition.createConfig(env, overrides, {
            definition,
            connectorDefinitions,
          }),
          definition.key,
        ),
      ]),
    ),
  );
}

export function createSourceAdapters(env = process.env, overrides = {}) {
  const connectorDefinitions = resolveSourceConnectorDefinitions(overrides);
  const sourceConfigs = createSourceAdapterConfigs(env, overrides, connectorDefinitions);

  return Object.fromEntries(
    connectorDefinitions.map((definition) => [
      definition.key,
      definition.createAdapter(sourceConfigs[definition.key], {
        env,
        overrides,
        definition,
        connectorDefinitions,
        sourceConfigs,
      }),
    ]),
  );
}
