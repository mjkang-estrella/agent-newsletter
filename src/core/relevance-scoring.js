import { SCORE_INTERPRETATIONS } from "./contracts.js";
import { CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT } from "./relevance-score-history.js";
import { countDistinctSourceClusters } from "./source-clusters.js";

const HOURS_PER_WEEK = 24 * 7;
const BASE_DEFAULT_MIN_RELEVANCE_SCORE = 60;
const BASE_DEFAULT_RELEVANCE_SCORE_VERSION = "1.0.0";
const BASE_DEFAULT_RELEVANCE_SCORE_INTERPRETATION = "assessment";
const BASE_DEFAULT_RELEVANCE_SCORE_RANGE = Object.freeze({
  min: 0,
  max: 100,
});

const BASE_RELEVANCE_SCORING_CONFIG = {
  scoreVersion: BASE_DEFAULT_RELEVANCE_SCORE_VERSION,
  scoreInterpretation: BASE_DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  scoreRange: BASE_DEFAULT_RELEVANCE_SCORE_RANGE,
  recencyHalfLifeHours: 24,
  recencyMaxAgeHours: HOURS_PER_WEEK,
  mentionCountSaturation: 8,
  githubStarsSaturation: 50000,
  githubStarsTodaySaturation: 250,
  socialEngagementSaturation: 1000,
  githubSignalWeights: {
    stars: 0.6,
    activity: 0.4,
  },
  weights: {
    recency: 0.24,
    sourceAuthority: 0.28,
    mentionFrequency: 0.18,
    github: 0.2,
    socialEngagement: 0.1,
  },
};

const CURRENT_RELEVANCE_SCORE_HISTORY_ENTRY =
  resolveCurrentRelevanceScoreHistoryEntry();

export const DEFAULT_RELEVANCE_SCORE_VERSION =
  CURRENT_RELEVANCE_SCORE_HISTORY_ENTRY.version;
export const DEFAULT_RELEVANCE_SCORE_INTERPRETATION = resolveScoreInterpretationConfig(
  CURRENT_RELEVANCE_SCORE_HISTORY_ENTRY.formulaDefinition.config?.scoreInterpretation,
  BASE_DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
);
export const DEFAULT_RELEVANCE_SCORE_RANGE = Object.freeze(
  resolveScoreRangeConfig(
    CURRENT_RELEVANCE_SCORE_HISTORY_ENTRY.formulaDefinition.config?.scoreRange,
    BASE_DEFAULT_RELEVANCE_SCORE_RANGE,
  ),
);
export const DEFAULT_MIN_RELEVANCE_SCORE = resolveMinimumPublishedScore(
  CURRENT_RELEVANCE_SCORE_HISTORY_ENTRY.formulaDefinition.minimumPublishedScore,
  BASE_DEFAULT_MIN_RELEVANCE_SCORE,
);
export const DEFAULT_RELEVANCE_SCORING_CONFIG = buildRelevanceScoringConfig(
  {
    ...CURRENT_RELEVANCE_SCORE_HISTORY_ENTRY.formulaDefinition.config,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
    scoreRange: DEFAULT_RELEVANCE_SCORE_RANGE,
  },
  BASE_RELEVANCE_SCORING_CONFIG,
);

export const DEFAULT_RELEVANCE_SIGNAL_CONFIG = DEFAULT_RELEVANCE_SCORING_CONFIG;

export const RELEVANCE_SCORE_VERSION_HISTORY = Object.freeze([
  ...CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT.history.map((entry) =>
    createRelevanceScoreVersionHistoryEntry(entry),
  ),
]);

export const CURRENT_RELEVANCE_SCORE_VERSION_ENTRY =
  getRelevanceScoreVersionHistoryEntry(DEFAULT_RELEVANCE_SCORE_VERSION);

