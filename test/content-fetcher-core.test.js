import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  AggregationPipeline,
  ContentFetcherCore,
  DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  DEFAULT_SOURCE_DESCRIPTORS,
  SOURCE_KINDS,
  SourceRepository,
  SourceRegistry,
  TwitterSourceAdapter,
  createFetchWindow,
  createDefaultDeduplicationHooks,
  createNormalizedItem,
  createNormalizedItemFromSourceRecord,
  createSourceFetchResult,
  createSourceRegistry,
  deduplicateItems,
  defineSourceAdapter,
} from "../src/index.js";

const descriptorById = new Map(
  DEFAULT_SOURCE_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

function createRegistry(overrides = {}) {
  return new SourceRegistry(
    DEFAULT_SOURCE_DESCRIPTORS.map((descriptor) =>
      defineSourceAdapter({
        descriptor,
        fetch: overrides[descriptor.id] ?? (async () => ({ items: [] })),
      }),
    ),
  );
}

async function createSourceRepositoryWithSources(sources) {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new SourceRepository({
    filePath: join(directory, "source-registry.json"),
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-11T21:00:00.000Z",
    sources,
  });

  return repository;
}

function createDiscoveredSourceRecord({
  hostname,
  status,
  authorityScore,
  signalScore = 80,
  approvedAt = status === "approved" ? "2026-03-11T20:00:00.000Z" : null,
  lifecycle,
}) {
  return {
    id: `web:domain:${hostname}`,
    kind: "web",
    entityType: "domain",
    platform: "web",
    value: hostname,
    displayName: hostname,
    url: `https://${hostname}`,
    canonicalUrl: `https://${hostname}`,
    fetchUrl: `https://${hostname}`,
    status,
    seed: false,
    authorityScore,
    signalScore,
    discoveredAt: "2026-03-11T18:00:00.000Z",
    approvedAt,
    lastSeenAt: "2026-03-11T21:00:00.000Z",
    ...(lifecycle ? { lifecycle } : {}),
    evidence: {
      discoveryCount: 2,
      referrers: ["github:domain:github.com"],
      trustedReferrers: ["github:domain:github.com"],
      seedReferrers: ["github:domain:github.com"],
      referrerPlatforms: ["web"],
      cyclesSeen: ["2026-03-11"],
      topicHits: ["agent", "tool"],
      exampleUrls: [`https://${hostname}/launch`],
    },
    discoveredFromUrls: ["https://github.com/trending"],
  };
}

function createNormalizedDiscoveredSourceExpectation({
  id,
  displayName,
  url,
  authorityScore,
  discoveredFromUrls,
  status = "candidate",
  lifecycle = {
    state: "probation",
    stage: "probation",
    probationStartedAt: null,
    activatedAt: null,
    retiredAt: null,
  },
}) {
  return {
    id,
    kind: "web",
    displayName,
    url,
    status,
    lifecycle,
    authorityScore,
    authorityWeight: lifecycle.stage === "active" ? 1 : lifecycle.stage === "retired" ? 0 : 0.75,
    weightedAuthorityScore:
      lifecycle.stage === "retired"
        ? 0
        : Math.round(authorityScore * (lifecycle.stage === "active" ? 1 : 0.75)),
    discoveredFromUrls,
  };
}

test("createFetchWindow normalizes aliases and defaults to a 24 hour UTC range", () => {
  const aliasedWindow = createFetchWindow({
    since: "2026-03-10T21:00:00.000Z",
    until: "2026-03-11T21:00:00.000Z",
  });

  assert.deepEqual(aliasedWindow, {
    startsAt: "2026-03-10T21:00:00.000Z",
    endsAt: "2026-03-11T21:00:00.000Z",
    timezone: "UTC",
  });

  const defaultedWindow = createFetchWindow({
    endsAt: "2026-03-11T21:00:00.000Z",
  });

  assert.deepEqual(defaultedWindow, {
    startsAt: "2026-03-10T21:00:00.000Z",
    endsAt: "2026-03-11T21:00:00.000Z",
    timezone: "UTC",
  });
});

test("createSourceFetchResult applies shared adapter defaults to normalized items", () => {
  const result = createSourceFetchResult(
    {
      items: [
        {
          name: "Agent Deploy",
          sourceUrl: "https://github.com/acme/agent-deploy/?b=2&a=1#readme",
          category: "tool",
          summary: "A deployment toolkit for multi-agent services.",
          integrationHint: "npm install agent-deploy",
        },
      ],
      discoveredSources: [
        {
          id: "web:domain:docs.example.com",
          kind: "web",
          displayName: "docs.example.com",
          url: "https://docs.example.com/?b=2&a=1#top",
          authorityScore: 64,
          discoveredFromUrls: [
            "https://x.com/builder/status/123?b=2&a=1#dup",
            "https://x.com/builder/status/123?a=1&b=2",
          ],
        },
      ],
      cursor: "cursor-123",
    },
    {
      descriptor: descriptorById.get("github"),
      window: {
        startsAt: "2026-03-10T21:00:00.000Z",
        endsAt: "2026-03-11T21:00:00.000Z",
        timezone: "UTC",
      },
    },
  );

  assert.equal(result.cursor, "cursor-123");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceUrl, "https://github.com/acme/agent-deploy?a=1&b=2");
  assert.deepEqual(result.items[0].sourceKinds, ["github"]);
  assert.deepEqual(result.items[0].adapterIds, ["github"]);
  assert.equal(result.items[0].sourceAuthorityScore, 95);
  assert.equal(result.items[0].discoveredAt, "2026-03-11T21:00:00.000Z");
  assert.deepEqual(result.discoveredSources, [
    createNormalizedDiscoveredSourceExpectation({
      id: "web:domain:docs.example.com",
      displayName: "docs.example.com",
      url: "https://docs.example.com/?a=1&b=2",
      authorityScore: 64,
      discoveredFromUrls: ["https://x.com/builder/status/123?a=1&b=2"],
    }),
  ]);
});

test("createSourceRegistry accepts keyed provider collections and skips disabled adapters", async () => {
  const legacyCalls = [];
  let disabledCalls = 0;
  const registry = createSourceRegistry([
    {
      github: {
        enabled: true,
        id: "github",
        name: "GitHub",
        type: "github",
        async fetchItems(window) {
          legacyCalls.push(window);

          return [
            {
              adapterId: "github",
              sourceType: "github",
              externalId: "agent-runtime",
              title: "Agent Runtime",
              sourceName: "GitHub",
              sourceUrl: "https://github.com/acme/agent-runtime",
              publishedAt: "2026-03-11T20:30:00.000Z",
              summary: "A runtime for multi-agent orchestration.",
              outboundUrls: [],
              tags: ["github", "ai-agents"],
              author: "acme",
              metrics: {
                mentions: 1,
                upvotes: 100,
                comments: 0,
                shares: 0,
              },
              sourceAuthority: {
                authority: 95,
              },
              raw: {},
            },
          ];
        },
      },
      reddit: {
        enabled: false,
        id: "reddit",
        name: "Reddit",
        type: "reddit",
        async fetchItems() {
          disabledCalls += 1;
          return [];
        },
      },
    },
    defineSourceAdapter({
      descriptor: descriptorById.get("web-discovery"),
      async fetch() {
        return { items: [] };
      },
    }),
  ]);

  assert.equal(registry.list().length, 2);
  assert.equal(registry.get("github")?.descriptor.kind, "github");
  assert.equal(registry.get("reddit"), null);
  assert.equal(registry.get("web-discovery")?.descriptor.kind, "web");

  const result = await new ContentFetcherCore({ registry }).fetch({
    since: "2026-03-10T21:00:00.000Z",
    until: "2026-03-11T21:00:00.000Z",
  });

  assert.deepEqual(legacyCalls, [
    {
      since: "2026-03-10T21:00:00.000Z",
      until: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
  ]);
  assert.equal(disabledCalls, 0);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].adapterIds, ["github"]);
  assert.deepEqual(
    result.fetchReports.map((report) => report.adapterId).sort(),
    ["github", "web-discovery"],
  );
});

test("createSourceRegistry accepts keyed Map collections for adapter registration", async () => {
  const registry = createSourceRegistry(
    new Map([
      [
        "github",
        {
          id: "github",
          name: "GitHub",
          type: "github",
          async fetchItems() {
            return [
              {
                adapterId: "github",
                sourceType: "github",
                externalId: "agent-registry",
                title: "Agent Registry",
                sourceName: "GitHub",
                sourceUrl: "https://github.com/acme/agent-registry",
                publishedAt: "2026-03-11T20:30:00.000Z",
                summary: "Registry primitives for multi-provider agent systems.",
                outboundUrls: [],
                tags: ["github", "registry"],
                author: "acme",
                metrics: {
                  mentions: 1,
                  upvotes: 42,
                  comments: 0,
                  shares: 0,
                },
                sourceAuthority: {
                  authority: 95,
                },
                raw: {},
              },
            ];
          },
        },
      ],
      [
        "web",
        defineSourceAdapter({
          descriptor: descriptorById.get("web-discovery"),
          async fetch() {
            return { items: [] };
          },
        }),
      ],
    ]),
  );

  const result = await new ContentFetcherCore({ registry }).fetch({
    since: "2026-03-10T21:00:00.000Z",
    until: "2026-03-11T21:00:00.000Z",
  });

  assert.deepEqual(
    registry.list().map((adapter) => adapter.descriptor.id).sort(),
    ["github", "web-discovery"],
  );
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].adapterIds, ["github"]);
  assert.deepEqual(
    result.fetchReports.map((report) => report.adapterId).sort(),
    ["github", "web-discovery"],
  );
});

