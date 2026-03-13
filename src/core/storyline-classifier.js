import { normalizeComparableText } from "./contracts.js";

export const STORYLINE_RELATIONSHIP_DECISIONS = ["origin", "repetition", "evolution"];

const FACT_SIMILARITY_THRESHOLD = 0.72;
const MIN_NOVEL_TOKEN_RATIO = 0.18;
const MIN_FALLBACK_NOVEL_TOKEN_RATIO = 0.35;
const MIN_FACT_TOKEN_COUNT = 2;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "there",
  "these",
  "this",
  "to",
  "using",
  "via",
  "with",
  "your",
]);
const GENERIC_UPDATE_TOKENS = new Set([
  "activate",
  "activated",
  "activates",
  "adopt",
  "adoption",
  "adopts",
  "announced",
  "announcement",
  "announcing",
  "before",
  "configure",
  "configured",
  "configuring",
  "deploy",
  "deployed",
  "deploying",
  "enable",
  "enabled",
  "enabling",
  "install",
  "installs",
  "installed",
  "latest",
  "new",
  "now",
  "package",
  "packages",
  "release",
  "releases",
  "review",
  "setup",
  "ship",
  "ships",
  "shipping",
  "step",
  "steps",
  "support",
  "supports",
  "supporting",
  "turn",
  "turns",
  "upgrade",
  "upgrades",
  "upgrading",
  "use",
  "uses",
  "using",
  "validate",
  "validating",
]);

export function buildHistoricalStorylineMap(editions) {
  if (!Array.isArray(editions)) {
    throw new TypeError("editions must be an array");
  }

  const storylineMap = new Map();

  for (const edition of [...editions].sort(sortEditionsByPublishedAtAsc)) {
    for (const item of edition.items ?? []) {
      const trackedItemId = resolveTrackedItemId(item);

      if (!trackedItemId) {
        continue;
      }

      const appearances = storylineMap.get(trackedItemId) ?? [];
      appearances.push({
        editionId: edition.id ?? null,
        publishedAt: edition.publishedAt ?? null,
        window: edition.window ?? null,
        item,
      });
      storylineMap.set(trackedItemId, appearances);
    }
  }

  return storylineMap;
}

export function annotateStorylineRelationship(item, priorAppearances = []) {
  if (!Array.isArray(priorAppearances)) {
    throw new TypeError("priorAppearances must be an array");
  }

  const trackedItemId = resolveTrackedItemId(item);

  if (!trackedItemId) {
    throw new TypeError("item.itemId or item.id is required");
  }

  return {
    ...item,
    metadata: {
      ...(item.metadata ?? {}),
      storyline: {
        storylineId: buildStorylineId(trackedItemId),
        position: priorAppearances.length + 1,
        relationship: classifyStorylineRelationship(item, priorAppearances),
      },
    },
  };
}

export function classifyStorylineRelationship(item, priorAppearances = []) {
  if (!Array.isArray(priorAppearances)) {
    throw new TypeError("priorAppearances must be an array");
  }

  const orderedAppearances = [...priorAppearances].sort(sortAppearancesByPublishedAtAsc);

  if (orderedAppearances.length === 0) {
    return {
      decision: "origin",
      explanation: "First appearance in this storyline.",
      priorAppearanceCount: 0,
      previousAppearance: null,
      signals: createRelationshipSignals(),
    };
  }

  const currentFacts = extractFactClauses(item);
  const currentTokens = extractInformativeTokens(item);
  const historicalFacts = orderedAppearances.flatMap((appearance) =>
    extractFactClauses(appearance.item),
  );
  const historicalTokens = new Set(
    orderedAppearances.flatMap((appearance) => extractInformativeTokens(appearance.item)),
  );
  const latestAppearance = orderedAppearances.at(-1);
  const latestTokens = extractInformativeTokens(latestAppearance.item);
  const novelFacts = currentFacts.filter(
    (factClause) =>
      maxSimilarity(factClause, historicalFacts) < FACT_SIMILARITY_THRESHOLD,
  );
  const novelTokens = [...new Set(currentTokens.filter((token) => !historicalTokens.has(token)))];
  const novelTokenRatio = calculateRatio(novelTokens.length, currentTokens.length);
  const factOverlapRatio = calculateOverlapRatio(currentTokens, latestTokens);
  const newSourceClusterCount = countNovelSourceClusters(item, orderedAppearances);
  const decision = decideRelationship({
    novelFactCount: novelFacts.length,
    novelTokenRatio,
    factOverlapRatio,
  });

  return {
    decision,
    explanation: buildExplanation({
      decision,
      priorAppearanceCount: orderedAppearances.length,
      novelFactCount: novelFacts.length,
      novelTokenRatio,
      factOverlapRatio,
    }),
    priorAppearanceCount: orderedAppearances.length,
    previousAppearance: {
      editionId: latestAppearance.editionId,
      publishedAt: latestAppearance.publishedAt,
      sourceUrl: latestAppearance.item?.sourceUrl ?? null,
    },
    signals: createRelationshipSignals({
      factOverlapRatio,
      novelFactCount: novelFacts.length,
      novelTokenRatio,
      newSourceClusterCount,
    }),
  };
}

