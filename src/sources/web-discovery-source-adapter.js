import { createSourceDescriptor, createNormalizedItemFromSourceRecord } from "../core/schema.js";
import { normalizeUrl } from "../discovery/link-extractor.js";
import { collectTopicHits } from "../discovery/scoring.js";
import { findRetirementBlockedCategories } from "../discovery/source-coverage.js";
import {
  isSourceFetchEligible,
  recordSourceFetchFailure,
  recordSourceFetchSuccess,
  resolveSourceLifecycleState,
} from "../discovery/source-lifecycle.js";
import {
  ensureFetchImplementation,
  SourceAdapterConfigurationError,
} from "./source-adapter.js";

export const DEFAULT_WEB_DISCOVERY_USER_AGENT =
  "agent-newsletter/0.1 (+https://example.invalid/agent-newsletter)";
export const DEFAULT_WEB_DISCOVERY_MAX_SOURCES = 20;
export const DEFAULT_WEB_DISCOVERY_TIMEOUT_MS = 10_000;

const WEB_DISCOVERY_DESCRIPTOR = Object.freeze({
  id: "web-discovery",
  kind: "web",
  displayName: "Broader Web Discovery",
  authorityScore: 50,
  seeded: true,
  supportsDiscovery: true,
  minimumItemAuthorityScore: 50,
});
const MAX_OUTBOUND_URLS = 50;
const MAX_SUMMARY_LENGTH = 320;

export class WebDiscoverySourceAdapter {
  constructor({
    enabled = true,
    sourceRepository,
    fetch = globalThis.fetch,
    userAgent = DEFAULT_WEB_DISCOVERY_USER_AGENT,
    maxSources = DEFAULT_WEB_DISCOVERY_MAX_SOURCES,
    timeoutMs = DEFAULT_WEB_DISCOVERY_TIMEOUT_MS,
  } = {}) {
    if (!sourceRepository || typeof sourceRepository.listFetchableSources !== "function") {
      throw new SourceAdapterConfigurationError(
        "WebDiscoverySourceAdapter requires a sourceRepository with listFetchableSources({ now })",
      );
    }

    this.enabled = enabled;
    this.sourceRepository = sourceRepository;
    this.fetchImpl = ensureFetchImplementation(fetch);
    this.userAgent = normalizeUserAgent(userAgent);
    this.maxSources = normalizeLimit(maxSources, "maxSources");
    this.timeoutMs = normalizeLimit(timeoutMs, "timeoutMs");
    this.descriptor = createSourceDescriptor(WEB_DISCOVERY_DESCRIPTOR);
  }

  async fetch(window) {
    if (!this.enabled) {
      return { items: [] };
    }

    const now = window?.endsAt ?? new Date().toISOString();
    const snapshot = await this.sourceRepository.load({ now });
    const targets = snapshot.sources
      .filter(isApprovedDynamicWebSource)
      .filter((source) =>
        isSourceFetchEligible(source, {
          now,
        }),
      )
      .slice(0, this.maxSources);

    if (targets.length === 0) {
      return { items: [] };
    }

    const outcomes = await Promise.all(
      targets.map(async (source) => {
        try {
          return {
            source,
            status: "success",
            item: await this.fetchApprovedSource(source, window),
          };
        } catch (error) {
          return {
            source,
            status: "failure",
            error,
          };
        }
      }),
    );
    const items = [];

    for (const outcome of outcomes) {
      if (outcome.status === "failure") {
        const blockedCategories = findRetirementBlockedCategories(
          snapshot.sources,
          outcome.source,
          this.sourceRepository.config,
        );
        recordSourceFetchFailure(
          outcome.source,
          now,
          this.sourceRepository.config,
          {
            retirementGuard: {
              blockedCategories,
            },
          },
        );
        continue;
      }

      recordSourceFetchSuccess(outcome.source, now);

      if (outcome.item) {
        items.push(outcome.item);
      }
    }

    await this.sourceRepository.save({
      ...snapshot,
      updatedAt: now,
    });

    return { items };
  }

