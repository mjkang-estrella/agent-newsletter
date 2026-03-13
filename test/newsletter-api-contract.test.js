import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTENT_CATEGORIES,
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  EXCLUSION_PHASES,
  EXCLUSION_REASONS,
  DISAGREEMENT_DIMENSIONS,
  NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  RISK_WARNING_DIMENSIONS,
  RISK_SEVERITIES,
  SCORE_INTERPRETATIONS,
  SCOPE_CHANGE_TYPES,
  SENTIMENT_SPREADS,
  SOURCE_COVERAGE_STATUSES,
  createNewsletterApiHandler,
} from "../src/index.js";

function buildEdition(day, itemName) {
  return {
    id: `2026-03-${String(day).padStart(2, "0")}`,
    publishedAt: `2026-03-${String(day).padStart(2, "0")}T21:00:00Z`,
    window: {
      startsAt: `2026-03-${String(day - 1).padStart(2, "0")}T21:00:00Z`,
      endsAt: `2026-03-${String(day).padStart(2, "0")}T21:00:00Z`,
      timezone: "UTC",
    },
    items: [
      {
        itemId: `artifact-${itemName.toLowerCase().replace(/\s+/g, "-")}`,
        name: itemName,
        sourceUrl: `https://example.com/${itemName.toLowerCase().replace(/\s+/g, "-")}`,
        sourceUrls: [
          `https://example.com/${itemName.toLowerCase().replace(/\s+/g, "-")}`,
          `https://mirror.example.com/${itemName.toLowerCase().replace(/\s+/g, "-")}`,
        ],
        category: "tool",
        summary: `${itemName} helps agents ship integrations faster.`,
        integrationHint: `Review ${itemName} installation docs before rollout.`,
        relevanceScore: 84,
        riskWarning: {
          severity: "medium",
          description: "Validate production readiness before enabling autonomous actions.",
        },
        mentionCount: 2,
        sourceKinds: ["github", "reddit"],
        adapterIds: ["github", "reddit"],
        sourceAuthorityScore: 91,
        discoveredAt: `2026-03-${String(day).padStart(2, "0")}T20:30:00Z`,
        firstSeen: `2026-03-${String(Math.max(1, day - 2)).padStart(2, "0")}T20:30:00Z`,
        editionCount: 3,
        sentimentSpread:
          day % 2 === 0
            ? "agree"
            : {
                classification: "mixed",
                disagreementDimension: "utility",
              },
      },
    ],
  };
}

function createHandler({
  getLatestPublishedEdition = async () => null,
  listPublishedEditions = async () => [],
  listReferenceItems = async () => [],
  getItemLifecycle = async () => null,
  listActiveStorylines = async () => [],
  queryExclusionAnalytics = async () => ({
    archiveWindowDays: 7,
    generatedAt: "2026-03-11T21:30:00.000Z",
    filters: {
      publishedFrom: "2026-03-04T21:30:00.000Z",
      publishedTo: "2026-03-11T21:30:00.000Z",
      reason: null,
      category: null,
      sourceKind: null,
      adapterId: null,
      itemId: null,
      phase: null,
      minRecurringEditions: 2,
    },
    totals: {
      scannedEditionCount: 0,
      matchedEditionCount: 0,
      exclusionCount: 0,
      distinctItemCount: 0,
      recurringItemCount: 0,
      blindSpotCount: 0,
    },
    exclusions: [],
    aggregations: {
      reasons: [],
      categories: [],
      phases: [],
      sourceKinds: [],
      adapterIds: [],
      categoryReasonCodes: [],
      editions: [],
    },
    recurringItems: [],
    blindSpots: [],
  }),
  queryExclusionSummary = async () => ({
    archiveWindowDays: 7,
    generatedAt: "2026-03-11T21:30:00.000Z",
    filters: {
      publishedFrom: "2026-03-04T21:30:00.000Z",
      publishedTo: "2026-03-11T21:30:00.000Z",
      reason: null,
      category: null,
      sourceKind: null,
      adapterId: null,
      itemId: null,
      phase: null,
    },
    totals: {
      scannedEditionCount: 0,
      matchedEditionCount: 0,
      distinctItemCount: 0,
      totalExcludedItems: 0,
      exclusionGroupCount: 0,
    },
    exclusionSummary: {
      totalExcludedItems: 0,
      countsByCategoryAndReason: [],
    },
  }),
  sourceRepository = {
    config: {
      minimumActiveCategorySources: 2,
    },
    async load() {
      return {
        sources: [],
      };
    },
  },
  now = () => "2026-03-11T21:30:00Z",
} = {}) {
  return createNewsletterApiHandler({
    editionRepository: {
      getLatestPublishedEdition,
      listPublishedEditions,
      listReferenceItems,
      getItemLifecycle,
      listActiveStorylines,
      queryExclusionAnalytics,
      queryExclusionSummary,
    },
    sourceRepository,
    now,
    rateLimit: false,
  });
}

function assertIsoUtcTimestamp(value) {
  assert.equal(typeof value, "string");
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
}

function assertNewsletterItemSchema(item) {
  assert.deepEqual(Object.keys(item).sort(), [...NEWSLETTER_ITEM_API_RESPONSE_FIELDS].sort());
  assert.equal(typeof item.item_id, "string");
  assert.ok(item.item_id.length > 0);
  assert.equal(typeof item.name, "string");
  assert.ok(item.name.length > 0);
  assert.ok(Array.isArray(item.source_urls));
  assert.ok(item.source_urls.length > 0);
  for (const sourceUrl of item.source_urls) {
    assert.equal(typeof sourceUrl, "string");
    assert.ok(new URL(sourceUrl));
  }
  assert.ok(CONTENT_CATEGORIES.includes(item.category));
  assert.equal(typeof item.summary, "string");
  assert.ok(item.summary.length > 0);
  assert.equal(typeof item.integration_hint, "string");
  assert.ok(item.integration_hint.length > 0);
  assert.equal(typeof item.relevance_score, "number");
  assert.ok(item.relevance_score >= 0 && item.relevance_score <= 100);
  assert.equal(item.score_version, DEFAULT_RELEVANCE_SCORE_VERSION);
  assert.ok(SCORE_INTERPRETATIONS.includes(item.score_interpretation));
  assert.equal(typeof item.divergence_flag, "boolean");
  assert.equal(typeof item.mention_count, "number");
  assert.ok(Number.isInteger(item.mention_count));
  assert.ok(item.mention_count >= 1);
  assertSentimentSpreadSchema(item.sentiment_spread);
  assertIsoUtcTimestamp(item.first_seen);
  assert.equal(typeof item.edition_count, "number");
  assert.ok(Number.isInteger(item.edition_count));
  assert.ok(item.edition_count >= 1);
  assert.ok(Array.isArray(item.storyline_ids));
  assert.deepEqual(item.storyline_ids, [...new Set(item.storyline_ids)]);
  for (const storylineId of item.storyline_ids) {
    assert.equal(typeof storylineId, "string");
    assert.ok(storylineId.length > 0);
  }
  assertStorylineAppearanceSchema(item.storyline);
  assert.equal(typeof item.scope_version, "string");
  assert.ok(item.scope_version.length > 0);
  assert.equal(item.scope_version, CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion);

  assert.deepEqual(Object.keys(item.risk_warning).sort(), [...RISK_WARNING_DIMENSIONS].sort());
  for (const dimension of RISK_WARNING_DIMENSIONS) {
    assert.deepEqual(Object.keys(item.risk_warning[dimension]).sort(), ["description", "severity"]);
    assert.ok(RISK_SEVERITIES.includes(item.risk_warning[dimension].severity));
    assert.equal(typeof item.risk_warning[dimension].description, "string");
    assert.ok(item.risk_warning[dimension].description.length > 0);
  }
}

function assertSentimentSpreadSchema(sentimentSpread) {
  assert.equal(typeof sentimentSpread, "object");
  assert.ok(sentimentSpread);
  assert.ok(SENTIMENT_SPREADS.includes(sentimentSpread.classification));

  if (sentimentSpread.classification === "agree") {
    assert.deepEqual(Object.keys(sentimentSpread).sort(), ["classification"]);
    return;
  }

  assert.deepEqual(Object.keys(sentimentSpread).sort(), [
    "classification",
    "disagreement_dimension",
  ]);
  assert.ok(DISAGREEMENT_DIMENSIONS.includes(sentimentSpread.disagreement_dimension));
}

