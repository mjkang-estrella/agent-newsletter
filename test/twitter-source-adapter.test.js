import test from "node:test";
import assert from "node:assert/strict";

import { createSourceAdapters } from "../src/sources/create-source-adapters.js";
import { DEFAULT_AGENT_SUBREDDITS } from "../src/sources/reddit-source-adapter.js";
import { SourceAdapterNotImplementedError } from "../src/sources/source-adapter.js";
import {
  DEFAULT_TWITTER_MAX_RESULTS,
  TwitterSourceAdapter,
} from "../src/sources/twitter-source-adapter.js";
import {
  DEFAULT_TWITTER_RATE_LIMIT_RETRY_AFTER_MS,
  ensureTwitterProviderClient,
} from "../src/sources/twitter-provider-client.js";

test("twitter adapter reports credential status from bearer token wiring", () => {
  const adapter = new TwitterSourceAdapter({
    enabled: true,
    bearerToken: "token-value",
  });

  assert.deepEqual(adapter.getCredentialStatus(), {
    configured: true,
    missing: [],
    authStrategy: "bearer-token",
  });
});

test("twitter adapter builds a redacted provider request plan", () => {
  const adapter = new TwitterSourceAdapter({
    enabled: true,
    bearerToken: "token-value",
    accountId: "acct_123",
    rateLimitMaxRetries: 2,
    rateLimitRetryAfterMs: 1500,
  });

  const plan = adapter.buildRequestPlan({
    since: "2025-03-10T00:00:00.000Z",
    until: "2025-03-11T00:00:00.000Z",
  });

  assert.equal(plan.provider, "twitter-api-v2");
  assert.equal(plan.interfaceVersion, 1);
  assert.equal(plan.method, "GET");
  assert.equal(plan.url, "https://api.x.com/2/tweets/search/recent");
  assert.equal(plan.headers.authorization, "Bearer [configured]");
  assert.equal(plan.accountId, "acct_123");
  assert.deepEqual(plan.auth, {
    strategy: "bearer-token",
    accountId: "acct_123",
  });
  assert.deepEqual(plan.rateLimit, {
    maxRetries: 2,
    defaultRetryAfterMs: 1500,
  });
  assert.match(plan.params.query, /AI agent/);
});

test("twitter adapter builds a provider request context for injected clients", () => {
  const adapter = new TwitterSourceAdapter({
    enabled: true,
    bearerToken: "token-value",
  });

  const context = adapter.buildRequestContext({
    since: "2025-03-10T00:00:00.000Z",
    until: "2025-03-11T00:00:00.000Z",
  });

  assert.equal(context.interfaceVersion, 1);
  assert.equal(context.adapterId, "x-twitter");
  assert.equal(context.adapterName, "X/Twitter");
  assert.equal(context.provider, "twitter-api-v2");
  assert.deepEqual(context.auth, {
    configured: true,
    strategy: "bearer-token",
    accountId: null,
  });
  assert.deepEqual(context.rateLimit, {
    maxRetries: 0,
    defaultRetryAfterMs: DEFAULT_TWITTER_RATE_LIMIT_RETRY_AFTER_MS,
  });
  assert.equal(context.providerContract.provider, "twitter-api-v2");
  assert.equal(context.requestPlan.url, "https://api.x.com/2/tweets/search/recent");
});

test("twitter adapter exposes a provider contract for later live wiring", () => {
  const authHook = () => ({ authorization: "Bearer custom-token" });
  const adapter = new TwitterSourceAdapter({
    enabled: true,
    provider: "x-enterprise",
    bearerToken: "token-value",
    rateLimitMaxRetries: 3,
    rateLimitRetryAfterMs: 5000,
    providerHooks: {
      buildAuthHeaders: authHook,
    },
  });

  assert.equal(adapter.providerContract.adapterId, "x-twitter");
  assert.equal(adapter.providerContract.adapterName, "X/Twitter");
  assert.equal(adapter.providerContract.provider, "x-enterprise");
  assert.equal(adapter.providerContract.auth.strategy, "bearer-token");
  assert.equal(adapter.providerContract.rateLimit.maxRetries, 3);
  assert.equal(adapter.providerContract.rateLimit.defaultRetryAfterMs, 5000);
  assert.equal(adapter.providerContract.hooks.buildAuthHeaders, authHook);
});

