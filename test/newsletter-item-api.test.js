import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  CONTENT_CATEGORIES,
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  DISAGREEMENT_DIMENSIONS,
  NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  NewsletterEditionRepository,
  NewsletterEditionStore,
  RISK_SEVERITIES,
  RISK_WARNING_DIMENSIONS,
  SCORE_INTERPRETATIONS,
  SENTIMENT_SPREADS,
  createNewsletterApiHandler,
} from "../src/index.js";

function buildEdition(day, editionCount) {
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
        itemId: "persistent-agent-sdk-item",
        name: "Persistent Agent SDK",
        sourceUrl: "https://example.com/persistent-agent-sdk",
        sourceUrls: [
          "https://example.com/persistent-agent-sdk",
          "https://mirror.example.com/persistent-agent-sdk",
        ],
        category: "tool",
        summary: "Persistent Agent SDK helps agents ship integrations faster.",
        integrationHint: "Review Persistent Agent SDK installation docs before rollout.",
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
        firstSeen: "2026-03-10T20:30:00Z",
        editionCount,
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

function buildVersionedEdition(day, editionCount, itemOverrides = {}) {
  const baseEdition = buildEdition(day, editionCount);

  return {
    ...baseEdition,
    items: [
      {
        ...baseEdition.items[0],
        ...itemOverrides,
      },
    ],
  };
}

function attachStoryline(
  edition,
  {
    storylineId = "storyline-persistent-agent-sdk-rollout",
    title = "Persistent Agent SDK rollout",
    status = "developing",
    memberItemIds = [edition.items[0].itemId],
    position = 1,
    relationship = null,
    firstSeen = edition.items[0].firstSeen,
    lastSeen = edition.items[0].discoveredAt,
    updatedAt = edition.publishedAt,
    lastEvolutionAt = edition.publishedAt,
    evolutionCount = 1,
    repetitionCount = 0,
    repetitionStreak = 0,
  } = {},
) {
  edition.items[0].storylineId = storylineId;
  edition.items[0].storylineMemberPosition = position;
  edition.items[0].metadata = {
    ...(edition.items[0].metadata ?? {}),
    storyline: {
      storylineId,
      id: storylineId,
      title,
      status,
      member_item_ids: memberItemIds,
      position,
      first_seen: firstSeen,
      last_seen: lastSeen,
      updated_at: updatedAt,
      last_evolution_at: lastEvolutionAt,
      evolution_count: evolutionCount,
      repetition_count: repetitionCount,
      repetition_streak: repetitionStreak,
      relationship,
    },
  };
  edition.storylines = [
    {
      storylineId,
      title,
      memberItemIds,
      status,
    },
  ];

  return edition;
}

async function createRepository(editions) {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new NewsletterEditionRepository({
    filePath: join(directory, "newsletter-editions.json"),
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:05:00Z",
    editions,
  });

  return repository;
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

function assertStorylineSummarySchema(storyline) {
  if (storyline == null) {
    return;
  }

  assert.deepEqual(Object.keys(storyline).sort(), [
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
  ]);
  assert.equal(typeof storyline.storyline_id, "string");
  assert.ok(storyline.storyline_id.length > 0);
  assert.equal(typeof storyline.title, "string");
  assert.ok(storyline.title.length > 0);
  assert.equal(typeof storyline.status, "string");
  assert.ok(storyline.status.length > 0);
  assert.ok(Array.isArray(storyline.member_item_ids));
  assert.ok(Array.isArray(storyline.related_item_ids));
  assert.deepEqual(storyline.member_item_ids, [...new Set(storyline.member_item_ids)]);
  assert.deepEqual(storyline.related_item_ids, [...new Set(storyline.related_item_ids)]);
  assertIsoUtcTimestamp(storyline.first_seen);
  assertIsoUtcTimestamp(storyline.last_seen);
  assertIsoUtcTimestamp(storyline.updated_at);
  assertIsoUtcTimestamp(storyline.last_evolution_at);
  for (const value of [
    storyline.evolution_count,
    storyline.repetition_count,
    storyline.repetition_streak,
  ]) {
    assert.equal(typeof value, "number");
    assert.ok(Number.isInteger(value));
    assert.ok(value >= 0);
  }
}

function assertStorylineAppearanceSchema(storyline) {
  if (storyline == null) {
    return;
  }

  assert.deepEqual(Object.keys(storyline).sort(), [
    "member_item_ids",
    "position",
    "related_item_ids",
    "relationship",
    "status",
    "storyline_id",
    "title",
  ]);
  assert.equal(typeof storyline.storyline_id, "string");
  assert.ok(storyline.storyline_id.length > 0);
  assert.equal(typeof storyline.title, "string");
  assert.ok(storyline.title.length > 0);
  assert.equal(typeof storyline.status, "string");
  assert.ok(storyline.status.length > 0);
  assert.equal(typeof storyline.position, "number");
  assert.ok(Number.isInteger(storyline.position));
  assert.ok(storyline.position >= 1);
  assert.ok(Array.isArray(storyline.member_item_ids));
  assert.ok(Array.isArray(storyline.related_item_ids));
  assertStorylineRelationshipSchema(storyline.relationship);
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

  if (relationship.previous_appearance != null) {
    assert.deepEqual(Object.keys(relationship.previous_appearance).sort(), [
      "edition_id",
      "published_at",
      "source_url",
    ]);

    if (relationship.previous_appearance.edition_id != null) {
      assert.equal(typeof relationship.previous_appearance.edition_id, "string");
      assert.ok(relationship.previous_appearance.edition_id.length > 0);
    }

    if (relationship.previous_appearance.published_at != null) {
      assertIsoUtcTimestamp(relationship.previous_appearance.published_at);
    }

    if (relationship.previous_appearance.source_url != null) {
      assert.ok(new URL(relationship.previous_appearance.source_url));
    }
  }

  assert.deepEqual(Object.keys(relationship.signals).sort(), [
    "fact_overlap_ratio",
    "new_source_cluster_count",
    "novel_fact_count",
    "novel_token_ratio",
  ]);
}

test("NewsletterEditionRepository returns an item's lifecycle in chronological edition order", async () => {
  const firstEdition = attachStoryline(buildEdition(10, 1), {
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
    memberItemIds: ["persistent-agent-sdk-item"],
  });
  const secondEdition = attachStoryline(buildEdition(11, 2), {
    status: "stable",
    memberItemIds: ["persistent-agent-sdk-item", "agent-memory-pack-item"],
    relationship: {
      decision: "evolution",
      explanation: "Introduces 1 novel fact clause with 25% novel tokens.",
      priorAppearanceCount: 1,
      previousAppearance: {
        editionId: "2026-03-10",
        publishedAt: "2026-03-10T21:00:00.000Z",
        sourceUrl: "https://example.com/persistent-agent-sdk",
      },
      signals: {
        factOverlapRatio: 0.4,
        novelFactCount: 1,
        novelTokenRatio: 0.25,
        newSourceClusterCount: 1,
      },
    },
    evolutionCount: 2,
  });
  const repository = await createRepository([
    firstEdition,
    secondEdition,
    {
      ...buildEdition(12, 3),
      publishedAt: "2026-03-12T21:00:00Z",
      window: {
        startsAt: "2026-03-11T21:00:00Z",
        endsAt: "2026-03-12T21:00:00Z",
        timezone: "UTC",
      },
    },
  ]);

  const lifecycle = await repository.getItemLifecycle({
    itemId: "persistent-agent-sdk-item",
    now: "2026-03-11T21:30:00Z",
  });

  assert.equal(lifecycle?.itemId, "persistent-agent-sdk-item");
  assert.equal(lifecycle?.firstSeen, "2026-03-10T20:30:00.000Z");
  assert.equal(lifecycle?.editionCount, 2);
  assert.deepEqual(
    lifecycle?.appearances.map((appearance) => appearance.editionId),
    ["2026-03-10", "2026-03-11"],
  );
  assert.equal(lifecycle?.firstAppearance?.editionId, "2026-03-10");
  assert.equal(lifecycle?.firstAppearance?.appearanceNumber, 1);
  assert.equal(lifecycle?.firstAppearance?.divergenceFlag, false);
  assert.deepEqual(
    lifecycle?.repeatAppearances?.map((appearance) => appearance.editionId),
    ["2026-03-11"],
  );
  assert.deepEqual(
    lifecycle?.repeatAppearances?.map((appearance) => appearance.divergenceFlag),
    [true],
  );
  assert.deepEqual(
    lifecycle?.scoreEvolution?.map((entry) => entry.relevanceScore),
    [84, 84],
  );
  assert.deepEqual(
    lifecycle?.scoreEvolution?.map((entry) => entry.divergenceFlag),
    [false, true],
  );
  assert.deepEqual(
    lifecycle?.storylineMembership?.map((entry) => entry.primaryStorylineId),
    [
      "storyline-persistent-agent-sdk-rollout",
      "storyline-persistent-agent-sdk-rollout",
    ],
  );
  assert.equal(lifecycle?.appearances[0].item.editionCount, 1);
  assert.equal(lifecycle?.appearances[1].item.editionCount, 2);
  assert.equal(lifecycle?.storyline?.storylineId, "storyline-persistent-agent-sdk-rollout");
  assert.deepEqual(lifecycle?.storyline?.memberItemIds, [
    "persistent-agent-sdk-item",
    "agent-memory-pack-item",
  ]);
  assert.equal(lifecycle?.appearances[0].storyline?.relationship?.decision, "origin");
  assert.equal(lifecycle?.appearances[1].storyline?.relationship?.decision, "evolution");
});

test("GET /api/newsletter/item/:id returns the full lifecycle payload for a published item", async () => {
  const repository = await createRepository([
    attachStoryline(buildEdition(10, 1), {
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
      memberItemIds: ["persistent-agent-sdk-item"],
    }),
    attachStoryline(buildEdition(11, 2), {
      status: "stable",
      memberItemIds: ["persistent-agent-sdk-item", "agent-memory-pack-item"],
      relationship: {
        decision: "evolution",
        explanation: "Introduces 1 novel fact clause with 25% novel tokens.",
        priorAppearanceCount: 1,
        previousAppearance: {
          editionId: "2026-03-10",
          publishedAt: "2026-03-10T21:00:00.000Z",
          sourceUrl: "https://example.com/persistent-agent-sdk",
        },
        signals: {
          factOverlapRatio: 0.4,
          novelFactCount: 1,
          novelTokenRatio: 0.25,
          newSourceClusterCount: 1,
        },
      },
      evolutionCount: 2,
    }),
  ]);
  const handler = createNewsletterApiHandler({
    editionRepository: repository,
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/item/persistent-agent-sdk-item",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assertNewsletterItemLifecycleSchema(body);
  assert.equal(body.storyline.storyline_id, "storyline-persistent-agent-sdk-rollout");
  assert.equal(body.storyline.status, "stable");
  assert.equal(body.first_appearance.edition_id, "2026-03-10");
  assert.equal(body.first_appearance.appearance_number, 1);
  assert.deepEqual(
    body.repeat_appearances.map((appearance) => appearance.edition_id),
    ["2026-03-11"],
  );
  assert.deepEqual(
    body.score_evolution.map((entry) => entry.delta_from_first_appearance),
    [0, 0],
  );
  assert.deepEqual(
    body.storyline_membership.map((entry) => entry.relationship_decision),
    ["origin", "evolution"],
  );
  assert.deepEqual(body.storyline.member_item_ids, [
    "persistent-agent-sdk-item",
    "agent-memory-pack-item",
  ]);
  assert.deepEqual(body.storyline.related_item_ids, ["agent-memory-pack-item"]);
  assert.equal(body.appearances[0].storyline.relationship.decision, "origin");
  assert.equal(body.appearances[1].storyline.relationship.decision, "evolution");
  assert.equal(
    body.appearances[1].storyline.relationship.previous_appearance.edition_id,
    "2026-03-10",
  );
  assert.equal(body.appearances[1].storyline.position, 1);
  assert.deepEqual(body.appearances[1].item.storyline_ids, [
    "storyline-persistent-agent-sdk-rollout",
  ]);
});

test("GET /api/newsletter/item/:id returns 404 when the item has no published appearances yet", async () => {
  const historicalEdition = buildEdition(10, 1);
  historicalEdition.items[0].itemId = "other-agent-sdk-item";
  historicalEdition.items[0].name = "Other Agent SDK";
  historicalEdition.items[0].sourceUrl = "https://example.com/other-agent-sdk";
  historicalEdition.items[0].sourceUrls = [
    "https://example.com/other-agent-sdk",
    "https://mirror.example.com/other-agent-sdk",
  ];
  historicalEdition.items[0].summary = "Other Agent SDK helps agents ship integrations faster.";
  historicalEdition.items[0].integrationHint =
    "Review Other Agent SDK installation docs before rollout.";

  const futureEdition = buildEdition(12, 1);
  futureEdition.publishedAt = "2026-03-12T21:00:00Z";
  futureEdition.window = {
    startsAt: "2026-03-11T21:00:00Z",
    endsAt: "2026-03-12T21:00:00Z",
    timezone: "UTC",
  };

  const repository = await createRepository([historicalEdition, futureEdition]);
  const handler = createNewsletterApiHandler({
    editionRepository: repository,
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/item/persistent-agent-sdk-item",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 404);
  assert.deepEqual(body, {
    error: "not_found",
    message: "No published newsletter item is available for the requested id.",
  });
});

test("GET /api/newsletter/item/:id decodes the item id before lookup", async () => {
  const lookups = [];
  const handler = createNewsletterApiHandler({
    editionRepository: {
      async getLatestPublishedEdition() {
        return null;
      },
      async listPublishedEditions() {
        return [];
      },
      async getItemLifecycle(input) {
        lookups.push(input);
        return null;
      },
    },
    now: () => "2026-03-11T21:30:00Z",
    consumerTracking: false,
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/item/artifact-agent-sdk%2Frelease%20notes",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 404);
  assert.deepEqual(body, {
    error: "not_found",
    message: "No published newsletter item is available for the requested id.",
  });
  assert.deepEqual(lookups, [
    {
      itemId: "artifact-agent-sdk/release notes",
      now: "2026-03-11T21:30:00.000Z",
      consumer: null,
    },
  ]);
});

test("GET /api/newsletter/item/:id derives lifecycle from published editions when the repository omits getItemLifecycle", async () => {
  const editions = [
    attachStoryline(
      buildVersionedEdition(10, 1, {
        itemId: "artifact-github-com-acme-agent-sdk",
        name: "Agent SDK",
        sourceUrl: "https://github.com/acme/agent-sdk",
        sourceUrls: ["https://github.com/acme/agent-sdk"],
        summary: "Initial repository release for Agent SDK.",
        integrationHint: "npm install agent-sdk",
        relevanceScore: 76,
        discoveredAt: "2026-03-10T20:30:00Z",
        firstSeen: "2026-03-10T20:30:00Z",
      }),
      {
        storylineId: "storyline-agent-sdk-rollout",
        title: "Agent SDK rollout",
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
    ),
    attachStoryline(
      buildVersionedEdition(11, 2, {
        itemId: "artifact-github-com-acme-agent-sdk",
        name: "Agent SDK setup guide",
        sourceUrl: "https://docs.example.com/agent-sdk/get-started",
        sourceUrls: [
          "https://github.com/acme/agent-sdk",
          "https://docs.example.com/agent-sdk/get-started",
        ],
        summary: "Docs update covering installation, auth setup, and migration notes.",
        integrationHint: "Apply the migration guide before enabling production traffic.",
        relevanceScore: 83,
        discoveredAt: "2026-03-11T20:30:00Z",
        firstSeen: "2026-03-10T20:30:00Z",
      }),
      {
        storylineId: "storyline-agent-sdk-rollout",
        title: "Agent SDK rollout",
        status: "stable",
        memberItemIds: [
          "artifact-github-com-acme-agent-sdk",
          "artifact-github-com-acme-agent-sdk-runtime-pack",
        ],
        relationship: {
          decision: "evolution",
          explanation: "Introduces setup guidance and migration details.",
          priorAppearanceCount: 1,
          previousAppearance: {
            editionId: "2026-03-10",
            publishedAt: "2026-03-10T21:00:00.000Z",
            sourceUrl: "https://github.com/acme/agent-sdk",
          },
          signals: {
            factOverlapRatio: 0.35,
            novelFactCount: 2,
            novelTokenRatio: 0.4,
            newSourceClusterCount: 1,
          },
        },
        evolutionCount: 2,
      },
    ),
  ];
  const listPublishedEditionsCalls = [];
  const handler = createNewsletterApiHandler({
    editionRepository: {
      async getLatestPublishedEdition() {
        return editions.at(-1);
      },
      async listPublishedEditions(input) {
        listPublishedEditionsCalls.push(input);
        return [...editions].reverse();
      },
    },
    now: () => "2026-03-11T21:30:00Z",
    consumerTracking: false,
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/item/artifact-github-com-acme-agent-sdk",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assertNewsletterItemLifecycleSchema(body);
  assert.equal(body.item_id, "artifact-github-com-acme-agent-sdk");
  assert.equal(body.edition_count, 2);
  assert.deepEqual(
    body.appearances.map((appearance) => appearance.edition_id),
    ["2026-03-10", "2026-03-11"],
  );
  assert.deepEqual(
    body.appearances.map((appearance) => appearance.item.source_urls[0]),
    [
      "https://github.com/acme/agent-sdk",
      "https://docs.example.com/agent-sdk/get-started",
    ],
  );
  assert.equal(listPublishedEditionsCalls.length, 1);
  assert.equal(listPublishedEditionsCalls[0].now, "2026-03-11T21:30:00.000Z");
  assert.equal(listPublishedEditionsCalls[0].consumer, null);
  assert.ok(Number.isInteger(listPublishedEditionsCalls[0].days));
  assert.ok(listPublishedEditionsCalls[0].days >= 20000);
});

test("GET /api/newsletter/item/:id works when the API is backed by NewsletterEditionStore", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const newsletterStore = new NewsletterEditionStore({ directoryPath });

  await newsletterStore.publish(
    attachStoryline(buildEdition(10, 1), {
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
    }),
  );
  await newsletterStore.publish(
    attachStoryline(buildEdition(11, 2), {
      status: "stable",
      memberItemIds: ["persistent-agent-sdk-item", "agent-memory-pack-item"],
      relationship: {
        decision: "evolution",
        explanation: "Introduces 1 novel fact clause with 25% novel tokens.",
        priorAppearanceCount: 1,
        previousAppearance: {
          editionId: "2026-03-10",
          publishedAt: "2026-03-10T21:00:00.000Z",
          sourceUrl: "https://example.com/persistent-agent-sdk",
        },
        signals: {
          factOverlapRatio: 0.4,
          novelFactCount: 1,
          novelTokenRatio: 0.25,
          newSourceClusterCount: 1,
        },
      },
      evolutionCount: 2,
    }),
  );

  const handler = createNewsletterApiHandler({
    newsletterStore,
    now: () => "2026-03-11T21:30:00Z",
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/item/persistent-agent-sdk-item",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(body.item_id, "persistent-agent-sdk-item");
  assert.equal(body.edition_count, 2);
  assert.equal(body.first_appearance.edition_id, "2026-03-10");
  assert.deepEqual(
    body.appearances.map((appearance) => appearance.edition_id),
    ["2026-03-10", "2026-03-11"],
  );
  assert.equal(body.storyline.storyline_id, "storyline-persistent-agent-sdk-rollout");
});

test("GET /api/newsletter/item/:id derives lifecycle from newsletterStore history when loadItemLifecycle is unavailable", async () => {
  const editions = [
    attachStoryline(buildEdition(10, 1), {
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
    }),
    attachStoryline(buildEdition(11, 2), {
      status: "stable",
      memberItemIds: ["persistent-agent-sdk-item", "agent-memory-pack-item"],
      relationship: {
        decision: "evolution",
        explanation: "Introduces 1 novel fact clause with 25% novel tokens.",
        priorAppearanceCount: 1,
        previousAppearance: {
          editionId: "2026-03-10",
          publishedAt: "2026-03-10T21:00:00.000Z",
          sourceUrl: "https://example.com/persistent-agent-sdk",
        },
        signals: {
          factOverlapRatio: 0.4,
          novelFactCount: 1,
          novelTokenRatio: 0.25,
          newSourceClusterCount: 1,
        },
      },
      evolutionCount: 2,
    }),
  ];
  const loadHistoryCalls = [];
  const handler = createNewsletterApiHandler({
    newsletterStore: {
      async loadLatest() {
        return editions.at(-1);
      },
      async loadHistory(input) {
        loadHistoryCalls.push(input);
        return [...editions].reverse();
      },
    },
    now: () => "2026-03-11T21:30:00Z",
    consumerTracking: false,
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/item/persistent-agent-sdk-item",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assertNewsletterItemLifecycleSchema(body);
  assert.equal(body.item_id, "persistent-agent-sdk-item");
  assert.deepEqual(
    body.appearances.map((appearance) => appearance.edition_id),
    ["2026-03-10", "2026-03-11"],
  );
  assert.equal(body.storyline.storyline_id, "storyline-persistent-agent-sdk-rollout");
  assert.equal(loadHistoryCalls.length, 1);
  assert.equal(loadHistoryCalls[0].now, "2026-03-11T21:30:00.000Z");
  assert.ok(Number.isInteger(loadHistoryCalls[0].days));
  assert.ok(loadHistoryCalls[0].days >= 20000);
});

test("GET /api/newsletter/item/:id preserves continuity when source urls and content evolve across editions", async () => {
  const repository = await createRepository([
    attachStoryline(
      buildVersionedEdition(10, 1, {
        itemId: "artifact-github-com-acme-agent-sdk",
        name: "Agent SDK",
        sourceUrl: "https://github.com/acme/agent-sdk",
        sourceUrls: ["https://github.com/acme/agent-sdk"],
        summary: "Initial repository release for Agent SDK.",
        integrationHint: "npm install agent-sdk",
        relevanceScore: 76,
        discoveredAt: "2026-03-10T20:30:00Z",
        firstSeen: "2026-03-10T20:30:00Z",
      }),
      {
        storylineId: "storyline-agent-sdk-rollout",
        title: "Agent SDK rollout",
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
    ),
    attachStoryline(
      buildVersionedEdition(11, 2, {
        itemId: "artifact-github-com-acme-agent-sdk",
        name: "Agent SDK setup guide",
        sourceUrl: "https://docs.example.com/agent-sdk/get-started",
        sourceUrls: [
          "https://github.com/acme/agent-sdk",
          "https://docs.example.com/agent-sdk/get-started",
        ],
        summary: "Docs update covering installation, auth setup, and migration notes.",
        integrationHint: "Apply the migration guide before enabling production traffic.",
        relevanceScore: 83,
        discoveredAt: "2026-03-11T20:30:00Z",
        firstSeen: "2026-03-10T20:30:00Z",
      }),
      {
        storylineId: "storyline-agent-sdk-rollout",
        title: "Agent SDK rollout",
        status: "stable",
        memberItemIds: [
          "artifact-github-com-acme-agent-sdk",
          "artifact-github-com-acme-agent-sdk-runtime-pack",
        ],
        relationship: {
          decision: "evolution",
          explanation: "Introduces setup guidance and migration details.",
          priorAppearanceCount: 1,
          previousAppearance: {
            editionId: "2026-03-10",
            publishedAt: "2026-03-10T21:00:00.000Z",
            sourceUrl: "https://github.com/acme/agent-sdk",
          },
          signals: {
            factOverlapRatio: 0.35,
            novelFactCount: 2,
            novelTokenRatio: 0.4,
            newSourceClusterCount: 1,
          },
        },
        evolutionCount: 2,
      },
    ),
    attachStoryline(
      buildVersionedEdition(12, 3, {
        itemId: "artifact-github-com-acme-agent-sdk",
        name: "Agent SDK rollout thread",
        sourceUrl: "https://x.com/acme/status/123",
        sourceUrls: [
          "https://github.com/acme/agent-sdk",
          "https://docs.example.com/agent-sdk/get-started",
          "https://x.com/acme/status/123",
        ],
        summary: "Rollout thread with updated caveats, telemetry notes, and patch guidance.",
        integrationHint: "Review the rollout thread before upgrading autonomous workers.",
        relevanceScore: 91,
        discoveredAt: "2026-03-12T20:30:00Z",
        firstSeen: "2026-03-10T20:30:00Z",
        sentimentSpread: {
          classification: "mixed",
          disagreementDimension: "utility",
        },
      }),
      {
        storylineId: "storyline-agent-sdk-rollout",
        title: "Agent SDK rollout",
        status: "stable",
        memberItemIds: [
          "artifact-github-com-acme-agent-sdk",
          "artifact-github-com-acme-agent-sdk-runtime-pack",
        ],
        relationship: {
          decision: "evolution",
          explanation: "Introduces rollout caveats and telemetry notes.",
          priorAppearanceCount: 2,
          previousAppearance: {
            editionId: "2026-03-11",
            publishedAt: "2026-03-11T21:00:00.000Z",
            sourceUrl: "https://docs.example.com/agent-sdk/get-started",
          },
          signals: {
            factOverlapRatio: 0.3,
            novelFactCount: 2,
            novelTokenRatio: 0.45,
            newSourceClusterCount: 1,
          },
        },
        evolutionCount: 3,
      },
    ),
  ]);
  const handler = createNewsletterApiHandler({
    editionRepository: repository,
    now: () => "2026-03-12T21:30:00Z",
    rateLimit: false,
  });

  const response = await handler({
    method: "GET",
    url: "/api/newsletter/item/artifact-github-com-acme-agent-sdk",
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(body.item_id, "artifact-github-com-acme-agent-sdk");
  assert.equal(body.first_seen, "2026-03-10T20:30:00.000Z");
  assert.equal(body.edition_count, 3);
  assert.equal(body.first_appearance.edition_id, "2026-03-10");
  assert.deepEqual(
    body.repeat_appearances.map((appearance) => appearance.edition_id),
    ["2026-03-11", "2026-03-12"],
  );
  assert.deepEqual(
    body.appearances.map((appearance) => appearance.item.summary),
    [
      "Initial repository release for Agent SDK.",
      "Docs update covering installation, auth setup, and migration notes.",
      "Rollout thread with updated caveats, telemetry notes, and patch guidance.",
    ],
  );
  assert.deepEqual(
    body.appearances.map((appearance) => appearance.item.integration_hint),
    [
      "npm install agent-sdk",
      "Apply the migration guide before enabling production traffic.",
      "Review the rollout thread before upgrading autonomous workers.",
    ],
  );
  assert.deepEqual(
    body.appearances.map((appearance) => appearance.item.source_urls[0]),
    [
      "https://github.com/acme/agent-sdk",
      "https://docs.example.com/agent-sdk/get-started",
      "https://x.com/acme/status/123",
    ],
  );
  assert.deepEqual(
    body.appearances.map((appearance) => appearance.item.edition_count),
    [1, 2, 3],
  );
  assert.equal(body.storyline.storyline_id, "storyline-agent-sdk-rollout");
  assert.deepEqual(body.storyline.related_item_ids, [
    "artifact-github-com-acme-agent-sdk-runtime-pack",
  ]);
  assert.deepEqual(
    body.score_evolution.map((entry) => entry.delta_from_first_appearance),
    [0, 7, 15],
  );
  assert.deepEqual(
    body.repeat_appearances.map((appearance) => appearance.divergence_flag),
    [true, true],
  );
  assert.deepEqual(
    body.score_evolution.map((entry) => entry.divergence_flag),
    [false, true, true],
  );
  assert.deepEqual(
    body.storyline_membership.map((entry) => entry.primary_storyline_id),
    [
      "storyline-agent-sdk-rollout",
      "storyline-agent-sdk-rollout",
      "storyline-agent-sdk-rollout",
    ],
  );
  assert.deepEqual(
    body.appearances.map((appearance) => appearance.storyline.relationship.decision),
    ["origin", "evolution", "evolution"],
  );
});
