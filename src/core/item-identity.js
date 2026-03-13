import { canonicalizeUrl, normalizeComparableText, slugify, uniqueStrings } from "./contracts.js";

const TRACKING_QUERY_PARAMS = new Set(["ref", "source", "s", "t"]);

const DUPLICATE_CATEGORY_GROUPS = {
  tool: "artifact",
  api: "artifact",
  library: "artifact",
  technique: "technique",
};

const TITLE_NOISE_TOKENS = new Set([
  "a",
  "an",
  "the",
  "new",
  "official",
  "introducing",
  "introduces",
  "introduced",
  "announcing",
  "announced",
  "launch",
  "launches",
  "launched",
  "release",
  "releases",
  "released",
  "thread",
  "threads",
  "discussion",
  "post",
  "blog",
  "article",
  "guide",
  "guides",
  "getting",
  "started",
  "docs",
  "documentation",
  "tutorial",
  "tips",
  "tip",
  "step",
  "steps",
  "setup",
  "install",
  "installation",
  "configure",
  "configuration",
  "validate",
  "notes",
  "news",
  "update",
  "updates",
  "review",
  "demo",
  "overview",
  "reference",
]);

const URL_NOISE_ALIASES = new Set([
  "blog",
  "docs",
  "doc",
  "post",
  "posts",
  "article",
  "articles",
  "news",
  "update",
  "updates",
  "launch",
  "release",
  "releases",
  "guide",
  "guides",
  "tutorial",
  "tutorials",
  "install",
  "installation",
  "getting started",
  "get started",
  "status",
  "comments",
]);