export function getRelevanceScoreVersionHistoryEntry(
  version = DEFAULT_RELEVANCE_SCORE_VERSION,
) {
  const resolvedVersion = resolveNonEmptyConfigString(
    version,
    DEFAULT_RELEVANCE_SCORE_VERSION,
  );

  return (
    RELEVANCE_SCORE_VERSION_HISTORY.find((entry) => entry.version === resolvedVersion) ?? null
  );
}

export function resolveRelevanceScoringConfig(overrides = {}) {
  return buildRelevanceScoringConfig(overrides, DEFAULT_RELEVANCE_SCORING_CONFIG);
}

function buildRelevanceScoringConfig(overrides = {}, defaults = BASE_RELEVANCE_SCORING_CONFIG) {
  const safeOverrides = overrides ?? {};

  return {
    ...defaults,
    scoreVersion: resolveNonEmptyConfigString(
      safeOverrides.scoreVersion,
      defaults.scoreVersion,
    ),
    scoreInterpretation: resolveScoreInterpretationConfig(
      safeOverrides.scoreInterpretation,
      defaults.scoreInterpretation,
    ),
    scoreRange: resolveScoreRangeConfig(
      safeOverrides.scoreRange,
      defaults.scoreRange,
    ),
    recencyHalfLifeHours: resolvePositiveConfigNumber(
      safeOverrides.recencyHalfLifeHours,
      defaults.recencyHalfLifeHours,
    ),
    recencyMaxAgeHours: resolvePositiveConfigNumber(
      safeOverrides.recencyMaxAgeHours,
      defaults.recencyMaxAgeHours,
    ),
    mentionCountSaturation: resolvePositiveConfigNumber(
      safeOverrides.mentionCountSaturation,
      defaults.mentionCountSaturation,
    ),
    githubStarsSaturation: resolvePositiveConfigNumber(
      safeOverrides.githubStarsSaturation,
      defaults.githubStarsSaturation,
    ),
    githubStarsTodaySaturation: resolvePositiveConfigNumber(
      safeOverrides.githubStarsTodaySaturation,
      defaults.githubStarsTodaySaturation,
    ),
    socialEngagementSaturation: resolvePositiveConfigNumber(
      safeOverrides.socialEngagementSaturation,
      defaults.socialEngagementSaturation,
    ),
    githubSignalWeights: {
      ...defaults.githubSignalWeights,
      stars: resolveNonNegativeConfigNumber(
        safeOverrides.githubSignalWeights?.stars,
        defaults.githubSignalWeights.stars,
      ),
      activity: resolveNonNegativeConfigNumber(
        safeOverrides.githubSignalWeights?.activity,
        defaults.githubSignalWeights.activity,
      ),
    },
    weights: {
      ...defaults.weights,
      recency: resolveNonNegativeConfigNumber(
        safeOverrides.weights?.recency,
        defaults.weights.recency,
      ),
      sourceAuthority: resolveNonNegativeConfigNumber(
        safeOverrides.weights?.sourceAuthority,
        defaults.weights.sourceAuthority,
      ),
      mentionFrequency: resolveNonNegativeConfigNumber(
        safeOverrides.weights?.mentionFrequency,
        defaults.weights.mentionFrequency,
      ),
      github: resolveNonNegativeConfigNumber(
        safeOverrides.weights?.github,
        defaults.weights.github,
      ),
      socialEngagement: resolveNonNegativeConfigNumber(
        safeOverrides.weights?.socialEngagement,
        defaults.weights.socialEngagement,
      ),
    },
  };
}

export function scoreRecencySignal(
  item,
  window = null,
  config = DEFAULT_RELEVANCE_SCORING_CONFIG,
) {
  return normalizeRelevanceSignalInputs(item, window, config).recency;
}

export function scoreMentionFrequencySignal(
  item,
  config = DEFAULT_RELEVANCE_SCORING_CONFIG,
) {
  return normalizeRelevanceSignalInputs(item, null, config).mentionFrequency;
}

export function scoreSourceAuthoritySignal(item) {
  return extractSourceAuthority(item);
}

