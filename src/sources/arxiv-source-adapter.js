import {
  createNormalizedItemFromSourceRecord,
  createSourceDescriptor,
} from "../core/schema.js";
import {
  SourceAdapter,
  SourceAdapterConfigurationError,
  ensureFetchImplementation,
  normalizeFetchWindow,
  resolveRetryAfterMs,
} from "./source-adapter.js";

export const DEFAULT_ARXIV_BASE_URL = "https://export.arxiv.org/api/query";
export const DEFAULT_ARXIV_USER_AGENT =
  "agent-newsletter/0.1 (+https://example.invalid/agent-newsletter)";
export const DEFAULT_ARXIV_MAX_RESULTS = 25;
export const DEFAULT_ARXIV_RATE_LIMIT_MAX_RETRIES = 0;
export const DEFAULT_ARXIV_RATE_LIMIT_RETRY_AFTER_MS = 3_000;
export const DEFAULT_ARXIV_CATEGORIES = Object.freeze([
  "cs.AI",
  "cs.CL",
  "cs.LG",
  "cs.MA",
]);
export const DEFAULT_ARXIV_AGENT_TERMS = Object.freeze([
  "AI agent",
  "AI agents",
  "agentic",
  "LLM agent",
  "LLM agents",
  "autonomous agent",
  "autonomous agents",
  "multi-agent",
  "multi-agent system",
  "tool-using agent",
]);

const ARXIV_AUTHORITY_SCORE = 95;
const ARXIV_MINIMUM_ITEM_AUTHORITY_SCORE = 70;
const ARXIV_PAGE_SIZE_CAP = 100;
const ARXIV_TOTAL_RESULTS_CAP = 500;
const ARXIV_TAG_RULES = Object.freeze({
  "topic:ai-agents": [
    /\bai agents?\b/iu,
    /\bagentic\b/iu,
    /\bllm agents?\b/iu,
    /\bautonomous agents?\b/iu,
    /\bmulti-agent\b/iu,
  ],
  "topic:tool-use": [
    /\btool[- ]using\b/iu,
    /\bfunction calling\b/iu,
    /\btool invocation\b/iu,
  ],
  "topic:planning": [/\bplanning\b/iu, /\bplanner\b/iu],
  "topic:memory": [/\bmemory\b/iu, /\bepisodic\b/iu],
  "topic:retrieval": [/\bretrieval\b/iu, /\brag\b/iu],
  "topic:evaluation": [/\bbenchmark\b/iu, /\bevaluation\b/iu, /\bjudge\b/iu],
  "candidate:library": [/\bframework\b/iu, /\blibrary\b/iu, /\bsdk\b/iu, /\bruntime\b/iu],
  "candidate:api": [/\bapis?\b/iu, /\bendpoint\b/iu],
  "candidate:technique": [/\btechnique\b/iu, /\bmethod\b/iu, /\bapproach\b/iu],
});

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeList(values, fieldName) {
  const normalized = (values ?? [])
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    throw new SourceAdapterConfigurationError(
      `arXiv adapter requires at least one ${fieldName}.`,
    );
  }

  return [...new Set(normalized)];
}

function buildDefaultQuery(categories, agentTerms) {
  return [
    `(${categories.map((category) => `cat:${category}`).join(" OR ")})`,
    `(${agentTerms.map((term) => `all:"${term}"`).join(" OR ")})`,
  ].join(" AND ");
}

function normalizePositiveInteger(value, fieldName, fallback) {
  if (value == null) {
    return fallback;
  }

  const normalized = Number(value);

  if (!Number.isFinite(normalized)) {
    throw new SourceAdapterConfigurationError(
      `arXiv adapter field \`${fieldName}\` must be numeric.`,
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
      `arXiv adapter field \`${fieldName}\` must be numeric.`,
    );
  }

  return Math.max(0, Math.trunc(normalized));
}

function clampMaxResults(value) {
  return Math.min(
    ARXIV_TOTAL_RESULTS_CAP,
    normalizePositiveInteger(value, "maxResults", DEFAULT_ARXIV_MAX_RESULTS),
  );
}

function resolvePageSize(limit, pageSize = null) {
  const normalizedLimit = clampMaxResults(limit);
  const normalizedPageSize = normalizePositiveInteger(
    pageSize,
    "pageSize",
    normalizedLimit,
  );

  return Math.min(ARXIV_PAGE_SIZE_CAP, normalizedLimit, normalizedPageSize);
}

