import {
  createNormalizedItemFromSourceRecord,
  createSourceDescriptor,
} from "../core/schema.js";
import {
  SourceAdapter,
  SourceAdapterConfigurationError,
  ensureFetchImplementation,
  normalizeFetchWindow,
} from "./source-adapter.js";

export const DEFAULT_REDDIT_USER_AGENT =
  "agent-newsletter/0.1 (+https://example.invalid/agent-newsletter)";
export const DEFAULT_REDDIT_RATE_LIMIT_MAX_RETRIES = 0;
export const DEFAULT_REDDIT_RATE_LIMIT_RETRY_AFTER_MS = 60_000;

export const DEFAULT_AGENT_SUBREDDITS = Object.freeze([
  "AutoGPT",
  "LangChain",
  "LocalLLaMA",
  "OpenAI",
  "singularity",
]);

const REDDIT_BASE_URL = "https://www.reddit.com";
const DEFAULT_LISTING = "new";
const DEFAULT_LIMIT_PER_SUBREDDIT = 25;
const REDDIT_AUTHORITY_SCORE = 62;
const REDDIT_MINIMUM_ITEM_AUTHORITY_SCORE = 50;

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function defaultNow() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptionalString(value) {
  return String(value ?? "").trim();
}

function resolveFetchTimestamp(nowImpl) {
  const value = nowImpl();
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new SourceAdapterConfigurationError(
      "Reddit adapter now() must return a valid date.",
    );
  }

  return date.toISOString();
}

function normalizeNonNegativeInteger(value, fieldName, fallback) {
  if (value == null || value === "") {
    return fallback;
  }

  const normalized = Number(value);

  if (!Number.isFinite(normalized)) {
    throw new SourceAdapterConfigurationError(
      `Reddit adapter field \`${fieldName}\` must be numeric.`,
    );
  }

  return Math.max(0, Math.trunc(normalized));
}

function normalizeSubredditName(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^\/?r\//iu, "")
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "");

  if (!normalized) {
    return "";
  }

  return normalized.replace(/\s+/gu, "");
}

function normalizeSubreddits(subreddits) {
  const normalized = (subreddits ?? DEFAULT_AGENT_SUBREDDITS)
    .map((subreddit) => normalizeSubredditName(subreddit))
    .filter(Boolean);

  if (normalized.length === 0) {
    throw new SourceAdapterConfigurationError(
      "Reddit adapter requires at least one subreddit.",
    );
  }

  return [...new Set(normalized)];
}

function extractUrls(text) {
  if (!text) {
    return [];
  }

  const matches = text.match(/https?:\/\/[^\s)]+/g) ?? [];
  return matches.map((url) => url.replace(/[.,!?]+$/, ""));
}

function withinWindow(date, window) {
  return date >= window.since && date <= window.until;
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

function categorizePost({ title, summary, outboundUrls }) {
  const haystack = [title, summary, ...outboundUrls]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(api|sdk|endpoint|rest|graphql)\b/u.test(haystack)) {
    return "api";
  }

  if (/\b(library|framework|package|npm|gem|crate|repo|github)\b/u.test(haystack)) {
    return "library";
  }

  if (/\b(benchmark|technique|pattern|guide|tutorial|workflow)\b/u.test(haystack)) {
    return "technique";
  }

  return "tool";
}

function deriveIntegrationHint(category) {
  if (category === "api") {
    return "Review the linked docs and thread context, then verify auth, quotas, and endpoint stability before wiring it into an agent.";
  }

  if (category === "library") {
    return "Inspect the linked repository and installation steps before adding it to an agent runtime.";
  }

  if (category === "technique") {
    return "Read the thread for operator notes, then validate the technique in a small agent workflow before adoption.";
  }

  return "Review the linked artifact and operator feedback before integrating it into an agent workflow.";
}

function buildSubredditUrl(subreddit) {
  return new URL(`/r/${subreddit}/`, REDDIT_BASE_URL).toString();
}

function buildRiskWarning(post) {
  if (post.over_18) {
    return {
      severity: "high",
      description:
        "Marked NSFW on Reddit. Validate content safety and destination links before any automated ingestion.",
    };
  }

  if (post.is_self) {
    return {
      severity: "medium",
      description:
        "Community discussion may summarize the artifact incompletely. Verify the linked sources before integrating it.",
    };
  }

  return {
    severity: "low",
    description:
      "Community discussion can be noisy or promotional. Cross-check the linked artifact before integrating it.",
  };
}