function decideRelationship({ novelFactCount, novelTokenRatio, factOverlapRatio }) {
  if (novelFactCount >= 1 && novelTokenRatio >= MIN_NOVEL_TOKEN_RATIO) {
    return "evolution";
  }

  if (novelFactCount >= 1 && factOverlapRatio <= 0.45) {
    return "evolution";
  }

  if (
    novelFactCount >= 2 &&
    novelTokenRatio >= MIN_NOVEL_TOKEN_RATIO / 2 &&
    factOverlapRatio <= 0.7
  ) {
    return "evolution";
  }

  if (
    novelFactCount === 0 &&
    novelTokenRatio >= MIN_FALLBACK_NOVEL_TOKEN_RATIO &&
    factOverlapRatio <= 0.55
  ) {
    return "evolution";
  }

  return "repetition";
}

function buildExplanation({
  decision,
  priorAppearanceCount,
  novelFactCount,
  novelTokenRatio,
  factOverlapRatio,
}) {
  if (decision === "evolution") {
    return `Introduces ${novelFactCount} novel fact clause${pluralize(
      novelFactCount,
    )} with ${formatPercent(novelTokenRatio)} novel tokens across ${priorAppearanceCount} prior appearance${pluralize(
      priorAppearanceCount,
    )}.`;
  }

  return `Mostly re-reports previously covered facts across ${priorAppearanceCount} prior appearance${pluralize(
    priorAppearanceCount,
  )}; overlap with the latest appearance is ${formatPercent(factOverlapRatio)} and only ${novelFactCount} novel fact clause${pluralize(
    novelFactCount,
  )} was detected.`;
}

function createRelationshipSignals({
  factOverlapRatio = 0,
  novelFactCount = 0,
  novelTokenRatio = 0,
  newSourceClusterCount = 0,
} = {}) {
  return {
    factOverlapRatio: roundMetric(factOverlapRatio),
    novelFactCount,
    novelTokenRatio: roundMetric(novelTokenRatio),
    newSourceClusterCount,
  };
}

function extractFactClauses(item) {
  return uniqueFactClauses(
    splitIntoClauses(composeNarrativeText(item))
      .map(createFactClause)
      .filter(Boolean)
  );
}

function composeNarrativeText(item) {
  return [item?.summary, item?.integrationHint].filter(Boolean).join(". ");
}

function splitIntoClauses(text) {
  return String(text ?? "").split(/[.!?\n;:]+/u);
}

function normalizeClause(value) {
  const raw = String(value ?? "").trim();

  if (raw.length === 0) {
    return null;
  }

  return normalizeComparableText(raw);
}

function createFactClause(value) {
  const text = normalizeClause(value);

  if (!text) {
    return null;
  }

  const tokens = tokenizeMaterialText(text);

  if (tokens.length < MIN_FACT_TOKEN_COUNT) {
    return null;
  }

  return {
    text,
    tokens,
  };
}

function extractInformativeTokens(item) {
  return uniqueStrings(
    tokenizeMaterialText(composeNarrativeText(item)),
  );
}

function tokenizeMaterialText(value) {
  return tokenizeComparableText(value).filter(
    (token) =>
      token.length > 2 &&
      !STOP_WORDS.has(token) &&
      !GENERIC_UPDATE_TOKENS.has(token) &&
      !/^\d+$/u.test(token),
  );
}

function tokenizeComparableText(value) {
  const normalized = String(value ?? "").trim();

  if (normalized.length === 0) {
    return [];
  }

  return normalizeComparableText(normalized)
    .split(/\s+/u)
    .filter(Boolean);
}

function maxSimilarity(targetClause, candidateClauses) {
  if (candidateClauses.length === 0) {
    return 0;
  }

  return candidateClauses.reduce(
    (maxScore, candidateClause) =>
      Math.max(maxScore, calculateOverlapRatio(targetClause.tokens, candidateClause.tokens)),
    0,
  );
}

function calculateOverlapRatio(left, right) {
  const leftTokens = new Set(Array.isArray(left) ? left : tokenizeComparableText(left));
  const rightTokens = new Set(Array.isArray(right) ? right : tokenizeComparableText(right));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function countNovelSourceClusters(item, priorAppearances) {
  const historicalClusters = new Set(
    priorAppearances.flatMap((appearance) => extractSourceClusters(appearance.item)),
  );

  return extractSourceClusters(item).filter((cluster) => !historicalClusters.has(cluster)).length;
}

function extractSourceClusters(item) {
  return uniqueStrings(
    (item?.sourceUrls ?? [item?.sourceUrl])
      .filter(Boolean)
      .map((sourceUrl) => {
        try {
          return new URL(sourceUrl).hostname.replace(/^www\./u, "").toLowerCase();
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  );
}

function buildStorylineId(itemId) {
  return `storyline-${itemId}`;
}

function resolveTrackedItemId(item) {
  return String(item?.itemId ?? item?.id ?? "").trim();
}

function calculateRatio(numerator, denominator) {
  if (!denominator) {
    return 0;
  }

  return numerator / denominator;
}

function roundMetric(value) {
  return Math.round(value * 1000) / 1000;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function pluralize(count) {
  return count === 1 ? "" : "s";
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function uniqueFactClauses(clauses) {
  const clausesBySignature = new Map();

  for (const clause of clauses) {
    clausesBySignature.set(clause.tokens.join(" "), clause);
  }

  return [...clausesBySignature.values()];
}

function sortAppearancesByPublishedAtAsc(left, right) {
  return (
    new Date(left?.publishedAt ?? 0).getTime() - new Date(right?.publishedAt ?? 0).getTime()
  );
}

function sortEditionsByPublishedAtAsc(left, right) {
  return new Date(left?.publishedAt ?? 0).getTime() - new Date(right?.publishedAt ?? 0).getTime();
}