function assertNewsletterEditionSchema(edition) {
  assert.deepEqual(Object.keys(edition).sort(), [
    "content_window",
    "edition_id",
    "item_count",
    "items",
    "published_at",
    "storyline_count",
    "storylines",
  ]);
  assert.equal(typeof edition.edition_id, "string");
  assert.ok(edition.edition_id.length > 0);
  assertIsoUtcTimestamp(edition.published_at);
  assert.deepEqual(Object.keys(edition.content_window).sort(), [
    "ends_at",
    "starts_at",
    "timezone",
  ]);
  assertIsoUtcTimestamp(edition.content_window.starts_at);
  assertIsoUtcTimestamp(edition.content_window.ends_at);
  assert.equal(typeof edition.content_window.timezone, "string");
  assert.ok(edition.content_window.timezone.length > 0);
  assert.equal(typeof edition.item_count, "number");
  assert.ok(Number.isInteger(edition.item_count));
  assert.ok(Array.isArray(edition.items));
  assert.equal(edition.item_count, edition.items.length);
  assert.equal(typeof edition.storyline_count, "number");
  assert.ok(Number.isInteger(edition.storyline_count));
  assert.ok(Array.isArray(edition.storylines));
  assert.equal(edition.storyline_count, edition.storylines.length);

  for (const item of edition.items) {
    assertNewsletterItemSchema(item);
  }

  for (const storyline of edition.storylines) {
    assertNewsletterStorylineSchema(storyline);
  }
}

function assertNewsletterItemLifecycleSchema(lifecycle) {
  assert.deepEqual(Object.keys(lifecycle).sort(), [
    "appearances",
    "edition_count",
    "first_appearance",
    "first_seen",
    "item_id",
    "repeat_appearances",
    "score_evolution",
    "storyline",
    "storyline_membership",
  ]);
  assert.equal(typeof lifecycle.item_id, "string");
  assert.ok(lifecycle.item_id.length > 0);
  assertIsoUtcTimestamp(lifecycle.first_seen);
  assert.equal(typeof lifecycle.edition_count, "number");
  assert.ok(Number.isInteger(lifecycle.edition_count));
  assert.ok(lifecycle.edition_count >= 1);
  assertStorylineSummarySchema(lifecycle.storyline);
  assertLifecycleOccurrenceSummarySchema(lifecycle.first_appearance, 1);
  assert.ok(Array.isArray(lifecycle.repeat_appearances));
  assert.equal(lifecycle.repeat_appearances.length, Math.max(0, lifecycle.edition_count - 1));
  lifecycle.repeat_appearances.forEach((appearance, index) => {
    assertLifecycleOccurrenceSummarySchema(appearance, index + 2);
  });
  assert.ok(Array.isArray(lifecycle.score_evolution));
  assert.equal(lifecycle.score_evolution.length, lifecycle.edition_count);
  lifecycle.score_evolution.forEach((entry, index) => {
    assertLifecycleScoreEvolutionEntrySchema(entry, {
      expectNullDeltaFromPrevious: index === 0,
    });
  });
  assert.ok(Array.isArray(lifecycle.storyline_membership));
  assert.equal(lifecycle.storyline_membership.length, lifecycle.edition_count);
  lifecycle.storyline_membership.forEach((membership) => {
    assertLifecycleStorylineMembershipEntrySchema(membership);
  });
  assert.ok(Array.isArray(lifecycle.appearances));
  assert.ok(lifecycle.appearances.length >= 1);

  for (const appearance of lifecycle.appearances) {
    assert.deepEqual(Object.keys(appearance).sort(), [
      "content_window",
      "edition_id",
      "item",
      "published_at",
      "storyline",
    ]);
    assert.equal(typeof appearance.edition_id, "string");
    assert.ok(appearance.edition_id.length > 0);
    assertIsoUtcTimestamp(appearance.published_at);
    assert.deepEqual(Object.keys(appearance.content_window).sort(), [
      "ends_at",
      "starts_at",
      "timezone",
    ]);
    assertIsoUtcTimestamp(appearance.content_window.starts_at);
    assertIsoUtcTimestamp(appearance.content_window.ends_at);
    assert.equal(typeof appearance.content_window.timezone, "string");
    assert.ok(appearance.content_window.timezone.length > 0);
    assertNewsletterItemSchema(appearance.item);
    assertStorylineAppearanceSchema(appearance.storyline);
  }
}

function assertLifecycleOccurrenceSummarySchema(appearance, expectedAppearanceNumber) {
  assert.deepEqual(Object.keys(appearance).sort(), [
    "appearance_number",
    "divergence_flag",
    "edition_id",
    "published_at",
    "relevance_score",
    "score_version",
    "storyline_ids",
  ]);
  assert.equal(typeof appearance.edition_id, "string");
  assert.ok(appearance.edition_id.length > 0);
  assertIsoUtcTimestamp(appearance.published_at);
  assert.equal(typeof appearance.appearance_number, "number");
  assert.ok(Number.isInteger(appearance.appearance_number));
  assert.ok(appearance.appearance_number >= 1);
  if (expectedAppearanceNumber != null) {
    assert.equal(appearance.appearance_number, expectedAppearanceNumber);
  }
  assert.equal(typeof appearance.relevance_score, "number");
  assert.ok(appearance.relevance_score >= 0 && appearance.relevance_score <= 100);
  assert.equal(typeof appearance.score_version, "string");
  assert.ok(appearance.score_version.length > 0);
  assert.equal(typeof appearance.divergence_flag, "boolean");
  assert.ok(Array.isArray(appearance.storyline_ids));
  assert.deepEqual(appearance.storyline_ids, [...new Set(appearance.storyline_ids)]);
}

function assertLifecycleScoreEvolutionEntrySchema(
  entry,
  { expectNullDeltaFromPrevious = false } = {},
) {
  assert.deepEqual(Object.keys(entry).sort(), [
    "delta_from_first_appearance",
    "delta_from_previous",
    "divergence_flag",
    "edition_id",
    "published_at",
    "relevance_score",
    "score_version",
  ]);
  assert.equal(typeof entry.edition_id, "string");
  assert.ok(entry.edition_id.length > 0);
  assertIsoUtcTimestamp(entry.published_at);
  assert.equal(typeof entry.relevance_score, "number");
  assert.ok(entry.relevance_score >= 0 && entry.relevance_score <= 100);
  assert.equal(typeof entry.score_version, "string");
  assert.ok(entry.score_version.length > 0);
  assert.equal(typeof entry.divergence_flag, "boolean");
  if (expectNullDeltaFromPrevious) {
    assert.equal(entry.delta_from_previous, null);
  } else {
    assert.equal(typeof entry.delta_from_previous, "number");
  }
  assert.equal(typeof entry.delta_from_first_appearance, "number");
}

function assertLifecycleStorylineMembershipEntrySchema(entry) {
  assert.deepEqual(Object.keys(entry).sort(), [
    "edition_id",
    "position",
    "primary_storyline_id",
    "primary_storyline_status",
    "primary_storyline_title",
    "published_at",
    "relationship_decision",
    "storyline_ids",
  ]);
  assert.equal(typeof entry.edition_id, "string");
  assert.ok(entry.edition_id.length > 0);
  assertIsoUtcTimestamp(entry.published_at);
  assert.ok(Array.isArray(entry.storyline_ids));
  assert.deepEqual(entry.storyline_ids, [...new Set(entry.storyline_ids)]);
  if (entry.primary_storyline_id != null) {
    assert.equal(typeof entry.primary_storyline_id, "string");
    assert.ok(entry.primary_storyline_id.length > 0);
  }
  if (entry.primary_storyline_title != null) {
    assert.equal(typeof entry.primary_storyline_title, "string");
    assert.ok(entry.primary_storyline_title.length > 0);
  }
  if (entry.primary_storyline_status != null) {
    assert.equal(typeof entry.primary_storyline_status, "string");
    assert.ok(entry.primary_storyline_status.length > 0);
  }
  if (entry.position != null) {
    assert.equal(typeof entry.position, "number");
    assert.ok(Number.isInteger(entry.position));
    assert.ok(entry.position >= 1);
  }
  if (entry.relationship_decision != null) {
    assert.equal(typeof entry.relationship_decision, "string");
    assert.ok(entry.relationship_decision.length > 0);
  }
}

