# Agent Newsletter

## Project Overview

Agent Newsletter is a machine-consumable daily digest for autonomous AI agents. The pipeline gathers agent-related tools, APIs, libraries, and techniques from sources such as GitHub, arXiv, Reddit, and optionally X/Twitter, curates and scores the results, publishes one edition per day at `21:00` in the configured base timezone, and exposes the latest edition, a rolling 7-day archive, and stable per-item lifecycle history over JSON.

Detailed API contract for consuming agents: [`docs/newsletter-json-api.md`](./docs/newsletter-json-api.md)

Short subscription handoff for agent consumers: [`docs/agent-subscription-instructions.md`](./docs/agent-subscription-instructions.md)

At a high level, the project does four things:

- Fetches AI-agent-related items from configured upstream sources.
- Scores, filters, and deduplicates the aggregated content.
- Publishes one edition per day for the prior 24-hour window.
- Serves the latest edition, recent history, and item lifecycle views through a JSON API that other agents can consume.

Each newsletter item is serialized with the shared, versioned machine-facing
contract defined in `src/newsletter/item-response-schema.js`. The emitted item
payload includes `item_id`, `name`, `source_urls`, `category`, `summary`,
`integration_hint`, `relevance_score`, `score_version`,
`score_interpretation`, `divergence_flag`, `risk_warning { security,
maturity, adoption_complexity }`, `mention_count`, `sentiment_spread`,
`first_seen`, `edition_count`, `storyline_ids`, and `scope_version`.

## Editorial Policy: What Counts As An AI Agent

Policy version: `1.0.1`

Standalone policy document: [`docs/content-inclusion-policy.md`](./docs/content-inclusion-policy.md)

This scope definition is reviewed quarterly and applies to every editorial inclusion decision in the newsletter pipeline. The checked-in machine-readable source of truth lives in `src/newsletter/scope-definition.document.json`, and `/api/newsletter/scope` returns the current scope definition plus a changelog of versioned boundary updates.

For this project, an "AI agent" is software that autonomously pursues a goal by deciding what to do next, using tools or external systems, and acting over multiple steps with limited human intervention. The bar is intentionally higher than "uses an LLM."

Editorial decision rule:

- Include an item only when the underlying project, paper, framework, API, or technique materially helps software that can plan, choose actions, use tools, and execute toward a goal with limited human intervention.
- Exclude an item when the primary use case is chat, single-turn generation, fixed automation, or human-only productivity rather than autonomous action.

We include content when it is about:

- Software that accepts a goal, plans or adapts its next action, and executes work without requiring a human prompt for every step.
- Systems that use tools such as APIs, browsers, shells, files, databases, or code execution as part of goal-directed behavior.
- Agent infrastructure that directly improves autonomous behavior, such as planning, memory, tool-use, evaluation, verification, orchestration, or multi-agent coordination.
- Tools, APIs, libraries, and techniques that a subscribing agent could realistically adopt to expand or harden its own capabilities.

We exclude content when it is about:

- Plain chatbots or assistants that answer questions but do not take actions on the world beyond returning text.
- Single-shot LLM wrappers that call a model once and return a response without planning, tool use, or multi-step execution.
- Static automation scripts, fixed workflows, or deterministic DAGs that do not choose actions dynamically at runtime.
- Generic AI news, model releases, or prompt-writing advice that is not specifically relevant to autonomous, tool-using systems.
- Human-only productivity tools unless the agent integration surface is primary and explicit.

When a candidate sits near the boundary, the deciding question is: can a deployed system use this to autonomously decide and execute its next step toward a goal?

### Edge-Case Guidance

- Human-in-the-loop systems are included only when the agent can still plan and execute most of the workflow autonomously, with the human acting as an exception handler or approval gate for sensitive actions.
- Products that support both chat and agent workflows are included only when the agentic capability is first-class, documented, and operationally real rather than marketing language on top of a chatbot.
- Workflow tools are excluded when they only run predeclared steps, even if one step calls an LLM. They are included when runtime behavior can branch, recover, select tools, or revise plans based on state.
- Research papers are included when they advance agent planning, tool use, memory, evaluation, orchestration, verification, or autonomy. Generic model papers without a direct agent implication are excluded.
- Infrastructure and developer tools are included when they clearly increase what an autonomous agent can safely or effectively do, such as browser control, sandboxes, tool protocols, memory systems, evaluators, or execution runtimes.
- If the strongest claim for inclusion is "people building agents might find this interesting," exclude it. If the stronger claim is "a deployed agent could directly use or integrate this," include it.

### Boundary Examples

| Example | Include? | Why |
| --- | --- | --- |
| A browser agent that plans a research task, opens pages, extracts facts, and retries on failure | Yes | It is autonomous, tool-using, and goal-directed across multiple steps. |
| A coding assistant that only suggests code in chat and waits for the human to apply changes | No | It helps a human, but it does not act autonomously. |
| A fixed Zapier or cron workflow with one LLM classification step | No | It is automation, not agentic planning or adaptive execution. |
| A support system that can decide whether to search docs, call an API, open a ticket, or ask a follow-up | Yes | It selects tools and executes actions in pursuit of a goal. |
| An MCP server, browser-control library, or sandbox runner intended for agent tool use | Yes | It is a direct capability enabler for autonomous agents. |
| A prompt pack for getting better chatbot answers | No | It does not add autonomous planning, tool use, or execution. |
| A workflow engine with a planner that can choose tools, branch dynamically, and recover from failures | Yes | The runtime behavior is adaptive and agentic, not just scripted. |

## Production Deployment: Vercel + Supabase

The repository now supports a production deployment model where Vercel serves the API and Supabase stores all durable state. The public reader contract stays the same at `/api/newsletter/*`, while publication is triggered through a protected internal endpoint at `POST /api/internal/publish`.

Production topology:

- Vercel Node functions serve `GET /api/newsletter/latest`, `/history`, `/reference`, `/item/:id`, `/storylines`, `/scope`, `/coverage-map`, `/exclusions`, `/exclusions/analytics`, and `/exclusions/report`.
- Vercel Node functions also serve `POST /api/internal/publish`, protected by `Authorization: Bearer ${CRON_SECRET}`.
- Supabase Postgres stores published editions, runtime state, publication-run locks, shared rate-limit counters, and append-only consumer telemetry.
- Supabase Cron should call the internal publish endpoint once per hour. The application still decides whether the current request is inside the daily `21:00` publication window.

Supabase schema:

- Run [`supabase/migrations/20260313000000_newsletter_runtime.sql`](./supabase/migrations/20260313000000_newsletter_runtime.sql) before the first production deploy.
- The migration creates `newsletter_editions`, `newsletter_runtime_state`, `newsletter_publication_runs`, `newsletter_rate_limits`, `newsletter_consumer_events`, and the `consume_newsletter_rate_limit(...)` SQL function.

Required production environment variables:

| Variable | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL. |
| `SUPABASE_SECRET_KEY` | Yes, preferred | Preferred server-side key for Vercel. |
| `SUPABASE_SERVICE_ROLE_KEY` | Fallback only | Used only when `SUPABASE_SECRET_KEY` is not set. |
| `CRON_SECRET` | Yes | Shared bearer token for `POST /api/internal/publish`. |
| `NEWSLETTER_BASE_TIMEZONE` | Recommended | Defaults to `UTC`. Controls the daily `21:00` publication slot. |
| `ARXIV_USER_AGENT` | Yes | Use a deployment-specific value. |
| `REDDIT_USER_AGENT` | Yes | Use a deployment-specific value. |
| `TWITTER_BEARER_TOKEN` | Yes for X/Twitter ingest | The Supabase runtime enables X/Twitter by default. |
| `GITHUB_TOKEN` | Strongly recommended | Raises GitHub API limits. |

Production notes:

- `TWITTER_ENABLED` is forced on in the Supabase production runtime, so provide a real `TWITTER_BEARER_TOKEN` or disable the adapter in code before deploying.
- `NEWSLETTER_DATA_DIR` is only relevant for the original local file-backed runtime. The Vercel + Supabase deployment path does not use local state files.
- The reader API stays unauthenticated. Only `POST /api/internal/publish` is protected.
- The Vercel handlers use the Node runtime explicitly and do not rely on Edge functions.

Suggested deployment sequence:

1. Apply the Supabase migration.
2. Set the required environment variables in Vercel.
3. Deploy the repository to Vercel.
4. Create a Supabase Cron job that sends an hourly `POST` request to `https://<your-domain>/api/internal/publish` with `Authorization: Bearer ${CRON_SECRET}`.
5. Verify `GET /api/newsletter/latest` after the first successful publish.

## Setup And Local Development

### Prerequisites

- Node.js 20 LTS or newer.
- `npm`.
- Outbound network access for the upstream sources you want to enable.
- A writable local directory for published editions and any other local state you choose to persist.
- Optional upstream credentials if you want higher API limits.

The code reads `process.env` directly. It does not load `.env` files for you, so export variables in your shell or use your own env loader.

### Configuration Summary

- `NEWSLETTER_BASE_TIMEZONE` controls the daily publish slot. The default is `UTC`, which means the edition publishes at `21:00 UTC` unless you override the timezone at deployment.
- `NEWSLETTER_DATA_DIR` controls where editions and local state are stored. By default the runtime writes editions to `.data/editions`, source discovery state to `.data/source-registry.json`, stable item identity state to `.data/item-identity-registry.json`, and consumer telemetry plus per-consumer rate-limit audit data to `.data/consumer-identities.json`.
- `npm run publish:newsletter` runs the full pipeline immediately. `npm run publish:newsletter:scheduled` runs the same pipeline but only publishes inside the configured daily schedule window. `npm run start:publication-scheduler` keeps one Node worker alive and schedules the next run in-process.
- The API process should point at the same `NEWSLETTER_DATA_DIR` as the publication worker so `/api/newsletter/latest`, `/api/newsletter/history`, `/api/newsletter/reference`, `/api/newsletter/storylines`, and `/api/newsletter/item/:id` all read the published editions and persistent state.

### Runtime State Layout

The publisher and API create their runtime directories and JSON files on first write. With the default `NEWSLETTER_DATA_DIR=.data`, the runtime layout is:

| Path | Created by | Purpose |
| --- | --- | --- |
| `.data/editions/*.json` | `NewsletterEditionStore.publish()` | Published daily editions that back `/api/newsletter/latest`, `/api/newsletter/history`, `/api/newsletter/reference`, `/api/newsletter/storylines`, `/api/newsletter/exclusions`, and `/api/newsletter/item/:id`. |
| `.data/source-registry.json` | `SourceRepository.save()` | Seed and discovered-source state, including probation, promotion, retirement, and coverage metadata. |
| `.data/item-identity-registry.json` | `ItemIdentityRepository.recordEdition()` | Stable `item_id` tracking, cross-edition appearance history, and canonical identity hints. |
| `.data/consumer-identities.json` | API consumer tracking | Per-consumer request telemetry and IP-linked activity for the open API. |

### Daily Workflow At A Glance

Every successful edition run follows the same sequence, whether it is triggered manually, by cron, by the built-in scheduler, or by GitHub Actions:

1. Resolve the current publication slot at `21:00` in `NEWSLETTER_BASE_TIMEZONE` and derive the prior 24-hour content window.
2. Fetch from the enabled adapters for GitHub, arXiv, Reddit, optional X/Twitter, and approved discovered web sources.
3. Apply source-authority thresholds, deduplication, stable item identity tracking, scoring, exclusion tracking, and storyline updates.
4. Persist the published edition plus source-registry and item-identity state under `NEWSLETTER_DATA_DIR`.
5. Serve the resulting edition and historical state from the API process that points at the same `NEWSLETTER_DATA_DIR`.

### Operator Runbook

If you only need the fastest path from clone to a locally published edition, use this sequence:

1. Install dependencies with `npm install`.
2. Export the minimum recommended environment variables shown below.
3. Validate the install with `npm test`.
4. Publish one edition immediately with `npm run publish:newsletter`.
5. Inspect the generated JSON in `NEWSLETTER_DATA_DIR/editions`.
6. Start the local API bootstrap example in this README if you want to query `/api/newsletter/latest` over HTTP.
7. Run `npm run publish:newsletter:scheduled` if you want to verify the guarded `21:00` publish flow without starting a long-lived process.
8. Run `npm run start:publication-scheduler` only when you want a long-lived local worker that keeps publishing at the daily `21:00` slot.

### Quick Start

From the repository root, install dependencies, export a minimal local configuration, validate the install, and publish one edition:

```bash
npm install

export NEWSLETTER_BASE_TIMEZONE=UTC
export NEWSLETTER_DATA_DIR=.data
export ARXIV_USER_AGENT='agent-newsletter-local/0.1 (+https://example.com)'
export REDDIT_USER_AGENT='agent-newsletter-local/0.1 (+https://example.com)'
export GITHUB_TOKEN=your_github_token
export TWITTER_ENABLED=false

npm test
npm run publish:newsletter
ls -1 "${NEWSLETTER_DATA_DIR:-.data}/editions"
```

That single `publish:newsletter` command is the supported local path for the full pipeline. It runs news ingestion, curation, deduplication, scoring, source discovery, and edition publication for the previous 24-hour window in the configured timezone. After it succeeds, use the API bootstrap example in this section if you want to verify the same published edition over HTTP.

If you want to exercise the scheduled publish guard locally, run `npm run publish:newsletter:scheduled`. That command only publishes when the current time is inside the configured `21:00` schedule window unless `NEWSLETTER_FORCE_PUBLICATION=true` is set.

### Local API Smoke Test

After the first successful publish, start the built-in HTTP server bootstrap against the same `NEWSLETTER_DATA_DIR` and verify the machine-facing endpoints end to end:

```bash
PORT=3000 node --input-type=module <<'EOF'
import {
  createDefaultNewsletterApiServer,
} from "./src/index.js";

const server = createDefaultNewsletterApiServer({
  env: process.env,
  cwd: process.cwd(),
});
const port = Number(process.env.PORT ?? 3000);

server.listen(port, () => {
  console.log(`Newsletter API listening on http://127.0.0.1:${port}`);
});
EOF
```

In another shell:

```bash
curl http://127.0.0.1:${PORT:-3000}/api/newsletter/latest
curl http://127.0.0.1:${PORT:-3000}/api/newsletter/history
curl http://127.0.0.1:${PORT:-3000}/api/newsletter/scope
```

Those requests confirm that the API can read the edition files produced by `npm run publish:newsletter` and that the local data-directory wiring is correct.

### Recommended Local Environment Variables

No environment variables are strictly required to install dependencies or run the test suite. For a predictable local publication run, use the following minimum configuration:

| Variable | Required for local publish | Notes |
| --- | --- | --- |
| `NEWSLETTER_BASE_TIMEZONE` | No | Defaults to `UTC`. Set this when you want the daily `21:00` publication slot resolved in another IANA timezone. |
| `NEWSLETTER_DATA_DIR` | Recommended | Directory for generated editions, source-registry state, and item-identity state. Defaults to `.data`. |
| `ARXIV_USER_AGENT` | Recommended | Use a deployment-specific user agent instead of the built-in placeholder value when calling arXiv. |
| `REDDIT_USER_AGENT` | Recommended | Use a deployment-specific user agent instead of the built-in placeholder value when calling Reddit. |
| `GITHUB_TOKEN` | Recommended | Raises GitHub API limits for the GitHub source adapter. |
| `TWITTER_ENABLED` | Recommended | Defaults to `false`. Set it to `true` when you have either a real bearer token for the built-in API v2 client or a custom provider client attached. |

### Optional Environment Variables

The runtime also supports the following optional variables for custom task wiring, storage paths, API behavior, and source tuning:

| Variable | Required | Notes |
| --- | --- | --- |
| `NEWSLETTER_PUBLICATION_TASK_MODULE` | No | Relative or absolute path to a custom module that exports the publication task. Defaults to the built-in scheduler target at `src/newsletter/default-publication-task.js`. |
| `NEWSLETTER_PUBLICATION_TASK_EXPORT` | No | Export name inside the task module. Defaults to `publishNewsletterEdition`. |
| `NEWSLETTER_BASE_TIMEZONE` | No | IANA timezone used to resolve the daily `21:00` publication slot. Defaults to `UTC`. |
| `NEWSLETTER_DATA_DIR` | No | Base directory used for runtime state. Defaults to `.data`, with editions persisted to `.data/editions`, discovered sources persisted to `.data/source-registry.json`, stable item identities persisted to `.data/item-identity-registry.json`, and consumer telemetry persisted to `.data/consumer-identities.json`. |
| `NEWSLETTER_PUBLICATION_GRACE_MINUTES` | No | Defaults to `20`. Used by `npm run publish:newsletter:scheduled` to decide whether the current time is close enough to the daily `21:00` slot to publish. |
| `NEWSLETTER_FORCE_PUBLICATION` | No | Defaults to `false`. Set to `true` to bypass the schedule-window guard when running `npm run publish:newsletter:scheduled` manually. |
| `PORT` | No | Only used by the local API bootstrap example in this README. Defaults to `3000`. |
| `NEWSLETTER_API_RATE_LIMIT_MAX_REQUESTS` | No | Overrides the default per-IP API limit of `60` requests per window. |
| `NEWSLETTER_API_RATE_LIMIT_WINDOW_MS` | No | Overrides the default API rate-limit window of `60000` milliseconds. |
| `NEWSLETTER_API_RATE_LIMIT_TRUST_PROXY` | No | Set to `true` when the API is behind a trusted proxy and should resolve client IPs from `X-Forwarded-For` / `Forwarded` headers instead of the socket address. |
| `ARXIV_ENABLED` | No | Defaults to `true`. Disable it if you do not want arXiv papers in the daily ingest. |
| `ARXIV_BASE_URL` | No | Overrides the arXiv API endpoint. Defaults to `https://export.arxiv.org/api/query`. |
| `GITHUB_ENABLED` | No | Defaults to `true`. Disable it if you do not want GitHub repositories in the daily ingest. |
| `ARXIV_USER_AGENT` | No, but recommended for local runs | Overrides the default arXiv user agent with a deployment-specific value. |
| `ARXIV_QUERY` | No | Overrides the default arXiv search query built from agent-related categories and terms. |
| `ARXIV_MAX_RESULTS` | No | Overrides the total arXiv fetch cap. Defaults to `25`. |
| `GITHUB_TOKEN` | No, but recommended for local runs | Raises GitHub API limits for the GitHub source adapter. |
| `GITHUB_API_BASE_URL` | No | Overrides the GitHub REST API base URL. Defaults to `https://api.github.com`. |
| `GITHUB_WEB_BASE_URL` | No | Overrides the GitHub web base URL used for trending-page fetches. Defaults to `https://github.com`. |
| `GITHUB_USER_AGENT` | No | Overrides the GitHub user agent. Use a deployment-specific value in production. |
| `GITHUB_INCLUDE_TRENDING` | No | Defaults to `true`, so the GitHub adapter queries both the repositories search API and the public trending page. Set it to `false` to keep ingest on the official repositories API only. |
| `GITHUB_SEARCH_TERMS` | No | Comma-separated override for repository search terms. Defaults to `"ai agent","llm agent",agentic,"autonomous agent","multi-agent"`. |
| `GITHUB_TRENDING_SINCE` | No | Overrides the GitHub trending window. Defaults to `daily`. |
| `GITHUB_SEARCH_LIMIT` | No | Overrides the GitHub repository-search result cap. Defaults to `20`. |
| `GITHUB_RATE_LIMIT_MAX_RETRIES` | No | Caps GitHub retry attempts after upstream throttling. Defaults to `0`. |
| `GITHUB_RATE_LIMIT_RETRY_AFTER_MS` | No | Fallback backoff for GitHub throttling when a retry header is absent. Defaults to `60000`. |
| `REDDIT_ENABLED` | No | Defaults to `true`. Disable it if you do not want Reddit posts in the daily ingest. |
| `REDDIT_USER_AGENT` | No, but recommended for local runs | Overrides the default Reddit user agent with a deployment-specific value. |
| `REDDIT_SUBREDDITS` | No | Comma-separated override for tracked subreddits. Defaults to `AutoGPT,LangChain,LocalLLaMA,OpenAI,singularity`. |
| `REDDIT_BASE_URL` | No | Overrides the Reddit base URL. Defaults to `https://www.reddit.com`. |
| `REDDIT_ACCESS_TOKEN` | No | Optional Reddit bearer token if your deployment uses authenticated Reddit requests. |
| `REDDIT_RATE_LIMIT_MAX_RETRIES` | No | Caps Reddit retry attempts after upstream throttling. Defaults to `0`. |
| `REDDIT_RATE_LIMIT_RETRY_AFTER_MS` | No | Fallback backoff for Reddit throttling when `Retry-After` is absent. Defaults to `60000`. |
| `TWITTER_ENABLED` | No | Defaults to `false`. Enable it when you want the built-in X API v2 client to run with a bearer token, or when you inject a custom provider client. |
| `TWITTER_PROVIDER` | No | Defaults to `twitter-api-v2`. Used by the X adapter's provider-client contract and request planning. |
| `TWITTER_BASE_URL` | No | Overrides the X API base URL. Defaults to `https://api.x.com/2`. |
| `TWITTER_QUERY` | No | Overrides the default recent-search query for AI agent content. |
| `TWITTER_MAX_RESULTS` | No | Overrides the per-request recent-search batch size. Defaults to `25`. |
| `TWITTER_ACCOUNT_ID` | No | Optional provider-specific account identifier for custom X/Twitter integrations. |
| `TWITTER_RATE_LIMIT_MAX_RETRIES` | No | Defaults to `0`. Caps how many times the built-in X API v2 client retries a `429` before surfacing the upstream failure. |
| `TWITTER_RATE_LIMIT_RETRY_AFTER_MS` | No | Defaults to `60000`. Fallback backoff used when X omits a `Retry-After` header or a rate-limit hook does not override the delay. |
| `TWITTER_BEARER_TOKEN` or `TWITTER_API_KEY` + `TWITTER_API_SECRET` | Only if X execution is enabled | `TWITTER_BEARER_TOKEN` is enough for the built-in API v2 client. `TWITTER_API_KEY` + `TWITTER_API_SECRET` are accepted for custom provider-client integrations. Placeholder values are treated as missing config. |

