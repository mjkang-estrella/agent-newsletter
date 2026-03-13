import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NEWSLETTER_DATA_DIR_ENV_NAME,
  SourceRepository,
  createDefaultSourceDiscoveryTask,
  createNormalizedItemFromSourceRecord,
  defineSourceAdapter,
  resolvePublicationRuntimePaths,
  runSourceDiscoveryWorker,
} from "../src/index.js";

function createDiscoveryAdapters({
  fetchedItems = {},
  discoveredSources = {},
} = {}) {
  return {
    github: defineSourceAdapter({
      descriptor: {
        id: "github",
        kind: "github",
        displayName: "GitHub",
        authorityScore: 95,
        seeded: true,
        supportsDiscovery: true,
        minimumItemAuthorityScore: 70,
      },
      async fetch() {
        return {
          items: fetchedItems.github ?? [],
          discoveredSources: discoveredSources.github ?? [],
        };
      },
    }),
    reddit: defineSourceAdapter({
      descriptor: {
        id: "reddit",
        kind: "reddit",
        displayName: "Reddit",
        authorityScore: 62,
        seeded: true,
        supportsDiscovery: true,
        minimumItemAuthorityScore: 55,
      },
      async fetch() {
        return {
          items: fetchedItems.reddit ?? [],
          discoveredSources: discoveredSources.reddit ?? [],
        };
      },
    }),
  };
}

function createDiscoverySeedItems({
  hostname = "docs.example.com",
  path = "/platform/agents",
} = {}) {
  const outboundUrl = `https://${hostname}${path}`;

  return {
    github: [
      createNormalizedItemFromSourceRecord({
        adapterId: "github",
        sourceType: "github",
        externalId: `${hostname}-github`,
        title: "Agent tooling worth tracking",
        sourceName: "GitHub",
        sourceUrl: "https://github.com/trending",
        publishedAt: "2026-03-12T20:15:00.000Z",
        discoveredAt: "2026-03-12T20:15:00.000Z",
        summary: "Framework docs worth watching.",
        outboundUrls: [outboundUrl],
        tags: ["github", "agent", "library"],
        category: "library",
        integrationHint: "Review the docs before integrating.",
        author: "github",
        metrics: {
          mentions: 3,
          upvotes: 150,
          comments: 0,
          shares: 0,
        },
        sourceAuthority: {
          authority: 95,
        },
        scoringSignals: {
          githubStars: 12_000,
          githubActivity: 84,
          socialEngagement: 150,
        },
        raw: {},
      }),
    ],
    reddit: [
      createNormalizedItemFromSourceRecord({
        adapterId: "reddit",
        sourceType: "reddit",
        externalId: `${hostname}-reddit`,
        title: "Useful agent docs",
        sourceName: "r/LocalLLaMA",
        sourceUrl: "https://reddit.com/r/LocalLLaMA/comments/docs123",
        publishedAt: "2026-03-12T20:30:00.000Z",
        discoveredAt: "2026-03-12T20:30:00.000Z",
        summary: "Another citation for the same docs.",
        outboundUrls: [outboundUrl],
        tags: ["reddit", "agent", "library"],
        category: "library",
        integrationHint: "Review the docs before integrating.",
        author: "builder",
        metrics: {
          mentions: 2,
          upvotes: 80,
          comments: 12,
          shares: 0,
        },
        sourceAuthority: {
          authority: 62,
        },
        scoringSignals: {
          socialEngagement: 92,
        },
        raw: {},
      }),
    ],
  };
}

test("source discovery worker persists high-signal outbound sources into the registry", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };
  const task = createDefaultSourceDiscoveryTask({
    cwd,
    env,
    now: () => "2026-03-12T21:30:00.000Z",
    createAdapters: () =>
      createDiscoveryAdapters({
        fetchedItems: createDiscoverySeedItems({ hostname: "docs.agno.com" }),
      }),
  });

  const result = await task.discoverSources();
  const fetchableSources = await task.sourceRepository.listFetchableSources({
    now: "2026-03-12T21:35:00.000Z",
  });
  const approved = fetchableSources.find(
    (source) => source.id === "web:domain:docs.agno.com",
  );

  assert.ok(approved);
  assert.deepEqual(
    result.newlyApproved.map((source) => source.id),
    ["web:domain:docs.agno.com"],
  );
  assert.equal(approved.status, "approved");
  assert.equal(approved.fetchUrl, "https://docs.agno.com/platform/agents");
  assert.deepEqual(approved.evidence.cyclesSeen, ["2026-03-12"]);
});