export class RedditSourceAdapter extends SourceAdapter {
  constructor({
    id = "reddit",
    name = "Reddit",
    enabled = true,
    baseUrl = REDDIT_BASE_URL,
    subreddits = DEFAULT_AGENT_SUBREDDITS,
    listing = DEFAULT_LISTING,
    userAgent = DEFAULT_REDDIT_USER_AGENT,
    accessToken = "",
    rateLimitMaxRetries = DEFAULT_REDDIT_RATE_LIMIT_MAX_RETRIES,
    rateLimitRetryAfterMs = DEFAULT_REDDIT_RATE_LIMIT_RETRY_AFTER_MS,
    fetch: fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    now = defaultNow,
  } = {}) {
    super({
      id,
      name,
      type: "reddit",
      enabled,
    });

    this.descriptor = createSourceDescriptor({
      id,
      kind: "reddit",
      displayName: name,
      authorityScore: REDDIT_AUTHORITY_SCORE,
      seeded: true,
      supportsDiscovery: true,
      minimumItemAuthorityScore: REDDIT_MINIMUM_ITEM_AUTHORITY_SCORE,
    });
    this.baseUrl = baseUrl;
    this.subreddits = normalizeSubreddits(subreddits);
    this.listing = listing;
    this.userAgent = userAgent.trim() || DEFAULT_REDDIT_USER_AGENT;
    this.accessToken = normalizeOptionalString(accessToken);
    this.rateLimitMaxRetries = normalizeNonNegativeInteger(
      rateLimitMaxRetries,
      "rateLimitMaxRetries",
      DEFAULT_REDDIT_RATE_LIMIT_MAX_RETRIES,
    );
    this.rateLimitRetryAfterMs = normalizeNonNegativeInteger(
      rateLimitRetryAfterMs,
      "rateLimitRetryAfterMs",
      DEFAULT_REDDIT_RATE_LIMIT_RETRY_AFTER_MS,
    );
    this.fetchImpl = ensureFetchImplementation(fetchImpl);

    if (typeof sleep !== "function") {
      throw new SourceAdapterConfigurationError(
        "Reddit adapter requires `sleep` to be a function when provided.",
      );
    }

    this.sleep = sleep;

    if (typeof now !== "function") {
      throw new SourceAdapterConfigurationError(
        "Reddit adapter requires `now` to be a function when provided.",
      );
    }

    this.now = now;
  }

  getCredentialStatus() {
    return {
      configured: true,
      missing: [],
      authStrategy: this.accessToken ? "oauth-bearer" : "user-agent",
      ...(this.userAgent === DEFAULT_REDDIT_USER_AGENT
        ? { placeholders: ["userAgent"] }
        : {}),
    };
  }

  buildRequestHeaders() {
    return {
      accept: "application/json",
      "user-agent": this.userAgent,
      ...(this.accessToken
        ? { authorization: `Bearer ${this.accessToken}` }
        : {}),
    };
  }

  buildListingUrl(subreddit, limit) {
    const url = new URL(
      `/r/${subreddit}/${this.listing}.json`,
      this.baseUrl,
    );
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("raw_json", "1");
    return url.toString();
  }