export function scoreGitHubStarsSignal(
  item,
  config = DEFAULT_RELEVANCE_SCORING_CONFIG,
) {
  return normalizeRelevanceSignalInputs(item, null, config).githubStars;
}

export function scoreGitHubActivitySignal(
  item,
  window = null,
  config = DEFAULT_RELEVANCE_SCORING_CONFIG,
) {
  return normalizeRelevanceSignalInputs(item, window, config).githubActivity;
}

export function scoreGitHubSignal(
  item,
  window = null,
  config = DEFAULT_RELEVANCE_SCORING_CONFIG,
) {
  const normalizedInputs = normalizeRelevanceSignalInputs(item, window, config);

  return blendScores(
    [
      [normalizedInputs.githubStars, config.githubSignalWeights.stars],
      [normalizedInputs.githubActivity, config.githubSignalWeights.activity],
    ],
    0,
  );
}

export function scoreSocialEngagementSignal(
  item,
  config = DEFAULT_RELEVANCE_SCORING_CONFIG,
) {
  return normalizeRelevanceSignalInputs(item, null, config).socialEngagement;
}

export function extractRelevanceSignalInputs(
  item,
  window = null,
  config = DEFAULT_RELEVANCE_SCORING_CONFIG,
) {
  return {
    recencyHours: extractRecencyHours(item, window),
    mentionCount: extractMentionCount(item),
    githubStars: extractGitHubStars(item),
    githubActivity: extractGitHubActivityInput(item, window, config),
    socialEngagement: extractSocialEngagement(item),
  };
}

export function normalizeRelevanceSignalInputs(
  item,
  window = null,
  config = DEFAULT_RELEVANCE_SCORING_CONFIG,
) {
  const inputs = extractRelevanceSignalInputs(item, window, config);

  return {
    recency:
      inputs.recencyHours == null ? 0 : scoreRecencyHours(inputs.recencyHours, config),
    mentionFrequency: normalizeLogarithmic(
      inputs.mentionCount,
      config.mentionCountSaturation,
    ),
    githubStars: normalizeLogarithmic(
      inputs.githubStars,
      config.githubStarsSaturation,
    ),
    githubActivity: clamp(Math.round(inputs.githubActivity ?? 0), 0, 100),
    socialEngagement: normalizeLogarithmic(
      inputs.socialEngagement,
      config.socialEngagementSaturation,
    ),
  };
}

export function normalizeRelevanceSignals(
  item,
  window = null,
  config = DEFAULT_RELEVANCE_SCORING_CONFIG,
) {
  const normalizedInputs = normalizeRelevanceSignalInputs(item, window, config);

  return {
    recency: normalizedInputs.recency,
    sourceAuthority: extractSourceAuthority(item),
    mentionFrequency: normalizedInputs.mentionFrequency,
    github: blendScores(
      [
        [normalizedInputs.githubStars, config.githubSignalWeights.stars],
        [normalizedInputs.githubActivity, config.githubSignalWeights.activity],
      ],
      0,
    ),
    socialEngagement: normalizedInputs.socialEngagement,
  };
}

export const scoreNormalizedSignals = normalizeRelevanceSignals;