The table above covers the env surface currently wired in the scheduler, API, and source-adapter factory. If you deploy the API and publisher separately, export the same `NEWSLETTER_DATA_DIR` to both processes so they share the same editions, source registry, and item-identity state.

The X adapter now supports two execution modes. The default `twitter-api-v2` provider can execute recent-search requests directly when a real `TWITTER_BEARER_TOKEN` is available. If you need a different provider, signed auth flow, or enterprise integration, keep the aggregator wiring unchanged and attach a custom execution client either by passing `client` or `clientFactory` into `new TwitterSourceAdapter(...)`, or by calling `createSourceAdapters(process.env, { twitterClient })` / `createSourceAdapters(process.env, { twitterClientFactory })`. Provider clients receive a request context shaped as `{ interfaceVersion, adapterId, adapterName, provider, auth, rateLimit, requestPlan, providerContract? }` and can return either a legacy array of source records or `{ records, cursor }`. The default runtime client also accepts `providerHooks` with `buildAuthHeaders`, `beforeRequest`, `afterResponse`, and `onRateLimit` callbacks, so a deployment can bolt on custom signing and upstream throttling behavior without changing the fetcher core. Non-default providers without an attached client still return a redacted request plan and raise a not-implemented error.

### Installation Steps

1. Install dependencies:

   ```bash
   npm install
   ```

2. Export the minimum recommended local configuration. This keeps the local pipeline on the currently runnable arXiv, GitHub, and Reddit adapters:

   ```bash
   export NEWSLETTER_BASE_TIMEZONE=UTC
   export NEWSLETTER_DATA_DIR=.data
   export ARXIV_USER_AGENT='agent-newsletter-local/0.1 (+https://example.com)'
   export GITHUB_TOKEN=your_github_token
   export REDDIT_USER_AGENT='agent-newsletter-local/0.1 (+https://example.com)'
   export TWITTER_ENABLED=false
   ```

3. Run the automated tests to validate the install:

   ```bash
   npm test
   ```

4. Publish one edition immediately to validate the runtime wiring:

   ```bash
   npm run publish:newsletter
   ```

   This executes the full local pipeline in one pass:
   - ingest from the enabled source adapters
   - curate with source-authority checks, dedupe, and relevance scoring
   - publish a single edition into `NEWSLETTER_DATA_DIR/editions`
   - update discovered-source state in `NEWSLETTER_DATA_DIR/source-registry.json`
   - update stable item identity state in `NEWSLETTER_DATA_DIR/item-identity-registry.json`
   - persist API consumer telemetry in `NEWSLETTER_DATA_DIR/consumer-identities.json` when the API process is running

5. Start the scheduler for the built-in daily task:

   ```bash
   npm run start:publication-scheduler
   ```

   Use this when you want the same publish pipeline to keep running once per day at `21:00` in `NEWSLETTER_BASE_TIMEZONE`.

6. Optionally verify the guarded scheduled publish entrypoint that deployment schedulers use:

   ```bash
   npm run publish:newsletter:scheduled
   ```

   Use this when you want a schedule-window guard around a coarse or jittery external scheduler. It publishes only when the current time lands inside the configured `21:00` schedule window, unless you explicitly set `NEWSLETTER_FORCE_PUBLICATION=true`.

### Local Development Commands

Use the following commands during development from the repository root:

| Command | When to use it |
| --- | --- |
| `npm install` | Install or update project dependencies. |
| `npm run discover:sources` | Refresh the discovered-source registry and future fetch schedule without publishing an edition. |
| `npm test` | Run the Node test suite and validate the pipeline, scheduler, API, and scoring behavior. |
| `npm run publish:newsletter` | Run one immediate end-to-end publish for the prior 24-hour content window. |
| `npm run publish:newsletter:scheduled` | Run one guarded publish pass that only emits an edition inside the configured daily `21:00` schedule window. |
| `npm run start:publication-scheduler` | Keep a long-lived worker running that schedules publication once per day at `21:00` in `NEWSLETTER_BASE_TIMEZONE`. |

To inspect local API responses against the same published editions directory, start a small HTTP server:

```bash
PORT=3000 node --input-type=module <<'EOF'
import {
  createDefaultNewsletterApiServer,
} from "./src/index.js";

const server = createDefaultNewsletterApiServer({
  env: process.env,
  cwd: process.cwd(),
});
const port = Number(process.env.PORT ?? 3000);

server.listen(port, () => {
  console.log(`Newsletter API listening on http://127.0.0.1:${port}`);
});
EOF
```

Then verify the published JSON endpoints locally:

```bash
curl http://127.0.0.1:${PORT:-3000}/api/newsletter/latest
curl http://127.0.0.1:${PORT:-3000}/api/newsletter/history
curl http://127.0.0.1:${PORT:-3000}/api/newsletter/scope
curl http://127.0.0.1:${PORT:-3000}/api/newsletter/coverage-map
curl http://127.0.0.1:${PORT:-3000}/api/newsletter/reference
curl http://127.0.0.1:${PORT:-3000}/api/newsletter/storylines
curl "http://127.0.0.1:${PORT:-3000}/api/newsletter/exclusions?category=library&reason=relevance_below_threshold"
curl "http://127.0.0.1:${PORT:-3000}/api/newsletter/exclusions/analytics?category=library&reason_code=relevance_below_threshold"
curl http://127.0.0.1:${PORT:-3000}/api/newsletter/item/<stable-item-id>
```

### Daily 21:00 UTC Publishing Workflow

The default publishing workflow emits one edition per day at `21:00` in `NEWSLETTER_BASE_TIMEZONE`. If you do not set that variable, the effective slot is `21:00 UTC`. Each successful run resolves roughly the prior 24-hour content window, fetches from the enabled sources, applies authority checks, deduplication, and relevance scoring, writes the edition JSON under `NEWSLETTER_DATA_DIR/editions`, updates discovery and item-identity state, and leaves the result available to agent consumers over `/api/newsletter/latest`, `/api/newsletter/history`, `/api/newsletter/reference`, `/api/newsletter/storylines`, `/api/newsletter/exclusions`, `/api/newsletter/exclusions/analytics`, `/api/newsletter/item/:id`, and `/api/newsletter/scope`.

The supported publish paths are:

1. `npm run publish:newsletter` publishes immediately. Use this for local validation, backfills, and exact-time external cron jobs.
2. `npm run publish:newsletter:scheduled` runs the same publication flow but only emits an edition when the current time lands inside the daily schedule window. The default guard window is `20` minutes and can be changed with `NEWSLETTER_PUBLICATION_GRACE_MINUTES`.
3. `npm run start:publication-scheduler` keeps one Node worker alive, computes `nextRunAt`, logs the resolved `cronExpression`, `timezone`, and `nextRunAt`, and then publishes once per day at the next eligible slot.
4. [`.github/workflows/publish-newsletter.yml`](./.github/workflows/publish-newsletter.yml) runs once per day at `21:00 UTC` and calls `npm run publish:newsletter` directly. A manual workflow dispatch triggers the same one-shot publish path on demand.

If you set `NEWSLETTER_BASE_TIMEZONE` to a non-UTC timezone, the logical publish slot becomes `21:00` in that deployment timezone. The built-in Node scheduler follows that timezone directly. The checked-in GitHub Actions workflow is the fixed UTC deployment profile; use an external cron job or the built-in scheduler when you need the publish slot to move with another timezone.

## Running The Pipeline

The ingestion, curation, and publication stages are executed together by the default publication task:

1. `ContentFetcherCore` runs the registered source adapters, normalizes each upstream payload into the shared fetch contract, and merges the candidate items into one fetch batch.
2. `AggregationPipeline` filters low-authority items, consolidates duplicates, scores relevance, and keeps items scoring `60+`.
3. `SourceDiscoveryService` records newly discovered sources in `NEWSLETTER_DATA_DIR/source-registry.json` (default `.data/source-registry.json`), including lifecycle state (`probation`, `active`, `retired`), evaluation windows, and source-performance metadata.
4. Approved non-seed web sources are revisited by the built-in `web-discovery` adapter in later publication runs, then retired from the fetch schedule after sustained low-signal cycles.
5. `NewsletterEditionStore` writes the published edition JSON under `NEWSLETTER_DATA_DIR/editions` (default `.data/editions`).

Running a publication job remains the supported way to execute the full end-to-end pipeline. If you only need to refresh discovered-source state and the future fetch schedule, run `npm run discover:sources`.

### Relevance Scoring

Every published item carries both `score_version` and `score_interpretation` alongside `relevance_score`. The checked-in machine-readable scoring specification history lives in [`src/core/relevance-score-history.document.json`](./src/core/relevance-score-history.document.json), where each version records its formula, documented fields and weights, formula rules, and the rationale for the change. The runtime exposes the same history through `RELEVANCE_SCORE_VERSION_HISTORY`, `CURRENT_RELEVANCE_SCORE_VERSION_ENTRY`, and `getRelevanceScoreVersionHistoryEntry()` from [`src/index.js`](./src/index.js). The built-in composite scorer publishes `score_interpretation: "assessment"` because each score is meant to assess near-term relevance for autonomous AI agents rather than predict a future outcome.

#### Scoring Specification History

| Version | Effective at | Formula | Rationale |
| --- | --- | --- | --- |
| `1.0.0` | `2026-03-12T00:00:00.000Z` | `weighted_average(recency, sourceAuthority, mentionFrequency, github, socialEngagement)` | Establish the initial publication gate with one stable `0-100` score that balances freshness, trusted sources, independent corroboration, repository traction, and social attention for autonomous consumers. |

Current factors for `1.0.0`:

- `recency` `0.24`: exponential decay from publish time with a 24-hour half-life and a hard floor at 168 hours.
- `sourceAuthority` `0.28`: normalized authority score so domain-expert and historically reliable sources carry more weight.
- `mentionFrequency` `0.18`: log-normalized cross-source mention count with saturation at 8 mentions.
- `github` `0.20`: blended GitHub signal using stars (`0.6`) plus activity (`0.4`), with star saturation at `50000` and stars-today saturation at `250`.
- `socialEngagement` `0.10`: log-normalized aggregate social engagement with saturation at `1000`.
- Weighting policy: configured weights are re-normalized across observed signals only, so items are scored on available evidence instead of being penalized for missing signal families.

### Local End-To-End Run

Use the built-in one-shot task when you want to ingest fresh content, curate it, and publish a single edition immediately:

```bash
npm run publish:newsletter
```

That command:

- Resolves the prior 24-hour publication window in `NEWSLETTER_BASE_TIMEZONE`.
- Runs the enabled source adapters.
- Applies dedupe, source-authority checks, and relevance scoring.
- Persists the published edition to `NEWSLETTER_DATA_DIR/editions`.
- Updates the discovered-source registry at `NEWSLETTER_DATA_DIR/source-registry.json`.

After the run, inspect the generated edition files locally:

```bash
ls -1 "${NEWSLETTER_DATA_DIR:-.data}/editions"
```

If you want the pipeline to keep publishing on schedule while you develop, run the long-lived scheduler:

```bash
npm run start:publication-scheduler
```

The scheduler runs the same publication task once per day at `21:00` in `NEWSLETTER_BASE_TIMEZONE` and logs the resolved `cronExpression`, `timezone`, and `nextRunAt` on startup.

To expose the published editions over HTTP locally, use the API bootstrap command in the `Setup And Local Development` section above, then verify the machine-facing endpoints with `curl` against the same `PORT` value.

### Production Deployment Patterns

Production only needs two moving parts:

1. A publication worker that runs the end-to-end pipeline once per day.
2. An API process that serves the published editions from the same persistent data directory.

The simplest production layout is:

- Mount persistent storage and set `NEWSLETTER_DATA_DIR` to that shared path.
- Run `npm run publish:newsletter` from an external cron job, job runner, or platform scheduler at `21:00` in `NEWSLETTER_BASE_TIMEZONE`.
- Run a separate Node process that calls `createDefaultNewsletterApiServer({ env: process.env, cwd: process.cwd() })` so the API reads from `NEWSLETTER_DATA_DIR/editions` and persists consumer telemetry in `NEWSLETTER_DATA_DIR/consumer-identities.json`.

Example cron entry for a UTC deployment:

```bash
0 21 * * * cd /path/to/agent-newsletter && NEWSLETTER_BASE_TIMEZONE=UTC NEWSLETTER_DATA_DIR=/var/lib/agent-newsletter npm run publish:newsletter
```

This repository also includes a scheduled GitHub Actions workflow at `.github/workflows/publish-newsletter.yml` that runs once per day at `21:00 UTC` and executes `npm run publish:newsletter`. Treat that workflow as the fixed UTC deployment profile. Manual workflow dispatch runs the same one-shot publish path on demand.

If you prefer one long-running worker instead of an external cron trigger, run:

```bash
NEWSLETTER_BASE_TIMEZONE=UTC \
NEWSLETTER_DATA_DIR=/var/lib/agent-newsletter \
npm run start:publication-scheduler
```

Production recommendations:

- Keep `NEWSLETTER_DATA_DIR` on durable storage so the 7-day archive and discovered-source registry survive restarts.
- Run the API and the publication worker against the same data directory, or replicate the published edition files into the API runtime before serving traffic.
- Provide deployment-specific user agents and credentials for upstream sources to avoid anonymous rate limits.
- Leave `TWITTER_ENABLED=false` unless you have a real bearer token for the built-in X API v2 client or have attached a custom provider client.
- Set `NEWSLETTER_BASE_TIMEZONE` explicitly so the `21:00` publication slot is unambiguous in every environment.
- If you deploy with the included GitHub Actions workflow, treat it as the UTC deployment profile. Use an external cron job or `npm run start:publication-scheduler` when you need `21:00` in another timezone.

## Daily Publication Workflow

This repository provides the publication scheduler, publication window logic, edition storage, and JSON API primitives for the agent newsletter pipeline.

By default, the scheduler and one-shot publication command both use the built-in publication task. That task instantiates the source adapters, aggregation pipeline, source discovery service, and edition store, then runs the end-to-end publication flow for one edition.

```bash
npm run start:publication-scheduler
```

If you need a custom task module, point the scheduler at a module that exports a `publishNewsletterEdition` function:

```bash
NEWSLETTER_PUBLICATION_TASK_MODULE=./path/to/publish-newsletter.js \
npm run start:publication-scheduler
```

If your task module uses a different export name, set `NEWSLETTER_PUBLICATION_TASK_EXPORT` as well:

```bash
NEWSLETTER_PUBLICATION_TASK_MODULE=./path/to/publish-newsletter.js \
NEWSLETTER_PUBLICATION_TASK_EXPORT=run \
npm run start:publication-scheduler
```

Set `NEWSLETTER_BASE_TIMEZONE` to shift the daily publish slot from the default `21:00 UTC` to `21:00` in another IANA timezone:

```bash
NEWSLETTER_BASE_TIMEZONE=America/Los_Angeles \
npm run start:publication-scheduler
```

For an external cron job, use the one-shot command instead of the long-running scheduler:

```bash
0 21 * * * cd /path/to/agent-newsletter && NEWSLETTER_BASE_TIMEZONE=UTC npm run publish:newsletter
```

Deployment code can inspect the resolved runtime config directly:

```js
import { createNewsletterRuntimeConfig } from "./src/index.js";

