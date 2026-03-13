import {
  createNormalizedItemFromSourceRecord,
  createSourceDescriptor,
  mergeRiskWarnings,
} from "../core/schema.js";
import {
  SourceAdapter,
  SourceAdapterConfigurationError,
  ensureFetchImplementation,
  normalizeFetchWindow,
  readResponseHeader,
  resolveRetryAfterMs,
} from "./source-adapter.js";

export const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
export const DEFAULT_GITHUB_WEB_BASE_URL = "https://github.com";
export const DEFAULT_GITHUB_USER_AGENT =
  "agent-newsletter/0.1 (+https://example.invalid/agent-newsletter)";
export const DEFAULT_GITHUB_TRENDING_SINCE = "daily";
export const DEFAULT_GITHUB_SEARCH_LIMIT = 20;
export const DEFAULT_GITHUB_RATE_LIMIT_MAX_RETRIES = 0;
export const DEFAULT_GITHUB_RATE_LIMIT_RETRY_AFTER_MS = 60_000;
export const DEFAULT_GITHUB_SEARCH_TERMS = Object.freeze([
  '"ai agent"',
  '"llm agent"',
  "agentic",
  '"autonomous agent"',
  '"multi-agent"',
]);

const GITHUB_AUTHORITY_SCORE = 95;
const GITHUB_MINIMUM_ITEM_AUTHORITY_SCORE = 70;
const GITHUB_SEARCH_RESULT_CAP = 1_000;
const GITHUB_PAGE_SIZE_CAP = 100;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const AI_AGENT_SIGNALS = Object.freeze([
  "ai agent",
  "ai-agents",
  "llm agent",
  "agentic",
  "multi-agent",
  "multi agent",
  "autonomous agent",
  "agent engineering",
  "browser agent",
  "coding agent",
  "swe-agent",
  "autogen",
  "crewai",
  "langgraph",
  "smolagents",
  "openhands",
]);
const AI_AGENT_CONTEXT = Object.freeze([
  "agent",
  "workflow",
  "planner",
  "tool calling",
  "tool-use",
  "assistant",
  "automation",
  "llm",
  "memory",
  "orchestration",
]);

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeSearchTerms(terms) {
  const normalized = (terms ?? DEFAULT_GITHUB_SEARCH_TERMS)
    .map((term) => String(term).trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    throw new SourceAdapterConfigurationError(
      "GitHub adapter requires at least one search term.",
    );
  }

  return [...new Set(normalized)];
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function buildUrl(baseUrl, path) {
  return new URL(path.replace(/^\/+/u, ""), `${trimTrailingSlash(baseUrl)}/`).toString();
}

function toDateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function normalizeNullableString(value) {
  const normalized = value == null ? null : String(value).trim();
  return normalized ? normalized : null;
}

function normalizeTopics(topics) {
  if (!Array.isArray(topics)) {
    return [];
  }

  return [...new Set(topics.map((topic) => normalizeNullableString(topic)).filter(Boolean))];
}

function normalizePositiveInteger(value, fieldName, fallback) {
  if (value == null) {
    return fallback;
  }

  const normalized = Number(value);

  if (!Number.isFinite(normalized)) {
    throw new SourceAdapterConfigurationError(
      `GitHub adapter field \`${fieldName}\` must be numeric.`,
    );
  }

  return Math.max(1, Math.trunc(normalized));
}

function normalizeNonNegativeInteger(value, fieldName, fallback) {
  if (value == null) {
    return fallback;
  }

  const normalized = Number(value);

  if (!Number.isFinite(normalized)) {
    throw new SourceAdapterConfigurationError(
      `GitHub adapter field \`${fieldName}\` must be numeric.`,
    );
  }

  return Math.max(0, Math.trunc(normalized));
}

function normalizeSearchLimit(value) {
  return Math.min(
    GITHUB_SEARCH_RESULT_CAP,
    normalizePositiveInteger(
      value,
      "searchLimit",
      DEFAULT_GITHUB_SEARCH_LIMIT,
    ),
  );
}

function resolveSearchPageSize(limit, pageSize = null) {
  const normalizedLimit = normalizeSearchLimit(limit);
  const normalizedPageSize = normalizePositiveInteger(
    pageSize,
    "searchPageSize",
    normalizedLimit,
  );

  return Math.min(GITHUB_PAGE_SIZE_CAP, normalizedLimit, normalizedPageSize);
}

function normalizeSearchPage(value) {
  return normalizePositiveInteger(value, "page", 1);
}

function isGitHubRateLimitedResponse(response) {
  if (response?.status === 429) {
    return true;
  }

  if (response?.status !== 403) {
    return false;
  }

  const remaining = readResponseHeader(response?.headers, "x-ratelimit-remaining");
  const resetAt = readResponseHeader(response?.headers, "x-ratelimit-reset");

  return remaining === "0" || Boolean(resetAt);
}

function resolveGitHubRetryAfterMs(response, fallbackMs, nowMs = Date.now()) {
  if (readResponseHeader(response?.headers, "retry-after")) {
    return resolveRetryAfterMs(response, fallbackMs, nowMs);
  }

  const resetAt = Number(readResponseHeader(response?.headers, "x-ratelimit-reset"));

  if (Number.isFinite(resetAt)) {
    return Math.max(0, resetAt * 1000 - nowMs);
  }

  return fallbackMs;
}

function toMetric(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function normalizeTimestampValue(value, fieldName = "timestamp") {
  if (value == null) {
    throw new SourceAdapterConfigurationError(`GitHub adapter requires ${fieldName}.`);
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new SourceAdapterConfigurationError(
      `GitHub adapter received an invalid ${fieldName}: ${String(value)}`,
    );
  }

  return date.toISOString();
}

function mergeTimestampLists(left = [], right = []) {
  return [
    ...new Set(
      [...left, ...right]
        .filter(Boolean)
        .map((value) => normalizeTimestampValue(value)),
    ),
  ].sort((earlier, later) => earlier.localeCompare(later));
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, "/");
}

function stripHtml(value) {
  if (value == null) {
    return "";
  }

  return decodeHtmlEntities(String(value).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumeric(value) {
  if (!value) {
    return 0;
  }

  const match = stripHtml(value)
    .replace(/,/g, "")
    .toLowerCase()
    .match(/(\d+(?:\.\d+)?)([km])?/u);

  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);

  if (match[2] === "k") {
    return Math.round(amount * 1_000);
  }

  if (match[2] === "m") {
    return Math.round(amount * 1_000_000);
  }

  return Math.round(amount);
}

function matchGroup(value, expression) {
  return value.match(expression)?.[1] ?? null;
}

function includesAny(haystack, needles) {
  return needles.some((needle) => haystack.includes(needle));
}

function createGitHubSourceProvenance({
  adapterId = "github",
  sourceKind = "github",
  sourceName = "GitHub",
  channel,
  requestUrl,
  requestedUrl = requestUrl,
  fetchedFromUrl = requestedUrl,
  fetchedAt,
  query = null,
  rank = null,
}) {
  const normalizedAdapterId = normalizeNullableString(adapterId);
  const normalizedChannel = normalizeNullableString(channel);
  const normalizedSourceKind = normalizeNullableString(sourceKind);
  const normalizedSourceName = normalizeNullableString(sourceName);
  const normalizedRequestUrl = normalizeNullableString(requestUrl ?? requestedUrl);
  const normalizedRequestedUrl =
    normalizeNullableString(requestedUrl) ?? normalizedRequestUrl;
  const normalizedFetchedFromUrl =
    normalizeNullableString(fetchedFromUrl) ?? normalizedRequestedUrl;

  if (!normalizedAdapterId || !normalizedSourceKind || !normalizedSourceName) {
    throw new SourceAdapterConfigurationError(
      "GitHub provenance requires stable adapter identity metadata.",
    );
  }

  if (!normalizedChannel) {
    throw new SourceAdapterConfigurationError(
      "GitHub provenance requires a discovery channel.",
    );
  }

  if (!normalizedRequestUrl) {
    throw new SourceAdapterConfigurationError(
      "GitHub provenance requires a request URL.",
    );
  }

  const provenance = {
    adapterId: normalizedAdapterId,
    sourceKind: normalizedSourceKind,
    sourceName: normalizedSourceName,
    sourceType: "github",
    channel: normalizedChannel,
    requestUrl: normalizedRequestUrl,
    requestedUrl: normalizedRequestedUrl,
    fetchedFromUrl: normalizedFetchedFromUrl,
    fetchedAt: normalizeTimestampValue(fetchedAt, "fetchedAt"),
  };

  if (query != null) {
    provenance.query = String(query);
  }

  if (rank != null) {
    provenance.rank = Math.max(1, Math.trunc(toMetric(rank)));
  }

  return provenance;
}

function mergeSourceProvenance(left = [], right = []) {
  const entries = new Map();

  for (const entry of [...left, ...right]) {
    const normalized = createGitHubSourceProvenance(entry);
    const key = [
      normalized.adapterId,
      normalized.sourceKind,
      normalized.sourceName,
      normalized.sourceType,
      normalized.channel,
      normalized.requestUrl,
      normalized.requestedUrl,
      normalized.fetchedFromUrl,
      normalized.fetchedAt,
      normalized.query ?? "",
      normalized.rank ?? "",
    ].join("|");

    if (!entries.has(key)) {
      entries.set(key, normalized);
    }
  }

  return [...entries.values()].sort((leftEntry, rightEntry) => {
    return (
      leftEntry.fetchedAt.localeCompare(rightEntry.fetchedAt) ||
      leftEntry.channel.localeCompare(rightEntry.channel) ||
      (leftEntry.rank ?? 0) - (rightEntry.rank ?? 0) ||
      String(leftEntry.query ?? "").localeCompare(String(rightEntry.query ?? ""))
    );
  });
}

export function categorizeRepository({ title, summary, tags = [] }) {
  const haystack = [title, summary, ...tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(api|sdk|endpoint|rest|graphql|gateway)\b/u.test(haystack)) {
    return "api";
  }

  if (/\b(framework|library|package|module|toolkit)\b/u.test(haystack)) {
    return "library";
  }

  if (/\b(pattern|technique|benchmark|paper|guide|tutorial|prompt)\b/u.test(haystack)) {
    return "technique";
  }

  return "tool";
}

export function deriveIntegrationHint({ category, language }) {
  if (category === "api") {
    return "Review the README for endpoint shape, auth requirements, and deployment guidance before connecting an agent to it.";
  }

  switch (language) {
    case "JavaScript":
      return "Install with npm or pnpm and review the README examples before wiring this into an agent runtime.";
    case "TypeScript":
      return "Install with npm or pnpm and review the typed examples before wiring this into an agent runtime.";
    case "Python":
      return "Install with uv or pip, then follow the README examples to connect it to your agent workflow.";
    case "Ruby":
      return "Install with Bundler or RubyGems and review the README examples before integrating it into an agent runtime.";
    case "Go":
      return "Add the module with go get and review the repository examples before integrating it into an agent service.";
    case "Rust":
      return "Add the crate with cargo and review the repository examples before integrating it into an agent service.";
    default:
      return "Review the README and examples before integrating this repository into an agent workflow.";
  }
}

function buildRiskWarning(repository) {
  if (repository.archived) {
    return {
      severity: "high",
      description: "Repository is archived. Verify maintenance status before integrating it into production agents.",
    };
  }

  if (repository.channel === "search" && !repository.license) {
    return {
      severity: "medium",
      description: "Repository license metadata is missing. Verify usage rights before integrating it.",
    };
  }

  if (repository.channel === "trending") {
    return {
      severity: "unknown",
      description: "Trending data omits maintenance metadata. Verify license, issue activity, and release cadence before integrating it.",
    };
  }

  return {
    severity: "low",
    description: "Review dependency health, release cadence, and license terms before integrating it.",
  };
}

export function buildSearchQuery({ term, since, until }) {
  const parts = [
    `${term} in:name,description,readme`,
    "archived:false",
    "mirror:false",
    "stars:>=5",
  ];

  if (since) {
    parts.push(`pushed:>=${toDateOnly(since)}`);
  }

  if (until) {
    parts.push(`pushed:<=${toDateOnly(until)}`);
  }

  return parts.join(" ");
}

function recencyHours(timestamp, windowUntil) {
  if (!timestamp) {
    return null;
  }

  const delta = new Date(windowUntil).getTime() - new Date(timestamp).getTime();
  return delta >= 0 ? Math.round(delta / (60 * 60 * 1000)) : null;
}

function calculateGitHubActivity({ pushedAt, updatedAt, createdAt, stars, forks, windowUntil }) {
  const lastActivity = pushedAt ?? updatedAt ?? createdAt;

  if (!lastActivity) {
    return 0;
  }

  const activityDays = Math.max(
    0,
    Math.round((new Date(windowUntil).getTime() - new Date(lastActivity).getTime()) / DAY_IN_MS),
  );
  const recencyScore = Math.max(0, 60 - activityDays * 3);
  const starsScore = Math.min(25, Math.round(Math.log10(toMetric(stars) + 1) * 10));
  const forksScore = Math.min(15, Math.round(Math.log10(toMetric(forks) + 1) * 8));

  return Math.max(0, Math.min(100, recencyScore + starsScore + forksScore));
}

function calculateTrendingActivity(starsToday) {
  return Math.max(0, Math.min(100, Math.round(Math.log10(toMetric(starsToday) + 1) * 35 + 40)));
}

export function isAiAgentRepository({ title, summary, tags = [] }) {
  const haystack = [title, summary, ...tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (includesAny(haystack, AI_AGENT_SIGNALS)) {
    return true;
  }

  return haystack.includes("agent") && includesAny(haystack, AI_AGENT_CONTEXT);
}

export function parseTrendingHtml(html, webBaseUrl = DEFAULT_GITHUB_WEB_BASE_URL) {
  const articles = html.match(/<article[\s\S]*?class="[^"]*Box-row[^"]*"[\s\S]*?<\/article>/gu) ?? [];

  return articles
    .map((article) => {
      const repoPath = matchGroup(article, /<h2[^>]*>\s*<a[^>]*href="\/([^"]+)"/iu);

      if (!repoPath) {
        return null;
      }

      const fullName = decodeHtmlEntities(repoPath.replace(/\s+/gu, ""));
      const [owner, title] = fullName.split("/");

      return {
        channel: "trending",
        externalId: fullName,
        title: title ?? fullName,
        fullName,
        owner: owner ?? null,
        sourceUrl: `${trimTrailingSlash(webBaseUrl)}/${fullName}`,
        summary: normalizeNullableString(stripHtml(matchGroup(article, /<p[^>]*>([\s\S]*?)<\/p>/iu))),
        language: normalizeNullableString(
          stripHtml(matchGroup(article, /itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/iu)),
        ),
        topics: [],
        stars: parseNumeric(matchGroup(article, /href="\/[^"]+\/stargazers"[^>]*>([\s\S]*?)<\/a>/iu)),
        forks: parseNumeric(matchGroup(article, /href="\/[^"]+\/forks"[^>]*>([\s\S]*?)<\/a>/iu)),
        starsToday: parseNumeric(matchGroup(article, /(\d[\d,.kKmM]*)\s+stars?\s+today/iu)),
        openIssues: 0,
        watchers: 0,
        license: null,
        archived: false,
        defaultBranch: null,
        createdAt: null,
        updatedAt: null,
        pushedAt: null,
      };
    })
    .filter(Boolean);
}

function pickLatestTimestamp(left, right) {
  if (!left) {
    return right ?? null;
  }

  if (!right) {
    return left;
  }

  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function richerText(left, right) {
  return (right?.length ?? 0) > (left?.length ?? 0) ? right : left;
}

function pickRiskWarning(left, right) {
  return mergeRiskWarnings(left, right);
}

function minNullable(left, right) {
  if (left == null) {
    return right ?? null;
  }

  if (right == null) {
    return left;
  }

  return Math.min(left, right);
}

function mergeRecords(records) {
  const merged = new Map();

  for (const record of records) {
    const existing = merged.get(record.externalId);

    if (!existing) {
      merged.set(record.externalId, structuredClone(record));
      continue;
    }

    existing.publishedAt = pickLatestTimestamp(existing.publishedAt, record.publishedAt);
    existing.metrics.mentions += record.metrics.mentions;
    existing.metrics.upvotes = Math.max(existing.metrics.upvotes, record.metrics.upvotes);
    existing.metrics.comments = Math.max(existing.metrics.comments, record.metrics.comments);
    existing.metrics.shares += record.metrics.shares;
    existing.tags = [...new Set([...existing.tags, ...record.tags])];
    existing.outboundUrls = [...new Set([...existing.outboundUrls, ...record.outboundUrls])];
    existing.sourceUrls = [...new Set([...(existing.sourceUrls ?? []), ...(record.sourceUrls ?? [])])];
    existing.summary = richerText(existing.summary, record.summary);
    existing.integrationHint = richerText(existing.integrationHint, record.integrationHint);
    existing.riskWarning = pickRiskWarning(existing.riskWarning, record.riskWarning);
    const mergedSourceProvenance = mergeSourceProvenance(
      existing.metadata.sourceProvenance ?? [],
      record.metadata.sourceProvenance ?? [],
    );
    const mergedFetchTimestamps = mergeTimestampLists(
      existing.metadata.fetchTimestamps ?? [existing.metadata.fetchedAt].filter(Boolean),
      record.metadata.fetchTimestamps ?? [record.metadata.fetchedAt].filter(Boolean),
    );
    const mergedGitHubProvenance = mergeSourceProvenance(
      existing.metadata.github?.provenance ?? [],
      record.metadata.github?.provenance ?? [],
    );
    const mergedGitHubFetchTimestamps = mergeTimestampLists(
      existing.metadata.github?.fetchTimestamps ??
        [existing.metadata.github?.fetchedAt].filter(Boolean),
      record.metadata.github?.fetchTimestamps ??
        [record.metadata.github?.fetchedAt].filter(Boolean),
    );
    existing.scoringSignals = {
      recencyHours: minNullable(
        existing.scoringSignals.recencyHours,
        record.scoringSignals.recencyHours,
      ),
      sourceAuthority: Math.max(
        existing.scoringSignals.sourceAuthority,
        record.scoringSignals.sourceAuthority,
      ),
      mentionCount: existing.metrics.mentions,
      githubStars: Math.max(
        existing.scoringSignals.githubStars ?? 0,
        record.scoringSignals.githubStars ?? 0,
      ),
      githubActivity: Math.max(
        existing.scoringSignals.githubActivity ?? 0,
        record.scoringSignals.githubActivity ?? 0,
      ),
      socialEngagement:
        (existing.scoringSignals.socialEngagement ?? 0) +
        (record.scoringSignals.socialEngagement ?? 0),
    };
    existing.metadata = {
      ...existing.metadata,
      github: {
        ...existing.metadata.github,
        ...record.metadata.github,
        stars: Math.max(existing.metadata.github?.stars ?? 0, record.metadata.github?.stars ?? 0),
        forks: Math.max(existing.metadata.github?.forks ?? 0, record.metadata.github?.forks ?? 0),
        watchers: Math.max(
          existing.metadata.github?.watchers ?? 0,
          record.metadata.github?.watchers ?? 0,
        ),
        openIssues: Math.max(
          existing.metadata.github?.openIssues ?? 0,
          record.metadata.github?.openIssues ?? 0,
        ),
        starsToday:
          (existing.metadata.github?.starsToday ?? 0) +
          (record.metadata.github?.starsToday ?? 0),
        topics: [
          ...new Set([
            ...(existing.metadata.github?.topics ?? []),
            ...(record.metadata.github?.topics ?? []),
          ]),
        ],
        license: existing.metadata.github?.license ?? record.metadata.github?.license ?? null,
        entityKey:
          existing.metadata.github?.entityKey ?? record.metadata.github?.entityKey ?? null,
        repoRootUrl:
          existing.metadata.github?.repoRootUrl ??
          record.metadata.github?.repoRootUrl ??
          null,
        homepage:
          existing.metadata.github?.homepage ?? record.metadata.github?.homepage ?? null,
        channels: [
          ...new Set([
            ...(existing.metadata.github?.channels ?? []),
            ...(record.metadata.github?.channels ?? []),
          ]),
        ],
        searchRanks: [...new Set([
          ...(existing.metadata.github?.searchRanks ?? []),
          ...(record.metadata.github?.searchRanks ?? []),
        ])].sort((left, right) => left - right),
        trendingRanks: [...new Set([
          ...(existing.metadata.github?.trendingRanks ?? []),
          ...(record.metadata.github?.trendingRanks ?? []),
        ])].sort((left, right) => left - right),
        provenance: mergedGitHubProvenance,
        fetchedAt: pickLatestTimestamp(
          existing.metadata.github?.fetchedAt ?? null,
          record.metadata.github?.fetchedAt ?? null,
        ),
        fetchTimestamps:
          mergedGitHubFetchTimestamps.length > 0
            ? mergedGitHubFetchTimestamps
            : mergedFetchTimestamps,
      },
      discoveryChannels: [
        ...new Set([
          ...(existing.metadata.discoveryChannels ?? []),
          ...(record.metadata.discoveryChannels ?? []),
        ]),
      ],
      discoveryUrls: [
        ...new Set([
          ...(existing.metadata.discoveryUrls ?? []),
          ...(record.metadata.discoveryUrls ?? []),
        ]),
      ],
      sourceProvenance: mergedSourceProvenance,
      fetchedAt: pickLatestTimestamp(
        existing.metadata.fetchedAt ?? null,
        record.metadata.fetchedAt ?? null,
      ),
      fetchTimestamps: mergedFetchTimestamps,
      searchQueries: [
        ...new Set([
          ...(existing.metadata.searchQueries ?? []),
          ...(record.metadata.searchQueries ?? []),
        ]),
      ],
      raw: {
        search: [...(existing.metadata.raw?.search ?? []), ...(record.metadata.raw?.search ?? [])],
        trending: [
          ...(existing.metadata.raw?.trending ?? []),
          ...(record.metadata.raw?.trending ?? []),
        ],
      },
    };
  }

  return [...merged.values()].sort((left, right) => {
    return (
      right.metrics.mentions - left.metrics.mentions ||
      (right.scoringSignals.githubStars ?? 0) - (left.scoringSignals.githubStars ?? 0) ||
      (right.scoringSignals.githubActivity ?? 0) - (left.scoringSignals.githubActivity ?? 0)
    );
  });
}

export class GitHubSourceAdapter extends SourceAdapter {
  constructor({
    id = "github",
    name = "GitHub",
    enabled = true,
    apiBaseUrl = DEFAULT_GITHUB_API_BASE_URL,
    webBaseUrl = DEFAULT_GITHUB_WEB_BASE_URL,
    searchTerms = DEFAULT_GITHUB_SEARCH_TERMS,
    trendingSince = DEFAULT_GITHUB_TRENDING_SINCE,
    searchLimit = DEFAULT_GITHUB_SEARCH_LIMIT,
    includeTrending = true,
    userAgent = DEFAULT_GITHUB_USER_AGENT,
    githubToken = "",
    rateLimitMaxRetries = DEFAULT_GITHUB_RATE_LIMIT_MAX_RETRIES,
    rateLimitRetryAfterMs = DEFAULT_GITHUB_RATE_LIMIT_RETRY_AFTER_MS,
    now = () => new Date().toISOString(),
    fetch: fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
  } = {}) {
    super({
      id,
      name,
      type: "github",
      enabled,
    });

    this.descriptor = createSourceDescriptor({
      id,
      kind: "github",
      displayName: name,
      authorityScore: GITHUB_AUTHORITY_SCORE,
      seeded: true,
      supportsDiscovery: true,
      minimumItemAuthorityScore: GITHUB_MINIMUM_ITEM_AUTHORITY_SCORE,
    });
    this.apiBaseUrl = trimTrailingSlash(apiBaseUrl);
    this.webBaseUrl = trimTrailingSlash(webBaseUrl);
    this.searchTerms = normalizeSearchTerms(searchTerms);
    this.trendingSince = trendingSince;
    this.searchLimit = normalizeSearchLimit(searchLimit);
    this.includeTrending = includeTrending;
    this.userAgent = userAgent.trim() || DEFAULT_GITHUB_USER_AGENT;
    this.githubToken = githubToken;
    this.rateLimitMaxRetries = normalizeNonNegativeInteger(
      rateLimitMaxRetries,
      "rateLimitMaxRetries",
      DEFAULT_GITHUB_RATE_LIMIT_MAX_RETRIES,
    );
    this.rateLimitRetryAfterMs = normalizeNonNegativeInteger(
      rateLimitRetryAfterMs,
      "rateLimitRetryAfterMs",
      DEFAULT_GITHUB_RATE_LIMIT_RETRY_AFTER_MS,
    );
    this.now = typeof now === "function" ? now : () => now;
    this.fetchImpl = ensureFetchImplementation(fetchImpl);

    if (typeof sleep !== "function") {
      throw new SourceAdapterConfigurationError(
        "GitHub adapter requires `sleep` to be a function when provided.",
      );
    }

    this.sleep = sleep;
  }

  getCredentialStatus() {
    return {
      configured: true,
      missing: [],
      authStrategy: this.githubToken ? "bearer-token" : "unauthenticated",
    };
  }

  buildHeaders(accept) {
    const headers = {
      accept,
      "user-agent": this.userAgent,
    };

    if (this.githubToken) {
      headers.authorization = `Bearer ${this.githubToken}`;
    }

    return headers;
  }

  buildSearchUrl(
    term,
    window,
    { limit = this.searchLimit, pageSize = null, page = 1 } = {},
  ) {
    const normalizedLimit = normalizeSearchLimit(limit);
    const url = new URL(buildUrl(this.apiBaseUrl, "/search/repositories"));
    url.searchParams.set("q", buildSearchQuery({ term, since: window.since, until: window.until }));
    url.searchParams.set("sort", "updated");
    url.searchParams.set("order", "desc");
    url.searchParams.set(
      "per_page",
      String(resolveSearchPageSize(normalizedLimit, pageSize)),
    );
    url.searchParams.set("page", String(normalizeSearchPage(page)));
    return url.toString();
  }

  buildTrendingUrl() {
    const url = new URL(buildUrl(this.webBaseUrl, "/trending"));
    url.searchParams.set("since", this.trendingSince);
    return url.toString();
  }

  createFetchTimestamp() {
    return normalizeTimestampValue(this.now(), "now");
  }

  async requestWithRateLimitRetry({ requestUrl, accept, failureLabel }) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(requestUrl, {
        headers: this.buildHeaders(accept),
      });

      if (response.ok) {
        return response;
      }

      const rateLimited = isGitHubRateLimitedResponse(response);
      const retryAfterMs = rateLimited
        ? resolveGitHubRetryAfterMs(response, this.rateLimitRetryAfterMs)
        : this.rateLimitRetryAfterMs;

      if (rateLimited && attempt < this.rateLimitMaxRetries) {
        if (retryAfterMs > 0) {
          await this.sleep(retryAfterMs);
        }

        continue;
      }

      throw new SourceAdapterConfigurationError(
        `GitHub adapter ${failureLabel} request failed: ${response.status} ${response.statusText}`,
        {
          requestUrl,
          authStrategy: this.githubToken ? "bearer-token" : "unauthenticated",
          ...(rateLimited ? { rateLimit: { retryAfterMs } } : {}),
        },
      );
    }
  }

  async fetchSearchTerm(term, window, { limit = this.searchLimit, pageSize = null } = {}) {
    const normalizedLimit = normalizeSearchLimit(limit);
    const normalizedPageSize = resolveSearchPageSize(normalizedLimit, pageSize);
    const repositories = [];
    let inspectedCount = 0;

    for (let page = 1; inspectedCount < normalizedLimit; page += 1) {
      const requestUrl = this.buildSearchUrl(term, window, {
        limit: normalizedLimit,
        pageSize: normalizedPageSize,
        page,
      });
      const response = await this.requestWithRateLimitRetry({
        requestUrl,
        accept: "application/vnd.github+json",
        failureLabel: "search",
      });
      const fetchedAt = this.createFetchTimestamp();
      const payload = await response.json();
      const pageItems = Array.isArray(payload.items) ? payload.items : [];
      const remaining = normalizedLimit - inspectedCount;
      const currentPageItems = pageItems.slice(0, remaining);

      repositories.push(
        ...currentPageItems
          .map((repository, index) =>
            this.normalizeSearchRepository(repository, {
              query: term,
              rank: (page - 1) * normalizedPageSize + index + 1,
              requestUrl,
              responseUrl: response.url ?? requestUrl,
              fetchedAt,
              window,
            }),
          )
          .filter(Boolean),
      );

      inspectedCount += currentPageItems.length;

      if (currentPageItems.length < normalizedPageSize) {
        break;
      }

      const totalCount = Math.min(
        GITHUB_SEARCH_RESULT_CAP,
        toMetric(payload.total_count),
      );

      if (
        inspectedCount >= normalizedLimit ||
        (totalCount > 0 && page * normalizedPageSize >= totalCount)
      ) {
        break;
      }
    }

    return repositories;
  }

  normalizeSearchRepository(repository, {
    query,
    rank,
    requestUrl,
    responseUrl,
    fetchedAt,
    window,
  }) {
    const normalized = {
      channel: "search",
      externalId: repository.full_name,
      title: repository.name,
      fullName: repository.full_name,
      owner: repository.owner?.login ?? null,
      sourceUrl: repository.html_url,
      summary: normalizeNullableString(repository.description),
      language: normalizeNullableString(repository.language),
      topics: normalizeTopics(repository.topics),
      stars: toMetric(repository.stargazers_count),
      forks: toMetric(repository.forks_count),
      watchers: toMetric(repository.watchers_count),
      openIssues: toMetric(repository.open_issues_count),
      starsToday: 0,
      license: repository.license?.spdx_id ?? repository.license?.name ?? null,
      archived: Boolean(repository.archived),
      defaultBranch: normalizeNullableString(repository.default_branch),
      createdAt: repository.created_at ?? null,
      updatedAt: repository.updated_at ?? null,
      pushedAt: repository.pushed_at ?? null,
      homepage: normalizeNullableString(repository.homepage),
    };

    const tags = [
      "github",
      "ai-agents",
      normalized.language,
      ...normalized.topics,
    ].filter(Boolean);

    if (
      !isAiAgentRepository({
        title: normalized.title,
        summary: normalized.summary,
        tags,
      })
    ) {
      return null;
    }

    const category = categorizeRepository({
      title: normalized.title,
      summary: normalized.summary,
      tags,
    });
    const publishedAt = normalized.pushedAt ?? normalized.updatedAt ?? normalized.createdAt;
    const provenance = createGitHubSourceProvenance({
      adapterId: this.id,
      sourceKind: this.descriptor.kind,
      sourceName: this.name,
      channel: "search",
      requestUrl,
      fetchedFromUrl: responseUrl ?? requestUrl,
      fetchedAt,
      query,
      rank,
    });

    return {
      adapterId: this.id,
      sourceType: "github",
      externalId: normalized.externalId,
      title: normalized.title,
      sourceName: this.name,
      sourceUrl: normalized.sourceUrl,
      sourceUrls: [normalized.sourceUrl],
      publishedAt,
      discoveredAt: window.until.toISOString(),
      summary:
        normalized.summary ??
        `${normalized.fullName} was surfaced from GitHub search for AI agent repositories.`,
      outboundUrls: [normalized.sourceUrl, normalized.homepage].filter(Boolean),
      tags,
      category,
      integrationHint: deriveIntegrationHint({
        category,
        language: normalized.language,
      }),
      author: normalized.owner,
      metrics: {
        mentions: 1,
        upvotes: 0,
        comments: 0,
        shares: 0,
      },
      sourceAuthority: {
        authority: GITHUB_AUTHORITY_SCORE,
      },
      scoringSignals: {
        recencyHours: recencyHours(publishedAt, window.until),
        sourceAuthority: GITHUB_AUTHORITY_SCORE,
        mentionCount: 1,
        githubStars: normalized.stars,
        githubActivity: calculateGitHubActivity({
          pushedAt: normalized.pushedAt,
          updatedAt: normalized.updatedAt,
          createdAt: normalized.createdAt,
          stars: normalized.stars,
          forks: normalized.forks,
          windowUntil: window.until,
        }),
        socialEngagement: 0,
      },
      riskWarning: buildRiskWarning(normalized),
      metadata: {
        discoveryChannels: ["search"],
        discoveryUrls: [requestUrl],
        sourceProvenance: [provenance],
        fetchedAt,
        fetchTimestamps: [fetchedAt],
        searchQueries: [query],
        github: {
          fullName: normalized.fullName,
          owner: normalized.owner,
          entityKey: normalized.fullName.toLowerCase(),
          repoRootUrl: normalized.sourceUrl,
          homepage: normalized.homepage,
          channel: "search",
          channels: ["search"],
          stars: normalized.stars,
          forks: normalized.forks,
          watchers: normalized.watchers,
          openIssues: normalized.openIssues,
          starsToday: 0,
          language: normalized.language,
          topics: normalized.topics,
          license: normalized.license,
          archived: normalized.archived,
          defaultBranch: normalized.defaultBranch,
          createdAt: normalized.createdAt,
          updatedAt: normalized.updatedAt,
          pushedAt: normalized.pushedAt,
          searchRank: rank,
          trendingRank: null,
          searchRanks: [rank],
          trendingRanks: [],
          provenance: [provenance],
          fetchedAt,
          fetchTimestamps: [fetchedAt],
        },
        raw: {
          search: [repository],
          trending: [],
        },
      },
      raw: repository,
    };
  }

  async fetchTrending(window) {
    const requestUrl = this.buildTrendingUrl();
    const response = await this.requestWithRateLimitRetry({
      requestUrl,
      accept: "text/html",
      failureLabel: "trending",
    });

    const fetchedAt = this.createFetchTimestamp();
    const payload = await response.text();

    return parseTrendingHtml(payload, this.webBaseUrl)
      .map((repository, index) =>
        this.normalizeTrendingRepository(repository, {
          rank: index + 1,
          requestUrl,
          responseUrl: response.url ?? requestUrl,
          fetchedAt,
          window,
        }),
      )
      .filter(Boolean);
  }

  normalizeTrendingRepository(repository, {
    rank,
    requestUrl,
    responseUrl,
    fetchedAt,
    window,
  }) {
    const tags = ["github", "ai-agents", repository.language].filter(Boolean);

    if (
      !isAiAgentRepository({
        title: repository.title,
        summary: repository.summary,
        tags,
      })
    ) {
      return null;
    }

    const category = categorizeRepository({
      title: repository.title,
      summary: repository.summary,
      tags,
    });
    const provenance = createGitHubSourceProvenance({
      adapterId: this.id,
      sourceKind: this.descriptor.kind,
      sourceName: this.name,
      channel: "trending",
      requestUrl,
      fetchedFromUrl: responseUrl ?? requestUrl,
      fetchedAt,
      rank,
    });

    return {
      adapterId: this.id,
      sourceType: "github",
      externalId: repository.externalId,
      title: repository.title,
      sourceName: this.name,
      sourceUrl: repository.sourceUrl,
      sourceUrls: [repository.sourceUrl],
      publishedAt: null,
      discoveredAt: window.until.toISOString(),
      summary:
        repository.summary ??
        `${repository.fullName} is trending on GitHub for AI agent workflows.`,
      outboundUrls: [repository.sourceUrl],
      tags,
      category,
      integrationHint: deriveIntegrationHint({
        category,
        language: repository.language,
      }),
      author: repository.owner,
      metrics: {
        mentions: 1,
        upvotes: repository.starsToday,
        comments: 0,
        shares: 0,
      },
      sourceAuthority: {
        authority: GITHUB_AUTHORITY_SCORE,
      },
      scoringSignals: {
        recencyHours: 24,
        sourceAuthority: GITHUB_AUTHORITY_SCORE,
        mentionCount: 1,
        githubStars: repository.stars,
        githubActivity: calculateTrendingActivity(repository.starsToday),
        socialEngagement: repository.starsToday,
      },
      riskWarning: buildRiskWarning(repository),
      metadata: {
        discoveryChannels: ["trending"],
        discoveryUrls: [requestUrl],
        sourceProvenance: [provenance],
        fetchedAt,
        fetchTimestamps: [fetchedAt],
        searchQueries: [],
        github: {
          fullName: repository.fullName,
          owner: repository.owner,
          entityKey: repository.fullName.toLowerCase(),
          repoRootUrl: repository.sourceUrl,
          homepage: null,
          channel: "trending",
          channels: ["trending"],
          stars: repository.stars,
          forks: repository.forks,
          watchers: repository.watchers,
          openIssues: repository.openIssues,
          starsToday: repository.starsToday,
          language: repository.language,
          topics: repository.topics,
          license: repository.license,
          archived: repository.archived,
          defaultBranch: repository.defaultBranch,
          createdAt: repository.createdAt,
          updatedAt: repository.updatedAt,
          pushedAt: repository.pushedAt,
          searchRank: null,
          trendingRank: rank,
          searchRanks: [],
          trendingRanks: [rank],
          provenance: [provenance],
          fetchedAt,
          fetchTimestamps: [fetchedAt],
        },
        raw: {
          search: [],
          trending: [repository],
        },
      },
      raw: repository,
    };
  }

  async fetchItems({
    since,
    until,
    limit = undefined,
    searchLimit = limit ?? this.searchLimit,
    searchPageSize = null,
    includeTrending = this.includeTrending,
  } = {}) {
    this.assertEnabled();
    const window = normalizeFetchWindow({ since, until });

    const searchBatches = await Promise.all(
      this.searchTerms.map((term) =>
        this.fetchSearchTerm(term, window, {
          limit: searchLimit,
          pageSize: searchPageSize,
        }),
      ),
    );
    const trendingItems = includeTrending ? await this.fetchTrending(window) : [];

    return mergeRecords([...searchBatches.flat(), ...trendingItems]);
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
