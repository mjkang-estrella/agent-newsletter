# Consumer metadata additions, schema 1.2.0

The existing endpoints and stable IDs are unchanged. Every serialized item adds supplemental `evidence` with nullable `source_published_at` and `collected_at`, a `novelty_reason`, and an `uncertainty` string. Source dates are not edition publication dates. The explanation comes from the existing storyline classification when available.

Newly published editions include `publication` with `mode` (`live` or `sample`), `collected_at`, `coverage_status` (`complete`, `partial`, or `unknown`), `sources` (adapter ID, kind, status, fetched count), and `missing_sources`. Legacy records may omit it. Never infer complete coverage from absence.

`GET /api/newsletter/latest` adds `freshness`: `checked_at`, `age_seconds`, `stale`, `stale_after_hours` (26), and `coverage_status`. The rolling archive does not imply the latest edition is recent. Read the freshness flag explicitly.

For a runnable, checkpointed consumer and its limits, see [the quick start](../README.md). Supplemental fields are additive; clients should tolerate future additional fields.

---

# Newsletter JSON API

Machine-facing reference for the public newsletter API used by autonomous AI agents. This document reflects the current implementation in `src/newsletter/api.js`, the shared item contract in `src/newsletter/item-response-schema.js`, and the HTTP contract tests in `test/newsletter-api-contract.test.js`.

## Purpose

The API publishes one curated newsletter edition per day. It is designed for agents that:

- poll for the newest edition after the daily publish slot
- backfill missed editions from the rolling archive
- track a stable entity across editions by `item_id`
- reason about repeated mentions versus evolving narratives through storylines
- inspect exclusion analytics and scope boundaries before autonomous adoption

Primary audience: autonomous AI agents.
Secondary audience: human operators auditing the feed.

## Transport And Access

| Property | Value |
| --- | --- |
| Base route family | `/api/newsletter/*` |
| Auth | none |
| Allowed methods | `GET` only |
| Content type | `application/json; charset=utf-8` |
| Request body | ignored |
| Publication cadence | once per day at `21:00` in `NEWSLETTER_BASE_TIMEZONE` |
| Default timezone | `UTC` |
| Content window | approximately the prior 24 hours |
| Rate limiting | per IP |

Recommended request headers:

- `Accept: application/json`
- `User-Agent: <stable-agent-id>/<version>`
- Optional consumer identity headers: `X-Agent-Consumer-Id`, `X-Newsletter-Consumer-Id`, `X-Newsletter-Consumer`, `X-Consumer-Id`

The consumer identity headers are for tracking only. They do not authenticate the caller and do not bypass rate limits.

## Endpoint Summary

| Method | Path | Purpose | Success payload |
| --- | --- | --- | --- |
| `GET` | `/api/newsletter/latest` | Return the newest published edition whose `published_at` is in the past. | `NewsletterEdition` |
| `GET` | `/api/newsletter/history` | Return the rolling archive window. | `NewsletterArchiveResponse` |
| `GET` | `/api/newsletter/reference` | Return persistent high-signal items promoted out of the rolling archive. | `ReferenceIndexResponse` |
| `GET` | `/api/newsletter/item/:id` | Return one stable entity across all published appearances. | `ItemLifecycleResponse` |
| `GET` | `/api/newsletter/storylines` | Return active storylines that group developing narratives. | `StorylinesResponse` |
| `GET` | `/api/newsletter/scope` | Return the current versioned editorial boundary and changelog. | `ScopeDefinitionResponse` |
| `GET` | `/api/newsletter/coverage-map` | Return per-category source coverage status. | `CoverageMapResponse` |
| `GET` | `/api/newsletter/exclusions` | Return grouped exclusion summary statistics. | `ExclusionSummaryResponse` |
| `GET` | `/api/newsletter/exclusions/analytics` | Return detailed cross-edition exclusion analytics. | `ExclusionAnalyticsResponse` |
| `GET` | `/api/newsletter/exclusions/report` | Return the analytics payload plus grouped summary and per-edition summaries. | `ExclusionReportResponse` |

## Shared Types

### `NewsletterItem`

Current schema version: `1.1.0`

This is the core item contract reused by:

- `GET /api/newsletter/latest`
- `GET /api/newsletter/history`
- `GET /api/newsletter/reference`
- `GET /api/newsletter/item/:id` inside each lifecycle appearance
- `GET /api/newsletter/storylines` inside each storyline

| Field | Type | Notes |
| --- | --- | --- |
| `item_id` | `string` | Stable entity identifier across editions. Identity is based on the underlying project, paper, framework, or release, not on one URL. |
| `name` | `string` | Canonical display name for the entity. |
| `source_urls` | `string[]` | Deduplicated canonical source URLs for the entity in the current payload. |
| `category` | `"tool" \| "api" \| "library" \| "technique"` | Published category. |
| `summary` | `string` | Short machine-readable summary. |
| `integration_hint` | `string` | Immediate next-step guidance for downstream evaluation or integration. |
| `relevance_score` | `number` | Weighted composite score in the range `0-100`. Published items are gated at `>= 60`. |
| `score_version` | `string` | Version identifier for the scoring formula that produced `relevance_score`. Treat as opaque. |
| `score_interpretation` | `"predictive" \| "assessment" \| "classificatory"` | How to interpret `relevance_score`. The built-in scorer emits `"assessment"`. |
| `divergence_flag` | `boolean` | `true` when source sentiment materially diverges. |
| `risk_warning` | `object` | Structured risk object with required dimensions `security`, `maturity`, and `adoption_complexity`. Each dimension contains `{ severity, description }`. |
| `mention_count` | `integer` | Cross-source mention count after deduplication. |
| `sentiment_spread.classification` | `"agree" \| "disagree" \| "mixed"` | Cross-source agreement state. |
| `sentiment_spread.disagreement_dimension` | `"security" \| "utility" \| "novelty" \| "market"` | Present when sources disagree or partially disagree. |
| `first_seen` | `string` | First observed timestamp for this entity in the corpus. |
| `edition_count` | `integer` | Number of published editions in which the entity has appeared so far. |
| `storyline_ids` | `string[]` | One entity can belong to multiple storylines over time. |
| `storyline` | `object \| null` | Optional storyline context relevant to the current response. |
| `scope_version` | `string` | Editorial scope version active when the item was published. Resolve against `GET /api/newsletter/scope`. |

#### `risk_warning`

Each risk dimension is required and has the same shape:

```json
{
  "severity": "unknown | low | medium | high | critical",
  "description": "Why the agent should treat this dimension with caution."
}
```

#### `storyline`

When present on an item, `storyline` is the normalized state of the item inside the current response context.

| Field | Type | Notes |
| --- | --- | --- |
| `storyline_id` | `string` | Stable storyline identifier. |
| `title` | `string` | Human-readable storyline title. |
| `status` | `"developing" \| "stable" \| "archived"` | Current storyline status. |
| `position` | `integer` | Position of the item within the storyline ordering. |
| `member_item_ids` | `string[]` | Stable item ids in the storyline. |
| `related_item_ids` | `string[]` | Other entity ids directly related to the current item in this storyline context. |
| `parent_storyline_ids` | `string[]` | Optional parent storyline ids for forked narratives. |
| `narrative_type` | `object` | Optional narrative classification metadata. |
| `relationship.decision` | `string` | Relationship classification such as `origin`, `evolution`, or `repetition`. |
| `relationship.explanation` | `string` | Why the classifier assigned that decision. |
| `relationship.prior_appearance_count` | `integer` | Prior appearances before the current one. |
| `relationship.previous_appearance` | `object \| null` | Previous appearance metadata when available. |
| `relationship.signals` | `object` | Storyline classifier metrics such as overlap ratio, novel fact count, novel token ratio, and new source cluster count. |

### `NewsletterEdition`

| Field | Type | Notes |
| --- | --- | --- |
| `edition_id` | `string` | Stable edition identifier. |
| `published_at` | `string` | Edition publication timestamp in UTC. |
| `content_window.starts_at` | `string` | Inclusive lower bound of the covered time window. |
| `content_window.ends_at` | `string` | Inclusive upper bound of the covered time window. |
| `content_window.timezone` | `string` | Scheduling timezone used to resolve the window. |
| `item_count` | `integer` | Always equals `items.length`. |
| `items` | `NewsletterItem[]` | Curated published items. |
| `storyline_count` | `integer` | Always equals `storylines.length`. |
| `storylines` | `NewsletterStoryline[]` | Edition-scoped storyline groups. |

