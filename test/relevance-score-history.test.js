import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT,
  CURRENT_RELEVANCE_SCORE_VERSION_ENTRY,
  DEFAULT_MIN_RELEVANCE_SCORE,
  DEFAULT_RELEVANCE_SCORING_CONFIG,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  RELEVANCE_SCORE_CHANGE_TYPES,
  createRelevanceScoreHistoryDocument,
} from "../src/index.js";

const RELEVANCE_SCORE_HISTORY_DOCUMENT_URL = new URL(
  "../src/core/relevance-score-history.document.json",
  import.meta.url,
);

test("createRelevanceScoreHistoryDocument returns the versioned scoring formula history", () => {
  const historyDocument = createRelevanceScoreHistoryDocument(
    CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT,
  );

  assert.equal(historyDocument.currentVersion, DEFAULT_RELEVANCE_SCORE_VERSION);
  assert.equal(historyDocument.versioningScheme, "semver");
  assert.equal(historyDocument.history.length > 0, true);
  assert.equal(
    historyDocument.history.some((entry) => entry.version === historyDocument.currentVersion),
    true,
  );
  assert.equal(
    RELEVANCE_SCORE_CHANGE_TYPES.includes(historyDocument.history[0].changeType),
    true,
  );
  assert.equal(historyDocument.history[0].formulaDefinition.formula.length > 0, true);
  assert.equal(historyDocument.history[0].formulaDefinition.weightingPolicy.length > 0, true);
  assert.equal(historyDocument.history[0].formulaDefinition.fields.length > 0, true);
  assert.equal(historyDocument.history[0].formulaDefinition.rules.length > 0, true);
  assert.equal(historyDocument.history[0].formulaDefinition.fields[0].rules.length > 0, true);
});

test("createRelevanceScoreHistoryDocument rejects histories that do not include the current version", () => {
  assert.throws(
    () =>
      createRelevanceScoreHistoryDocument({
        currentVersion: "9.0.0",
        versioningScheme: "semver",
        history: CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT.history,
      }),
    /history must include an entry for currentVersion/,
  );
});

test("createRelevanceScoreHistoryDocument rejects formula fields that drift from config weights", () => {
  const invalidDocument = JSON.parse(JSON.stringify(CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT));

  invalidDocument.history[0].formulaDefinition.fields[0].weight = 0.99;

  assert.throws(
    () => createRelevanceScoreHistoryDocument(invalidDocument),
    /must match config.weights.recency/,
  );
});

test("relevance score history document is the canonical versioned source of truth", async () => {
  const rawDocument = JSON.parse(await readFile(RELEVANCE_SCORE_HISTORY_DOCUMENT_URL, "utf8"));
  const normalizedDocument = createRelevanceScoreHistoryDocument(rawDocument);

  assert.equal(rawDocument.currentVersion, CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT.currentVersion);
  assert.equal(
    rawDocument.history.some((entry) => entry.version === rawDocument.currentVersion),
    true,
  );
  assert.deepEqual(normalizedDocument, CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT);
});

test("current score history entry matches the active relevance scorer configuration", () => {
  const currentEntry = CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT.history.find(
    (entry) => entry.version === CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT.currentVersion,
  );

  assert.equal(currentEntry.version, DEFAULT_RELEVANCE_SCORE_VERSION);
  assert.equal(
    currentEntry.formulaDefinition.minimumPublishedScore,
    DEFAULT_MIN_RELEVANCE_SCORE,
  );
  assert.deepEqual(
    currentEntry.formulaDefinition.config.weights,
    DEFAULT_RELEVANCE_SCORING_CONFIG.weights,
  );
  assert.deepEqual(
    currentEntry.formulaDefinition.config.githubSignalWeights,
    DEFAULT_RELEVANCE_SCORING_CONFIG.githubSignalWeights,
  );
  assert.deepEqual(
    Object.fromEntries(
      currentEntry.formulaDefinition.fields.map((field) => [field.name, field.weight]),
    ),
    DEFAULT_RELEVANCE_SCORING_CONFIG.weights,
  );
  assert.equal(
    currentEntry.formulaDefinition.rules.some((rule) => rule.name === "publication-threshold"),
    true,
  );
  assert.equal(CURRENT_RELEVANCE_SCORE_VERSION_ENTRY.formula, currentEntry.formulaDefinition.formula);
  assert.equal(
    CURRENT_RELEVANCE_SCORE_VERSION_ENTRY.weightingPolicy,
    currentEntry.formulaDefinition.weightingPolicy,
  );
  assert.deepEqual(CURRENT_RELEVANCE_SCORE_VERSION_ENTRY.fields, currentEntry.formulaDefinition.fields);
  assert.deepEqual(CURRENT_RELEVANCE_SCORE_VERSION_ENTRY.rules, currentEntry.formulaDefinition.rules);
});