test("source discovery worker persists adapter-emitted discovered sources", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };
  const task = createDefaultSourceDiscoveryTask({
    cwd,
    env,
    now: () => "2026-03-12T21:30:00.000Z",
    createAdapters: () =>
      createDiscoveryAdapters({
        discoveredSources: {
          github: [
            {
              id: "web:domain:docs.agno.com",
              kind: "web",
              displayName: "docs.agno.com",
              url: "https://docs.agno.com/platform/agents?utm_source=github",
              authorityScore: 68,
              discoveredFromUrls: ["https://github.com/trending"],
            },
          ],
          reddit: [
            {
              id: "web:domain:docs.agno.com",
              kind: "web",
              displayName: "docs.agno.com",
              url: "https://docs.agno.com/platform/agents?utm_source=reddit",
              authorityScore: 68,
              discoveredFromUrls: [
                "https://reddit.com/r/LocalLLaMA/comments/docs123?utm_source=home",
              ],
            },
          ],
        },
      }),
  });

  const result = await task.discoverSources();
  const fetchableSources = await task.sourceRepository.listFetchableSources({
    now: "2026-03-12T21:35:00.000Z",
  });
  const approved = fetchableSources.find(
    (source) => source.id === "web:domain:docs.agno.com",
  );

  assert.ok(approved);
  assert.deepEqual(
    result.newlyApproved.map((source) => source.id),
    ["web:domain:docs.agno.com"],
  );
  assert.equal(approved.fetchUrl, "https://docs.agno.com/platform/agents");
  assert.deepEqual(approved.discoveredFromUrls, [
    "https://github.com/trending",
    "https://reddit.com/r/LocalLLaMA/comments/docs123",
  ]);
});

test("source discovery worker feeds approved sources back into later web discovery runs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };
  const paths = resolvePublicationRuntimePaths({ cwd, env });
  const sourceRepository = new SourceRepository({
    filePath: paths.sourceRegistryPath,
  });

  const bootstrapTask = createDefaultSourceDiscoveryTask({
    cwd,
    env,
    now: () => "2026-03-12T21:30:00.000Z",
    sourceRepository,
    createAdapters: () =>
      createDiscoveryAdapters({
        fetchedItems: createDiscoverySeedItems(),
      }),
  });

  await bootstrapTask.discoverSources();

  const fetchCalls = [];
  const followupTask = createDefaultSourceDiscoveryTask({
    cwd,
    env,
    now: () => "2026-03-13T21:30:00.000Z",
    sourceRepository,
    createAdapters: () =>
      createDiscoveryAdapters({
        fetchedItems: {
          github: [],
          reddit: [],
        },
      }),
    webDiscoveryFetch: async (url) => {
      fetchCalls.push(url);

      return new Response(
        `
          <html>
            <head>
              <title>Acme Agent SDK</title>
              <meta
                name="description"
                content="A library for autonomous agent workflows and MCP integrations."
              />
              <link rel="canonical" href="/platform/agents?utm_source=home" />
            </head>
            <body>
              <a href="https://github.com/acme/agent-sdk">GitHub</a>
            </body>
          </html>
        `,
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "last-modified": "Fri, 13 Mar 2026 20:15:00 GMT",
          },
        },
      );
    },
  });

  const result = await followupTask.discoverSources();
  const webDiscoveryReport = result.fetchReports.find(
    (report) => report.adapterId === "web-discovery",
  );

  assert.deepEqual(fetchCalls, ["https://docs.example.com/platform/agents"]);
  assert.ok(webDiscoveryReport);
  assert.equal(webDiscoveryReport.status, "succeeded");
  assert.equal(webDiscoveryReport.fetchedCount, 1);
  assert.ok(
    result.fetchedItems.some(
      (item) => item.metadata?.approvedSourceId === "web:domain:docs.example.com",
    ),
  );
});

test("runSourceDiscoveryWorker logs the discovery summary", async () => {
  const calls = [];
  const result = await runSourceDiscoveryWorker({
    discover: async () => ({
      window: {
        startsAt: "2026-03-12T21:00:00.000Z",
        endsAt: "2026-03-13T21:00:00.000Z",
        timezone: "UTC",
      },
      fetchedItems: [{ id: "item-1" }],
      approvedSources: [{ id: "source-1" }],
      candidateSources: [{ id: "source-2" }],
      newlyApproved: [{ id: "source-1" }],
      newlyPromoted: [],
      newlyRetired: [],
    }),
    logInfo: (...args) => {
      calls.push(args);
    },
  });

  assert.equal(result.fetchedItems.length, 1);
  assert.deepEqual(calls, [
    [
      "Source discovery worker completed.",
      {
        window: {
          startsAt: "2026-03-12T21:00:00.000Z",
          endsAt: "2026-03-13T21:00:00.000Z",
          timezone: "UTC",
        },
        fetchedItemCount: 1,
        approvedSourceCount: 1,
        candidateSourceCount: 1,
        newlyApprovedSourceCount: 1,
        newlyPromotedSourceCount: 0,
        newlyRetiredSourceCount: 0,
      },
    ],
  ]);
});