function assertNewsletterStorylineSchema(storyline) {
  const requiredFields = [
    "evolution_count",
    "first_seen",
    "item_count",
    "items",
    "last_evolution_at",
    "last_seen",
    "member_item_ids",
    "relationship_metadata",
    "repetition_count",
    "repetition_streak",
    "status",
    "storyline_id",
    "title",
    "updated_at",
  ];
  const allowedFields = [
    ...requiredFields,
    "child_storyline_ids",
    "merged_into_storyline_id",
    "merged_storyline_ids",
    "narrative_type",
    "parent_storyline_ids",
  ].sort();
  const actualFields = Object.keys(storyline).sort();

  for (const field of requiredFields) {
    assert.ok(actualFields.includes(field), `missing storyline field: ${field}`);
  }

  for (const field of actualFields) {
    assert.ok(allowedFields.includes(field), `unexpected storyline field: ${field}`);
  }
  assert.equal(typeof storyline.storyline_id, "string");
  assert.ok(storyline.storyline_id.length > 0);
  assert.equal(typeof storyline.title, "string");
  assert.ok(storyline.title.length > 0);
  assert.equal(typeof storyline.status, "string");
  assert.ok(["developing", "stable", "archived"].includes(storyline.status));
  assert.ok(Array.isArray(storyline.member_item_ids));
  assert.ok(storyline.member_item_ids.length >= 1);
  assertIsoUtcTimestamp(storyline.first_seen);
  assertIsoUtcTimestamp(storyline.last_seen);
  assertIsoUtcTimestamp(storyline.updated_at);
  assertIsoUtcTimestamp(storyline.last_evolution_at);
  assert.equal(typeof storyline.evolution_count, "number");
  assert.ok(Number.isInteger(storyline.evolution_count));
  assert.ok(storyline.evolution_count >= 0);
  assert.equal(typeof storyline.repetition_count, "number");
  assert.ok(Number.isInteger(storyline.repetition_count));
  assert.ok(storyline.repetition_count >= 0);
  assert.equal(typeof storyline.repetition_streak, "number");
  assert.ok(Number.isInteger(storyline.repetition_streak));
  assert.ok(storyline.repetition_streak >= 0);
  assert.equal(typeof storyline.item_count, "number");
  assert.ok(Number.isInteger(storyline.item_count));
  assert.ok(storyline.item_count >= 1);
  assert.ok(Array.isArray(storyline.items));
  assert.equal(storyline.item_count, storyline.items.length);
  assert.deepEqual(storyline.member_item_ids, [...new Set(storyline.member_item_ids)]);
  assert.deepEqual(Object.keys(storyline.relationship_metadata).sort(), ["fork", "merge"]);
  assert.deepEqual(Object.keys(storyline.relationship_metadata.fork).sort(), [
    "child_storyline_ids",
    "parent_storyline_ids",
  ]);
  assert.ok(Array.isArray(storyline.relationship_metadata.fork.parent_storyline_ids));
  assert.deepEqual(
    storyline.relationship_metadata.fork.parent_storyline_ids,
    [...new Set(storyline.relationship_metadata.fork.parent_storyline_ids)],
  );
  assert.ok(Array.isArray(storyline.relationship_metadata.fork.child_storyline_ids));
  assert.deepEqual(
    storyline.relationship_metadata.fork.child_storyline_ids,
    [...new Set(storyline.relationship_metadata.fork.child_storyline_ids)],
  );
  assert.deepEqual(Object.keys(storyline.relationship_metadata.merge).sort(), [
    "source_storyline_ids",
    "target_storyline_id",
  ]);
  assert.ok(Array.isArray(storyline.relationship_metadata.merge.source_storyline_ids));
  assert.deepEqual(
    storyline.relationship_metadata.merge.source_storyline_ids,
    [...new Set(storyline.relationship_metadata.merge.source_storyline_ids)],
  );
  if (storyline.relationship_metadata.merge.target_storyline_id != null) {
    assert.equal(typeof storyline.relationship_metadata.merge.target_storyline_id, "string");
    assert.ok(storyline.relationship_metadata.merge.target_storyline_id.length > 0);
  }

  if ("parent_storyline_ids" in storyline) {
    assert.ok(Array.isArray(storyline.parent_storyline_ids));
    assert.deepEqual(storyline.parent_storyline_ids, [...new Set(storyline.parent_storyline_ids)]);
  }

  if ("child_storyline_ids" in storyline) {
    assert.ok(Array.isArray(storyline.child_storyline_ids));
    assert.deepEqual(storyline.child_storyline_ids, [...new Set(storyline.child_storyline_ids)]);
  }

  if ("merged_storyline_ids" in storyline) {
    assert.ok(Array.isArray(storyline.merged_storyline_ids));
    assert.deepEqual(storyline.merged_storyline_ids, [...new Set(storyline.merged_storyline_ids)]);
  }

  if ("merged_into_storyline_id" in storyline) {
    assert.equal(typeof storyline.merged_into_storyline_id, "string");
    assert.ok(storyline.merged_into_storyline_id.length > 0);
  }

  if ("narrative_type" in storyline) {
    assertNarrativeTypeSchema(storyline.narrative_type);
  }

  for (const item of storyline.items) {
    assertNewsletterItemSchema(item);
  }
}

function assertNewsletterScopeDefinitionSchema(responseBody) {
  assert.deepEqual(Object.keys(responseBody).sort(), [
    "changelog",
    "current_version",
    "generated_at",
    "scope_definition",
  ]);
  assertIsoUtcTimestamp(responseBody.generated_at);
  assert.equal(typeof responseBody.current_version, "string");
  assert.ok(responseBody.current_version.length > 0);
  assert.deepEqual(Object.keys(responseBody.scope_definition).sort(), [
    "audience",
    "change_tracking",
    "coverage_boundaries",
    "definition",
    "effective_at",
    "inclusion_policy",
    "next_review_at",
    "review_cadence",
    "reviewed_at",
    "version",
  ]);
  assert.equal(responseBody.scope_definition.version, responseBody.current_version);
  assertIsoUtcTimestamp(responseBody.scope_definition.effective_at);
  assertIsoUtcTimestamp(responseBody.scope_definition.reviewed_at);
  assertIsoUtcTimestamp(responseBody.scope_definition.next_review_at);
  assert.equal(responseBody.scope_definition.review_cadence, "quarterly");
  assert.deepEqual(Object.keys(responseBody.scope_definition.audience).sort(), [
    "primary_subscribers",
    "secondary_operators",
  ]);
  assert.deepEqual(Object.keys(responseBody.scope_definition.inclusion_policy).sort(), [
    "exclusion_examples",
    "inclusion_examples",
    "qualification_rule",
    "required_capabilities",
  ]);
  assert.equal(typeof responseBody.scope_definition.inclusion_policy.qualification_rule, "string");
  assert.ok(responseBody.scope_definition.inclusion_policy.qualification_rule.length > 0);
  assert.ok(Array.isArray(responseBody.scope_definition.inclusion_policy.required_capabilities));
  assert.ok(responseBody.scope_definition.inclusion_policy.required_capabilities.length > 0);
  assert.ok(Array.isArray(responseBody.scope_definition.inclusion_policy.inclusion_examples));
  assert.ok(responseBody.scope_definition.inclusion_policy.inclusion_examples.length > 0);
  assert.ok(Array.isArray(responseBody.scope_definition.inclusion_policy.exclusion_examples));
  assert.ok(responseBody.scope_definition.inclusion_policy.exclusion_examples.length > 0);
  assert.deepEqual(Object.keys(responseBody.scope_definition.coverage_boundaries).sort(), [
    "decision_rule",
    "in_scope",
    "out_of_scope",
  ]);
  assert.ok(Array.isArray(responseBody.scope_definition.coverage_boundaries.in_scope));
  assert.ok(responseBody.scope_definition.coverage_boundaries.in_scope.length > 0);
  assert.ok(Array.isArray(responseBody.scope_definition.coverage_boundaries.out_of_scope));
  assert.ok(responseBody.scope_definition.coverage_boundaries.out_of_scope.length > 0);
  assert.deepEqual(Object.keys(responseBody.scope_definition.change_tracking).sort(), [
    "update_policy",
    "version_change_rules",
    "versioning_scheme",
  ]);
  assert.deepEqual(
    Object.keys(responseBody.scope_definition.change_tracking.version_change_rules).sort(),
    ["major", "minor", "patch"],
  );
  assert.ok(Array.isArray(responseBody.changelog));
  assert.ok(responseBody.changelog.length > 0);

  for (const entry of responseBody.changelog) {
    assert.deepEqual(Object.keys(entry).sort(), [
      "change_type",
      "effective_at",
      "rationale",
      "scope_changes",
      "summary",
      "version",
    ]);
    assert.equal(typeof entry.version, "string");
    assert.ok(entry.version.length > 0);
    assert.ok(SCOPE_CHANGE_TYPES.includes(entry.change_type));
    assertIsoUtcTimestamp(entry.effective_at);
    assert.equal(typeof entry.summary, "string");
    assert.ok(entry.summary.length > 0);
    assert.equal(typeof entry.rationale, "string");
    assert.ok(entry.rationale.length > 0);
    assert.ok(Array.isArray(entry.scope_changes));
    assert.ok(entry.scope_changes.length > 0);
  }
}

