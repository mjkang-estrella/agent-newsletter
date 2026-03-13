import {
  SourceAdapterConfigurationError,
  SourceAdapterNotImplementedError,
  normalizeFetchWindow,
} from "./source-adapter.js";

export const TWITTER_PROVIDER_INTERFACE_VERSION = 1;
export const DEFAULT_TWITTER_PROVIDER = "twitter-api-v2";
export const DEFAULT_TWITTER_BASE_URL = "https://api.x.com/2";
export const DEFAULT_TWITTER_QUERY =
  '("AI agent" OR "agentic" OR "autonomous agent") (tool OR API OR library OR framework OR SDK)';
export const DEFAULT_TWITTER_MAX_RESULTS = 25;
export const DEFAULT_TWITTER_ADAPTER_ID = "x-twitter";
export const DEFAULT_TWITTER_ADAPTER_NAME = "X/Twitter";
export const DEFAULT_TWITTER_USER_AGENT =
  "agent-newsletter/0.1 (+https://example.invalid/agent-newsletter)";
export const DEFAULT_TWITTER_RATE_LIMIT_MAX_RETRIES = 0;
export const DEFAULT_TWITTER_RATE_LIMIT_RETRY_AFTER_MS = 60_000;

const TWITTER_AUTHORITY_SCORE = 72;
const TWITTER_CONFIG_META = Symbol("twitterProviderConfigMeta");
const TWITTER_PLACEHOLDER_PATTERNS = [
  /^\[configured\]$/iu,
  /^placeholder$/iu,
  /^change[-_ ]?me$/iu,
  /^replace[-_ ]?me$/iu,
  /^your[-_ ]?(bearer|token|api|secret|key|credential)s?$/iu,
  /^<[^>]+>$/u,
  /^\$\{[^}]+\}$/u,
];

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fieldName, fallback = undefined) {
  if (value == null) {
    return fallback ?? "";
  }

  const normalized = String(value).trim();

  if (normalized) {
    return normalized;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new SourceAdapterConfigurationError(
    `X/Twitter config field "${fieldName}" must be a non-empty string.`,
  );
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/u, "");
}

function normalizeMaxResults(value) {
  if (value == null || value === "") {
    return DEFAULT_TWITTER_MAX_RESULTS;
  }

  const normalized = Number(value);

  if (!Number.isFinite(normalized)) {
    throw new SourceAdapterConfigurationError(
      "X/Twitter config field `maxResults` must be numeric.",
    );
  }

  return Math.max(1, Math.min(100, Math.trunc(normalized)));
}

function normalizeNonNegativeInteger(value, fieldName, fallback) {
  if (value == null || value === "") {
    return fallback;
  }

  const normalized = Number(value);

  if (!Number.isFinite(normalized)) {
    throw new SourceAdapterConfigurationError(
      `X/Twitter config field \`${fieldName}\` must be numeric.`,
    );
  }

  return Math.max(0, Math.trunc(normalized));
}

function isPlaceholderValue(value) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return false;
  }

  return TWITTER_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeCredentialValue(value, fieldName) {
  const normalized = normalizeString(value, fieldName, "");
  return isPlaceholderValue(normalized) ? "" : normalized;
}

function placeholderFieldsForConfig(input = {}) {
  return [
    ["bearerToken", input.bearerToken],
    ["apiKey", input.apiKey],
    ["apiSecret", input.apiSecret],
    ["accountId", input.accountId],
  ]
    .filter(([, value]) => isPlaceholderValue(value))
    .map(([field]) => field);
}

function getPlaceholderFields(config = {}) {
  const placeholderFields = config?.[TWITTER_CONFIG_META]?.placeholderFields;
  return Array.isArray(placeholderFields)
    ? [...placeholderFields]
    : placeholderFieldsForConfig(config);
}

export function createTwitterProviderConfig(input = {}) {
  const config = {
    provider: normalizeString(
      input.provider,
      "provider",
      DEFAULT_TWITTER_PROVIDER,
    ),
    baseUrl: trimTrailingSlash(
      normalizeString(input.baseUrl, "baseUrl", DEFAULT_TWITTER_BASE_URL),
    ),
    query: normalizeString(input.query, "query", DEFAULT_TWITTER_QUERY),
    maxResults: normalizeMaxResults(input.maxResults),
    bearerToken: normalizeCredentialValue(input.bearerToken, "bearerToken"),
    apiKey: normalizeCredentialValue(input.apiKey, "apiKey"),
    apiSecret: normalizeCredentialValue(input.apiSecret, "apiSecret"),
    accountId: normalizeCredentialValue(input.accountId, "accountId"),
    rateLimitMaxRetries: normalizeNonNegativeInteger(
      input.rateLimitMaxRetries,
      "rateLimitMaxRetries",
      DEFAULT_TWITTER_RATE_LIMIT_MAX_RETRIES,
    ),
    rateLimitRetryAfterMs: normalizeNonNegativeInteger(
      input.rateLimitRetryAfterMs,
      "rateLimitRetryAfterMs",
      DEFAULT_TWITTER_RATE_LIMIT_RETRY_AFTER_MS,
    ),
  };

  Object.defineProperty(config, TWITTER_CONFIG_META, {
    value: Object.freeze({
      placeholderFields: Object.freeze(placeholderFieldsForConfig(input)),
    }),
    enumerable: false,
  });

  return Object.freeze(config);
}

