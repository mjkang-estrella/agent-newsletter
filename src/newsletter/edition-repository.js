import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { normalizeTimestamp } from "../core/contracts.js";
import { buildNewsletterExclusionAnalytics } from "./exclusion-analytics.js";
import { buildNewsletterExclusionReport } from "./exclusion-report.js";
import { buildNewsletterExclusionSummaryResult } from "./exclusion-summary.js";
import { buildItemLifecycleFromEditions } from "./item-lifecycle.js";
import { selectReferenceItemsFromEditions } from "./reference-index.js";
import { DEFAULT_ARCHIVE_WINDOW_DAYS, createNewsletterEdition } from "./schema.js";
import { selectActiveStorylinesFromEditions } from "./storyline-index.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export class NewsletterEditionRepository {
  constructor({ filePath } = {}) {
    if (!filePath) {
      throw new Error("NewsletterEditionRepository requires a filePath");
    }

    this.filePath = filePath;
  }

  async load({ now = new Date().toISOString() } = {}) {
    return this.readSnapshot(now);
  }

  async save(snapshot) {
    const normalizedSnapshot = normalizeSnapshot(snapshot, snapshot?.updatedAt);

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(normalizedSnapshot, null, 2)}\n`, "utf8");
  }

  async listPublishedEditions({
    now = new Date().toISOString(),
    days = DEFAULT_ARCHIVE_WINDOW_DAYS,
  } = {}) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const archiveWindowDays = normalizeArchiveWindowDays(days);
    const cutoff = new Date(normalizedNow).getTime() - archiveWindowDays * DAY_IN_MS;
    const snapshot = await this.load({ now: normalizedNow });

    return snapshot.editions.filter((edition) => {
      const publishedAt = new Date(edition.publishedAt).getTime();

      return publishedAt <= new Date(normalizedNow).getTime() && publishedAt > cutoff;
    });
  }

  async getLatestPublishedEdition({ now = new Date().toISOString() } = {}) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const snapshot = await this.load({ now: normalizedNow });
    const nowMs = new Date(normalizedNow).getTime();

    return (
      snapshot.editions.find((edition) => new Date(edition.publishedAt).getTime() <= nowMs) ?? null
    );
  }

  async getItemLifecycle({ itemId, now = new Date().toISOString() } = {}) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const snapshot = await this.load({ now: normalizedNow });
    const nowMs = new Date(normalizedNow).getTime();
    const publishedEditions = snapshot.editions.filter(
      (edition) => new Date(edition.publishedAt).getTime() <= nowMs,
    );

    return buildItemLifecycleFromEditions(publishedEditions, itemId);
  }

  async listReferenceItems({
    now = new Date().toISOString(),
    days = DEFAULT_ARCHIVE_WINDOW_DAYS,
    underrepresentedCategories = [],
  } = {}) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const snapshot = await this.load({ now: normalizedNow });

    return selectReferenceItemsFromEditions(snapshot.editions, {
      now: normalizedNow,
      archiveWindowDays: normalizeArchiveWindowDays(days),
      underrepresentedCategories,
    });
  }

  async listActiveStorylines({ now = new Date().toISOString() } = {}) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const snapshot = await this.load({ now: normalizedNow });

    return selectActiveStorylinesFromEditions(snapshot.editions, {
      now: normalizedNow,
    });
  }

  async queryExclusionAnalytics({
    now = new Date().toISOString(),
    days = DEFAULT_ARCHIVE_WINDOW_DAYS,
    from = null,
    to = null,
    reason = null,
    category = null,
    sourceKind = null,
    adapterId = null,
    itemId = null,
    phase = null,
    minRecurringEditions = 2,
  } = {}) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const snapshot = await this.load({ now: normalizedNow });

    return buildNewsletterExclusionAnalytics(snapshot.editions, {
      now: normalizedNow,
      days,
      from,
      to,
      reason,
      category,
      sourceKind,
      adapterId,
      itemId,
      phase,
      minRecurringEditions,
    });
  }

  async queryExclusionSummary(options = {}) {
    return buildNewsletterExclusionSummaryResult(
      await this.queryExclusionAnalytics(options),
    );
  }

  async queryExclusionReport({
    now = new Date().toISOString(),
    days = DEFAULT_ARCHIVE_WINDOW_DAYS,
    from = null,
    to = null,
    reason = null,
    category = null,
    sourceKind = null,
    adapterId = null,
    itemId = null,
    phase = null,
    minRecurringEditions = 2,
  } = {}) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const snapshot = await this.load({ now: normalizedNow });

    return buildNewsletterExclusionReport(snapshot.editions, {
      now: normalizedNow,
      days,
      from,
      to,
      reason,
      category,
      sourceKind,
      adapterId,
      itemId,
      phase,
      minRecurringEditions,
    });
  }

  async readSnapshot(now) {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);

      return normalizeSnapshot(parsed, now);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return normalizeSnapshot(null, now);
      }

      throw error;
    }
  }
}

function normalizeSnapshot(snapshot, now = new Date().toISOString()) {
  const updatedAt = normalizeTimestamp(snapshot?.updatedAt ?? now, "updatedAt");
  const editions = Array.isArray(snapshot?.editions)
    ? snapshot.editions.map((edition) => createNewsletterEdition(edition)).sort(sortByPublishedAtDesc)
    : [];

  return {
    version: 1,
    updatedAt,
    editions,
  };
}

function normalizeArchiveWindowDays(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("days must be a positive integer");
  }

  return value;
}

function sortByPublishedAtDesc(left, right) {
  return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
}