function assertNewsletterExclusionSummarySchema(responseBody) {
  assert.deepEqual(Object.keys(responseBody).sort(), [
    "archive_window_days",
    "exclusion_summary",
    "filters",
    "generated_at",
    "totals",
  ]);
  assert.equal(typeof responseBody.archive_window_days, "number");
  assert.ok(Number.isInteger(responseBody.archive_window_days));
  assert.ok(responseBody.archive_window_days >= 1);
  assertIsoUtcTimestamp(responseBody.generated_at);
  assert.deepEqual(Object.keys(responseBody.filters).sort(), [
    "adapter_id",
    "category",
    "item_id",
    "phase",
    "published_from",
    "published_to",
    "reason",
    "source_kind",
  ]);
  if (responseBody.filters.published_from != null) {
    assertIsoUtcTimestamp(responseBody.filters.published_from);
  }
  if (responseBody.filters.published_to != null) {
    assertIsoUtcTimestamp(responseBody.filters.published_to);
  }
  assert.deepEqual(Object.keys(responseBody.totals).sort(), [
    "distinct_item_count",
    "exclusion_group_count",
    "matched_edition_count",
    "scanned_edition_count",
    "total_excluded_items",
  ]);
  for (const value of Object.values(responseBody.totals)) {
    assert.equal(typeof value, "number");
    assert.ok(Number.isInteger(value));
    assert.ok(value >= 0);
  }
  assert.deepEqual(Object.keys(responseBody.exclusion_summary).sort(), [
    "counts_by_category",
    "counts_by_category_and_reason",
    "counts_by_reason_code",
    "total_excluded_items",
  ]);
  assert.equal(
    responseBody.exclusion_summary.total_excluded_items,
    responseBody.totals.total_excluded_items,
  );
  assert.ok(Array.isArray(responseBody.exclusion_summary.counts_by_category));
  assert.ok(Array.isArray(responseBody.exclusion_summary.counts_by_reason_code));
  assert.equal(
    responseBody.exclusion_summary.counts_by_category_and_reason.length,
    responseBody.totals.exclusion_group_count,
  );

  for (const group of responseBody.exclusion_summary.counts_by_category) {
    assert.deepEqual(Object.keys(group).sort(), ["category", "count"]);
    assert.ok(CONTENT_CATEGORIES.includes(group.category));
    assert.equal(typeof group.count, "number");
    assert.ok(Number.isInteger(group.count));
    assert.ok(group.count >= 1);
  }

  for (const group of responseBody.exclusion_summary.counts_by_reason_code) {
    assert.deepEqual(Object.keys(group).sort(), ["count", "reason_code"]);
    assert.equal(typeof group.reason_code, "string");
    assert.ok(group.reason_code.length > 0);
    assert.equal(typeof group.count, "number");
    assert.ok(Number.isInteger(group.count));
    assert.ok(group.count >= 1);
  }

  for (const group of responseBody.exclusion_summary.counts_by_category_and_reason) {
    assert.deepEqual(Object.keys(group).sort(), ["category", "count", "reason_code"]);
    assert.ok(CONTENT_CATEGORIES.includes(group.category));
    assert.equal(typeof group.reason_code, "string");
    assert.ok(group.reason_code.length > 0);
    assert.equal(typeof group.count, "number");
    assert.ok(Number.isInteger(group.count));
    assert.ok(group.count >= 1);
  }
}