export function getTwitterCredentialStatus(config) {
  const normalizedConfig = createTwitterProviderConfig(config);
  const placeholderFields = getPlaceholderFields(config);
  const hasBearerToken = Boolean(normalizedConfig.bearerToken);
  const hasKeyPair = Boolean(
    normalizedConfig.apiKey && normalizedConfig.apiSecret,
  );

  if (hasBearerToken) {
    return {
      configured: true,
      missing: [],
      authStrategy: "bearer-token",
      ...(placeholderFields.length > 0
        ? { placeholders: placeholderFields }
        : {}),
    };
  }

  if (hasKeyPair) {
    return {
      configured: true,
      missing: [],
      authStrategy: "api-key-secret",
      ...(placeholderFields.length > 0
        ? { placeholders: placeholderFields }
        : {}),
    };
  }

  return {
    configured: false,
    missing: ["bearerToken or apiKey/apiSecret"],
    authStrategy: placeholderFields.length > 0 ? "placeholder" : "missing",
    ...(placeholderFields.length > 0
      ? { placeholders: placeholderFields }
      : {}),
  };
}

export function validateTwitterProviderConfig(config) {
  const normalizedConfig = createTwitterProviderConfig(config);
  const status = getTwitterCredentialStatus(normalizedConfig);

  if (!status.configured) {
    throw new SourceAdapterConfigurationError(
      'X/Twitter adapter requires either `bearerToken` or both `apiKey` and `apiSecret`.',
    );
  }

  return status;
}

function normalizeHook(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value !== "function") {
    throw new SourceAdapterConfigurationError(
      `X/Twitter provider hook \`${fieldName}\` must be a function when provided.`,
    );
  }

  return value;
}

export function createTwitterProviderHooks(input = {}) {
  if (!isObject(input)) {
    throw new SourceAdapterConfigurationError(
      "X/Twitter provider hooks must be an object when provided.",
    );
  }

  return Object.freeze({
    buildAuthHeaders: normalizeHook(input.buildAuthHeaders, "buildAuthHeaders"),
    beforeRequest: normalizeHook(input.beforeRequest, "beforeRequest"),
    afterResponse: normalizeHook(input.afterResponse, "afterResponse"),
    onRateLimit: normalizeHook(input.onRateLimit, "onRateLimit"),
  });
}

export function createTwitterProviderContract({
  adapterId = DEFAULT_TWITTER_ADAPTER_ID,
  adapterName = DEFAULT_TWITTER_ADAPTER_NAME,
  config = {},
  hooks = {},
} = {}) {
  const normalizedConfig = createTwitterProviderConfig(config);
  const credentialStatus = getTwitterCredentialStatus(normalizedConfig);
  const normalizedHooks = createTwitterProviderHooks(hooks);

  return Object.freeze({
    interfaceVersion: TWITTER_PROVIDER_INTERFACE_VERSION,
    adapterId: normalizeString(adapterId, "adapterId"),
    adapterName: normalizeString(adapterName, "adapterName"),
    provider: normalizedConfig.provider,
    config: normalizedConfig,
    auth: Object.freeze({
      configured: credentialStatus.configured,
      strategy: credentialStatus.authStrategy,
      missing: Object.freeze([...(credentialStatus.missing ?? [])]),
      placeholders: Object.freeze([...(credentialStatus.placeholders ?? [])]),
      accountId: normalizedConfig.accountId || null,
    }),
    rateLimit: Object.freeze({
      maxRetries: normalizedConfig.rateLimitMaxRetries,
      defaultRetryAfterMs: normalizedConfig.rateLimitRetryAfterMs,
    }),
    hooks: normalizedHooks,
  });
}