test("twitter adapter delegates execution to an injected provider client", async () => {
  const calls = [];
  const client = {
    async searchRecent(context) {
      calls.push(context);

      return {
        cursor: "cursor-2",
        records: [
          {
            externalId: "tweet-123",
            title: "Agent SDK launch thread",
            sourceName: "@builder",
            sourceUrl: "https://x.com/builder/status/123",
            publishedAt: "2025-03-10T23:00:00.000Z",
            summary: "New SDK for browser agents with an MCP bridge.",
            outboundUrls: [
              "https://docs.example.com/agent-sdk",
              "https://github.com/acme/agent-sdk",
            ],
            tags: ["twitter", "sdk", "ai-agents"],
            author: "builder",
            metrics: {
              mentions: 3,
              upvotes: 47,
              comments: 11,
              shares: 5,
            },
            sourceAuthority: {
              authority: 72,
            },
            raw: {
              id: "123",
            },
          },
        ],
      };
    },
  };
  const adapter = new TwitterSourceAdapter({
    enabled: true,
    bearerToken: "token-value",
    query: "agentic tooling",
    maxResults: 40,
    client,
  });

  const records = await adapter.fetchItems({
    since: "2025-03-10T00:00:00.000Z",
    until: "2025-03-11T00:00:00.000Z",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].adapterId, "x-twitter");
  assert.equal(calls[0].adapterName, "X/Twitter");
  assert.equal(calls[0].requestPlan.params.query, "agentic tooling");
  assert.equal(calls[0].requestPlan.params.max_results, 40);
  assert.equal(records.length, 1);
  assert.equal(records[0].adapterId, "x-twitter");
  assert.equal(records[0].sourceType, "twitter");
  assert.equal(records[0].externalId, "tweet-123");
});

test("twitter adapter executes the default API v2 client and normalizes tweet payloads", async () => {
  const calls = [];
  const adapter = new TwitterSourceAdapter({
    enabled: true,
    bearerToken: "token-value",
    fetch: async (url, options) => {
      calls.push({ url, options });

      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: "123",
              author_id: "user-1",
              conversation_id: "123",
              text:
                "Agent SDK is live. Docs: https://t.co/docs Repo: https://t.co/repo #AIAgents",
              created_at: "2025-03-10T23:00:00.000Z",
              lang: "en",
              possibly_sensitive: false,
              public_metrics: {
                like_count: 47,
                reply_count: 11,
                retweet_count: 4,
                quote_count: 1,
              },
              entities: {
                urls: [
                  {
                    url: "https://t.co/docs",
                    expanded_url: "https://docs.example.com/agent-sdk",
                  },
                  {
                    url: "https://t.co/repo",
                    expanded_url: "https://github.com/acme/agent-sdk",
                  },
                ],
                hashtags: [{ tag: "AIAgents" }],
              },
            },
          ],
          includes: {
            users: [
              {
                id: "user-1",
                username: "builder",
                name: "Builder",
                verified: true,
                public_metrics: {
                  followers_count: 22000,
                },
              },
            ],
          },
          meta: {
            next_token: "cursor-2",
          },
        }),
      };
    },
  });

  const records = await adapter.fetchItems({
    since: "2025-03-10T00:00:00.000Z",
    until: "2025-03-11T00:00:00.000Z",
  });

  assert.equal(calls.length, 1);
  assert.match(
    calls[0].url,
    /https:\/\/api\.x\.com\/2\/tweets\/search\/recent\?/,
  );
  assert.match(calls[0].url, /query=/);
  assert.match(calls[0].url, /start_time=2025-03-10T00%3A00%3A00.000Z/);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.authorization, "Bearer token-value");

  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    adapterId: "x-twitter",
    sourceType: "twitter",
    externalId: "123",
    title: "Agent SDK is live.",
    sourceName: "@builder",
    sourceUrl: "https://x.com/builder/status/123",
    publishedAt: "2025-03-10T23:00:00.000Z",
    discoveredAt: "2025-03-11T00:00:00.000Z",
    summary: "Agent SDK is live. Docs: Repo: #AIAgents",
    outboundUrls: [
      "https://docs.example.com/agent-sdk",
      "https://github.com/acme/agent-sdk",
    ],
    tags: ["twitter", "ai-agents", "aiagents", "author:builder"],
    category: "api",
    integrationHint:
      "Review the linked API docs and auth model, then validate quotas and failure modes before wiring it into an agent.",
    sourceSentiment: "positive",
    author: "builder",
    metrics: {
      mentions: 1,
      upvotes: 47,
      comments: 11,
      shares: 5,
    },
    sourceAuthority: {
      authority: 85,
    },
    scoringSignals: {
      recencyHours: 1,
      sourceAuthority: 85,
      mentionCount: 1,
      githubStars: null,
      githubActivity: null,
      socialEngagement: 63,
    },
    riskWarning: {
      severity: "low",
      description:
        "Social posts can amplify marketing claims. Validate the linked docs or repository before integrating it.",
    },
    metadata: {
      provider: "twitter-api-v2",
      query:
        '("AI agent" OR "agentic" OR "autonomous agent") (tool OR API OR library OR framework OR SDK)',
      authorId: "user-1",
      conversationId: "123",
      language: "en",
      hashtags: ["aiagents"],
      verifiedAuthor: true,
      followerCount: 22000,
    },
    raw: {
      id: "123",
      authorId: "user-1",
      conversationId: "123",
    },
  });
});