const IDENTITY_SIGNAL_PREFIX = "identity:";
const EXACT_MATCH_SIGNAL_TYPES = new Set(["canonical_url", "repo_root", "canonical_id"]);
const ENTITY_CANONICAL_SIGNAL_TYPES = new Set(["repo_root", "canonical_id"]);
const ALIAS_SIGNAL_PRIORITIES = new Map([
  ["repo_full_name_alias", 0],
  ["repo_name_alias", 1],
  ["slug_alias", 2],
  ["host_alias", 3],
  ["name_alias", 4],
]);
const CANONICAL_ID_SIGNAL_PRIORITIES = new Map([
  ["github", 0],
  ["arxiv", 1],
  ["doi", 2],
  ["generic", 3],
]);
const SOCIAL_IDENTITY_HOSTS = new Set(["x.com", "reddit.com"]);
const DOI_HOSTS = new Set(["doi.org", "www.doi.org"]);
const VERSION_TOKEN_PATTERN = /^(?:v?\d+(?:\.\d+)*|rc\d+|beta\d*|alpha\d*)$/iu;
const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const GITHUB_URL_IN_TEXT_PATTERN = /\bgithub\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/giu;
const GITHUB_TEXT_IDENTIFIER_PATTERNS = [
  /\bgithub(?:\s+repo(?:sitory)?)?\s*[:=-]?\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/giu,
  /\brepo(?:sitory)?\s*[:=-]\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/giu,
];
const ARXIV_ID_IN_TEXT_PATTERN = /\barxiv\s*[:#]?\s*(\d{4}\.\d{4,5})(?:v\d+)?\b/giu;
const DOI_IN_TEXT_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/giu;
const ENTITY_NAME_TEXT_PATTERN =
  /\b((?:[A-Z][A-Za-z0-9]*(?:[-/][A-Za-z0-9]+)*|[A-Z]{2,})(?:\s+(?:[A-Z][A-Za-z0-9]*(?:[-/][A-Za-z0-9]+)*|[A-Z]{2,})){0,5})\b/gu;
const TEXT_SIMILARITY_NOISE_TOKENS = new Set([
  "and",
  "agent",
  "agents",
  "ai",
  "api",
  "apis",
  "app",
  "apps",
  "assistant",
  "assistants",
  "automation",
  "autonomous",
  "by",
  "cli",
  "cloud",
  "demo",
  "docs",
  "documentation",
  "framework",
  "frameworks",
  "guide",
  "guides",
  "for",
  "from",
  "in",
  "integration",
  "integrations",
  "kit",
  "library",
  "libraries",
  "model",
  "models",
  "of",
  "on",
  "open",
  "orchestrator",
  "orchestration",
  "platform",
  "runtime",
  "runtimes",
  "sdk",
  "sdks",
  "service",
  "services",
  "system",
  "systems",
  "technique",
  "techniques",
  "to",
  "tool",
  "tools",
  "with",
  "without",
]);
const HOST_ALIAS_NOISE_LABELS = new Set([
  "www",
  "m",
  "mobile",
  "app",
  "api",
  "blog",
  "blogs",
  "community",
  "developer",
  "developers",
  "devportal",
  "devtools",
  "docs",
  "documentation",
  "forum",
  "forums",
  "help",
  "news",
  "pages",
  "platform",
  "portal",
  "readthedocs",
  "site",
  "status",
  "support",
  "web",
  "www2",
  "co",
  "com",
  "net",
  "org",
  "github",
  "gitlab",
  "vercel",
  "netlify",
  "substack",
]);
const TEXT_SIMILARITY_THRESHOLD = 0.8;
export const ENTITY_RESOLUTION_MATCH_KINDS = Object.freeze({
  REPOSITORY_URL: "repository_url",
  DOI: "doi",
  OFFICIAL_SITE_URL: "official_site_url",
  ENTITY_NAME: "entity_name",
  CANONICAL_ID: "canonical_id",
  TEXT_SIMILARITY: "text_similarity",
});
const ENTITY_RESOLUTION_MATCH_PRIORITIES = new Map([
  [ENTITY_RESOLUTION_MATCH_KINDS.REPOSITORY_URL, 0],
  [ENTITY_RESOLUTION_MATCH_KINDS.DOI, 1],
  [ENTITY_RESOLUTION_MATCH_KINDS.OFFICIAL_SITE_URL, 2],
  [ENTITY_RESOLUTION_MATCH_KINDS.ENTITY_NAME, 3],
  [ENTITY_RESOLUTION_MATCH_KINDS.CANONICAL_ID, 4],
  [ENTITY_RESOLUTION_MATCH_KINDS.TEXT_SIMILARITY, 5],
]);

export function resolveDuplicateCategoryGroup(category) {
  return DUPLICATE_CATEGORY_GROUPS[category] ?? category;
}

export function buildItemIdentitySignals(item) {
  const categoryGroup = resolveDuplicateCategoryGroup(item.category);
  const relatedUrls = collectRelatedUrls(item);

  return uniqueStrings([
    ...readIdentitySignals(item),
    ...buildCanonicalEntitySignals(item),
    ...relatedUrls.map((value) => createSignal("canonical_url", value)),
    ...relatedUrls.flatMap((value) => createUrlIdentitySignals(value, categoryGroup)),
    createAliasSignal(categoryGroup, "name_alias", normalizeIdentityAlias(item.name)),
  ]).filter(Boolean);
}

export function annotateItemIdentitySignals(item) {
  const identitySignals = buildItemIdentitySignals(item);

  if (hasSameIdentitySignals(item.metadata?.identitySignals, identitySignals)) {
    return item;
  }

  return {
    ...item,
    metadata: {
      ...(item.metadata ?? {}),
      identitySignals,
    },
  };
}

export function buildStableItemId(item) {
  const categoryGroup = resolveDuplicateCategoryGroup(item.category);
  const reference =
    selectCanonicalEntityIdentity(item) ??
    selectCanonicalEntityNameReference(item) ??
    item.name;
  const slug = slugify([categoryGroup, normalizeStableItemReference(reference)].join(" "));

  if (!slug) {
    throw new TypeError("Unable to derive a stable item id");
  }

  return slug;
}

export function extractCanonicalIdentifiersFromContent(item) {
  const textValues = collectIdentifierTextValues(item);
  const extractedUrls = uniqueStrings(textValues.flatMap((value) => extractUrlsFromText(value)));
  const repositoryUrl =
    findGitHubRepositoryUrl(extractedUrls) ??
    createGitHubRepositoryUrl(firstDefinedValue(extractGitHubSourceIdsFromText(textValues)));
  const arxivId = firstDefinedValue([
    ...extractedUrls.map((value) => extractArxivIdFromUrl(value)).filter(Boolean),
    ...extractArxivIdsFromText(textValues),
  ]);
  const doi = firstDefinedValue([
    ...extractedUrls.map((value) => normalizeOptionalDoi(value)).filter(Boolean),
    ...extractDoisFromText(textValues),
  ]);
  const githubSourceId = extractGitHubSourceId(repositoryUrl);
  const sourceIds = {
    ...(githubSourceId ? { github: githubSourceId } : {}),
    ...(arxivId ? { arxiv: arxivId } : {}),
  };

  if (!repositoryUrl && !doi && Object.keys(sourceIds).length === 0) {
    return null;
  }

  return {
    entityName: deriveEntityNameFromRepositoryUrl(repositoryUrl),
    repositoryUrl: repositoryUrl ?? null,
    doi: doi ?? null,
    sourceIds,
  };
}

export function resolveCanonicalIdentifiers(item, providedIdentifiers = null) {
  const merged = mergeCanonicalIdentifiers(
    item?.canonicalIdentifiers ?? null,
    providedIdentifiers,
    {
      entityName: selectCanonicalEntityName(item),
      repositoryUrl: selectCanonicalRepositoryUrl(item),
      doi: selectCanonicalDoi(item),
      sourceIds: selectCanonicalSourceIds(item),
    },
  );

  return {
    entityName: merged.entityName ?? selectCanonicalEntityName(item),
    repositoryUrl: merged.repositoryUrl ?? null,
    doi: merged.doi ?? null,
    sourceIds: merged.sourceIds ?? {},
  };
}

export function itemsShareCanonicalIdentity(left, right) {
  if (resolveDuplicateCategoryGroup(left.category) !== resolveDuplicateCategoryGroup(right.category)) {
    return false;
  }

  return hasSharedExactIdentitySignal(
    buildItemIdentitySignals(left),
    buildItemIdentitySignals(right),
  );
}

export function mergeCanonicalIdentifiers(...values) {
  const normalizedValues = values
    .map((value) => normalizeCanonicalIdentifiers(value))
    .filter(Boolean);
  const sourceIds = {};

  for (const identifiers of normalizedValues) {
    for (const [key, value] of Object.entries(identifiers.sourceIds)) {
      if (!(key in sourceIds)) {
        sourceIds[key] = value;
      }
    }
  }

  return {
    entityName: firstDefinedValue(normalizedValues.map((value) => value.entityName)),
    repositoryUrl: firstDefinedValue(normalizedValues.map((value) => value.repositoryUrl)),
    doi: firstDefinedValue(normalizedValues.map((value) => value.doi)),
    sourceIds,
  };
}

export function itemsShareIdentity(left, right) {
  if (resolveDuplicateCategoryGroup(left.category) !== resolveDuplicateCategoryGroup(right.category)) {
    return false;
  }

  const leftSignals = buildItemIdentitySignals(left);
  const rightSignals = buildItemIdentitySignals(right);
  if (hasSharedExactIdentitySignal(leftSignals, rightSignals)) {
    return true;
  }

  if (hasConflictingCanonicalEntitySignals(leftSignals, rightSignals)) {
    return false;
  }

  if (findNormalizedEntityNameMatch(left, right, leftSignals, rightSignals)) {
    return true;
  }

  if (hasCorroboratedAliasOverlap(leftSignals, rightSignals)) {
    return true;
  }

  return hasTextSimilarityOverlap(left, right, leftSignals, rightSignals);
}

export function resolveEntityIdentityMatch(left, right, { allowTextSimilarity = true } = {}) {
  if (resolveDuplicateCategoryGroup(left.category) !== resolveDuplicateCategoryGroup(right.category)) {
    return null;
  }

  const leftSignals = buildItemIdentitySignals(left);
  const rightSignals = buildItemIdentitySignals(right);
  const repositoryUrl = findSharedExactIdentitySignalValue(leftSignals, rightSignals, (parsed) =>
    parsed.type === "repo_root" ? parsed.value : null,
  );

  if (repositoryUrl) {
    return createEntityResolutionMatch(ENTITY_RESOLUTION_MATCH_KINDS.REPOSITORY_URL, repositoryUrl);
  }

  const doi = findSharedCanonicalIdValue(leftSignals, rightSignals, {
    namespaces: ["doi"],
  });

  if (doi) {
    return createEntityResolutionMatch(ENTITY_RESOLUTION_MATCH_KINDS.DOI, doi);
  }

  const officialSiteUrl = findSharedOfficialSiteUrlValue(leftSignals, rightSignals);

  if (officialSiteUrl) {
    return createEntityResolutionMatch(
      ENTITY_RESOLUTION_MATCH_KINDS.OFFICIAL_SITE_URL,
      officialSiteUrl,
    );
  }

  if (hasConflictingCanonicalEntitySignals(leftSignals, rightSignals)) {
    return null;
  }

  const entityName = findNormalizedEntityNameMatch(left, right, leftSignals, rightSignals);

  if (entityName) {
    return createEntityResolutionMatch(ENTITY_RESOLUTION_MATCH_KINDS.ENTITY_NAME, entityName);
  }

  const canonicalId = findSharedCanonicalIdValue(leftSignals, rightSignals, {
    excludedNamespaces: ["doi"],
  });

  if (canonicalId) {
    return createEntityResolutionMatch(ENTITY_RESOLUTION_MATCH_KINDS.CANONICAL_ID, canonicalId);
  }

  if (!allowTextSimilarity) {
    return null;
  }

  const textSimilarityScore = resolveBestTextSimilarityScore(left, right, leftSignals, rightSignals);

  if (textSimilarityScore < TEXT_SIMILARITY_THRESHOLD) {
    return null;
  }

  return createEntityResolutionMatch(ENTITY_RESOLUTION_MATCH_KINDS.TEXT_SIMILARITY, null, {
    score: textSimilarityScore,
  });
}

function hasSameIdentitySignals(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) {
    return false;
  }

  const leftSet = new Set(left);
  return right.every((signal) => leftSet.has(signal));
}

