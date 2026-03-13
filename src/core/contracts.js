export const SOURCE_KINDS = ["x", "github", "arxiv", "reddit", "web"];
export const CONTENT_CATEGORIES = ["tool", "api", "library", "technique"];
export const STORYLINE_STATUSES = ["developing", "stable", "archived"];
export const RISK_SEVERITIES = ["unknown", "low", "medium", "high", "critical"];
export const RISK_WARNING_DIMENSIONS = ["security", "maturity", "adoption_complexity"];
export const SOURCE_SENTIMENTS = ["positive", "negative", "neutral"];
export const SENTIMENT_SPREADS = ["agree", "disagree", "mixed"];
export const DISAGREEMENT_DIMENSIONS = ["security", "utility", "novelty", "market"];
export const SCORE_INTERPRETATIONS = [
  "predictive",
  "assessment",
  "classificatory",
];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/**
 * @typedef {"x" | "github" | "arxiv" | "reddit" | "web"} SourceKind
 * @typedef {"tool" | "api" | "library" | "technique"} ContentCategory
 * @typedef {"developing" | "stable" | "archived"} StorylineStatus
 * @typedef {"unknown" | "low" | "medium" | "high" | "critical"} RiskSeverity
 * @typedef {"positive" | "negative" | "neutral"} SourceSentiment
 * @typedef {"agree" | "disagree" | "mixed"} SentimentSpreadClassification
 * @typedef {"security" | "utility" | "novelty" | "market"} DisagreementDimension
 * @typedef {"predictive" | "assessment" | "classificatory"} ScoreInterpretation
 *
 * @typedef {Object} SentimentSpread
 * @property {SentimentSpreadClassification} classification
 * @property {DisagreementDimension} [disagreementDimension]
 *
 * @typedef {Object} RiskWarningDimension
 * @property {RiskSeverity} severity
 * @property {string} description
 *
 * @typedef {Object} RiskWarning
 * @property {RiskSeverity} severity
 * @property {string} description
 * @property {RiskWarningDimension} [security]
 * @property {RiskWarningDimension} [maturity]
 * @property {RiskWarningDimension} [adoption_complexity]
 *
 * @typedef {Object} SourceSentimentEvidence
 * @property {string} sourceUrl
 * @property {SourceSentiment} sentiment
 * @property {DisagreementDimension} [disagreementDimension]
 *
 * @typedef {Object} ScoringSignals
 * @property {number | null} recencyHours
 * @property {number | null} sourceAuthority
 * @property {number} mentionCount
 * @property {number | null} githubStars
 * @property {number | null} githubActivity
 * @property {number | null} socialEngagement
 *
 * @typedef {Object} CanonicalIdentifiers
 * @property {string} entityName
 * @property {string | null} repositoryUrl
 * @property {string | null} doi
 * @property {Record<string, string>} sourceIds
 *
 * @typedef {Object} NewsletterStoryline
 * @property {string} storylineId
 * @property {string} title
 * @property {string[]} memberItemIds Chronologically ordered stable item ids.
 * @property {StorylineStatus} status
 * @property {string[]} [parentStorylineIds]
 * @property {{ key: string, label?: string, metadata?: Record<string, unknown> }} [narrativeType]
 *
 * @typedef {Object} SourceDescriptor
 * @property {string} id
 * @property {SourceKind} kind
 * @property {string} displayName
 * @property {number} authorityScore
 * @property {boolean} seeded
 * @property {boolean} supportsDiscovery
 * @property {number} minimumItemAuthorityScore
 *
 * @typedef {Object} DiscoveredSourceLifecycle
 * @property {"probation" | "active" | "retired"} state
 * @property {"probation" | "active" | "retired"} stage
 * @property {string | null} probationStartedAt
 * @property {string | null} activatedAt
 * @property {string | null} retiredAt
 *
 * @typedef {Object} DiscoveredSource
 * @property {string} id
 * @property {SourceKind} kind
 * @property {string} displayName
 * @property {string} url
 * @property {"candidate" | "approved" | "retired"} status
 * @property {DiscoveredSourceLifecycle} lifecycle
 * @property {number} authorityScore
 * @property {number} authorityWeight
 * @property {number} weightedAuthorityScore
 * @property {string[]} discoveredFromUrls
 *
 * @typedef {Object} NormalizedItem
 * @property {string} id
 * @property {string} itemId
 * @property {string} name
 * @property {string} sourceUrl
 * @property {string[]} sourceUrls
 * @property {ContentCategory} category
 * @property {string} summary
 * @property {string} integrationHint
 * @property {number | null} relevanceScore
 * @property {string | null} scoreVersion
 * @property {ScoreInterpretation | null} scoreInterpretation
 * @property {boolean} divergenceFlag
 * @property {SourceSentiment | null} sourceSentiment
 * @property {SentimentSpread} sentimentSpread
 * @property {RiskWarning} riskWarning
 * @property {number} mentionCount
 * @property {string | null} publishedAt
 * @property {string} discoveredAt
 * @property {string} firstSeen
 * @property {number} editionCount
 * @property {string | null} scopeVersion
 * @property {string | null} storylineId
 * @property {string[]} storylineIds
 * @property {number | null} storylineMemberPosition
 * @property {CanonicalIdentifiers} canonicalIdentifiers
 * @property {SourceKind[]} sourceKinds
 * @property {string[]} adapterIds
 * @property {number} sourceAuthorityScore
 * @property {ScoringSignals} scoringSignals
 * @property {Record<string, unknown> & { sourceSentiments?: SourceSentimentEvidence[] }} metadata
 *
 * @typedef {Object} FetchWindow
 * @property {string} startsAt
 * @property {string} endsAt
 * @property {string} [timezone]
 *
 * @typedef {Object} SourceFetchResult
 * @property {Array<Partial<NormalizedItem> & Pick<NormalizedItem, "name" | "sourceUrl" | "category" | "summary" | "integrationHint">>} items
 * @property {Array<Partial<DiscoveredSource> & Pick<DiscoveredSource, "id" | "kind" | "displayName" | "url">>} [discoveredSources]
 * @property {string | null} [cursor]
 *
 * @typedef {Object} SourceAdapter
 * @property {SourceDescriptor} descriptor
 * @property {(window: FetchWindow) => Promise<SourceFetchResult>} fetch
 *
 * @typedef {Object} DeduplicationHooks
 * @property {(item: NormalizedItem) => string[]} fingerprints
 * @property {(left: NormalizedItem, right: NormalizedItem) => boolean} isDuplicate
 * @property {(left: NormalizedItem, right: NormalizedItem) => NormalizedItem} merge
 */