test("twitter adapter exposes the shared fetch contract with a concrete descriptor", async () => {
  const adapter = new TwitterSourceAdapter({
    enabled: true,
    bearerToken: "token-value",
    client: {
      async searchRecent() {
        return {
          cursor: "cursor-2",
          records: [
            {
              adapterId: "x-twitter",
              sourceType: "twitter",
              externalId: "tweet-123",
              title: "Agent SDK launch thread",
              sourceName: "@builder",
              sourceUrl: "https://x.com/builder/status/123?b=2&a=1#details",
              publishedAt: "2025-03-10T23:00:00.000Z",
              discoveredAt: "2025-03-11T00:00:00.000Z",
              summary: "New SDK for browser agents with an MCP bridge.",
              outboundUrls: [
                "https://docs.example.com/agent-sdk",
                "https://github.com/acme/agent-sdk",
              ],
              tags: ["twitter", "ai-agents", "sdk"],
              category: "library",
              integrationHint: "Inspect the linked repository before integrating it.",
              author: "builder",
              metrics: {
                mentions: 3,
                upvotes: 47,
                comments: 11,
                shares: 5,
              },
              sourceAuthority: {
                authority: 72,
              },
              raw: {
                id: "123",
              },
            },
          ],
        };
      },
    },
  });

  const result = await adapter.fetch({
    startsAt: "2025-03-10T00:00:00.000Z",
    endsAt: "2025-03-11T00:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(adapter.descriptor.id, "x-twitter");
  assert.equal(adapter.descriptor.kind, "x");
  assert.equal(result.cursor, "cursor-2");
  assert.deepEqual(result.discoveredSources, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "x-twitter-tweet-123");
  assert.equal(result.items[0].sourceUrl, "https://x.com/builder/status/123?a=1&b=2");
  assert.deepEqual(result.items[0].sourceKinds, ["x"]);
  assert.deepEqual(result.items[0].adapterIds, ["x-twitter"]);
});

test("twitter adapter runs auth and rate-limit hooks without changing fetcher wiring", async () => {
  const hookCalls = {
    buildAuthHeaders: [],
    beforeRequest: [],
    afterResponse: [],
    onRateLimit: [],
  };
  const fetchCalls = [];
  const adapter = new TwitterSourceAdapter({
    enabled: true,
    bearerToken: "token-value",
    rateLimitMaxRetries: 1,
    rateLimitRetryAfterMs: 25,
    providerHooks: {
      async buildAuthHeaders({ requestContext, providerContract }) {
        hookCalls.buildAuthHeaders.push({
          provider: requestContext.provider,
          authStrategy: providerContract.auth.strategy,
        });

        return {
          accept: "application/json",
          authorization: "Bearer hook-token",
          "user-agent": "hook-agent-newsletter/1.0",
        };
      },
      async beforeRequest({ attempt, request, requestContext }) {
        hookCalls.beforeRequest.push({
          attempt,
          url: request.url,
          maxRetries: requestContext.rateLimit.maxRetries,
        });

        return {
          headers: {
            "x-trace-id": `trace-${attempt}`,
          },
        };
      },
      async afterResponse({ attempt, response }) {
        hookCalls.afterResponse.push({
          attempt,
          status: response.status,
        });
      },
      async onRateLimit({ attempt, retryAfterMs, requestContext }) {
        hookCalls.onRateLimit.push({
          attempt,
          retryAfterMs,
          provider: requestContext.provider,
        });

        return {
          retry: true,
          retryAfterMs: 0,
        };
      },
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

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          data: [],
          meta: {},
        }),
      };
    },
  });

  const records = await adapter.fetchItems({
    since: "2025-03-10T00:00:00.000Z",
    until: "2025-03-11T00:00:00.000Z",
  });

  assert.deepEqual(records, []);
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].options.headers.authorization, "Bearer hook-token");
  assert.equal(fetchCalls[0].options.headers["x-trace-id"], "trace-0");
  assert.equal(fetchCalls[1].options.headers["x-trace-id"], "trace-1");
  assert.deepEqual(hookCalls.buildAuthHeaders, [
    {
      provider: "twitter-api-v2",
      authStrategy: "bearer-token",
    },
    {
      provider: "twitter-api-v2",
      authStrategy: "bearer-token",
    },
  ]);
  assert.deepEqual(hookCalls.beforeRequest, [
    {
      attempt: 0,
      url: fetchCalls[0].url,
      maxRetries: 1,
    },
    {
      attempt: 1,
      url: fetchCalls[1].url,
      maxRetries: 1,
    },
  ]);
  assert.deepEqual(hookCalls.afterResponse, [
    {
      attempt: 0,
      status: 429,
    },
    {
      attempt: 1,
      status: 200,
    },
  ]);
  assert.deepEqual(hookCalls.onRateLimit, [
    {
      attempt: 0,
      retryAfterMs: 0,
      provider: "twitter-api-v2",
    },
  ]);
});