export function createRelevanceScoreBreakdown(item, window = null, overrides = {}) {
  const config = resolveRelevanceScoringConfig(overrides);
  const signals = normalizeRelevanceSignals(item, window, config);
  const observedSignals = {
    recency: hasRecencySignalData(item, window),
    sourceAuthority: hasSourceAuthorityData(item),
    mentionFrequency: hasMentionSignalData(item),
    github: hasGitHubSignalData(item, window),
    socialEngagement: hasSocialEngagementData(item),
  };
  const configuredWeights = { ...config.weights };
  const appliedWeights = {
    recency: observedSignals.recency ? configuredWeights.recency : 0,
    sourceAuthority: observedSignals.sourceAuthority ? configuredWeights.sourceAuthority : 0,
    mentionFrequency: observedSignals.mentionFrequency ? configuredWeights.mentionFrequency : 0,
    github: observedSignals.github ? configuredWeights.github : 0,
    socialEngagement: observedSignals.socialEngagement
      ? configuredWeights.socialEngagement
      : 0,
  };
  const totalAppliedWeight = Object.values(appliedWeights).reduce(
    (total, weight) => total + weight,
    0,
  );
  const effectiveWeights = Object.fromEntries(
    Object.entries(appliedWeights).map(([signalName, weight]) => [
      signalName,
      totalAppliedWeight > 0 ? Number((weight / totalAppliedWeight).toFixed(4)) : 0,
    ]),
  );
  const score = blendScores(
    [
      [signals.recency, appliedWeights.recency],
      [signals.sourceAuthority, appliedWeights.sourceAuthority],
      [signals.mentionFrequency, appliedWeights.mentionFrequency],
      [signals.github, appliedWeights.github],
      [signals.socialEngagement, appliedWeights.socialEngagement],
    ],
    0,
  );

  return {
    scoreVersion: config.scoreVersion,
    scoreInterpretation: config.scoreInterpretation,
    score,
    divergenceFlag: hasHighSentimentDivergence(item),
    signals,
    observedSignals,
    configuredWeights,
    appliedWeights,
    effectiveWeights,
  };
}

export function scoreItemRelevance(item, window = null, overrides = {}) {
  return createRelevanceScoreBreakdown(item, window, overrides).score;
}

export function createWeightedRelevanceScorer(overrides = {}) {
  const config = resolveRelevanceScoringConfig(overrides);
  const scorer = async (item, window) => {
    const scoreBreakdown = createRelevanceScoreBreakdown(item, window, config);

    return {
      score: scoreBreakdown.score,
      relevanceScore: scoreBreakdown.score,
      scoreVersion: scoreBreakdown.scoreVersion,
      scoreInterpretation: scoreBreakdown.scoreInterpretation,
      scoreBreakdown,
    };
  };
  scorer.getBreakdown = (item, window) =>
    createRelevanceScoreBreakdown(item, window, config);
  scorer.scoreVersion = config.scoreVersion;
  scorer.scoreInterpretation = config.scoreInterpretation;
  scorer.scoreRange = { ...config.scoreRange };
  return scorer;
}

export function hasHighSentimentDivergence(item) {
  const classification = resolveSentimentSpreadClassification(
    item?.sentimentSpread ?? item?.sentiment_spread ?? null,
  );

  return classification === "disagree" || classification === "mixed";
}

export function filterCuratedItemsByRelevance(
  items,
  minRelevanceScore = DEFAULT_MIN_RELEVANCE_SCORE,
) {
  if (!Array.isArray(items)) {
    throw new TypeError("items must be an array");
  }

  return items.filter((item) => finiteMetric(item?.relevanceScore) >= minRelevanceScore);
}

export function compareCuratedItemsByRelevance(left, right) {
  return (
    compareNullableNumbersDesc(left?.relevanceScore, right?.relevanceScore) ||
    compareNullableNumbersDesc(left?.sourceAuthorityScore, right?.sourceAuthorityScore) ||
    compareNullableNumbersDesc(left?.mentionCount, right?.mentionCount) ||
    compareNullableTimestampsDesc(left?.publishedAt, right?.publishedAt) ||
    compareNullableTimestampsDesc(left?.discoveredAt, right?.discoveredAt) ||
    compareText(left?.name, right?.name) ||
    compareText(left?.sourceUrl, right?.sourceUrl)
  );
}

export function sortCuratedItemsByRelevance(items) {
  if (!Array.isArray(items)) {
    throw new TypeError("items must be an array");
  }

  return [...items].sort(compareCuratedItemsByRelevance);
}