function hasCorroboratedAliasOverlap(leftSignals, rightSignals) {
  return findCorroboratedAliasOverlapValue(leftSignals, rightSignals) != null;
}

function findCorroboratedAliasOverlapValue(leftSignals, rightSignals) {
  const leftAliases = indexAliasSignals(leftSignals);
  const rightAliases = indexAliasSignals(rightSignals);
  const matches = [];

  for (const [value, leftTypes] of leftAliases) {
    const rightTypes = rightAliases.get(value);

    if (!rightTypes || !isSpecificAlias(value)) {
      continue;
    }

    if (!hasCorroboratingAliasType(leftTypes) || !hasCorroboratingAliasType(rightTypes)) {
      continue;
    }

    const combinedTypes = new Set([...leftTypes, ...rightTypes]);

    if (combinedTypes.size >= 2) {
      matches.push({
        value,
        typePriority: resolveAliasMatchPriority(combinedTypes),
      });
    }
  }

  matches.sort(
    (left, right) =>
      left.typePriority - right.typePriority ||
      right.value.length - left.value.length ||
      left.value.localeCompare(right.value),
  );

  return matches[0]?.value ?? null;
}

function hasSharedExactIdentitySignal(leftSignals, rightSignals) {
  const rightSignalSet = new Set(rightSignals);

  for (const signal of leftSignals) {
    if (rightSignalSet.has(signal) && EXACT_MATCH_SIGNAL_TYPES.has(parseSignal(signal).type)) {
      return true;
    }
  }

  return false;
}

function hasConflictingCanonicalEntitySignals(leftSignals, rightSignals) {
  const leftCanonicalSignals = extractCanonicalEntitySignalValues(leftSignals);
  const rightCanonicalSignals = extractCanonicalEntitySignalValues(rightSignals);

  if (leftCanonicalSignals.size === 0 || rightCanonicalSignals.size === 0) {
    return false;
  }

  for (const signal of leftCanonicalSignals) {
    if (rightCanonicalSignals.has(signal)) {
      return false;
    }
  }

  return true;
}

function indexAliasSignals(signals) {
  const aliases = new Map();

  for (const signal of signals) {
    const parsed = parseSignal(signal);

    if (parsed.type !== "alias") {
      continue;
    }

    const [categoryGroup, signalType, value] = parsed.value.split(":", 3);

    if (!categoryGroup || !signalType || !value) {
      continue;
    }

    if (!aliases.has(value)) {
      aliases.set(value, new Set());
    }

    aliases.get(value).add(signalType);
  }

  return aliases;
}

function extractSignalValues(signals, type) {
  const values = new Set();

  for (const signal of signals) {
    const parsed = parseSignal(signal);

    if (parsed.type === type && parsed.value) {
      values.add(parsed.value);
    }
  }

  return values;
}

function extractCanonicalEntitySignalValues(signals) {
  const values = new Set();

  for (const signal of signals) {
    const parsed = parseSignal(signal);

    if (ENTITY_CANONICAL_SIGNAL_TYPES.has(parsed.type) && parsed.value) {
      values.add(`${parsed.type}:${parsed.value}`);
    }
  }

  return values;
}

function isSpecificAlias(value) {
  const tokens = value.split(" ").filter(Boolean);

  if (tokens.length >= 2) {
    return true;
  }

  return value.length >= 8;
}

function hasCorroboratingAliasType(signalTypes) {
  for (const signalType of signalTypes) {
    if (signalType !== "name_alias") {
      return true;
    }
  }

  return false;
}

