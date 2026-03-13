import test from "node:test";
import assert from "node:assert/strict";

import { defineSourceAdapter } from "../src/core/adapters.js";
import { createNormalizedItemFromSourceRecord } from "../src/core/schema.js";
import { SourceAdapterConfigurationError } from "../src/sources/source-adapter.js";
import {
  GitHubSourceAdapter,
  buildSearchQuery,
  categorizeRepository,
  deriveIntegrationHint,
  parseTrendingHtml,
} from "../src/sources/github-source.js";

test("buildSearchQuery targets recently pushed AI agent repositories", () => {
  const query = buildSearchQuery({
    term: '"ai agent"',
    since: "2026-03-10T00:00:00.000Z",
    until: "2026-03-11T00:00:00.000Z",
  });

  assert.equal(
    query,
    '"ai agent" in:name,description,readme archived:false mirror:false stars:>=5 pushed:>=2026-03-10 pushed:<=2026-03-11',
  );
});

test("parseTrendingHtml extracts repository metadata from GitHub trending markup", () => {
  const html = `
    <article class="Box-row">
      <h2 class="h3 lh-condensed">
        <a href="/langchain-ai/open_agent_platform">
          langchain-ai / open_agent_platform
        </a>
      </h2>
      <p class="col-9 color-fg-muted my-1 pr-4">
        Open-source runtime for multi-agent orchestration.
      </p>
      <div class="f6 color-fg-muted mt-2">
        <span itemprop="programmingLanguage">Python</span>
        <a href="/langchain-ai/open_agent_platform/stargazers">6,540</a>
        <a href="/langchain-ai/open_agent_platform/forks">822</a>
        <span class="d-inline-block float-sm-right">381 stars today</span>
      </div>
    </article>
  `;

  const [repository] = parseTrendingHtml(html);

  assert.deepEqual(repository, {
    channel: "trending",
    externalId: "langchain-ai/open_agent_platform",
    title: "open_agent_platform",
    fullName: "langchain-ai/open_agent_platform",
    owner: "langchain-ai",
    sourceUrl: "https://github.com/langchain-ai/open_agent_platform",
    summary: "Open-source runtime for multi-agent orchestration.",
    language: "Python",
    topics: [],
    stars: 6540,
    forks: 822,
    starsToday: 381,
    openIssues: 0,
    watchers: 0,
    license: null,
    archived: false,
    defaultBranch: null,
    createdAt: null,
    updatedAt: null,
    pushedAt: null,
  });
});

test("categorizeRepository and deriveIntegrationHint map common GitHub repository shapes", () => {
  assert.equal(
    categorizeRepository({
      title: "agent-sdk",
      summary: "SDK for hosted agent API calls",
      tags: ["agents", "sdk"],
    }),
    "api",
  );

  assert.equal(
    deriveIntegrationHint({ category: "library", language: "Python" }),
    "Install with uv or pip, then follow the README examples to connect it to your agent workflow.",
  );
});