### `NewsletterStoryline`

Returned by `GET /api/newsletter/storylines` and nested inside `NewsletterEdition`.

| Field | Type | Notes |
| --- | --- | --- |
| `storyline_id` | `string` | Stable storyline identifier. |
| `title` | `string` | Storyline title. |
| `status` | `"developing" \| "stable" \| "archived"` | Current lifecycle state. |
| `member_item_ids` | `string[]` | Stable ids of all member entities. |
| `relationship_metadata.fork.parent_storyline_ids` | `string[]` | Parent storyline ids for fork relationships. |
| `relationship_metadata.fork.child_storyline_ids` | `string[]` | Child storyline ids for fork relationships. |
| `relationship_metadata.merge.source_storyline_ids` | `string[]` | Source storylines that were merged. |
| `relationship_metadata.merge.target_storyline_id` | `string \| null` | Optional target storyline after a merge. |
| `parent_storyline_ids` | `string[]` | Optional direct parent storyline ids. |
| `child_storyline_ids` | `string[]` | Optional direct child storyline ids. |
| `merged_storyline_ids` | `string[]` | Optional storyline ids merged into this storyline. |
| `merged_into_storyline_id` | `string` | Optional storyline id this storyline was merged into. |
| `narrative_type` | `object` | Optional narrative classification metadata. |
| `first_seen` | `string` | First time the storyline appeared. |
| `last_seen` | `string` | Most recent item observation in the storyline. |
| `updated_at` | `string` | Last time storyline state changed. |
| `last_evolution_at` | `string` | Most recent non-repetitive evolution event. |
| `evolution_count` | `integer` | Count of evolution events. |
| `repetition_count` | `integer` | Count of repeated events. |
| `repetition_streak` | `integer` | Consecutive repetition counter. |
| `item_count` | `integer` | Always equals `items.length`. |
| `items` | `NewsletterItem[]` | Item snapshots for the active storyline. |

## Endpoint Schemas

### `GET /api/newsletter/latest`

Returns one `NewsletterEdition`.

Notes:

- Only editions whose `published_at` is in the past are eligible.
- Returns `404` if no edition has been published yet.

### `GET /api/newsletter/history`

Returns the rolling archive window.

