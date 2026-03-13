import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { normalizeTimestamp } from "../core/contracts.js";
import { mergeCanonicalIdentifiers } from "../core/item-identity.js";
import { buildNewsletterExclusionAnalytics } from "./exclusion-analytics.js";
import { buildNewsletterExclusionReport } from "./exclusion-report.js";
import { buildNewsletterExclusionSummaryResult } from "./exclusion-summary.js";
import { buildItemLifecycleFromEditions } from "./item-lifecycle.js";
import { selectReferenceItemsFromEditions } from "./reference-index.js";
import { DEFAULT_ARCHIVE_WINDOW_DAYS, createNewsletterEdition } from "./schema.js";
import { selectActiveStorylinesFromEditions } from "./storyline-index.js";
import { buildTrackedStorylineStatesFromEditions } from "./storyline.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export class NewsletterEditionStore {
  constructor({ directoryPath } = {}) {
    if (typeof directoryPath !== "string" || directoryPath.trim().length === 0) {
      throw new TypeError("directoryPath is required");
    }

    this.directoryPath = directoryPath;
  }

  async publish(edition) {
    const normalizedEdition = createNewsletterEdition(edition);
    const filePath = join(this.directoryPath, `${normalizedEdition.id}.json`);

    await mkdir(this.directoryPath, { recursive: true });
    await writeFile(filePath, `${JSON.stringify(normalizedEdition, null, 2)}\n`, "utf8");

    return normalizedEdition;
  }

  async loadLatest({ now = new Date().toISOString() } = {}) {
    const publishedEditions = await this.readPublishedEditions(now);
    return publishedEditions[0] ?? null;
  }

  async loadHistory({
    now = new Date().toISOString(),
    days = DEFAULT_ARCHIVE_WINDOW_DAYS,
  } = {}) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const archiveWindowDays = normalizeArchiveWindowDays(days);
    const cutoff = new Date(new Date(normalizedNow).getTime() - archiveWindowDays * DAY_IN_MS);
    const publishedEditions = await this.readPublishedEditions(normalizedNow);

    return publishedEditions.filter(
      (edition) => new Date(edition.publishedAt).getTime() > cutoff.getTime(),
    );
  }

  async loadReferenceItems({
    now = new Date().toISOString(),
    days = DEFAULT_ARCHIVE_WINDOW_DAYS,
    underrepresentedCategories = [],
  } = {}) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const publishedEditions = await this.readPublishedEditions(normalizedNow);

    return selectReferenceItemsFromEditions(publishedEditions, {
      now: normalizedNow,
      archiveWindowDays: normalizeArchiveWindowDays(days),
      underrepresentedCategories,
    });
  }

  async loadItemLifecycle({ itemId, now = new Date().toISOString() } = {}) {
    const publishedEditions = await this.readPublishedEditions(now);
    return buildItemLifecycleFromEditions(publishedEditions, itemId);
  }

  async loadActiveStorylines({ now = new Date().toISOString() } = {}) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const publishedEditions = await this.readPublishedEditions(normalizedNow);

    return selectActiveStorylinesFromEditions(publishedEditions, {
      now: normalizedNow,
    });
  }

  async loadExclusionAnalytics({
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
    const publishedEditions = await this.readPublishedEditions(normalizedNow);

    return buildNewsletterExclusionAnalytics(publishedEditions, {
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

  async loadExclusionSummary(options = {}) {
    return buildNewsletterExclusionSummaryResult(
      await this.loadExclusionAnalytics(options),
    );
  }

  async loadExclusionReport({
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
    const publishedEditions = await this.readPublishedEditions(normalizedNow);

    return buildNewsletterExclusionReport(publishedEditions, {
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

  async loadTrackedItemStates({ before = new Date().toISOString() } = {}) {
    const normalizedBefore = normalizeTimestamp(before, "before");
    const beforeMs = new Date(normalizedBefore).getTime();
    const publishedEditions = await this.readPublishedEditions(normalizedBefore);
    const trackedItemStates = new Map();

    for (const edition of [...publishedEditions].reverse()) {
      if (new Date(edition.publishedAt).getTime() >= beforeMs) {
        continue;
      }

      for (const item of edition.items) {
        const trackedItemId = item.itemId ?? item.id;
        const previousState = trackedItemStates.get(trackedItemId);

        trackedItemStates.set(
          trackedItemId,
          createTrackedItemState({
            itemId: trackedItemId,
            sourceId: item.id ?? trackedItemId,
            item,
            publishedAt: edition.publishedAt,
            firstSeen: pickEarlierTimestamp(
              previousState?.firstSeen ?? null,
              item.firstSeen ?? edition.publishedAt,
            ),
            editionCount: Math.max(
              item.editionCount ?? 1,
              (previousState?.editionCount ?? 0) + 1,
            ),
            storylineId: item.storylineId ?? previousState?.storylineId ?? null,
            storylineMemberPosition:
              item.storylineMemberPosition ??
              previousState?.storylineMemberPosition ??
              null,
            canonicalIdentifiers: mergeCanonicalIdentifiers(
              previousState?.canonicalIdentifiers ?? null,
              item.canonicalIdentifiers ?? null,
            ),
            scopeVersion: resolveTrackedScopeVersion(
              previousState?.scopeVersion ?? null,
              readItemScopeVersion(item),
            ),
          }),
        );
      }
    }

    return trackedItemStates;
  }

  async loadTrackedStorylineStates({ before = new Date().toISOString() } = {}) {
    const normalizedBefore = normalizeTimestamp(before, "before");
    const publishedEditions = await this.readPublishedEditions(normalizedBefore);

    return buildTrackedStorylineStatesFromEditions(publishedEditions, {
      before: normalizedBefore,
    });
  }

  async readPublishedEditions(now) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const nowMs = new Date(normalizedNow).getTime();
    const entries = await this.readEditionEntries();
    const editions = await Promise.all(
      entries.map(async (entry) => createNewsletterEdition(await this.readEditionFile(entry))),
    );

    return editions
      .filter((edition) => new Date(edition.publishedAt).getTime() <= nowMs)
      .sort(
        (left, right) =>
          new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
      );
  }

  async readEditionEntries() {
    try {
      const entries = await readdir(this.directoryPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  async readEditionFile(entryName) {
    const raw = await readFile(join(this.directoryPath, entryName), "utf8");
    return JSON.parse(raw);
  }
}

function normalizeArchiveWindowDays(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("days must be a positive integer");
  }

  return value;
}

function pickEarlierTimestamp(left, right) {
  if (left == null) {
    return right ?? null;
  }

  if (right == null) {
    return left;
  }

  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function createTrackedItemState({
  itemId,
  sourceId,
  item,
  publishedAt,
  firstSeen,
  editionCount,
  storylineId,
  storylineMemberPosition,
  canonicalIdentifiers,
  scopeVersion,
}) {
  const state = {
    firstSeen,
    editionCount,
    canonicalIdentifiers: canonicalIdentifiers ?? null,
    ...(scopeVersion != null ? { scopeVersion } : {}),
  };

  if (storylineId != null) {
    state.storylineId = storylineId;
  }

  if (storylineMemberPosition != null) {
    state.storylineMemberPosition = storylineMemberPosition;
  }

  Object.defineProperties(state, {
    itemId: {
      value: itemId,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    id: {
      value: sourceId,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    item: {
      value: item,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    publishedAt: {
      value: publishedAt ?? null,
      enumerable: false,
      configurable: true,
      writable: true,
    },
  });

  return state;
}

function readItemScopeVersion(item) {
  const value =
    item?.scopeVersion ??
    item?.scope_version ??
    item?.metadata?.scopeVersion ??
    item?.metadata?.scope_version ??
    item?.metadata?.scope?.version ??
    null;

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveTrackedScopeVersion(previousScopeVersion, currentScopeVersion) {
  return currentScopeVersion ?? previousScopeVersion ?? null;
}