test("normalized GitHub records carry ranking metadata into the shared schema", () => {
  const normalized = createNormalizedItemFromSourceRecord({
    adapterId: "github",
    sourceType: "github",
    externalId: "acme/open-agent-platform",
    title: "open-agent-platform",
    sourceName: "GitHub",
    sourceUrl: "https://github.com/acme/open-agent-platform",
    sourceUrls: ["https://github.com/acme/open-agent-platform"],
    category: "library",
    summary: "Framework for agent orchestration with tracing and memory.",
    integrationHint:
      "Install with npm or pnpm and review the typed examples before wiring this into an agent runtime.",
    publishedAt: "2026-03-11T19:30:00Z",
    discoveredAt: "2026-03-11T21:00:00Z",
    outboundUrls: ["https://github.com/acme/open-agent-platform"],
    tags: ["github", "ai-agents", "TypeScript"],
    author: "acme",
    metrics: { mentions: 2, upvotes: 275, comments: 0, shares: 0 },
    sourceAuthority: { authority: 95 },
    scoringSignals: {
      recencyHours: 2,
      sourceAuthority: 95,
      mentionCount: 2,
      githubStars: 4250,
      githubActivity: 92,
      socialEngagement: 275,
    },
    metadata: {
      discoveryChannels: ["search", "trending"],
      sourceProvenance: [
        {
          sourceType: "github",
          channel: "search",
          requestUrl:
            "https://api.github.com/search/repositories?q=%22ai%20agent%22",
          fetchedAt: "2026-03-11T21:00:00Z",
          query: '"ai agent"',
          rank: 1,
        },
      ],
      fetchedAt: "2026-03-11T21:00:00Z",
      fetchTimestamps: ["2026-03-11T21:00:00Z"],
    },
    raw: {},
  });

  assert.equal(normalized.category, "library");
  assert.equal(normalized.mentionCount, 2);
  assert.equal(normalized.scoringSignals.githubStars, 4250);
  assert.equal(normalized.scoringSignals.githubActivity, 92);
  assert.equal(normalized.scoringSignals.socialEngagement, 275);
  assert.deepEqual(normalized.metadata.discoveryChannels, ["search", "trending"]);
  assert.equal(normalized.metadata.fetchedAt, "2026-03-11T21:00:00Z");
  assert.deepEqual(normalized.metadata.fetchTimestamps, ["2026-03-11T21:00:00Z"]);
  assert.deepEqual(normalized.metadata.sourceProvenance, [
    {
      sourceType: "github",
      channel: "search",
      requestUrl:
        "https://api.github.com/search/repositories?q=%22ai%20agent%22",
      fetchedAt: "2026-03-11T21:00:00Z",
      query: '"ai agent"',
      rank: 1,
    },
  ]);
});

test("GitHub adapter exposes the normalized source-adapter fetch contract", async () => {
  const searchPayload = {
    items: [
      {
        id: 101,
        name: "open-agent-platform",
        full_name: "acme/open-agent-platform",
        html_url: "https://github.com/acme/open-agent-platform",
        description: "Framework for agent orchestration with tracing and memory.",
        language: "TypeScript",
        topics: ["agents", "framework", "observability"],
        stargazers_count: 4200,
        forks_count: 330,
        watchers_count: 4200,
        open_issues_count: 12,
        archived: false,
        license: { spdx_id: "MIT" },
        default_branch: "main",
        created_at: "2025-11-02T10:00:00Z",
        updated_at: "2026-03-11T20:00:00Z",
        pushed_at: "2026-03-11T19:30:00Z",
        owner: { login: "acme" },
      },
    ],
  };

  const adapter = new GitHubSourceAdapter({
    now: () => "2026-03-11T21:05:00.000Z",
    fetch: async (url) => {
      if (url.includes("/search/repositories")) {
        return makeResponse(searchPayload);
      }

      throw new Error(`Unexpected URL: ${url}`);
    },
    includeTrending: false,
    searchTerms: ['"ai agent"'],
  });

  const result = await adapter.fetch({
    startsAt: "2026-03-10T21:00:00.000Z",
    endsAt: "2026-03-11T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(adapter.descriptor.kind, "github");
  assert.equal(adapter.descriptor.id, "github");
  assert.equal(result.cursor, null);
  assert.deepEqual(result.discoveredSources, []);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].sourceKinds, ["github"]);
  assert.deepEqual(result.items[0].adapterIds, ["github"]);
  assert.equal(result.items[0].name, "open-agent-platform");
  assert.equal(result.items[0].category, "library");
  assert.equal(result.items[0].mentionCount, 1);
  assert.equal(result.items[0].metadata.sourceName, "GitHub");
  assert.equal(result.items[0].metadata.github.entityKey, "acme/open-agent-platform");
  assert.equal(
    result.items[0].metadata.github.repoRootUrl,
    "https://github.com/acme/open-agent-platform",
  );
  assert.equal(result.items[0].metadata.fetchedAt, "2026-03-11T21:05:00.000Z");
  assert.deepEqual(result.items[0].metadata.fetchTimestamps, [
    "2026-03-11T21:05:00.000Z",
  ]);
  assert.equal(result.items[0].metadata.sourceProvenance.length, 1);
  assert.equal(result.items[0].metadata.sourceProvenance[0].adapterId, "github");
  assert.equal(result.items[0].metadata.sourceProvenance[0].sourceKind, "github");
  assert.equal(result.items[0].metadata.sourceProvenance[0].sourceName, "GitHub");
  assert.equal(result.items[0].metadata.sourceProvenance[0].sourceType, "github");
  assert.equal(result.items[0].metadata.sourceProvenance[0].channel, "search");
  assert.equal(result.items[0].metadata.sourceProvenance[0].fetchedAt, "2026-03-11T21:05:00.000Z");
  assert.equal(result.items[0].metadata.sourceProvenance[0].query, '"ai agent"');
  assert.equal(result.items[0].metadata.sourceProvenance[0].rank, 1);
  assert.equal(
    result.items[0].metadata.sourceProvenance[0].requestedUrl,
    result.items[0].metadata.sourceProvenance[0].requestUrl,
  );
  assert.equal(
    result.items[0].metadata.sourceProvenance[0].fetchedFromUrl,
    result.items[0].metadata.sourceProvenance[0].requestUrl,
  );
  assert.match(
    result.items[0].metadata.sourceProvenance[0].requestUrl,
    /^https:\/\/api\.github\.com\/search\/repositories\?/,
  );
  assert.match(
    result.items[0].metadata.sourceProvenance[0].requestUrl,
    /q=%22ai\+agent%22\+in%3Aname%2Cdescription%2Creadme/,
  );
  assert.deepEqual(result.items[0].metadata.github.searchRanks, [1]);
  assert.deepEqual(result.items[0].metadata.github.trendingRanks, []);
});