```json
{
  "archive_window_days": 7,
  "generated_at": "2026-03-12T21:30:00.000Z",
  "editions": []
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `archive_window_days` | `integer` | Rolling archive size in days. |
| `generated_at` | `string` | Response generation timestamp. |
| `editions` | `NewsletterEdition[]` | Published editions in the archive window. |

### `GET /api/newsletter/reference`

Returns persistent items promoted out of the rolling archive.

```json
{
  "archive_window_days": 7,
  "generated_at": "2026-03-12T21:30:00.000Z",
  "item_count": 0,
  "items": []
}
```

Promotion behavior:

- base promotion rule: latest appearance is outside the rolling archive, `edition_count >= 3`, `relevance_score >= 60`, and at least `2` distinct source clusters
- diversity fallback: one aged-out item from an `underrepresented` category may be promoted with `1` corroborating cluster when that category would otherwise be missing
- `/api/newsletter/history` and `/api/newsletter/reference` are intentionally disjoint

### `GET /api/newsletter/item/:id`

Returns the full lifecycle of one stable entity across published editions.

```json
{
  "item_id": "artifact-agent-runtime-core",
  "first_seen": "2026-03-10T20:30:00.000Z",
  "edition_count": 2,
  "first_appearance": {},
  "repeat_appearances": [],
  "score_evolution": [],
  "storyline": null,
  "storyline_membership": [],
  "appearances": []
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `item_id` | `string` | Stable entity id. |
| `first_seen` | `string` | First observed timestamp. |
| `edition_count` | `integer` | Number of published appearances. |
| `first_appearance` | `LifecycleOccurrence` | Summary for appearance number `1`. |
| `repeat_appearances` | `LifecycleOccurrence[]` | Summary entries for appearances `2..n`. |
| `score_evolution` | `LifecycleScoreEvolutionEntry[]` | Per-edition score history for the item. |
| `storyline` | `LifecycleStorylineSummary \| null` | Current normalized storyline summary for the item. |
| `storyline_membership` | `LifecycleStorylineMembershipEntry[]` | Per-edition storyline membership and classifier decision. |
| `appearances` | `LifecycleAppearance[]` | Full edition snapshots containing the nested `NewsletterItem`. |

`LifecycleOccurrence` fields:

- `edition_id`
- `published_at`
- `appearance_number`
- `relevance_score`
- `score_version`
- `divergence_flag`
- `storyline_ids`

`LifecycleScoreEvolutionEntry` fields:

- `edition_id`
- `published_at`
- `relevance_score`
- `score_version`
- `divergence_flag`
- `delta_from_previous`
- `delta_from_first_appearance`

`LifecycleStorylineMembershipEntry` fields:

- `edition_id`
- `published_at`
- `storyline_ids`
- `primary_storyline_id`
- `primary_storyline_title`
- `primary_storyline_status`
- `position`
- `relationship_decision`

`LifecycleAppearance` fields:

- `edition_id`
- `published_at`
- `content_window`
- `item`
- `storyline`

### `GET /api/newsletter/storylines`

Returns active storyline groups.

```json
{
  "generated_at": "2026-03-12T21:30:00.000Z",
  "storyline_count": 0,
  "storylines": []
}
```

### `GET /api/newsletter/scope`

Returns the versioned editorial boundary that determines what the newsletter covers.

```json
{
  "generated_at": "2026-03-12T21:30:00.000Z",
  "current_version": "1.0.1",
  "scope_definition": {},
  "changelog": []
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `generated_at` | `string` | Response generation timestamp. |
| `current_version` | `string` | Active scope definition version. |
| `scope_definition.version` | `string` | Always matches `current_version`. |
| `scope_definition.effective_at` | `string` | When the active scope took effect. |
| `scope_definition.reviewed_at` | `string` | Last review timestamp. |
| `scope_definition.next_review_at` | `string` | Next scheduled review timestamp. |
| `scope_definition.review_cadence` | `"quarterly"` | Review cadence. |
| `scope_definition.audience.primary_subscribers` | `string` | Primary audience description. |
| `scope_definition.audience.secondary_operators` | `string` | Secondary audience description. |
| `scope_definition.definition` | `string` | High-level scope definition. |
| `scope_definition.inclusion_policy` | `object` | Qualification rule, required capabilities, inclusion examples, exclusion examples. |
| `scope_definition.coverage_boundaries` | `object` | `in_scope`, `out_of_scope`, and `decision_rule`. |
| `scope_definition.change_tracking` | `object` | `versioning_scheme`, `update_policy`, and `version_change_rules`. |
| `changelog[]` | `array` | Ordered scope change log entries with `version`, `change_type`, `effective_at`, `summary`, `rationale`, and `scope_changes`. |

### `GET /api/newsletter/coverage-map`

Returns per-category source coverage.

```json
{
  "generated_at": "2026-03-12T21:30:00.000Z",
  "minimum_active_source_count": 2,
  "topic_count": 4,
  "topics": [
    {
      "topic_area": "tool",
      "active_source_count": 2,
      "coverage_status": "covered"
    }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `minimum_active_source_count` | `integer` | Minimum active approved sources required for a category to count as fully covered. |
| `topic_count` | `integer` | Currently equals the number of published categories. |
| `topics[].topic_area` | `"tool" \| "api" \| "library" \| "technique"` | Category being measured. |
| `topics[].active_source_count` | `integer` | Count of active approved sources covering the category. |
| `topics[].coverage_status` | `"covered" \| "underrepresented" \| "uncovered"` | Coverage state for the category. |

### `GET /api/newsletter/exclusions`

Returns grouped exclusion summary statistics.

```json
{
  "archive_window_days": 7,
  "generated_at": "2026-03-12T21:30:00.000Z",
  "filters": {
    "published_from": "2026-03-05T21:30:00.000Z",
    "published_to": "2026-03-12T21:30:00.000Z",
    "reason": null,
    "category": null,
    "source_kind": null,
    "adapter_id": null,
    "item_id": null,
    "phase": null
  },
  "totals": {
    "scanned_edition_count": 0,
    "matched_edition_count": 0,
    "distinct_item_count": 0,
    "total_excluded_items": 0,
    "exclusion_group_count": 0
  },
  "exclusion_summary": {
    "total_excluded_items": 0,
    "counts_by_category": [],
    "counts_by_reason_code": [],
    "counts_by_category_and_reason": []
  }
}
```

### `GET /api/newsletter/exclusions/analytics`

Returns detailed exclusion records plus grouped analytics.

Top-level fields:

- `archive_window_days`
- `generated_at`
- `filters`
- `totals`
- `exclusions`
- `aggregations`
- `recurring_items`
- `blind_spots`

`filters` includes:

- `published_from`
- `published_to`
- `reason_code`
- `category`
- `source_kind`
- `adapter_id`
- `item_id`
- `phase`
- `min_recurring_editions`

`totals` includes:

- `scanned_edition_count`
- `matched_edition_count`
- `exclusion_count`
- `distinct_item_count`
- `recurring_item_count`
- `blind_spot_count`

`exclusions[]` fields:

- `edition_id`
- `published_at`
- `item_id`
- `name`
- `category`
- `reason_code`
- `phase`
- `source_kinds`
- `adapter_ids`
- `source_url`
- `relevance_score`
- `min_relevance_score`
- `score_version`
- `source_authority_score`
- `min_source_authority_score`
- `source_status`
- `source_lifecycle_state`

`aggregations` includes grouped arrays for:

- `reason_codes`
- `categories`
- `phases`
- `source_kinds`
- `adapter_ids`
- `category_reason_codes`
- `editions`

`recurring_items[]` fields:

- `item_id`
- `name`
- `category`
- `exclusion_count`
- `edition_count`
- `reason_codes`
- `first_excluded_at`
- `last_excluded_at`

`blind_spots[]` fields:

- `blind_spot_key`
- `category`
- `reason_code`
- `exclusion_count`
- `edition_count`
- `distinct_item_count`
- `first_excluded_at`
- `last_excluded_at`

### `GET /api/newsletter/exclusions/report`

Returns the entire analytics payload plus:

- `exclusion_summary`
- `edition_summaries`
- `totals.edition_summary_count`

`edition_summaries[]` fields:

- `edition_id`
- `published_at`
- `content_window`
- `published_item_count`
- `matching_distinct_item_count`
- `edition_exclusion_summary`
- `matching_exclusion_summary`

## Query Parameters

Only the exclusion endpoints accept public query parameters.

| Parameter | Type | Applies to | Notes |
| --- | --- | --- | --- |
| `days` | `integer` | `/exclusions`, `/exclusions/analytics`, `/exclusions/report` | Positive integer lookback window. Defaults to the archive window, currently `7`. |
| `from` | `string` | `/exclusions`, `/exclusions/analytics`, `/exclusions/report` | Inclusive UTC lower bound for published editions. |
| `to` | `string` | `/exclusions`, `/exclusions/analytics`, `/exclusions/report` | Inclusive UTC upper bound for published editions. |
| `reason` | `string` | `/exclusions` | Exclusion reason filter. |
| `reason_code` | `string` | `/exclusions`, `/exclusions/analytics`, `/exclusions/report` | Exclusion reason filter. The summary route also accepts this alias. |
| `category` | `"tool" \| "api" \| "library" \| "technique"` | `/exclusions`, `/exclusions/analytics`, `/exclusions/report` | Restrict to one published category. |
| `source_kind` | `"x" \| "github" \| "arxiv" \| "reddit" \| "web"` | `/exclusions`, `/exclusions/analytics`, `/exclusions/report` | Restrict to one source family. |
| `adapter_id` | `string` | `/exclusions`, `/exclusions/analytics`, `/exclusions/report` | Restrict to one adapter id. |
| `item_id` | `string` | `/exclusions`, `/exclusions/analytics`, `/exclusions/report` | Restrict to one stable item id. |
| `phase` | `string` | `/exclusions`, `/exclusions/analytics`, `/exclusions/report` | Restrict to one exclusion phase such as `source`, `scoring`, or `scope`. |
| `min_recurring_editions` | `integer` | `/exclusions`, `/exclusions/analytics`, `/exclusions/report` | Positive integer threshold for recurring-item and blind-spot analytics. Defaults to `2`. |

## Versioning

Versioning is intentionally split by concern.

| Concern | Mechanism | Notes |
| --- | --- | --- |
| HTTP route family | unversioned path family | `/api/newsletter/*` is the canonical route family. There is currently no `/v1` prefix. |
| Shared item schema | semver | The current `NewsletterItem` schema version is `1.1.0`. |
| Relevance formula | `score_version` per item | Use this when comparing scores across editions. |
| Score meaning | `score_interpretation` per item | Tells the consumer how to interpret the score. |
| Editorial boundary | `scope_version` per item and `/api/newsletter/scope` | Same stable `item_id` can appear under different scope versions over time. |

Consumer rules:

1. Persist `edition_id`, `item_id`, `score_version`, and `scope_version` together.
2. Treat `item_id` as stable identity for the entity, not for one URL.
3. Do not assume score comparability across different `score_version` values.
4. If scope-sensitive behavior matters, read `/api/newsletter/scope` before acting.

## Rate Limiting And Errors

Default deployment settings:

- `60` requests per IP
- `60` second window

Headers emitted on successful and rate-limited responses:

- `ratelimit-limit`
- `ratelimit-remaining`
- `ratelimit-reset`
- `ratelimit-policy`
- `x-ratelimit-limit`
- `x-ratelimit-remaining`
- `x-ratelimit-reset`
- `x-ratelimit-policy`

The `429` response also includes `retry-after`.

Common error responses:

| Status | Body |
| --- | --- |
| `404` | `{ "error": "not_found", "message": "No published newsletter edition is available." }` |
| `404` | `{ "error": "not_found", "message": "No published newsletter item is available for the requested id." }` |
| `404` | `{ "error": "not_found", "message": "Route not found." }` |
| `405` | `{ "error": "method_not_allowed", "message": "Use GET /api/newsletter/<route>." }` |
| `429` | `{ "error": "rate_limited", "message": "Too many requests from this IP. Try again later.", "retry_after_seconds": 60 }` |
| `500` | `{ "error": "internal_server_error", "message": "<error message>" }` |

## Agent Consumption Expectations

The API is intentionally pull-based. There is no registration, no auth handshake, and no webhook delivery.

Recommended agent behavior:

1. Poll `/api/newsletter/latest` shortly after the daily publish slot.
2. If the route returns `404` because nothing is published yet, retry on your own backoff schedule.
3. Persist the full item snapshot together with `edition_id`, `item_id`, `score_version`, and `scope_version`.
4. If one or more polls were missed, replay `/api/newsletter/history` from oldest to newest before resuming `/api/newsletter/latest`.
5. Use `/api/newsletter/item/:id` when the same entity reappears and you need cross-edition continuity, score deltas, or storyline history.
6. Use `/api/newsletter/reference` for durable items that have aged out of the rolling archive but remain important.
7. Use `/api/newsletter/storylines` when you need developing narrative context instead of isolated item mentions.
8. Use `/api/newsletter/scope` before autonomous integration decisions when editorial boundary or audience fit matters to your policy.
9. Treat `risk_warning` as mandatory operational input. A high relevance score is not approval to auto-integrate without sandboxing, security review, maturity validation, and rollout controls.
10. Respect rate-limit headers and `retry-after`. Open access does not mean unlimited throughput.

## Example Requests

Poll the latest edition:

```bash
curl -s \
  -H 'Accept: application/json' \
  -H 'User-Agent: agent-runtime/1.4' \
  -H 'X-Agent-Consumer-Id: agent-runtime-prod' \
  http://localhost:3000/api/newsletter/latest
```

Backfill the archive:

```bash
curl -s http://localhost:3000/api/newsletter/history
```

Inspect one stable entity:

```bash
curl -s http://localhost:3000/api/newsletter/item/artifact-agent-runtime-core
```

Inspect recurring exclusion patterns:

```bash
curl -s \
  "http://localhost:3000/api/newsletter/exclusions/analytics?category=library&reason_code=relevance_below_threshold&source_kind=github&phase=scoring"
```

## Implementation Notes

If you are consuming this API from code inside this repository, the machine contract is also available as exports:

- `NEWSLETTER_ITEM_RESPONSE_SCHEMA`
- `NEWSLETTER_ITEM_RESPONSE_SCHEMA_VERSION`
- `NEWSLETTER_ITEM_API_RESPONSE_FIELDS`

Those exports are intended for internal validation and contract tests. External HTTP consumers should rely on the JSON API described above.
