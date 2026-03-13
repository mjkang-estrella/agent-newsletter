import { normalizeTimestamp } from "../core/contracts.js";
import { buildNewsletterExclusionAnalytics } from "../newsletter/exclusion-analytics.js";
import { buildNewsletterExclusionReport } from "../newsletter/exclusion-report.js";
import { buildNewsletterExclusionSummaryResult } from "../newsletter/exclusion-summary.js";
import { buildItemLifecycleFromEditions } from "../newsletter/item-lifecycle.js";
import { selectReferenceItemsFromEditions } from "../newsletter/reference-index.js";
import { DEFAULT_ARCHIVE_WINDOW_DAYS, createNewsletterEdition } from "../newsletter/schema.js";
import { selectActiveStorylinesFromEditions } from "../newsletter/storyline-index.js";
import { buildTrackedStorylineStatesFromEditions } from "../newsletter/storyline.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export class SupabaseNewsletterEditionStore {
  constructor({ dataStore } = {}) {
    if (
      !dataStore ||
      typeof dataStore.insertEdition !== "function" ||
      typeof dataStore.listEditionPayloads !== "function"
    ) {
      throw new TypeError(
        "dataStore must expose insertEdition() and listEditionPayloads()",
      );
    }

    this.dataStore = dataStore;
  }

  async publish(edition) {
    const normalizedEdition = createNewsletterEdition(edition);
    return createNewsletterEdition(await this.dataStore.insertEdition(normalizedEdition));
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
          {
            itemId: trackedItemId,
            sourceId: item.id ?? trackedItemId,
            firstSeen:
              previousState?.firstSeen == null
                ? item.firstSeen ?? edition.publishedAt
                : pickEarlierTimestamp(
                    previousState.firstSeen,
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
            canonicalIdentifiers:
              item.canonicalIdentifiers ?? previousState?.canonicalIdentifiers ?? null,
            scopeVersion:
              item.scopeVersion ?? previousState?.scopeVersion ?? null,
            latestItem: item,
            publishedAt: edition.publishedAt,
          },
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

  async getEditionById(id) {
    const payload = await this.dataStore.getEditionPayloadById(id);
    return payload ? createNewsletterEdition(payload) : null;
  }

  async getEditionByPublishedAt(publishedAt) {
    const payload = await this.dataStore.getEditionPayloadByPublishedAt(publishedAt);
    return payload ? createNewsletterEdition(payload) : null;
  }

  async readPublishedEditions(now) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const nowMs = new Date(normalizedNow).getTime();
    const editions = (await this.dataStore.listEditionPayloads({
      before: normalizedNow,
    })).map((entry) => createNewsletterEdition(entry));

    return editions
      .filter((edition) => new Date(edition.publishedAt).getTime() <= nowMs)
      .sort(
        (left, right) =>
          new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
      );
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
