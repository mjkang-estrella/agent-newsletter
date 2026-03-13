import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  assertNonEmptyString,
  clampScore,
  normalizeTimestamp,
} from "../core/contracts.js";
import { mergeCanonicalIdentifiers } from "../core/item-identity.js";
import { ItemResolutionService } from "../core/item-resolution.js";
import { createNormalizedItem } from "../core/schema.js";
import { createNewsletterEdition } from "./schema.js";
import { CURRENT_NEWSLETTER_SCOPE_DEFINITION } from "./scope-definition.js";

export class ItemIdentityRepository {
  constructor({
    filePath,
    defaultScopeVersion = CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
    itemResolutionService = new ItemResolutionService(),
  } = {}) {
    if (!filePath) {
      throw new Error("ItemIdentityRepository requires a filePath");
    }

    if (!itemResolutionService || typeof itemResolutionService.match !== "function") {
      throw new TypeError("itemResolutionService must expose match(item, candidates)");
    }

    this.filePath = filePath;
    this.defaultScopeVersion = normalizeScopeVersion(
      defaultScopeVersion,
      "defaultScopeVersion",
    );
    this.itemResolutionService = itemResolutionService;
  }

  async load({ now = new Date().toISOString() } = {}) {
    return this.readSnapshot(now);
  }

