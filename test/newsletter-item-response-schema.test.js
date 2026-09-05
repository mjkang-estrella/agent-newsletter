import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTENT_CATEGORIES,
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  DISAGREEMENT_DIMENSIONS,
  NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  NEWSLETTER_ITEM_RESPONSE_SCHEMA,
  NEWSLETTER_ITEM_RESPONSE_SCHEMA_VERSION,
  REQUIRED_NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  RISK_SEVERITIES,
  RISK_WARNING_DIMENSIONS,
  SCORE_INTERPRETATIONS,
  SENTIMENT_SPREADS,
  SUPPLEMENTAL_NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  createNormalizedItem,
  serializeNewsletterItem,
} from "../src/index.js";

test("newsletter item response schema versions the required machine contract", () => {
  assert.equal(NEWSLETTER_ITEM_RESPONSE_SCHEMA.version, NEWSLETTER_ITEM_RESPONSE_SCHEMA_VERSION);
  assert.equal(NEWSLETTER_ITEM_RESPONSE_SCHEMA.versioningScheme, "semver");
  assert.deepEqual(REQUIRED_NEWSLETTER_ITEM_API_RESPONSE_FIELDS, [
    "item_id",
    "name",
    "source_urls",
    "category",
    "summary",
    "integration_hint",
    "relevance_score",
    "score_version",
    "risk_warning",
    "mention_count",
    "sentiment_spread",
    "divergence_flag",
    "first_seen",
    "edition_count",
    "storyline_ids",
    "scope_version",
  ]);
  assert.deepEqual(SUPPLEMENTAL_NEWSLETTER_ITEM_API_RESPONSE_FIELDS, [
    "score_interpretation",
    "evidence",
    "storyline",
  ]);
  assert.deepEqual(Object.keys(NEWSLETTER_ITEM_RESPONSE_SCHEMA.fields), NEWSLETTER_ITEM_API_RESPONSE_FIELDS);
});

test("newsletter item response schema documents stable nested field types", () => {
  assert.deepEqual(NEWSLETTER_ITEM_RESPONSE_SCHEMA.fields.category, {
    type: "enum",
    values: CONTENT_CATEGORIES,
  });
  assert.deepEqual(NEWSLETTER_ITEM_RESPONSE_SCHEMA.fields.score_interpretation, {
    type: "enum",
    values: SCORE_INTERPRETATIONS,
    role: "supplemental_scoring_metadata",
  });
  assert.deepEqual(NEWSLETTER_ITEM_RESPONSE_SCHEMA.fields.source_urls, {
    type: "array",
    items: {
      type: "string",
      format: "uri",
    },
    minItems: 1,
    uniqueItems: true,
  });
  assert.deepEqual(NEWSLETTER_ITEM_RESPONSE_SCHEMA.fields.mention_count, {
    type: "integer",
    minimum: 1,
  });
  assert.deepEqual(NEWSLETTER_ITEM_RESPONSE_SCHEMA.fields.first_seen, {
    type: "string",
    format: "iso8601-utc",
  });
  assert.deepEqual(NEWSLETTER_ITEM_RESPONSE_SCHEMA.fields.risk_warning.requiredFields, RISK_WARNING_DIMENSIONS);
  for (const dimension of RISK_WARNING_DIMENSIONS) {
    assert.deepEqual(NEWSLETTER_ITEM_RESPONSE_SCHEMA.fields.risk_warning.properties[dimension], {
      type: "object",
      requiredFields: ["severity", "description"],
      properties: {
        severity: {
          type: "enum",
          values: RISK_SEVERITIES,
        },
        description: {
          type: "string",
        },
      },
    });
  }
  assert.deepEqual(NEWSLETTER_ITEM_RESPONSE_SCHEMA.fields.sentiment_spread, {
    type: "object",
    requiredFields: ["classification"],
    properties: {
      classification: {
        type: "enum",
        values: SENTIMENT_SPREADS,
      },
      disagreement_dimension: {
        type: "enum",
        values: DISAGREEMENT_DIMENSIONS,
        requiredWhen: {
          classification: ["disagree", "mixed"],
        },
      },
    },
  });
});

test("serializeNewsletterItem stays aligned with the shared response schema", () => {
  const payload = serializeNewsletterItem(
    createNormalizedItem({
      itemId: "artifact-acme-autonomy-runtime",
      name: "Acme Autonomy Runtime",
      sourceUrl: "https://github.com/acme/autonomy-runtime",
      sourceUrls: [
        "https://blog.example.com/acme-autonomy-runtime",
        "https://github.com/acme/autonomy-runtime",
      ],
      category: "library",
      summary: "Runtime for long-lived autonomous agents with structured tool use.",
      integrationHint: "Install the package and validate tool permissions before rollout.",
      relevanceScore: 82,
      riskWarning: {
        severity: "medium",
        description: "Review tool sandboxing before autonomous execution.",
      },
      mentionCount: 2,
      sourceKinds: ["github", "web"],
      adapterIds: ["github", "web-discovery"],
      sourceAuthorityScore: 93,
      discoveredAt: "2026-03-12T20:15:00.000Z",
      firstSeen: "2026-03-11T20:15:00.000Z",
      editionCount: 2,
      storylineIds: ["storyline-autonomy-runtime-rollout"],
      scopeVersion: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
      sentimentSpread: {
        classification: "mixed",
        disagreementDimension: "utility",
      },
    }),
  );

  assert.deepEqual(Object.keys(payload), NEWSLETTER_ITEM_API_RESPONSE_FIELDS);
  assert.deepEqual(
    REQUIRED_NEWSLETTER_ITEM_API_RESPONSE_FIELDS.filter((fieldName) => !(fieldName in payload)),
    [],
  );
  assert.deepEqual(payload.storyline_ids, ["storyline-autonomy-runtime-rollout"]);
});

test("serializeNewsletterItem preserves typed risk warning dimensions in the shared contract", () => {
  const payload = serializeNewsletterItem(
    createNormalizedItem({
      itemId: "artifact-acme-sandboxed-runtime",
      name: "Acme Sandboxed Runtime",
      sourceUrl: "https://github.com/acme/sandboxed-runtime",
      category: "library",
      summary: "Runtime for autonomous agents with separate security and rollout concerns.",
      integrationHint: "Enable it behind a feature flag and validate each tool policy first.",
      relevanceScore: 76,
      scoreVersion: "2.2.0",
      riskWarning: {
        security: {
          severity: "high",
          description: "Sandbox outbound network and credential access before live runs.",
        },
        maturity: {
          severity: "medium",
          description: "The release train is still volatile across minor versions.",
        },
        adoption_complexity: {
          severity: "low",
          description: "The integration path is documented and easy to stage incrementally.",
        },
      },
      mentionCount: 2,
      sourceKinds: ["github"],
      adapterIds: ["github"],
      sourceAuthorityScore: 94,
      discoveredAt: "2026-03-12T20:15:00.000Z",
      firstSeen: "2026-03-12T20:15:00.000Z",
      editionCount: 1,
      storylineIds: [],
      scopeVersion: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
      sentimentSpread: "agree",
    }),
  );

  assert.deepEqual(payload.risk_warning, {
    security: {
      severity: "high",
      description: "Sandbox outbound network and credential access before live runs.",
    },
    maturity: {
      severity: "medium",
      description: "The release train is still volatile across minor versions.",
    },
    adoption_complexity: {
      severity: "low",
      description: "The integration path is documented and easy to stage incrementally.",
    },
  });
});