function normalizeStartIndex(value) {
  return normalizeNonNegativeInteger(value, "start", 0);
}

function resolveFetchTimestamp(nowImpl) {
  const value = nowImpl();
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new SourceAdapterConfigurationError(
      "arXiv adapter now() must return a valid date.",
    );
  }

  return date.toISOString();
}

function arxivTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "")
    .replace(/\.\d{3}Z$/, "");
}

function parseXmlAttributes(value) {
  const attributes = {};
  const expression = /([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g;
  let match = expression.exec(value);

  while (match) {
    attributes[match[1]] = decodeXmlEntities(match[2]);
    match = expression.exec(value);
  }

  return attributes;
}

function matchBlocks(xml, tagName) {
  const expression = new RegExp(
    `<${escapeRegExp(tagName)}\\b[^>]*>([\\s\\S]*?)</${escapeRegExp(tagName)}>`,
    "giu",
  );

  return [...xml.matchAll(expression)].map((match) => match[1]);
}

function matchSelfClosingTags(xml, tagName) {
  const expression = new RegExp(
    `<${escapeRegExp(tagName)}\\b([^>]*)\\/?>`,
    "giu",
  );

  return [...xml.matchAll(expression)].map((match) => parseXmlAttributes(match[1]));
}

function extractTagText(xml, tagName) {
  const [match] = matchBlocks(xml, tagName);
  return normalizeText(match);
}

function extractFirstAttribute(xml, tagName, attributeName) {
  const [attributes] = matchSelfClosingTags(xml, tagName);
  return attributes?.[attributeName] ?? null;
}

function extractAllAttributes(xml, tagName, attributeName) {
  return [
    ...new Set(
      matchSelfClosingTags(xml, tagName)
        .map((attributes) => attributes[attributeName] ?? null)
        .filter(Boolean),
    ),
  ];
}

function decodeXmlEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/gu, (_, codePoint) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10)),
    );
}

