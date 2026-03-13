export function countDistinctSourceClusters(sourceUrls = []) {
  return new Set(sourceUrls.map((url) => buildMentionSourceClusterId(url)).filter(Boolean)).size;
}

function buildMentionSourceClusterId(url) {
  try {
    const parsed = new URL(url);
    const hostname = normalizeClusterHostname(parsed.hostname);

    if (hostname === "x.com") {
      const handle = extractXHandle(parsed.pathname);
      return handle ? `x:account:${handle}` : "x:domain:x.com";
    }

    return hostname;
  } catch {
    return null;
  }
}

function normalizeClusterHostname(hostname) {
  const lowered = String(hostname ?? "").trim().toLowerCase();

  if (
    lowered === "twitter.com" ||
    lowered === "www.twitter.com" ||
    lowered === "mobile.twitter.com"
  ) {
    return "x.com";
  }

  return lowered.replace(/^www\./u, "");
}

function extractXHandle(pathname) {
  const reservedPaths = new Set([
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
    "compose",
  ]);
  const segments = String(pathname ?? "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  const handle = segments[0].replace(/^@/u, "").toLowerCase();

  if (!handle || reservedPaths.has(handle)) {
    return null;
  }

  return handle;
}
