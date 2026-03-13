import { CONTENT_CATEGORIES } from "../core/contracts.js";
import { DEFAULT_DISCOVERY_CONFIG } from "./config.js";
import {
  findRetirementBlockedCategories,
  countActiveSourcesByCategory,
} from "./source-coverage.js";
import {
  SOURCE_RETIREMENT_REASONS,
  evaluateSourcePerformanceRetirement,
  recordSourceLowSignalCycle,
} from "./source-lifecycle.js";

const CATEGORY_COVERAGE_STATUSES = Object.freeze({
  blindSpot: "blind_spot",
  fragileCoverage: "fragile_coverage",
  covered: "covered",
});

export function evaluateLowSignalSources({
  sourceMap,
  approvedAtCycleStart,
  observedSourceIds = [],
  now = new Date().toISOString(),
  cycleId,
  config = DEFAULT_DISCOVERY_CONFIG,
} = {}) {
  if (!sourceMap || typeof sourceMap.values !== "function") {
    throw new TypeError(
      "evaluateLowSignalSources requires a sourceMap with a values() method",
    );
  }

  const effectiveCycleId = normalizeCycleId(cycleId, now);
  const approvedSourceIds = normalizeIdSet(approvedAtCycleStart);
  const observedSourceIdSet = normalizeIdSet(observedSourceIds);
  const newlyRetired = [];
  const lowSignalEvaluations = [];
  const sourceEntries = Array.from(sourceMap.values());

  for (const source of sourceEntries) {
    if (
      !isRetirementEvaluationEligible(source, approvedSourceIds) ||
      observedSourceIdSet.has(source.id)
    ) {
      continue;
    }

    const blockedCategories = resolveRetirementGuardedCategories(
      source,
      sourceEntries,
      config,
    );
    const performanceRetirement = evaluateSourcePerformanceRetirement(
      source,
      {
        observedAt: now,
        retirementGuard: {
          blockedCategories,
        },
      },
      config,
    );

    if (performanceRetirement.retired || performanceRetirement.blocked) {
      if (performanceRetirement.retired) {
        newlyRetired.push(source);
      }

      lowSignalEvaluations.push({
        sourceId: source.id,
        retired: performanceRetirement.retired === true,
        blocked: performanceRetirement.blocked === true,
        blockedCategories: performanceRetirement.blockedCategories ?? [],
        lowSignalStreak: source.lifecycle?.lowSignalStreak ?? 0,
        lowSignalCycles: [...(source.lifecycle?.lowSignalCycles ?? [])],
        lifecycleState: source.lifecycle?.state ?? source.status ?? null,
        reason: SOURCE_RETIREMENT_REASONS.poorPerformance,
        consecutiveFetchFailures:
          source.performance?.consecutiveFetchFailures ?? 0,
        failedFetchCount: source.performance?.failedFetchCount ?? 0,
      });
      continue;
    }

    const result = recordSourceLowSignalCycle(
      source,
      {
        cycleId: effectiveCycleId,
        observedAt: now,
        retirementGuard: {
          blockedCategories,
        },
      },
      config,
    );

    if (result.retired) {
      newlyRetired.push(source);
    }

    lowSignalEvaluations.push({
      sourceId: source.id,
      retired: result.retired === true,
      blocked: result.blocked === true,
      blockedCategories: result.blockedCategories ?? [],
      lowSignalStreak: source.lifecycle?.lowSignalStreak ?? 0,
      lowSignalCycles: [...(source.lifecycle?.lowSignalCycles ?? [])],
      lifecycleState: source.lifecycle?.state ?? source.status ?? null,
    });
  }

  return {
    categoryCoverageStatuses: deriveCategoryCoverageStatuses(sourceEntries, config),
    lowSignalEvaluations,
    newlyRetired,
  };
}

function isRetirementEvaluationEligible(source, approvedSourceIds) {
  return (
    source != null &&
    typeof source.id === "string" &&
    approvedSourceIds.has(source.id) &&
    source.seed !== true &&
    source.status === "approved"
  );
}

function normalizeCycleId(cycleId, now) {
  if (typeof cycleId === "string" && cycleId.length > 0) {
    return cycleId;
  }

  if (typeof now === "string" && now.length >= 10) {
    return now.slice(0, 10);
  }

  throw new TypeError("evaluateLowSignalSources requires a cycleId or ISO timestamp");
}

function normalizeIdSet(values) {
  if (values instanceof Set) {
    return values;
  }

  if (Array.isArray(values)) {
    return new Set(values.filter((value) => typeof value === "string" && value.length));
  }

  return new Set();
}

function resolveRetirementGuardedCategories(source, sources, config) {
  return findRetirementBlockedCategories(sources, source, config);
}

function deriveCategoryCoverageStatuses(sources, config) {
  const activeSourcesByCategory = countActiveSourcesByCategory(sources, config);

  return CONTENT_CATEGORIES.map((category) => {
    const activeSourceCount = activeSourcesByCategory.get(category) ?? 0;

    return {
      category,
      activeSourceCount,
      status: resolveCategoryCoverageStatus(activeSourceCount),
    };
  });
}

function resolveCategoryCoverageStatus(activeSourceCount) {
  if (activeSourceCount === 0) {
    return CATEGORY_COVERAGE_STATUSES.blindSpot;
  }

  if (activeSourceCount === 1) {
    return CATEGORY_COVERAGE_STATUSES.fragileCoverage;
  }

  return CATEGORY_COVERAGE_STATUSES.covered;
}