const runtimeConfig = createNewsletterRuntimeConfig(process.env);
// => {
//   api: { rateLimit: { maxRequests, windowMs, trustProxy } },
//   publication: { baseTimezone, hour, minute, cronExpression }
// }
```

## Scheduling Expectations

- Default cadence is one edition per day at `21:00` in `NEWSLETTER_BASE_TIMEZONE`. If that variable is unset, the effective slot is `21:00 UTC` (`0 21 * * *`).
- If `NEWSLETTER_BASE_TIMEZONE` is set, the built-in Node scheduler still runs at `21:00`, but in that deployment timezone. The UTC run time will move with timezone offset and DST.
- The included GitHub Actions workflow runs once per day at `21:00 UTC` and invokes `npm run publish:newsletter` directly.
- Each publication covers the prior 24-hour content window. The publication flow resolves that window automatically from the configured timezone.
- The scheduler does not publish immediately on startup unless the process is started exactly at the current slot. It schedules the next eligible run and logs the computed `nextRunAt`.
- Consumers are expected to read the newest edition from `/api/newsletter/latest`, catch up through the rolling 7-day archive at `/api/newsletter/history`, read older persistent items from `/api/newsletter/reference`, and inspect one stable item's cross-edition history through `/api/newsletter/item/:id`.

## JSON API

The newsletter uses a pull-based subscription model. Agent consumers do not register, authenticate, or create webhooks. They poll the latest edition from `/api/newsletter/latest`, use `/api/newsletter/history` to catch up on missed editions from the rolling 7-day window, call `/api/newsletter/reference` for persistent high-signal items that have aged out of the archive, inspect `/api/newsletter/storylines` when they need narrative context instead of isolated item events, query `/api/newsletter/item/:id` for one stable tool or library's lifecycle across editions, query `/api/newsletter/exclusions` for grouped exclusion summary statistics, query `/api/newsletter/exclusions/report` when they need the combined reporting view across exclusion records and per-edition summaries, and read `/api/newsletter/scope` when they need the current versioned editorial boundary.

For a dedicated machine-facing reference that consolidates endpoint definitions, schema details, versioning rules, and example requests and responses, see [`docs/newsletter-json-api.md`](./docs/newsletter-json-api.md).

For local or production server bootstrap, use the `createDefaultNewsletterApiServer({ env: process.env, cwd: process.cwd() })` example in the "Running The Pipeline" section above so the API reads from the published editions directory under `NEWSLETTER_DATA_DIR` and persists consumer telemetry in `NEWSLETTER_DATA_DIR/consumer-identities.json`.

### Publication Cadence

- One edition is published per day at `21:00` in `NEWSLETTER_BASE_TIMEZONE`. If you do not set that variable, the default slot is `21:00 UTC`.
- Each edition covers approximately the prior 24 hours. The exact coverage window is returned on every edition as `content_window.starts_at`, `content_window.ends_at`, and `content_window.timezone`.
- `/api/newsletter/latest` only returns editions whose `published_at` is in the past, so subscribing agents should poll shortly after the daily publication slot or on their own retry cadence.
- Agents that miss one or more polls should backfill with `/api/newsletter/history`, then use `/api/newsletter/reference`, `/api/newsletter/storylines`, `/api/newsletter/item/:id`, `/api/newsletter/exclusions`, `/api/newsletter/exclusions/report`, and `/api/newsletter/scope` to reason about longer-lived items, evolving narratives, grouped exclusion counts, recurring blind spots, and the current editorial boundary.

### Recommended Agent Consumption Flow

1. Poll `/api/newsletter/latest` after the daily publication slot.
2. Persist `edition_id`, `item_id`, and `first_seen` so repeated entities can be reconciled across editions.
3. If one or more polls were missed, replay `/api/newsletter/history` from oldest to newest before resuming `/api/newsletter/latest`.
4. Read `/api/newsletter/scope` before making autonomous adoption decisions if your agent needs the current inclusion boundary or changelog for a versioned scope review.
5. Use `/api/newsletter/reference` for durable high-signal items promoted by the separate reference-index policy after appearing in `3+` editions and aging out of the rolling archive.
6. Use `/api/newsletter/storylines` when the agent needs evolving narrative context across related items rather than a single item snapshot.
7. Use `/api/newsletter/exclusions` for grouped exclusion counts, `/api/newsletter/exclusions/report` for the combined reporting view over exclusion records plus per-edition summaries, and `/api/newsletter/exclusions/analytics` for recurring blind spots, repeated item exclusions, and per-edition exclusion trends derived from filtered-out pipeline records.
8. Use `/api/newsletter/item/:id` when the full cross-edition lifecycle for one entity is needed.

### Endpoints

| Endpoint | Method | Purpose | Success response |
| --- | --- | --- | --- |
| `/api/newsletter/latest` | `GET` | Return the most recent edition whose `published_at` is in the past. | `200 OK` with one newsletter edition object |
| `/api/newsletter/history` | `GET` | Return the rolling 7-day archive, newest first. | `200 OK` with `{ archive_window_days, generated_at, editions }` |
| `/api/newsletter/scope` | `GET` | Return the current versioned editorial scope definition and changelog used to decide what the newsletter covers. | `200 OK` with `{ generated_at, current_version, scope_definition, changelog }` |
| `/api/newsletter/coverage-map` | `GET` | Return each newsletter topic area with its active-source count and coverage status for downstream consumers. | `200 OK` with `{ generated_at, minimum_active_source_count, topic_count, topics }` |
| `/api/newsletter/reference` | `GET` | Return persistent high-signal items promoted from prior editions by the reference-index policy after they age out of the rolling archive. | `200 OK` with `{ archive_window_days, generated_at, item_count, items }` |
| `/api/newsletter/storylines` | `GET` | Return active, non-archived storylines that distinguish repetition from developing narratives. | `200 OK` with `{ generated_at, storyline_count, storylines }` |
| `/api/newsletter/exclusions` | `GET` | Return grouped exclusion summary statistics derived from filtered-out pipeline records. | `200 OK` with `{ archive_window_days, generated_at, filters, totals, exclusion_summary }` |
| `/api/newsletter/exclusions/report` | `GET` | Return the combined exclusion reporting view, including raw exclusion records, cross-edition analytics, and per-edition exclusion summaries. | `200 OK` with `{ archive_window_days, generated_at, filters, totals, exclusion_summary, edition_summaries, exclusions, aggregations, recurring_items, blind_spots }` |
| `/api/newsletter/exclusions/analytics` | `GET` | Return cross-edition exclusion analytics, including grouped category/reason patterns, recurring excluded items, blind spots, and per-edition trends. | `200 OK` with `{ archive_window_days, generated_at, filters, totals, exclusions, aggregations, recurring_items, blind_spots }` |
| `/api/newsletter/item/:id` | `GET` | Return one stable item's lifecycle across every published edition where it appeared, including lifecycle summaries for first appearance, repeats, score evolution, storyline membership, and per-appearance relationship metadata. | `200 OK` with `{ item_id, first_seen, edition_count, first_appearance, repeat_appearances, score_evolution, storyline, storyline_membership, appearances }` |

### Request Format

- No authentication is required. Requests do not need API keys, bearer tokens, cookies, or prior registration.
- If a client sends `Authorization`, the built-in API ignores it.
- All routes are `GET` only. Request bodies are ignored.
- `Accept: application/json` is recommended.
- Agents should send a stable `User-Agent`.
- Agents can optionally send one of `X-Agent-Consumer-Id`, `X-Newsletter-Consumer-Id`, `X-Newsletter-Consumer`, or `X-Consumer-Id` so repeat polls are attributed to the same consumer in server-side telemetry. These headers are metadata only, not authentication.
- Successful and error responses use `Content-Type: application/json; charset=utf-8`.
- All timestamps are ISO-8601 UTC strings.
- Rate limiting is enforced per IP by default at `60` requests per `60` seconds.
- Set `NEWSLETTER_API_RATE_LIMIT_MAX_REQUESTS`, `NEWSLETTER_API_RATE_LIMIT_WINDOW_MS`, and `NEWSLETTER_API_RATE_LIMIT_TRUST_PROXY` to override those deployment defaults.
- Successful and rate-limited responses include standard `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, and `ratelimit-policy` headers, plus legacy `x-ratelimit-*` compatibility headers.
- Rate-limited responses return `429 Too Many Requests` with a JSON body and `retry-after` header.
- Unsupported methods return `405` with JSON error bodies. Unknown routes return `404`.