test("twitter provider client normalizes legacy and structured response shapes", async () => {
  const legacyClient = ensureTwitterProviderClient({
    async searchRecentRecords(context) {
      return [
        {
          title: "Legacy record",
          sourceUrl: "https://x.com/builder/status/legacy",
          summary: "Legacy provider responses still map into the new contract.",
        },
      ];
    },
  });

  const legacyResponse = await legacyClient.searchRecent({
    adapterId: "x-twitter",
    adapterName: "X/Twitter",
    requestPlan: { url: "https://api.x.com/2/tweets/search/recent" },
  });

  assert.equal(legacyResponse.cursor, null);
  assert.equal(legacyResponse.records[0].adapterId, "x-twitter");
  assert.equal(legacyResponse.records[0].sourceType, "twitter");
});

test("twitter adapter keeps the stub boundary for custom providers without a client", async () => {
  const adapter = new TwitterSourceAdapter({
    enabled: true,
    provider: "x-enterprise",
    bearerToken: "token-value",
  });

  await assert.rejects(
    adapter.fetchItems({
      since: "2025-03-10T00:00:00.000Z",
      until: "2025-03-11T00:00:00.000Z",
    }),
    (error) => {
      assert.ok(error instanceof SourceAdapterNotImplementedError);
      assert.equal(
        error.details.requestPlan.url,
        "https://api.x.com/2/tweets/search/recent",
      );
      assert.equal(error.details.requestPlan.provider, "x-enterprise");
      assert.equal(error.details.interfaceVersion, 1);
      return true;
    },
  );
});

