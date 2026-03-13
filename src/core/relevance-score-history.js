import { readFileSync } from "node:fs";

import { assertNonEmptyString, normalizeTimestamp } from "./contracts.js";

export const RELEVANCE_SCORE_CHANGE_TYPES = Object.freeze([
  "initial",
  "major",
  "minor",
  "patch",
]);

const RELEVANCE_SCORE_HISTORY_DOCUMENT_PATH = new URL(
  "./relevance-score-history.document.json",
  import.meta.url,
);

export const CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT =
  createRelevanceScoreHistoryDocument(loadRelevanceScoreHistoryDocument());

export function createRelevanceScoreHistoryDocument(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("relevance score history document must be an object");
  }

  const currentVersion = assertNonEmptyString(input.currentVersion, "currentVersion");
  const versioningScheme = assertNonEmptyString(
    input.versioningScheme ?? "semver",
    "versioningScheme",
  );
  const history = normalizeRelevanceScoreHistoryEntries(input.history, currentVersion);

  return {
    currentVersion,
    versioningScheme,
    history,
  };
}

function loadRelevanceScoreHistoryDocument() {
  return JSON.parse(readFileSync(RELEVANCE_SCORE_HISTORY_DOCUMENT_PATH, "utf8"));
}

function normalizeRelevanceScoreHistoryEntries(history, currentVersion) {
  if (!Array.isArray(history) || history.length === 0) {
    throw new TypeError("history must be a non-empty array");
  }

  const versions = new Set();
  const normalizedEntries = history.map((entry, index) => {
    const normalizedEntry = normalizeRelevanceScoreHistoryEntry(entry, index);

    if (versions.has(normalizedEntry.version)) {
      throw new TypeError(`duplicate history version detected: ${normalizedEntry.version}`);
    }

    versions.add(normalizedEntry.version);
    return normalizedEntry;
  });

  if (!versions.has(currentVersion)) {
    throw new TypeError("history must include an entry for currentVersion");
  }

  return normalizedEntries;
}

function normalizeRelevanceScoreHistoryEntry(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError(`history[${index}] must be an object`);
  }

  const changeType = assertNonEmptyString(entry.changeType, `history[${index}].changeType`);

  if (!RELEVANCE_SCORE_CHANGE_TYPES.includes(changeType)) {
    throw new TypeError(
      `history[${index}].changeType must be one of ${RELEVANCE_SCORE_CHANGE_TYPES.join(", ")}`,
    );
  }

  return {
    version: assertNonEmptyString(entry.version, `history[${index}].version`),
    changeType,
    effectiveAt: normalizeTimestamp(entry.effectiveAt, `history[${index}].effectiveAt`),
    summary: assertNonEmptyString(entry.summary, `history[${index}].summary`),
    rationale: assertNonEmptyString(entry.rationale, `history[${index}].rationale`),
    formulaDefinition: normalizeFormulaDefinition(
      entry.formulaDefinition,
      `history[${index}].formulaDefinition`,
    ),
  };
}

function normalizeFormulaDefinition(formulaDefinition, fieldName) {
  if (
    !formulaDefinition ||
    typeof formulaDefinition !== "object" ||
    Array.isArray(formulaDefinition)
  ) {
    throw new TypeError(`${fieldName} must be an object`);
  }

  const config = normalizeFormulaConfig(formulaDefinition.config, `${fieldName}.config`);
  const fields = normalizeFormulaFields(
    formulaDefinition.fields,
    config,
    `${fieldName}.fields`,
  );
  const rules = normalizeFormulaRules(formulaDefinition.rules, `${fieldName}.rules`);

  return {
    formula: assertNonEmptyString(formulaDefinition.formula, `${fieldName}.formula`),
    weightingPolicy: assertNonEmptyString(
      formulaDefinition.weightingPolicy,
      `${fieldName}.weightingPolicy`,
    ),
    minimumPublishedScore: normalizeMinimumPublishedScore(
      formulaDefinition.minimumPublishedScore,
      `${fieldName}.minimumPublishedScore`,
    ),
    fields,
    rules,
    config,
  };
}

function normalizeMinimumPublishedScore(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${fieldName} must be a finite number`);
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeFormulaConfig(config, fieldName) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError(`${fieldName} must be an object`);
  }

  return {
    ...config,
    scoreRange: cloneOptionalObject(config.scoreRange),
    githubSignalWeights: cloneOptionalObject(config.githubSignalWeights),
    weights: cloneOptionalObject(config.weights),
  };
}

function normalizeFormulaFields(fields, config, fieldName) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty array`);
  }

  const names = new Set();
  const normalizedFields = fields.map((field, index) => {
    const normalizedField = normalizeFormulaField(field, `${fieldName}[${index}]`);

    if (names.has(normalizedField.name)) {
      throw new TypeError(`${fieldName} contains duplicate field name ${normalizedField.name}`);
    }

    names.add(normalizedField.name);
    return normalizedField;
  });

  assertFieldWeightsMatchConfig(normalizedFields, config, fieldName);

  return normalizedFields;
}

function normalizeFormulaField(field, fieldName) {
  if (!field || typeof field !== "object" || Array.isArray(field)) {
    throw new TypeError(`${fieldName} must be an object`);
  }

  return {
    name: assertNonEmptyString(field.name, `${fieldName}.name`),
    weight: normalizeNonNegativeFiniteNumber(field.weight, `${fieldName}.weight`),
    description: assertNonEmptyString(field.description, `${fieldName}.description`),
    rules: normalizeStringList(field.rules, `${fieldName}.rules`),
  };
}

function assertFieldWeightsMatchConfig(fields, config, fieldName) {
  const configWeights = config.weights;

  if (!configWeights || typeof configWeights !== "object" || Array.isArray(configWeights)) {
    throw new TypeError(`${fieldName} requires config.weights to be an object`);
  }

  const documentedWeights = new Map(fields.map((field) => [field.name, field.weight]));

  for (const [weightName, weightValue] of Object.entries(configWeights)) {
    if (!documentedWeights.has(weightName)) {
      throw new TypeError(`${fieldName} must include a field entry for ${weightName}`);
    }

    if (documentedWeights.get(weightName) !== weightValue) {
      throw new TypeError(
        `${fieldName} weight for ${weightName} must match config.weights.${weightName}`,
      );
    }
  }
}

function normalizeFormulaRules(rules, fieldName) {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty array`);
  }

  const names = new Set();

  return rules.map((rule, index) => {
    const normalizedRule = normalizeFormulaRule(rule, `${fieldName}[${index}]`);

    if (names.has(normalizedRule.name)) {
      throw new TypeError(`${fieldName} contains duplicate rule name ${normalizedRule.name}`);
    }

    names.add(normalizedRule.name);
    return normalizedRule;
  });
}

function normalizeFormulaRule(rule, fieldName) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw new TypeError(`${fieldName} must be an object`);
  }

  return {
    name: assertNonEmptyString(rule.name, `${fieldName}.name`),
    description: assertNonEmptyString(rule.description, `${fieldName}.description`),
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

function normalizeNonNegativeFiniteNumber(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative finite number`);
  }

  return value;
}

function cloneOptionalObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  return { ...value };
}