function extractRecencyHours(item, window) {
  const explicitRecency = finiteMetric(item?.scoringSignals?.recencyHours);

  if (explicitRecency != null) {
    return Math.max(0, explicitRecency);
  }

  const publishedAt = parseTimestamp(
    item?.publishedAt ??
      item?.metadata?.github?.pushedAt ??
      item?.metadata?.github?.updatedAt ??
      item?.metadata?.github?.createdAt,
  );
  const referenceTime = parseTimestamp(
    window?.endsAt ?? item?.discoveredAt ?? null,
  );

  if (publishedAt == null || referenceTime == null) {
    return null;
  }

  return Math.max(0, (referenceTime - publishedAt) / 3_600_000);
}

function scoreRecencyHours(recencyHours, config) {
  if (recencyHours >= config.recencyMaxAgeHours) {
    return 0;
  }

  return clamp(
    Math.round(100 * Math.pow(0.5, recencyHours / config.recencyHalfLifeHours)),
    0,
    100,
  );
}

function extractMentionCount(item) {
  const directCount = finiteMetric(
    item?.mentionCount ??
      item?.scoringSignals?.mentionCount ??
      item?.metrics?.mentions,
  );

  if (directCount != null) {
    return Math.max(0, directCount);
  }

  const mergedSourceCount = extractMergedSourceCount(item);

  if (mergedSourceCount > 0) {
    return mergedSourceCount;
  }

  const sourceUrls = resolveMentionSourceUrls(item);

  if (sourceUrls.length > 0) {
    return Math.max(1, countDistinctSourceClusters(sourceUrls));
  }

  return item?.sourceUrl ? 1 : 0;
}

function extractSourceAuthority(item) {
  const sourceAuthority = resolveSourceAuthorityMetric(item);

  return clamp(
    Math.round(
      Math.max(
        0,
        sourceAuthority ?? 0,
      ),
    ),
    0,
    100,
  );
}

function extractGitHubStars(item) {
  return Math.max(
    0,
    finiteMetric(
      item?.scoringSignals?.githubStars ?? item?.metadata?.github?.stars,
    ) ?? 0,
  );
}

function extractGitHubStarsToday(item) {
  return Math.max(
    0,
    finiteMetric(
      item?.metadata?.github?.starsToday ??
        (isGitHubItem(item) ? item?.metrics?.upvotes : null),
    ) ?? 0,
  );
}

function extractGitHubActivityInput(item, window, config) {
  const explicitActivity = finiteMetric(item?.scoringSignals?.githubActivity);

  if (explicitActivity != null) {
    return explicitActivity;
  }

  const recentPushScore = extractGitHubRecentPushScore(item, window, config);
  const starsTodayScore = normalizeLogarithmic(
    extractGitHubStarsToday(item),
    config.githubStarsTodaySaturation,
  );

  return blendScores(
    [
      [recentPushScore, 0.4],
      [starsTodayScore, 0.6],
    ],
    0,
  );
}

function extractGitHubRecentPushScore(item, window, config) {
  const pushedAt = parseTimestamp(
    item?.metadata?.github?.pushedAt ??
      item?.metadata?.github?.updatedAt ??
      item?.metadata?.github?.createdAt,
  );
  const referenceTime = parseTimestamp(
    window?.endsAt ?? item?.discoveredAt ?? null,
  );

  if (pushedAt == null || referenceTime == null) {
    return 0;
  }

  return scoreRecencyHours(
    Math.max(0, (referenceTime - pushedAt) / 3_600_000),
    config,
  );
}

function extractSocialEngagement(item) {
  const explicitEngagement = finiteMetric(item?.scoringSignals?.socialEngagement);

  if (explicitEngagement != null) {
    return Math.max(0, explicitEngagement);
  }

  return Math.max(0, finiteMetric(item?.metrics?.upvotes) ?? 0) +
    Math.max(0, finiteMetric(item?.metrics?.comments) ?? 0) +
    Math.max(0, finiteMetric(item?.metrics?.shares) ?? 0);
}