export function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

export function assertOneOf(value, allowedValues, fieldName) {
  if (!allowedValues.includes(value)) {
    throw new TypeError(`${fieldName} must be one of: ${allowedValues.join(", ")}`);
  }

  return value;
}

export function clampScore(value, fieldName) {
  if (value == null) {
    return 0;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError(`${fieldName} must be a number`);
  }

  return Math.max(0, Math.min(100, value));
}

export function normalizeOptionalMetric(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError(`${fieldName} must be a number when provided`);
  }

  return value;
}

export function normalizePositiveInteger(value, fallback = 1) {
  if (value == null) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("mentionCount must be a finite number when provided");
  }

  return Math.max(1, Math.trunc(value));
}

export function canonicalizeUrl(value, fieldName = "url") {
  const rawValue = assertNonEmptyString(value, fieldName);
  const url = new URL(rawValue);

  url.hash = "";

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  const searchEntries = [...url.searchParams.entries()].sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  url.search = "";

  for (const [key, searchValue] of searchEntries) {
    url.searchParams.append(key, searchValue);
  }

  return url.toString();
}

export function normalizeTimestamp(value, fieldName) {
  const rawValue = assertNonEmptyString(value, fieldName);
  const date = new Date(rawValue);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${fieldName} must be a valid timestamp`);
  }

  const isoValue = date.toISOString();

  if (!ISO_DATE_PATTERN.test(isoValue)) {
    throw new TypeError(`${fieldName} must normalize to an ISO-8601 UTC timestamp`);
  }

  return isoValue;
}

export function uniqueStrings(values) {
  return [...new Set(values)];
}

export function normalizeComparableText(value) {
  return assertNonEmptyString(value, "value")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function slugify(value) {
  return normalizeComparableText(value).replace(/\s+/g, "-");
}
