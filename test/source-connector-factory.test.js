import test from "node:test";
import assert from "node:assert/strict";

import {
  ContentFetcherCore,
  createFetchOrchestrationPlan,
  createSourceRegistry,
  createSourceAdapterConfigs,
  createSourceAdapters,
  defineSourceAdapter,
  defineSourceConnector,
} from "../src/index.js";

function createDescriptor({
  id,
  kind,
  displayName,
  authorityScore = 70,
  minimumItemAuthorityScore = 55,
}) {
  return {
    id,
    kind,
    displayName,
    authorityScore,
    seeded: true,
    supportsDiscovery: true,
    minimumItemAuthorityScore,
  };
}

function createHackerNewsConnector(fetchCalls = []) {
  return defineSourceConnector({
    key: "hackernews",
    createConfig(env = {}) {
      return {
        enabled: String(env.HACKERNEWS_ENABLED ?? "true").trim().toLowerCase() !== "false",
        feedUrl: env.HACKERNEWS_FEED_URL ?? "https://news.ycombinator.com/rss",
        authorityScore: Number(env.HACKERNEWS_AUTHORITY_SCORE ?? 66),
      };
    },
    createAdapter(config) {
      return {
        enabled: config.enabled,
        feedUrl: config.feedUrl,
        ...defineSourceAdapter({
          descriptor: createDescriptor({
            id: "hackernews",
            kind: "web",
            displayName: "Hacker News",
            authorityScore: config.authorityScore,
          }),
          async fetch(window) {
            fetchCalls.push(window);

            return {
              items: [
                {
                  name: "Agent Sandbox",
                  sourceUrl: config.feedUrl,
                  category: "tool",
                  summary: "A launch post for a sandbox used by autonomous coding agents.",
                  integrationHint:
                    "Review the launch thread, then validate the sandbox in a non-production agent loop.",
                },
              ],
            };
          },
        }),
      };
    },
  });
}

test("createFetchOrchestrationPlan snapshots adapter execution order and normalized windows", () => {
  const registry = createSourceRegistry([
    defineSourceAdapter({
      descriptor: createDescriptor({
        id: "github",
        kind: "github",
        displayName: "GitHub",
        authorityScore: 95,
        minimumItemAuthorityScore: 70,
      }),
      async fetch() {
        return { items: [] };
      },
    }),
    defineSourceAdapter({
      descriptor: createDescriptor({
        id: "reddit",
        kind: "reddit",
        displayName: "Reddit",
        authorityScore: 60,
        minimumItemAuthorityScore: 50,
      }),
      async fetch() {
        return { items: [] };
      },
    }),
  ]);

  const plan = createFetchOrchestrationPlan({
    registry,
    window: {
      since: "2026-03-10T21:00:00.000Z",
      until: "2026-03-11T21:00:00.000Z",
    },
  });

  assert.deepEqual(plan, [
    {
      order: 0,
      adapterId: "github",
      sourceKind: "github",
      window: {
        startsAt: "2026-03-10T21:00:00.000Z",
        endsAt: "2026-03-11T21:00:00.000Z",
        timezone: "UTC",
      },
    },
    {
      order: 1,
      adapterId: "reddit",
      sourceKind: "reddit",
      window: {
        startsAt: "2026-03-10T21:00:00.000Z",
        endsAt: "2026-03-11T21:00:00.000Z",
        timezone: "UTC",
      },
    },
  ]);
});

test("createSourceAdapters accepts additional connector definitions with per-source config", async () => {
  const fetchCalls = [];
  const hackerNewsConnector = createHackerNewsConnector(fetchCalls);
  const env = {
    ARXIV_ENABLED: "false",
    GITHUB_ENABLED: "false",
    REDDIT_ENABLED: "false",
    TWITTER_ENABLED: "false",
    HACKERNEWS_ENABLED: "true",
    HACKERNEWS_FEED_URL: "https://hn.example.com/rss",
    HACKERNEWS_AUTHORITY_SCORE: "68",
  };

  const sourceConfigs = createSourceAdapterConfigs(env, {
    additionalSourceConnectors: [hackerNewsConnector],
  });

  assert.equal(sourceConfigs.hackernews.feedUrl, "https://hn.example.com/rss");
  assert.equal(sourceConfigs.hackernews.authorityScore, 68);

  const adapters = createSourceAdapters(env, {
    additionalSourceConnectors: [hackerNewsConnector],
  });
  const registry = createSourceRegistry([adapters]);
  const fetcher = new ContentFetcherCore({ registry });
  const result = await fetcher.fetch({
    since: "2026-03-10T21:00:00.000Z",
    until: "2026-03-11T21:00:00.000Z",
  });

  assert.equal(adapters.github.enabled, false);
  assert.equal(adapters.hackernews.feedUrl, "https://hn.example.com/rss");
  assert.deepEqual(fetchCalls, [
    {
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
  ]);
  assert.deepEqual(result.fetchPlan, [
    {
      order: 0,
      adapterId: "hackernews",
      sourceKind: "web",
      window: {
        startsAt: "2026-03-10T21:00:00.000Z",
        endsAt: "2026-03-11T21:00:00.000Z",
        timezone: "UTC",
      },
    },
  ]);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].adapterIds, ["hackernews"]);
  assert.deepEqual(result.items[0].sourceKinds, ["web"]);
  assert.equal(result.items[0].sourceAuthorityScore, 68);
});
