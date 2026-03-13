import { readFileSync } from "node:fs";

import { assertNonEmptyString, assertOneOf, normalizeTimestamp } from "../core/contracts.js";

export const DEFAULT_SCOPE_REVIEW_CADENCE = "quarterly";
export const DEFAULT_SCOPE_VERSIONING_SCHEME = "semver";
export const SCOPE_REVIEW_CADENCES = Object.freeze([DEFAULT_SCOPE_REVIEW_CADENCE]);
export const SCOPE_VERSIONING_SCHEMES = Object.freeze([DEFAULT_SCOPE_VERSIONING_SCHEME]);
export const SCOPE_CHANGE_TYPES = Object.freeze(["initial", "major", "minor", "patch"]);
export const SCOPE_VERSION_CHANGE_RULES = Object.freeze(["major", "minor", "patch"]);

const SCOPE_DEFINITION_DOCUMENT_PATH = new URL("./scope-definition.document.json", import.meta.url);
const SEMVER_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export const CURRENT_NEWSLETTER_SCOPE_DEFINITION = createNewsletterScopeDefinition(
  loadNewsletterScopeDefinitionDocument(),
);

export function createNewsletterScopeDefinition(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("scope definition must be an object");
  }

  const scopeDefinition = normalizeScopeDefinition(input.scopeDefinition);
  const currentVersion = normalizeScopeVersion(
    input.currentVersion ?? scopeDefinition.version,
    "currentVersion",
  );
  const changelog = normalizeScopeChangelog(input.changelog, currentVersion);

  if (currentVersion !== scopeDefinition.version) {
    throw new TypeError("currentVersion must match scopeDefinition.version");
  }

  const currentChangeEntry = changelog[changelog.length - 1];

  if (currentChangeEntry.version !== currentVersion) {
    throw new TypeError("currentVersion must match the latest changelog entry");
  }

  if (scopeDefinition.effectiveAt !== currentChangeEntry.effectiveAt) {
    throw new TypeError(
      "scopeDefinition.effectiveAt must match the currentVersion changelog effectiveAt",
    );
  }

  return {
    currentVersion,
    scopeDefinition,
    changelog,
  };
}

export function formatNewsletterScopeDefinitionResponse({
  generatedAt,
  scopeDefinition,
} = {}) {
  const normalizedScopeDefinition = createNewsletterScopeDefinition(
    scopeDefinition ?? CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  );

  return {
    generated_at: normalizeTimestamp(generatedAt, "generatedAt"),
    current_version: normalizedScopeDefinition.currentVersion,
    scope_definition: serializeScopeDefinition(normalizedScopeDefinition.scopeDefinition),
    changelog: normalizedScopeDefinition.changelog.map((entry) => serializeScopeChangeEntry(entry)),
  };
}

function normalizeScopeDefinition(scopeDefinition) {
  if (!scopeDefinition || typeof scopeDefinition !== "object" || Array.isArray(scopeDefinition)) {
    throw new TypeError("scopeDefinition must be an object");
  }

  const effectiveAt = normalizeTimestamp(scopeDefinition.effectiveAt, "scopeDefinition.effectiveAt");
  const reviewedAt = normalizeTimestamp(scopeDefinition.reviewedAt, "scopeDefinition.reviewedAt");
  const nextReviewAt = normalizeTimestamp(
    scopeDefinition.nextReviewAt,
    "scopeDefinition.nextReviewAt",
  );

  if (new Date(reviewedAt).getTime() < new Date(effectiveAt).getTime()) {
    throw new TypeError("scopeDefinition.reviewedAt must be at or after effectiveAt");
  }

  if (new Date(nextReviewAt).getTime() <= new Date(reviewedAt).getTime()) {
    throw new TypeError("scopeDefinition.nextReviewAt must be after reviewedAt");
  }

  return {
    version: normalizeScopeVersion(scopeDefinition.version, "scopeDefinition.version"),
    effectiveAt,
    reviewedAt,
    nextReviewAt,
    reviewCadence: assertOneOf(
      assertNonEmptyString(
        scopeDefinition.reviewCadence ?? DEFAULT_SCOPE_REVIEW_CADENCE,
        "scopeDefinition.reviewCadence",
      ),
      SCOPE_REVIEW_CADENCES,
      "scopeDefinition.reviewCadence",
    ),
    audience: normalizeScopeAudience(scopeDefinition.audience),
    definition: assertNonEmptyString(scopeDefinition.definition, "scopeDefinition.definition"),
    inclusionPolicy: normalizeInclusionPolicy(scopeDefinition.inclusionPolicy),
    coverageBoundaries: normalizeCoverageBoundaries(scopeDefinition.coverageBoundaries),
    changeTracking: normalizeChangeTracking(scopeDefinition.changeTracking),
  };
}