export function buildTwitterRequestPlan(config, { since, until } = {}) {
  const normalizedConfig = createTwitterProviderConfig(config);
  const status = validateTwitterProviderConfig(normalizedConfig);
  const window = normalizeFetchWindow({ since, until });

  return {
    interfaceVersion: TWITTER_PROVIDER_INTERFACE_VERSION,
    provider: normalizedConfig.provider,
    authStrategy: status.authStrategy,
    auth: {
      strategy: status.authStrategy,
      accountId: normalizedConfig.accountId || null,
    },
    rateLimit: {
      maxRetries: normalizedConfig.rateLimitMaxRetries,
      defaultRetryAfterMs: normalizedConfig.rateLimitRetryAfterMs,
    },
    method: "GET",
    url: `${normalizedConfig.baseUrl}/tweets/search/recent`,
    params: {
      query: normalizedConfig.query,
      start_time: window.since.toISOString(),
      end_time: window.until.toISOString(),
      max_results: normalizedConfig.maxResults,
      expansions: "author_id,entities.mentions.username",
      "tweet.fields":
        "created_at,conversation_id,public_metrics,lang,entities,possibly_sensitive,referenced_tweets",
      "user.fields": "name,username,verified,public_metrics",
    },
    headers: {
      authorization: normalizedConfig.bearerToken
        ? "Bearer [configured]"
        : undefined,
      "x-api-key": normalizedConfig.apiKey ? "[configured]" : undefined,
    },
    accountId: normalizedConfig.accountId || null,
  };
}

export function createTwitterProviderRequestContext({
  adapterId = DEFAULT_TWITTER_ADAPTER_ID,
  adapterName = DEFAULT_TWITTER_ADAPTER_NAME,
  requestPlan,
  providerContract = null,
} = {}) {
  if (!requestPlan || typeof requestPlan !== "object" || Array.isArray(requestPlan)) {
    throw new SourceAdapterConfigurationError(
      "X/Twitter provider requests require a requestPlan object.",
    );
  }

  if (
    providerContract != null &&
    (!isObject(providerContract) || Array.isArray(providerContract))
  ) {
    throw new SourceAdapterConfigurationError(
      "X/Twitter provider requests require providerContract to be an object when provided.",
    );
  }

  const inferredAuthStrategy =
    requestPlan.auth?.strategy ??
    requestPlan.authStrategy ??
    providerContract?.auth?.strategy ??
    "missing";
  const inferredAuthConfigured =
    inferredAuthStrategy !== "missing" && inferredAuthStrategy !== "placeholder";

  const auth = isObject(requestPlan.auth)
    ? {
        configured:
          typeof requestPlan.auth.configured === "boolean"
            ? requestPlan.auth.configured
            : providerContract?.auth?.configured ?? inferredAuthConfigured,
        strategy:
          requestPlan.auth.strategy ?? inferredAuthStrategy,
        accountId:
          requestPlan.auth.accountId ??
          requestPlan.accountId ??
          providerContract?.auth?.accountId ??
          null,
      }
    : {
        configured: providerContract?.auth?.configured ?? inferredAuthConfigured,
        strategy: inferredAuthStrategy,
        accountId:
          requestPlan.accountId ?? providerContract?.auth?.accountId ?? null,
      };
  const rateLimit = isObject(requestPlan.rateLimit)
    ? {
        maxRetries:
          requestPlan.rateLimit.maxRetries ??
          providerContract?.rateLimit?.maxRetries ??
          DEFAULT_TWITTER_RATE_LIMIT_MAX_RETRIES,
        defaultRetryAfterMs:
          requestPlan.rateLimit.defaultRetryAfterMs ??
          providerContract?.rateLimit?.defaultRetryAfterMs ??
          DEFAULT_TWITTER_RATE_LIMIT_RETRY_AFTER_MS,
      }
    : {
        maxRetries:
          providerContract?.rateLimit?.maxRetries ??
          DEFAULT_TWITTER_RATE_LIMIT_MAX_RETRIES,
        defaultRetryAfterMs:
          providerContract?.rateLimit?.defaultRetryAfterMs ??
          DEFAULT_TWITTER_RATE_LIMIT_RETRY_AFTER_MS,
      };

  return Object.freeze({
    interfaceVersion: TWITTER_PROVIDER_INTERFACE_VERSION,
    adapterId: normalizeString(adapterId, "adapterId"),
    adapterName: normalizeString(adapterName, "adapterName"),
    provider: requestPlan.provider ?? providerContract?.provider ?? DEFAULT_TWITTER_PROVIDER,
    auth: Object.freeze(auth),
    rateLimit: Object.freeze(rateLimit),
    requestPlan,
    ...(providerContract ? { providerContract } : {}),
  });
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMetric(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function truncateText(value, maxLength) {
  const normalized = normalizeText(value);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength + 1);
  const lastBoundary = Math.max(
    truncated.lastIndexOf(" "),
    truncated.lastIndexOf(":"),
    truncated.lastIndexOf("-"),
  );

  return `${truncated.slice(0, lastBoundary > 32 ? lastBoundary : maxLength).trim()}...`;
}

function extractTwitterUrls(tweet) {
  const entityUrls = Array.isArray(tweet?.entities?.urls) ? tweet.entities.urls : [];
  const urls = [];

  for (const entry of entityUrls) {
    const candidate = entry?.expanded_url ?? entry?.unwound_url ?? entry?.url ?? null;

    if (typeof candidate !== "string") {
      continue;
    }

    try {
      const url = new URL(candidate);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        continue;
      }

      urls.push(url.toString());
    } catch {}
  }

  return [...new Set(urls)];
}