function assertNewsletterExclusionAnalyticsSchema(responseBody) {
  assert.deepEqual(Object.keys(responseBody).sort(), [
    "aggregations",
    "archive_window_days",
    "blind_spots",
    "exclusions",
    "filters",
    "generated_at",
    "recurring_items",
    "totals",
  ]);
  assert.equal(typeof responseBody.archive_window_days, "number");
  assert.ok(Number.isInteger(responseBody.archive_window_days));
  assert.ok(responseBody.archive_window_days >= 1);
  assertIsoUtcTimestamp(responseBody.generated_at);
  assert.deepEqual(Object.keys(responseBody.filters).sort(), [
    "adapter_id",
    "category",
    "item_id",
    "min_recurring_editions",
    "phase",
    "published_from",
    "published_to",
    "reason_code",
    "source_kind",
  ]);
  if (responseBody.filters.published_from != null) {
    assertIsoUtcTimestamp(responseBody.filters.published_from);
  }
  if (responseBody.filters.published_to != null) {
    assertIsoUtcTimestamp(responseBody.filters.published_to);
  }
  if (responseBody.filters.reason_code != null) {
    assert.ok(EXCLUSION_REASONS.includes(responseBody.filters.reason_code));
  }
  if (responseBody.filters.category != null) {
    assert.ok(CONTENT_CATEGORIES.includes(responseBody.filters.category));
  }
  if (responseBody.filters.phase != null) {
    assert.ok(EXCLUSION_PHASES.includes(responseBody.filters.phase));
  }
  assert.equal(typeof responseBody.filters.min_recurring_editions, "number");
  assert.ok(Number.isInteger(responseBody.filters.min_recurring_editions));
  assert.ok(responseBody.filters.min_recurring_editions >= 1);
  assert.deepEqual(Object.keys(responseBody.totals).sort(), [
    "blind_spot_count",
    "distinct_item_count",
    "exclusion_count",
    "matched_edition_count",
    "recurring_item_count",
    "scanned_edition_count",
  ]);
  for (const value of Object.values(responseBody.totals)) {
    assert.equal(typeof value, "number");
    assert.ok(Number.isInteger(value));
    assert.ok(value >= 0);
  }
  assert.deepEqual(Object.keys(responseBody.aggregations).sort(), [
    "adapter_ids",
    "categories",
    "category_reason_codes",
    "editions",
    "phases",
    "reason_codes",
    "source_kinds",
  ]);
  assert.ok(Array.isArray(responseBody.exclusions));
  assert.ok(Array.isArray(responseBody.aggregations.reason_codes));
  assert.ok(Array.isArray(responseBody.aggregations.categories));
  assert.ok(Array.isArray(responseBody.aggregations.phases));
  assert.ok(Array.isArray(responseBody.aggregations.source_kinds));
  assert.ok(Array.isArray(responseBody.aggregations.adapter_ids));
  assert.ok(Array.isArray(responseBody.aggregations.category_reason_codes));
  assert.ok(Array.isArray(responseBody.aggregations.editions));
  assert.ok(Array.isArray(responseBody.recurring_items));
  assert.ok(Array.isArray(responseBody.blind_spots));
  assert.equal(
    responseBody.aggregations.category_reason_codes.length >= responseBody.blind_spots.length,
    true,
  );

  for (const exclusion of responseBody.exclusions) {
    assert.deepEqual(Object.keys(exclusion).sort(), [
      "adapter_ids",
      "category",
      "edition_id",
      "item_id",
      "min_relevance_score",
      "min_source_authority_score",
      "name",
      "phase",
      "published_at",
      "reason_code",
      "relevance_score",
      "score_version",
      "source_authority_score",
      "source_kinds",
      "source_lifecycle_state",
      "source_status",
      "source_url",
    ]);
    assert.equal(typeof exclusion.edition_id, "string");
    assert.ok(exclusion.edition_id.length > 0);
    assertIsoUtcTimestamp(exclusion.published_at);
    assert.equal(typeof exclusion.item_id, "string");
    assert.ok(exclusion.item_id.length > 0);
    assert.equal(typeof exclusion.name, "string");
    assert.ok(exclusion.name.length > 0);
    assert.ok(CONTENT_CATEGORIES.includes(exclusion.category));
    assert.ok(EXCLUSION_REASONS.includes(exclusion.reason_code));
    assert.ok(EXCLUSION_PHASES.includes(exclusion.phase));
    assert.ok(Array.isArray(exclusion.source_kinds));
    assert.ok(Array.isArray(exclusion.adapter_ids));
    assert.equal(typeof exclusion.source_url, "string");
    assert.ok(new URL(exclusion.source_url));
    if (exclusion.relevance_score != null) {
      assert.equal(typeof exclusion.relevance_score, "number");
    }
    if (exclusion.min_relevance_score != null) {
      assert.equal(typeof exclusion.min_relevance_score, "number");
    }
    if (exclusion.score_version != null) {
      assert.equal(typeof exclusion.score_version, "string");
      assert.ok(exclusion.score_version.length > 0);
    }
    if (exclusion.source_authority_score != null) {
      assert.equal(typeof exclusion.source_authority_score, "number");
    }
    if (exclusion.min_source_authority_score != null) {
      assert.equal(typeof exclusion.min_source_authority_score, "number");
    }
    if (exclusion.source_status != null) {
      assert.equal(typeof exclusion.source_status, "string");
    }
    if (exclusion.source_lifecycle_state != null) {
      assert.equal(typeof exclusion.source_lifecycle_state, "string");
    }
  }

  for (const group of responseBody.aggregations.reason_codes) {
    assert.deepEqual(Object.keys(group).sort(), [
      "distinct_item_count",
      "edition_count",
      "exclusion_count",
      "reason_code",
    ]);
    assert.ok(EXCLUSION_REASONS.includes(group.reason_code));
  }

  for (const group of responseBody.aggregations.categories) {
    assert.deepEqual(Object.keys(group).sort(), [
      "category",
      "distinct_item_count",
      "edition_count",
      "exclusion_count",
    ]);
    assert.ok(CONTENT_CATEGORIES.includes(group.category));
  }

  for (const group of responseBody.aggregations.phases) {
    assert.deepEqual(Object.keys(group).sort(), [
      "distinct_item_count",
      "edition_count",
      "exclusion_count",
      "phase",
    ]);
    assert.ok(EXCLUSION_PHASES.includes(group.phase));
  }

  for (const group of responseBody.aggregations.source_kinds) {
    assert.deepEqual(Object.keys(group).sort(), [
      "distinct_item_count",
      "edition_count",
      "exclusion_count",
      "source_kind",
    ]);
    assert.equal(typeof group.source_kind, "string");
    assert.ok(group.source_kind.length > 0);
  }

  for (const group of responseBody.aggregations.adapter_ids) {
    assert.deepEqual(Object.keys(group).sort(), [
      "adapter_id",
      "distinct_item_count",
      "edition_count",
      "exclusion_count",
    ]);
    assert.equal(typeof group.adapter_id, "string");
    assert.ok(group.adapter_id.length > 0);
  }

  for (const group of responseBody.aggregations.category_reason_codes) {
    assert.deepEqual(Object.keys(group).sort(), [
      "category",
      "distinct_item_count",
      "edition_count",
      "exclusion_count",
      "first_excluded_at",
      "last_excluded_at",
      "reason_code",
    ]);
    assert.ok(CONTENT_CATEGORIES.includes(group.category));
    assert.ok(EXCLUSION_REASONS.includes(group.reason_code));
    assertIsoUtcTimestamp(group.first_excluded_at);
    assertIsoUtcTimestamp(group.last_excluded_at);
  }

  for (const group of responseBody.aggregations.editions) {
    assert.deepEqual(Object.keys(group).sort(), [
      "distinct_item_count",
      "edition_id",
      "exclusion_count",
      "published_at",
    ]);
    assert.equal(typeof group.edition_id, "string");
    assert.ok(group.edition_id.length > 0);
    assertIsoUtcTimestamp(group.published_at);
  }

  for (const item of responseBody.recurring_items) {
    assert.deepEqual(Object.keys(item).sort(), [
      "category",
      "edition_count",
      "exclusion_count",
      "first_excluded_at",
      "item_id",
      "last_excluded_at",
      "name",
      "reason_codes",
    ]);
    assert.ok(CONTENT_CATEGORIES.includes(item.category));
    assert.ok(Array.isArray(item.reason_codes));
    item.reason_codes.forEach((reasonCode) => {
      assert.ok(EXCLUSION_REASONS.includes(reasonCode));
    });
    assertIsoUtcTimestamp(item.first_excluded_at);
    assertIsoUtcTimestamp(item.last_excluded_at);
  }

  for (const blindSpot of responseBody.blind_spots) {
    assert.deepEqual(Object.keys(blindSpot).sort(), [
      "blind_spot_key",
      "category",
      "distinct_item_count",
      "edition_count",
      "exclusion_count",
      "first_excluded_at",
      "last_excluded_at",
      "reason_code",
    ]);
    assert.equal(typeof blindSpot.blind_spot_key, "string");
    assert.ok(blindSpot.blind_spot_key.length > 0);
    assert.ok(CONTENT_CATEGORIES.includes(blindSpot.category));
    assert.ok(EXCLUSION_REASONS.includes(blindSpot.reason_code));
    assertIsoUtcTimestamp(blindSpot.first_excluded_at);
    assertIsoUtcTimestamp(blindSpot.last_excluded_at);
  }
}

function assertNewsletterCoverageMapSchema(responseBody) {
  assert.deepEqual(Object.keys(responseBody).sort(), [
    "generated_at",
    "minimum_active_source_count",
    "topic_count",
    "topics",
  ]);
  assertIsoUtcTimestamp(responseBody.generated_at);
  assert.equal(typeof responseBody.minimum_active_source_count, "number");
  assert.ok(Number.isInteger(responseBody.minimum_active_source_count));
  assert.ok(responseBody.minimum_active_source_count >= 1);
  assert.equal(typeof responseBody.topic_count, "number");
  assert.ok(Number.isInteger(responseBody.topic_count));
  assert.equal(responseBody.topic_count, CONTENT_CATEGORIES.length);
  assert.ok(Array.isArray(responseBody.topics));
  assert.equal(responseBody.topics.length, responseBody.topic_count);
  assert.deepEqual(
    responseBody.topics.map((topic) => topic.topic_area),
    CONTENT_CATEGORIES,
  );

  for (const topic of responseBody.topics) {
    assert.deepEqual(Object.keys(topic).sort(), [
      "active_source_count",
      "coverage_status",
      "topic_area",
    ]);
    assert.ok(CONTENT_CATEGORIES.includes(topic.topic_area));
    assert.equal(typeof topic.active_source_count, "number");
    assert.ok(Number.isInteger(topic.active_source_count));
    assert.ok(topic.active_source_count >= 0);
    assert.ok(
      Object.values(SOURCE_COVERAGE_STATUSES).includes(topic.coverage_status),
    );
  }
}

function assertStorylineSummarySchema(storyline) {
  if (storyline == null) {
    return;
  }

  const requiredFields = [
    "evolution_count",
    "first_seen",
    "last_evolution_at",
    "last_seen",
    "member_item_ids",
    "related_item_ids",
    "repetition_count",
    "repetition_streak",
    "status",
    "storyline_id",
    "title",
    "updated_at",
  ];
  const allowedFields = [...requiredFields, "narrative_type", "parent_storyline_ids"].sort();
  const actualFields = Object.keys(storyline).sort();

  for (const field of requiredFields) {
    assert.ok(actualFields.includes(field), `missing storyline summary field: ${field}`);
  }

  for (const field of actualFields) {
    assert.ok(allowedFields.includes(field), `unexpected storyline summary field: ${field}`);
  }
  assert.equal(typeof storyline.storyline_id, "string");
  assert.ok(storyline.storyline_id.length > 0);
  assert.equal(typeof storyline.title, "string");
  assert.ok(storyline.title.length > 0);
  assert.equal(typeof storyline.status, "string");
  assert.ok(storyline.status.length > 0);
  assert.ok(Array.isArray(storyline.member_item_ids));
  assert.ok(Array.isArray(storyline.related_item_ids));
  if ("parent_storyline_ids" in storyline) {
    assert.ok(Array.isArray(storyline.parent_storyline_ids));
  }
  if ("narrative_type" in storyline) {
    assertNarrativeTypeSchema(storyline.narrative_type);
  }
  assertIsoUtcTimestamp(storyline.first_seen);
  assertIsoUtcTimestamp(storyline.last_seen);
  assertIsoUtcTimestamp(storyline.updated_at);
  assertIsoUtcTimestamp(storyline.last_evolution_at);
}

