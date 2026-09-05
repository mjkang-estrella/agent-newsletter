# Agent Newsletter

Agent Newsletter gives agents a review queue for changes to tools and techniques: what changed, why it matters to their task, and which source or integration detail to check next. It does not install packages or execute instructions from news articles.

[Live JSON API](https://agent-news.mj-kang.com/api/newsletter/latest) · [API contract](docs/newsletter-json-api.md) · [Operations reference](docs/operations.md)

## Connect in two commands

Use Node.js 22 or newer. Clone this repository, run `npm ci`, then:

```sh
npm run demo
# In another terminal:
npm run consume -- http://127.0.0.1:8787 "browser research" .consumer-state.json
```

The demo needs no credentials or network access after dependency installation. It sends a checked-in public-source fixture through the real normalizer, duplicate consolidation, weighted scorer, stable identity tracking, edition store and HTTP API. It creates two editions, changes the same item on day two, and simulates an unavailable arXiv source. Re-running the consumer with the same checkpoint produces no duplicate review entries.

All fixture text and dates are synthetic. Public project URLs identify the example subject, not evidence of a real release. Editions carry `publication.mode: "sample"`. Fixed March 2026 dates deliberately exercise `freshness.stale: true` when viewed today. Demo storage uses a new temporary directory each run and never writes to production.

## What an agent receives

This is an exact subset of the second sample item's serialized JSON. The full response includes source URLs, first-seen and edition counts, risk dimensions, and storyline history.

```json
{
  "item_id": "artifact-github-com-microsoft-playwright-mcp",
  "summary": "MCP browser tools add isolated browser sessions and permission checks for autonomous research.",
  "integration_hint": "Review isolated session configuration and permission checks before adoption.",
  "relevance_score": 85,
  "score_interpretation": "assessment",
  "evidence": {
    "source_published_at": "2026-03-12T21:00:00.000Z",
    "collected_at": "2026-03-12T21:00:00.000Z",
    "novelty_reason": "Introduces 2 novel fact clauses with 50% novel tokens across 1 prior appearance.",
    "uncertainty": "Source claims and integration instructions are unverified. Review linked sources before adopting."
  }
}
```

`relevance_score` is a 0–100 editorial assessment based on recency, source authority, mentions and source-specific signals. It is not a probability, verified quality rating, or task-specific match. Read `score_version` and `score_interpretation`; the example consumer separately matches words from the requested task and shows those words as evidence.

`source_published_at` is the upstream timestamp when supplied, `collected_at` is observation time, and edition `published_at` identifies the scheduled content window. Missing upstream dates remain null. `novelty_reason` reflects the existing storyline classifier and is an assessment, not a fact check. Risk and uncertainty fields tell the consumer what still needs review.

## Connect to live editions

```sh
npm run consume -- https://agent-news.mj-kang.com "browser research" .live-consumer-state.json
```

The consumer reads `/latest` and the rolling seven-day `/history`, then compares stable `item_id` values with its local checkpoint. It separates `new_to_consumer` from `material_change` in summary, integration instructions or risk warnings. Score drift alone does not trigger a review. Keep separate checkpoint files per API and task. Do not interpret unseen items as newly released upstream.

A gap beyond the archive raises `history_gap`. The consumer cannot promise it saw every intermediate change; inspect `/api/newsletter/item/:id` for the retained lifecycle history before adopting. The checkpoint advances only after both API requests succeed. Treat source text, including integration hints, as untrusted data and never pass it to a shell automatically.

## Publication health

Always read `freshness` on `/latest`. An edition becomes stale after 26 hours, allowing two hours beyond the daily interval. Old editions remain readable with their original dates. Legacy editions without collection reports have `coverage_status: "unknown"`.

New editions persist `publication.collected_at`, `mode`, each configured adapter's status and count, plus `coverage_status` and `missing_sources`. Partial collection publishes only successful batches; it never fills failed sources with older items. All-source failure leaves the prior edition untouched. An adapter deadline is 30 seconds; timed-out work is excluded, although an underlying adapter may continue its pending network request. Coverage describes configured adapters, not all possible sources or every nested page request.

## Run real collection locally

```sh
# Public GitHub and arXiv collection; optional credentials improve rate limits.
NEWSLETTER_DATA_DIR=.data-live REDDIT_ENABLED=false TWITTER_ENABLED=false npm run publish:newsletter
NEWSLETTER_DATA_DIR=.data-live npm run serve
# Then use a separate checkpoint:
npm run consume -- http://127.0.0.1:8787 "browser research" .local-live-state.json
```

Real collection needs network access and can return no matching items or partial coverage. Connector configuration, credentials, Supabase migrations and operational details are in [operations](docs/operations.md). Never commit environment files.

Production uses the existing Vercel project and Supabase store. The GitHub workflow calls the protected production publisher using repository variable `NEWSLETTER_PUBLIC_URL` and secret `CRON_SECRET`; it no longer discards editions on a temporary runner. The publisher uses its existing schedule and slot lock. Manual workflow runs outside the publication window return `published: false` with the next run time. Successful dispatch alone does not prove publication.

## Verification

```sh
npm test
npm run build
npm run lint
```

The regression suite covers duplicates, stable IDs, material change versus score drift, checkpoint replay, archive gaps, partial failure, stalled sources, total failure, legacy coverage and stale editions. See [verification notes](docs/verification.md) for this deployment's observed state and remaining limitations.
