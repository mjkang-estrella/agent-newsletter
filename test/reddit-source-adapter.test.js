import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_AGENT_SUBREDDITS,
  RedditSourceAdapter,
} from "../src/sources/reddit-source-adapter.js";
import { SourceAdapterConfigurationError } from "../src/sources/source-adapter.js";

test("reddit adapter uses AI agent subreddit seeds by default", () => {
  const adapter = new RedditSourceAdapter({
    fetch: async () => ({
      ok: true,
      json: async () => ({ data: { children: [] } }),
    }),
  });

  assert.deepEqual(adapter.subreddits, DEFAULT_AGENT_SUBREDDITS);
});

test("reddit adapter normalizes configured subreddit names", () => {
  const adapter = new RedditSourceAdapter({
    subreddits: [" /r/AutoGPT/ ", "LocalLLaMA", "r/LocalLLaMA"],
    fetch: async () => ({
      ok: true,
      json: async () => ({ data: { children: [] } }),
    }),
  });

  assert.deepEqual(adapter.subreddits, ["AutoGPT", "LocalLLaMA"]);
});

test("reddit adapter normalizes subreddit posts inside the fetch window", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      url,
      ok: true,
      json: async () => ({
        data: {
          children: [
            {
              data: {
                id: "abc123",
                name: "t3_abc123",
                title: "Agent toolkit released",
                permalink: "/r/AutoGPT/comments/abc123/agent_toolkit_released/",
                selftext:
                  "Useful write-up https://docs.example.com/agent-toolkit",
                url_overridden_by_dest:
                  "https://github.com/example/agent-toolkit",
                author: "builder",
                created_utc: 1741608000,
                ups: 125,
                num_comments: 14,
              },
            },
            {
              data: {
                id: "old456",
                name: "t3_old456",
                title: "Too old",
                permalink: "/r/AutoGPT/comments/old456/too_old/",
                selftext: "",
                author: "builder",
                created_utc: 1741485600,
                ups: 5,
                num_comments: 1,
              },
            },
          ],
        },
      }),
    };
  };

  const adapter = new RedditSourceAdapter({
    subreddits: ["AutoGPT"],
    userAgent: "agent-newsletter-test/1.0",
    now: () => "2025-03-11T00:15:00.000Z",
    fetch,
  });

  const items = await adapter.fetchItems({
    since: "2025-03-10T00:00:00.000Z",
    until: "2025-03-11T00:00:00.000Z",
    limitPerSubreddit: 10,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/r\/AutoGPT\/new\.json\?limit=10&raw_json=1$/);
  assert.equal(
    calls[0].options.headers["user-agent"],
    "agent-newsletter-test/1.0",
  );

  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    adapterId: "reddit",
    sourceType: "reddit",
    externalId: "t3_abc123",
    title: "Agent toolkit released",
    sourceName: "r/AutoGPT",
    sourceUrl:
      "https://www.reddit.com/r/AutoGPT/comments/abc123/agent_toolkit_released/",
    publishedAt: "2025-03-10T12:00:00.000Z",
    discoveredAt: "2025-03-11T00:00:00.000Z",
    summary: "Useful write-up https://docs.example.com/agent-toolkit",
    outboundUrls: [
      "https://docs.example.com/agent-toolkit",
      "https://github.com/example/agent-toolkit",
    ],
    tags: ["AutoGPT", "reddit", "ai-agents"],
    category: "library",
    integrationHint:
      "Inspect the linked repository and installation steps before adding it to an agent runtime.",
    author: "builder",
    metrics: {
      mentions: 1,
      upvotes: 125,
      comments: 14,
      shares: 0,
    },
    sourceAuthority: {
      authority: 62,
    },
    scoringSignals: {
      recencyHours: 12,
      sourceAuthority: 62,
      mentionCount: 1,
      githubStars: null,
      githubActivity: null,
      socialEngagement: 139,
    },
    riskWarning: {
      severity: "low",
      description:
        "Community discussion can be noisy or promotional. Cross-check the linked artifact before integrating it.",
    },
    metadata: {
      subreddit: "AutoGPT",
      subredditUrl: "https://www.reddit.com/r/AutoGPT/",
      listing: "new",
      listingUrl: "https://www.reddit.com/r/AutoGPT/new.json?limit=10&raw_json=1",
      isSelfPost: false,
      linkUrl: "https://github.com/example/agent-toolkit",
      fetchWindow: {
        since: "2025-03-10T00:00:00.000Z",
        until: "2025-03-11T00:00:00.000Z",
      },
      fetchedAt: "2025-03-11T00:15:00.000Z",
      fetchedFromUrl:
        "https://www.reddit.com/r/AutoGPT/new.json?limit=10&raw_json=1",
      sourceProvenance: {
        adapterId: "reddit",
        sourceKind: "reddit",
        sourceName: "Reddit",
        subreddit: "AutoGPT",
        subredditUrl: "https://www.reddit.com/r/AutoGPT/",
        listing: "new",
        listingUrl:
          "https://www.reddit.com/r/AutoGPT/new.json?limit=10&raw_json=1",
        requestUrl:
          "https://www.reddit.com/r/AutoGPT/new.json?limit=10&raw_json=1",
        fetchedFromUrl:
          "https://www.reddit.com/r/AutoGPT/new.json?limit=10&raw_json=1",
        fetchedAt: "2025-03-11T00:15:00.000Z",
      },
      reddit: {
        subreddit: "AutoGPT",
        subredditUrl: "https://www.reddit.com/r/AutoGPT/",
        listing: "new",
        listingUrl:
          "https://www.reddit.com/r/AutoGPT/new.json?limit=10&raw_json=1",
        fetchedAt: "2025-03-11T00:15:00.000Z",
        fetchedFromUrl:
          "https://www.reddit.com/r/AutoGPT/new.json?limit=10&raw_json=1",
        postFullname: "t3_abc123",
        postId: "abc123",
        isSelfPost: false,
        linkUrl: "https://github.com/example/agent-toolkit",
      },
    },
    raw: {
      id: "abc123",
      name: "t3_abc123",
      permalink: "/r/AutoGPT/comments/abc123/agent_toolkit_released/",
      subreddit: "AutoGPT",
      subredditUrl: "https://www.reddit.com/r/AutoGPT/",
      requestUrl:
        "https://www.reddit.com/r/AutoGPT/new.json?limit=10&raw_json=1",
      fetchedFromUrl:
        "https://www.reddit.com/r/AutoGPT/new.json?limit=10&raw_json=1",
    },
  });
});