function normalizeScopeAudience(audience) {
  if (!audience || typeof audience !== "object" || Array.isArray(audience)) {
    throw new TypeError("scopeDefinition.audience must be an object");
  }

  return {
    primarySubscribers: assertNonEmptyString(
      audience.primarySubscribers,
      "scopeDefinition.audience.primarySubscribers",
    ),
    secondaryOperators: assertNonEmptyString(
      audience.secondaryOperators,
      "scopeDefinition.audience.secondaryOperators",
    ),
  };
}

function normalizeInclusionPolicy(inclusionPolicy) {
  if (
    !inclusionPolicy ||
    typeof inclusionPolicy !== "object" ||
    Array.isArray(inclusionPolicy)
  ) {
    throw new TypeError("scopeDefinition.inclusionPolicy must be an object");
  }

  return {
    qualificationRule: assertNonEmptyString(
      inclusionPolicy.qualificationRule,
      "scopeDefinition.inclusionPolicy.qualificationRule",
    ),
    requiredCapabilities: normalizeStringList(
      inclusionPolicy.requiredCapabilities,
      "scopeDefinition.inclusionPolicy.requiredCapabilities",
    ),
    inclusionExamples: normalizeStringList(
      inclusionPolicy.inclusionExamples,
      "scopeDefinition.inclusionPolicy.inclusionExamples",
    ),
    exclusionExamples: normalizeStringList(
      inclusionPolicy.exclusionExamples,
      "scopeDefinition.inclusionPolicy.exclusionExamples",
    ),
  };
}

function normalizeCoverageBoundaries(boundaries) {
  if (!boundaries || typeof boundaries !== "object" || Array.isArray(boundaries)) {
    throw new TypeError("scopeDefinition.coverageBoundaries must be an object");
  }

  return {
    inScope: normalizeStringList(boundaries.inScope, "scopeDefinition.coverageBoundaries.inScope"),
    outOfScope: normalizeStringList(
      boundaries.outOfScope,
      "scopeDefinition.coverageBoundaries.outOfScope",
    ),
    decisionRule: assertNonEmptyString(
      boundaries.decisionRule,
      "scopeDefinition.coverageBoundaries.decisionRule",
    ),
  };
}

function normalizeChangeTracking(changeTracking) {
  if (!changeTracking || typeof changeTracking !== "object" || Array.isArray(changeTracking)) {
    throw new TypeError("scopeDefinition.changeTracking must be an object");
  }

  return {
    versioningScheme: assertOneOf(
      assertNonEmptyString(
        changeTracking.versioningScheme ?? DEFAULT_SCOPE_VERSIONING_SCHEME,
        "scopeDefinition.changeTracking.versioningScheme",
      ),
      SCOPE_VERSIONING_SCHEMES,
      "scopeDefinition.changeTracking.versioningScheme",
    ),
    updatePolicy: assertNonEmptyString(
      changeTracking.updatePolicy,
      "scopeDefinition.changeTracking.updatePolicy",
    ),
    versionChangeRules: normalizeVersionChangeRules(changeTracking.versionChangeRules),
  };
}

function normalizeVersionChangeRules(versionChangeRules) {
  if (
    !versionChangeRules ||
    typeof versionChangeRules !== "object" ||
    Array.isArray(versionChangeRules)
  ) {
    throw new TypeError("scopeDefinition.changeTracking.versionChangeRules must be an object");
  }

  return Object.fromEntries(
    SCOPE_VERSION_CHANGE_RULES.map((ruleName) => [
      ruleName,
      assertNonEmptyString(
        versionChangeRules[ruleName],
        `scopeDefinition.changeTracking.versionChangeRules.${ruleName}`,
      ),
    ]),
  );
}

function normalizeScopeChangelog(changelog, currentVersion) {
  if (!Array.isArray(changelog) || changelog.length === 0) {
    throw new TypeError("changelog must be a non-empty array");
  }

  const versions = new Set();
  const normalizedEntries = changelog.map((entry, index) => {
    const normalizedEntry = normalizeScopeChangeEntry(entry, index);

    if (versions.has(normalizedEntry.version)) {
      throw new TypeError(`duplicate changelog version detected: ${normalizedEntry.version}`);
    }

    versions.add(normalizedEntry.version);
    return normalizedEntry;
  });

  if (!versions.has(currentVersion)) {
    throw new TypeError("changelog must include an entry for currentVersion");
  }

  validateScopeChangelogSequence(normalizedEntries, currentVersion);

  return normalizedEntries;
}

