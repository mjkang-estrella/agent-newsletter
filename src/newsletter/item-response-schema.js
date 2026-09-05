import {
  CONTENT_CATEGORIES,
  DISAGREEMENT_DIMENSIONS,
  RISK_SEVERITIES,
  RISK_WARNING_DIMENSIONS,
  SCORE_INTERPRETATIONS,
  SENTIMENT_SPREADS,
} from "../core/contracts.js";

export const NEWSLETTER_ITEM_RESPONSE_SCHEMA_VERSION = "1.2.0";

export const REQUIRED_NEWSLETTER_ITEM_API_RESPONSE_FIELDS = Object.freeze([
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

export const SUPPLEMENTAL_NEWSLETTER_ITEM_API_RESPONSE_FIELDS = Object.freeze([
  "score_interpretation",
  "evidence",
  "storyline",
]);

export const NEWSLETTER_ITEM_API_RESPONSE_FIELDS = Object.freeze([
  "evidence",
  "item_id",
  "name",
  "source_urls",
  "category",
  "summary",
  "integration_hint",
  "relevance_score",
  "score_version",
  "score_interpretation",
  "divergence_flag",
  "risk_warning",
  "mention_count",
  "sentiment_spread",
  "first_seen",
  "edition_count",
  "storyline_ids",
  "storyline",
  "scope_version",
]);

export const NEWSLETTER_ITEM_RESPONSE_SCHEMA = deepFreeze({
  name: "newsletter_item",
  version: NEWSLETTER_ITEM_RESPONSE_SCHEMA_VERSION,
  versioningScheme: "semver",
  requiredFields: REQUIRED_NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  supplementalFields: SUPPLEMENTAL_NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  fields: {
    evidence: { type: "object", requiredFields: ["source_published_at", "collected_at", "novelty_reason", "uncertainty"] },
    item_id: {
      type: "string",
    },
    name: {
      type: "string",
    },
    source_urls: {
      type: "array",
      items: {
        type: "string",
        format: "uri",
      },
      minItems: 1,
      uniqueItems: true,
    },
    category: {
      type: "enum",
      values: CONTENT_CATEGORIES,
    },
    summary: {
      type: "string",
    },
    integration_hint: {
      type: "string",
    },
    relevance_score: {
      type: "number",
      minimum: 0,
      maximum: 100,
    },
    score_version: {
      type: "string",
    },
    score_interpretation: {
      type: "enum",
      values: SCORE_INTERPRETATIONS,
      role: "supplemental_scoring_metadata",
    },
    divergence_flag: {
      type: "boolean",
    },
    risk_warning: {
      type: "object",
      requiredFields: RISK_WARNING_DIMENSIONS,
      properties: Object.fromEntries(
        RISK_WARNING_DIMENSIONS.map((dimension) => [
          dimension,
          {
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
          },
        ]),
      ),
    },
    mention_count: {
      type: "integer",
      minimum: 1,
    },
    sentiment_spread: {
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
    },
    first_seen: {
      type: "string",
      format: "iso8601-utc",
    },
    edition_count: {
      type: "integer",
      minimum: 1,
    },
    storyline_ids: {
      type: "array",
      items: {
        type: "string",
      },
      uniqueItems: true,
    },
    storyline: {
      type: "object",
      nullable: true,
      role: "supplemental_storyline_state",
      requiredFields: [
        "member_item_ids",
        "position",
        "related_item_ids",
        "relationship",
        "status",
        "storyline_id",
        "title",
      ],
      properties: {
        storyline_id: {
          type: "string",
        },
        title: {
          type: "string",
        },
        status: {
          type: "enum",
          values: ["developing", "stable", "archived"],
        },
        position: {
          type: "integer",
          minimum: 1,
        },
        member_item_ids: {
          type: "array",
          items: {
            type: "string",
          },
          minItems: 1,
          uniqueItems: true,
        },
        related_item_ids: {
          type: "array",
          items: {
            type: "string",
          },
          uniqueItems: true,
        },
        parent_storyline_ids: {
          type: "array",
          items: {
            type: "string",
          },
          uniqueItems: true,
        },
        narrative_type: {
          type: "object",
          requiredFields: ["key"],
          properties: {
            key: {
              type: "string",
            },
            label: {
              type: "string",
            },
            metadata: {
              type: "object",
            },
          },
        },
        relationship: {
          type: "object",
          nullable: true,
          requiredFields: [
            "decision",
            "explanation",
            "previous_appearance",
            "prior_appearance_count",
            "signals",
          ],
          properties: {
            decision: {
              type: "string",
            },
            explanation: {
              type: "string",
            },
            prior_appearance_count: {
              type: "integer",
              minimum: 0,
            },
            previous_appearance: {
              type: "object",
              nullable: true,
              properties: {
                edition_id: {
                  type: "string",
                },
                published_at: {
                  type: "string",
                  format: "iso8601-utc",
                },
                source_url: {
                  type: "string",
                  format: "uri",
                },
              },
            },
            signals: {
              type: "object",
              requiredFields: [
                "fact_overlap_ratio",
                "new_source_cluster_count",
                "novel_fact_count",
                "novel_token_ratio",
              ],
              properties: {
                fact_overlap_ratio: {
                  type: "number",
                },
                novel_fact_count: {
                  type: "integer",
                  minimum: 0,
                },
                novel_token_ratio: {
                  type: "number",
                },
                new_source_cluster_count: {
                  type: "integer",
                  minimum: 0,
                },
              },
            },
          },
        },
      },
    },
    scope_version: {
      type: "string",
    },
  },
});

function deepFreeze(value) {
  if (
    value == null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.freeze(value);

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return value;
}
