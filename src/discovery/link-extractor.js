import { DEFAULT_DISCOVERY_CONFIG } from "./config.js";

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/giu;
const RESERVED_X_PATHS = new Set([
  "home",
  "explore",
  "search",
  "i",
  "intent",
  "share",
  "hashtag",
  "messages",
  "notifications",
  "settings",
  "compose"
]);

export function extractOutboundLinks(item) {
  const urls = new Set();
  const metadataOutboundUrls = Array.isArray(item.metadata?.outboundUrls)
    ? item.metadata.outboundUrls
    : [];

  for (const value of [
    ...(item.outboundLinks ?? []),
    ...(item.outboundUrls ?? []),
    ...metadataOutboundUrls,
  ]) {
    if (typeof value === "string" && value.trim()) {
      urls.add(value.trim());
    }
  }

  for (const field of [item.content, item.summary, item.title, item.name]) {
    if (typeof field !== "string") {
      continue;
    }

    for (const match of field.matchAll(URL_PATTERN)) {
      urls.add(match[0]);
    }
  }

  return Array.from(urls);
}

export function buildSourceCandidate(url, config = DEFAULT_DISCOVERY_CONFIG) {
  const normalized = normalizeUrl(url);

  if (!normalized) {
    return null;
  }

  const hostname = normalizeHostname(normalized.hostname);

  if (config.ignoredDomains.has(hostname)) {
    return null;
  }

  if (isXHostname(hostname)) {
    const handle = extractXHandle(normalized.pathname);

    if (!handle) {
      return null;
    }

    return {
      id: `x:account:${handle}`,
      kind: "x",
      entityType: "account",
      platform: "x",
      value: handle,
      displayName: `@${handle} on X`,
      url: `https://x.com/${handle}`,
      canonicalUrl: `https://x.com/${handle}`,
      fetchUrl: `https://x.com/${handle}`,
      discoveredUrl: normalized.toString()
    };
  }

  const kind = inferSourceKind(hostname);

  return {
    id: `${kind}:domain:${hostname}`,
    kind,
    entityType: "domain",
    platform: "web",
    value: hostname,
    displayName: hostname,
    url: `https://${hostname}`,
    canonicalUrl: `https://${hostname}`,
    fetchUrl: resolveWebFetchUrl(normalized),
    discoveredUrl: normalized.toString()
  };
}

export function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const parsed = new URL(value.trim());

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    parsed.hash = "";
    stripTrackingParams(parsed.searchParams);

    if (!parsed.searchParams.size) {
      parsed.search = "";
    }

    parsed.hostname = normalizeHostname(parsed.hostname);

    if (isXHostname(parsed.hostname)) {
      parsed.pathname = normalizeXPath(parsed.pathname);
    }

    return parsed;
  } catch {
    return null;
  }
}

export function normalizeHostname(hostname) {
  const lowered = hostname.trim().toLowerCase();

  if (
    lowered === "twitter.com" ||
    lowered === "www.twitter.com" ||
    lowered === "mobile.twitter.com"
  ) {
    return "x.com";
  }

  return lowered.replace(/^www\./u, "");
}

function stripTrackingParams(searchParams) {
  const keys = Array.from(searchParams.keys());

  for (const key of keys) {
    if (
      key.startsWith("utm_") ||
      key === "ref" ||
      key === "ref_src" ||
      key === "si"
    ) {
      searchParams.delete(key);
    }
  }
}

function isXHostname(hostname) {
  return hostname === "x.com";
}

function inferSourceKind(hostname) {
  if (hostname === "github.com") {
    return "github";
  }

  if (hostname === "arxiv.org") {
    return "arxiv";
  }

  if (hostname === "reddit.com") {
    return "reddit";
  }

  return "web";
}

function resolveWebFetchUrl(url) {
  if (!url) {
    return null;
  }

  if (url.pathname === "/" && !url.search) {
    return `https://${normalizeHostname(url.hostname)}`;
  }

  return url.toString();
}

function normalizeXPath(pathname) {
  const segments = pathname
    .split("/")
    .map((segment) => segment.trim());

  const handleIndex = segments.findIndex((segment) => segment.length > 0);

  if (handleIndex === -1) {
    return pathname;
  }

  const handle = segments[handleIndex].replace(/^@/u, "");

  if (!handle || RESERVED_X_PATHS.has(handle.toLowerCase())) {
    return pathname;
  }

  segments[handleIndex] = handle.toLowerCase();

  return segments.join("/") || "/";
}

function extractXHandle(pathname) {
  const segments = pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) {
    return null;
  }

  const [first] = segments;

  if (RESERVED_X_PATHS.has(first.toLowerCase())) {
    return null;
  }

  const handle = first.replace(/^@/u, "").toLowerCase();

  if (!/^[a-z0-9_]{1,15}$/u.test(handle)) {
    return null;
  }

  return handle;
}