function validateScopeChangelogSequence(entries, currentVersion) {
  if (entries[0].changeType !== "initial") {
    throw new TypeError("changelog[0].changeType must be initial");
  }

  for (let index = 1; index < entries.length; index += 1) {
    const previousEntry = entries[index - 1];
    const currentEntry = entries[index];

    if (currentEntry.changeType === "initial") {
      throw new TypeError("only changelog[0] may use changeType initial");
    }

    if (
      new Date(currentEntry.effectiveAt).getTime() <
      new Date(previousEntry.effectiveAt).getTime()
    ) {
      throw new TypeError("changelog must be ordered by effectiveAt");
    }

    if (compareSemverVersions(currentEntry.version, previousEntry.version) <= 0) {
      throw new TypeError("changelog versions must increase monotonically");
    }
  }

  if (entries[entries.length - 1].version !== currentVersion) {
    throw new TypeError("currentVersion must match the latest changelog entry");
  }
}

function normalizeScopeChangeEntry(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError(`changelog[${index}] must be an object`);
  }

  const changeType = assertNonEmptyString(entry.changeType, `changelog[${index}].changeType`);

  if (!SCOPE_CHANGE_TYPES.includes(changeType)) {
    throw new TypeError(`changelog[${index}].changeType must be one of ${SCOPE_CHANGE_TYPES.join(", ")}`);
  }

  return {
    version: normalizeScopeVersion(entry.version, `changelog[${index}].version`),
    changeType,
    effectiveAt: normalizeTimestamp(entry.effectiveAt, `changelog[${index}].effectiveAt`),
    summary: assertNonEmptyString(entry.summary, `changelog[${index}].summary`),
    rationale: assertNonEmptyString(entry.rationale, `changelog[${index}].rationale`),
    scopeChanges: normalizeStringList(entry.scopeChanges, `changelog[${index}].scopeChanges`),
  };
}

function normalizeStringList(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty array`);
  }

  return value.map((entry, index) =>
    assertNonEmptyString(entry, `${fieldName}[${index}]`),
  );
}

function normalizeScopeVersion(value, fieldName) {
  const normalizedValue = assertNonEmptyString(value, fieldName);

  if (!SEMVER_VERSION_PATTERN.test(normalizedValue)) {
    throw new TypeError(`${fieldName} must be a semver version`);
  }

  return normalizedValue;
}

function compareSemverVersions(left, right) {
  const leftParts = parseSemverVersion(left);
  const rightParts = parseSemverVersion(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] === rightParts[index]) {
      continue;
    }

    return leftParts[index] > rightParts[index] ? 1 : -1;
  }

  return 0;
}

function parseSemverVersion(version) {
  return version.split(".").map((segment) => Number.parseInt(segment, 10));
}

function serializeScopeDefinition(scopeDefinition) {
  return {
    version: scopeDefinition.version,
    effective_at: scopeDefinition.effectiveAt,
    reviewed_at: scopeDefinition.reviewedAt,
    next_review_at: scopeDefinition.nextReviewAt,
    review_cadence: scopeDefinition.reviewCadence,
    audience: {
      primary_subscribers: scopeDefinition.audience.primarySubscribers,
      secondary_operators: scopeDefinition.audience.secondaryOperators,
    },
    definition: scopeDefinition.definition,
    inclusion_policy: {
      qualification_rule: scopeDefinition.inclusionPolicy.qualificationRule,
      required_capabilities: [...scopeDefinition.inclusionPolicy.requiredCapabilities],
      inclusion_examples: [...scopeDefinition.inclusionPolicy.inclusionExamples],
      exclusion_examples: [...scopeDefinition.inclusionPolicy.exclusionExamples],
    },
    coverage_boundaries: {
      in_scope: [...scopeDefinition.coverageBoundaries.inScope],
      out_of_scope: [...scopeDefinition.coverageBoundaries.outOfScope],
      decision_rule: scopeDefinition.coverageBoundaries.decisionRule,
    },
    change_tracking: {
      versioning_scheme: scopeDefinition.changeTracking.versioningScheme,
      update_policy: scopeDefinition.changeTracking.updatePolicy,
      version_change_rules: {
        ...scopeDefinition.changeTracking.versionChangeRules,
      },
    },
  };
}

function serializeScopeChangeEntry(entry) {
  return {
    version: entry.version,
    change_type: entry.changeType,
    effective_at: entry.effectiveAt,
    summary: entry.summary,
    rationale: entry.rationale,
    scope_changes: [...entry.scopeChanges],
  };
}

function loadNewsletterScopeDefinitionDocument() {
  return JSON.parse(readFileSync(SCOPE_DEFINITION_DOCUMENT_PATH, "utf8"));
}