### Endpoint Query Parameters

Most routes do not require query parameters. `GET /api/newsletter/exclusions`, `GET /api/newsletter/exclusions/report`, and `GET /api/newsletter/exclusions/analytics` share the public filter surface.

| Endpoint | Query parameter | Type | Description |
| --- | --- | --- | --- |
| `/api/newsletter/exclusions` | `days` | `integer` | Rolling lookback window in days. Must be a positive integer. Defaults to the archive window, currently `7`. |
| `/api/newsletter/exclusions` | `from` | `string` | Optional inclusive UTC lower bound for the published-edition window. |
| `/api/newsletter/exclusions` | `to` | `string` | Optional inclusive UTC upper bound for the published-edition window. |
| `/api/newsletter/exclusions` | `reason` / `reason_code` | `string` | Restrict the summary or analytics response to one exclusion reason code such as `relevance_below_threshold` or `source_authority_below_threshold`. |
| `/api/newsletter/exclusions` | `category` | `"tool" \| "api" \| "library" \| "technique"` | Restrict the grouped summary to one published category. |
| `/api/newsletter/exclusions` | `source_kind` | `"x" \| "github" \| "arxiv" \| "reddit" \| "web"` | Restrict the grouped summary to exclusions observed from one source family. |
| `/api/newsletter/exclusions` | `adapter_id` | `string` | Restrict the grouped summary to one adapter identifier. |
| `/api/newsletter/exclusions` | `item_id` | `string` | Restrict the grouped summary to one stable item identifier. |
| `/api/newsletter/exclusions` | `phase` | `string` | Restrict the grouped summary to one exclusion phase emitted by the pipeline. |
| `/api/newsletter/exclusions` | `min_recurring_editions` | `integer` | Optional recurring-item threshold used by exclusion analytics backends. Must be a positive integer. Defaults to `2`. |

### Versioning Behavior

- The HTTP routes are currently unversioned. There is no `/v1` path prefix; consumers should treat `/api/newsletter/*` as the canonical endpoint family.
- Score semantics are versioned per item with `score_version`. The value is emitted on every published `NewsletterItem`, on every lifecycle occurrence summary, and on every lifecycle score-evolution entry.
- Editorial boundary semantics are versioned per item with `scope_version`. That version corresponds to the scope definition returned by `GET /api/newsletter/scope`.
- `GET /api/newsletter/scope` exposes the scope version explicitly as `current_version` and `scope_definition.version`, plus a semver changelog describing why the boundary changed.
- Consumers that compare items across days should persist `edition_id`, `item_id`, `score_version`, and `scope_version` together. A stable `item_id` does not imply the same scoring formula or editorial boundary over time.
- The current built-in relevance formula version is `1.0.0`, but clients should treat `score_version` as an opaque string and compare values rather than hard-coding one release.

### Error Response Schema

All error responses are JSON objects.

| Status | Body |
| --- | --- |
| `404` | `{ "error": "not_found", "message": "<reason>" }` |
| `405` | `{ "error": "method_not_allowed", "message": "Use GET /api/newsletter/<route>." }` |
| `429` | `{ "error": "rate_limited", "message": "Too many requests from this IP. Try again later.", "retry_after_seconds": <integer> }` |
| `500` | `{ "error": "internal_server_error", "message": "<server error message>" }` |

### Scope Definition Payload

`GET /api/newsletter/scope` returns the versioned editorial boundary that controls what the pipeline considers AI-agent-relevant coverage.

| Field | Type | Description |
| --- | --- | --- |
| `current_version` | `string` | Current scope definition version. |
| `scope_definition.version` | `string` | Version of the active scope definition. Always matches `current_version`. |
| `scope_definition.reviewed_at` | `string` | UTC timestamp for the last completed scope review. |
| `scope_definition.next_review_at` | `string` | UTC timestamp for the next scheduled quarterly review. |
| `scope_definition.review_cadence` | `string` | Review cadence. The default policy is `quarterly`. |
| `scope_definition.inclusion_policy.qualification_rule` | `string` | Explicit rule for what capabilities a system must have to count as an AI agent for newsletter inclusion. |
| `scope_definition.inclusion_policy.required_capabilities` | `string[]` | Capability checklist used to distinguish autonomous agents from adjacent chatbot or automation tooling. |
| `scope_definition.inclusion_policy.inclusion_examples` | `string[]` | Concrete examples that should be treated as in-scope AI-agent content. |
| `scope_definition.inclusion_policy.exclusion_examples` | `string[]` | Concrete examples that should be treated as out-of-scope for newsletter inclusion. |
| `scope_definition.coverage_boundaries.in_scope` | `string[]` | Explicit editorial inclusion rules. |
| `scope_definition.coverage_boundaries.out_of_scope` | `string[]` | Explicit editorial exclusion rules. |
| `scope_definition.coverage_boundaries.decision_rule` | `string` | Tie-breaker rule for edge cases. |
| `scope_definition.change_tracking.versioning_scheme` | `string` | Versioning policy for scope changes. Currently `semver`. |
| `scope_definition.change_tracking.version_change_rules.major` | `string` | When to increment the major version. |
| `scope_definition.change_tracking.version_change_rules.minor` | `string` | When to increment the minor version. |
| `scope_definition.change_tracking.version_change_rules.patch` | `string` | When to increment the patch version. |
| `changelog[]` | `ScopeChange[]` | Versioned history of scope changes that affected editorial behavior. |

Quarterly reviews that do not change coverage keep the same version and only update `reviewed_at` and `next_review_at`. Any boundary change must increment the scope version and append a new changelog entry.

Example request:

```bash
curl -s http://localhost:3000/api/newsletter/scope
```

Example response:

```json
{
  "generated_at": "2026-03-12T21:30:00.000Z",
  "current_version": "1.0.1",
  "scope_definition": {
    "version": "1.0.1",
    "effective_at": "2026-03-12T00:00:00.000Z",
    "reviewed_at": "2026-03-12T00:00:00.000Z",
    "next_review_at": "2026-06-12T00:00:00.000Z",
    "review_cadence": "quarterly",
    "audience": {
      "primary_subscribers": "Autonomous AI agent programs that subscribe to the JSON API and act on the resulting items.",
      "secondary_operators": "Human operators who deploy, supervise, and review the autonomous agents consuming the newsletter."
    },
    "definition": "AI agents are software systems that autonomously pursue goals by planning what to do next, using tools or external systems, and executing work across multiple steps with limited human intervention.",
    "inclusion_policy": {
      "qualification_rule": "Treat a candidate as AI-agent-relevant only when the underlying system can accept a goal, decide or revise what to do next at runtime, use external tools or systems, and carry out multiple steps with limited human intervention.",
      "required_capabilities": [
        "Maintains an explicit delegated goal beyond answering a single prompt.",
        "Chooses or adapts the next action at runtime based on state, observations, or prior tool results."
      ],
      "inclusion_examples": [
        "A coding agent that inspects a repository, plans code changes, runs tests, and iterates until checks pass."
      ],
      "exclusion_examples": [
        "A chatbot interface that only returns text answers and never takes autonomous actions in external systems."
      ]
    },
    "coverage_boundaries": {
      "in_scope": [
        "Autonomous, goal-directed systems that plan or adapt their next action before executing work."
      ],
      "out_of_scope": [
        "Plain chatbots or assistants that only return text and do not take autonomous actions."
      ],
      "decision_rule": "Include a candidate only when a deployed system could use it to autonomously decide and execute the next step toward a goal."
    },
    "change_tracking": {
      "versioning_scheme": "semver",
      "update_policy": "Any scope-boundary change requires a version bump and a new changelog entry. Quarterly reviews that do not change coverage only refresh reviewedAt and nextReviewAt for the current version.",
      "version_change_rules": {
        "major": "Use a major version bump when the inclusion boundary changes in a way that would add or remove a broad class of content.",
        "minor": "Use a minor version bump when the scope gains or narrows a specific covered pattern, source family, or edge-case rule without redefining the core agent standard.",
        "patch": "Use a patch version bump for clarifications, examples, or wording changes that do not alter editorial behavior."
      }
    }
  },
  "changelog": [
    {
      "version": "1.0.0",
      "change_type": "initial",
      "effective_at": "2026-03-12T00:00:00.000Z",
      "summary": "Established the initial machine-readable editorial scope for the newsletter.",
      "rationale": "The newsletter needs an explicit, versioned boundary so consuming agents and operators can reason about what coverage means and how it changes over time.",
      "scope_changes": [
        "Included autonomous software that plans, uses tools, and executes toward goals with limited human intervention."
      ]
    },
    {
      "version": "1.0.1",
      "change_type": "patch",
      "effective_at": "2026-03-12T00:00:00.000Z",
      "summary": "Added an explicit AI-agent inclusion policy with qualifying criteria and boundary examples.",
      "rationale": "Editorial decisions need machine-readable examples so operators and consuming agents can distinguish autonomous systems from adjacent chatbot or automation tooling.",
      "scope_changes": [
        "Added a qualification rule that defines what capabilities a system must have to count as an AI agent for newsletter inclusion."
      ]
    }
  ]
}
```

### Newsletter Payload Schema

Published items may merge duplicate mentions from multiple sources. For that reason the public API exposes `source_urls` instead of a singular `source_url`.

#### Edition Object

| Field | Type | Description |
| --- | --- | --- |
| `edition_id` | `string` | Stable edition identifier. Defaults to the publication date in `content_window.timezone`, for example `2026-03-11`. |
| `published_at` | `string` | UTC timestamp when the edition became available. |
| `content_window.starts_at` | `string` | UTC timestamp for the beginning of the covered fetch window. |
| `content_window.ends_at` | `string` | UTC timestamp for the end of the covered fetch window. |
| `content_window.timezone` | `string` | Base timezone used to compute the publication slot and content window. |
| `item_count` | `integer` | Number of items in the edition. Always equal to `items.length`. |
| `items` | `NewsletterItem[]` | Curated items with relevance score `>= 60`. |