function createUrlIdentitySignals(value, categoryGroup) {
  const url = new URL(value);
  const hostname = url.hostname;
  const pathSegments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  const signals = [];

  if (hostname === "github.com" && pathSegments.length >= 2) {
    const owner = pathSegments[0].toLowerCase();
    const repository = pathSegments[1].toLowerCase();
    const repoRoot = `${url.origin}/${owner}/${repository}`;

    signals.push(createSignal("repo_root", repoRoot));
    signals.push(createAliasSignal(categoryGroup, "repo_name_alias", normalizeIdentityAlias(repository)));
    signals.push(
      createAliasSignal(
        categoryGroup,
        "repo_full_name_alias",
        normalizeIdentityAlias(`${owner} ${repository}`),
      ),
    );
    return signals.filter(Boolean);
  }

  for (const alias of extractMeaningfulHostAliases(hostname)) {
    signals.push(createAliasSignal(categoryGroup, "host_alias", alias));
  }

  for (const alias of extractMeaningfulPathAliases(pathSegments, hostname)) {
    signals.push(createAliasSignal(categoryGroup, "slug_alias", alias));
  }

  return signals.filter(Boolean);
}

function buildCanonicalEntitySignals(item) {
  const metadata = item.metadata ?? {};
  const canonicalIdentifiers = normalizeCanonicalIdentifiers(item.canonicalIdentifiers ?? null);
  const signals = [];
  const githubEntityKey = normalizeCanonicalIdentifier(
    canonicalIdentifiers?.sourceIds.github ??
      metadata.github?.entityKey ??
      metadata.github?.fullName ??
      null,
  );
  const githubRepoRoot = normalizeOptionalIdentityUrl(
    canonicalIdentifiers?.repositoryUrl ?? metadata.github?.repoRootUrl ?? null,
  );
  const arxivCanonicalId = normalizeCanonicalIdentifier(
    canonicalIdentifiers?.sourceIds.arxiv ??
    metadata.arxiv?.canonicalId ??
      (isArxivIdentitySource(item, metadata) ? metadata.canonicalId ?? null : null),
  );
  const genericCanonicalId =
    arxivCanonicalId == null
      ? normalizeCanonicalIdentifier(
          canonicalIdentifiers?.sourceIds.generic ?? metadata.canonicalId ?? null,
        )
      : null;
  const doi = normalizeDoiIdentity(
    canonicalIdentifiers?.doi ?? metadata.arxiv?.doi ?? metadata.doi ?? metadata.doiUrl ?? null,
  );

  if (githubRepoRoot) {
    signals.push(createSignal("repo_root", githubRepoRoot));
  }

  if (githubEntityKey) {
    signals.push(createCanonicalIdSignal("github", githubEntityKey));
  }

  if (arxivCanonicalId) {
    signals.push(createCanonicalIdSignal("arxiv", arxivCanonicalId));
  }

  if (doi) {
    signals.push(createCanonicalIdSignal("doi", doi));
  }

  if (genericCanonicalId) {
    signals.push(createCanonicalIdSignal("generic", genericCanonicalId));
  }

  return signals.filter(Boolean);
}

function extractMeaningfulPathAliases(pathSegments, hostname) {
  if (hostname === "x.com") {
    return [];
  }

  if (hostname === "reddit.com") {
    const slug = normalizeIdentityAlias(pathSegments[pathSegments.length - 1]);
    return slug && !URL_NOISE_ALIASES.has(slug) ? [slug] : [];
  }

  const aliases = [];

  for (let index = pathSegments.length - 1; index >= 0; index -= 1) {
    const alias = normalizeIdentityAlias(pathSegments[index]);

    if (!alias || URL_NOISE_ALIASES.has(alias)) {
      continue;
    }

    aliases.push(alias);

    if (aliases.length === 2) {
      break;
    }
  }

  return uniqueStrings(aliases);
}

function collectRelatedUrls(item) {
  const outboundUrls = Array.isArray(item.metadata?.outboundUrls) ? item.metadata.outboundUrls : [];

  return uniqueStrings(
    [item.sourceUrl, ...(Array.isArray(item.sourceUrls) ? item.sourceUrls : []), ...outboundUrls].map(
      (value) => normalizeIdentityUrl(value),
    ),
  );
}

function selectRepoRootIdentity(item) {
  for (const signal of buildItemIdentitySignals(item)) {
    const parsed = parseSignal(signal);

    if (parsed.type === "repo_root" && parsed.value) {
      return parsed.value;
    }
  }

  return null;
}

function selectCanonicalEntityIdentity(item) {
  const references = [];

  for (const signal of buildItemIdentitySignals(item)) {
    const parsed = parseSignal(signal);

    if (parsed.type === "repo_root" && parsed.value) {
      references.push({
        priority: -1,
        value: parsed.value,
      });
      continue;
    }

    if (parsed.type !== "canonical_id" || !parsed.value) {
      continue;
    }

    const [namespace] = parsed.value.split(":", 1);

    references.push({
      priority: CANONICAL_ID_SIGNAL_PRIORITIES.get(namespace) ?? CANONICAL_ID_SIGNAL_PRIORITIES.get("generic"),
      value: parsed.value,
    });
  }

  references.sort(
    (left, right) =>
      left.priority - right.priority ||
      left.value.length - right.value.length ||
      left.value.localeCompare(right.value),
  );

  return references[0]?.value ?? null;
}

function selectCanonicalEntityNameReference(item) {
  return normalizeOptionalEntityNameReference(
    resolveCanonicalIdentifiers(item)?.entityName ?? selectCanonicalEntityName(item),
  );
}

function normalizeOptionalEntityNameReference(value) {
  const normalized = normalizeOptionalString(value);

  return normalized ? normalizeIdentityAlias(normalized) : null;
}

function hasTextSimilarityOverlap(left, right, leftSignals, rightSignals) {
  return resolveBestTextSimilarityScore(left, right, leftSignals, rightSignals) >= TEXT_SIMILARITY_THRESHOLD;
}

function resolveBestTextSimilarityScore(left, right, leftSignals, rightSignals) {
  const leftReferences = collectTextSimilarityReferences(left, leftSignals);
  const rightReferences = collectTextSimilarityReferences(right, rightSignals);

  if (leftReferences.length === 0 || rightReferences.length === 0) {
    return 0;
  }

  let bestScore = 0;

  for (const leftReference of leftReferences) {
    for (const rightReference of rightReferences) {
      bestScore = Math.max(bestScore, scoreTextSimilarity(leftReference, rightReference));
    }
  }

  return bestScore;
}