function hasRecencySignalData(item, window) {
  return extractRecencyHours(item, window) != null;
}

function hasSourceAuthorityData(item) {
  return resolveSourceAuthorityMetric(item) != null;
}

function hasMentionSignalData(item) {
  return (
    finiteMetric(item?.mentionCount) != null ||
    finiteMetric(item?.scoringSignals?.mentionCount) != null ||
    finiteMetric(item?.metrics?.mentions) != null ||
    extractMergedSourceCount(item) > 0 ||
    Array.isArray(item?.sourceUrls) ||
    Boolean(item?.sourceUrl)
  );
}

function hasGitHubSignalData(item, window) {
  return (
    finiteMetric(item?.scoringSignals?.githubStars) != null ||
    finiteMetric(item?.metadata?.github?.stars) != null ||
    finiteMetric(item?.metadata?.github?.starsToday) != null ||
    (isGitHubItem(item) && finiteMetric(item?.metrics?.upvotes) != null) ||
    finiteMetric(item?.scoringSignals?.githubActivity) != null ||
    hasGitHubRecentPushData(item, window)
  );
}

function hasSocialEngagementData(item) {
  return (
    finiteMetric(item?.scoringSignals?.socialEngagement) != null ||
    finiteMetric(item?.metrics?.upvotes) != null ||
    finiteMetric(item?.metrics?.comments) != null ||
    finiteMetric(item?.metrics?.shares) != null
  );
}

function resolveMentionSourceUrls(item) {
  if (Array.isArray(item?.sourceUrls) && item.sourceUrls.length > 0) {
    return item.sourceUrls;
  }

  return item?.sourceUrl ? [item.sourceUrl] : [];
}

function extractMergedSourceCount(item) {
  const mergedSourceIds = new Set();

  for (const value of item?.metadata?.mergedFrom ?? []) {
    if (typeof value === "string" && value.trim().length > 0) {
      mergedSourceIds.add(value.trim());
    }
  }

  for (const value of item?.metadata?.deduplicationClusterSourceIds ?? []) {
    if (typeof value === "string" && value.trim().length > 0) {
      mergedSourceIds.add(value.trim());
    }
  }

  return mergedSourceIds.size;
}

function blendScores(weightedScores, fallback = 0) {
  let totalWeight = 0;
  let totalScore = 0;

  for (const [score, weight] of weightedScores) {
    if (score == null || weight <= 0) {
      continue;
    }

    totalScore += score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return fallback;
  }

  return clamp(Math.round(totalScore / totalWeight), 0, 100);
}

function normalizeLogarithmic(value, saturationValue) {
  const normalizedValue = Math.max(0, finiteMetric(value) ?? 0);

  if (normalizedValue === 0 || saturationValue <= 0) {
    return 0;
  }

  const score =
    (Math.log10(normalizedValue + 1) / Math.log10(saturationValue + 1)) * 100;

  return clamp(Math.round(score), 0, 100);
}

function hasGitHubRecentPushData(item, window) {
  const pushedAt = parseTimestamp(
    item?.metadata?.github?.pushedAt ??
      item?.metadata?.github?.updatedAt ??
      item?.metadata?.github?.createdAt,
  );
  const referenceTime = parseTimestamp(
    window?.endsAt ?? item?.discoveredAt ?? null,
  );

  return pushedAt != null && referenceTime != null;
}

function finiteMetric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveSourceAuthorityMetric(item) {
  const scoringSignals = item?.scoringSignals;

  if (
    scoringSignals &&
    typeof scoringSignals === "object" &&
    !Array.isArray(scoringSignals) &&
    Object.prototype.hasOwnProperty.call(scoringSignals, "sourceAuthority")
  ) {
    return finiteMetric(scoringSignals.sourceAuthority);
  }

  return finiteMetric(item?.sourceAuthorityScore);
}

