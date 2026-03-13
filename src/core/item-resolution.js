import { uniqueStrings } from "./contracts.js";
import {
  ENTITY_RESOLUTION_MATCH_KINDS,
  mergeCanonicalIdentifiers,
  resolveEntityIdentityMatch,
} from "./item-identity.js";

export class ItemResolutionService {
  constructor({ compareCandidates = compareItemResolutionCandidates } = {}) {
    if (typeof compareCandidates !== "function") {
      throw new TypeError("compareCandidates must be a function");
    }

    this.compareCandidates = compareCandidates;
  }

  match(item, candidates = []) {
    const normalizedItem = normalizeResolutionItem(item);
    const normalizedCandidates = normalizeResolutionCandidates(candidates);

    return (
      findDirectMatch([normalizedItem], normalizedCandidates, this.compareCandidates) ??
      findEntityMatch([normalizedItem], normalizedCandidates, this.compareCandidates)
    )?.original ?? null;
  }

  matchGroup(group, candidates = []) {
    if (!Array.isArray(group) || group.length === 0) {
      throw new TypeError("group must contain at least one item");
    }

    const normalizedGroup = group.map((item) => normalizeResolutionItem(item));
    const normalizedCandidates = normalizeResolutionCandidates(candidates);

    return (
      findDirectMatch(normalizedGroup, normalizedCandidates, this.compareCandidates) ??
      findEntityMatch(normalizedGroup, normalizedCandidates, this.compareCandidates)
    )?.original ?? null;
  }

  resolve(item, candidates = []) {
    const normalizedItem = normalizeResolutionItem(item);
    const matchedCandidate = this.match(normalizedItem.item, candidates);
    const normalizedCandidate =
      matchedCandidate == null ? null : normalizeResolutionCandidate(matchedCandidate, 0);

    return {
      matchedCandidate,
      id: resolveReportedItemId(normalizedItem.item, normalizedCandidate),
      itemId:
        normalizedCandidate?.itemId ??
        normalizedItem.item.itemId ??
        normalizedItem.item.id,
      firstSeen:
        normalizedCandidate?.firstSeen ??
        normalizedItem.item.firstSeen ??
        normalizedItem.item.discoveredAt,
      editionCount:
        normalizedCandidate == null
          ? normalizedItem.item.editionCount ?? 1
          : normalizedCandidate.editionCount + 1,
      scopeVersion:
        normalizedCandidate?.scopeVersion ?? readItemScopeVersion(normalizedItem.item),
      canonicalIdentifiers: mergeCanonicalIdentifiers(
        normalizedCandidate?.canonicalIdentifiers ?? null,
        normalizedItem.item.canonicalIdentifiers ?? null,
      ),
    };
  }
}

function normalizeResolutionCandidates(candidates) {
  if (candidates == null) {
    return [];
  }

  if (candidates instanceof Map) {
    return [...candidates.entries()]
      .map(([key, candidate], index) => normalizeResolutionCandidate(candidate, index, key))
      .filter(Boolean);
  }

  const values = Array.isArray(candidates)
    ? candidates
    : typeof candidates[Symbol.iterator] === "function"
      ? [...candidates]
      : null;

  if (!values) {
    throw new TypeError("candidates must be an array, map, or iterable");
  }

  return values
    .map((candidate, index) => normalizeResolutionCandidate(candidate, index))
    .filter(Boolean);
}

function normalizeResolutionItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new TypeError("item must be an object");
  }

  return {
    item,
    keys: uniqueStrings([item.itemId, item.id].filter(isPresentString)),
  };
}

function normalizeResolutionCandidate(candidate, index, resolutionKey = null) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const item =
    candidate.item && typeof candidate.item === "object" && !Array.isArray(candidate.item)
      ? candidate.item
      : candidate;

  return {
    original: candidate,
    index,
    item,
    id: normalizeOptionalString(candidate.id ?? candidate.sourceId ?? item.id ?? null),
    itemId: normalizeOptionalString(candidate.itemId ?? resolutionKey ?? item.itemId ?? null),
    firstSeen: candidate.firstSeen ?? item.firstSeen ?? item.discoveredAt ?? null,
    editionCount: candidate.editionCount ?? item.editionCount ?? 1,
    scopeVersion:
      normalizeOptionalString(candidate.scopeVersion ?? candidate.scope_version ?? null) ??
      readItemScopeVersion(item),
    timestamp: resolveResolutionTimestamp(candidate, item),
    canonicalIdentifiers: mergeCanonicalIdentifiers(
      candidate.canonicalIdentifiers ?? null,
      item.canonicalIdentifiers ?? null,
    ),
    keys: uniqueStrings(
      [
        candidate.itemId,
        resolutionKey,
        candidate.id,
        candidate.sourceId,
        item.itemId,
        item.id,
      ].filter(isPresentString),
    ),
  };
}