function extractHashtags(tweet) {
  const entities = Array.isArray(tweet?.entities?.hashtags)
    ? tweet.entities.hashtags
    : [];

  return [
    ...new Set(
      entities
        .map((entry) => normalizeText(entry?.tag ?? ""))
        .filter(Boolean)
        .map((tag) => tag.toLowerCase()),
    ),
  ];
}

function stripTwitterUrls(text, urls) {
  let normalized = normalizeText(text);

  for (const url of urls) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalized = normalized.replace(new RegExp(escaped, "giu"), " ");
  }

  return normalizeText(normalized.replace(/https:\/\/t\.co\/\S+/giu, " "));
}

function buildTweetSummary(tweet, outboundUrls) {
  const summary = stripTwitterUrls(tweet?.text ?? "", outboundUrls);
  return truncateText(summary || normalizeText(tweet?.text ?? ""), 600);
}

function buildTweetTitle(summary) {
  if (!summary) {
    return "Untitled X Post";
  }

  const [sentence] = summary.split(/(?<=[.!?])\s+/u);
  return truncateText(sentence || summary, 120);
}

function categorizeTweet({ title, summary, outboundUrls, hashtags }) {
  const haystack = [title, summary, ...outboundUrls, ...hashtags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(api|sdk|endpoint|rest|graphql|webhook)\b/u.test(haystack)) {
    return "api";
  }

  if (/\b(library|framework|package|npm|gem|crate|repo|github|sdk)\b/u.test(haystack)) {
    return "library";
  }

  if (/\b(benchmark|technique|pattern|guide|tutorial|workflow|paper)\b/u.test(haystack)) {
    return "technique";
  }

  return "tool";
}

function deriveTwitterIntegrationHint(category) {
  if (category === "api") {
    return "Review the linked API docs and auth model, then validate quotas and failure modes before wiring it into an agent.";
  }

  if (category === "library") {
    return "Inspect the linked repository and install path before adding it to an agent runtime.";
  }

  if (category === "technique") {
    return "Reproduce the technique in a small agent workflow before adopting it broadly.";
  }

  return "Follow the linked docs or repository, then validate the tool in a narrow agent workflow before rollout.";
}

function inferTwitterSentiment(summary) {
  const haystack = summary.toLowerCase();

  if (
    /\b(broken|buggy|unsafe|malware|scam|concern|regression|fails?|failure|vulnerability)\b/u.test(
      haystack,
    )
  ) {
    return "negative";
  }

  if (
    /\b(launch(?:ed)?|release(?:d)?|available|live|open[- ]source(?:d)?|shipp(?:ed|ing)|new)\b/u.test(
      haystack,
    )
  ) {
    return "positive";
  }

  return null;
}

function scoreTwitterAuthority(user) {
  const followers = normalizeMetric(user?.public_metrics?.followers_count);
  let authority = TWITTER_AUTHORITY_SCORE;

  if (user?.verified) {
    authority += 8;
  }

  if (followers >= 100_000) {
    authority += 8;
  } else if (followers >= 10_000) {
    authority += 5;
  } else if (followers >= 1_000) {
    authority += 2;
  }

  return Math.min(90, authority);
}

function buildTwitterRiskWarning(tweet, outboundUrls) {
  if (tweet?.possibly_sensitive) {
    return {
      severity: "high",
      description:
        "Marked potentially sensitive by X. Review the post and linked assets before any automated ingestion.",
    };
  }

  if (outboundUrls.length === 0) {
    return {
      severity: "medium",
      description:
        "The post has no external links. Verify claims against primary sources before integrating anything from it.",
    };
  }

  return {
    severity: "low",
    description:
      "Social posts can amplify marketing claims. Validate the linked docs or repository before integrating it.",
  };
}

function buildTwitterTags({ hashtags, author }) {
  return [
    "twitter",
    "ai-agents",
    ...hashtags,
    ...(author ? [`author:${author.toLowerCase()}`] : []),
  ];
}