function collectTextSimilarityReferences(item, signals = buildItemIdentitySignals(item)) {
  const references = [];

  for (const signal of signals) {
    const parsed = parseSignal(signal);

    if (parsed.type !== "alias") {
      continue;
    }

    const [, signalType, value] = parsed.value.split(":", 3);

    if (signalType === "host_alias") {
      continue;
    }

    if (value && isSimilarityEligibleReference(value)) {
      references.push(value);
    }
  }

  const normalizedName = normalizeIdentityAlias(item.name);

  if (normalizedName && isSimilarityEligibleReference(normalizedName)) {
    references.push(normalizedName);
  }

  return uniqueStrings(references).sort((left, right) => right.length - left.length);
}

function isSimilarityEligibleReference(value) {
  const informativeTokens = extractInformativeTextTokens(value);

  if (informativeTokens.length >= 2) {
    return true;
  }

  return informativeTokens.some((token) => token.length >= 8);
}

function extractInformativeTextTokens(value) {
  return normalizeComparableText(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !TEXT_SIMILARITY_NOISE_TOKENS.has(token));
}

function scoreTextSimilarity(leftReference, rightReference) {
  const leftTokens = extractInformativeTextTokens(leftReference);
  const rightTokens = extractInformativeTextTokens(rightReference);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const leftTokenSet = new Set(leftTokens);
  const rightTokenSet = new Set(rightTokens);
  let overlapCount = 0;

  for (const token of leftTokenSet) {
    if (rightTokenSet.has(token)) {
      overlapCount += 1;
    }
  }

  return (overlapCount * 2) / (leftTokenSet.size + rightTokenSet.size);
}

function normalizeStableItemReference(reference) {
  if (!reference.startsWith("http://") && !reference.startsWith("https://")) {
    return reference;
  }

  const url = new URL(reference);
  return [url.hostname, ...url.pathname.split("/").filter(Boolean)].join(" ");
}

function normalizeCanonicalIdentifiers(value) {
  if (value == null) {
    return null;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("canonicalIdentifiers must be an object");
  }

  return {
    entityName: normalizeOptionalString(value.entityName ?? value.entity_name),
    repositoryUrl: normalizeOptionalRepositoryUrl(
      value.repositoryUrl ?? value.repository_url ?? null,
    ),
    doi: normalizeOptionalDoi(value.doi ?? null),
    sourceIds: normalizeCanonicalSourceIds(
      value.sourceIds ?? value.source_ids ?? {},
      "canonicalIdentifiers.sourceIds",
    ),
  };
}

function createEntityResolutionMatch(kind, value, extra = {}) {
  return {
    kind,
    priority:
      ENTITY_RESOLUTION_MATCH_PRIORITIES.get(kind) ??
      ENTITY_RESOLUTION_MATCH_PRIORITIES.get(ENTITY_RESOLUTION_MATCH_KINDS.TEXT_SIMILARITY),
    ...(value ? { value } : {}),
    ...extra,
  };
}

function findSharedExactIdentitySignalValue(leftSignals, rightSignals, readValue) {
  const rightValues = new Set(
    rightSignals
      .map((signal) => readValue(parseSignal(signal)))
      .filter(Boolean),
  );

  if (rightValues.size === 0) {
    return null;
  }

  const values = leftSignals
    .map((signal) => readValue(parseSignal(signal)))
    .filter(Boolean)
    .filter((value) => rightValues.has(value))
    .sort((left, right) => left.length - right.length || left.localeCompare(right));

  return values[0] ?? null;
}

function findSharedCanonicalIdValue(
  leftSignals,
  rightSignals,
  { namespaces = null, excludedNamespaces = [] } = {},
) {
  const namespaceFilter = namespaces == null ? null : new Set(namespaces);
  const excludedNamespaceFilter = new Set(excludedNamespaces);
  const rightCanonicalIds = new Set(
    rightSignals
      .map((signal) => readCanonicalIdSignalValue(signal, namespaceFilter, excludedNamespaceFilter))
      .filter(Boolean),
  );

  if (rightCanonicalIds.size === 0) {
    return null;
  }

  const values = leftSignals
    .map((signal) => readCanonicalIdSignalValue(signal, namespaceFilter, excludedNamespaceFilter))
    .filter(Boolean)
    .filter((value) => rightCanonicalIds.has(value))
    .sort((left, right) => left.length - right.length || left.localeCompare(right));

  return values[0] ?? null;
}

function findSharedOfficialSiteUrlValue(leftSignals, rightSignals) {
  return findSharedExactIdentitySignalValue(leftSignals, rightSignals, (parsed) => {
    if (parsed.type !== "canonical_url" || !parsed.value) {
      return null;
    }

    return isOfficialSiteIdentityUrl(parsed.value) ? parsed.value : null;
  });
}

function isOfficialSiteIdentityUrl(value) {
  const url = new URL(value);

  return !SOCIAL_IDENTITY_HOSTS.has(url.hostname) && !DOI_HOSTS.has(url.hostname);
}

function readCanonicalIdSignalValue(signal, namespaceFilter, excludedNamespaceFilter) {
  const parsed = parseSignal(signal);

  if (parsed.type !== "canonical_id" || !parsed.value) {
    return null;
  }

  const [namespace, ...valueParts] = parsed.value.split(":");
  const value = valueParts.join(":");

  if (!namespace || !value) {
    return null;
  }

  if (excludedNamespaceFilter.has(namespace)) {
    return null;
  }

  if (namespaceFilter && !namespaceFilter.has(namespace)) {
    return null;
  }

  return `${namespace}:${value}`;
}

function findNormalizedEntityNameMatch(left, right, leftSignals, rightSignals) {
  const leftEntityName = normalizeCanonicalEntityNameForMatching(left);
  const rightEntityName = normalizeCanonicalEntityNameForMatching(right);

  if (
    leftEntityName &&
    rightEntityName &&
    leftEntityName === rightEntityName &&
    isSpecificAlias(leftEntityName) &&
    hasEntityNameCorroboration(left, leftSignals, leftEntityName) &&
    hasEntityNameCorroboration(right, rightSignals, rightEntityName)
  ) {
    return leftEntityName;
  }

  return findCorroboratedAliasOverlapValue(leftSignals, rightSignals);
}

