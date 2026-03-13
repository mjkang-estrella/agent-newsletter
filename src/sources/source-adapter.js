export class SourceAdapterError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
  }
}

export class SourceAdapterConfigurationError extends SourceAdapterError {}

export class SourceAdapterNotImplementedError extends SourceAdapterError {}

export const DEFAULT_FETCH_WINDOW_HOURS = 24;

/**
 * @typedef {Object} SourceFetchWindow
 * @property {Date} since
 * @property {Date} until
 */

/**
 * @typedef {Object} SourceRecord
 * @property {string} adapterId
 * @property {string} sourceType
 * @property {string} externalId
 * @property {string} title
 * @property {string} sourceName
 * @property {string} sourceUrl
 * @property {string[]} [sourceUrls]
 * @property {string} publishedAt
 * @property {string} [discoveredAt]
 * @property {string} summary
 * @property {string[]} outboundUrls
 * @property {string[]} tags
 * @property {string} [category]
 * @property {string} [integrationHint]
 * @property {"positive" | "negative" | "neutral" | null} [sourceSentiment]
 * @property {string | null} author
 * @property {{mentions: number, upvotes: number, comments: number, shares: number}} metrics
 * @property {{authority: number}} sourceAuthority
 * @property {{
 *   recencyHours?: number | null,
 *   sourceAuthority?: number,
 *   mentionCount?: number,
 *   githubStars?: number | null,
 *   githubActivity?: number | null,
 *   socialEngagement?: number | null,
 * }} [scoringSignals]
 * @property {{
 *   severity?: string,
 *   description?: string,
 *   security?: { severity: string, description: string },
 *   maturity?: { severity: string, description: string },
 *   adoption_complexity?: { severity: string, description: string },
 *   adoptionComplexity?: { severity: string, description: string },
 * }} [riskWarning]
 * @property {number | null} [relevanceScore]
 * @property {Record<string, unknown>} [metadata]
 * @property {Record<string, unknown>} raw
 */

export function normalizeDate(value, fieldName = "date") {
  if (value === undefined || value === null) {
    throw new SourceAdapterConfigurationError(`Missing required ${fieldName}.`);
  }

  const parsed =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new SourceAdapterConfigurationError(
      `Invalid ${fieldName}: ${String(value)}`,
    );
  }

  return parsed;
}

export function normalizeFetchWindow({
  since,
  until,
  windowHours = DEFAULT_FETCH_WINDOW_HOURS,
} = {}) {
  const normalizedUntil = until ? normalizeDate(until, "until") : new Date();
  const normalizedSince = since
    ? normalizeDate(since, "since")
    : new Date(normalizedUntil.getTime() - windowHours * 60 * 60 * 1000);

  if (normalizedSince > normalizedUntil) {
    throw new SourceAdapterConfigurationError(
      "Fetch window is invalid: `since` must be earlier than `until`.",
    );
  }

  return {
    since: normalizedSince,
    until: normalizedUntil,
  };
}

export function ensureFetchImplementation(fetchImpl) {
  if (typeof fetchImpl !== "function") {
    throw new SourceAdapterConfigurationError(
      "A fetch implementation is required for source adapters.",
    );
  }

  return fetchImpl;
}

export function readResponseHeader(headers, key) {
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

export function resolveRetryAfterMs(response, fallbackMs, nowMs = Date.now()) {
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
    return Math.max(0, retryAt.getTime() - nowMs);
  }

  return fallbackMs;
}

export class SourceAdapter {
  constructor({ id, name, type, enabled = true }) {
    if (!id || !name || !type) {
      throw new SourceAdapterConfigurationError(
        "Source adapters require id, name, and type.",
      );
    }

    this.id = id;
    this.name = name;
    this.type = type;
    this.enabled = enabled;
  }

  assertEnabled() {
    if (!this.enabled) {
      throw new SourceAdapterConfigurationError(
        `Source adapter "${this.id}" is disabled.`,
      );
    }
  }

  getCredentialStatus() {
    return {
      configured: true,
      missing: [],
    };
  }

  validateConfig() {
    return this.getCredentialStatus();
  }

  isConfigured() {
    return this.getCredentialStatus().configured;
  }

  async fetchItems() {
    throw new SourceAdapterNotImplementedError(
      `Source adapter "${this.id}" does not implement fetchItems().`,
    );
  }
}