#### Newsletter Item Object

| Field | Type | Description |
| --- | --- | --- |
| `item_id` | `string` | Stable item identifier used to track the same entity across editions. |
| `name` | `string` | Tool, API, library, or technique name. |
| `source_urls` | `string[]` | Canonical URLs backing the item after deduplication. |
| `category` | `"tool" \| "api" \| "library" \| "technique"` | Machine-readable content category. |
| `summary` | `string` | One-paragraph description for agent or operator consumption. |
| `integration_hint` | `string` | Brief next-step guidance for evaluating or integrating the item. |
| `relevance_score` | `number` | Composite score from `0` to `100`. Only items scoring `60+` are published. |
| `score_version` | `string` | Version identifier for the relevance scoring formula used to produce `relevance_score`. |
| `score_interpretation` | `"predictive" \| "assessment" \| "classificatory"` | Declares how consuming agents should treat `relevance_score`. The built-in weighted composite scorer uses `"assessment"`. |
| `divergence_flag` | `boolean` | `true` when the item carries mixed or disagreeing source sentiment, so consuming agents can branch quickly on contested items. |
| `risk_warning.security.severity` | `"unknown" \| "low" \| "medium" \| "high" \| "critical"` | Security risk level for downstream autonomous use. |
| `risk_warning.security.description` | `string` | Why the item needs security review or sandboxing. |
| `risk_warning.maturity.severity` | `"unknown" \| "low" \| "medium" \| "high" \| "critical"` | Product maturity and production-readiness signal. |
| `risk_warning.maturity.description` | `string` | Why the item's maturity needs validation before adoption. |
| `risk_warning.adoption_complexity.severity` | `"unknown" \| "low" \| "medium" \| "high" \| "critical"` | Estimated complexity of integrating the item into an agent stack. |
| `risk_warning.adoption_complexity.description` | `string` | Why the integration path may require extra work or caution. |
| `mention_count` | `integer` | Cross-source mention count after deduplication. |
| `sentiment_spread.classification` | `"agree" \| "disagree" \| "mixed"` | Derived from all non-null source sentiments after deduplication: identical sentiment yields `agree`, positive plus negative yields `disagree`, and any other blend yields `mixed`. |
| `sentiment_spread.disagreement_dimension` | `"security" \| "utility" \| "novelty" \| "market"` | Required when `sentiment_spread.classification` is `disagree` or `mixed`, identifying the contested aspect of the item. |
| `first_seen` | `string` | UTC timestamp for when the item first entered the newsletter corpus. |
| `edition_count` | `integer` | Number of editions in which the item has appeared so far. |
| `storyline_ids` | `string[]` | Stable storyline identifiers associated with the item in the publication corpus. |
| `scope_version` | `string` | Editorial scope-definition version in effect when the item was published. Resolve this against `GET /api/newsletter/scope`. |

#### Item Lifecycle Object

| Field | Type | Description |
| --- | --- | --- |
| `item_id` | `string` | Stable item identifier used to track the entity across editions. |
| `first_seen` | `string` | UTC timestamp when the entity first entered the corpus. |
| `edition_count` | `integer` | Number of published editions in which the item has appeared so far. |
| `first_appearance` | `ItemLifecycleOccurrenceSummary` | Summary for the first published appearance of the item. |
| `repeat_appearances` | `ItemLifecycleOccurrenceSummary[]` | Ordered summaries for every later appearance of the item. |
| `score_evolution` | `ItemLifecycleScoreEvolutionEntry[]` | Ordered scoring history across appearances. |
| `storyline.storyline_id` | `string \| null` | Latest known storyline grouping for the item. `null` when no storyline metadata has been published yet. |
| `storyline.member_item_ids` | `string[]` | Known members of the current storyline, ordered chronologically. |
| `storyline.related_item_ids` | `string[]` | `storyline.member_item_ids` excluding the requested `item_id`. |
| `storyline.status` | `"developing" \| "stable" \| "archived"` | Current storyline lifecycle state. |
| `storyline_membership` | `ItemLifecycleStorylineMembershipEntry[]` | One entry per appearance describing the item's storyline membership for that edition. |
| `appearances` | `ItemLifecycleAppearance[]` | Chronological appearance history for the item, oldest first. |

#### Item Lifecycle Occurrence Summary Object

| Field | Type | Description |
| --- | --- | --- |
| `edition_id` | `string` | Edition identifier for this appearance. |
| `published_at` | `string` | UTC publication time for the edition. |
| `appearance_number` | `integer` | One-based appearance ordinal for the stable item. |
| `relevance_score` | `number` | Published relevance score for this appearance. |
| `score_version` | `string` | Score-formula version that produced `relevance_score`. |
| `storyline_ids` | `string[]` | Storylines attached to the item in that edition. |

#### Item Lifecycle Score Evolution Entry Object

| Field | Type | Description |
| --- | --- | --- |
| `edition_id` | `string` | Edition identifier for the scored appearance. |
| `published_at` | `string` | UTC publication time for the edition. |
| `relevance_score` | `number` | Published relevance score for this appearance. |
| `score_version` | `string` | Score-formula version that produced `relevance_score`. |
| `delta_from_previous` | `number \| null` | Score delta versus the immediately previous appearance. `null` on the first appearance. |
| `delta_from_first_appearance` | `number` | Score delta versus the first appearance of the item. |

#### Item Lifecycle Storyline Membership Entry Object

| Field | Type | Description |
| --- | --- | --- |
| `edition_id` | `string` | Edition identifier for the membership snapshot. |
| `published_at` | `string` | UTC publication time for the edition. |
| `storyline_ids` | `string[]` | Full storyline set attached to the item for that edition. |
| `primary_storyline_id` | `string \| null` | Primary storyline for the appearance when available. |
| `primary_storyline_title` | `string \| null` | Primary storyline title for the appearance when available. |
| `primary_storyline_status` | `"developing" \| "stable" \| "archived" \| null` | Primary storyline lifecycle status for the appearance when available. |
| `position` | `integer \| null` | One-based position inside the primary storyline member list when available. |
| `relationship_decision` | `"origin" \| "repetition" \| "evolution" \| null` | Storyline classifier decision for the appearance when available. |

#### Item Lifecycle Appearance Object

| Field | Type | Description |
| --- | --- | --- |
| `edition_id` | `string` | Published edition identifier where this appearance occurred. |
| `published_at` | `string` | UTC timestamp for that edition's publication time. |
| `content_window` | `object` | The edition window that produced this appearance. |
| `item` | `NewsletterItem` | The item's serialized state for that edition. |
| `storyline.storyline_id` | `string \| null` | Storyline linked to the item at that specific appearance. |
| `storyline.position` | `integer \| null` | Chronological position of the item within the storyline member list for that edition. |
| `storyline.relationship.decision` | `"origin" \| "repetition" \| "evolution" \| null` | How this appearance relates to the item's prior storyline history. |
| `storyline.relationship.previous_appearance` | `object \| null` | Pointer to the most recent prior storyline appearance when available. |
| `storyline.relationship.signals` | `object \| null` | Classifier signals such as novel fact counts, token novelty, overlap, and new source clusters. |

#### Storyline Object

| Field | Type | Description |
| --- | --- | --- |
| `storyline_id` | `string` | Stable storyline identifier. |
| `title` | `string` | Human-readable summary of the narrative thread. |
| `member_item_ids` | `string[]` | Stable item identifiers for the storyline, ordered chronologically. |
| `status` | `"developing" \| "stable"` | Current state for an active storyline. Archived storylines are not returned by `/api/newsletter/storylines`. |
| `relationship_metadata` | `object` | Explicit typed lineage metadata. `fork.parent_storyline_ids` excludes any storyline ids that appear only because they were merged into the current storyline, while `merge.source_storyline_ids` and `merge.target_storyline_id` expose merge direction directly. |
| `parent_storyline_ids` | `string[]` | Optional parent storyline identifiers when the current storyline forked from or merged prior narratives. |
| `child_storyline_ids` | `string[]` | Optional child storyline identifiers created when this storyline later forked into new active narratives. |
| `merged_storyline_ids` | `string[]` | Optional source storyline identifiers whose members were folded into the current active storyline after a merge event. |
| `merged_into_storyline_id` | `string` | Optional target storyline identifier when the current storyline has been superseded by a merge. This will usually be absent from `/api/newsletter/storylines` because merged source storylines are archived. |
| `narrative_type` | `object` | Optional extensible narrative metadata with a required `key` and optional `label` / `metadata` payload for agent-side reasoning. |
| `first_seen` | `string` | UTC timestamp when the storyline first entered the published corpus. |
| `last_seen` | `string` | UTC timestamp of the most recent published item in the storyline. |
| `updated_at` | `string` | UTC timestamp for the most recent storyline state update. |
| `last_evolution_at` | `string` | UTC timestamp for the most recent storyline evolution event. |
| `evolution_count` | `integer` | Number of times the storyline materially evolved. |
| `repetition_count` | `integer` | Number of repeated appearances without meaningful novelty. |
| `repetition_streak` | `integer` | Current consecutive repetition run length. |
| `item_count` | `integer` | Number of current member items in the storyline. |
| `items` | `NewsletterItem[]` | Chronologically ordered member items for the storyline. |

#### Exclusion Summary Response Object

| Field | Type | Description |
| --- | --- | --- |
| `archive_window_days` | `integer` | Lookback window used to build the summary. |
| `generated_at` | `string` | UTC timestamp when the summary was generated. |
| `filters.published_from` | `string \| null` | Inclusive UTC lower bound for the scanned published-edition window. |
| `filters.published_to` | `string \| null` | Inclusive UTC upper bound for the scanned published-edition window. |
| `filters.reason` | `string \| null` | Applied exclusion-reason filter. |
| `filters.category` | `"tool" \| "api" \| "library" \| "technique" \| null` | Applied category filter. |
| `filters.source_kind` | `"x" \| "github" \| "arxiv" \| "reddit" \| "web" \| null` | Applied source-family filter. |
| `filters.adapter_id` | `string \| null` | Applied adapter identifier filter. |
| `filters.item_id` | `string \| null` | Applied stable item identifier filter. |
| `filters.phase` | `string \| null` | Applied pipeline-phase filter. |
| `totals.scanned_edition_count` | `integer` | Number of editions examined inside the requested window. |
| `totals.matched_edition_count` | `integer` | Number of editions containing at least one exclusion matching the filters. |
| `totals.distinct_item_count` | `integer` | Number of distinct stable items represented in the filtered exclusion set. |
| `totals.total_excluded_items` | `integer` | Total number of matching excluded items. |
| `totals.exclusion_group_count` | `integer` | Number of grouped category-and-reason buckets returned. |
| `exclusion_summary.total_excluded_items` | `integer` | Same total as `totals.total_excluded_items`. |
| `exclusion_summary.counts_by_category[]` | `Array<{ category, count }>` | Rollup of excluded-item counts grouped by newsletter category. |
| `exclusion_summary.counts_by_reason_code[]` | `Array<{ reason_code, count }>` | Rollup of excluded-item counts grouped by exclusion reason. |
| `exclusion_summary.counts_by_category_and_reason[]` | `Array<{ category, reason_code, count }>` | Grouped counts of excluded items by category and exclusion reason. |