  async fetchApprovedSource(source, window) {
    const response = await this.fetchImpl(
      source.fetchUrl ?? source.url,
      buildRequestInit(this.userAgent, this.timeoutMs),
    );

    if (!response.ok) {
      throw new Error(
        `web-discovery fetch failed for ${source.id}: ${response.status} ${response.statusText}`,
      );
    }

    if (!isHtmlResponse(response.headers)) {
      throw new Error(`web-discovery expected HTML for ${source.id}`);
    }

    const html = await response.text();
    const page = parseHtmlPage({
      html,
      fallbackUrl: response.url || source.fetchUrl || source.url,
      headers: response.headers,
      source,
    });

    if (!page) {
      return null;
    }

    const publishedAt = resolveCurrentWindowTimestamp(page, source, window);

    if (!publishedAt) {
      return null;
    }

    const topicHits = collectTopicHits([
      page.title,
      page.summary,
      page.excerpt,
      page.canonicalUrl,
    ]);

    if (topicHits.length === 0) {
      return null;
    }

    const mentionCount = Math.max(
      1,
      Number(source.evidence?.discoveryCount ?? source.discoveredFromUrls?.length ?? 1),
    );
    const category = categorizePage(page);

    return createNormalizedItemFromSourceRecord({
      adapterId: this.descriptor.id,
      sourceType: this.descriptor.kind,
      externalId: source.id,
      title: page.title,
      sourceName: source.displayName,
      sourceUrl: page.canonicalUrl,
      publishedAt,
      summary: page.summary,
      outboundUrls: page.outboundUrls,
      tags: topicHits,
      category,
      integrationHint: buildIntegrationHint(category),
      author: null,
      metrics: {
        mentions: mentionCount,
        upvotes: 0,
        comments: 0,
        shares: 0,
      },
      sourceAuthority: {
        authority: source.authorityScore,
      },
      riskWarning: buildRiskWarning(source),
      metadata: {
        approvedSourceId: source.id,
        approvedSourceKind: source.kind,
        fetchedFromUrl: source.fetchUrl ?? source.url,
        pageLastModifiedAt: page.modifiedAt,
      },
      raw: {
        sourceId: source.id,
        canonicalUrl: page.canonicalUrl,
        fetchedUrl: response.url || source.fetchUrl || source.url,
      },
    });
  }
}

function normalizeUserAgent(value) {
  const normalized = String(value ?? "").trim();
  return normalized || DEFAULT_WEB_DISCOVERY_USER_AGENT;
}

function normalizeLimit(value, fieldName) {
  const normalized = Number(value);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new SourceAdapterConfigurationError(`${fieldName} must be a positive number.`);
  }

  return Math.trunc(normalized);
}

function isApprovedDynamicWebSource(source) {
  return (
    source?.status === "approved" &&
    resolveSourceLifecycleState(source) !== "retired" &&
    source?.seed !== true &&
    source?.kind === "web"
  );
}

function buildRequestInit(userAgent, timeoutMs) {
  const requestInit = {
    headers: {
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      "user-agent": userAgent,
    },
  };

  if (typeof AbortSignal?.timeout === "function") {
    requestInit.signal = AbortSignal.timeout(timeoutMs);
  }

  return requestInit;
}

function isHtmlResponse(headers) {
  const contentType = String(headers.get("content-type") ?? "").toLowerCase();
  return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}

function parseHtmlPage({ html, fallbackUrl, headers, source }) {
  const baseUrl = normalizeUrl(fallbackUrl)?.toString() ?? source.url;
  const title =
    firstNonEmpty(
      findMetaContent(html, ["og:title", "twitter:title"]),
      extractTitle(html),
      source.displayName,
    ) ?? source.displayName;
  const excerpt = extractExcerpt(html);
  const summary =
    firstNonEmpty(
      findMetaContent(html, ["description", "og:description", "twitter:description"]),
      excerpt,
      `Recently discovered coverage from ${source.displayName}.`,
    ) ?? `Recently discovered coverage from ${source.displayName}.`;
  const canonicalUrl =
    normalizeCandidateUrl(resolveCanonicalUrl(html, baseUrl) ?? baseUrl) ?? source.url;

  return {
    title: squeezeWhitespace(title),
    summary: truncateSummary(summary),
    excerpt,
    canonicalUrl,
    outboundUrls: extractOutboundUrls(html, canonicalUrl),
    publishedAt: normalizeTimestampCandidate(
      firstNonEmpty(
        findMetaContent(html, [
          "article:published_time",
          "og:article:published_time",
          "date",
          "publish_date",
        ]),
        extractTimeDatetime(html),
      ),
    ),
    modifiedAt: normalizeTimestampCandidate(
      firstNonEmpty(
        findMetaContent(html, [
          "article:modified_time",
          "og:updated_time",
          "last-modified",
        ]),
        headers.get("last-modified"),
      ),
    ),
  };
}