test("twitter adapter treats placeholder credentials as missing config", () => {
  const adapter = new TwitterSourceAdapter({
    enabled: true,
    bearerToken: "<TWITTER_BEARER_TOKEN>",
  });

  assert.deepEqual(adapter.getCredentialStatus(), {
    configured: false,
    missing: ["bearerToken or apiKey/apiSecret"],
    authStrategy: "placeholder",
    placeholders: ["bearerToken"],
  });
  assert.throws(() => adapter.validateConfig(), /requires either `bearerToken`/);
});

test("twitter adapter requires credentials when enabled", () => {
  const adapter = new TwitterSourceAdapter({
    enabled: true,
  });

  assert.throws(() => adapter.validateConfig(), /requires either `bearerToken`/);
});

test("twitter adapter rejects malformed provider responses", async () => {
  const adapter = new TwitterSourceAdapter({
    enabled: true,
    bearerToken: "token-value",
    client: {
      async searchRecent() {
        return {
          records: {},
        };
      },
    },
  });

  await assert.rejects(
    adapter.fetchItems({
      since: "2025-03-10T00:00:00.000Z",
      until: "2025-03-11T00:00:00.000Z",
    }),
    /must return either an array of source records or \{ records, cursor\? \}/,
  );
});

test("createSourceAdapters wires env config for arxiv, github, reddit, and twitter adapters", () => {
  const arxivFetch = async () => ({ ok: true, text: async () => "" });
  const githubFetch = async () => ({ ok: true, json: async () => ({ items: [] }) });
  const adapters = createSourceAdapters(
    {
      ARXIV_ENABLED: "true",
      ARXIV_BASE_URL: "https://arxiv.example.com/query",
      ARXIV_USER_AGENT: "arxiv-agent-newsletter/1.0",
      ARXIV_QUERY: "all:\"agent memory\"",
      ARXIV_MAX_RESULTS: "15",
      GITHUB_ENABLED: "true",
      GITHUB_API_BASE_URL: "https://api.github.example.com",
      GITHUB_WEB_BASE_URL: "https://github.example.com",
      GITHUB_USER_AGENT: "github-agent-newsletter/1.0",
      GITHUB_SEARCH_TERMS: '"ai agent","browser agent"',
      GITHUB_TRENDING_SINCE: "weekly",
      GITHUB_INCLUDE_TRENDING: "true",
      GITHUB_SEARCH_LIMIT: "15",
      GITHUB_TOKEN: "ghp_example",
      GITHUB_RATE_LIMIT_MAX_RETRIES: "2",
      GITHUB_RATE_LIMIT_RETRY_AFTER_MS: "750",
      REDDIT_ENABLED: "true",
      REDDIT_SUBREDDITS: "AutoGPT,LocalLLaMA",
      REDDIT_USER_AGENT: "custom-agent-newsletter/1.0",
      REDDIT_ACCESS_TOKEN: "reddit-oauth-token",
      REDDIT_RATE_LIMIT_MAX_RETRIES: "1",
      REDDIT_RATE_LIMIT_RETRY_AFTER_MS: "250",
      TWITTER_ENABLED: "true",
      TWITTER_PROVIDER: "x-enterprise",
      TWITTER_BASE_URL: "https://api.x.example.com/2",
      TWITTER_QUERY: "agentic tooling",
      TWITTER_MAX_RESULTS: "40",
      TWITTER_BEARER_TOKEN: "token-value",
      TWITTER_RATE_LIMIT_MAX_RETRIES: "2",
      TWITTER_RATE_LIMIT_RETRY_AFTER_MS: "1500",
    },
    {
      arxivFetch,
      githubFetch,
    },
  );

  assert.equal(adapters.arxiv.enabled, true);
  assert.equal(adapters.arxiv.baseUrl, "https://arxiv.example.com/query");
  assert.equal(adapters.arxiv.userAgent, "arxiv-agent-newsletter/1.0");
  assert.equal(adapters.arxiv.query, 'all:"agent memory"');
  assert.equal(adapters.arxiv.maxResults, 15);
  assert.equal(adapters.arxiv.fetchImpl, arxivFetch);
  assert.equal(adapters.github.enabled, true);
  assert.equal(adapters.github.apiBaseUrl, "https://api.github.example.com");
  assert.equal(adapters.github.webBaseUrl, "https://github.example.com");
  assert.equal(adapters.github.userAgent, "github-agent-newsletter/1.0");
  assert.deepEqual(adapters.github.searchTerms, ['"ai agent"', '"browser agent"']);
  assert.equal(adapters.github.trendingSince, "weekly");
  assert.equal(adapters.github.includeTrending, true);
  assert.equal(adapters.github.searchLimit, 15);
  assert.equal(adapters.github.rateLimitMaxRetries, 2);
  assert.equal(adapters.github.rateLimitRetryAfterMs, 750);
  assert.equal(adapters.github.fetchImpl, githubFetch);
  assert.equal(adapters.github.getCredentialStatus().authStrategy, "bearer-token");
  assert.deepEqual(adapters.reddit.subreddits, ["AutoGPT", "LocalLLaMA"]);
  assert.equal(adapters.reddit.userAgent, "custom-agent-newsletter/1.0");
  assert.equal(adapters.reddit.accessToken, "reddit-oauth-token");
  assert.equal(adapters.reddit.rateLimitMaxRetries, 1);
  assert.equal(adapters.reddit.rateLimitRetryAfterMs, 250);
  assert.equal(adapters.reddit.getCredentialStatus().authStrategy, "oauth-bearer");
  assert.equal(adapters.twitter.enabled, true);
  assert.equal(adapters.twitter.provider, "x-enterprise");
  assert.equal(adapters.twitter.baseUrl, "https://api.x.example.com/2");
  assert.equal(adapters.twitter.query, "agentic tooling");
  assert.equal(adapters.twitter.maxResults, 40);
  assert.equal(adapters.twitter.rateLimitMaxRetries, 2);
  assert.equal(adapters.twitter.rateLimitRetryAfterMs, 1500);
  assert.equal(adapters.twitter.isConfigured(), true);
});