function normalizeText(value) {
  if (!value) {
    return "";
  }

  return decodeXmlEntities(
    String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1"),
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimTrailingUrlPunctuation(value) {
  return String(value ?? "").replace(/[),.;!?]+$/u, "");
}

function extractUrlsFromText(value) {
  return [
    ...new Set(
      (String(value ?? "").match(/https?:\/\/[^\s<>"']+/giu) ?? [])
        .map((match) => trimTrailingUrlPunctuation(match))
        .filter(Boolean),
    ),
  ];
}

function canonicalizeArxivUrl(value, { keepVersion = false } = {}) {
  if (!value) {
    return null;
  }

  const url = new URL(String(value).trim());
  url.protocol = "https:";
  url.hostname = "arxiv.org";
  url.hash = "";

  const absMatch = url.pathname.match(/^\/abs\/([^/]+)$/u);
  if (absMatch) {
    const identifier = keepVersion ? absMatch[1] : absMatch[1].replace(/v\d+$/u, "");
    url.pathname = `/abs/${identifier}`;
    url.search = "";
    return url.toString();
  }

  const pdfMatch = url.pathname.match(/^\/pdf\/([^/]+?)(?:\.pdf)?$/u);
  if (pdfMatch) {
    url.pathname = `/pdf/${pdfMatch[1]}`;
    url.search = "";
    return url.toString();
  }

  return url.toString();
}

function extractArxivIdentifier(sourceUrl, { keepVersion = false } = {}) {
  const url = new URL(sourceUrl);
  const identifier = url.pathname.split("/").filter(Boolean).pop() ?? "";
  return keepVersion ? identifier : identifier.replace(/v\d+$/u, "");
}

function extractArxivId(sourceUrl) {
  return extractArxivIdentifier(sourceUrl);
}

function extractArxivVersionedId(sourceUrl) {
  return extractArxivIdentifier(sourceUrl, { keepVersion: true });
}

function buildDoiUrl(doi) {
  if (!doi) {
    return null;
  }

  const url = new URL("https://doi.org");
  url.pathname = `/${String(doi).trim().replace(/^\/+/u, "")}`;
  return url.toString();
}

function summarizeAuthors(authors) {
  if (authors.length === 0) {
    return null;
  }

  if (authors.length === 1) {
    return authors[0];
  }

  return `${authors[0]} et al.`;
}

function buildTags({ title, summary, primaryCategory, categories, comment }) {
  const haystack = [title, summary, comment].filter(Boolean).join(" ");
  const tags = [
    "source:arxiv",
    "content:paper",
    "curation:research",
  ];

  if (/\bagent/iu.test(haystack)) {
    tags.push("topic:ai-agents");
  }

  if (primaryCategory) {
    tags.push(`arxiv:primary:${primaryCategory}`);
  }

  for (const category of categories) {
    tags.push(`arxiv:category:${category}`);
  }

  for (const [tag, expressions] of Object.entries(ARXIV_TAG_RULES)) {
    if (expressions.some((expression) => expression.test(haystack))) {
      tags.push(tag);
    }
  }

  return [...new Set(tags)].sort();
}

function categorizePaper({ title, summary, tags }) {
  const haystack = [title, summary, ...tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /\b(api|apis|endpoint|sdk)\b/u.test(haystack) &&
    /\b(service|platform|toolkit|release|integration)\b/u.test(haystack)
  ) {
    return "api";
  }

  if (
    /\b(framework|library|sdk|runtime|toolkit|package)\b/u.test(haystack) &&
    /\b(open source|open-source|implementation|repository|repo|package)\b/u.test(haystack)
  ) {
    return "library";
  }

  return "technique";
}

function deriveIntegrationHint(category) {
  if (category === "api") {
    return "Extract the API-calling workflow from the paper, then validate auth, rate limits, and sandboxing before adopting it.";
  }

  if (category === "library") {
    return "Look for linked code or companion repos and validate the implementation details before porting the paper into your agent runtime.";
  }

  return "Translate the paper's method, evaluation setup, and cited resources into a small experiment before shipping it into an agent workflow.";
}

function buildRiskWarning() {
  return {
    severity: "medium",
    description:
      "Research artifacts can be incomplete or non-reproducible. Validate claims, licenses, and any linked code before integration.",
  };
}

function withinWindow(date, window) {
  return date >= window.since && date <= window.until;
}

function isArxivRateLimitedResponse(response) {
  return response?.status === 429 || response?.status === 503;
}

export class ArxivSourceAdapter extends SourceAdapter {
  constructor({
    id = "arxiv",
    name = "arXiv",
    enabled = true,
    baseUrl = DEFAULT_ARXIV_BASE_URL,
    userAgent = DEFAULT_ARXIV_USER_AGENT,
    maxResults = DEFAULT_ARXIV_MAX_RESULTS,
    categories = DEFAULT_ARXIV_CATEGORIES,
    agentTerms = DEFAULT_ARXIV_AGENT_TERMS,
    query = null,
    rateLimitMaxRetries = DEFAULT_ARXIV_RATE_LIMIT_MAX_RETRIES,
    rateLimitRetryAfterMs = DEFAULT_ARXIV_RATE_LIMIT_RETRY_AFTER_MS,
    now = () => new Date(),
    fetch: fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
  } = {}) {
    super({
      id,
      name,
      type: "arxiv",
      enabled,
    });

    this.descriptor = createSourceDescriptor({
      id,
      kind: "arxiv",
      displayName: name,
      authorityScore: ARXIV_AUTHORITY_SCORE,
      seeded: true,
      supportsDiscovery: true,
      minimumItemAuthorityScore: ARXIV_MINIMUM_ITEM_AUTHORITY_SCORE,
    });
    this.baseUrl = baseUrl;
    this.userAgent = String(userAgent).trim() || DEFAULT_ARXIV_USER_AGENT;
    this.maxResults = clampMaxResults(maxResults);
    this.categories = normalizeList(categories, "category");
    this.agentTerms = normalizeList(agentTerms, "agent term");
    this.query = query?.trim() || buildDefaultQuery(this.categories, this.agentTerms);
    this.rateLimitMaxRetries = normalizeNonNegativeInteger(
      rateLimitMaxRetries,
      "rateLimitMaxRetries",
      DEFAULT_ARXIV_RATE_LIMIT_MAX_RETRIES,
    );
    this.rateLimitRetryAfterMs = normalizeNonNegativeInteger(
      rateLimitRetryAfterMs,
      "rateLimitRetryAfterMs",
      DEFAULT_ARXIV_RATE_LIMIT_RETRY_AFTER_MS,
    );

    if (typeof now !== "function") {
      throw new SourceAdapterConfigurationError(
        "arXiv adapter now must be a function.",
      );
    }

    this.now = now;
    this.fetchImpl = ensureFetchImplementation(fetchImpl);

    if (typeof sleep !== "function") {
      throw new SourceAdapterConfigurationError(
        "arXiv adapter requires `sleep` to be a function when provided.",
      );
    }

    this.sleep = sleep;
  }

  buildQueryUrl({ since, until, limit = this.maxResults, pageSize = null, start = 0 }) {
    const normalizedLimit = clampMaxResults(limit);
    const url = new URL(this.baseUrl);
    url.searchParams.set(
      "search_query",
      `${this.query} AND submittedDate:[${arxivTimestamp(since)} TO ${arxivTimestamp(until)}]`,
    );
    url.searchParams.set("start", String(normalizeStartIndex(start)));
    url.searchParams.set(
      "max_results",
      String(resolvePageSize(normalizedLimit, pageSize)),
    );
    url.searchParams.set("sortBy", "submittedDate");
    url.searchParams.set("sortOrder", "descending");
    return url.toString();
  }

  normalizeEntry(entry, window, fetchContext = {}) {
    const title = extractTagText(entry, "title");
    const summary = extractTagText(entry, "summary");
    const sourceUrl = canonicalizeArxivUrl(extractTagText(entry, "id"));
    const publishedAt = new Date(extractTagText(entry, "published"));
    const updatedAt = new Date(extractTagText(entry, "updated"));

    if (!title || !summary || !sourceUrl || Number.isNaN(publishedAt.getTime())) {
      return null;
    }

    if (!withinWindow(publishedAt, window)) {
      return null;
    }

    const authorBlocks = matchBlocks(entry, "author");
    const authors = authorBlocks
      .map((authorBlock) => extractTagText(authorBlock, "name"))
      .filter(Boolean);
    const authorAffiliations = authorBlocks
      .map((authorBlock) => extractTagText(authorBlock, "arxiv:affiliation"))
      .filter(Boolean);
    const primaryCategory = extractFirstAttribute(
      entry,
      "arxiv:primary_category",
      "term",
    );
    const categories = extractAllAttributes(entry, "category", "term");
    const versionedSourceUrl = canonicalizeArxivUrl(
      matchSelfClosingTags(entry, "link").find(
        (attributes) => attributes.rel === "alternate" && attributes.href,
      )?.href ?? sourceUrl,
      { keepVersion: true },
    );
    const pdfUrl = canonicalizeArxivUrl(
      matchSelfClosingTags(entry, "link").find(
        (attributes) => attributes.title === "pdf" && attributes.href,
      )?.href ?? null,
      { keepVersion: true },
    );
    const doi = extractTagText(entry, "arxiv:doi") || null;
    const doiUrl = buildDoiUrl(doi);
    const comment = extractTagText(entry, "arxiv:comment") || null;
    const sourceUrls = [
      ...new Set([sourceUrl, versionedSourceUrl, pdfUrl, doiUrl].filter(Boolean)),
    ];
    const outboundUrls = [
      ...new Set([
        pdfUrl,
        doiUrl,
        ...extractUrlsFromText(summary),
        ...extractUrlsFromText(comment),
      ].filter(Boolean)),
    ];
    const canonicalId = extractArxivId(sourceUrl);
    const versionedId = extractArxivVersionedId(versionedSourceUrl);
    const tags = buildTags({
      title,
      summary,
      primaryCategory,
      categories,
      comment,
    });
    const category = categorizePaper({ title, summary, tags });
    const socialEngagement = 0;
    const fetchWindow = {
      since: window.since.toISOString(),
      until: window.until.toISOString(),
    };
    const sourceProvenance = {
      adapterId: this.id,
      sourceKind: this.descriptor.kind,
      sourceName: this.name,
      query: this.query,
      queryUrl: fetchContext.requestUrl ?? null,
      requestedUrl: fetchContext.requestUrl ?? null,
      fetchedFromUrl:
        fetchContext.responseUrl ?? fetchContext.requestUrl ?? null,
      fetchedAt: fetchContext.fetchedAt ?? null,
    };

    return {
      adapterId: this.id,
      sourceType: "arxiv",
      externalId: canonicalId,
      title,
      sourceName: this.name,
      sourceUrl,
      sourceUrls,
      publishedAt: publishedAt.toISOString(),
      discoveredAt: window.until.toISOString(),
      summary,
      outboundUrls,
      tags,
      category,
      integrationHint: deriveIntegrationHint(category),
      author: summarizeAuthors(authors),
      metrics: {
        mentions: 1,
        upvotes: 0,
        comments: 0,
        shares: 0,
      },
      sourceAuthority: {
        authority: ARXIV_AUTHORITY_SCORE,
      },
      scoringSignals: {
        recencyHours: Math.max(
          0,
          (window.until.getTime() - publishedAt.getTime()) / 3_600_000,
        ),
        sourceAuthority: ARXIV_AUTHORITY_SCORE,
        mentionCount: 1,
        githubStars: null,
        githubActivity: null,
        socialEngagement,
      },
      riskWarning: buildRiskWarning(),
      metadata: {
        canonicalId,
        versionedId,
        versionedSourceUrl,
        primaryCategory,
        categories,
        pdfUrl,
        doi,
        doiUrl,
        authorNames: authors,
        authorAffiliations,
        comment,
        query: this.query,
        fetchWindow,
        fetchedAt: fetchContext.fetchedAt ?? null,
        fetchedFromUrl:
          fetchContext.responseUrl ?? fetchContext.requestUrl ?? null,
        sourceProvenance,
        updatedAt: Number.isNaN(updatedAt.getTime()) ? null : updatedAt.toISOString(),
        arxiv: {
          canonicalId,
          versionedId,
          versionedSourceUrl,
          primaryCategory,
          categories,
          pdfUrl,
          doi,
          doiUrl,
          authorNames: authors,
          authorAffiliations,
          comment,
          query: this.query,
          fetchWindow,
          fetchedAt: fetchContext.fetchedAt ?? null,
          fetchedFromUrl:
            fetchContext.responseUrl ?? fetchContext.requestUrl ?? null,
          sourceProvenance,
          updatedAt: Number.isNaN(updatedAt.getTime()) ? null : updatedAt.toISOString(),
        },
      },
      raw: {
        entry,
        fetchedAt: fetchContext.fetchedAt ?? null,
        requestUrl: fetchContext.requestUrl ?? null,
        responseUrl:
          fetchContext.responseUrl ?? fetchContext.requestUrl ?? null,
      },
    };
  }

  parseFeed(xml, window, fetchContext = {}) {
    return matchBlocks(xml, "entry")
      .map((entry) => this.normalizeEntry(entry, window, fetchContext))
      .filter(Boolean)
      .sort(
        (left, right) =>
          new Date(right.publishedAt).getTime() -
          new Date(left.publishedAt).getTime(),
      );
  }

  async requestFeedPage(requestUrl) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(requestUrl, {
        headers: {
          accept: "application/atom+xml",
          "user-agent": this.userAgent,
        },
      });

      if (response.ok) {
        return response;
      }

      const rateLimited = isArxivRateLimitedResponse(response);
      const retryAfterMs = rateLimited
        ? resolveRetryAfterMs(response, this.rateLimitRetryAfterMs)
        : this.rateLimitRetryAfterMs;

      if (rateLimited && attempt < this.rateLimitMaxRetries) {
        if (retryAfterMs > 0) {
          await this.sleep(retryAfterMs);
        }

        continue;
      }

      throw new SourceAdapterConfigurationError(
        `arXiv adapter request failed: ${response.status} ${response.statusText}`,
        {
          requestUrl,
          ...(rateLimited ? { rateLimit: { retryAfterMs } } : {}),
        },
      );
    }
  }

  async fetchItems({ since, until, limit = this.maxResults, pageSize = null } = {}) {
    this.assertEnabled();
    const window = normalizeFetchWindow({ since, until });
    const normalizedLimit = clampMaxResults(limit);
    const normalizedPageSize = resolvePageSize(normalizedLimit, pageSize);
    const records = [];

    for (let start = 0; start < normalizedLimit; start += normalizedPageSize) {
      const remaining = normalizedLimit - start;
      const currentPageSize = Math.min(normalizedPageSize, remaining);
      const requestUrl = this.buildQueryUrl({
        ...window,
        limit: currentPageSize,
        pageSize: currentPageSize,
        start,
      });
      const response = await this.requestFeedPage(requestUrl);
      const body = await response.text();
      const fetchedAt = resolveFetchTimestamp(this.now);

      records.push(
        ...this.parseFeed(body, window, {
          fetchedAt,
          requestUrl,
          responseUrl: response.url ?? requestUrl,
        }),
      );

      if (matchBlocks(body, "entry").length < currentPageSize) {
        break;
      }
    }

    return records;
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