function resolveCurrentWindowTimestamp(page, source, window) {
  for (const candidate of [
    page.publishedAt,
    page.modifiedAt,
    source.lastSeenAt,
    source.approvedAt,
    source.discoveredAt,
  ]) {
    if (isTimestampWithinWindow(candidate, window)) {
      return candidate;
    }
  }

  return null;
}

function categorizePage(page) {
  const haystack = [page.title, page.summary, page.excerpt].join(" ").toLowerCase();

  if (/\b(api|endpoint|rest|graphql|sdk api)\b/u.test(haystack)) {
    return "api";
  }

  if (/\b(library|sdk|package|module|framework|gem|npm|crate)\b/u.test(haystack)) {
    return "library";
  }

  if (/\b(guide|tutorial|pattern|technique|playbook|recipe|workflow)\b/u.test(haystack)) {
    return "technique";
  }

  return "tool";
}

function buildIntegrationHint(category) {
  if (category === "api") {
    return "Review the API surface, authentication requirements, and rate limits before wiring an agent to this source.";
  }

  if (category === "library") {
    return "Review the install and quickstart guidance before adding this library to an agent runtime.";
  }

  if (category === "technique") {
    return "Extract the concrete workflow steps and validate them in a sandbox before adopting this technique.";
  }

  return "Review the setup guidance and operational constraints before integrating this source into an agent workflow.";
}

function buildRiskWarning(source) {
  if ((source.authorityScore ?? 0) >= 75) {
    return {
      severity: "low",
      description:
        "This source cleared the approval threshold, but you should still verify maintenance status and operational fit before integration.",
    };
  }

  return {
    severity: "medium",
    description:
      "This is a newly approved external source. Validate its security posture, maintenance signals, and ecosystem adoption before integrating it.",
  };
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu);
  return match ? decodeHtmlEntities(stripHtml(match[1])) : null;
}

function resolveCanonicalUrl(html, baseUrl) {
  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const attributes = parseAttributes(match[0]);
    const rel = String(attributes.rel ?? "").toLowerCase();

    if (!rel.split(/\s+/u).includes("canonical")) {
      continue;
    }

    return toAbsoluteUrl(attributes.href, baseUrl);
  }

  return null;
}

function findMetaContent(html, keys) {
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));

  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attributes = parseAttributes(match[0]);
    const key = String(attributes.property ?? attributes.name ?? "").toLowerCase();
    const content = attributes.content;

    if (normalizedKeys.has(key) && typeof content === "string" && content.trim()) {
      return decodeHtmlEntities(content.trim());
    }
  }

  return null;
}

function extractTimeDatetime(html) {
  const match = html.match(/<time\b[^>]*datetime=(["'])(.*?)\1/iu);
  return match?.[2] ?? null;
}

function extractExcerpt(html) {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ");
  const text = squeezeWhitespace(stripHtml(withoutScripts));

  return truncateSummary(text);
}

function extractOutboundUrls(html, baseUrl) {
  const urls = [];

  for (const match of html.matchAll(/<a\b[^>]*href=(["'])(.*?)\1/giu)) {
    const absoluteUrl = normalizeCandidateUrl(toAbsoluteUrl(match[2], baseUrl));

    if (!absoluteUrl || urls.includes(absoluteUrl)) {
      continue;
    }

    urls.push(absoluteUrl);

    if (urls.length >= MAX_OUTBOUND_URLS) {
      break;
    }
  }

  return urls;
}

function parseAttributes(fragment) {
  const attributes = {};

  for (const match of fragment.matchAll(
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu,
  )) {
    const key = String(match[1] ?? "").toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";

    if (!key) {
      continue;
    }

    attributes[key] = value;
  }

  return attributes;
}

function toAbsoluteUrl(value, baseUrl) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return new URL(value.trim(), baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizeCandidateUrl(value) {
  return normalizeUrl(value)?.toString() ?? null;
}

function normalizeTimestampCandidate(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function isTimestampWithinWindow(timestamp, window) {
  if (
    typeof timestamp !== "string" ||
    typeof window?.startsAt !== "string" ||
    typeof window?.endsAt !== "string"
  ) {
    return false;
  }

  const value = Date.parse(timestamp);
  const startsAt = Date.parse(window.startsAt);
  const endsAt = Date.parse(window.endsAt);

  if ([value, startsAt, endsAt].some((candidate) => Number.isNaN(candidate))) {
    return false;
  }

  return value >= startsAt && value <= endsAt;
}

function truncateSummary(value) {
  const normalized = squeezeWhitespace(value);

  if (normalized.length <= MAX_SUMMARY_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…`;
}

function stripHtml(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ");
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

function squeezeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0) ?? null;
}