test("createSourceAdapters enables GitHub trending alongside search by default", () => {
  const adapters = createSourceAdapters({}, {
    githubFetch: async () => ({
      ok: true,
      json: async () => ({ items: [] }),
      text: async () => "",
    }),
  });

  assert.equal(adapters.github.includeTrending, true);
});

test("createSourceAdapters uses the default X provider limit and accepts a provider client override", async () => {
  const clientCalls = [];
  const twitterClient = {
    async searchRecentRecords(context) {
      clientCalls.push(context);
      return [];
    },
  };

  const adapters = createSourceAdapters(
    {
      TWITTER_ENABLED: "true",
      TWITTER_BEARER_TOKEN: "token-value",
    },
    { twitterClient },
  );

  assert.equal(adapters.twitter.maxResults, DEFAULT_TWITTER_MAX_RESULTS);

  await adapters.twitter.fetchItems({
    since: "2025-03-10T00:00:00.000Z",
    until: "2025-03-11T00:00:00.000Z",
  });

  assert.equal(clientCalls.length, 1);
  assert.equal(clientCalls[0].requestPlan.params.max_results, DEFAULT_TWITTER_MAX_RESULTS);
});

test("createSourceAdapters wires fetch overrides for reddit and the default X client", async () => {
  const redditCalls = [];
  const twitterCalls = [];
  const adapters = createSourceAdapters(
    {
      TWITTER_ENABLED: "true",
      TWITTER_BEARER_TOKEN: "token-value",
    },
    {
      redditFetch: async (url) => {
        redditCalls.push(url);
        return {
          ok: true,
          json: async () => ({ data: { children: [] } }),
        };
      },
      twitterFetch: async (url) => {
        twitterCalls.push(url);
        return {
          ok: true,
          json: async () => ({ data: [], meta: {} }),
        };
      },
    },
  );

  await adapters.reddit.fetchItems({
    since: "2025-03-10T00:00:00.000Z",
    until: "2025-03-11T00:00:00.000Z",
  });
  await adapters.twitter.fetchItems({
    since: "2025-03-10T00:00:00.000Z",
    until: "2025-03-11T00:00:00.000Z",
  });

  assert.equal(adapters.reddit.fetchImpl instanceof Function, true);
  assert.equal(redditCalls.length, DEFAULT_AGENT_SUBREDDITS.length);
  assert.equal(twitterCalls.length, 1);
});