function assertStorylineAppearanceSchema(storyline) {
  if (storyline == null) {
    return;
  }

  const requiredFields = [
    "member_item_ids",
    "position",
    "related_item_ids",
    "relationship",
    "status",
    "storyline_id",
    "title",
  ];
  const allowedFields = [...requiredFields, "narrative_type", "parent_storyline_ids"].sort();
  const actualFields = Object.keys(storyline).sort();

  for (const field of requiredFields) {
    assert.ok(actualFields.includes(field), `missing storyline appearance field: ${field}`);
  }

  for (const field of actualFields) {
    assert.ok(allowedFields.includes(field), `unexpected storyline appearance field: ${field}`);
  }
  assert.equal(typeof storyline.storyline_id, "string");
  assert.ok(storyline.storyline_id.length > 0);
  assert.equal(typeof storyline.position, "number");
  assert.ok(Number.isInteger(storyline.position));
  assert.ok(storyline.position >= 1);
  assert.ok(Array.isArray(storyline.member_item_ids));
  assert.ok(Array.isArray(storyline.related_item_ids));
  if ("parent_storyline_ids" in storyline) {
    assert.ok(Array.isArray(storyline.parent_storyline_ids));
  }
  if ("narrative_type" in storyline) {
    assertNarrativeTypeSchema(storyline.narrative_type);
  }
  assertStorylineRelationshipSchema(storyline.relationship);
}

function assertNarrativeTypeSchema(narrativeType) {
  assert.equal(typeof narrativeType, "object");
  assert.ok(narrativeType);
  assert.equal(Array.isArray(narrativeType), false);
  assert.equal(typeof narrativeType.key, "string");
  assert.ok(narrativeType.key.length > 0);

  if ("label" in narrativeType) {
    assert.equal(typeof narrativeType.label, "string");
    assert.ok(narrativeType.label.length > 0);
  }

  if ("metadata" in narrativeType) {
    assert.equal(typeof narrativeType.metadata, "object");
    assert.ok(narrativeType.metadata);
    assert.equal(Array.isArray(narrativeType.metadata), false);
  }
}

function assertStorylineRelationshipSchema(relationship) {
  if (relationship == null) {
    return;
  }

  assert.deepEqual(Object.keys(relationship).sort(), [
    "decision",
    "explanation",
    "previous_appearance",
    "prior_appearance_count",
    "signals",
  ]);
  assert.equal(typeof relationship.decision, "string");
  assert.ok(relationship.decision.length > 0);
  assert.equal(typeof relationship.explanation, "string");
  assert.ok(relationship.explanation.length > 0);
  assert.equal(typeof relationship.prior_appearance_count, "number");
  assert.ok(Number.isInteger(relationship.prior_appearance_count));
  assert.ok(relationship.prior_appearance_count >= 0);
  assert.deepEqual(Object.keys(relationship.signals).sort(), [
    "fact_overlap_ratio",
    "new_source_cluster_count",
    "novel_fact_count",
    "novel_token_ratio",
  ]);
}

function assertErrorSchema(response, body, { status, error, message }) {
  assert.equal(response.status, status);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(Object.keys(body).sort(), ["error", "message"]);
  assert.equal(body.error, error);
  assert.equal(body.message, message);
}

function assertRateLimitErrorSchema(response, body, { retryAfterSeconds }) {
  assert.equal(response.status, 429);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.headers["retry-after"], String(retryAfterSeconds));
  assert.deepEqual(Object.keys(body).sort(), ["error", "message", "retry_after_seconds"]);
  assert.equal(body.error, "rate_limited");
  assert.equal(body.message, "Too many requests from this IP. Try again later.");
  assert.equal(body.retry_after_seconds, retryAfterSeconds);
}