function normalizeCanonicalEntityNameForMatching(item) {
  const entityName = normalizeIdentityAlias(resolveCanonicalIdentifiers(item)?.entityName ?? null);

  return entityName && isSpecificAlias(entityName) ? entityName : null;
}

function hasEntityNameCorroboration(item, signals, entityName) {
  const normalizedDisplayName = normalizeIdentityAlias(item.name);
  const rawName = normalizeComparableText(item.name);

  if (normalizedDisplayName === entityName && rawName && rawName !== entityName) {
    return true;
  }

  for (const signal of signals) {
    const parsed = parseSignal(signal);

    if (parsed.type !== "alias") {
      continue;
    }

    const [, signalType, value] = parsed.value.split(":", 3);

    if (value === entityName && signalType !== "name_alias") {
      return true;
    }
  }

  return (
    normalizedDisplayName === entityName &&
    buildCanonicalEntitySignals({
      ...item,
      canonicalIdentifiers: resolveCanonicalIdentifiers(item),
    }).length > 0
  );
}

function resolveAliasMatchPriority(signalTypes) {
  let bestPriority = Number.POSITIVE_INFINITY;

  for (const signalType of signalTypes) {
    bestPriority = Math.min(bestPriority, ALIAS_SIGNAL_PRIORITIES.get(signalType) ?? 99);
  }

  return bestPriority;
}

function readIdentitySignals(item) {
  const signals = item.metadata?.identitySignals;

  if (!Array.isArray(signals)) {
    return [];
  }

  return uniqueStrings(
    signals.filter((signal) => typeof signal === "string" && signal.startsWith(IDENTITY_SIGNAL_PREFIX)),
  );
}

function collectIdentifierTextValues(item) {
  return [
    item?.name,
    item?.summary,
    item?.integrationHint,
  ].filter((value) => typeof value === "string" && value.trim().length > 0);
}

function extractUrlsFromText(value) {
  const matches = String(value ?? "").matchAll(URL_IN_TEXT_PATTERN);
  const urls = [];

  for (const match of matches) {
    const normalized = normalizeOptionalIdentityUrl(trimTrailingUrlPunctuation(match[0]));

    if (normalized) {
      urls.push(normalized);
    }
  }

  return uniqueStrings(urls);
}

function trimTrailingUrlPunctuation(value) {
  return String(value ?? "").replace(/[),.;:!?]+$/u, "");
}

function normalizeIdentityUrl(value) {
  const url = new URL(canonicalizeUrl(value));

  url.hostname = url.hostname.toLowerCase().replace(/^www\./u, "");

  if (url.hostname === "twitter.com") {
    url.hostname = "x.com";
  }

  if (url.hostname === "github.com") {
    url.pathname = url.pathname.toLowerCase();
  }

  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || TRACKING_QUERY_PARAMS.has(key)) {
      url.searchParams.delete(key);
    }
  }

  return url.toString();
}

function findGitHubRepositoryUrl(values = []) {
  for (const value of values) {
    const sourceId = extractGitHubSourceId(value);

    if (sourceId) {
      return createGitHubRepositoryUrl(sourceId);
    }
  }

  return null;
}

function selectCanonicalEntityName(item) {
  const metadataEntityName = normalizeOptionalString(
    item.metadata?.canonicalEntityName ??
      item.metadata?.canonical_entity_name ??
      item.metadata?.entityName ??
      item.metadata?.entity_name,
  );

  if (metadataEntityName) {
    return metadataEntityName;
  }

  const repositoryName = deriveEntityNameFromRepositoryUrl(selectCanonicalRepositoryUrl(item));

  if (repositoryName) {
    return repositoryName;
  }

  const cleanedLabel = stripEntityLabelNoise(item.name);

  if (cleanedLabel) {
    return cleanedLabel;
  }

  const inferredHostEntityName = inferEntityNameFromIdentityUrls(item);

  if (inferredHostEntityName) {
    return inferredHostEntityName;
  }

  const inferredTextEntityName = inferEntityNameFromDescriptiveText(item);

  if (inferredTextEntityName) {
    return inferredTextEntityName;
  }

  return inferredHostEntityName ?? String(item.name).trim();
}

function selectCanonicalRepositoryUrl(item) {
  return (
    normalizeOptionalRepositoryUrl(
      item.metadata?.repositoryUrl ??
        item.metadata?.repository_url ??
        item.metadata?.repoRootUrl ??
        item.metadata?.repo_root_url ??
        item.metadata?.github?.repoRootUrl ??
        item.metadata?.github?.repo_root_url ??
        null,
    ) ??
    normalizeOptionalRepositoryUrl(selectRepoRootIdentity(item))
  );
}

function selectCanonicalDoi(item) {
  for (const value of [
    item.metadata?.doi,
    item.metadata?.doiUrl,
    item.metadata?.doi_url,
    item.metadata?.arxiv?.doi,
    item.metadata?.arxiv?.doiUrl,
    item.metadata?.arxiv?.doi_url,
    item.sourceUrl,
    ...(Array.isArray(item.sourceUrls) ? item.sourceUrls : []),
    ...(Array.isArray(item.metadata?.outboundUrls) ? item.metadata.outboundUrls : []),
  ]) {
    const doi = normalizeOptionalDoi(value);

    if (doi) {
      return doi;
    }
  }

  return null;
}

function selectCanonicalSourceIds(item) {
  const sourceIds = normalizeCanonicalSourceIds(
    item.metadata?.canonicalSourceIds ??
      item.metadata?.canonical_source_ids ??
      item.metadata?.sourceIds ??
      item.metadata?.source_ids ??
      {},
    "metadata.sourceIds",
  );
  const githubId =
    normalizeGitHubSourceId(
      item.metadata?.github?.entityKey ??
        item.metadata?.github?.fullName ??
        (hasSourceKind(item, "github") ? item.metadata?.externalId ?? null : null),
    ) ?? extractGitHubSourceId(selectCanonicalRepositoryUrl(item));
  const arxivId =
    normalizeOptionalString(
      item.metadata?.arxiv?.canonicalId ??
        item.metadata?.arxiv?.canonical_id ??
        item.metadata?.canonicalId ??
        item.metadata?.canonical_id ??
        (hasSourceKind(item, "arxiv") ? item.metadata?.externalId ?? null : null),
    ) ?? extractArxivIdFromUrls(item);

  return {
    ...sourceIds,
    ...(githubId ? { github: githubId } : {}),
    ...(arxivId ? { arxiv: arxivId } : {}),
  };
}