function findDirectMatch(items, candidates, compareCandidates) {
  const itemKeys = new Set(uniqueStrings(items.flatMap((item) => item.keys)));

  if (itemKeys.size === 0) {
    return null;
  }

  let bestMatch = null;

  for (const candidate of candidates) {
    if (!candidate.keys.some((key) => itemKeys.has(key))) {
      continue;
    }

    if (bestMatch == null || compareCandidates(candidate, bestMatch) > 0) {
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

function findEntityMatch(items, candidates, compareCandidates) {
  const canonicalMatch = findResolvedCandidateMatch(
    items,
    candidates,
    compareCandidates,
    {
      allowTextSimilarity: false,
    },
  );

  if (canonicalMatch) {
    return canonicalMatch.candidate;
  }

  return findResolvedCandidateMatch(items, candidates, compareCandidates, {
    allowTextSimilarity: true,
    requiredKind: ENTITY_RESOLUTION_MATCH_KINDS.TEXT_SIMILARITY,
  })?.candidate ?? null;
}

function compareResolvedCandidateMatch(left, right, compareCandidates) {
  const matchPriorityDelta = right.match.priority - left.match.priority;

  if (matchPriorityDelta !== 0) {
    return matchPriorityDelta;
  }

  return compareCandidates(left.candidate, right.candidate);
}

function compareEntityMatches(left, right) {
  const leftScore = left.score ?? 0;
  const rightScore = right.score ?? 0;

  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }

  return rightScore - leftScore;
}

function findResolvedCandidateMatch(
  items,
  candidates,
  compareCandidates,
  { allowTextSimilarity, requiredKind = null },
) {
  let bestMatch = null;

  for (const candidate of candidates) {
    const match = items.reduce((bestItemMatch, item) => {
      const resolvedMatch = resolveEntityIdentityMatch(item.item, candidate.item, {
        allowTextSimilarity,
      });

      if (!resolvedMatch || (requiredKind && resolvedMatch.kind !== requiredKind)) {
        return bestItemMatch;
      }

      if (!bestItemMatch) {
        return resolvedMatch;
      }

      return compareEntityMatches(resolvedMatch, bestItemMatch) < 0
        ? resolvedMatch
        : bestItemMatch;
    }, null);

    if (!match) {
      continue;
    }

    if (
      bestMatch == null ||
      compareResolvedCandidateMatch(
        { candidate, match },
        bestMatch,
        compareCandidates,
      ) > 0
    ) {
      bestMatch = { candidate, match };
    }
  }

  return bestMatch;
}

function compareItemResolutionCandidates(left, right) {
  const leftEditionCount = left.editionCount ?? 0;
  const rightEditionCount = right.editionCount ?? 0;

  if (leftEditionCount !== rightEditionCount) {
    return leftEditionCount - rightEditionCount;
  }

  if (left.timestamp !== right.timestamp) {
    return left.timestamp - right.timestamp;
  }

  return right.index - left.index;
}

function resolveResolutionTimestamp(candidate, item) {
  const timestamps = [
    candidate?.item?.publishedAt,
    candidate?.item?.discoveredAt,
    candidate?.item?.firstSeen,
    candidate?.firstSeen,
    item?.publishedAt,
    item?.discoveredAt,
    item?.firstSeen,
  ]
    .filter(Boolean)
    .map((timestamp) => new Date(timestamp).getTime())
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return 0;
  }

  return Math.max(...timestamps);
}

function resolveReportedItemId(item, candidate) {
  return (
    normalizeOptionalString(item?.id) ??
    normalizeOptionalString(candidate?.item?.id) ??
    normalizeOptionalString(candidate?.id) ??
    normalizeOptionalString(item?.itemId) ??
    null
  );
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isPresentString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readItemScopeVersion(item) {
  return normalizeOptionalString(
    item?.scopeVersion ??
      item?.scope_version ??
      item?.metadata?.scopeVersion ??
      item?.metadata?.scope_version ??
      item?.metadata?.scope?.version ??
      null,
  );
}