test("GET /api/newsletter/latest returns JSON matching the newsletter edition schema", async () => {
  const edition = buildEdition(11, "Archive Day Seven");
  const handler = createHandler({
    getLatestPublishedEdition: async () => edition,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/latest",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assertNewsletterEditionSchema(body);
});

test("GET /api/newsletter/history returns JSON matching the archive response schema", async () => {
  const editions = [buildEdition(11, "Archive Day Seven"), buildEdition(10, "Archive Day Six")];
  const handler = createHandler({
    listPublishedEditions: async () => editions,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/history",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(Object.keys(body).sort(), [
    "archive_window_days",
    "editions",
    "generated_at",
  ]);
  assert.equal(body.archive_window_days, 7);
  assertIsoUtcTimestamp(body.generated_at);
  assert.ok(Array.isArray(body.editions));
  assert.equal(body.editions.length, editions.length);

  for (const edition of body.editions) {
    assertNewsletterEditionSchema(edition);
  }
});

test("GET /api/newsletter/storylines returns JSON matching the active storyline schema", async () => {
  const item = buildEdition(11, "Agent Runtime Cloud").items[0];
  item.storylineId = "storyline-agent-runtime";
  const handler = createHandler({
    listActiveStorylines: async () => [
      {
        storylineId: "storyline-agent-runtime",
        title: "Agent Runtime expands into managed hosting",
        status: "stable",
        firstSeen: "2026-03-10T20:30:00.000Z",
        lastSeen: "2026-03-11T20:30:00.000Z",
        updatedAt: "2026-03-11T21:00:00.000Z",
        lastEvolutionAt: "2026-03-11T21:00:00.000Z",
        evolutionCount: 2,
        repetitionCount: 0,
        repetitionStreak: 0,
        items: [item],
      },
    ],
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/storylines",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(Object.keys(body).sort(), [
    "generated_at",
    "storyline_count",
    "storylines",
  ]);
  assertIsoUtcTimestamp(body.generated_at);
  assert.equal(body.storyline_count, 1);
  assert.ok(Array.isArray(body.storylines));
  assert.equal(body.storylines.length, 1);
  assertNewsletterStorylineSchema(body.storylines[0]);
});

test("GET /api/newsletter/exclusions returns JSON matching the exclusion summary schema", async () => {
  const handler = createHandler({
    queryExclusionSummary: async () => ({
      archiveWindowDays: 7,
      generatedAt: "2026-03-11T21:30:00.000Z",
      filters: {
        publishedFrom: "2026-03-04T21:30:00.000Z",
        publishedTo: "2026-03-11T21:30:00.000Z",
        reason: "relevance_below_threshold",
        category: "library",
        sourceKind: null,
        adapterId: null,
        itemId: null,
        phase: null,
      },
      totals: {
        scannedEditionCount: 2,
        matchedEditionCount: 2,
        distinctItemCount: 2,
        totalExcludedItems: 3,
        exclusionGroupCount: 1,
      },
      exclusionSummary: {
        totalExcludedItems: 3,
        countsByCategoryAndReason: [
          {
            category: "library",
            reasonCode: "relevance_below_threshold",
            count: 3,
          },
        ],
      },
    }),
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/exclusions?category=library&reason=relevance_below_threshold",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assertNewsletterExclusionSummarySchema(body);
});

test("GET /api/newsletter/exclusions/analytics returns JSON matching the exclusion analytics schema", async () => {
  const handler = createHandler({
    queryExclusionAnalytics: async () => ({
      archiveWindowDays: 7,
      generatedAt: "2026-03-11T21:30:00.000Z",
      filters: {
        publishedFrom: "2026-03-04T21:30:00.000Z",
        publishedTo: "2026-03-11T21:30:00.000Z",
        reason: "relevance_below_threshold",
        category: "library",
        sourceKind: "github",
        adapterId: "github",
        itemId: null,
        phase: "scoring",
        minRecurringEditions: 2,
      },
      totals: {
        scannedEditionCount: 2,
        matchedEditionCount: 2,
        exclusionCount: 3,
        distinctItemCount: 2,
        recurringItemCount: 1,
        blindSpotCount: 1,
      },
      exclusions: [
        {
          editionId: "2026-03-11",
          publishedAt: "2026-03-11T21:00:00.000Z",
          itemId: "artifact-github-com-acme-agent-runtime-lite",
          name: "Agent Runtime Lite",
          sourceUrl: "https://github.com/acme/agent-runtime-lite",
          category: "library",
          sourceKinds: ["github"],
          adapterIds: ["github"],
          reason: "relevance_below_threshold",
          phase: "scoring",
          relevanceScore: 55,
          minRelevanceScore: 60,
          scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
          sourceAuthorityScore: 92,
          minSourceAuthorityScore: null,
          sourceStatus: null,
          sourceLifecycleState: null,
        },
      ],
      aggregations: {
        reasons: [
          {
            reason: "relevance_below_threshold",
            exclusionCount: 3,
            distinctItemCount: 2,
            editionCount: 2,
          },
        ],
        categories: [
          {
            category: "library",
            exclusionCount: 3,
            distinctItemCount: 2,
            editionCount: 2,
          },
        ],
        phases: [
          {
            phase: "scoring",
            exclusionCount: 3,
            distinctItemCount: 2,
            editionCount: 2,
          },
        ],
        sourceKinds: [
          {
            source_kind: "github",
            exclusionCount: 3,
            distinctItemCount: 2,
            editionCount: 2,
          },
        ],
        adapterIds: [
          {
            adapter_id: "github",
            exclusionCount: 3,
            distinctItemCount: 2,
            editionCount: 2,
          },
        ],
        categoryReasonCodes: [
          {
            category: "library",
            reasonCode: "relevance_below_threshold",
            exclusionCount: 3,
            distinctItemCount: 2,
            editionCount: 2,
            firstExcludedAt: "2026-03-10T21:00:00.000Z",
            lastExcludedAt: "2026-03-11T21:00:00.000Z",
          },
        ],
        editions: [
          {
            editionId: "2026-03-11",
            publishedAt: "2026-03-11T21:00:00.000Z",
            exclusionCount: 2,
            distinctItemCount: 2,
          },
        ],
      },
      recurringItems: [
        {
          itemId: "artifact-github-com-acme-agent-runtime-lite",
          name: "Agent Runtime Lite",
          category: "library",
          exclusionCount: 2,
          editionCount: 2,
          reasons: ["relevance_below_threshold"],
          firstExcludedAt: "2026-03-10T21:00:00.000Z",
          lastExcludedAt: "2026-03-11T21:00:00.000Z",
        },
      ],
      blindSpots: [
        {
          blindSpotKey: "category:library|reason:relevance_below_threshold",
          category: "library",
          reason: "relevance_below_threshold",
          exclusionCount: 3,
          distinctItemCount: 2,
          editionCount: 2,
          firstExcludedAt: "2026-03-10T21:00:00.000Z",
          lastExcludedAt: "2026-03-11T21:00:00.000Z",
        },
      ],
    }),
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/exclusions/analytics?category=library&reason_code=relevance_below_threshold",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assertNewsletterExclusionAnalyticsSchema(body);
});

test("GET /api/newsletter/scope returns JSON matching the scope definition schema", async () => {
  const handler = createHandler();

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/scope",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assertNewsletterScopeDefinitionSchema(body);
});

test("GET /api/newsletter/coverage-map returns JSON matching the source coverage schema", async () => {
  const handler = createHandler({
    sourceRepository: {
      config: {
        minimumActiveCategorySources: 2,
      },
      async load() {
        return {
          sources: [
            {
              id: "web:domain:tool-api.example.com",
              status: "approved",
              seed: false,
              lifecycle: {
                state: "active",
                stage: "active",
              },
              evidence: {
                categoryCoverage: ["tool", "api"],
              },
            },
            {
              id: "web:domain:tool.example.com",
              status: "approved",
              seed: false,
              lifecycle: {
                state: "active",
                stage: "active",
              },
              evidence: {
                categoryCoverage: ["tool"],
              },
            },
            {
              id: "web:domain:probation-library.example.com",
              status: "approved",
              seed: false,
              lifecycle: {
                state: "probation",
                stage: "probation",
              },
              evidence: {
                categoryCoverage: ["library"],
              },
            },
          ],
        };
      },
    },
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/coverage-map",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assertNewsletterCoverageMapSchema(body);
  assert.deepEqual(body.topics, [
    {
      topic_area: "tool",
      active_source_count: 2,
      coverage_status: "covered",
    },
    {
      topic_area: "api",
      active_source_count: 1,
      coverage_status: "underrepresented",
    },
    {
      topic_area: "library",
      active_source_count: 0,
      coverage_status: "uncovered",
    },
    {
      topic_area: "technique",
      active_source_count: 0,
      coverage_status: "uncovered",
    },
  ]);
});

test("GET /api/newsletter/reference returns JSON matching the shared item schema", async () => {
  const items = [buildEdition(4, "Persistent Agent Toolkit").items[0]];
  const handler = createHandler({
    listReferenceItems: async () => items,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/reference",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(Object.keys(body).sort(), [
    "archive_window_days",
    "generated_at",
    "item_count",
    "items",
  ]);
  assert.equal(body.archive_window_days, 7);
  assertIsoUtcTimestamp(body.generated_at);
  assert.equal(body.item_count, items.length);
  assert.ok(Array.isArray(body.items));

  for (const item of body.items) {
    assertNewsletterItemSchema(item);
  }
});

test("GET /api/newsletter/item/:id returns JSON matching the lifecycle response schema", async () => {
  const firstAppearance = buildEdition(10, "Persistent Agent Toolkit");
  firstAppearance.items[0].itemId = "persistent-agent-toolkit";
  firstAppearance.items[0].firstSeen = "2026-03-10T20:30:00Z";
  firstAppearance.items[0].editionCount = 1;
  firstAppearance.items[0].sentimentSpread = "agree";
  firstAppearance.items[0].storylineId = "storyline-persistent-agent-toolkit";

  const latestAppearance = buildEdition(11, "Persistent Agent Toolkit");
  latestAppearance.items[0].itemId = "persistent-agent-toolkit";
  latestAppearance.items[0].firstSeen = "2026-03-10T20:30:00Z";
  latestAppearance.items[0].editionCount = 2;
  latestAppearance.items[0].storylineId = "storyline-persistent-agent-toolkit";

  const handler = createHandler({
    getItemLifecycle: async () => ({
      itemId: "persistent-agent-toolkit",
      firstSeen: "2026-03-10T20:30:00.000Z",
      editionCount: 2,
      storyline: {
        storylineId: "storyline-persistent-agent-toolkit",
        title: "Persistent Agent Toolkit rollout",
        status: "stable",
        memberItemIds: ["persistent-agent-toolkit", "agent-memory-pack"],
        relatedItemIds: ["agent-memory-pack"],
        firstSeen: "2026-03-10T20:30:00.000Z",
        lastSeen: "2026-03-11T20:30:00.000Z",
        updatedAt: "2026-03-11T21:00:00.000Z",
        lastEvolutionAt: "2026-03-11T21:00:00.000Z",
        evolutionCount: 2,
        repetitionCount: 0,
        repetitionStreak: 0,
      },
      appearances: [
        {
          editionId: firstAppearance.id,
          publishedAt: firstAppearance.publishedAt,
          window: firstAppearance.window,
          item: firstAppearance.items[0],
          storyline: {
            storylineId: "storyline-persistent-agent-toolkit",
            title: "Persistent Agent Toolkit rollout",
            status: "developing",
            memberItemIds: ["persistent-agent-toolkit"],
            relatedItemIds: [],
            position: 1,
            relationship: {
              decision: "origin",
              explanation: "First appearance in this storyline.",
              priorAppearanceCount: 0,
              previousAppearance: null,
              signals: {
                factOverlapRatio: 0,
                novelFactCount: 0,
                novelTokenRatio: 0,
                newSourceClusterCount: 0,
              },
            },
          },
        },
        {
          editionId: latestAppearance.id,
          publishedAt: latestAppearance.publishedAt,
          window: latestAppearance.window,
          item: latestAppearance.items[0],
          storyline: {
            storylineId: "storyline-persistent-agent-toolkit",
            title: "Persistent Agent Toolkit rollout",
            status: "stable",
            memberItemIds: ["persistent-agent-toolkit", "agent-memory-pack"],
            relatedItemIds: ["agent-memory-pack"],
            position: 1,
            relationship: {
              decision: "evolution",
              explanation: "Introduces a new setup path and migration notes.",
              priorAppearanceCount: 1,
              previousAppearance: {
                editionId: "2026-03-10",
                publishedAt: "2026-03-10T21:00:00.000Z",
                sourceUrl: "https://example.com/persistent-agent-toolkit",
              },
              signals: {
                factOverlapRatio: 0.4,
                novelFactCount: 1,
                novelTokenRatio: 0.25,
                newSourceClusterCount: 1,
              },
            },
          },
        },
      ],
    }),
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/item/persistent-agent-toolkit",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assertNewsletterItemLifecycleSchema(body);
  assert.equal(body.first_appearance.edition_id, "2026-03-10");
  assert.deepEqual(
    body.repeat_appearances.map((appearance) => appearance.edition_id),
    ["2026-03-11"],
  );
  assert.deepEqual(
    body.storyline_membership.map((entry) => entry.relationship_decision),
    ["origin", "evolution"],
  );
});

test("POST /api/newsletter/latest returns a JSON 405 error", async () => {
  const handler = createHandler();
  const response = await handler({
    method: "POST",
    url: "/api/newsletter/latest",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 405,
    error: "method_not_allowed",
    message: "Use GET /api/newsletter/latest.",
  });
});

test("POST /api/newsletter/history returns a JSON 405 error", async () => {
  const handler = createHandler();
  const response = await handler({
    method: "POST",
    url: "/api/newsletter/history",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 405,
    error: "method_not_allowed",
    message: "Use GET /api/newsletter/history.",
  });
});

test("POST /api/newsletter/storylines returns a JSON 405 error", async () => {
  const handler = createHandler();
  const response = await handler({
    method: "POST",
    url: "/api/newsletter/storylines",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 405,
    error: "method_not_allowed",
    message: "Use GET /api/newsletter/storylines.",
  });
});

test("POST /api/newsletter/exclusions returns a JSON 405 error", async () => {
  const handler = createHandler();
  const response = await handler({
    method: "POST",
    url: "/api/newsletter/exclusions",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 405,
    error: "method_not_allowed",
    message: "Use GET /api/newsletter/exclusions.",
  });
});

test("POST /api/newsletter/exclusions/analytics returns a JSON 405 error", async () => {
  const handler = createHandler();
  const response = await handler({
    method: "POST",
    url: "/api/newsletter/exclusions/analytics",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 405,
    error: "method_not_allowed",
    message: "Use GET /api/newsletter/exclusions/analytics.",
  });
});

test("POST /api/newsletter/scope returns a JSON 405 error", async () => {
  const handler = createHandler();
  const response = await handler({
    method: "POST",
    url: "/api/newsletter/scope",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 405,
    error: "method_not_allowed",
    message: "Use GET /api/newsletter/scope.",
  });
});

test("POST /api/newsletter/coverage-map returns a JSON 405 error", async () => {
  const handler = createHandler();
  const response = await handler({
    method: "POST",
    url: "/api/newsletter/coverage-map",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 405,
    error: "method_not_allowed",
    message: "Use GET /api/newsletter/coverage-map.",
  });
});

test("POST /api/newsletter/reference returns a JSON 405 error", async () => {
  const handler = createHandler();
  const response = await handler({
    method: "POST",
    url: "/api/newsletter/reference",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 405,
    error: "method_not_allowed",
    message: "Use GET /api/newsletter/reference.",
  });
});

test("POST /api/newsletter/item/:id returns a JSON 405 error", async () => {
  const handler = createHandler();
  const response = await handler({
    method: "POST",
    url: "/api/newsletter/item/persistent-agent-toolkit",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 405,
    error: "method_not_allowed",
    message: "Use GET /api/newsletter/item/:id.",
  });
});

test("GET /api/newsletter/latest returns a JSON 404 error when no edition is published", async () => {
  const handler = createHandler();
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/latest",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 404,
    error: "not_found",
    message: "No published newsletter edition is available.",
  });
});

test("GET /api/newsletter/latest returns a JSON 429 error when the IP quota is exceeded", async () => {
  const edition = buildEdition(11, "Archive Day Seven");
  const handler = createNewsletterApiHandler({
    editionRepository: {
      getLatestPublishedEdition: async () => edition,
      listPublishedEditions: async () => [edition],
      listReferenceItems: async () => [],
      getItemLifecycle: async () => null,
    },
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: {
      maxRequests: 1,
      windowMs: 60_000,
      now: () => 1_000,
    },
  });

  await handler({
    method: "GET",
    url: "/api/newsletter/latest",
    socket: { remoteAddress: "203.0.113.21" },
  });
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/latest",
    socket: { remoteAddress: "203.0.113.21" },
  });
  const body = JSON.parse(response.body);

  assertRateLimitErrorSchema(response, body, {
    retryAfterSeconds: 60,
  });
});

test("GET /api/newsletter/item/:id returns a JSON 404 error when no lifecycle is published", async () => {
  const handler = createHandler();
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/item/persistent-agent-toolkit",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 404,
    error: "not_found",
    message: "No published newsletter item is available for the requested id.",
  });
});

test("GET unknown newsletter routes returns a JSON 404 error", async () => {
  const handler = createHandler();
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/unknown",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 404,
    error: "not_found",
    message: "Route not found.",
  });
});

test("GET /api/newsletter/latest returns a JSON 500 error when edition loading fails", async () => {
  const handler = createHandler({
    getLatestPublishedEdition: async () => {
      throw new Error("repository unavailable");
    },
  });
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/latest",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 500,
    error: "internal_server_error",
    message: "repository unavailable",
  });
});