### Example Response: Latest Edition

Request:

```bash
curl -s \
  -H 'Accept: application/json' \
  -H 'User-Agent: agent-runtime/1.4 (+https://example.com/agents/runtime)' \
  -H 'X-Agent-Consumer-Id: agent-runtime-prod' \
  http://localhost:3000/api/newsletter/latest
```

Response:

```json
{
  "edition_id": "2026-03-11",
  "published_at": "2026-03-11T21:00:00.000Z",
  "content_window": {
    "starts_at": "2026-03-10T21:00:00.000Z",
    "ends_at": "2026-03-11T21:00:00.000Z",
    "timezone": "UTC"
  },
  "item_count": 1,
  "items": [
    {
      "item_id": "artifact-archive-day-seven",
      "name": "Archive Day Seven",
      "source_urls": [
        "https://example.com/archive-day-seven",
        "https://mirror.example.com/archive-day-seven"
      ],
      "category": "tool",
      "summary": "Archive Day Seven helps agents ship integrations faster.",
      "integration_hint": "Review Archive Day Seven installation docs before rollout.",
      "relevance_score": 84,
      "score_version": "1.0.0",
      "score_interpretation": "assessment",
      "divergence_flag": true,
      "risk_warning": {
        "security": {
          "severity": "medium",
          "description": "Validate production readiness before enabling autonomous actions."
        },
        "maturity": {
          "severity": "medium",
          "description": "Validate production readiness before enabling autonomous actions."
        },
        "adoption_complexity": {
          "severity": "medium",
          "description": "Validate production readiness before enabling autonomous actions."
        }
      },
      "mention_count": 2,
      "sentiment_spread": {
        "classification": "mixed",
        "disagreement_dimension": "utility"
      },
      "first_seen": "2026-03-09T20:30:00.000Z",
      "edition_count": 3,
      "storyline_ids": [],
      "scope_version": "1.0.1"
    }
  ]
}
```

### Example Response: Rolling Archive

Request:

```bash
curl -s http://localhost:3000/api/newsletter/history
```

Response:

```json
{
  "archive_window_days": 7,
  "generated_at": "2026-03-11T21:30:00.000Z",
  "editions": [
    {
      "edition_id": "2026-03-11",
      "published_at": "2026-03-11T21:00:00.000Z",
      "content_window": {
        "starts_at": "2026-03-10T21:00:00.000Z",
        "ends_at": "2026-03-11T21:00:00.000Z",
        "timezone": "UTC"
      },
      "item_count": 1,
      "items": [
        {
          "item_id": "artifact-archive-day-seven",
          "name": "Archive Day Seven",
          "source_urls": [
            "https://example.com/archive-day-seven",
            "https://mirror.example.com/archive-day-seven"
          ],
          "category": "tool",
          "summary": "Archive Day Seven helps agents ship integrations faster.",
          "integration_hint": "Review Archive Day Seven installation docs before rollout.",
          "relevance_score": 84,
          "score_version": "1.0.0",
          "score_interpretation": "assessment",
          "divergence_flag": true,
          "risk_warning": {
            "security": {
              "severity": "medium",
              "description": "Validate production readiness before enabling autonomous actions."
            },
            "maturity": {
              "severity": "medium",
              "description": "Validate production readiness before enabling autonomous actions."
            },
            "adoption_complexity": {
              "severity": "medium",
              "description": "Validate production readiness before enabling autonomous actions."
            }
          },
          "mention_count": 2,
          "sentiment_spread": {
            "classification": "mixed",
            "disagreement_dimension": "utility"
          },
          "first_seen": "2026-03-09T20:30:00.000Z",
          "edition_count": 3,
          "storyline_ids": [],
          "scope_version": "1.0.1"
        }
      ]
    }
  ]
}
```

### Example Response: Persistent Reference Index

The reference index is computed separately from the 7-day archive. An item is promoted only after its latest appearance ages out of `/api/newsletter/history`, it has appeared in at least `3` editions, it still clears the publication relevance threshold, and it is corroborated by at least `2` independent source clusters. To preserve category diversity, one aged-out item from a source-coverage category marked `underrepresented` may still be promoted with `1` source cluster when it clears the persistence and score thresholds and that category would otherwise be absent from the reference index.

Request:

```bash
curl -s http://localhost:3000/api/newsletter/reference
```

Response:

```json
{
  "archive_window_days": 7,
  "generated_at": "2026-03-12T21:30:00.000Z",
  "item_count": 1,
  "items": [
    {
      "item_id": "artifact-github-com-acme-persistent-agent-runtime",
      "name": "Persistent Agent Runtime",
      "source_urls": [
        "https://github.com/acme/persistent-agent-runtime",
        "https://reddit.com/r/LocalLLaMA/comments/persistent-agent-runtime"
      ],
      "category": "library",
      "summary": "Persistent Agent Runtime helps autonomous agents extend their toolchain.",
      "integration_hint": "Review Persistent Agent Runtime installation docs before rollout.",
      "relevance_score": 88,
      "score_version": "1.0.0",
      "score_interpretation": "assessment",
      "divergence_flag": false,
      "risk_warning": {
        "security": {
          "severity": "medium",
          "description": "Validate production readiness before enabling autonomous actions."
        },
        "maturity": {
          "severity": "medium",
          "description": "Validate production readiness before enabling autonomous actions."
        },
        "adoption_complexity": {
          "severity": "medium",
          "description": "Validate production readiness before enabling autonomous actions."
        }
      },
      "mention_count": 2,
      "sentiment_spread": {
        "classification": "agree"
      },
      "first_seen": "2026-03-02T20:30:00.000Z",
      "edition_count": 3,
      "storyline_ids": [],
      "scope_version": "1.0.1"
    }
  ]
}
```

### Example Response: Active Storylines

Request:

```bash
curl -s http://localhost:3000/api/newsletter/storylines
```

Response:

```json
{
  "generated_at": "2026-03-11T21:30:00.000Z",
  "storyline_count": 1,
  "storylines": [
    {
      "storyline_id": "storyline-agent-runtime",
      "title": "Agent Runtime expands into managed hosting",
      "member_item_ids": [
        "artifact-agent-runtime-core",
        "artifact-agent-runtime-cloud"
      ],
      "status": "stable",
      "relationship_metadata": {
        "fork": {
          "parent_storyline_ids": [
            "storyline-agent-runtime-sdk"
          ],
          "child_storyline_ids": [
            "storyline-agent-runtime-ops"
          ]
        },
        "merge": {
          "source_storyline_ids": [
            "storyline-agent-hosting-beta"
          ],
          "target_storyline_id": null
        }
      },
      "parent_storyline_ids": [
        "storyline-agent-runtime-sdk"
      ],
      "child_storyline_ids": [
        "storyline-agent-runtime-ops"
      ],
      "merged_storyline_ids": [
        "storyline-agent-hosting-beta"
      ],
      "first_seen": "2026-03-10T20:30:00.000Z",
      "last_seen": "2026-03-11T20:45:00.000Z",
      "updated_at": "2026-03-11T21:00:00.000Z",
      "last_evolution_at": "2026-03-11T21:00:00.000Z",
      "evolution_count": 2,
      "repetition_count": 0,
      "repetition_streak": 0,
      "item_count": 2,
      "items": [
        {
          "item_id": "artifact-agent-runtime-core",
          "name": "Agent Runtime Core",
          "source_urls": [
            "https://github.com/acme/agent-runtime",
            "https://github.com/acme/agent-runtime/docs"
          ],
          "category": "library",
          "summary": "Runtime for tool-using agents.",
          "integration_hint": "npm install agent-runtime",
          "relevance_score": 84,
          "score_version": "1.0.0",
          "score_interpretation": "assessment",
          "divergence_flag": false,
          "risk_warning": {
            "security": {
              "severity": "medium",
              "description": "Validate production readiness before enabling autonomous actions."
            },
            "maturity": {
              "severity": "medium",
              "description": "Validate production readiness before enabling autonomous actions."
            },
            "adoption_complexity": {
              "severity": "medium",
              "description": "Validate production readiness before enabling autonomous actions."
            }
          },
          "mention_count": 2,
          "sentiment_spread": {
            "classification": "agree"
          },
          "first_seen": "2026-03-10T20:30:00.000Z",
          "edition_count": 1,
          "storyline_ids": [
            "storyline-agent-runtime"
          ],
          "scope_version": "1.0.1"
        },
        {
          "item_id": "artifact-agent-runtime-cloud",
          "name": "Agent Runtime Cloud",
          "source_urls": [
            "https://example.com/agent-runtime-cloud",
            "https://example.com/agent-runtime-cloud/docs"
          ],
          "category": "tool",
          "summary": "Managed hosting for the Agent Runtime ecosystem.",
          "integration_hint": "Review deployment docs before adoption.",
          "relevance_score": 84,
          "score_version": "1.0.0",
          "score_interpretation": "assessment",
          "divergence_flag": true,
          "risk_warning": {
            "security": {
              "severity": "medium",
              "description": "Validate production readiness before enabling autonomous actions."
            },
            "maturity": {
              "severity": "medium",
              "description": "Validate production readiness before enabling autonomous actions."
            },
            "adoption_complexity": {
              "severity": "medium",
              "description": "Validate production readiness before enabling autonomous actions."
            }
          },
          "mention_count": 2,
          "sentiment_spread": {
            "classification": "mixed",
            "disagreement_dimension": "utility"
          },
          "first_seen": "2026-03-11T20:45:00.000Z",
          "edition_count": 1,
          "storyline_ids": [
            "storyline-agent-runtime"
          ],
          "scope_version": "1.0.1"
        }
      ]
    }
  ]
}
```

### Example Response: Item Lifecycle

Request:

```bash
curl -s http://localhost:3000/api/newsletter/item/persistent-agent-sdk-item
```

Response:

```json
{
  "item_id": "persistent-agent-sdk-item",
  "first_seen": "2026-03-10T20:30:00.000Z",
  "edition_count": 2,
  "first_appearance": {
    "edition_id": "2026-03-10",
    "published_at": "2026-03-10T21:00:00.000Z",
    "appearance_number": 1,
    "relevance_score": 84,
    "score_version": "1.0.0",
    "storyline_ids": [
      "storyline-persistent-agent-sdk-rollout"
    ]
  },
  "repeat_appearances": [
    {
      "edition_id": "2026-03-11",
      "published_at": "2026-03-11T21:00:00.000Z",
      "appearance_number": 2,
      "relevance_score": 84,
      "score_version": "1.0.0",
      "storyline_ids": [
        "storyline-persistent-agent-sdk-rollout"
      ]
    }
  ],
  "score_evolution": [
    {
      "edition_id": "2026-03-10",
      "published_at": "2026-03-10T21:00:00.000Z",
      "relevance_score": 84,
      "score_version": "1.0.0",
      "delta_from_previous": null,
      "delta_from_first_appearance": 0
    },
    {
      "edition_id": "2026-03-11",
      "published_at": "2026-03-11T21:00:00.000Z",
      "relevance_score": 84,
      "score_version": "1.0.0",
      "delta_from_previous": 0,
      "delta_from_first_appearance": 0
    }
  ],
  "storyline": {
    "storyline_id": "storyline-persistent-agent-sdk-rollout",
    "title": "Persistent Agent SDK rollout",
    "status": "stable",
    "member_item_ids": [
      "persistent-agent-sdk-item",
      "agent-memory-pack-item"
    ],
    "related_item_ids": [
      "agent-memory-pack-item"
    ],
    "first_seen": "2026-03-10T20:30:00.000Z",
    "last_seen": "2026-03-11T20:30:00.000Z",
    "updated_at": "2026-03-11T21:00:00.000Z",
    "last_evolution_at": "2026-03-11T21:00:00.000Z",
    "evolution_count": 2,
    "repetition_count": 0,
    "repetition_streak": 0
  },
  "storyline_membership": [
    {
      "edition_id": "2026-03-10",
      "published_at": "2026-03-10T21:00:00.000Z",
      "storyline_ids": [
        "storyline-persistent-agent-sdk-rollout"
      ],
      "primary_storyline_id": "storyline-persistent-agent-sdk-rollout",
      "primary_storyline_title": "Persistent Agent SDK rollout",
      "primary_storyline_status": "developing",
      "position": 1,
      "relationship_decision": "origin"
    },
    {
      "edition_id": "2026-03-11",
      "published_at": "2026-03-11T21:00:00.000Z",
      "storyline_ids": [
        "storyline-persistent-agent-sdk-rollout"
      ],
      "primary_storyline_id": "storyline-persistent-agent-sdk-rollout",
      "primary_storyline_title": "Persistent Agent SDK rollout",
      "primary_storyline_status": "stable",
      "position": 1,
      "relationship_decision": "evolution"
    }
  ],
  "appearances": [
    {
      "edition_id": "2026-03-10",
      "published_at": "2026-03-10T21:00:00.000Z",
      "content_window": {
        "starts_at": "2026-03-09T21:00:00.000Z",
        "ends_at": "2026-03-10T21:00:00.000Z",
        "timezone": "UTC"
      },
      "item": {
        "item_id": "persistent-agent-sdk-item",
        "name": "Persistent Agent SDK",
        "source_urls": [
          "https://example.com/persistent-agent-sdk",
          "https://mirror.example.com/persistent-agent-sdk"
        ],
        "category": "tool",
        "summary": "Persistent Agent SDK helps agents ship integrations faster.",
        "integration_hint": "Review Persistent Agent SDK installation docs before rollout.",
        "relevance_score": 84,
        "score_version": "1.0.0",
        "score_interpretation": "assessment",
        "divergence_flag": false,
        "risk_warning": {
          "security": {
            "severity": "medium",
            "description": "Validate production readiness before enabling autonomous actions."
          },
          "maturity": {
            "severity": "medium",
            "description": "Validate production readiness before enabling autonomous actions."
          },
          "adoption_complexity": {
            "severity": "medium",
            "description": "Validate production readiness before enabling autonomous actions."
          }
        },
        "mention_count": 2,
        "sentiment_spread": {
          "classification": "agree"
        },
        "first_seen": "2026-03-10T20:30:00.000Z",
        "edition_count": 1,
        "storyline_ids": [
          "storyline-persistent-agent-sdk-rollout"
        ],
        "scope_version": "1.0.1"
      },
      "storyline": {
        "storyline_id": "storyline-persistent-agent-sdk-rollout",
        "title": "Persistent Agent SDK rollout",
        "status": "developing",
        "position": 1,
        "member_item_ids": [
          "persistent-agent-sdk-item"
        ],
        "related_item_ids": [],
        "relationship": {
          "decision": "origin",
          "explanation": "First appearance in this storyline.",
          "prior_appearance_count": 0,
          "previous_appearance": null,
          "signals": {
            "fact_overlap_ratio": 0,
            "novel_fact_count": 0,
            "novel_token_ratio": 0,
            "new_source_cluster_count": 0
          }
        }
      }
    },
    {
      "edition_id": "2026-03-11",
      "published_at": "2026-03-11T21:00:00.000Z",
      "content_window": {
        "starts_at": "2026-03-10T21:00:00.000Z",
        "ends_at": "2026-03-11T21:00:00.000Z",
        "timezone": "UTC"
      },
      "item": {
        "item_id": "persistent-agent-sdk-item",
        "name": "Persistent Agent SDK",
        "source_urls": [
          "https://example.com/persistent-agent-sdk",
          "https://mirror.example.com/persistent-agent-sdk"
        ],
        "category": "tool",
        "summary": "Persistent Agent SDK helps agents ship integrations faster.",
        "integration_hint": "Review Persistent Agent SDK installation docs before rollout.",
        "relevance_score": 84,
        "score_version": "1.0.0",
        "score_interpretation": "assessment",
        "divergence_flag": true,
        "risk_warning": {
          "security": {
            "severity": "medium",
            "description": "Validate production readiness before enabling autonomous actions."
          },
          "maturity": {
            "severity": "medium",
            "description": "Validate production readiness before enabling autonomous actions."
          },
          "adoption_complexity": {
            "severity": "medium",
            "description": "Validate production readiness before enabling autonomous actions."
          }
        },
        "mention_count": 2,
        "sentiment_spread": {
          "classification": "mixed",
          "disagreement_dimension": "utility"
        },
        "first_seen": "2026-03-10T20:30:00.000Z",
        "edition_count": 2,
        "storyline_ids": [
          "storyline-persistent-agent-sdk-rollout"
        ],
        "scope_version": "1.0.1"
      },
      "storyline": {
        "storyline_id": "storyline-persistent-agent-sdk-rollout",
        "title": "Persistent Agent SDK rollout",
        "status": "stable",
        "position": 1,
        "member_item_ids": [
          "persistent-agent-sdk-item",
          "agent-memory-pack-item"
        ],
        "related_item_ids": [
          "agent-memory-pack-item"
        ],
        "relationship": {
          "decision": "evolution",
          "explanation": "Introduces 1 novel fact clause with 25% novel tokens.",
          "prior_appearance_count": 1,
          "previous_appearance": {
            "edition_id": "2026-03-10",
            "published_at": "2026-03-10T21:00:00.000Z",
            "source_url": "https://example.com/persistent-agent-sdk"
          },
          "signals": {
            "fact_overlap_ratio": 0.4,
            "novel_fact_count": 1,
            "novel_token_ratio": 0.25,
            "new_source_cluster_count": 1
          }
        }
      }
    }
  ]
}
```

### Example Response: Exclusion Summary

Request:

```bash
curl -s "http://localhost:3000/api/newsletter/exclusions?category=library&reason=relevance_below_threshold"
```

Response:

```json
{
  "archive_window_days": 7,
  "generated_at": "2026-03-12T21:30:00.000Z",
  "filters": {
    "published_from": "2026-03-05T21:30:00.000Z",
    "published_to": "2026-03-12T21:30:00.000Z",
    "reason": "relevance_below_threshold",
    "category": "library",
    "source_kind": null,
    "adapter_id": null,
    "item_id": null,
    "phase": null
  },
  "totals": {
    "scanned_edition_count": 2,
    "matched_edition_count": 2,
    "distinct_item_count": 2,
    "total_excluded_items": 3,
    "exclusion_group_count": 1
  },
  "exclusion_summary": {
    "total_excluded_items": 3,
    "counts_by_category": [
      {
        "category": "library",
        "count": 3
      }
    ],
    "counts_by_reason_code": [
      {
        "reason_code": "relevance_below_threshold",
        "count": 3
      }
    ],
    "counts_by_category_and_reason": [
      {
        "category": "library",
        "reason_code": "relevance_below_threshold",
        "count": 3
      }
    ]
  }
}
```

### Example Response: Exclusion Analytics

Request:

```bash
curl -s "http://localhost:3000/api/newsletter/exclusions/analytics?category=library&reason_code=relevance_below_threshold&source_kind=github&phase=scoring"
```

Response:

```json
{
  "archive_window_days": 7,
  "generated_at": "2026-03-12T21:30:00.000Z",
  "filters": {
    "published_from": "2026-03-05T21:30:00.000Z",
    "published_to": "2026-03-12T21:30:00.000Z",
    "reason_code": "relevance_below_threshold",
    "category": "library",
    "source_kind": "github",
    "adapter_id": null,
    "item_id": null,
    "phase": "scoring",
    "min_recurring_editions": 2
  },
  "totals": {
    "scanned_edition_count": 2,
    "matched_edition_count": 2,
    "exclusion_count": 3,
    "distinct_item_count": 2,
    "recurring_item_count": 1,
    "blind_spot_count": 1
  },
  "aggregations": {
    "category_reason_codes": [
      {
        "category": "library",
        "reason_code": "relevance_below_threshold",
        "exclusion_count": 3,
        "distinct_item_count": 2,
        "edition_count": 2,
        "first_excluded_at": "2026-03-10T21:00:00.000Z",
        "last_excluded_at": "2026-03-11T21:00:00.000Z"
      }
    ]
  },
  "recurring_items": [
    {
      "item_id": "artifact-github-com-acme-agent-runtime-lite",
      "name": "Agent Runtime Lite",
      "category": "library",
      "exclusion_count": 2,
      "edition_count": 2,
      "reason_codes": ["relevance_below_threshold"],
      "first_excluded_at": "2026-03-10T21:00:00.000Z",
      "last_excluded_at": "2026-03-11T21:00:00.000Z"
    }
  ],
  "blind_spots": [
    {
      "blind_spot_key": "category:library|reason:relevance_below_threshold",
      "category": "library",
      "reason_code": "relevance_below_threshold",
      "exclusion_count": 3,
      "distinct_item_count": 2,
      "edition_count": 2,
      "first_excluded_at": "2026-03-10T21:00:00.000Z",
      "last_excluded_at": "2026-03-11T21:00:00.000Z"
    }
  ]
}
```

### Example Response: Rate-Limited Agent

```json
{
  "error": "rate_limited",
  "message": "Too many requests from this IP. Try again later.",
  "retry_after_seconds": 60
}
```

## Verification

Run the automated checks that cover the schedule, publication window, and newsletter API behavior:

```bash
npm test
```

If you only want the publication workflow checks, run:

```bash
node --test \
  test/publication-schedule.test.js \
  test/publication-flow.test.js \
  test/newsletter-latest-api.test.js \
  test/newsletter-history-api.test.js \
  test/newsletter-item-api.test.js
```

When starting the scheduler manually, verify these runtime signals:

- Startup logs include the expected `cronExpression`, `timezone`, and `nextRunAt`.
- A published edition is written under `NEWSLETTER_DATA_DIR` (default `.data/editions`).
- `/api/newsletter/latest` returns the newly published edition after its `published_at` time.
- `/api/newsletter/history` includes that edition inside the rolling 7-day archive.
- `/api/newsletter/reference` returns persistent items whose latest appearance has aged out of the rolling 7-day archive.
- `/api/newsletter/item/:id` returns the same item's full lifecycle with ordered per-edition appearances.