test("reddit adapter surfaces upstream request failures", async () => {
  const adapter = new RedditSourceAdapter({
    subreddits: ["AutoGPT"],
    fetch: async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    }),
  });

  await assert.rejects(
    adapter.fetchItems({
      since: "2025-03-10T00:00:00.000Z",
      until: "2025-03-11T00:00:00.000Z",
    }),
    (error) => {
      assert.ok(error instanceof SourceAdapterConfigurationError);
      assert.match(error.message, /Reddit adapter request failed for r\/AutoGPT: 429 Too Many Requests/);
      return true;
    },
  );
});

test("reddit adapter supports oauth headers and retries rate limited requests", async () => {
  const fetchCalls = [];
  const sleepCalls = [];
  const adapter = new RedditSourceAdapter({
    subreddits: ["AutoGPT"],
    userAgent: "agent-newsletter-test/1.0",
    accessToken: "reddit-oauth-token",
    rateLimitMaxRetries: 1,
    rateLimitRetryAfterMs: 25,
    now: () => "2025-03-11T00:15:00.000Z",
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

      return {
        ok: true,
        json: async () => ({
          data: {
            children: [
              {
                data: {
                  id: "abc123",
                  name: "t3_abc123",
                  title: "Agent toolkit released",
                  permalink: "/r/AutoGPT/comments/abc123/agent_toolkit_released/",
                  selftext: "Useful write-up",
                  author: "builder",
                  created_utc: 1741608000,
                  ups: 125,
                  num_comments: 14,
                },
              },
            ],
          },
        }),
      };
    },
  });

  const items = await adapter.fetchItems({
    since: "2025-03-10T00:00:00.000Z",
    until: "2025-03-11T00:00:00.000Z",
  });

  assert.equal(adapter.getCredentialStatus().authStrategy, "oauth-bearer");
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].options.headers.authorization, "Bearer reddit-oauth-token");
  assert.equal(fetchCalls[0].options.headers["user-agent"], "agent-newsletter-test/1.0");
  assert.deepEqual(sleepCalls, []);
  assert.equal(items.length, 1);
});