  async save(snapshot) {
    const normalizedSnapshot = normalizeItemIdentitySnapshot(
      snapshot,
      snapshot?.updatedAt ?? new Date().toISOString(),
      { defaultScopeVersion: this.defaultScopeVersion },
    );

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(normalizedSnapshot, null, 2)}\n`, "utf8");
  }

  async recordEdition(
    edition,
    { scopeVersion = this.defaultScopeVersion } = {},
  ) {
    const normalizedEdition = createNewsletterEdition(edition);
    const normalizedScopeVersion = normalizeScopeVersion(scopeVersion, "scopeVersion");
    const snapshot = await this.load({ now: normalizedEdition.publishedAt });
    const recordsByItemId = new Map(snapshot.items.map((record) => [record.itemId, record]));

    for (const item of normalizedEdition.items) {
      const existingRecord =
        recordsByItemId.get(item.itemId) ??
        resolveExistingIdentityRecord(
          item,
          recordsByItemId.values(),
          this.itemResolutionService,
        );
      const resolvedItemId = existingRecord?.itemId ?? item.itemId;
      const resolvedSourceId =
        existingRecord?.sourceId ?? item.id ?? existingRecord?.latestItem.id ?? resolvedItemId;
      const firstSeen = pickEarlierTimestamp(
        existingRecord?.firstSeen ?? null,
        item.firstSeen ?? item.discoveredAt ?? normalizedEdition.publishedAt,
      );
      const scopeVersionForRecord =
        item.scopeVersion ??
        normalizedScopeVersion ??
        existingRecord?.scopeVersion ??
        this.defaultScopeVersion;
      const canonicalIdentifiers = mergeCanonicalIdentifiers(
        existingRecord?.canonicalIdentifiers ?? null,
        item.canonicalIdentifiers ?? null,
      );

      const nextRecord = createItemIdentityRecord(
        {
          itemId: resolvedItemId,
          sourceId: resolvedSourceId,
          firstSeen,
          lastSeen: pickLaterTimestamp(
            existingRecord?.lastSeen ?? null,
            normalizedEdition.publishedAt,
          ),
          scopeVersion: scopeVersionForRecord,
          canonicalIdentifiers,
          appearanceHistory: mergeAppearanceHistory(existingRecord?.appearanceHistory ?? [], [
            {
              editionId: normalizedEdition.id,
              publishedAt: normalizedEdition.publishedAt,
              relevanceScore: item.relevanceScore ?? null,
              scoreVersion: item.scoreVersion ?? null,
            },
          ]),
          latestItem: {
            ...item,
            itemId: resolvedItemId,
            firstSeen,
            scopeVersion: scopeVersionForRecord,
            canonicalIdentifiers,
          },
        },
        { defaultScopeVersion: this.defaultScopeVersion },
      );

      recordsByItemId.set(nextRecord.itemId, nextRecord);
    }

    const nextSnapshot = normalizeItemIdentitySnapshot(
      {
        version: 1,
        updatedAt: normalizedEdition.publishedAt,
        items: [...recordsByItemId.values()],
      },
      normalizedEdition.publishedAt,
      { defaultScopeVersion: this.defaultScopeVersion },
    );

    await this.save(nextSnapshot);

    return nextSnapshot;
  }

  async loadTrackedItemStates({ before = new Date().toISOString() } = {}) {
    const normalizedBefore = normalizeTimestamp(before, "before");
    const beforeMs = new Date(normalizedBefore).getTime();
    const snapshot = await this.load({ now: normalizedBefore });
    const trackedStates = new Map();

    for (const record of snapshot.items) {
      const priorAppearances = record.appearanceHistory.filter(
        (appearance) => new Date(appearance.publishedAt).getTime() < beforeMs,
      );
      const trackedEditionCount = resolveTrackedEditionCount(
        record,
        priorAppearances,
        beforeMs,
      );

      if (trackedEditionCount === 0) {
        continue;
      }

      trackedStates.set(
        record.itemId,
        createTrackedItemState(record, trackedEditionCount),
      );
    }

    return trackedStates;
  }

  async readSnapshot(now) {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);

      return normalizeItemIdentitySnapshot(parsed, now, {
        defaultScopeVersion: this.defaultScopeVersion,
      });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return normalizeItemIdentitySnapshot(null, now, {
          defaultScopeVersion: this.defaultScopeVersion,
        });
      }

      throw error;
    }
  }
}

export function normalizeItemIdentitySnapshot(
  snapshot,
  now = new Date().toISOString(),
  { defaultScopeVersion = CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion } = {},
) {
  const updatedAt = normalizeTimestamp(snapshot?.updatedAt ?? now, "updatedAt");
  const items = Array.isArray(snapshot?.items)
    ? snapshot.items
        .map((record) =>
          createItemIdentityRecord(record, {
            defaultScopeVersion,
          }),
        )
        .sort(sortItemIdentityRecords)
    : [];

  return {
    version: 1,
    updatedAt,
    items,
  };
}

export function createItemIdentityRecord(
  record,
  { defaultScopeVersion = CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion } = {},
) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("item identity record must be an object");
  }

  const latestItem = createNormalizedItem({
    ...(record.latestItem ?? record.latest_item ?? record.item ?? {}),
    itemId:
      record.itemId ??
      record.item_id ??
      record.latestItem?.itemId ??
      record.latestItem?.item_id ??
      record.latest_item?.itemId ??
      record.latest_item?.item_id,
    firstSeen:
      record.firstSeen ??
      record.first_seen ??
      record.latestItem?.firstSeen ??
      record.latest_item?.firstSeen,
    editionCount:
      record.editionCount ??
      record.edition_count ??
      record.latestItem?.editionCount ??
      record.latest_item?.editionCount,
    scopeVersion:
      record.scopeVersion ??
      record.scope_version ??
      record.latestItem?.scopeVersion ??
      record.latest_item?.scopeVersion ??
      defaultScopeVersion,
    canonicalIdentifiers: mergeCanonicalIdentifiers(
      record.canonicalIdentifiers ?? record.canonical_identifiers ?? null,
      record.latestItem?.canonicalIdentifiers ?? record.latest_item?.canonicalIdentifiers ?? null,
    ),
  });
  const itemId = assertNonEmptyString(
    record.itemId ?? record.item_id ?? latestItem.itemId,
    "itemIdentity.itemId",
  );
  const appearanceHistory = normalizeAppearanceHistory(
    record.appearanceHistory ??
      record.appearance_history ??
      record.appearances ??
      [],
  );
  const firstSeen = normalizeTimestamp(
    record.firstSeen ?? record.first_seen ?? latestItem.firstSeen,
    "itemIdentity.firstSeen",
  );
  const canonicalIdentifiers = mergeCanonicalIdentifiers(
    record.canonicalIdentifiers ?? record.canonical_identifiers ?? null,
    latestItem.canonicalIdentifiers ?? null,
  );
  const editionCount = Math.max(
    normalizeEditionCount(
      record.editionCount ?? record.edition_count ?? latestItem.editionCount ?? 1,
    ),
    appearanceHistory.length,
  );

  return {
    itemId,
    sourceId: normalizeNullableString(
      record.sourceId ?? record.source_id ?? record.id ?? latestItem.id ?? null,
    ),
    firstSeen,
    lastSeen: normalizeTimestamp(
      record.lastSeen ??
        record.last_seen ??
        appearanceHistory.at(-1)?.publishedAt ??
        latestItem.publishedAt ??
        latestItem.discoveredAt ??
        firstSeen,
      "itemIdentity.lastSeen",
    ),
    editionCount,
    scopeVersion: normalizeScopeVersion(
      record.scopeVersion ??
        record.scope_version ??
        latestItem.scopeVersion ??
        defaultScopeVersion,
      "itemIdentity.scopeVersion",
    ),
    canonicalIdentifiers,
    appearanceHistory,
    latestItem: createNormalizedItem({
      ...latestItem,
      itemId,
      firstSeen,
      editionCount,
      scopeVersion:
        latestItem.scopeVersion ??
        record.scopeVersion ??
        record.scope_version ??
        defaultScopeVersion,
      canonicalIdentifiers,
    }),
  };
}

function normalizeAppearanceHistory(appearances) {
  if (!Array.isArray(appearances)) {
    throw new TypeError("itemIdentity.appearanceHistory must be an array");
  }

  const appearancesByEditionId = new Map();

  for (const [index, appearance] of appearances.entries()) {
    if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) {
      throw new TypeError(`itemIdentity.appearanceHistory[${index}] must be an object`);
    }

    const normalizedAppearance = {
      editionId: assertNonEmptyString(
        appearance.editionId ?? appearance.edition_id,
        `itemIdentity.appearanceHistory[${index}].editionId`,
      ),
      publishedAt: normalizeTimestamp(
        appearance.publishedAt ?? appearance.published_at,
        `itemIdentity.appearanceHistory[${index}].publishedAt`,
      ),
      ...normalizeAppearanceScoreMetadata(appearance, index),
    };

    appearancesByEditionId.set(normalizedAppearance.editionId, normalizedAppearance);
  }

  return [...appearancesByEditionId.values()].sort(sortAppearances);
}

function normalizeAppearanceScoreMetadata(appearance, index) {
  const fieldPrefix = `itemIdentity.appearanceHistory[${index}]`;
  const relevanceScore =
    appearance.relevanceScore ?? appearance.relevance_score ?? null;
  const scoreVersion = appearance.scoreVersion ?? appearance.score_version ?? null;

  if (relevanceScore == null && scoreVersion == null) {
    return {};
  }

  if (relevanceScore == null) {
    throw new TypeError(`${fieldPrefix}.relevanceScore is required when scoreVersion is provided`);
  }

  if (scoreVersion == null) {
    throw new TypeError(`${fieldPrefix}.scoreVersion is required when relevanceScore is provided`);
  }

  return {
    relevanceScore: clampScore(relevanceScore, `${fieldPrefix}.relevanceScore`),
    scoreVersion: assertNonEmptyString(scoreVersion, `${fieldPrefix}.scoreVersion`),
  };
}

function mergeAppearanceHistory(existingAppearances, nextAppearances) {
  return normalizeAppearanceHistory([...existingAppearances, ...nextAppearances]);
}

function resolveExistingIdentityRecord(item, candidates, itemResolutionService) {
  const resolutionCandidates = [...candidates]
    .filter(Boolean)
    .map((record) => ({
      record,
      itemId: record.itemId,
      sourceId: record.sourceId,
      firstSeen: record.firstSeen,
      editionCount: record.editionCount,
      scopeVersion: record.scopeVersion,
      canonicalIdentifiers: record.canonicalIdentifiers,
      item: record.latestItem,
    }));
  const matchedCandidate = itemResolutionService.match(item, resolutionCandidates);

  return matchedCandidate?.record ?? null;
}

function createTrackedItemState(record, editionCount) {
  const state = {
    firstSeen: record.firstSeen,
    editionCount,
    scopeVersion: record.scopeVersion,
    canonicalIdentifiers: record.canonicalIdentifiers,
  };

  Object.defineProperties(state, {
    itemId: {
      value: record.itemId,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    id: {
      value: record.sourceId ?? record.latestItem.id ?? record.itemId,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    item: {
      value: record.latestItem,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    publishedAt: {
      value:
        record.appearanceHistory.at(-1)?.publishedAt ??
        record.latestItem.publishedAt ??
        record.lastSeen ??
        null,
      enumerable: false,
      configurable: true,
      writable: true,
    },
  });

  return state;
}

function resolveTrackedEditionCount(record, priorAppearances, beforeMs) {
  const recordedEditionCount = resolvePersistedTrackedEditionCount(record, beforeMs);

  if (priorAppearances.length === 0) {
    return recordedEditionCount;
  }

  return Math.max(priorAppearances.length, recordedEditionCount);
}

function resolvePersistedTrackedEditionCount(record, beforeMs) {
  if ((record?.editionCount ?? 0) === 0) {
    return 0;
  }

  // Older snapshots can persist rolled-up lifecycle fields without per-edition history.
  const lastTrackedAtMs = [
    record?.lastSeen,
    record?.appearanceHistory?.at(-1)?.publishedAt,
    record?.latestItem?.publishedAt,
    record?.latestItem?.discoveredAt,
    record?.latestItem?.firstSeen,
  ]
    .filter(Boolean)
    .map((timestamp) => new Date(timestamp).getTime())
    .filter((value) => Number.isFinite(value))
    .reduce((latest, value) => Math.max(latest, value), Number.NEGATIVE_INFINITY);

  if (!Number.isFinite(lastTrackedAtMs) || lastTrackedAtMs >= beforeMs) {
    return 0;
  }

  return record.editionCount ?? 0;
}

function normalizeEditionCount(value) {
  if (!Number.isFinite(value)) {
    throw new TypeError("itemIdentity.editionCount must be a finite number");
  }

  return Math.max(1, Math.trunc(value));
}

function normalizeNullableString(value) {
  if (value == null) {
    return null;
  }

  return assertNonEmptyString(value, "value");
}

function normalizeScopeVersion(value, fieldName) {
  return assertNonEmptyString(value, fieldName);
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

function pickLaterTimestamp(left, right) {
  if (left == null) {
    return right ?? null;
  }

  if (right == null) {
    return left;
  }

  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function sortAppearances(left, right) {
  const leftPublishedAt = new Date(left.publishedAt).getTime();
  const rightPublishedAt = new Date(right.publishedAt).getTime();

  if (leftPublishedAt !== rightPublishedAt) {
    return leftPublishedAt - rightPublishedAt;
  }

  return left.editionId.localeCompare(right.editionId);
}

function sortItemIdentityRecords(left, right) {
  const leftLastSeen = new Date(left.lastSeen).getTime();
  const rightLastSeen = new Date(right.lastSeen).getTime();

  if (rightLastSeen !== leftLastSeen) {
    return rightLastSeen - leftLastSeen;
  }

  return left.itemId.localeCompare(right.itemId);
}