function hasSourceKind(item, sourceKind) {
  return Array.isArray(item.sourceKinds) && item.sourceKinds.includes(sourceKind);
}

function normalizeCanonicalSourceIds(value, fieldName) {
  if (value == null) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object when provided`);
  }

  const entries = Object.entries(value)
    .map(([key, sourceId]) => [String(key).trim(), normalizeOptionalString(sourceId)])
    .filter(([key, sourceId]) => key.length > 0 && sourceId);

  return Object.fromEntries(
    entries.map(([key, sourceId]) => [key, sourceId]),
  );
}

function deriveEntityNameFromRepositoryUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.hostname !== "github.com") {
      return null;
    }

    const repository = url.pathname.split("/").filter(Boolean)[1];

    if (!repository) {
      return null;
    }

    return humanizeIdentifier(repository);
  } catch {
    return null;
  }
}

function stripEntityLabelNoise(value) {
  const tokens = String(value ?? "").match(/[A-Za-z0-9]+/gu) ?? [];
  let start = 0;
  let end = tokens.length;

  while (start < end && TITLE_NOISE_TOKENS.has(tokens[start].toLowerCase())) {
    start += 1;
  }

  while (end > start && TITLE_NOISE_TOKENS.has(tokens[end - 1].toLowerCase())) {
    end -= 1;
  }

  while (end - start > 1 && VERSION_TOKEN_PATTERN.test(tokens[end - 1])) {
    end -= 1;
  }

  const cleaned = tokens.slice(start, end).join(" ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function inferEntityNameFromDescriptiveText(item) {
  const candidates = [
    ...collectEntityNameCandidates(item.summary, 0),
    ...collectEntityNameCandidates(item.integrationHint, 1),
  ].sort(compareEntityNameCandidates);

  return candidates[0]?.value ?? null;
}

function inferEntityNameFromIdentityUrls(item) {
  const candidates = collectRelatedUrls(item)
    .flatMap((value) => extractEntityNameCandidatesFromIdentityUrl(value))
    .sort(compareEntityNameCandidates);

  return candidates[0]?.value ?? null;
}

function extractEntityNameCandidatesFromIdentityUrl(value) {
  const url = new URL(value);
  const labels = url.hostname
    .toLowerCase()
    .replace(/^www\./u, "")
    .split(".")
    .filter(Boolean);
  const meaningfulLabels = labels
    .slice(0, -1)
    .filter((label) => !HOST_ALIAS_NOISE_LABELS.has(label));
  const primaryLabel = meaningfulLabels.at(-1);

  if (!primaryLabel || !looksProductSpecificHostLabel(primaryLabel)) {
    return [];
  }

  const entityName = humanizeIdentifier(primaryLabel);

  if (!entityName) {
    return [];
  }

  const normalizedEntityName = normalizeIdentityAlias(entityName);

  if (!normalizedEntityName || !isSpecificAlias(normalizedEntityName)) {
    return [];
  }

  return [
    {
      value: entityName,
      sourcePriority: 0,
    },
  ];
}

function collectEntityNameCandidates(value, sourcePriority) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  return extractEntityNameCandidatesFromText(value).map((candidate) => ({
    value: candidate,
    sourcePriority,
  }));
}

function extractEntityNameCandidatesFromText(value) {
  const matches = String(value ?? "").matchAll(ENTITY_NAME_TEXT_PATTERN);

  return uniqueStrings(
    [...matches]
      .map((match) => normalizeIdentityAlias(match[1] ?? match[0]))
      .filter((candidate) => candidate && isSpecificAlias(candidate)),
  );
}

function compareEntityNameCandidates(left, right) {
  const tokenCountDelta = countEntityNameTokens(right.value) - countEntityNameTokens(left.value);

  if (tokenCountDelta !== 0) {
    return tokenCountDelta;
  }

  if (left.sourcePriority !== right.sourcePriority) {
    return left.sourcePriority - right.sourcePriority;
  }

  return right.value.length - left.value.length || left.value.localeCompare(right.value);
}

function countEntityNameTokens(value) {
  return normalizeComparableText(value).split(" ").filter(Boolean).length;
}

function humanizeIdentifier(value) {
  const tokens = String(value ?? "")
    .split(/[^A-Za-z0-9]+/u)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  return tokens
    .map((token) =>
      token.length <= 3
        ? token.toUpperCase()
        : `${token[0].toUpperCase()}${token.slice(1).toLowerCase()}`,
    )
    .join(" ");
}

function extractMeaningfulHostAliases(hostname) {
  if (
    SOCIAL_IDENTITY_HOSTS.has(hostname) ||
    DOI_HOSTS.has(hostname) ||
    hostname === "github.com"
  ) {
    return [];
  }

  const labels = hostname
    .toLowerCase()
    .replace(/^www\./u, "")
    .split(".")
    .filter(Boolean);
  const meaningfulLabels = labels
    .slice(0, -1)
    .filter((label) => !HOST_ALIAS_NOISE_LABELS.has(label));
  const primaryLabel = meaningfulLabels.at(-1);

  if (!primaryLabel || !looksProductSpecificHostLabel(primaryLabel)) {
    return [];
  }

  const alias = normalizeIdentityAlias(primaryLabel);

  return alias && isSpecificAlias(alias) ? [alias] : [];
}

function looksProductSpecificHostLabel(label) {
  return /[-_]/u.test(label);
}

function normalizeOptionalRepositoryUrl(value) {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  const url = new URL(canonicalizeUrl(normalized));
  url.hostname = url.hostname.toLowerCase().replace(/^www\./u, "");

  if (url.hostname === "twitter.com") {
    url.hostname = "x.com";
  }

  if (url.hostname === "github.com") {
    const [owner, repository] = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.toLowerCase());

    if (owner && repository) {
      url.pathname = `/${owner}/${repository}`;
      url.search = "";
      return url.toString();
    }
  }

  return url.toString();
}

function normalizeOptionalDoi(value) {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    try {
      const url = new URL(normalized);

      if (!DOI_HOSTS.has(url.hostname.toLowerCase())) {
        return null;
      }

      return normalizeOptionalString(
        decodeURIComponent(url.pathname.replace(/^\/+/u, "")).toLowerCase(),
      );
    } catch {
      return null;
    }
  }

  return normalizeOptionalString(
    normalized
      .replace(/^doi:\s*/iu, "")
      .replace(/^https?:\/\/(?:www\.)?doi\.org\//iu, "")
      .toLowerCase(),
  );
}

function normalizeGitHubSourceId(value) {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  return normalized.replace(/^\/+/u, "").replace(/\/+$/u, "").toLowerCase();
}

function extractGitHubSourceIdsFromText(values = []) {
  return uniqueStrings(
    values
      .flatMap((value) => [
        ...extractPatternValues(value, GITHUB_URL_IN_TEXT_PATTERN, normalizeGitHubSourceId),
        ...GITHUB_TEXT_IDENTIFIER_PATTERNS.flatMap((pattern) =>
          extractPatternValues(value, pattern, normalizeGitHubSourceId),
        ),
      ])
      .filter(Boolean),
  );
}

function extractGitHubSourceId(repositoryUrl) {
  if (!repositoryUrl) {
    return null;
  }

  try {
    const url = new URL(repositoryUrl);

    if (url.hostname !== "github.com") {
      return null;
    }

    const [owner, repository] = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.toLowerCase());

    if (!owner || !repository) {
      return null;
    }

    return `${owner}/${repository}`;
  } catch {
    return null;
  }
}

function createGitHubRepositoryUrl(sourceId) {
  const normalized = normalizeGitHubSourceId(sourceId);

  if (!normalized) {
    return null;
  }

  return `https://github.com/${normalized}`;
}

