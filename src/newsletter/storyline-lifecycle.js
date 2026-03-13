import { assertOneOf, normalizeTimestamp } from "../core/contracts.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const LIFECYCLE_DECISIONS = ["origin", "evolution", "repetition", "fork", "merge"];
const MERGE_DISPOSITIONS = ["source", "target"];

export const STORYLINE_STATUSES = Object.freeze({
  developing: "developing",
  stable: "stable",
  archived: "archived",
});

export const DEFAULT_STORYLINE_LIFECYCLE_CONFIG = Object.freeze({
  stableAfterEvolutionCount: 2,
  archiveAfterIdleDays: 7,
  archiveAfterRepetitionStreak: 2,
});

export function normalizeStorylineStatus(value, fallback = STORYLINE_STATUSES.developing) {
  if (value == null) {
    return fallback;
  }

  return assertOneOf(value, Object.values(STORYLINE_STATUSES), "storyline.status");
}

export function normalizeStorylineLifecycleConfig(
  config = DEFAULT_STORYLINE_LIFECYCLE_CONFIG,
) {
  return {
    stableAfterEvolutionCount: normalizePositiveInteger(
      config.stableAfterEvolutionCount,
      DEFAULT_STORYLINE_LIFECYCLE_CONFIG.stableAfterEvolutionCount,
    ),
    archiveAfterIdleDays: normalizePositiveInteger(
      config.archiveAfterIdleDays,
      DEFAULT_STORYLINE_LIFECYCLE_CONFIG.archiveAfterIdleDays,
    ),
    archiveAfterRepetitionStreak: normalizePositiveInteger(
      config.archiveAfterRepetitionStreak,
      DEFAULT_STORYLINE_LIFECYCLE_CONFIG.archiveAfterRepetitionStreak,
    ),
  };
}

export function advanceStorylineLifecycle(
  previousState,
  {
    decision,
    mergeDisposition = "target",
    observedAt,
    config = DEFAULT_STORYLINE_LIFECYCLE_CONFIG,
  } = {},
) {
  const normalizedDecision = normalizeLifecycleDecision(decision);
  const normalizedMergeDisposition = normalizeMergeDisposition(
    normalizedDecision,
    mergeDisposition,
  );
  const normalizedObservedAt = normalizeTimestamp(observedAt, "observedAt");
  const normalizedConfig = normalizeStorylineLifecycleConfig(config);
  const prior = normalizeTrackedLifecycleState(previousState, normalizedConfig);

  if (
    normalizedDecision === "merge" &&
    normalizedMergeDisposition === MERGE_DISPOSITIONS[0]
  ) {
    return {
      status: STORYLINE_STATUSES.archived,
      updatedAt: normalizedObservedAt,
      lastEvolutionAt: prior.lastEvolutionAt,
      evolutionCount: prior.evolutionCount,
      repetitionCount: prior.repetitionCount,
      repetitionStreak: prior.repetitionStreak,
    };
  }

  const isEvolution =
    normalizedDecision === "origin" ||
    normalizedDecision === "evolution" ||
    normalizedDecision === "fork" ||
    normalizedDecision === "merge";
  const evolutionCount = prior.evolutionCount + (isEvolution ? 1 : 0);
  const repetitionCount = prior.repetitionCount + (isEvolution ? 0 : 1);
  const repetitionStreak = isEvolution ? 0 : prior.repetitionStreak + 1;
  const lastEvolutionAt = isEvolution ? normalizedObservedAt : prior.lastEvolutionAt;
  const idleDays = calculateElapsedDays(lastEvolutionAt, normalizedObservedAt);

  return {
    status: resolveStorylineStatus({
      previousStatus: prior.status,
      isEvolution,
      evolutionCount,
      repetitionStreak,
      idleDays,
      config: normalizedConfig,
    }),
    updatedAt: normalizedObservedAt,
    lastEvolutionAt,
    evolutionCount,
    repetitionCount,
    repetitionStreak,
  };
}

function resolveStorylineStatus({
  previousStatus,
  isEvolution,
  evolutionCount,
  repetitionStreak,
  idleDays,
  config,
}) {
  if (isEvolution) {
    if (previousStatus === STORYLINE_STATUSES.archived) {
      return STORYLINE_STATUSES.developing;
    }

    if (evolutionCount >= config.stableAfterEvolutionCount) {
      return STORYLINE_STATUSES.stable;
    }

    return STORYLINE_STATUSES.developing;
  }

  if (idleDays > config.archiveAfterIdleDays) {
    return STORYLINE_STATUSES.archived;
  }

  if (repetitionStreak >= config.archiveAfterRepetitionStreak) {
    return STORYLINE_STATUSES.archived;
  }

  if (evolutionCount >= config.stableAfterEvolutionCount) {
    return STORYLINE_STATUSES.stable;
  }

  return STORYLINE_STATUSES.developing;
}

function normalizeTrackedLifecycleState(
  state,
  config = DEFAULT_STORYLINE_LIFECYCLE_CONFIG,
) {
  const normalizedConfig = normalizeStorylineLifecycleConfig(config);

  return {
    status: normalizeStorylineStatus(
      state?.status,
      state?.evolutionCount >= normalizedConfig.stableAfterEvolutionCount
        ? STORYLINE_STATUSES.stable
        : STORYLINE_STATUSES.developing,
    ),
    updatedAt: normalizeTimestampOrNull(state?.updatedAt),
    lastEvolutionAt:
      normalizeTimestampOrNull(state?.lastEvolutionAt) ??
      normalizeTimestampOrNull(state?.updatedAt),
    evolutionCount: normalizeNonNegativeInteger(state?.evolutionCount, 0),
    repetitionCount: normalizeNonNegativeInteger(state?.repetitionCount, 0),
    repetitionStreak: normalizeNonNegativeInteger(state?.repetitionStreak, 0),
  };
}

function normalizePositiveInteger(value, fallback) {
  const normalized = normalizeNonNegativeInteger(value, fallback);
  return Math.max(1, normalized);
}

function normalizeNonNegativeInteger(value, fallback) {
  if (value == null) {
    return fallback;
  }

  if (!Number.isFinite(value)) {
    throw new TypeError("storyline lifecycle counters must be finite numbers");
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeLifecycleDecision(value) {
  return assertOneOf(value, LIFECYCLE_DECISIONS, "storyline.decision");
}

function normalizeMergeDisposition(decision, value) {
  if (decision !== "merge") {
    return null;
  }

  return assertOneOf(value, MERGE_DISPOSITIONS, "storyline.mergeDisposition");
}

function normalizeTimestampOrNull(value) {
  if (value == null) {
    return null;
  }

  return normalizeTimestamp(value, "storyline.timestamp");
}

function calculateElapsedDays(from, to) {
  if (from == null) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / DAY_IN_MS);
}