test("defineSourceAdapter preserves bound fetch methods for concrete GitHub adapters", async () => {
  const adapter = defineSourceAdapter(
    new GitHubSourceAdapter({
      fetch: async (url) => {
        if (url.includes("/search/repositories")) {
          return makeResponse({
            items: [
              {
                id: 101,
                name: "open-agent-platform",
                full_name: "acme/open-agent-platform",
                html_url: "https://github.com/acme/open-agent-platform",
                description: "Framework for agent orchestration with tracing and memory.",
                language: "TypeScript",
                topics: ["agents", "framework", "observability"],
                stargazers_count: 4200,
                forks_count: 330,
                watchers_count: 4200,
                open_issues_count: 12,
                archived: false,
                license: { spdx_id: "MIT" },
                default_branch: "main",
                created_at: "2025-11-02T10:00:00Z",
                updated_at: "2026-03-11T20:00:00Z",
                pushed_at: "2026-03-11T19:30:00Z",
                owner: { login: "acme" },
              },
            ],
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      includeTrending: false,
      searchTerms: ['"ai agent"'],
    }),
  );

  const result = await adapter.fetch({
    startsAt: "2026-03-10T21:00:00.000Z",
    endsAt: "2026-03-11T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "github-acme/open-agent-platform");
});

test("fetchItems normalizes search and trending results and merges duplicate repositories", async () => {
  const searchPayload = {
    items: [
      {
        id: 101,
        name: "open-agent-platform",
        full_name: "acme/open-agent-platform",
        html_url: "https://github.com/acme/open-agent-platform",
        description: "Framework for agent orchestration with tracing and memory.",
        language: "TypeScript",
        topics: ["agents", "framework", "observability"],
        stargazers_count: 4200,
        forks_count: 330,
        watchers_count: 4200,
        open_issues_count: 12,
        archived: false,
        license: { spdx_id: "MIT" },
        default_branch: "main",
        created_at: "2025-11-02T10:00:00Z",
        updated_at: "2026-03-11T20:00:00Z",
        pushed_at: "2026-03-11T19:30:00Z",
        owner: { login: "acme" },
      },
      {
        id: 202,
        name: "agent-runbook",
        full_name: "docs/agent-runbook",
        html_url: "https://github.com/docs/agent-runbook",
        description: "Practical guide and benchmark suite for agent engineering.",
        language: "Markdown",
        topics: ["guide", "benchmark"],
        stargazers_count: 89,
        forks_count: 9,
        watchers_count: 89,
        open_issues_count: 0,
        archived: false,
        license: { spdx_id: "Apache-2.0" },
        default_branch: "main",
        created_at: "2026-01-10T08:00:00Z",
        updated_at: "2026-03-11T21:00:00Z",
        pushed_at: "2026-03-11T21:00:00Z",
        owner: { login: "docs" },
      },
    ],
  };

  const trendingHtml = `
    <article class="Box-row">
      <h2><a href="/acme/open-agent-platform">acme / open-agent-platform</a></h2>
      <p>Framework for agent orchestration with tracing and memory.</p>
      <span itemprop="programmingLanguage">TypeScript</span>
      <a href="/acme/open-agent-platform/stargazers">4,250</a>
      <a href="/acme/open-agent-platform/forks">341</a>
      <span>275 stars today</span>
    </article>
    <article class="Box-row">
      <h2><a href="/vendor/agent-cloud-api">vendor / agent-cloud-api</a></h2>
      <p>Hosted API and control plane for autonomous agent deployments.</p>
      <span itemprop="programmingLanguage">Go</span>
      <a href="/vendor/agent-cloud-api/stargazers">1,200</a>
      <a href="/vendor/agent-cloud-api/forks">120</a>
      <span>83 stars today</span>
    </article>
  `;

  const requests = [];
  const fetch = async (url) => {
    requests.push(url);

    if (url.includes("/search/repositories")) {
      return makeResponse(searchPayload);
    }

    if (url.includes("/trending")) {
      return makeResponse(trendingHtml);
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const adapter = new GitHubSourceAdapter({
    now: (() => {
      const timestamps = [
        "2026-03-11T21:00:00.000Z",
        "2026-03-11T21:03:00.000Z",
      ];

      return () => timestamps.shift() ?? "2026-03-11T21:03:00.000Z";
    })(),
    fetch,
    searchTerms: ['"ai agent"'],
    searchLimit: 5,
  });

  const records = await adapter.fetchItems({
    since: "2026-03-10T21:00:00Z",
    until: "2026-03-11T21:00:00Z",
  });

  assert.equal(records.length, 3);
  assert.equal(requests.length, 2);
  assert.match(requests[0], /search\/repositories/);
  assert.match(requests[1], /trending\?since=daily/);

  const merged = records.find((item) => item.externalId === "acme/open-agent-platform");
  assert.ok(merged);
  assert.equal(merged.category, "library");
  assert.equal(merged.sourceUrl, "https://github.com/acme/open-agent-platform");
  assert.equal(merged.metrics.mentions, 2);
  assert.deepEqual(merged.metadata.discoveryChannels.sort(), ["search", "trending"]);
  assert.equal(merged.metadata.fetchedAt, "2026-03-11T21:03:00.000Z");
  assert.deepEqual(merged.metadata.fetchTimestamps, [
    "2026-03-11T21:00:00.000Z",
    "2026-03-11T21:03:00.000Z",
  ]);
  assert.equal(merged.scoringSignals.githubStars, 4250);
  assert.equal(merged.scoringSignals.socialEngagement, 275);
  assert.equal(merged.metadata.github.entityKey, "acme/open-agent-platform");
  assert.equal(
    merged.metadata.github.repoRootUrl,
    "https://github.com/acme/open-agent-platform",
  );
  assert.deepEqual(merged.metadata.github.channels.sort(), ["search", "trending"]);
  assert.deepEqual(merged.metadata.github.searchRanks, [1]);
  assert.deepEqual(merged.metadata.github.trendingRanks, [1]);
  assert.deepEqual(
    merged.metadata.sourceProvenance.map((entry) => ({
      adapterId: entry.adapterId,
      sourceKind: entry.sourceKind,
      sourceName: entry.sourceName,
      channel: entry.channel,
      fetchedAt: entry.fetchedAt,
      rank: entry.rank,
      query: entry.query ?? null,
    })),
    [
      {
        adapterId: "github",
        sourceKind: "github",
        sourceName: "GitHub",
        channel: "search",
        fetchedAt: "2026-03-11T21:00:00.000Z",
        rank: 1,
        query: '"ai agent"',
      },
      {
        adapterId: "github",
        sourceKind: "github",
        sourceName: "GitHub",
        channel: "trending",
        fetchedAt: "2026-03-11T21:03:00.000Z",
        rank: 1,
        query: null,
      },
    ],
  );
  assert.deepEqual(
    merged.metadata.github.provenance.map((entry) => ({
      adapterId: entry.adapterId,
      sourceKind: entry.sourceKind,
      sourceName: entry.sourceName,
      channel: entry.channel,
      fetchedAt: entry.fetchedAt,
      rank: entry.rank,
      query: entry.query ?? null,
    })),
    [
      {
        adapterId: "github",
        sourceKind: "github",
        sourceName: "GitHub",
        channel: "search",
        fetchedAt: "2026-03-11T21:00:00.000Z",
        rank: 1,
        query: '"ai agent"',
      },
      {
        adapterId: "github",
        sourceKind: "github",
        sourceName: "GitHub",
        channel: "trending",
        fetchedAt: "2026-03-11T21:03:00.000Z",
        rank: 1,
        query: null,
      },
    ],
  );
  assert.equal(merged.metadata.github.language, "TypeScript");
  assert.equal(merged.metadata.github.forks, 341);
  assert.equal(
    merged.integrationHint,
    "Install with npm or pnpm and review the typed examples before wiring this into an agent runtime.",
  );

  const apiItem = records.find((item) => item.externalId === "vendor/agent-cloud-api");
  assert.ok(apiItem);
  assert.equal(apiItem.category, "api");
  assert.equal(
    apiItem.integrationHint,
    "Review the README for endpoint shape, auth requirements, and deployment guidance before connecting an agent to it.",
  );

  const techniqueItem = records.find((item) => item.externalId === "docs/agent-runbook");
  assert.ok(techniqueItem);
  assert.equal(techniqueItem.category, "technique");
  assert.deepEqual(techniqueItem.metadata.searchQueries, ['"ai agent"']);
});

test("fetchItems paginates GitHub repository search results", async () => {
  const requests = [];
  const adapter = new GitHubSourceAdapter({
    includeTrending: false,
    searchTerms: ['"ai agent"'],
    fetch: async (url) => {
      requests.push(url);
      const page = new URL(url).searchParams.get("page");

      if (page === "1") {
        return makeResponse({
          total_count: 3,
          items: [
            createSearchRepository({
              name: "open-agent-platform",
              fullName: "acme/open-agent-platform",
              description: "Framework for agent orchestration with tracing and memory.",
              topics: ["agents", "framework"],
              stars: 4200,
              forks: 330,
              owner: "acme",
            }),
            createSearchRepository({
              name: "browser-agent",
              fullName: "builder/browser-agent",
              description: "Browser agent runtime for resilient web automation.",
              topics: ["agents", "browser"],
              stars: 900,
              forks: 80,
              owner: "builder",
            }),
          ],
        });
      }

      if (page === "2") {
        return makeResponse({
          total_count: 3,
          items: [
            createSearchRepository({
              name: "agent-cloud-api",
              fullName: "vendor/agent-cloud-api",
              description: "Hosted API for autonomous agent deployments.",
              topics: ["agents", "api"],
              stars: 1200,
              forks: 120,
              language: "Go",
              owner: "vendor",
            }),
          ],
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const records = await adapter.fetchItems({
    since: "2026-03-10T21:00:00Z",
    until: "2026-03-11T21:00:00Z",
    searchLimit: 3,
    searchPageSize: 2,
  });

  assert.equal(requests.length, 2);
  assert.match(requests[0], /per_page=2/);
  assert.match(requests[0], /page=1/);
  assert.match(requests[1], /page=2/);
  assert.equal(records.length, 3);

  const secondRanked = records.find(
    (item) => item.externalId === "builder/browser-agent",
  );
  assert.ok(secondRanked);
  assert.deepEqual(secondRanked.metadata.github.searchRanks, [2]);
  assert.equal(secondRanked.metadata.sourceProvenance[0].rank, 2);

  const thirdRanked = records.find(
    (item) => item.externalId === "vendor/agent-cloud-api",
  );
  assert.ok(thirdRanked);
  assert.deepEqual(thirdRanked.metadata.github.searchRanks, [3]);
  assert.equal(thirdRanked.metadata.sourceProvenance[0].rank, 3);
  assert.equal(thirdRanked.category, "api");
});

test("fetchItems retries GitHub search requests when rate limited", async () => {
  const fetchCalls = [];
  const sleepCalls = [];
  const adapter = new GitHubSourceAdapter({
    includeTrending: false,
    searchTerms: ['"ai agent"'],
    rateLimitMaxRetries: 1,
    rateLimitRetryAfterMs: 25,
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });

      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          headers: {
            get(name) {
              return name.toLowerCase() === "retry-after" ? "0" : null;
            },
          },
        };
      }

      return makeResponse({
        total_count: 1,
        items: [
          createSearchRepository({
            name: "open-agent-platform",
            fullName: "acme/open-agent-platform",
            description: "Framework for agent orchestration with tracing and memory.",
            topics: ["agents", "framework"],
            stars: 4200,
            forks: 330,
            owner: "acme",
          }),
        ],
      });
    },
  });

  const records = await adapter.fetchItems({
    since: "2026-03-10T21:00:00Z",
    until: "2026-03-11T21:00:00Z",
  });

  assert.equal(fetchCalls.length, 2);
  assert.deepEqual(sleepCalls, []);
  assert.equal(
    fetchCalls[0].options.headers.accept,
    "application/vnd.github+json",
  );
  assert.equal(records.length, 1);
});

test("fetchItems surfaces GitHub search request failures", async () => {
  const adapter = new GitHubSourceAdapter({
    fetch: async (url) => {
      if (url.includes("/search/repositories")) {
        return {
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    },
    searchTerms: ['"ai agent"'],
  });

  await assert.rejects(
    adapter.fetchItems({
      since: "2026-03-10T21:00:00Z",
      until: "2026-03-11T21:00:00Z",
    }),
    (error) => {
      assert.ok(error instanceof SourceAdapterConfigurationError);
      assert.match(error.message, /GitHub adapter search request failed: 503 Service Unavailable/);
      return true;
    },
  );
});

function createSearchRepository({
  id = 101,
  name,
  fullName,
  description,
  language = "TypeScript",
  topics = [],
  stars = 100,
  forks = 10,
  watchers = stars,
  openIssues = 0,
  archived = false,
  license = "MIT",
  defaultBranch = "main",
  createdAt = "2025-11-02T10:00:00Z",
  updatedAt = "2026-03-11T20:00:00Z",
  pushedAt = "2026-03-11T19:30:00Z",
  owner = "acme",
  homepage = null,
}) {
  return {
    id,
    name,
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    description,
    language,
    topics,
    stargazers_count: stars,
    forks_count: forks,
    watchers_count: watchers,
    open_issues_count: openIssues,
    archived,
    license: license ? { spdx_id: license } : null,
    default_branch: defaultBranch,
    created_at: createdAt,
    updated_at: updatedAt,
    pushed_at: pushedAt,
    owner: { login: owner },
    homepage,
  };
}

function makeResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
    text: async () => payload,
  };
}