function buildTwitterSourceUrl(tweet, author) {
  const handle = author?.username ? author.username : "i/web";
  return `https://x.com/${handle}/status/${tweet.id}`;
}

function normalizeTwitterApiTweet(tweet, { author, requestContext, window }) {
  if (!isObject(tweet)) {
    throw new SourceAdapterConfigurationError(
      "X/Twitter provider returned a tweet that is not an object.",
      {
        requestPlan: requestContext.requestPlan,
      },
    );
  }

  const publishedAt = new Date(tweet.created_at);

  if (Number.isNaN(publishedAt.getTime())) {
    throw new SourceAdapterConfigurationError(
      `X/Twitter provider returned tweet "${tweet.id ?? "unknown"}" without a valid created_at timestamp.`,
      {
        requestPlan: requestContext.requestPlan,
      },
    );
  }

  const outboundUrls = extractTwitterUrls(tweet);
  const summary = buildTweetSummary(tweet, outboundUrls);
  const title = buildTweetTitle(summary);
  const hashtags = extractHashtags(tweet);
  const category = categorizeTweet({
    title,
    summary,
    outboundUrls,
    hashtags,
  });
  const likes = normalizeMetric(tweet?.public_metrics?.like_count);
  const comments = normalizeMetric(tweet?.public_metrics?.reply_count);
  const shares =
    normalizeMetric(tweet?.public_metrics?.retweet_count) +
    normalizeMetric(tweet?.public_metrics?.quote_count);
  const socialEngagement = likes + comments + shares;
  const authority = scoreTwitterAuthority(author);
  const authorHandle = normalizeText(author?.username ?? "");
  const sourceUrl = buildTwitterSourceUrl(tweet, author);

  return {
    adapterId: requestContext.adapterId,
    sourceType: "twitter",
    externalId: tweet.id,
    title,
    sourceName: authorHandle ? `@${authorHandle}` : requestContext.adapterName,
    sourceUrl,
    publishedAt: publishedAt.toISOString(),
    discoveredAt: window.until.toISOString(),
    summary,
    outboundUrls,
    tags: buildTwitterTags({
      hashtags,
      author: authorHandle || null,
    }),
    category,
    integrationHint: deriveTwitterIntegrationHint(category),
    sourceSentiment: inferTwitterSentiment(summary),
    author: authorHandle || null,
    metrics: {
      mentions: 1,
      upvotes: likes,
      comments,
      shares,
    },
    sourceAuthority: {
      authority,
    },
    scoringSignals: {
      recencyHours: Math.max(
        0,
        (window.until.getTime() - publishedAt.getTime()) / 3_600_000,
      ),
      sourceAuthority: authority,
      mentionCount: 1,
      githubStars: null,
      githubActivity: null,
      socialEngagement,
    },
    riskWarning: buildTwitterRiskWarning(tweet, outboundUrls),
    metadata: {
      provider: requestContext.requestPlan.provider,
      query: requestContext.requestPlan.params?.query ?? null,
      authorId: tweet.author_id ?? null,
      conversationId: tweet.conversation_id ?? null,
      language: tweet.lang ?? null,
      hashtags,
      verifiedAuthor: Boolean(author?.verified),
      followerCount: normalizeMetric(author?.public_metrics?.followers_count),
    },
    raw: {
      id: tweet.id,
      authorId: tweet.author_id ?? null,
      conversationId: tweet.conversation_id ?? null,
    },
  };
}

function normalizeTwitterApiResponse(payload, requestContext) {
  if (!isObject(payload)) {
    throw new SourceAdapterConfigurationError(
      "X/Twitter API response must be a JSON object.",
      {
        requestPlan: requestContext.requestPlan,
      },
    );
  }

  if (payload.data == null) {
    return {
      cursor: payload.meta?.next_token ?? null,
      records: [],
    };
  }

  if (!Array.isArray(payload.data)) {
    throw new SourceAdapterConfigurationError(
      "X/Twitter API response `data` must be an array when present.",
      {
        requestPlan: requestContext.requestPlan,
      },
    );
  }

  const users = Array.isArray(payload.includes?.users) ? payload.includes.users : [];
  const usersById = new Map(
    users
      .filter((user) => isObject(user) && typeof user.id === "string")
      .map((user) => [user.id, user]),
  );
  const window = normalizeFetchWindow({
    since: requestContext.requestPlan.params?.start_time,
    until: requestContext.requestPlan.params?.end_time,
  });
  const records = payload.data
    .map((tweet) =>
      normalizeTwitterApiTweet(tweet, {
        author: usersById.get(tweet?.author_id) ?? null,
        requestContext,
        window,
      }),
    )
    .filter((record) => {
      const publishedAt = new Date(record.publishedAt);
      return publishedAt >= window.since && publishedAt <= window.until;
    })
    .sort(
      (left, right) =>
        new Date(right.publishedAt).getTime() -
        new Date(left.publishedAt).getTime(),
    );

  return {
    cursor:
      typeof payload.meta?.next_token === "string" ? payload.meta.next_token : null,
    records,
  };
}