test("reddit adapter exposes the normalized source-adapter fetch contract", async () => {
  const adapter = new RedditSourceAdapter({
    subreddits: ["AutoGPT"],
    now: () => "2025-03-11T00:15:00.000Z",
    fetch: async () => ({
      ok: true,
      url: "https://www.reddit.com/r/AutoGPT/new.json?limit=25&raw_json=1",
      json: async () => ({
        data: {
          children: [
            {
              data: {
                id: "abc123",
                name: "t3_abc123",
                title: "Agent toolkit released",
                permalink: "/r/AutoGPT/comments/abc123/agent_toolkit_released/",
                selftext:
                  "Useful write-up https://docs.example.com/agent-toolkit",
                url_overridden_by_dest:
                  "https://github.com/example/agent-toolkit",
                author: "builder",
                created_utc: 1741608000,
                ups: 125,
                num_comments: 14,
              },
            },
          ],
        },
      }),
    }),
  });

  const result = await adapter.fetch({
    startsAt: "2025-03-10T00:00:00.000Z",
    endsAt: "2025-03-11T00:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(adapter.descriptor.id, "reddit");
  assert.equal(adapter.descriptor.kind, "reddit");
  assert.equal(result.cursor, null);
  assert.deepEqual(result.discoveredSources, []);
  assert.equal(result.items.length, 1);

  const item = result.items[0];
  assert.equal(item.id, "reddit-t3_abc123");
  assert.equal(item.name, "Agent toolkit released");
  assert.equal(
    item.sourceUrl,
    "https://www.reddit.com/r/AutoGPT/comments/abc123/agent_toolkit_released",
  );
  assert.deepEqual(item.sourceKinds, ["reddit"]);
  assert.deepEqual(item.adapterIds, ["reddit"]);
  assert.equal(item.category, "library");
  assert.equal(item.mentionCount, 1);
  assert.equal(item.sourceAuthorityScore, 62);
  assert.equal(item.scoringSignals.socialEngagement, 139);
  assert.equal(item.riskWarning.severity, "low");
  assert.equal(item.metadata.subreddit, "AutoGPT");
  assert.equal(item.metadata.subredditUrl, "https://www.reddit.com/r/AutoGPT/");
  assert.equal(item.metadata.listing, "new");
  assert.equal(
    item.metadata.listingUrl,
    "https://www.reddit.com/r/AutoGPT/new.json?limit=25&raw_json=1",
  );
  assert.equal(item.metadata.fetchedAt, "2025-03-11T00:15:00.000Z");
  assert.equal(
    item.metadata.sourceProvenance.adapterId,
    "reddit",
  );
  assert.equal(
    item.metadata.sourceProvenance.sourceKind,
    "reddit",
  );
  assert.equal(
    item.metadata.sourceProvenance.requestUrl,
    "https://www.reddit.com/r/AutoGPT/new.json?limit=25&raw_json=1",
  );
  assert.equal(
    item.metadata.reddit.postFullname,
    "t3_abc123",
  );
  assert.deepEqual(item.metadata.outboundUrls, [
    "https://docs.example.com/agent-toolkit",
    "https://github.com/example/agent-toolkit",
  ]);
});