function resolveSentimentSpreadClassification(sentimentSpread) {
  if (typeof sentimentSpread === "string") {
    return sentimentSpread.trim().toLowerCase();
  }

  if (
    sentimentSpread &&
    typeof sentimentSpread === "object" &&
    !Array.isArray(sentimentSpread) &&
    typeof sentimentSpread.classification === "string"
  ) {
    return sentimentSpread.classification.trim().toLowerCase();
  }

  return null;
}

function parseTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isGitHubItem(item) {
  return (
    item?.sourceKinds?.includes("github") ||
    item?.adapterIds?.includes("github") ||
    item?.metadata?.github != null
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function compareNullableNumbersDesc(left, right) {
  const normalizedLeft = finiteMetric(left) ?? Number.NEGATIVE_INFINITY;
  const normalizedRight = finiteMetric(right) ?? Number.NEGATIVE_INFINITY;

  return normalizedRight - normalizedLeft;
}

function compareNullableTimestampsDesc(left, right) {
  const normalizedLeft = parseTimestamp(left) ?? Number.NEGATIVE_INFINITY;
  const normalizedRight = parseTimestamp(right) ?? Number.NEGATIVE_INFINITY;

  return normalizedRight - normalizedLeft;
}

function compareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), "en", {
    sensitivity: "base",
  });
}

function resolvePositiveConfigNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function resolveNonNegativeConfigNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function resolveNonEmptyConfigString(value, fallback) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function resolveScoreInterpretationConfig(value, fallback) {
  const resolvedValue = resolveNonEmptyConfigString(value, "");
  return SCORE_INTERPRETATIONS.includes(resolvedValue) ? resolvedValue : fallback;
}

function resolveScoreRangeConfig(value, fallback) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }

  const min = resolveFiniteConfigNumber(value.min, fallback.min);
  const max = resolveFiniteConfigNumber(value.max, fallback.max);

  if (min > max) {
    return { ...fallback };
  }

  return { min, max };
}

function resolveMinimumPublishedScore(value, fallback) {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(Math.round(value), 0, 100)
    : fallback;
}

function resolveFiniteConfigNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function resolveCurrentRelevanceScoreHistoryEntry() {
  const currentEntry = CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT.history.find(
    (entry) => entry.version === CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT.currentVersion,
  );

  if (currentEntry == null) {
    throw new TypeError("relevance score history must include the currentVersion entry");
  }

  return currentEntry;
}

function createRelevanceScoreVersionHistoryEntry({
  version,
  changeType,
  effectiveAt,
  summary,
  rationale,
  formulaDefinition,
}) {
  const resolvedConfig = buildRelevanceScoringConfig({
    ...formulaDefinition.config,
    scoreVersion: version,
  }, BASE_RELEVANCE_SCORING_CONFIG);
  const fields = Object.freeze(
    formulaDefinition.fields.map((field) =>
      Object.freeze({
        name: field.name,
        weight: field.weight,
        description: field.description,
        rules: Object.freeze([...field.rules]),
      }),
    ),
  );
  const rules = Object.freeze(
    formulaDefinition.rules.map((rule) =>
      Object.freeze({
        name: rule.name,
        description: rule.description,
      }),
    ),
  );
  const factors = Object.freeze(
    fields.map((field) =>
      Object.freeze({
        name: field.name,
        weight: field.weight,
        details: [field.description, ...field.rules].join(" "),
      }),
    ),
  );

  return Object.freeze({
    changeType,
    version: resolvedConfig.scoreVersion,
    scoreInterpretation: resolvedConfig.scoreInterpretation,
    scoreRange: Object.freeze({ ...resolvedConfig.scoreRange }),
    effectiveAt,
    summary,
    rationale,
    formula: formulaDefinition.formula,
    weightingPolicy: formulaDefinition.weightingPolicy,
    minimumPublishedScore: resolveMinimumPublishedScore(
      formulaDefinition.minimumPublishedScore,
      DEFAULT_MIN_RELEVANCE_SCORE,
    ),
    fields,
    rules,
    factors,
  });
}
