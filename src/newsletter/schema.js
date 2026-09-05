import { assertNonEmptyString, normalizeTimestamp } from "../core/contracts.js";
import { createNormalizedItem } from "../core/schema.js";
import { normalizeEditionExclusions } from "./exclusion-analytics.js";
import {
  buildEditionExclusionSummary,
  createEditionExclusionSummary,
} from "./exclusion-summary.js";
import { CURRENT_NEWSLETTER_SCOPE_DEFINITION } from "./scope-definition.js";
import { createStoryline } from "./storyline.js";

export const DEFAULT_ARCHIVE_WINDOW_DAYS = 7;
const DATE_FORMATTER_CACHE = new Map();

export function createNewsletterEdition(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("edition must be an object");
  }

  const publishedAt = normalizeTimestamp(input.publishedAt, "publishedAt");
  const window = createEditionWindow(input.window ?? input.contentWindow);
  const editionId = input.id
    ? assertNonEmptyString(input.id, "id")
    : deriveEditionId(publishedAt, window.timezone);
  const items = normalizeEditionItems(input.items ?? []);
  const storylines = normalizeEditionStorylines(input.storylines ?? []);
  const exclusions = normalizeEditionExclusions(input.exclusions ?? []).map((exclusion) => ({
    ...exclusion,
    editionContext:
      exclusion.editionContext ??
      {
        editionId,
        publishedAt,
        window,
      },
  }));
  const exclusionSummary = createEditionExclusionSummary(
    input.exclusionSummary ??
      input.exclusion_summary ??
      buildEditionExclusionSummary(
        exclusions.map((exclusion) => ({
          category: exclusion.category,
          reasonCode: exclusion.reason,
          count: exclusion.count,
        })),
      ),
  );

  validateStorylineMembership(items, storylines);

  return {
    ...(input.publication ? { publication: structuredClone(input.publication) } : {}),
    id: editionId,
    publishedAt,
    window,
    items,
    storylines,
    ...(exclusions.length > 0 ? { exclusions } : {}),
    exclusionSummary,
  };
}

export function createEditionWindow(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("window must be an object");
  }

  const startsAt = normalizeTimestamp(input.startsAt, "window.startsAt");
  const endsAt = normalizeTimestamp(input.endsAt, "window.endsAt");

  if (new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
    throw new RangeError("window.startsAt must be earlier than window.endsAt");
  }

  return {
    startsAt,
    endsAt,
    timezone: normalizeTimezone(input.timezone ?? "UTC", "window.timezone"),
  };
}

function normalizeEditionItems(items) {
  if (!Array.isArray(items)) {
    throw new TypeError("items must be an array");
  }

  return items.map((item) =>
    createNormalizedItem({
      ...item,
      scopeVersion:
        item?.scopeVersion ??
        item?.scope_version ??
        item?.metadata?.scopeVersion ??
        item?.metadata?.scope_version ??
        item?.metadata?.scope?.version ??
        CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
    }),
  );
}

function normalizeEditionStorylines(storylines) {
  if (!Array.isArray(storylines)) {
    throw new TypeError("storylines must be an array");
  }

  const normalizedStorylines = storylines.map((storyline) => createStoryline(storyline));
  const storylineIds = new Set();

  for (const storyline of normalizedStorylines) {
    if (storylineIds.has(storyline.storylineId)) {
      throw new TypeError(`duplicate storylineId detected: ${storyline.storylineId}`);
    }

    storylineIds.add(storyline.storylineId);
  }

  return normalizedStorylines;
}

function validateStorylineMembership(items, storylines) {
  if (storylines.length === 0) {
    return;
  }

  const storylinesById = new Map(
    storylines.map((storyline) => [storyline.storylineId, storyline]),
  );
  const linkedItemsByStorylineId = new Map();

  for (const item of items) {
    if (!item.storylineId) {
      if (item.storylineMemberPosition != null) {
        throw new TypeError(
          `storylineMemberPosition requires storylineId for item ${item.itemId}`,
        );
      }

      continue;
    }

    const storyline = storylinesById.get(item.storylineId);

    if (!storyline) {
      throw new TypeError(`unknown storylineId for item ${item.itemId}: ${item.storylineId}`);
    }

    const memberIndex = storyline.memberItemIds.indexOf(item.itemId);
    const relationshipDecision =
      item.metadata?.storyline?.relationship?.decision ?? null;

    if (memberIndex === -1) {
      if (relationshipDecision === "repetition") {
        if (item.storylineMemberPosition != null) {
          throw new TypeError(
            `repetition-only storyline links must omit storylineMemberPosition for item ${item.itemId}`,
          );
        }

        continue;
      }

      throw new TypeError(
        `storyline ${item.storylineId} must include linked item ${item.itemId}`,
      );
    }

    if (
      item.storylineMemberPosition != null &&
      item.storylineMemberPosition !== memberIndex + 1
    ) {
      throw new TypeError(
        `storylineMemberPosition must match storyline chronology for item ${item.itemId}`,
      );
    }

    const linkedItems = linkedItemsByStorylineId.get(item.storylineId) ?? [];
    linkedItems.push({
      item,
      memberIndex,
    });
    linkedItemsByStorylineId.set(item.storylineId, linkedItems);
  }

  for (const [storylineId, linkedItems] of linkedItemsByStorylineId.entries()) {
    if (linkedItems.length < 2) {
      continue;
    }

    const orderedByMembership = [...linkedItems]
      .sort((left, right) => left.memberIndex - right.memberIndex)
      .map((entry) => entry.item.itemId);
    const orderedByChronology = [...linkedItems]
      .sort(compareStorylineLinkedItemsChronologically)
      .map((entry) => entry.item.itemId);

    if (!isSameOrderedStringList(orderedByMembership, orderedByChronology)) {
      throw new TypeError(
        `storyline ${storylineId} memberItemIds must be ordered chronologically`,
      );
    }
  }
}

function compareStorylineLinkedItemsChronologically(left, right) {
  return (
    new Date(resolveStorylineMembershipTimestamp(left.item)).getTime() -
      new Date(resolveStorylineMembershipTimestamp(right.item)).getTime() ||
    left.memberIndex - right.memberIndex ||
    left.item.itemId.localeCompare(right.item.itemId)
  );
}

function resolveStorylineMembershipTimestamp(item) {
  return item.firstSeen ?? item.discoveredAt ?? item.publishedAt;
}

function isSameOrderedStringList(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function deriveEditionId(publishedAt, timezone) {
  const formatter = getDateFormatter(timezone);
  const partMap = Object.fromEntries(
    formatter
      .formatToParts(new Date(publishedAt))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${partMap.year}-${partMap.month}-${partMap.day}`;
}

function normalizeTimezone(value, fieldName) {
  const timezone = assertNonEmptyString(value, fieldName);

  try {
    getDateFormatter(timezone).format(new Date());
  } catch (error) {
    throw new TypeError(`${fieldName} must be a valid IANA timezone`);
  }

  return timezone;
}

function getDateFormatter(timezone) {
  if (!DATE_FORMATTER_CACHE.has(timezone)) {
    DATE_FORMATTER_CACHE.set(
      timezone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    );
  }

  return DATE_FORMATTER_CACHE.get(timezone);
}