  async fetchSubreddit(subreddit, window, limit) {
    const url = this.buildListingUrl(subreddit, limit);

    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(url, {
        headers: this.buildRequestHeaders(),
      });

      if (response.ok) {
        const fetchedAt = resolveFetchTimestamp(this.now);
        const payload = await response.json();
        const children = payload?.data?.children ?? [];
        const fetchContext = {
          fetchedAt,
          requestUrl: url,
          responseUrl:
            typeof response.url === "string" && response.url.trim()
              ? response.url
              : url,
          subredditUrl: buildSubredditUrl(subreddit),
          listing: this.listing,
          listingUrl: url,
        };

        return children
          .map((entry) => entry?.data)
          .filter(Boolean)
          .map((post) => this.normalizePost(post, subreddit, window, fetchContext))
          .filter((post) => withinWindow(new Date(post.publishedAt), window));
      }

      const retryAfterMs = resolveRetryAfterMs(
        response,
        this.rateLimitRetryAfterMs,
      );

      if (response.status === 429 && attempt < this.rateLimitMaxRetries) {
        if (retryAfterMs > 0) {
          await this.sleep(retryAfterMs);
        }

        continue;
      }

      throw new SourceAdapterConfigurationError(
        `Reddit adapter request failed for r/${subreddit}: ${response.status} ${response.statusText}`,
        {
          subreddit,
          requestUrl: url,
          authStrategy: this.accessToken ? "oauth-bearer" : "user-agent",
          rateLimit:
            response.status === 429
              ? { retryAfterMs }
              : undefined,
        },
      );
    }
  }

  normalizePost(post, subreddit, window = null, fetchContext = {}) {
    const publishedAt = new Date((post.created_utc ?? 0) * 1000);
    const redditUrl = new URL(post.permalink ?? "/", REDDIT_BASE_URL).toString();
    const subredditUrl = fetchContext.subredditUrl ?? buildSubredditUrl(subreddit);
    const outboundUrls = new Set(extractUrls(post.selftext));

    if (post.url_overridden_by_dest && post.url_overridden_by_dest !== redditUrl) {
      outboundUrls.add(post.url_overridden_by_dest);
    }

    const summary = normalizeText(post.selftext || post.title || "").slice(0, 600);
    const orderedOutboundUrls = [...outboundUrls].sort();
    const category = categorizePost({
      title: post.title,
      summary,
      outboundUrls: orderedOutboundUrls,
    });
    const socialEngagement = Math.max(
      0,
      (post.ups ?? post.score ?? 0) + (post.num_comments ?? 0),
    );
    const fetchWindow =
      window == null
        ? null
        : {
            since: window.since.toISOString(),
            until: window.until.toISOString(),
          };
    const sourceProvenance = {
      adapterId: this.id,
      sourceKind: this.descriptor.kind,
      sourceName: this.name,
      subreddit,
      subredditUrl,
      listing: fetchContext.listing ?? this.listing,
      listingUrl: fetchContext.listingUrl ?? this.buildListingUrl(subreddit, DEFAULT_LIMIT_PER_SUBREDDIT),
      requestUrl: fetchContext.requestUrl ?? null,
      fetchedFromUrl:
        fetchContext.responseUrl ?? fetchContext.requestUrl ?? null,
      fetchedAt: fetchContext.fetchedAt ?? null,
    };

    return {
      adapterId: this.id,
      sourceType: "reddit",
      externalId: post.name ?? post.id,
      title: post.title?.trim() ?? "Untitled Reddit Post",
      sourceName: `r/${subreddit}`,
      sourceUrl: redditUrl,
      publishedAt: publishedAt.toISOString(),
      discoveredAt: window?.until?.toISOString?.() ?? undefined,
      summary,
      outboundUrls: orderedOutboundUrls,
      tags: [subreddit, "reddit", "ai-agents"],
      category,
      integrationHint: deriveIntegrationHint(category),
      author: post.author ?? null,
      metrics: {
        mentions: 1,
        upvotes: post.ups ?? post.score ?? 0,
        comments: post.num_comments ?? 0,
        shares: 0,
      },
      sourceAuthority: {
        authority: REDDIT_AUTHORITY_SCORE,
      },
      scoringSignals: {
        recencyHours:
          window == null
            ? null
            : Math.max(0, (window.until.getTime() - publishedAt.getTime()) / 3_600_000),
        sourceAuthority: REDDIT_AUTHORITY_SCORE,
        mentionCount: 1,
        githubStars: null,
        githubActivity: null,
        socialEngagement,
      },
      riskWarning: buildRiskWarning(post),
      metadata: {
        subreddit,
        subredditUrl,
        listing: fetchContext.listing ?? this.listing,
        listingUrl:
          fetchContext.listingUrl ??
          this.buildListingUrl(subreddit, DEFAULT_LIMIT_PER_SUBREDDIT),
        isSelfPost: Boolean(post.is_self),
        linkUrl:
          post.url_overridden_by_dest && post.url_overridden_by_dest !== redditUrl
            ? post.url_overridden_by_dest
            : null,
        fetchWindow,
        fetchedAt: fetchContext.fetchedAt ?? null,
        fetchedFromUrl:
          fetchContext.responseUrl ?? fetchContext.requestUrl ?? null,
        sourceProvenance,
        reddit: {
          subreddit,
          subredditUrl,
          listing: fetchContext.listing ?? this.listing,
          listingUrl:
            fetchContext.listingUrl ??
            this.buildListingUrl(subreddit, DEFAULT_LIMIT_PER_SUBREDDIT),
          fetchedAt: fetchContext.fetchedAt ?? null,
          fetchedFromUrl:
            fetchContext.responseUrl ?? fetchContext.requestUrl ?? null,
          postFullname: post.name ?? null,
          postId: post.id ?? null,
          isSelfPost: Boolean(post.is_self),
          linkUrl:
            post.url_overridden_by_dest && post.url_overridden_by_dest !== redditUrl
              ? post.url_overridden_by_dest
              : null,
        },
      },
      raw: {
        id: post.id,
        name: post.name ?? null,
        permalink: post.permalink,
        subreddit,
        subredditUrl,
        requestUrl: fetchContext.requestUrl ?? null,
        fetchedFromUrl:
          fetchContext.responseUrl ?? fetchContext.requestUrl ?? null,
      },
    };
  }

  async fetchItems({
    since,
    until,
    limitPerSubreddit = DEFAULT_LIMIT_PER_SUBREDDIT,
  } = {}) {
    this.assertEnabled();
    const window = normalizeFetchWindow({ since, until });

    const batches = await Promise.all(
      this.subreddits.map((subreddit) =>
        this.fetchSubreddit(subreddit, window, limitPerSubreddit),
      ),
    );

    return batches
      .flat()
      .sort(
        (left, right) =>
          new Date(right.publishedAt).getTime() -
          new Date(left.publishedAt).getTime(),
      );
  }

  async fetch(window = {}) {
    const records = await this.fetchItems({
      since: window.startsAt ?? window.since,
      until: window.endsAt ?? window.until,
    });

    return {
      items: records.map((record) =>
        createNormalizedItemFromSourceRecord(record, {
          sourceKind: this.descriptor.kind,
        }),
      ),
      discoveredSources: [],
      cursor: null,
    };
  }
}