test("GET /api/newsletter/history returns a JSON 500 error when archive loading fails", async () => {
  const handler = createHandler({
    listPublishedEditions: async () => {
      throw new Error("archive unavailable");
    },
  });
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/history",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 500,
    error: "internal_server_error",
    message: "archive unavailable",
  });
});

test("GET /api/newsletter/storylines returns a JSON 500 error when storyline loading fails", async () => {
  const handler = createHandler({
    listActiveStorylines: async () => {
      throw new Error("storylines unavailable");
    },
  });
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/storylines",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 500,
    error: "internal_server_error",
    message: "storylines unavailable",
  });
});

test("GET /api/newsletter/exclusions returns a JSON 500 error when exclusion summary loading fails", async () => {
  const handler = createHandler({
    queryExclusionSummary: async () => {
      throw new Error("exclusion summary unavailable");
    },
  });
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/exclusions",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 500,
    error: "internal_server_error",
    message: "exclusion summary unavailable",
  });
});

test("GET /api/newsletter/exclusions/analytics returns a JSON 500 error when exclusion analytics loading fails", async () => {
  const handler = createHandler({
    queryExclusionAnalytics: async () => {
      throw new Error("exclusion analytics unavailable");
    },
  });
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/exclusions/analytics",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 500,
    error: "internal_server_error",
    message: "exclusion analytics unavailable",
  });
});

test("GET /api/newsletter/coverage-map returns a JSON 500 error when source coverage loading fails", async () => {
  const handler = createHandler({
    sourceRepository: {
      async load() {
        throw new Error("source coverage unavailable");
      },
    },
  });
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/coverage-map",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 500,
    error: "internal_server_error",
    message: "source coverage unavailable",
  });
});

test("GET /api/newsletter/reference returns a JSON 500 error when reference loading fails", async () => {
  const handler = createHandler({
    listReferenceItems: async () => {
      throw new Error("reference index unavailable");
    },
  });
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/reference",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 500,
    error: "internal_server_error",
    message: "reference index unavailable",
  });
});

test("GET /api/newsletter/item/:id returns a JSON 500 error when lifecycle loading fails", async () => {
  const handler = createHandler({
    getItemLifecycle: async () => {
      throw new Error("item lifecycle unavailable");
    },
  });
  const response = await handler({
    method: "GET",
    url: "/api/newsletter/item/persistent-agent-toolkit",
  });
  const body = JSON.parse(response.body);

  assertErrorSchema(response, body, {
    status: 500,
    error: "internal_server_error",
    message: "item lifecycle unavailable",
  });
});