test("createSourceAdapters accepts a twitter client factory integration point", async () => {
  const factoryCalls = [];
  const clientCalls = [];
  const providerHooks = {
    beforeRequest() {
      return null;
    },
  };
  const adapters = createSourceAdapters(
    {
      TWITTER_ENABLED: "true",
      TWITTER_PROVIDER: "x-enterprise",
      TWITTER_BEARER_TOKEN: "token-value",
    },
    {
      twitterProviderHooks: providerHooks,
      twitterClientFactory({ config, hooks, providerContract, defaultClient }) {
        factoryCalls.push({
          config,
          hooks,
          providerContract,
          hasDefaultClient: typeof defaultClient?.searchRecent === "function",
        });

        return {
          provider: `${config.provider}-runtime`,
          async searchRecent(context) {
            clientCalls.push(context);
            return {
              records: [],
            };
          },
        };
      },
    },
  );

  await adapters.twitter.fetchItems({
    since: "2025-03-10T00:00:00.000Z",
    until: "2025-03-11T00:00:00.000Z",
  });

  assert.deepEqual(factoryCalls, [
    {
      config: {
        provider: "x-enterprise",
        baseUrl: "https://api.x.com/2",
        query:
          '("AI agent" OR "agentic" OR "autonomous agent") (tool OR API OR library OR framework OR SDK)',
        maxResults: DEFAULT_TWITTER_MAX_RESULTS,
        bearerToken: "token-value",
        apiKey: "",
        apiSecret: "",
        accountId: "",
        rateLimitMaxRetries: 0,
        rateLimitRetryAfterMs: DEFAULT_TWITTER_RATE_LIMIT_RETRY_AFTER_MS,
      },
      hooks: {
        buildAuthHeaders: null,
        beforeRequest: providerHooks.beforeRequest,
        afterResponse: null,
        onRateLimit: null,
      },
      providerContract: {
        interfaceVersion: 1,
        adapterId: "x-twitter",
        adapterName: "X/Twitter",
        provider: "x-enterprise",
        config: {
          provider: "x-enterprise",
          baseUrl: "https://api.x.com/2",
          query:
            '("AI agent" OR "agentic" OR "autonomous agent") (tool OR API OR library OR framework OR SDK)',
          maxResults: DEFAULT_TWITTER_MAX_RESULTS,
          bearerToken: "token-value",
          apiKey: "",
          apiSecret: "",
          accountId: "",
          rateLimitMaxRetries: 0,
          rateLimitRetryAfterMs: DEFAULT_TWITTER_RATE_LIMIT_RETRY_AFTER_MS,
        },
        auth: {
          configured: true,
          strategy: "bearer-token",
          missing: [],
          placeholders: [],
          accountId: null,
        },
        rateLimit: {
          maxRetries: 0,
          defaultRetryAfterMs: DEFAULT_TWITTER_RATE_LIMIT_RETRY_AFTER_MS,
        },
        hooks: {
          buildAuthHeaders: null,
          beforeRequest: providerHooks.beforeRequest,
          afterResponse: null,
          onRateLimit: null,
        },
      },
      hasDefaultClient: true,
    },
  ]);
  assert.equal(adapters.twitter.client.provider, "x-enterprise-runtime");
  assert.equal(clientCalls.length, 1);
  assert.equal(clientCalls[0].requestPlan.provider, "x-enterprise");
});