function buildExecutionRequestUrl(requestPlan) {
  const url = new URL(requestPlan.url);

  for (const [key, value] of Object.entries(requestPlan.params ?? {})) {
    if (value == null) {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

function normalizeHeaders(value, fieldName) {
  if (!isObject(value)) {
    throw new SourceAdapterConfigurationError(
      `X/Twitter provider hook \`${fieldName}\` must return an object when provided.`,
    );
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue != null)
      .map(([key, entryValue]) => [
        normalizeString(key, `${fieldName} header name`),
        normalizeString(
          String(entryValue),
          `${fieldName} header "${key}"`,
        ),
      ]),
  );
}

function buildDefaultExecutionHeaders(config) {
  if (config.bearerToken) {
    return {
      accept: "application/json",
      authorization: `Bearer ${config.bearerToken}`,
      "user-agent": DEFAULT_TWITTER_USER_AGENT,
    };
  }

  if (config.apiKey && config.apiSecret) {
    throw new SourceAdapterNotImplementedError(
      "The default X/Twitter runtime client only supports bearer-token auth. Attach a custom provider client to use apiKey/apiSecret credentials.",
    );
  }

  validateTwitterProviderConfig(config);
  return {};
}

async function resolveExecutionHeaders({
  config,
  requestContext,
  hooks,
}) {
  const resolvedHooks = createTwitterProviderHooks(hooks);
  const hookHeaders = resolvedHooks.buildAuthHeaders
    ? await resolvedHooks.buildAuthHeaders({
        config,
        requestContext,
        providerContract: requestContext.providerContract ?? null,
      })
    : null;

  if (hookHeaders == null) {
    return buildDefaultExecutionHeaders(config);
  }

  return normalizeHeaders(hookHeaders, "buildAuthHeaders");
}

function mergeExecutionRequest(baseRequest, override) {
  if (override == null) {
    return baseRequest;
  }

  if (!isObject(override)) {
    throw new SourceAdapterConfigurationError(
      "X/Twitter provider hook `beforeRequest` must return an object when provided.",
    );
  }

  return {
    url:
      override.url == null
        ? baseRequest.url
        : normalizeString(override.url, "beforeRequest url"),
    method:
      override.method == null
        ? baseRequest.method
        : normalizeString(override.method, "beforeRequest method").toUpperCase(),
    headers:
      override.headers == null
        ? baseRequest.headers
        : {
            ...baseRequest.headers,
            ...normalizeHeaders(override.headers, "beforeRequest"),
          },
  };
}

function readResponseHeader(headers, key) {
  if (!headers) {
    return null;
  }

  if (typeof headers.get === "function") {
    const value = headers.get(key);
    return value == null ? null : String(value);
  }

  if (typeof headers === "object") {
    for (const [headerKey, headerValue] of Object.entries(headers)) {
      if (headerKey.toLowerCase() === key.toLowerCase()) {
        return headerValue == null ? null : String(headerValue);
      }
    }
  }

  return null;
}

function resolveRetryAfterMs(response, fallbackMs) {
  const retryAfterValue = readResponseHeader(response?.headers, "retry-after");

  if (!retryAfterValue) {
    return fallbackMs;
  }

  const seconds = Number(retryAfterValue);

  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.trunc(seconds * 1000));
  }

  const retryAt = new Date(retryAfterValue);

  if (!Number.isNaN(retryAt.getTime())) {
    return Math.max(0, retryAt.getTime() - Date.now());
  }

  return fallbackMs;
}