test("createDefaultSourceDiscoveryTask forwards X adapter overrides into adapter creation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const twitterClientFactory = () => ({
    async searchRecent() {
      return {
        records: [],
      };
    },
  });
  const twitterProviderHooks = {
    beforeRequest() {
      return null;
    },
  };
  let receivedOverrides = null;

  createDefaultSourceDiscoveryTask({
    cwd,
    env: {
      NEWSLETTER_BASE_TIMEZONE: "UTC",
    },
    twitterClientFactory,
    twitterProviderHooks,
    createAdapters(_env, overrides) {
      receivedOverrides = overrides;
      return {};
    },
  });

  assert.equal(receivedOverrides.twitterClient, null);
  assert.equal(receivedOverrides.twitterClientFactory, twitterClientFactory);
  assert.equal(receivedOverrides.twitterProviderHooks, twitterProviderHooks);
});

test("createDefaultSourceDiscoveryTask forwards scored-but-unpublished items into source discovery", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const discoveryCalls = [];
  const lowSignalItem = createNormalizedItemFromSourceRecord({
    adapterId: "github",
    sourceType: "github",
    externalId: "low-signal-agent-runtime",
    title: "Low signal agent runtime",
    sourceName: "GitHub",
    sourceUrl: "https://github.com/example/low-signal-agent-runtime",
    publishedAt: "2026-03-12T20:15:00.000Z",
    discoveredAt: "2026-03-12T20:15:00.000Z",
    summary: "A runtime mention that fell below the publish floor.",
    outboundUrls: [],
    tags: ["github", "agent", "library"],
    category: "library",
    integrationHint: "Wait for more corroboration before integrating.",
    author: "example",
    relevanceScore: 58,
    metrics: {
      mentions: 1,
      upvotes: 25,
      comments: 4,
      shares: 0,
    },
    sourceAuthority: {
      authority: 95,
    },
    raw: {},
  });
  const publishedItem = createNormalizedItemFromSourceRecord({
    adapterId: "github",
    sourceType: "github",
    externalId: "agent-runtime",
    title: "Agent runtime",
    sourceName: "GitHub",
    sourceUrl: "https://github.com/example/agent-runtime",
    publishedAt: "2026-03-12T20:30:00.000Z",
    discoveredAt: "2026-03-12T20:30:00.000Z",
    summary: "A runtime mention that clears the publish floor.",
    outboundUrls: [],
    tags: ["github", "agent", "library"],
    category: "library",
    integrationHint: "npm install agent-runtime",
    author: "example",
    relevanceScore: 81,
    metrics: {
      mentions: 3,
      upvotes: 140,
      comments: 12,
      shares: 6,
    },
    sourceAuthority: {
      authority: 95,
    },
    raw: {},
  });
  const task = createDefaultSourceDiscoveryTask({
    cwd,
    env: {
      NEWSLETTER_BASE_TIMEZONE: "UTC",
      [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
    },
    pipeline: {
      async aggregate() {
        return {
          items: [publishedItem],
          scoredItems: [lowSignalItem, publishedItem],
          fetchedItems: [lowSignalItem, publishedItem],
        };
      },
    },
    sourceDiscoveryService: {
      async discoverFromItems(items, options) {
        discoveryCalls.push({
          items,
          scoredItems: options.scoredItems,
        });

        return {
          snapshot: {
            version: 1,
            updatedAt: "2026-03-12T21:30:00.000Z",
            sources: [],
          },
          approvedSources: [],
          candidateSources: [],
          newlyApproved: [],
          newlyPromoted: [],
          newlyRetired: [],
        };
      },
    },
  });

  await task.discoverSources();

  assert.equal(discoveryCalls.length, 1);
  assert.deepEqual(
    discoveryCalls[0].items.map((item) => item.name),
    ["Low signal agent runtime", "Agent runtime"],
  );
  assert.deepEqual(
    discoveryCalls[0].scoredItems.map((item) => item.name),
    ["Low signal agent runtime", "Agent runtime"],
  );
});
