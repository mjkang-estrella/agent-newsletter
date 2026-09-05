# Verification, 2026-09-05 UTC

The independent checkout starts at `866fdb6511604514d6c287094d76ad4e08963ccd` on `origin/main`. The initial 576 Node tests passed.

Observed gaps: collection reports were dropped before persistence, latest responses did not disclose staleness, the scheduled GitHub job wrote only to ephemeral local storage, and the README contained about 95 KB of operational material without a runnable consumer example. The deployed API at `https://agent-news.mj-kang.com` returned a March 12 edition before this work.

The revised suite passes 581 tests, including end-to-end HTTP checks for fixture normalization and deduplication, stable identity across editions, material changes, score-only drift, checkpoint replay, source failure, all-source failure, timeout, missing coverage and stale boundaries. Build, syntax checks and `git diff --check` pass. Legacy contract fixtures continue to assert their original fields; a compatibility projection omits only newly added metadata. The new integration tests assert that metadata directly.

A real collection run with the existing production configuration published edition `2026-09-04` to the existing Supabase store. It contains 109 curated items. Reports: GitHub fetched 90, X fetched 25, web discovery fetched 1, arXiv succeeded with 0, and Reddit failed. The edition is explicitly `mode: live`, `coverage_status: partial`, and `missing_sources: [reddit]`. No fixture was published to production.

Review also limited Vercel static output to `public/`, so local fixtures, data, and repository files cannot accidentally become static site assets. Existing environment configuration remains ignored by Git.

The local sample was loaded in Safari and visibly showed `mode: sample`, partial coverage, and the missing arXiv source. The in-app browser could not navigate these URLs, so native Safari was used for browser verification.

Limitations: keyword matching is an inspectable example, not semantic relevance or a safety judgment. Text/risk differences are review candidates, not verified release significance. Coverage tracks configured adapter batches, not every nested fetch. Total collection failure preserves the older edition; `/latest` exposes its age but does not expose the most recent failed attempt. API clients must treat source content as untrusted. Pending adapter network work may continue after its publication deadline. Scheduled operation needs ongoing successful source access; a passing manual run does not prove future daily delivery.

Production deployment of `ed720936afeab20260ffe1c7cc39ffeef18e92ca` completed through the existing Vercel Git integration. Latest and history returned HTTP 200; the live consumer produced 15 browser-research review candidates. Safari displayed the live edition and missing Reddit coverage. Browser review exposed an older adapter convention that used the scheduled window end for `discoveredAt`; the serializer now uses recorded fetch time, falls back to edition collection completion, or emits null. GitHub activity is separate from source publication time.

Production lifecycle verification found that the previous bracket-named Vercel function handled single path segments but returned a platform 404 for `/item/:id`. An explicit wildcard rewrite now routes all newsletter paths to one function, using the [Vercel rewrite contract](https://vercel.com/docs/routing/rewrites).