function buildProviderRequestError(response, requestContext, retryAfterMs) {
  return new SourceAdapterConfigurationError(
    `X/Twitter provider request failed: ${response.status} ${response.statusText}`,
    {
      requestPlan: requestContext.requestPlan,
      rateLimit: response.status === 429 ? { retryAfterMs } : undefined,
    },
  );
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function normalizeTwitterProviderResponse(response, context = {}) {
  const requestContext = createTwitterProviderRequestContext(context);
  const isObjectResponse =
    response != null && typeof response === "object" && !Array.isArray(response);
  const records = Array.isArray(response)
    ? response
    : Array.isArray(response?.records)
      ? response.records
      : null;

  if (!records) {
    throw new SourceAdapterConfigurationError(
      "X/Twitter provider client must return either an array of source records or { records, cursor? }.",
      {
        requestPlan: requestContext.requestPlan,
        interfaceVersion: TWITTER_PROVIDER_INTERFACE_VERSION,
      },
    );
  }

  if (
    isObjectResponse &&
    response.cursor != null &&
    typeof response.cursor !== "string"
  ) {
    throw new SourceAdapterConfigurationError(
      "X/Twitter provider response cursor must be a string when provided.",
    );
  }

  return Object.freeze({
    interfaceVersion: TWITTER_PROVIDER_INTERFACE_VERSION,
    cursor: isObjectResponse ? response.cursor ?? null : null,
    records: records.map((record, index) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new SourceAdapterConfigurationError(
          `X/Twitter provider record at index ${index} must be an object.`,
        );
      }

      return {
        ...record,
        adapterId: record.adapterId ?? requestContext.adapterId,
        sourceType: record.sourceType ?? "twitter",
      };
    }),
  });
}

export function ensureTwitterProviderClient(client) {
  const executeSearch =
    typeof client?.searchRecent === "function"
      ? client.searchRecent.bind(client)
      : typeof client?.searchRecentRecords === "function"
        ? client.searchRecentRecords.bind(client)
        : null;

  if (!client || !executeSearch) {
    throw new SourceAdapterConfigurationError(
      "X/Twitter adapter requires a provider client exposing searchRecent(context) or searchRecentRecords(context).",
    );
  }

  async function searchRecent(context = {}) {
    const requestContext = createTwitterProviderRequestContext(context);
    const response = await executeSearch(requestContext);
    return normalizeTwitterProviderResponse(response, requestContext);
  }

  return Object.freeze({
    interfaceVersion:
      client.interfaceVersion ?? TWITTER_PROVIDER_INTERFACE_VERSION,
    provider: client.provider ?? null,
    searchRecent,
    async searchRecentRecords(context = {}) {
      const response = await searchRecent(context);
      return response.records;
    },
  });
}

export function resolveTwitterProviderClient({
  client = null,
  clientFactory = null,
  config = {},
  hooks = {},
  adapterId = DEFAULT_TWITTER_ADAPTER_ID,
  adapterName = DEFAULT_TWITTER_ADAPTER_NAME,
  fetch: fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
} = {}) {
  if (client && clientFactory) {
    throw new SourceAdapterConfigurationError(
      "Provide either `client` or `clientFactory` for the X/Twitter adapter, not both.",
    );
  }

  const normalizedConfig = createTwitterProviderConfig(config);
  const normalizedHooks = createTwitterProviderHooks(hooks);
  const providerContract = createTwitterProviderContract({
    adapterId,
    adapterName,
    config: normalizedConfig,
    hooks: normalizedHooks,
  });
  const defaultClient = createDefaultTwitterProviderClient(normalizedConfig, {
    fetch: fetchImpl,
    hooks: normalizedHooks,
    providerContract,
    sleep,
  });

  if (clientFactory == null) {
    return ensureTwitterProviderClient(client ?? defaultClient);
  }

  if (typeof clientFactory !== "function") {
    throw new SourceAdapterConfigurationError(
      "X/Twitter adapter clientFactory must be a function when provided.",
    );
  }

  const resolvedClient =
    clientFactory({
      config: normalizedConfig,
      hooks: normalizedHooks,
      providerContract,
      defaultClient,
    }) ?? defaultClient;

  return ensureTwitterProviderClient(resolvedClient);
}

export function createDefaultTwitterProviderClient(
  config = {},
  {
    fetch: fetchImpl = globalThis.fetch,
    hooks = {},
    providerContract = null,
    sleep = defaultSleep,
  } = {},
) {
  const normalizedConfig = createTwitterProviderConfig(config);
  const normalizedHooks = createTwitterProviderHooks(hooks);
  const resolvedProviderContract =
    providerContract ??
    createTwitterProviderContract({
      config: normalizedConfig,
      hooks: normalizedHooks,
    });

  if (normalizedConfig.provider === DEFAULT_TWITTER_PROVIDER) {
    return createTwitterApiV2ProviderClient(normalizedConfig, {
      fetch: fetchImpl,
      hooks: normalizedHooks,
      providerContract: resolvedProviderContract,
      sleep,
    });
  }

  return createStubTwitterProviderClient(normalizedConfig, {
    providerContract: resolvedProviderContract,
  });
}