function extractArxivIdFromUrls(item) {
  for (const value of [
    item.sourceUrl,
    ...(Array.isArray(item.sourceUrls) ? item.sourceUrls : []),
    ...(Array.isArray(item.metadata?.outboundUrls) ? item.metadata.outboundUrls : []),
  ]) {
    const arxivId = extractArxivIdFromUrl(value);

    if (arxivId) {
      return arxivId;
    }
  }

  return null;
}

function extractArxivIdFromUrl(value) {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);

    if (!/^(?:www\.)?arxiv\.org$/iu.test(url.hostname)) {
      return null;
    }

    const match = url.pathname.match(/^\/(?:abs|pdf)\/([^/?#]+?)(?:\.pdf)?$/iu);
    return normalizeArxivSourceId(match?.[1] ?? null);
  } catch {
    return null;
  }
}

function extractArxivIdsFromText(values = []) {
  return uniqueStrings(
    values.flatMap((value) => extractPatternValues(value, ARXIV_ID_IN_TEXT_PATTERN, normalizeArxivSourceId)),
  );
}

function normalizeArxivSourceId(value) {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d{4}\.\d{4,5})(?:v\d+)?$/iu);
  return normalizeOptionalString(match?.[1] ?? null);
}

function extractDoisFromText(values = []) {
  return uniqueStrings(
    values.flatMap((value) => extractPatternValues(value, DOI_IN_TEXT_PATTERN, normalizeOptionalDoi)),
  );
}

function extractPatternValues(value, pattern, normalizer = normalizeOptionalString) {
  const matches = String(value ?? "").matchAll(pattern);
  const normalizedValues = [];

  for (const match of matches) {
    const normalized = normalizer(match[1] ?? match[0]);

    if (normalized) {
      normalizedValues.push(normalized);
    }
  }

  return normalizedValues;
}

function normalizeOptionalString(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function firstDefinedValue(values) {
  return values.find((value) => value != null) ?? null;
}

function normalizeOptionalIdentityUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  try {
    return normalizeIdentityUrl(value);
  } catch {
    return null;
  }
}

function createSignal(type, value) {
  if (!value) {
    return null;
  }

  return `${IDENTITY_SIGNAL_PREFIX}${type}:${value}`;
}

function createAliasSignal(categoryGroup, signalType, value) {
  if (!value) {
    return null;
  }

  return createSignal("alias", `${categoryGroup}:${signalType}:${value}`);
}

function createCanonicalIdSignal(namespace, value) {
  if (!namespace || !value) {
    return null;
  }

  return createSignal("canonical_id", `${namespace}:${value}`);
}

function isArxivIdentitySource(item, metadata) {
  if (metadata.arxiv?.canonicalId) {
    return true;
  }

  if (Array.isArray(item.sourceKinds) && item.sourceKinds.includes("arxiv")) {
    return true;
  }

  try {
    return new URL(item.sourceUrl).hostname === "arxiv.org";
  } catch {
    return false;
  }
}

function normalizeCanonicalIdentifier(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function normalizeDoiIdentity(value) {
  const normalized = normalizeCanonicalIdentifier(value);

  if (!normalized) {
    return null;
  }

  return normalized.replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, "");
}

function normalizeIdentityAlias(value) {
  const tokens = normalizeComparableText(value).split(" ").filter(Boolean);
  let start = 0;
  let end = tokens.length;

  while (start < end && TITLE_NOISE_TOKENS.has(tokens[start])) {
    start += 1;
  }

  while (end > start && TITLE_NOISE_TOKENS.has(tokens[end - 1])) {
    end -= 1;
  }

  const normalized = tokens.slice(start, end).join(" ");

  if (!normalized || /^\d+$/u.test(normalized)) {
    return null;
  }

  return normalized;
}

function parseSignal(signal) {
  const [, type, ...rest] = signal.split(":");

  return {
    type,
    value: rest.join(":"),
  };
}