test("content fetcher core merges normalized results across multiple source adapters", async () => {
  const windows = [];
  const fetcher = new ContentFetcherCore({
    registry: new SourceRegistry([
      defineSourceAdapter({
        descriptor: descriptorById.get("github"),
        async fetch(window) {
          windows.push(window);

          return {
            items: [
              {
                name: "Agent Runtime",
                sourceUrl: "https://github.com/acme/agent-runtime",
                category: "library",
                summary: "A runtime for tool-using agent systems.",
                integrationHint: "npm install agent-runtime",
                sourceAuthorityScore: 95,
              },
            ],
          };
        },
      }),
      defineSourceAdapter({
        descriptor: descriptorById.get("web-discovery"),
        async fetch(window) {
          windows.push(window);

          return {
            items: [
              {
                name: "Agent Deployment Notes",
                sourceUrl: "https://docs.example.com/agent-runtime",
                category: "technique",
                summary: "Operator notes for deploying the runtime in production.",
                integrationHint: "Convert the operator notes into runbook checks.",
                sourceAuthorityScore: 68,
              },
            ],
            discoveredSources: [
              {
                id: "web:domain:docs.example.com",
                kind: "web",
                displayName: "docs.example.com",
                url: "https://docs.example.com",
                authorityScore: 68,
                discoveredFromUrls: ["https://github.com/acme/agent-runtime"],
              },
            ],
          };
        },
      }),
    ]),
  });

  const result = await fetcher.fetch({
    since: "2026-03-10T21:00:00.000Z",
    until: "2026-03-11T21:00:00.000Z",
  });

  assert.deepEqual(windows, [
    {
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
    {
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
  ]);
  assert.equal(result.items.length, 2);
  assert.equal(result.discoveredSources.length, 1);
  assert.equal(result.fetchReports.length, 2);
  assert.deepEqual(
    result.fetchReports.map((report) => report.status),
    ["succeeded", "succeeded"],
  );
  assert.deepEqual(result.fetchVerification, {
    status: "ok",
    readyForCuration: true,
    adapterCount: 2,
    successfulAdapterCount: 2,
    failedAdapterCount: 0,
    requiredSourceKinds: [],
    succeededSourceKinds: ["github", "web"],
    failedSourceKinds: [],
    missingRequiredSourceKinds: [],
    fetchedItemCount: 2,
    discoveredSourceCount: 1,
  });
  assert.ok(
    result.items.every((item) => Array.isArray(item.metadata.identitySignals)),
  );
});

test("content fetcher core normalizes adapter retrievals when fetching a single source", async () => {
  const window = createFetchWindow({
    since: "2026-03-10T21:00:00.000Z",
    until: "2026-03-11T21:00:00.000Z",
  });
  const fetcher = new ContentFetcherCore({ registry: createRegistry() });
  const adapter = {
    descriptor: descriptorById.get("web-discovery"),
    async fetch(receivedWindow) {
      assert.deepEqual(receivedWindow, window);

      return {
        items: [
          {
            name: "Agent Deployment Guide",
            sourceUrl: "https://docs.example.com/agents/install/?b=2&a=1#setup",
            category: "technique",
            summary: "Operator guidance for deploying autonomous agent runtimes.",
            integrationHint: "Turn the guide into a reusable bootstrap checklist.",
          },
        ],
        discoveredSources: [
          {
            id: "web:domain:docs.example.com",
            kind: "web",
            displayName: "docs.example.com",
            url: "https://docs.example.com/?b=2&a=1#home",
            authorityScore: 68,
            discoveredFromUrls: [
              "https://x.com/builder/status/123?b=2&a=1#dup",
              "https://x.com/builder/status/123?a=1&b=2",
            ],
          },
        ],
      };
    },
  };

  const batch = await fetcher.fetchFromAdapter(adapter, window);

  assert.equal(batch.ok, true);
  assert.equal(batch.items.length, 1);
  assert.equal(
    batch.items[0].sourceUrl,
    "https://docs.example.com/agents/install?a=1&b=2",
  );
  assert.deepEqual(batch.items[0].sourceKinds, ["web"]);
  assert.deepEqual(batch.items[0].adapterIds, ["web-discovery"]);
  assert.equal(batch.items[0].sourceAuthorityScore, 50);
  assert.equal(batch.items[0].discoveredAt, "2026-03-11T21:00:00.000Z");
  assert.ok(Array.isArray(batch.items[0].metadata.identitySignals));
  assert.deepEqual(batch.discoveredSources, [
    createNormalizedDiscoveredSourceExpectation({
      id: "web:domain:docs.example.com",
      displayName: "docs.example.com",
      url: "https://docs.example.com/?a=1&b=2",
      authorityScore: 68,
      discoveredFromUrls: ["https://x.com/builder/status/123?a=1&b=2"],
    }),
  ]);
  assert.equal(batch.report.adapterId, "web-discovery");
  assert.equal(batch.report.sourceKind, "web");
  assert.equal(batch.report.status, "succeeded");
  assert.equal(batch.report.fetchedCount, 1);
  assert.equal(batch.report.discoveredSourceCount, 1);
});

test("content fetcher core records normalization failures as failed source fetches", async () => {
  const window = createFetchWindow({
    since: "2026-03-10T21:00:00.000Z",
    until: "2026-03-11T21:00:00.000Z",
  });
  const fetcher = new ContentFetcherCore({ registry: createRegistry() });
  const adapter = {
    descriptor: descriptorById.get("github"),
    async fetch() {
      return {
        items: [
          {
            name: "Broken source payload",
            sourceUrl: " ",
            category: "tool",
            summary: "Malformed items should be treated as failed source fetches.",
            integrationHint: "Ignore this payload.",
          },
        ],
      };
    },
  };

  const batch = await fetcher.fetchFromAdapter(adapter, window);

  assert.equal(batch.ok, false);
  assert.equal(batch.items.length, 0);
  assert.equal(batch.discoveredSources.length, 0);
  assert.match(batch.error.message, /sourceUrl must be a non-empty string/);
  assert.deepEqual(batch.report.error, {
    name: "TypeError",
    message: "sourceUrl must be a non-empty string",
  });
  assert.equal(batch.report.adapterId, "github");
  assert.equal(batch.report.sourceKind, "github");
  assert.equal(batch.report.status, "failed");
  assert.equal(batch.report.fetchedCount, 0);
  assert.equal(batch.report.discoveredSourceCount, 0);
});

test("content fetcher core aggregates multiple failed fetches when no source succeeds", async () => {
  const fetcher = new ContentFetcherCore({
    registry: new SourceRegistry([
      defineSourceAdapter({
        descriptor: descriptorById.get("github"),
        async fetch() {
          throw new Error("github unavailable");
        },
      }),
      defineSourceAdapter({
        descriptor: descriptorById.get("reddit"),
        async fetch() {
          throw new Error("reddit unavailable");
        },
      }),
    ]),
  });

  await assert.rejects(
    fetcher.fetch({
      since: "2026-03-10T21:00:00.000Z",
      until: "2026-03-11T21:00:00.000Z",
    }),
    (error) => {
      assert.match(
        error.message,
        /github: github unavailable; reddit: reddit unavailable/,
      );
      assert.deepEqual(
        error.fetchReports.map((report) => report.status),
        ["failed", "failed"],
      );
      assert.deepEqual(error.fetchVerification, {
        status: "failed",
        readyForCuration: false,
        adapterCount: 2,
        successfulAdapterCount: 0,
        failedAdapterCount: 2,
        requiredSourceKinds: [],
        succeededSourceKinds: [],
        failedSourceKinds: ["github", "reddit"],
        missingRequiredSourceKinds: [],
        fetchedItemCount: 0,
        discoveredSourceCount: 0,
      });

      return true;
    },
  );
});

test("createNormalizedItem canonicalizes URLs and applies required defaults", () => {
  const item = createNormalizedItem({
    name: "AgentKit",
    sourceUrl: "https://github.com/example/agentkit/?b=2&a=1#readme",
    category: "library",
    summary: "Composable agent utilities for Node runtimes.",
    integrationHint: "npm install agentkit",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 91,
  });

  assert.equal(item.sourceUrl, "https://github.com/example/agentkit?a=1&b=2");
  assert.deepEqual(item.sourceUrls, ["https://github.com/example/agentkit?a=1&b=2"]);
  assert.equal(item.riskWarning.severity, "unknown");
  assert.equal(item.riskWarning.description, "Risk review pending.");
  assert.equal(item.mentionCount, 1);
  assert.equal(item.scoringSignals.mentionCount, 1);
  assert.equal(item.scoringSignals.sourceAuthority, 91);
  assert.equal(item.relevanceScore, null);
});

test("createNormalizedItem does not infer mention count from alternate source urls", () => {
  const item = createNormalizedItem({
    name: "AgentKit docs",
    sourceUrl: "https://docs.example.com/agentkit/get-started?b=2&a=1#intro",
    sourceUrls: [
      "https://docs.example.com/agentkit/get-started/print?view=full",
      "https://docs.example.com/agentkit/get-started?b=2&a=1#duplicate",
    ],
    category: "library",
    summary: "Setup guide with a printable companion view.",
    integrationHint: "Review the guide before rollout.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 68,
  });

  assert.deepEqual(item.sourceUrls.sort(), [
    "https://docs.example.com/agentkit/get-started/print?view=full",
    "https://docs.example.com/agentkit/get-started?a=1&b=2",
  ]);
  assert.equal(item.mentionCount, 1);
  assert.equal(item.scoringSignals.mentionCount, 1);
});

test("createNormalizedItem stores source sentiment evidence and derives an agree spread", () => {
  const item = createNormalizedItem({
    name: "AgentKit",
    sourceUrl: "https://github.com/example/agentkit",
    category: "library",
    summary: "Composable agent utilities for Node runtimes.",
    integrationHint: "npm install agentkit",
    sourceSentiment: "positive",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 91,
    metadata: {
      sourceSentiment: "negative",
      topic: "agents",
    },
  });

  assert.equal(item.sourceSentiment, "positive");
  assert.deepEqual(item.sentimentSpread, {
    classification: "agree",
  });
  assert.equal(item.metadata.topic, "agents");
  assert.equal("sourceSentiment" in item.metadata, false);
  assert.deepEqual(item.metadata.sourceSentiments, [
    {
      sourceUrl: "https://github.com/example/agentkit",
      sentiment: "positive",
    },
  ]);
});

test("default source descriptors cover every upstream source kind in the spec", () => {
  const supportedKinds = DEFAULT_SOURCE_DESCRIPTORS.map((descriptor) => descriptor.kind).sort();
  assert.deepEqual(supportedKinds, [...SOURCE_KINDS].sort());
});

test("legacy source records normalize into the shared fetcher item schema", () => {
  const item = createNormalizedItemFromSourceRecord({
    adapterId: "reddit",
    sourceType: "reddit",
    externalId: "t3_abc123",
    title: "Agent toolkit released",
    sourceName: "r/AutoGPT",
    sourceUrl: "https://www.reddit.com/r/AutoGPT/comments/abc123/agent_toolkit_released/",
    publishedAt: "2025-03-10T12:00:00.000Z",
    summary: "Useful write-up https://docs.example.com/agent-toolkit",
    outboundUrls: [
      "https://docs.example.com/agent-toolkit",
      "https://github.com/example/agent-toolkit",
    ],
    tags: ["AutoGPT", "reddit", "ai-agents"],
    author: "builder",
    metrics: {
      mentions: 2,
      upvotes: 125,
      comments: 14,
      shares: 0,
    },
    sourceAuthority: {
      authority: 62,
    },
    raw: {
      id: "abc123",
    },
  });

  assert.equal(item.id, "reddit-t3_abc123");
  assert.equal(item.category, "tool");
  assert.equal(item.mentionCount, 2);
  assert.equal(item.scoringSignals.socialEngagement, 139);
  assert.deepEqual(item.adapterIds, ["reddit"]);
  assert.deepEqual(item.sourceKinds, ["reddit"]);
});

test("legacy X adapters retrieve records and normalize them into the shared fetcher schema", async () => {
  const calls = [];
  const adapter = defineSourceAdapter({
    id: "x-twitter",
    name: "X/Twitter",
    type: "twitter",
    async fetchItems(window) {
      calls.push(window);

      return [
        {
          adapterId: "x-twitter",
          sourceType: "twitter",
          externalId: "tweet-123",
          title: "Agent SDK launch thread",
          sourceName: "@builder",
          sourceUrl: "https://x.com/builder/status/123?b=2&a=1#details",
          publishedAt: "2026-03-11T20:30:00.000Z",
          summary: "New SDK for browser agents with an MCP bridge.",
          outboundUrls: [
            "https://docs.example.com/agent-sdk",
            "https://github.com/acme/agent-sdk",
          ],
          tags: ["twitter", "ai-agents", "sdk"],
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
      ];
    },
  });

  const result = await adapter.fetch({
    startsAt: "2026-03-10T21:00:00.000Z",
    endsAt: "2026-03-11T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.deepEqual(calls, [
    {
      since: "2026-03-10T21:00:00.000Z",
      until: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
  ]);
  assert.equal(adapter.descriptor.kind, "x");
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.discoveredSources ?? [], []);

  const [item] = result.items;

  assert.equal(item.id, "x-twitter-tweet-123");
  assert.equal(item.category, "library");
  assert.equal(item.sourceUrl, "https://x.com/builder/status/123?a=1&b=2");
  assert.deepEqual(item.sourceKinds, ["x"]);
  assert.deepEqual(item.adapterIds, ["x-twitter"]);
  assert.equal(item.mentionCount, 3);
  assert.equal(item.scoringSignals.socialEngagement, 63);
  assert.equal(item.integrationHint, "Review the source and extract concrete setup steps before integration.");
});

test("legacy X adapter failures surface through the shared fetcher wrapper", async () => {
  const adapter = defineSourceAdapter({
    id: "x-twitter",
    name: "X/Twitter",
    type: "twitter",
    async fetchItems() {
      throw new Error("X API rate limited");
    },
  });

  await assert.rejects(
    adapter.fetch({
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    }),
    /X API rate limited/,
  );
});

test("legacy X adapters reject malformed source records during shared fetch normalization", async () => {
  const adapter = defineSourceAdapter({
    id: "x-twitter",
    name: "X/Twitter",
    type: "twitter",
    async fetchItems() {
      return [
        {
          adapterId: "x-twitter",
          sourceType: "twitter",
          externalId: "tweet-bad",
          title: "Broken source payload",
          sourceName: "@builder",
          sourceUrl: "",
          publishedAt: "2026-03-11T20:30:00.000Z",
          summary: "Malformed X source records should fail normalization.",
          outboundUrls: [],
          tags: ["twitter", "ai-agents"],
          author: "builder",
          metrics: {
            mentions: 1,
            upvotes: 0,
            comments: 0,
            shares: 0,
          },
          sourceAuthority: {
            authority: 72,
          },
          raw: {
            id: "tweet-bad",
          },
        },
      ];
    },
  });

  await assert.rejects(
    adapter.fetch({
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    }),
    /sourceUrl must be a non-empty string/,
  );
});

test("aggregation pipeline accepts the concrete X adapter with an injected provider client", async () => {
  const adapter = new TwitterSourceAdapter({
    enabled: true,
    bearerToken: "token-value",
    client: {
      async searchRecentRecords(context) {
        assert.equal(context.adapterId, "x-twitter");
        assert.equal(context.requestPlan.params.max_results, 25);

        return [
          {
            adapterId: context.adapterId,
            sourceType: "twitter",
            externalId: "tweet-999",
            title: "Agent runtime launch",
            sourceName: "@builder",
            sourceUrl: "https://x.com/builder/status/999",
            publishedAt: "2026-03-11T20:30:00.000Z",
            summary: "A runtime for multi-agent orchestration with MCP support.",
            outboundUrls: [
              "https://docs.example.com/agent-runtime",
              "https://github.com/acme/agent-runtime",
            ],
            tags: ["twitter", "runtime", "ai-agents"],
            author: "builder",
            metrics: {
              mentions: 2,
              upvotes: 41,
              comments: 7,
              shares: 3,
            },
            sourceAuthority: {
              authority: 72,
            },
            raw: {
              id: "999",
            },
          },
        ];
      },
    },
  });

  const pipeline = new AggregationPipeline({
    registry: new SourceRegistry([adapter]),
    minRelevanceScore: 0,
    minSourceAuthorityScore: 50,
    scoreItem: async () => 84,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-10T21:00:00.000Z",
    endsAt: "2026-03-11T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(result.fetchReports.length, 1);
  assert.equal(result.fetchReports[0].adapterId, "x-twitter");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, "Agent runtime launch");
  assert.deepEqual(result.items[0].sourceKinds, ["x"]);
  assert.deepEqual(result.items[0].adapterIds, ["x-twitter"]);
  assert.equal(result.items[0].relevanceScore, 84);
});

test("aggregation pipeline normalizes broader web source fetch results and discovered sources", async () => {
  const calls = [];
  const adapter = defineSourceAdapter({
    descriptor: descriptorById.get("web-discovery"),
    async fetch(window) {
      calls.push(window);

      return {
        items: [
          {
            name: "Agent Deploy Guide",
            sourceUrl: "https://docs.example.com/agents/install/?b=2&a=1#setup",
            sourceUrls: [
              "https://docs.example.com/agents/install/?a=1&b=2#duplicate",
              "https://docs.example.com/agents/install/?b=2&a=1#setup",
            ],
            category: "tool",
            summary: "A practical setup guide for autonomous agent deployments.",
            integrationHint: "Translate the setup flow into your bootstrap pipeline.",
            sourceAuthorityScore: 68,
          },
        ],
        discoveredSources: [
          {
            id: "web:domain:docs.example.com",
            kind: "web",
            displayName: "docs.example.com",
            url: "https://docs.example.com/?b=2&a=1#home",
            authorityScore: 68,
            discoveredFromUrls: [
              "https://x.com/builder/status/123?b=2&a=1#details",
              "https://x.com/builder/status/123?a=1&b=2#duplicate",
            ],
          },
        ],
      };
    },
  });
  const pipeline = new AggregationPipeline({
    registry: new SourceRegistry([adapter]),
  });

  const result = await pipeline.collect({
    startsAt: "2026-03-10T21:00:00.000Z",
    endsAt: "2026-03-11T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(calls.length, 1);
  assert.equal(result.items.length, 1);
  assert.equal(
    result.items[0].sourceUrl,
    "https://docs.example.com/agents/install?a=1&b=2",
  );
  assert.deepEqual(result.items[0].sourceUrls, [
    "https://docs.example.com/agents/install?a=1&b=2",
  ]);
  assert.deepEqual(result.items[0].sourceKinds, ["web"]);
  assert.deepEqual(result.items[0].adapterIds, ["web-discovery"]);
  assert.equal(result.items[0].discoveredAt, "2026-03-11T21:00:00.000Z");
  assert.equal(result.discoveredSources.length, 1);
  assert.deepEqual(
    result.discoveredSources[0],
    createNormalizedDiscoveredSourceExpectation({
      id: "web:domain:docs.example.com",
      displayName: "docs.example.com",
      url: "https://docs.example.com/?a=1&b=2",
      authorityScore: 68,
      discoveredFromUrls: ["https://x.com/builder/status/123?a=1&b=2"],
    }),
  );
});

test("aggregation pipeline rejects malformed broader web source payloads", async () => {
  const pipeline = new AggregationPipeline({
    registry: new SourceRegistry([
      defineSourceAdapter({
        descriptor: descriptorById.get("web-discovery"),
        async fetch() {
          return {
            items: [
              {
                name: "Broken web payload",
                sourceUrl: " ",
                category: "tool",
                summary: "Malformed fetched items should fail fast.",
                integrationHint: "Do not use.",
              },
            ],
          };
        },
      }),
    ]),
  });

  let error;

  try {
    await pipeline.collect({
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    });
    assert.fail("Expected malformed broader web payload to reject collection.");
  } catch (caughtError) {
    error = caughtError;
  }

  assert.match(error.message, /sourceUrl must be a non-empty string/);
  assert.equal(error.fetchVerification.status, "failed");
  assert.equal(error.fetchVerification.readyForCuration, false);
  assert.equal(error.fetchVerification.successfulAdapterCount, 0);
  assert.equal(error.fetchVerification.failedAdapterCount, 1);
});

test("aggregation pipeline surfaces broader web source availability failures", async () => {
  const pipeline = new AggregationPipeline({
    registry: new SourceRegistry([
      defineSourceAdapter({
        descriptor: descriptorById.get("web-discovery"),
        async fetch() {
          throw new Error("web source unavailable");
        },
      }),
    ]),
  });

  let error;

  try {
    await pipeline.collect({
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    });
    assert.fail("Expected broader web source availability failure to reject collection.");
  } catch (caughtError) {
    error = caughtError;
  }

  assert.match(error.message, /web source unavailable/);
  assert.equal(error.fetchVerification.status, "failed");
  assert.equal(error.fetchVerification.readyForCuration, false);
  assert.equal(error.fetchVerification.adapterCount, 1);
  assert.equal(error.fetchVerification.successfulAdapterCount, 0);
  assert.equal(error.fetchVerification.failedAdapterCount, 1);
});

test("aggregation pipeline continues when one source fetch fails and verifies the partial run", async () => {
  const pipeline = new AggregationPipeline({
    registry: new SourceRegistry([
      defineSourceAdapter({
        descriptor: descriptorById.get("github"),
        async fetch() {
          return {
            items: [
              {
                name: "Agent Runtime",
                sourceUrl: "https://github.com/acme/agent-runtime",
                category: "library",
                summary: "A runtime for tool-using agent systems.",
                integrationHint: "npm install agent-runtime",
                sourceAuthorityScore: 95,
              },
            ],
          };
        },
      }),
      defineSourceAdapter({
        descriptor: descriptorById.get("reddit"),
        async fetch() {
          throw new Error("reddit unavailable");
        },
      }),
    ]),
  });

  const result = await pipeline.collect({
    startsAt: "2026-03-10T21:00:00.000Z",
    endsAt: "2026-03-11T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.discoveredSources.length, 0);
  assert.equal(result.fetchReports.length, 2);
  assert.deepEqual(
    result.fetchReports.map((report) => report.status),
    ["succeeded", "failed"],
  );
  assert.deepEqual(result.fetchReports[1].error, {
    name: "Error",
    message: "reddit unavailable",
  });
  assert.deepEqual(result.fetchVerification, {
    status: "partial",
    readyForCuration: true,
    adapterCount: 2,
    successfulAdapterCount: 1,
    failedAdapterCount: 1,
    requiredSourceKinds: [],
    succeededSourceKinds: ["github"],
    failedSourceKinds: ["reddit"],
    missingRequiredSourceKinds: [],
    fetchedItemCount: 1,
    discoveredSourceCount: 0,
  });
});

test("aggregation pipeline treats malformed source payloads as source-level failures when other adapters succeed", async () => {
  const pipeline = new AggregationPipeline({
    registry: new SourceRegistry([
      defineSourceAdapter({
        descriptor: descriptorById.get("github"),
        async fetch() {
          return {
            items: [
              {
                name: "Agent Toolkit",
                sourceUrl: "https://github.com/acme/agent-toolkit",
                category: "tool",
                summary: "Composable utilities for autonomous agent execution.",
                integrationHint: "npm install agent-toolkit",
                sourceAuthorityScore: 95,
              },
            ],
          };
        },
      }),
      defineSourceAdapter({
        descriptor: descriptorById.get("web-discovery"),
        async fetch() {
          return {
            items: [
              {
                name: "Broken payload",
                sourceUrl: " ",
                category: "tool",
                summary: "Malformed source payload should not abort the whole run.",
                integrationHint: "Ignore this item.",
              },
            ],
          };
        },
      }),
    ]),
    minRelevanceScore: 0,
    scoreItem: async () => 88,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-10T21:00:00.000Z",
    endsAt: "2026-03-11T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.deepEqual(result.items.map((item) => item.name), ["Agent Toolkit"]);
  assert.equal(result.fetchReports.length, 2);
  assert.equal(result.fetchReports[1].status, "failed");
  assert.equal(
    result.fetchReports[1].error?.message,
    "sourceUrl must be a non-empty string",
  );
  assert.equal(result.fetchVerification.status, "partial");
  assert.equal(result.fetchVerification.readyForCuration, true);
});

test("dedupe hooks consolidate duplicate items into a single multi-source candidate", () => {
  const hooks = createDefaultDeduplicationHooks();
  const githubItem = createNormalizedItem({
    name: "AgentOps",
    sourceUrl: "https://github.com/example/agentops",
    category: "tool",
    summary: "Open source observability for agent systems.",
    integrationHint: "docker compose up",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 95,
    riskWarning: {
      severity: "low",
      description: "Self-hosting required for sensitive traces.",
    },
  });
  const redditItem = createNormalizedItem({
    name: "AgentOps",
    sourceUrl: "https://www.reddit.com/r/LocalLLaMA/comments/agentops",
    category: "tool",
    summary: "Community discussion covering setup details and gotchas.",
    integrationHint: "Read the thread before production rollout.",
    sourceKinds: ["reddit"],
    adapterIds: ["reddit"],
    sourceAuthorityScore: 60,
    riskWarning: {
      severity: "medium",
      description: "Configuration guidance is community-generated.",
    },
  });

  assert.equal(hooks.isDuplicate(githubItem, redditItem), true);

  const merged = hooks.merge(githubItem, redditItem);

  assert.equal(merged.mentionCount, 2);
  assert.deepEqual(merged.sourceKinds.sort(), ["github", "reddit"]);
  assert.deepEqual(merged.adapterIds.sort(), ["github", "reddit"]);
  assert.deepEqual(merged.sourceUrls.sort(), [
    "https://github.com/example/agentops",
    "https://www.reddit.com/r/LocalLLaMA/comments/agentops",
  ]);
  assert.equal(merged.riskWarning.severity, "medium");
});

test("deduplicateItems replaces an entire duplicate group with one consolidated item", () => {
  const items = [
    createNormalizedItem({
      name: "AgentOps community thread",
      sourceUrl: "https://www.reddit.com/r/LocalLLaMA/comments/agentops",
      category: "tool",
      summary: "Thread collecting deployment notes from operators.",
      integrationHint: "Review the thread before production rollout.",
      sourceKinds: ["reddit"],
      adapterIds: ["reddit"],
      sourceAuthorityScore: 60,
    }),
    createNormalizedItem({
      name: "AgentOps",
      sourceUrl: "https://github.com/example/agentops",
      category: "tool",
      summary: "Open source observability for agent systems.",
      integrationHint: "docker compose up",
      sourceKinds: ["github"],
      adapterIds: ["github"],
      sourceAuthorityScore: 95,
    }),
    createNormalizedItem({
      name: "AgentOps",
      sourceUrl: "https://www.reddit.com/r/LocalLLaMA/comments/agentops",
      category: "tool",
      summary: "Community validation covering setup details and gotchas.",
      integrationHint: "Compare the thread guidance with the upstream docs.",
      sourceKinds: ["reddit"],
      adapterIds: ["reddit"],
      sourceAuthorityScore: 60,
    }),
  ];

  const deduplicated = deduplicateItems(items);
  const [merged] = deduplicated;

  assert.equal(deduplicated.length, 1);
  assert.deepEqual(merged.sourceUrls.sort(), [
    "https://github.com/example/agentops",
    "https://www.reddit.com/r/LocalLLaMA/comments/agentops",
  ]);
  assert.equal(merged.mentionCount, 3);
  assert.equal(merged.scoringSignals.mentionCount, 3);
});

test("dedupe hooks group cross-source items through normalized link and title fingerprints", () => {
  const hooks = createDefaultDeduplicationHooks();
  const githubItem = createNormalizedItemFromSourceRecord({
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
    outboundUrls: ["https://github.com/acme/open-agent-platform"],
    tags: ["github", "ai-agents"],
    author: "acme",
    metrics: { mentions: 1, upvotes: 240, comments: 0, shares: 0 },
    sourceAuthority: { authority: 95 },
    raw: {},
  });
  const redditItem = createNormalizedItemFromSourceRecord({
    adapterId: "reddit",
    sourceType: "reddit",
    externalId: "t3_dup123",
    title: "Open Agent Platform released",
    sourceName: "r/LocalLLaMA",
    sourceUrl:
      "https://www.reddit.com/r/LocalLLaMA/comments/dup123/open_agent_platform_released/",
    publishedAt: "2026-03-11T20:00:00Z",
    summary: "Operator notes with repo link https://github.com/Acme/Open-Agent-Platform?utm_source=reddit",
    integrationHint: "Review the operator thread before rollout.",
    outboundUrls: [
      "https://github.com/Acme/Open-Agent-Platform?utm_source=reddit",
      "https://docs.example.com/open-agent-platform",
    ],
    tags: ["LocalLLaMA", "reddit", "ai-agents"],
    author: "builder",
    metrics: { mentions: 1, upvotes: 81, comments: 14, shares: 0 },
    sourceAuthority: { authority: 62 },
    raw: {},
  });

  assert.equal(hooks.isDuplicate(githubItem, redditItem), true);

  const merged = hooks.merge(githubItem, redditItem);

  assert.equal(merged.mentionCount, 2);
  assert.deepEqual(merged.sourceKinds.sort(), ["github", "reddit"]);
  assert.deepEqual(merged.adapterIds.sort(), ["github", "reddit"]);
  assert.equal(merged.sourceUrl, "https://github.com/acme/open-agent-platform");
});

test("dedupe hooks keep similarly named but distinct items separate", () => {
  const hooks = createDefaultDeduplicationHooks();
  const toolkit = createNormalizedItem({
    name: "Agent Toolkit",
    sourceUrl: "https://github.com/acme/agent-toolkit",
    category: "tool",
    summary: "Toolkit for tool-calling agents.",
    integrationHint: "npm install @acme/agent-toolkit",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 95,
  });
  const toolkitPro = createNormalizedItem({
    name: "Agent Toolkit Pro",
    sourceUrl: "https://github.com/acme/agent-toolkit-pro",
    category: "tool",
    summary: "Hosted control plane for enterprise agent teams.",
    integrationHint: "Contact the vendor for API access.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 72,
  });

  assert.equal(hooks.isDuplicate(toolkit, toolkitPro), false);
});

test("aggregation pipeline collects, filters, deduplicates, and scores items across adapters", async () => {
  const descriptorById = new Map(
    DEFAULT_SOURCE_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
  );
  const registry = new SourceRegistry(
    [
      defineSourceAdapter({
        descriptor: descriptorById.get("x"),
        async fetch() {
          return {
            items: [
              {
                name: "AutoGen Studio",
                sourceUrl: "https://x.com/example/status/123",
                category: "technique",
                summary: "A high-signal thread on multi-agent workflow design.",
                integrationHint: "Translate the workflow into your planner module.",
              },
            ],
            discoveredSources: [
              {
                id: "hf-blog",
                kind: "web",
                displayName: "Hugging Face Blog",
                url: "https://huggingface.co/blog/agents",
                authorityScore: 68,
                discoveredFromUrls: ["https://x.com/example/status/123"],
              },
            ],
          };
        },
      }),
      defineSourceAdapter({
        descriptor: descriptorById.get("github"),
        async fetch() {
          return {
            items: [
              {
                name: "AgentOps",
                sourceUrl: "https://github.com/example/agentops",
                category: "tool",
                summary: "Open source observability for agent systems.",
                integrationHint: "docker compose up",
                scoringSignals: {
                  githubStars: 4200,
                  githubActivity: 88,
                },
              },
            ],
          };
        },
      }),
      defineSourceAdapter({
        descriptor: descriptorById.get("arxiv"),
        async fetch() {
          return {
            items: [
              {
                name: "Self-Improving Tool Agents",
                sourceUrl: "https://arxiv.org/abs/2603.12345",
                category: "technique",
                summary: "Research on agents that iteratively expand their toolsets.",
                integrationHint: "Port the planner evaluation loop into your stack.",
              },
            ],
          };
        },
      }),
      defineSourceAdapter({
        descriptor: descriptorById.get("reddit"),
        async fetch() {
          return {
            items: [
              {
                name: "AgentOps",
                sourceUrl: "https://www.reddit.com/r/LocalLLaMA/comments/agentops",
                category: "tool",
                summary: "Community validation of the observability stack.",
                integrationHint: "Read the operator notes before deployment.",
                sourceAuthorityScore: 65,
                scoringSignals: {
                  socialEngagement: 74,
                },
              },
            ],
          };
        },
      }),
      defineSourceAdapter({
        descriptor: descriptorById.get("web-discovery"),
        async fetch() {
          return {
            items: [
              {
                name: "Unverified Agent Blog",
                sourceUrl: "https://unknown.example.com/post",
                category: "library",
                summary: "A newly discovered library with weak provenance.",
                integrationHint: "Do not integrate yet.",
                sourceAuthorityScore: 25,
              },
            ],
          };
        },
      }),
    ],
  );

  const pipeline = new AggregationPipeline({
    registry,
    minRelevanceScore: 60,
    minSourceAuthorityScore: 50,
    scoreItem: async (item) =>
      Math.min(
        100,
        item.scoringSignals.sourceAuthority * 0.6 + item.scoringSignals.mentionCount * 20,
      ),
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-10T21:00:00Z",
    endsAt: "2026-03-11T21:00:00Z",
    timezone: "UTC",
  });

  assert.equal(result.fetchReports.length, 5);
  assert.equal(result.discoveredSources.length, 1);
  assert.deepEqual(
    result.items.map((item) => item.name).sort(),
    ["AgentOps", "AutoGen Studio", "Self-Improving Tool Agents"].sort(),
  );

  const agentOps = result.items.find((item) => item.name === "AgentOps");
  assert.ok(agentOps);
  assert.equal(agentOps.mentionCount, 2);
  assert.deepEqual(agentOps.sourceKinds.sort(), ["github", "reddit"]);
  assert.ok(agentOps.relevanceScore >= 60);
  assert.ok(
    result.fetchedItems.every(
      (item) =>
        Array.isArray(item.metadata.identitySignals) && item.metadata.identitySignals.length > 0,
    ),
  );
  assert.equal(result.candidateGroups.length, 3);
  const agentOpsGroup = result.candidateGroups.find((group) =>
    group.some((item) => item.name === "AgentOps"),
  );
  assert.deepEqual(
    agentOpsGroup?.map((item) => item.adapterIds[0]).sort(),
    ["github", "reddit"],
  );
  assert.deepEqual(
    [...new Set((agentOpsGroup ?? []).map((item) => item.itemId))],
    [agentOps.itemId],
  );
  assert.deepEqual(
    [...new Set((agentOpsGroup ?? []).map((item) => item.metadata.deduplicationClusterId))],
    [agentOps.itemId],
  );

  const rejectedNames = result.fetchReports.flatMap((report) => report.fetchedCount);
  assert.deepEqual(rejectedNames, [1, 1, 1, 1, 1]);
});

test("aggregation pipeline excludes discovered-source items until the source is approved", async () => {
  const repository = await createSourceRepositoryWithSources([
    createDiscoveredSourceRecord({
      hostname: "unknown.example.com",
      status: "candidate",
      authorityScore: 42,
      signalScore: 88,
    }),
  ]);
  const registry = createRegistry({
    "web-discovery": async () => ({
      items: [
        {
          name: "Unknown Agent SDK",
          sourceUrl: "https://unknown.example.com/post",
          category: "library",
          summary: "A newly discovered SDK from an unapproved source.",
          integrationHint: "Wait for the source to clear curation before using it.",
          sourceAuthorityScore: 92,
        },
      ],
    }),
  });
  const pipeline = new AggregationPipeline({
    registry,
    sourceRepository: repository,
    scoreItem: async () => 88,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-10T21:00:00Z",
    endsAt: "2026-03-11T21:00:00Z",
    timezone: "UTC",
  });

  assert.deepEqual(result.items, []);
  assert.equal(result.exclusionDecisions.length, 1);
  assert.equal(result.exclusionDecisions[0].itemId, "artifact-unknown-agent-sdk");
  assert.equal(result.exclusionDecisions[0].name, "Unknown Agent SDK");
  assert.equal(result.exclusionDecisions[0].category, "library");
  assert.equal(result.exclusionDecisions[0].sourceUrl, "https://unknown.example.com/post");
  assert.equal(result.exclusionDecisions[0].phase, "source");
  assert.equal(result.exclusionDecisions[0].reason, "source_not_approved");
  assert.equal(result.exclusionDecisions[0].exclusionReasonCode, "source_not_approved");
  assert.match(
    result.exclusionDecisions[0].timestamp,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
  assert.equal(
    result.exclusionDecisions[0].itemIdentity.itemId,
    "artifact-unknown-agent-sdk",
  );
  assert.equal(result.exclusionDecisions[0].itemIdentity.name, "Unknown Agent SDK");
  assert.equal(
    result.exclusionDecisions[0].itemIdentity.sourceUrl,
    "https://unknown.example.com/post",
  );
  assert.deepEqual(result.exclusionDecisions[0].itemIdentity.sourceUrls, [
    "https://unknown.example.com/post",
  ]);
  assert.equal(
    result.exclusionDecisions[0].itemIdentity.canonicalIdentifiers.entityName,
    "Unknown Agent SDK",
  );
  assert.equal(result.exclusionDecisions[0].evaluationContext.stage, "source_gate");
  assert.deepEqual(result.exclusionDecisions[0].evaluationContext.window, {
    startsAt: "2026-03-10T21:00:00Z",
    endsAt: "2026-03-11T21:00:00Z",
    timezone: "UTC",
  });
  assert.equal(
    result.exclusionDecisions[0].evaluationContext.source.sourceId,
    "web:domain:unknown.example.com",
  );
  assert.equal(
    result.exclusionDecisions[0].evaluationContext.source.sourceStatus,
    "candidate",
  );
  assert.equal(
    result.exclusionDecisions[0].evaluationContext.source.sourceLifecycleState,
    "probation",
  );
  assert.equal(
    result.exclusionDecisions[0].evaluationContext.source.requiresSourceApproval,
    true,
  );
  assert.equal(
    result.exclusionDecisions[0].evaluationContext.source.minimumItemAuthorityScore,
    50,
  );
  assert.equal(
    result.exclusionDecisions[0].evaluationContext.source.effectiveSourceAuthorityScore,
    92,
  );
});

test("aggregation pipeline preserves first-discovery lifecycle fields for new items", async () => {
  const registry = createRegistry({
    "web-discovery": async () => ({
      items: [
        {
          name: "Agent Toolkit setup guide",
          sourceUrl: "https://docs.example.com/agent-toolkit/get-started?ref=nav",
          category: "library",
          summary: "Setup guide for the Agent Toolkit library.",
          integrationHint: "Follow the setup guide after reviewing the repository.",
          sourceAuthorityScore: 68,
          discoveredAt: "2026-03-12T20:30:00.000Z",
          metadata: {
            outboundUrls: ["https://github.com/acme/agent-toolkit?utm_source=docs"],
          },
        },
      ],
    }),
  });
  const pipeline = new AggregationPipeline({
    registry,
    scoreItem: async () => 88,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-11T21:00:00.000Z",
    endsAt: "2026-03-12T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].itemId, "artifact-github-com-acme-agent-toolkit");
  assert.equal(result.items[0].firstSeen, "2026-03-12T20:30:00.000Z");
  assert.equal(result.items[0].editionCount, 1);
});

test("aggregation pipeline increments lifecycle fields when the same item is rediscovered in a later edition", async () => {
  const editionHistoryStore = {
    async loadHistory() {
      return [
        {
          id: "2026-03-11",
          publishedAt: "2026-03-11T21:00:00.000Z",
          window: {
            startsAt: "2026-03-10T21:00:00.000Z",
            endsAt: "2026-03-11T21:00:00.000Z",
            timezone: "UTC",
          },
          items: [
            createNormalizedItem({
              id: "persistent-agent-toolkit",
              itemId: "persistent-agent-toolkit-item",
              name: "Agent Toolkit",
              sourceUrl: "https://github.com/acme/agent-toolkit",
              category: "library",
              summary: "Official repository for Agent Toolkit.",
              integrationHint: "npm install agent-toolkit",
              relevanceScore: 83,
              sourceKinds: ["github"],
              adapterIds: ["github"],
              sourceAuthorityScore: 94,
              firstSeen: "2026-03-10T20:30:00.000Z",
              editionCount: 2,
              discoveredAt: "2026-03-11T20:30:00.000Z",
            }),
          ],
        },
      ];
    },
  };
  const registry = createRegistry({
    "web-discovery": async () => ({
      items: [
        {
          name: "Agent Toolkit rollout guide",
          sourceUrl: "https://docs.example.com/agent-toolkit/rollout?utm_source=daily",
          category: "library",
          summary: "Rollout guide for Agent Toolkit.",
          integrationHint: "Use the guide to validate production rollout steps.",
          sourceAuthorityScore: 68,
          discoveredAt: "2026-03-12T20:45:00.000Z",
          metadata: {
            outboundUrls: ["https://github.com/acme/agent-toolkit?ref=guide"],
          },
        },
      ],
    }),
  });
  const pipeline = new AggregationPipeline({
    registry,
    editionHistoryStore,
    scoreItem: async () => 88,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-11T21:00:00.000Z",
    endsAt: "2026-03-12T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, result.candidateGroups[0][0].id);
  assert.notEqual(result.items[0].id, "persistent-agent-toolkit");
  assert.equal(result.items[0].itemId, "persistent-agent-toolkit-item");
  assert.equal(result.items[0].firstSeen, "2026-03-10T20:30:00.000Z");
  assert.equal(result.items[0].editionCount, 3);
  assert.equal(
    result.items[0].metadata.storyline.storylineId,
    "storyline-persistent-agent-toolkit-item",
  );
  assert.equal(result.items[0].metadata.storyline.position, 2);
  assert.equal(result.items[0].metadata.storyline.relationship.decision, "evolution");
});

test("aggregation pipeline records storyline repetition when later coverage re-reports the same facts", async () => {
  const editionHistoryStore = {
    async loadHistory() {
      return [
        {
          id: "2026-03-11",
          publishedAt: "2026-03-11T21:00:00.000Z",
          window: {
            startsAt: "2026-03-10T21:00:00.000Z",
            endsAt: "2026-03-11T21:00:00.000Z",
            timezone: "UTC",
          },
          items: [
            createNormalizedItem({
              id: "persistent-agent-sdk",
              itemId: "persistent-agent-sdk-item",
              name: "Agent SDK",
              sourceUrl: "https://github.com/acme/agent-sdk",
              category: "library",
              summary: "Agent SDK packages browser and shell tools for autonomous workflows.",
              integrationHint:
                "npm install agent-sdk and configure the browser and shell adapters.",
              relevanceScore: 83,
              sourceKinds: ["github"],
              adapterIds: ["github"],
              sourceAuthorityScore: 94,
              firstSeen: "2026-03-10T20:30:00.000Z",
              editionCount: 1,
              discoveredAt: "2026-03-11T20:30:00.000Z",
            }),
          ],
        },
      ];
    },
  };
  const registry = createRegistry({
    "web-discovery": async () => ({
      items: [
        {
          name: "Agent SDK launch recap",
          sourceUrl: "https://blog.example.com/agent-sdk-launch",
          category: "library",
          summary: "Agent SDK packages browser and shell tools for autonomous workflows.",
          integrationHint:
            "Install agent-sdk, then enable the browser and shell adapters.",
          sourceAuthorityScore: 71,
          discoveredAt: "2026-03-12T20:45:00.000Z",
          metadata: {
            outboundUrls: ["https://github.com/acme/agent-sdk?ref=launch"],
          },
        },
      ],
    }),
  });
  const pipeline = new AggregationPipeline({
    registry,
    editionHistoryStore,
    scoreItem: async () => 85,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-11T21:00:00.000Z",
    endsAt: "2026-03-12T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].metadata.storyline.position, 2);
  assert.equal(result.items[0].metadata.storyline.relationship.decision, "repetition");
  assert.equal(result.items[0].metadata.storyline.relationship.priorAppearanceCount, 1);
  assert.equal(
    result.items[0].metadata.storyline.relationship.previousAppearance.editionId,
    "2026-03-11",
  );
});

test("aggregation pipeline reuses historical item ids when only text similarity is available", async () => {
  const editionHistoryStore = {
    async loadHistory() {
      return [
        {
          id: "2026-03-11",
          publishedAt: "2026-03-11T21:00:00.000Z",
          window: {
            startsAt: "2026-03-10T21:00:00.000Z",
            endsAt: "2026-03-11T21:00:00.000Z",
            timezone: "UTC",
          },
          items: [
            createNormalizedItem({
              id: "persistent-flowstate-memory-engine",
              itemId: "persistent-flowstate-memory-engine-item",
              name: "Flowstate Memory Engine",
              sourceUrl: "https://signals.example.com/notes/day-1",
              category: "library",
              summary: "Initial notes on Flowstate Memory Engine.",
              integrationHint: "Review the original design notes before adoption.",
              relevanceScore: 82,
              sourceKinds: ["web"],
              adapterIds: ["web-discovery"],
              sourceAuthorityScore: 62,
              firstSeen: "2026-03-11T20:00:00.000Z",
              editionCount: 1,
              discoveredAt: "2026-03-11T20:15:00.000Z",
            }),
          ],
        },
      ];
    },
  };
  const registry = createRegistry({
    "web-discovery": async () => ({
      items: [
        {
          name: "Flowstate Memory Engine for production",
          sourceUrl: "https://analysis.example.org/briefs/production-note",
          category: "library",
          summary: "Operational guidance for Flowstate Memory Engine in production.",
          integrationHint: "Use this alongside the original notes when validating rollout steps.",
          sourceAuthorityScore: 66,
          discoveredAt: "2026-03-12T20:45:00.000Z",
        },
      ],
    }),
  });
  const pipeline = new AggregationPipeline({
    registry,
    editionHistoryStore,
    scoreItem: async () => 86,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-11T21:00:00.000Z",
    endsAt: "2026-03-12T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, result.candidateGroups[0][0].id);
  assert.notEqual(result.items[0].id, "persistent-flowstate-memory-engine");
  assert.equal(result.items[0].itemId, "persistent-flowstate-memory-engine-item");
  assert.equal(result.items[0].firstSeen, "2026-03-11T20:00:00.000Z");
  assert.equal(result.items[0].editionCount, 2);
});

test("aggregation pipeline reuses historical item identity for newly fetched duplicate groups", async () => {
  const historyCalls = [];
  const editionHistoryStore = {
    async loadHistory({ now }) {
      historyCalls.push(now);

      return [
        {
          id: "2026-03-11",
          publishedAt: "2026-03-11T21:00:00.000Z",
          window: {
            startsAt: "2026-03-10T21:00:00.000Z",
            endsAt: "2026-03-11T21:00:00.000Z",
            timezone: "UTC",
          },
          items: [
            createNormalizedItem({
              id: "persistent-agent-sdk",
              itemId: "persistent-agent-sdk-item",
              name: "Agent SDK",
              sourceUrl: "https://github.com/acme/agent-sdk",
              category: "library",
              summary: "Official repository for Agent SDK.",
              integrationHint: "npm install agent-sdk",
              relevanceScore: 84,
              sourceKinds: ["github"],
              adapterIds: ["github"],
              sourceAuthorityScore: 94,
              firstSeen: "2026-03-09T21:00:00.000Z",
              editionCount: 3,
              discoveredAt: "2026-03-11T20:30:00.000Z",
            }),
          ],
        },
      ];
    },
  };
  const registry = createRegistry({
    x: async () => ({
      items: [
        {
          name: "Agent SDK launch thread",
          sourceUrl: "https://x.com/builder/status/456?utm_source=feed",
          category: "library",
          summary: "Launch thread covering Agent SDK rollout notes.",
          integrationHint: "Read the launch notes before rollout.",
          sourceAuthorityScore: 72,
          metadata: {
            outboundUrls: ["https://github.com/acme/agent-sdk?utm_source=x"],
          },
        },
      ],
    }),
    "web-discovery": async () => ({
      items: [
        {
          name: "Official Agent SDK setup guide",
          sourceUrl: "https://docs.example.com/agent-sdk/get-started?ref=launch",
          category: "library",
          summary: "Setup guide for the Agent SDK runtime.",
          integrationHint: "Follow the setup guide after reviewing the repo.",
          sourceAuthorityScore: 68,
          metadata: {
            outboundUrls: ["https://github.com/acme/agent-sdk"],
          },
        },
      ],
    }),
  });
  const pipeline = new AggregationPipeline({
    registry,
    editionHistoryStore,
    scoreItem: async () => 88,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-11T21:00:00.000Z",
    endsAt: "2026-03-12T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.deepEqual(historyCalls, ["2026-03-12T21:00:00.000Z"]);
  assert.equal(result.candidateGroups.length, 1);
  assert.equal(new Set(result.candidateGroups[0].map((item) => item.id)).size, 2);
  assert.deepEqual(
    [...new Set(result.candidateGroups[0].map((item) => item.itemId))],
    ["persistent-agent-sdk-item"],
  );
  assert.equal(result.items.length, 1);
  assert.ok(result.candidateGroups[0].some((item) => item.id === result.items[0].id));
  assert.notEqual(result.items[0].id, "persistent-agent-sdk");
  assert.equal(result.items[0].itemId, "persistent-agent-sdk-item");
  assert.equal(result.items[0].firstSeen, "2026-03-09T21:00:00.000Z");
  assert.equal(result.items[0].editionCount, 4);
  assert.deepEqual(result.items[0].sourceKinds.sort(), ["web", "x"]);
});

test("aggregation pipeline includes discovered-source items once the source is approved", async () => {
  const repository = await createSourceRepositoryWithSources([
    createDiscoveredSourceRecord({
      hostname: "docs.agno.com",
      status: "approved",
      authorityScore: 78,
    }),
  ]);
  const registry = createRegistry({
    "web-discovery": async () => ({
      items: [
        {
          name: "Agno Agent Docs",
          sourceUrl: "https://docs.agno.com/agents/get-started",
          category: "tool",
          summary: "An approved discovered source with concrete agent setup docs.",
          integrationHint: "Port the setup steps into your bootstrap flow.",
          sourceAuthorityScore: 90,
        },
      ],
    }),
  });
  const pipeline = new AggregationPipeline({
    registry,
    sourceRepository: repository,
    scoreItem: async () => 84,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-10T21:00:00Z",
    endsAt: "2026-03-11T21:00:00Z",
    timezone: "UTC",
  });

  assert.deepEqual(result.items.map((item) => item.name), ["Agno Agent Docs"]);
});

test("aggregation pipeline reuses approved discovered-source authority for item eligibility and scoring", async () => {
  const repository = await createSourceRepositoryWithSources([
    createDiscoveredSourceRecord({
      hostname: "docs.agno.com",
      status: "approved",
      authorityScore: 78,
      lifecycle: {
        state: "active",
        stage: "active",
        probationStartedAt: "2026-03-11T20:00:00.000Z",
        activatedAt: "2026-03-11T21:00:00.000Z",
      },
    }),
  ]);
  const registry = createRegistry({
    "web-discovery": async () => ({
      items: [
        {
          name: "Agno CLI Install Guide",
          sourceUrl: "https://docs.agno.com/agents/install",
          category: "tool",
          summary: "Install notes hosted on an approved discovered source.",
          integrationHint: "Translate the install flow into your bootstrap step.",
          sourceAuthorityScore: 25,
        },
      ],
    }),
  });
  const pipeline = new AggregationPipeline({
    registry,
    sourceRepository: repository,
    minSourceAuthorityScore: 70,
    scoreItem: async (item) => item.scoringSignals.sourceAuthority,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-10T21:00:00Z",
    endsAt: "2026-03-11T21:00:00Z",
    timezone: "UTC",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, "Agno CLI Install Guide");
  assert.equal(result.items[0].sourceAuthorityScore, 78);
  assert.equal(result.items[0].scoringSignals.sourceAuthority, 78);
  assert.equal(result.items[0].relevanceScore, 78);
});

test("aggregation pipeline down-weights probationary discovered-source authority during scoring", async () => {
  const repository = await createSourceRepositoryWithSources([
    {
      ...createDiscoveredSourceRecord({
        hostname: "docs.agno.com",
        status: "approved",
        authorityScore: 78,
      }),
      lifecycle: {
        state: "probation",
        stage: "probation",
        probationStartedAt: "2026-03-11T20:00:00.000Z",
      },
    },
  ]);
  const registry = createRegistry({
    "web-discovery": async () => ({
      items: [
        {
          name: "Agno CLI Install Guide",
          sourceUrl: "https://docs.agno.com/agents/install",
          category: "tool",
          summary: "Install notes hosted on an approved discovered source.",
          integrationHint: "Translate the install flow into your bootstrap step.",
          sourceAuthorityScore: 25,
        },
      ],
    }),
  });
  const pipeline = new AggregationPipeline({
    registry,
    sourceRepository: repository,
    minSourceAuthorityScore: 70,
    scoreItem: async (item) => item.scoringSignals.sourceAuthority,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-10T21:00:00Z",
    endsAt: "2026-03-11T21:00:00Z",
    timezone: "UTC",
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.fetchedItems.length, 1);
  assert.equal(result.fetchedItems[0].sourceAuthorityScore, 25);
  assert.equal(result.fetchedItems[0].scoringSignals.sourceAuthority, 25);

  const probationaryCandidateGroup = result.candidateGroups[0];
  assert.equal(probationaryCandidateGroup.length, 1);
  assert.equal(probationaryCandidateGroup[0].sourceAuthorityScore, 78);
  assert.equal(probationaryCandidateGroup[0].scoringSignals.sourceAuthority, 59);
});

test("aggregation pipeline excludes items scoring below the curation relevance floor", async () => {
  const registry = createRegistry({
    github: async () => ({
      items: [
        {
          name: "Low-Signal Agent Repo",
          sourceUrl: "https://github.com/example/low-signal-agent",
          category: "tool",
          summary: "A repository that does not clear the composite relevance floor.",
          integrationHint: "Do not prioritize this until the signal improves.",
        },
      ],
    }),
  });
  const pipeline = new AggregationPipeline({
    registry,
    scoreItem: async () => 59,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-10T21:00:00Z",
    endsAt: "2026-03-11T21:00:00Z",
    timezone: "UTC",
  });

  assert.deepEqual(result.items, []);
  assert.deepEqual(
    result.scoredItems.map((item) => [item.name, item.relevanceScore]),
    [["Low-Signal Agent Repo", 59]],
  );
  assert.deepEqual(result.curationDecisions, [
    {
      itemId: "artifact-github-com-example-low-signal-agent",
      name: "Low-Signal Agent Repo",
      sourceUrl: "https://github.com/example/low-signal-agent",
      relevanceScore: 59,
      scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
      scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
      divergenceFlag: false,
      minRelevanceScore: 60,
      decision: "drop",
      scoreBreakdown: {
        score: 59,
        scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
        divergenceFlag: false,
      },
    },
  ]);
  assert.equal(result.exclusionDecisions.length, 1);
  assert.equal(
    result.exclusionDecisions[0].itemId,
    "artifact-github-com-example-low-signal-agent",
  );
  assert.equal(result.exclusionDecisions[0].name, "Low-Signal Agent Repo");
  assert.equal(result.exclusionDecisions[0].sourceUrl, "https://github.com/example/low-signal-agent");
  assert.equal(result.exclusionDecisions[0].category, "tool");
  assert.deepEqual(result.exclusionDecisions[0].sourceKinds, ["github"]);
  assert.deepEqual(result.exclusionDecisions[0].adapterIds, ["github"]);
  assert.equal(result.exclusionDecisions[0].reason, "relevance_below_threshold");
  assert.equal(result.exclusionDecisions[0].reasonCode, "relevance_below_threshold");
  assert.equal(result.exclusionDecisions[0].phase, "scoring");
  assert.equal(result.exclusionDecisions[0].relevanceScore, 59);
  assert.equal(result.exclusionDecisions[0].minRelevanceScore, 60);
  assert.equal(
    result.exclusionDecisions[0].scoreVersion,
    DEFAULT_RELEVANCE_SCORE_VERSION,
  );
  assert.match(
    result.exclusionDecisions[0].timestamp,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
  assert.equal(
    result.exclusionDecisions[0].itemIdentity.itemId,
    "artifact-github-com-example-low-signal-agent",
  );
  assert.equal(
    result.exclusionDecisions[0].itemIdentity.name,
    "Low-Signal Agent Repo",
  );
  assert.equal(
    result.exclusionDecisions[0].itemIdentity.sourceUrl,
    "https://github.com/example/low-signal-agent",
  );
  assert.deepEqual(result.exclusionDecisions[0].itemIdentity.sourceUrls, [
    "https://github.com/example/low-signal-agent",
  ]);
  assert.equal(
    result.exclusionDecisions[0].itemIdentity.canonicalIdentifiers.repositoryUrl,
    "https://github.com/example/low-signal-agent",
  );
  assert.equal(
    result.exclusionDecisions[0].itemIdentity.canonicalIdentifiers.sourceIds.github,
    "example/low-signal-agent",
  );
  assert.deepEqual(result.exclusionDecisions[0].evaluationContext, {
    stage: "relevance_gate",
    window: {
      startsAt: "2026-03-10T21:00:00Z",
      endsAt: "2026-03-11T21:00:00Z",
      timezone: "UTC",
    },
    relevance: {
      minRelevanceScore: 60,
      relevanceScore: 59,
      scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
      scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
      scoreBreakdown: {
        score: 59,
        scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
        divergenceFlag: false,
      },
    },
  });
});

test("aggregation pipeline keeps items scoring exactly at the curation relevance floor", async () => {
  const registry = createRegistry({
    github: async () => ({
      items: [
        {
          name: "Threshold Agent Repo",
          sourceUrl: "https://github.com/example/threshold-agent",
          category: "tool",
          summary: "A repository that clears the composite relevance floor exactly.",
          integrationHint: "Review before integrating.",
        },
      ],
    }),
  });
  const pipeline = new AggregationPipeline({
    registry,
    scoreItem: async () => 60,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-10T21:00:00Z",
    endsAt: "2026-03-11T21:00:00Z",
    timezone: "UTC",
  });

  assert.deepEqual(result.items.map((item) => item.name), ["Threshold Agent Repo"]);
  assert.equal(result.items[0].relevanceScore, 60);
  assert.deepEqual(result.items[0].metadata.curation.relevanceGate, {
    minRelevanceScore: 60,
    relevanceScore: 60,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
    divergenceFlag: false,
    decision: "keep",
    scoreBreakdown: {
      score: 60,
      scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
      scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
      divergenceFlag: false,
    },
  });
  assert.deepEqual(result.curationDecisions, [
    {
      itemId: "artifact-github-com-example-threshold-agent",
      name: "Threshold Agent Repo",
      sourceUrl: "https://github.com/example/threshold-agent",
      relevanceScore: 60,
      scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
      scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
      divergenceFlag: false,
      minRelevanceScore: 60,
      decision: "keep",
      scoreBreakdown: {
        score: 60,
        scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
        divergenceFlag: false,
      },
    },
  ]);
});

test("aggregation pipeline records the score breakdown used for keep and drop curation decisions", async () => {
  const registry = createRegistry({
    github: async () => ({
      items: [
        {
          name: "Kept Agent Runtime",
          sourceUrl: "https://github.com/example/kept-agent-runtime",
          category: "library",
          summary: "A repository with enough signal to pass curation.",
          integrationHint: "Review the setup guide before adoption.",
        },
        {
          name: "Dropped Agent Runtime",
          sourceUrl: "https://github.com/example/dropped-agent-runtime",
          category: "library",
          summary: "A repository that falls short of the relevance floor.",
          integrationHint: "Wait for more corroboration.",
        },
      ],
    }),
  });
  const scoreItem = async (item) =>
    item.name === "Kept Agent Runtime" ? 84 : 42;
  scoreItem.getBreakdown = (item) => ({
    score: item.name === "Kept Agent Runtime" ? 84 : 42,
    signals: {
      recency: item.name === "Kept Agent Runtime" ? 90 : 40,
      sourceAuthority: 95,
      mentionFrequency: item.name === "Kept Agent Runtime" ? 70 : 20,
      github: item.name === "Kept Agent Runtime" ? 88 : 35,
      socialEngagement: item.name === "Kept Agent Runtime" ? 62 : 10,
    },
  });
  const pipeline = new AggregationPipeline({
    registry,
    scoreItem,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-10T21:00:00Z",
    endsAt: "2026-03-11T21:00:00Z",
    timezone: "UTC",
  });

  assert.deepEqual(result.items.map((item) => item.name), ["Kept Agent Runtime"]);
  assert.deepEqual(result.items[0].metadata.curation.relevanceGate, {
    minRelevanceScore: 60,
    relevanceScore: 84,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
    divergenceFlag: false,
    decision: "keep",
    scoreBreakdown: {
      score: 84,
      scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
      scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
      divergenceFlag: false,
      signals: {
        recency: 90,
        sourceAuthority: 95,
        mentionFrequency: 70,
        github: 88,
        socialEngagement: 62,
      },
    },
  });
  assert.deepEqual(
    result.curationDecisions.map((decision) => ({
      name: decision.name,
      decision: decision.decision,
      scoreVersion: decision.scoreVersion,
      scoreInterpretation: decision.scoreInterpretation,
      divergenceFlag: decision.divergenceFlag,
      score: decision.scoreBreakdown.score,
      breakdownScoreVersion: decision.scoreBreakdown.scoreVersion,
      breakdownScoreInterpretation: decision.scoreBreakdown.scoreInterpretation,
      breakdownDivergenceFlag: decision.scoreBreakdown.divergenceFlag,
      signals: decision.scoreBreakdown.signals,
    })),
    [
      {
        name: "Kept Agent Runtime",
        decision: "keep",
        scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
        divergenceFlag: false,
        score: 84,
        breakdownScoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        breakdownScoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
        breakdownDivergenceFlag: false,
        signals: {
          recency: 90,
          sourceAuthority: 95,
          mentionFrequency: 70,
          github: 88,
          socialEngagement: 62,
        },
      },
      {
        name: "Dropped Agent Runtime",
        decision: "drop",
        scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        scoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
        divergenceFlag: false,
        score: 42,
        breakdownScoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        breakdownScoreInterpretation: DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
        breakdownDivergenceFlag: false,
        signals: {
          recency: 40,
          sourceAuthority: 95,
          mentionFrequency: 20,
          github: 35,
          socialEngagement: 10,
        },
      },
    ],
  );
});

test("aggregation pipeline retains fetched items for downstream discovery even when curation rejects them", async () => {
  const registry = createRegistry({
    github: async () => ({
      items: [
        {
          name: "Low-Signal Agent Repo",
          sourceUrl: "https://github.com/example/low-signal-agent",
          category: "tool",
          summary: "A repository that does not clear the composite relevance floor.",
          integrationHint: "Do not prioritize this until the signal improves.",
        },
      ],
    }),
  });
  const pipeline = new AggregationPipeline({
    registry,
    scoreItem: async () => 40,
  });

  const result = await pipeline.aggregate({
    startsAt: "2026-03-10T21:00:00Z",
    endsAt: "2026-03-11T21:00:00Z",
    timezone: "UTC",
  });

  assert.deepEqual(result.items, []);
  assert.equal(result.fetchedItems.length, 1);
  assert.equal(result.fetchedItems[0].name, "Low-Signal Agent Repo");
});