export function createTwitterApiV2ProviderClient(
  config = {},
  {
    fetch: fetchImpl = globalThis.fetch,
    hooks = {},
    providerContract = null,
    sleep = defaultSleep,
  } = {},
) {
  const normalizedConfig = createTwitterProviderConfig(config);
  const normalizedHooks = createTwitterProviderHooks(hooks);
  const resolvedProviderContract =
    providerContract ??
    createTwitterProviderContract({
      config: normalizedConfig,
      hooks: normalizedHooks,
    });

  if (typeof fetchImpl !== "function") {
    throw new SourceAdapterConfigurationError(
      "X/Twitter API v2 client requires a fetch implementation.",
    );
  }

  if (typeof sleep !== "function") {
    throw new SourceAdapterConfigurationError(
      "X/Twitter API v2 client requires a sleep implementation when provided.",
    );
  }

  return {
    interfaceVersion: TWITTER_PROVIDER_INTERFACE_VERSION,
    provider: normalizedConfig.provider,
    async searchRecent(context = {}) {
      const requestContext = createTwitterProviderRequestContext({
        ...context,
        providerContract: context.providerContract ?? resolvedProviderContract,
      });

      for (let attempt = 0; ; attempt += 1) {
        const baseRequest = {
          url: buildExecutionRequestUrl(requestContext.requestPlan),
          method: requestContext.requestPlan.method ?? "GET",
          headers: await resolveExecutionHeaders({
            config: normalizedConfig,
            requestContext,
            hooks: normalizedHooks,
          }),
        };
        const request = mergeExecutionRequest(
          baseRequest,
          normalizedHooks.beforeRequest
            ? await normalizedHooks.beforeRequest({
                attempt,
                config: normalizedConfig,
                request: baseRequest,
                requestContext,
                providerContract: resolvedProviderContract,
              })
            : null,
        );
        const response = await fetchImpl(request.url, {
          method: request.method,
          headers: request.headers,
        });

        if (normalizedHooks.afterResponse) {
          await normalizedHooks.afterResponse({
            attempt,
            config: normalizedConfig,
            request,
            requestContext,
            providerContract: resolvedProviderContract,
            response,
          });
        }

        if (response.ok) {
          const payload = await response.json();
          return normalizeTwitterApiResponse(payload, requestContext);
        }

        const retryAfterMs = resolveRetryAfterMs(
          response,
          requestContext.rateLimit.defaultRetryAfterMs,
        );

        if (response.status === 429) {
          const rateLimitDecision = normalizedHooks.onRateLimit
            ? await normalizedHooks.onRateLimit({
                attempt,
                config: normalizedConfig,
                request,
                requestContext,
                providerContract: resolvedProviderContract,
                response,
                retryAfterMs,
              })
            : null;
          const shouldRetry =
            attempt < requestContext.rateLimit.maxRetries &&
            (rateLimitDecision?.retry ?? true);

          if (shouldRetry) {
            const delayMs = normalizeNonNegativeInteger(
              rateLimitDecision?.retryAfterMs,
              "rateLimitRetryAfterMs",
              retryAfterMs,
            );

            if (delayMs > 0) {
              await sleep(delayMs);
            }

            continue;
          }
        }

        throw buildProviderRequestError(response, requestContext, retryAfterMs);
      }
    },
    async searchRecentRecords(context = {}) {
      const response = await this.searchRecent(context);
      return response.records;
    },
  };
}

export function createStubTwitterProviderClient(
  config = {},
  {
    providerContract = null,
  } = {},
) {
  const normalizedConfig = createTwitterProviderConfig(config);
  const provider = normalizedConfig.provider;
  const resolvedProviderContract =
    providerContract ??
    createTwitterProviderContract({
      config: normalizedConfig,
    });

  async function searchRecent(context = {}) {
    const requestContext =
      context.requestPlan != null
        ? createTwitterProviderRequestContext({
            ...context,
            providerContract: context.providerContract ?? resolvedProviderContract,
          })
        : createTwitterProviderRequestContext({
            adapterId: context.adapterId ?? DEFAULT_TWITTER_ADAPTER_ID,
            adapterName: context.adapterName ?? DEFAULT_TWITTER_ADAPTER_NAME,
            requestPlan: buildTwitterRequestPlan(
              normalizedConfig,
              context.window ?? context,
            ),
            providerContract: resolvedProviderContract,
          });

    throw new SourceAdapterNotImplementedError(
      `X/Twitter provider client is configured for "${provider}" but no execution client has been attached yet.`,
      {
        interfaceVersion: TWITTER_PROVIDER_INTERFACE_VERSION,
        requestPlan: requestContext.requestPlan,
        requestContext,
      },
    );
  }

  return {
    interfaceVersion: TWITTER_PROVIDER_INTERFACE_VERSION,
    provider,
    searchRecent,
    async searchRecentRecords(context = {}) {
      const response = await searchRecent(context);
      return response.records;
    },
  };
}
