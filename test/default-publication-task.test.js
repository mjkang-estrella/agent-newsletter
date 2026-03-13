import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  NEWSLETTER_DATA_DIR_ENV_NAME,
  SOURCE_LIFECYCLE_STAGES,
  SOURCE_RETIREMENT_REASONS,
  SourceRepository,
  SourceDiscoveryService,
  createDefaultPublicationTask,
  createNormalizedItem,
  createNormalizedItemFromSourceRecord,
  defineSourceAdapter,
  resolvePublicationRuntimePaths,
  runPublicationOnce,
} from "../src/index.js";

function createApprovedDiscoveredSource({
  hostname = "docs.example.com",
  approvedAt = "2026-03-12T20:00:00.000Z",
  lastSeenAt = "2026-03-12T20:00:00.000Z",
  authorityScore = 78,
} = {}) {
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
    status: "approved",
    seed: false,
    authorityScore,
    signalScore: 82,
    discoveredAt: "2026-03-12T18:00:00.000Z",
    approvedAt,
    lastSeenAt,
    evidence: {
      discoveryCount: 3,
      referrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
      trustedReferrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
      seedReferrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
      referrerPlatforms: ["web"],
      cyclesSeen: ["2026-03-12"],
      topicHits: ["agent", "sdk", "library"],
      exampleUrls: [`https://${hostname}/guides/agent-sdk`],
    },
    discoveredFromUrls: [
      "https://github.com/trending",
      "https://reddit.com/r/LocalLLaMA/comments/abc123",
    ],
  };
}

function createApprovedProbationarySource({
  hostname = "docs.example.com",
  approvedAt = "2026-03-10T21:00:00.000Z",
  lastSeenAt = approvedAt,
} = {}) {
  return {
    ...createApprovedDiscoveredSource({
      hostname,
      approvedAt,
      lastSeenAt,
      authorityScore: 72,
    }),
    lifecycle: {
      stage: SOURCE_LIFECYCLE_STAGES.probation,
      probationStartedAt: approvedAt,
      activatedAt: null,
      qualifyingCycles: [],
    },
    performance: {
      discoveryObservationCount: 3,
      qualifyingObservationCount: 0,
      lastObservedAt: lastSeenAt,
      lastQualifyingObservationAt: null,
      lastFetchedAt: null,
      lastSuccessfulFetchAt: null,
      lastFailedFetchAt: null,
      successfulFetchCount: 0,
      failedFetchCount: 0,
      consecutiveFetchFailures: 0,
      nextEligibleFetchAt: null,
    },
  };
}

function createApprovedSourceScoredItem({
  externalId = "docs-agent-update",
  title = "Agent docs update",
  sourceId = "web:domain:docs.example.com",
  sourceUrl = "https://docs.example.com/platform/agents",
  publishedAt = "2026-03-12T20:45:00.000Z",
  relevanceScore = 68,
} = {}) {
  return createNormalizedItemFromSourceRecord({
    adapterId: "web-discovery",
    sourceType: "web",
    externalId,
    title,
    sourceName: "docs.example.com",
    sourceUrl,
    publishedAt,
    discoveredAt: publishedAt,
    summary: "An approved source published a relevant agent update.",
    outboundUrls: [],
    tags: ["agent", "tool"],
    category: "tool",
    integrationHint: "Review before integrating.",
    author: null,
    relevanceScore,
    metrics: {
      mentions: 1,
      upvotes: 0,
      comments: 0,
      shares: 0,
    },
    sourceAuthority: {
      authority: 72,
    },
    metadata: {
      approvedSourceId: sourceId,
    },
    raw: {},
  });
}

function createExcludedSourceItem({
  externalId = "retired-agent-sdk",
  title = "Retired Agent SDK docs",
  sourceUrl = "https://retired.example.com/platform/agent-sdk",
  sourceName = null,
  itemId = null,
  publishedAt = "2026-03-12T20:45:00.000Z",
} = {}) {
  return createNormalizedItemFromSourceRecord({
    adapterId: "web-discovery",
    sourceType: "web",
    externalId,
    itemId,
    title,
    sourceName: sourceName ?? new URL(sourceUrl).hostname,
    sourceUrl,
    publishedAt,
    discoveredAt: publishedAt,
    summary: "Docs emitted by a retired source that should stay excluded.",
    outboundUrls: [],
    tags: ["agent", "sdk"],
    category: "library",
    integrationHint: "Wait for source restoration before integrating.",
    author: null,
    metrics: {
      mentions: 1,
      upvotes: 0,
      comments: 0,
      shares: 0,
    },
    sourceAuthority: {
      authority: 49,
    },
    raw: {},
  });
}

function createSourceGateExclusionDecision({
  item,
  reasonCode,
  timestamp,
  sourceId,
  sourceStatus,
  sourceLifecycleState,
  sourceAuthorityScore,
  minSourceAuthorityScore = 50,
}) {
  return {
    itemId: item.itemId,
    name: item.name,
    category: item.category,
    sourceUrl: item.sourceUrl,
    sourceKinds: item.sourceKinds,
    adapterIds: item.adapterIds,
    reasonCode,
    phase: "source",
    timestamp,
    sourceAuthorityScore,
    minSourceAuthorityScore,
    sourceStatus,
    sourceLifecycleState,
    evaluationContext: {
      stage: "source_gate",
      source: {
        sourceId,
        sourceStatus,
        sourceLifecycleState,
        requiresSourceApproval: true,
        minimumItemAuthorityScore: minSourceAuthorityScore,
        sourceAuthorityScore,
        weightedSourceAuthorityScore: sourceAuthorityScore,
        effectiveSourceAuthorityScore: sourceAuthorityScore,
      },
    },
  };
}

function createScheduledGithubAdapters({ fetchWindows = [] } = {}) {
  return {
    github: {
      enabled: true,
      ...defineSourceAdapter({
        descriptor: {
          id: "github",
          kind: "github",
          displayName: "GitHub",
          authorityScore: 95,
          seeded: true,
          supportsDiscovery: true,
          minimumItemAuthorityScore: 70,
        },
        async fetch(window) {
          fetchWindows.push(window);

          return {
            items: [
              createNormalizedItemFromSourceRecord({
                adapterId: "github",
                sourceType: "github",
                externalId: "agent-sdk",
                title: "Agent SDK for scheduled publication retries",
                sourceName: "GitHub",
                sourceUrl: "https://github.com/example/agent-sdk",
                publishedAt: "2026-03-12T20:45:00.000Z",
                discoveredAt: "2026-03-12T20:45:00.000Z",
                summary: "A TypeScript SDK for agent orchestration and tool use.",
                outboundUrls: [],
                tags: ["ai-agent", "typescript", "sdk"],
                category: "library",
                integrationHint:
                  "Install with npm and review the README examples before integrating it into an agent runtime.",
                author: "example",
                metrics: {
                  mentions: 3,
                  upvotes: 450,
                  comments: 30,
                  shares: 20,
                },
                sourceAuthority: {
                  authority: 95,
                },
                scoringSignals: {
                  githubStars: 14_000,
                  githubActivity: 88,
                },
                raw: {},
              }),
            ],
          };
        },
      }),
    },
  };
}

test("resolvePublicationRuntimePaths stores publication state in a workspace data directory", () => {
  const cwd = "/tmp/agent-newsletter";

  assert.deepEqual(resolvePublicationRuntimePaths({ cwd, env: {} }), {
    dataDirectoryPath: resolve(cwd, ".data"),
    editionsDirectoryPath: resolve(cwd, ".data", "editions"),
    sourceRegistryPath: resolve(cwd, ".data", "source-registry.json"),
    itemIdentityRegistryPath: resolve(cwd, ".data", "item-identity-registry.json"),
    consumerIdentityRegistryPath: resolve(cwd, ".data", "consumer-identities.json"),
  });

  assert.deepEqual(
    resolvePublicationRuntimePaths({
      cwd,
      env: {
        [NEWSLETTER_DATA_DIR_ENV_NAME]: "runtime/newsletter",
      },
    }),
    {
      dataDirectoryPath: resolve(cwd, "runtime/newsletter"),
      editionsDirectoryPath: resolve(cwd, "runtime/newsletter", "editions"),
      sourceRegistryPath: resolve(cwd, "runtime/newsletter", "source-registry.json"),
      itemIdentityRegistryPath: resolve(
        cwd,
        "runtime/newsletter",
        "item-identity-registry.json",
      ),
      consumerIdentityRegistryPath: resolve(
        cwd,
        "runtime/newsletter",
        "consumer-identities.json",
      ),
    },
  );
});

test("createDefaultPublicationTask publishes one daily edition from enabled adapters", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const aggregateWindows = [];
  let disabledFetchCalls = 0;

  const enabledAdapter = {
    enabled: true,
    ...defineSourceAdapter({
      descriptor: {
        id: "github",
        kind: "github",
        displayName: "GitHub",
        authorityScore: 95,
        seeded: true,
        supportsDiscovery: true,
        minimumItemAuthorityScore: 70,
      },
      async fetch(window) {
        aggregateWindows.push(window);

        return {
          items: [
            createNormalizedItemFromSourceRecord({
              adapterId: "github",
              sourceType: "github",
              externalId: "agent-sdk",
              title: "Agent SDK for tool-using workflows",
              sourceName: "GitHub",
              sourceUrl: "https://github.com/example/agent-sdk",
              publishedAt: "2026-03-12T20:45:00.000Z",
              summary: "A TypeScript SDK for agent orchestration and tool use.",
              outboundUrls: [],
              tags: ["ai-agent", "typescript", "sdk"],
              category: "library",
              integrationHint:
                "Install with npm and review the README examples before integrating it into an agent runtime.",
              author: "example",
              metrics: {
                mentions: 3,
                upvotes: 450,
                comments: 30,
                shares: 20,
              },
              sourceAuthority: {
                authority: 95,
              },
              scoringSignals: {
                githubStars: 14_000,
                githubActivity: 88,
              },
              raw: {},
            }),
          ],
        };
      },
    }),
  };
  const disabledAdapter = {
    enabled: false,
    ...defineSourceAdapter({
      descriptor: {
        id: "x-twitter",
        kind: "x",
        displayName: "X / Twitter",
        authorityScore: 72,
        seeded: true,
        supportsDiscovery: true,
        minimumItemAuthorityScore: 55,
      },
      async fetch() {
        disabledFetchCalls += 1;
        return { items: [] };
      },
    }),
  };

  const task = createDefaultPublicationTask({
    cwd,
    env: {
      NEWSLETTER_BASE_TIMEZONE: "UTC",
      [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
    },
    now: () => "2026-03-12T21:30:00.000Z",
    createAdapters() {
      return {
        github: enabledAdapter,
        twitter: disabledAdapter,
      };
    },
  });

  const edition = await task.publishNewsletterEdition();
  const storedEdition = await task.editionStore.loadLatest({
    now: "2026-03-12T21:30:00.000Z",
  });

  assert.equal(disabledFetchCalls, 0);
  assert.deepEqual(aggregateWindows, [
    {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
  ]);
  assert.equal(edition.publishedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(edition.items.length, 1);
  assert.deepEqual(storedEdition, edition);
  assert.deepEqual(task.paths, {
    dataDirectoryPath: resolve(cwd, "newsletter-state"),
    editionsDirectoryPath: resolve(cwd, "newsletter-state", "editions"),
    sourceRegistryPath: resolve(cwd, "newsletter-state", "source-registry.json"),
    itemIdentityRegistryPath: resolve(
      cwd,
      "newsletter-state",
      "item-identity-registry.json",
    ),
    consumerIdentityRegistryPath: resolve(
      cwd,
      "newsletter-state",
      "consumer-identities.json",
    ),
  });
});

test("createDefaultPublicationTask persists item identity state with scope versioned canonical records", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };

  const task = createDefaultPublicationTask({
    cwd,
    env,
    now: () => "2026-03-12T21:30:00.000Z",
    createAdapters() {
      return createScheduledGithubAdapters();
    },
  });

  const edition = await task.publishNewsletterEdition();
  const rawSnapshot = JSON.parse(
    await readFile(task.paths.itemIdentityRegistryPath, "utf8"),
  );

  assert.equal(rawSnapshot.version, 1);
  assert.equal(rawSnapshot.items.length, 1);
  assert.equal(rawSnapshot.items[0].itemId, edition.items[0].itemId);
  assert.equal(rawSnapshot.items[0].firstSeen, edition.items[0].firstSeen);
  assert.equal(rawSnapshot.items[0].editionCount, 1);
  assert.equal(
    rawSnapshot.items[0].scopeVersion,
    CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
  );
  assert.deepEqual(rawSnapshot.items[0].canonicalIdentifiers, {
    entityName: "Agent SDK",
    repositoryUrl: "https://github.com/example/agent-sdk",
    doi: null,
    sourceIds: {
      github: "agent-sdk",
    },
  });
  assert.deepEqual(rawSnapshot.items[0].appearanceHistory, [
    {
      editionId: "2026-03-12",
      publishedAt: "2026-03-12T21:00:00.000Z",
      relevanceScore: edition.items[0].relevanceScore,
      scoreVersion: edition.items[0].scoreVersion,
    },
  ]);
  assert.equal(
    rawSnapshot.items[0].latestItem.scopeVersion,
    CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
  );
});

test("createDefaultPublicationTask keeps a single tracked identity updated across repeated ingestions", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };
  let nowValue = "2026-03-12T21:30:00.000Z";

  const task = createDefaultPublicationTask({
    cwd,
    env,
    now: () => nowValue,
    pipeline: {
      async aggregate() {
        if (nowValue === "2026-03-12T21:30:00.000Z") {
          return {
            items: [
              createNormalizedItem({
                id: "docs-agent-sdk",
                name: "Agent SDK setup guide",
                sourceUrl: "https://docs.example.com/agent-sdk/get-started?utm_source=digest",
                category: "library",
                summary: "Setup guide for installing and configuring Agent SDK.",
                integrationHint:
                  "Follow the guide after validating the runtime requirements.",
                relevanceScore: 82,
                sourceKinds: ["web"],
                adapterIds: ["web-discovery"],
                sourceAuthorityScore: 68,
                discoveredAt: "2026-03-12T20:30:00.000Z",
              }),
            ],
          };
        }

        return {
          items: [
            createNormalizedItem({
              ...createNormalizedItemFromSourceRecord({
                adapterId: "github",
                sourceType: "github",
                externalId: "example/agent-sdk",
                title: "agent-sdk",
                sourceName: "GitHub",
                sourceUrl: "https://github.com/example/agent-sdk?utm_source=release",
                publishedAt: "2026-03-13T20:40:00.000Z",
                discoveredAt: "2026-03-13T20:40:00.000Z",
                summary: "Official repository for Agent SDK with install instructions.",
                outboundUrls: [],
                tags: ["github", "ai-agents", "sdk"],
                category: "library",
                integrationHint: "npm install agent-sdk",
                author: "example",
                metrics: {
                  mentions: 4,
                  upvotes: 250,
                  comments: 20,
                  shares: 15,
                },
                sourceAuthority: {
                  authority: 95,
                },
                scoringSignals: {
                  githubStars: 14_000,
                  githubActivity: 88,
                },
                raw: {},
              }),
              relevanceScore: 91,
            }),
          ],
        };
      },
    },
  });

  const firstEdition = await task.publishNewsletterEdition();

  nowValue = "2026-03-13T21:30:00.000Z";

  const secondEdition = await task.publishNewsletterEdition();
  const rawSnapshot = JSON.parse(
    await readFile(task.paths.itemIdentityRegistryPath, "utf8"),
  );

  assert.equal(firstEdition.items[0].itemId, "artifact-agent-sdk");
  assert.equal(secondEdition.items[0].itemId, firstEdition.items[0].itemId);
  assert.notEqual(secondEdition.items[0].id, firstEdition.items[0].id);
  assert.equal(secondEdition.items[0].editionCount, 2);
  assert.equal(secondEdition.items[0].firstSeen, firstEdition.items[0].firstSeen);
  assert.equal(
    secondEdition.items[0].sourceUrl,
    "https://github.com/example/agent-sdk?utm_source=release",
  );
  assert.equal(rawSnapshot.items.length, 1);
  assert.equal(rawSnapshot.items[0].itemId, firstEdition.items[0].itemId);
  assert.equal(rawSnapshot.items[0].sourceId, firstEdition.items[0].id);
  assert.equal(rawSnapshot.items[0].editionCount, 2);
  assert.equal(rawSnapshot.items[0].firstSeen, firstEdition.items[0].firstSeen);
  assert.equal(
    rawSnapshot.items[0].lastSeen,
    "2026-03-13T21:00:00.000Z",
  );
  assert.deepEqual(rawSnapshot.items[0].appearanceHistory, [
    {
      editionId: "2026-03-12",
      publishedAt: "2026-03-12T21:00:00.000Z",
      relevanceScore: firstEdition.items[0].relevanceScore,
      scoreVersion: firstEdition.items[0].scoreVersion,
    },
    {
      editionId: "2026-03-13",
      publishedAt: "2026-03-13T21:00:00.000Z",
      relevanceScore: secondEdition.items[0].relevanceScore,
      scoreVersion: secondEdition.items[0].scoreVersion,
    },
  ]);
  assert.deepEqual(rawSnapshot.items[0].canonicalIdentifiers, {
    entityName: "Agent SDK",
    repositoryUrl: "https://github.com/example/agent-sdk",
    doi: null,
    sourceIds: {
      github: "example/agent-sdk",
    },
  });
  assert.equal(rawSnapshot.items[0].latestItem.id, secondEdition.items[0].id);
  assert.equal(
    rawSnapshot.items[0].latestItem.sourceUrl,
    "https://github.com/example/agent-sdk?utm_source=release",
  );
  assert.equal(
    rawSnapshot.items[0].latestItem.summary,
    "Official repository for Agent SDK with install instructions.",
  );
  assert.equal(rawSnapshot.items[0].latestItem.editionCount, 2);
  assert.equal(
    rawSnapshot.items[0].latestItem.scopeVersion,
    CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
  );
});

test("createDefaultPublicationTask persists editions under the local publication date in the deployment timezone", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));

  const task = createDefaultPublicationTask({
    cwd,
    env: {
      NEWSLETTER_BASE_TIMEZONE: "America/Los_Angeles",
      [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
    },
    now: () => "2026-03-12T05:30:00.000Z",
    createAdapters() {
      return {
        github: {
          enabled: true,
          ...defineSourceAdapter({
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
                items: [
                  createNormalizedItemFromSourceRecord({
                    adapterId: "github",
                    sourceType: "github",
                    externalId: "agent-sdk",
                    title: "Agent SDK for local-time publication",
                    sourceName: "GitHub",
                    sourceUrl: "https://github.com/example/agent-sdk",
                    publishedAt: "2026-03-12T03:45:00.000Z",
                    summary: "A TypeScript SDK for agent orchestration and tool use.",
                    outboundUrls: [],
                    tags: ["ai-agent", "typescript", "sdk"],
                    category: "library",
                    integrationHint: "Install with npm and review the README examples.",
                    author: "example",
                    metrics: {
                      mentions: 2,
                      upvotes: 120,
                      comments: 10,
                      shares: 4,
                    },
                    sourceAuthority: {
                      authority: 95,
                    },
                    scoringSignals: {
                      githubStars: 9_000,
                      githubActivity: 81,
                    },
                    raw: {},
                  }),
                ],
              };
            },
          }),
        },
      };
    },
  });

  const edition = await task.publishNewsletterEdition();
  const persistedEdition = JSON.parse(
    await readFile(join(task.paths.editionsDirectoryPath, "2026-03-11.json"), "utf8"),
  );

  assert.equal(edition.id, "2026-03-11");
  assert.equal(edition.publishedAt, "2026-03-12T04:00:00.000Z");
  assert.deepEqual(edition.window, {
    startsAt: "2026-03-11T04:00:00.000Z",
    endsAt: "2026-03-12T04:00:00.000Z",
    timezone: "America/Los_Angeles",
  });
  assert.equal(persistedEdition.id, "2026-03-11");
  assert.equal(persistedEdition.publishedAt, "2026-03-12T04:00:00.000Z");
});

test("createDefaultPublicationTask includes approved discovered web sources in later fetch cycles", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };
  const paths = resolvePublicationRuntimePaths({ cwd, env });
  const sourceRepository = new SourceRepository({
    filePath: paths.sourceRegistryPath,
  });
  const fetchCalls = [];

  await sourceRepository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [createApprovedDiscoveredSource()],
  });

  const task = createDefaultPublicationTask({
    cwd,
    env,
    now: () => "2026-03-13T21:30:00.000Z",
    sourceRepository,
    webDiscoveryFetch: async (url) => {
      fetchCalls.push(url);

      return new Response(
        `
          <html>
            <head>
              <title>Acme Agent SDK</title>
              <meta name="description" content="A library for autonomous agent workflows and MCP integrations." />
              <link rel="canonical" href="/guides/agent-sdk?utm_source=home" />
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
    createAdapters() {
      return {};
    },
  });

  const edition = await task.publishNewsletterEdition();

  assert.deepEqual(fetchCalls, ["https://docs.example.com"]);
  assert.equal(edition.items.length, 1);
  assert.equal(edition.items[0].name, "Acme Agent SDK");
  assert.equal(edition.items[0].sourceUrl, "https://docs.example.com/guides/agent-sdk");
  assert.deepEqual(edition.items[0].adapterIds, ["web-discovery"]);
});

test("createDefaultPublicationTask persists source lifecycle transitions across restarted publication runs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };
  const paths = resolvePublicationRuntimePaths({ cwd, env });
  const discoveryConfig = {
    probationEvaluationWindowCycles: 2,
    probationMinQualifyingCycles: 2,
    probationPromotionMinScore: 60,
    retirementLowSignalCycles: 2,
    minimumActiveCategorySources: 1,
  };

  await new SourceRepository({
    filePath: paths.sourceRegistryPath,
    config: discoveryConfig,
  }).save({
    version: 1,
    updatedAt: "2026-03-11T21:00:00.000Z",
    sources: [createApprovedProbationarySource()],
  });

  const aggregatedItemsByRun = new Map([
    [
      "2026-03-12T21:30:00.000Z",
      [
        createApprovedSourceScoredItem({
          externalId: "docs-agent-update-2026-03-12",
          publishedAt: "2026-03-12T20:45:00.000Z",
          relevanceScore: 66,
        }),
      ],
    ],
    [
      "2026-03-13T21:30:00.000Z",
      [
        createApprovedSourceScoredItem({
          externalId: "docs-agent-update-2026-03-13",
          publishedAt: "2026-03-13T20:45:00.000Z",
          relevanceScore: 74,
        }),
      ],
    ],
    ["2026-03-14T21:30:00.000Z", []],
    ["2026-03-15T21:30:00.000Z", []],
  ]);

  async function publishRun(nowValue) {
    const sourceRepository = new SourceRepository({
      filePath: paths.sourceRegistryPath,
      config: discoveryConfig,
    });
    const task = createDefaultPublicationTask({
      cwd,
      env,
      now: () => nowValue,
      sourceRepository,
      sourceDiscoveryService: new SourceDiscoveryService({
        repository: sourceRepository,
        config: discoveryConfig,
      }),
      pipeline: {
        async aggregate() {
          return {
            items: aggregatedItemsByRun.get(nowValue) ?? [],
          };
        },
      },
    });

    await task.publishNewsletterEdition();
  }

  await publishRun("2026-03-12T21:30:00.000Z");

  let rawRegistry = JSON.parse(await readFile(paths.sourceRegistryPath, "utf8"));
  let storedSource = rawRegistry.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.equal(storedSource.status, "approved");
  assert.equal(storedSource.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);
  assert.deepEqual(
    storedSource.lifecycle.qualifyingCycles.map((entry) => entry.cycleId),
    ["2026-03-12"],
  );

  await publishRun("2026-03-13T21:30:00.000Z");

  rawRegistry = JSON.parse(await readFile(paths.sourceRegistryPath, "utf8"));
  storedSource = rawRegistry.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.equal(storedSource.status, "approved");
  assert.equal(storedSource.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.active);
  assert.equal(storedSource.lifecycle.activatedAt, "2026-03-13T21:00:00.000Z");
  assert.deepEqual(
    storedSource.lifecycle.qualifyingCycles.map((entry) => entry.cycleId),
    ["2026-03-12", "2026-03-13"],
  );

  await publishRun("2026-03-14T21:30:00.000Z");
  await publishRun("2026-03-15T21:30:00.000Z");

  rawRegistry = JSON.parse(await readFile(paths.sourceRegistryPath, "utf8"));
  storedSource = rawRegistry.sources.find(
    (source) => source.id === "web:domain:docs.example.com",
  );

  assert.equal(storedSource.status, "retired");
  assert.equal(storedSource.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.retired);
  assert.equal(storedSource.lifecycle.retiredAt, "2026-03-15T21:00:00.000Z");
  assert.equal(storedSource.lifecycle.lowSignalStreak, 2);
  assert.deepEqual(storedSource.lifecycle.lowSignalCycles, [
    "2026-03-14",
    "2026-03-15",
  ]);
  assert.equal(
    storedSource.lifecycle.retirementAudit.current.reason,
    SOURCE_RETIREMENT_REASONS.lowSignalStreak,
  );
});

test("createDefaultPublicationTask persists source-gate exclusion reasons across source lifecycle transitions", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };
  const paths = resolvePublicationRuntimePaths({ cwd, env });
  const discoveryConfig = {
    minimumActiveCategorySources: 1,
  };
  const sourceId = "web:domain:transitioned.example.com";
  const sourceUrl = "https://transitioned.example.com/platform/agent-sdk";
  const itemId = "artifact-transitioned-agent-sdk";

  async function createRunTask({
    nowValue,
    itemPublishedAt,
    reasonCode,
    sourceStatus,
    sourceLifecycleState,
    sourceAuthorityScore,
  }) {
    const sourceRepository = new SourceRepository({
      filePath: paths.sourceRegistryPath,
      config: discoveryConfig,
    });
    const item = createExcludedSourceItem({
      externalId: `transitioned-agent-sdk-${itemPublishedAt.slice(0, 10)}`,
      itemId,
      title: "Transitioned Agent SDK docs",
      sourceName: "transitioned.example.com",
      sourceUrl,
      publishedAt: itemPublishedAt,
    });

    return createDefaultPublicationTask({
      cwd,
      env,
      now: () => nowValue,
      sourceRepository,
      createAdapters() {
        return {};
      },
      sourceDiscoveryService: {
        async discoverFromItems() {
          return null;
        },
      },
      pipeline: {
        async aggregate() {
          return {
            items: [item],
            exclusionDecisions: [
              createSourceGateExclusionDecision({
                item,
                reasonCode,
                timestamp: itemPublishedAt,
                sourceId,
                sourceStatus,
                sourceLifecycleState,
                sourceAuthorityScore,
              }),
            ],
          };
        },
      },
    });
  }

  await new SourceRepository({
    filePath: paths.sourceRegistryPath,
    config: discoveryConfig,
  }).save({
    version: 1,
    updatedAt: "2026-03-12T20:00:00.000Z",
    sources: [
      {
        ...createApprovedProbationarySource({
          hostname: "transitioned.example.com",
          approvedAt: "2026-03-12T18:00:00.000Z",
          lastSeenAt: "2026-03-12T20:00:00.000Z",
        }),
        id: sourceId,
        status: "candidate",
        authorityScore: 47,
        signalScore: 55,
        approvedAt: null,
      },
    ],
  });

  const candidateTask = await createRunTask({
    nowValue: "2026-03-12T21:30:00.000Z",
    itemPublishedAt: "2026-03-12T21:00:00.000Z",
    reasonCode: "source_not_approved",
    sourceStatus: "candidate",
    sourceLifecycleState: "probation",
    sourceAuthorityScore: 47,
  });
  await candidateTask.publishNewsletterEdition();

  let repository = new SourceRepository({
    filePath: paths.sourceRegistryPath,
    config: discoveryConfig,
  });
  let snapshot = await repository.load({
    now: "2026-03-12T21:30:00.000Z",
  });
  let source = snapshot.sources.find((entry) => entry.id === sourceId);

  assert.ok(source);
  assert.equal(source.status, "candidate");
  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.probation);

  source.status = "approved";
  source.approvedAt = "2026-03-13T20:00:00.000Z";
  source.authorityScore = 78;
  source.signalScore = 82;
  source.lifecycle.state = SOURCE_LIFECYCLE_STAGES.active;
  source.lifecycle.stage = SOURCE_LIFECYCLE_STAGES.active;
  source.lifecycle.activatedAt = "2026-03-13T20:00:00.000Z";
  source.lifecycle.retiredAt = null;
  source.lifecycle.lowSignalStreak = 0;
  source.lifecycle.lowSignalCycles = [];
  source.lifecycle.qualifyingCycles = [
    {
      cycleId: "2026-03-13",
      observedAt: "2026-03-13T20:00:00.000Z",
      score: 78,
    },
  ];
  snapshot.updatedAt = "2026-03-13T20:00:00.000Z";
  await repository.save(snapshot);

  const retirement = await repository.retireSource(sourceId, {
    now: "2026-03-13T20:30:00.000Z",
    reason: SOURCE_RETIREMENT_REASONS.manual,
    evidence: {
      operator: "ops",
      ticket: "SRC-212",
    },
  });
  assert.equal(retirement.retired, true);
  assert.equal(retirement.blocked, false);

  repository = new SourceRepository({
    filePath: paths.sourceRegistryPath,
    config: discoveryConfig,
  });
  snapshot = await repository.load({
    now: "2026-03-13T20:30:00.000Z",
  });
  source = snapshot.sources.find((entry) => entry.id === sourceId);

  assert.ok(source);
  assert.equal(source.status, "retired");
  assert.equal(source.lifecycle.stage, SOURCE_LIFECYCLE_STAGES.retired);
  assert.equal(source.lifecycle.retiredAt, "2026-03-13T20:30:00.000Z");
  assert.equal(
    source.lifecycle.retirementAudit.current.reason,
    SOURCE_RETIREMENT_REASONS.manual,
  );

  const retiredTask = await createRunTask({
    nowValue: "2026-03-13T21:30:00.000Z",
    itemPublishedAt: "2026-03-13T21:00:00.000Z",
    reasonCode: "source_retired",
    sourceStatus: "retired",
    sourceLifecycleState: "retired",
    sourceAuthorityScore: 49,
  });
  await retiredTask.publishNewsletterEdition();

  const firstRawEdition = JSON.parse(
    await readFile(join(paths.editionsDirectoryPath, "2026-03-12.json"), "utf8"),
  );
  const secondRawEdition = JSON.parse(
    await readFile(join(paths.editionsDirectoryPath, "2026-03-13.json"), "utf8"),
  );
  const notApprovedAnalytics = await retiredTask.editionStore.loadExclusionAnalytics({
    now: "2026-03-13T21:30:00.000Z",
    reason: "source_not_approved",
    phase: "source",
  });
  const retiredAnalytics = await retiredTask.editionStore.loadExclusionAnalytics({
    now: "2026-03-13T21:30:00.000Z",
    reason: "source_retired",
    phase: "source",
  });

  assert.equal(firstRawEdition.exclusions[0].reasonCode, "source_not_approved");
  assert.equal(firstRawEdition.exclusions[0].reason, "source_not_approved");
  assert.equal(firstRawEdition.exclusions[0].sourceStatus, "candidate");
  assert.equal(firstRawEdition.exclusions[0].sourceLifecycleState, "probation");
  assert.equal(secondRawEdition.exclusions[0].reasonCode, "source_retired");
  assert.equal(secondRawEdition.exclusions[0].reason, "source_retired");
  assert.equal(secondRawEdition.exclusions[0].sourceStatus, "retired");
  assert.equal(secondRawEdition.exclusions[0].sourceLifecycleState, "retired");
  assert.deepEqual(
    notApprovedAnalytics.exclusions.map((entry) => ({
      editionId: entry.editionId,
      reason: entry.reason,
      sourceStatus: entry.sourceStatus,
      sourceLifecycleState: entry.sourceLifecycleState,
    })),
    [
      {
        editionId: "2026-03-12",
        reason: "source_not_approved",
        sourceStatus: "candidate",
        sourceLifecycleState: "probation",
      },
    ],
  );
  assert.deepEqual(
    retiredAnalytics.exclusions.map((entry) => ({
      editionId: entry.editionId,
      reason: entry.reason,
      sourceStatus: entry.sourceStatus,
      sourceLifecycleState: entry.sourceLifecycleState,
    })),
    [
      {
        editionId: "2026-03-13",
        reason: "source_retired",
        sourceStatus: "retired",
        sourceLifecycleState: "retired",
      },
    ],
  );
});

test("createDefaultPublicationTask reuses stable item identity across restarted publication days for matching items", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };
  function createRestartedTask(nowValue) {
    return createDefaultPublicationTask({
      cwd,
      env,
      now: () => nowValue,
      createAdapters() {
        return {
          github: {
            enabled: true,
            ...defineSourceAdapter({
              descriptor: {
                id: "github",
                kind: "github",
                displayName: "GitHub",
                authorityScore: 95,
                seeded: true,
                supportsDiscovery: true,
                minimumItemAuthorityScore: 70,
              },
              async fetch(window) {
                if (window.endsAt !== "2026-03-12T21:00:00.000Z") {
                  return { items: [] };
                }

                return {
                  items: [
                    createNormalizedItemFromSourceRecord({
                      adapterId: "github",
                      sourceType: "github",
                      externalId: "agent-sdk",
                      itemId: "persistent-agent-sdk-item",
                      title: "Agent SDK",
                      sourceName: "GitHub",
                      sourceUrl: "https://github.com/example/agent-sdk",
                      publishedAt: "2026-03-12T20:45:00.000Z",
                      discoveredAt: "2026-03-12T20:45:00.000Z",
                      summary: "Official repository for Agent SDK.",
                      outboundUrls: [],
                      tags: ["ai-agent", "sdk"],
                      category: "library",
                      integrationHint: "npm install agent-sdk",
                      author: "example",
                      metrics: {
                        mentions: 2,
                        upvotes: 220,
                        comments: 12,
                        shares: 8,
                      },
                      sourceAuthority: {
                        authority: 95,
                      },
                      raw: {},
                    }),
                  ],
                };
              },
            }),
          },
          twitter: {
            enabled: true,
            ...defineSourceAdapter({
              descriptor: {
                id: "x-twitter",
                kind: "x",
                displayName: "X / Twitter",
                authorityScore: 72,
                seeded: true,
                supportsDiscovery: true,
                minimumItemAuthorityScore: 55,
              },
              async fetch(window) {
                if (window.endsAt !== "2026-03-13T21:00:00.000Z") {
                  return { items: [] };
                }

                return {
                  items: [
                    createNormalizedItemFromSourceRecord({
                      adapterId: "x-twitter",
                      sourceType: "twitter",
                      externalId: "tweet-123",
                      title: "Agent SDK launch thread",
                      sourceName: "@example",
                      sourceUrl: "https://x.com/example/status/123?utm_source=feed",
                      publishedAt: "2026-03-13T20:40:00.000Z",
                      discoveredAt: "2026-03-13T20:40:00.000Z",
                      summary: "Launch thread for Agent SDK.",
                      outboundUrls: ["https://github.com/example/agent-sdk?utm_source=x"],
                      tags: ["twitter", "ai-agents", "sdk"],
                      category: "library",
                      integrationHint: "Review the launch thread before rollout.",
                      author: "example",
                      metrics: {
                        mentions: 3,
                        upvotes: 80,
                        comments: 14,
                        shares: 10,
                      },
                      sourceAuthority: {
                        authority: 72,
                      },
                      raw: {},
                    }),
                  ],
                };
              },
            }),
          },
        };
      },
    });
  }

  const firstTask = createRestartedTask("2026-03-12T21:30:00.000Z");
  const firstEdition = await firstTask.publishNewsletterEdition();
  const secondTask = createRestartedTask("2026-03-13T21:30:00.000Z");
  const secondEdition = await secondTask.publishNewsletterEdition();

  assert.equal(firstEdition.items.length, 1);
  assert.equal(secondEdition.items.length, 1);
  assert.equal(firstEdition.items[0].id, "github-agent-sdk");
  assert.equal(firstEdition.items[0].itemId, "persistent-agent-sdk-item");
  assert.equal(
    secondEdition.items[0].sourceUrl,
    "https://x.com/example/status/123",
  );
  assert.equal(secondEdition.items[0].id, "x-twitter-tweet-123");
  assert.equal(secondEdition.items[0].itemId, firstEdition.items[0].itemId);
  assert.equal(secondEdition.items[0].firstSeen, firstEdition.items[0].firstSeen);
  assert.equal(secondEdition.items[0].editionCount, 2);

  const rawSnapshot = JSON.parse(
    await readFile(secondTask.paths.itemIdentityRegistryPath, "utf8"),
  );

  assert.equal(rawSnapshot.items.length, 1);
  assert.equal(rawSnapshot.items[0].itemId, firstEdition.items[0].itemId);
  assert.equal(rawSnapshot.items[0].editionCount, 2);
});

test("createDefaultPublicationTask keeps same-slot retries to a single 21:00 UTC publication run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };
  const fetchWindows = [];

  const task = createDefaultPublicationTask({
    cwd,
    env,
    now: () => "2026-03-12T21:30:00.000Z",
    createAdapters() {
      return createScheduledGithubAdapters({ fetchWindows });
    },
  });

  const firstEdition = await task.publishNewsletterEdition();
  const retriedEdition = await task.publishNewsletterEdition();
  const editionFiles = await readdir(task.paths.editionsDirectoryPath);
  const history = await task.editionStore.loadHistory({
    now: "2026-03-12T21:30:00.000Z",
  });

  assert.deepEqual(fetchWindows, [
    {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
  ]);
  assert.equal(firstEdition.id, "2026-03-12");
  assert.equal(retriedEdition.id, firstEdition.id);
  assert.equal(retriedEdition.publishedAt, firstEdition.publishedAt);
  assert.equal(retriedEdition.items[0].itemId, firstEdition.items[0].itemId);
  assert.equal(retriedEdition.items[0].firstSeen, firstEdition.items[0].firstSeen);
  assert.equal(retriedEdition.items[0].editionCount, 1);
  assert.deepEqual(editionFiles, ["2026-03-12.json"]);
  assert.deepEqual(history, [retriedEdition]);
});

test("createDefaultPublicationTask keeps same-slot restarts to a single 21:00 UTC publication run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };
  const fetchWindows = [];

  const firstTask = createDefaultPublicationTask({
    cwd,
    env,
    now: () => "2026-03-12T21:30:00.000Z",
    createAdapters() {
      return createScheduledGithubAdapters({ fetchWindows });
    },
  });
  const initialEdition = await firstTask.publishNewsletterEdition();

  const restartedTask = createDefaultPublicationTask({
    cwd,
    env,
    now: () => "2026-03-12T21:30:00.000Z",
    createAdapters() {
      return createScheduledGithubAdapters({ fetchWindows });
    },
  });
  const restartedEdition = await restartedTask.publishNewsletterEdition();
  const editionFiles = await readdir(restartedTask.paths.editionsDirectoryPath);
  const latestEdition = await restartedTask.editionStore.loadLatest({
    now: "2026-03-12T21:30:00.000Z",
  });

  assert.deepEqual(fetchWindows, [
    {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
  ]);
  assert.equal(restartedEdition.id, initialEdition.id);
  assert.equal(restartedEdition.publishedAt, initialEdition.publishedAt);
  assert.equal(restartedEdition.items[0].itemId, initialEdition.items[0].itemId);
  assert.equal(restartedEdition.items[0].firstSeen, initialEdition.items[0].firstSeen);
  assert.equal(restartedEdition.items[0].editionCount, 1);
  assert.deepEqual(editionFiles, ["2026-03-12.json"]);
  assert.deepEqual(latestEdition, restartedEdition);
});

test("createDefaultPublicationTask persists auditable source-retired exclusions across restarted publication runs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };
  const publicationPayloadsByRun = new Map([
    [
      "2026-03-12T21:30:00.000Z",
      {
        item: createExcludedSourceItem({
          externalId: "retired-agent-sdk-2026-03-12",
          publishedAt: "2026-03-12T20:45:00.000Z",
        }),
        publishedAt: "2026-03-12T21:00:00.000Z",
      },
    ],
    [
      "2026-03-13T21:30:00.000Z",
      {
        item: createExcludedSourceItem({
          externalId: "retired-agent-sdk-2026-03-13",
          publishedAt: "2026-03-13T20:45:00.000Z",
        }),
        publishedAt: "2026-03-13T21:00:00.000Z",
      },
    ],
  ]);

  function createRestartedTask(nowValue) {
    return createDefaultPublicationTask({
      cwd,
      env,
      now: () => nowValue,
      createAdapters() {
        return {};
      },
      pipeline: {
        async aggregate() {
          const publicationPayload = publicationPayloadsByRun.get(nowValue);
          const excludedItem = publicationPayload.item;

          return {
            items: [excludedItem],
            exclusionDecisions: [
              {
                itemId: excludedItem.itemId,
                name: excludedItem.name,
                category: excludedItem.category,
                sourceUrl: excludedItem.sourceUrl,
                sourceKinds: excludedItem.sourceKinds,
                adapterIds: excludedItem.adapterIds,
                reasonCode: "source_retired",
                phase: "source",
                timestamp: publicationPayload.publishedAt,
                sourceAuthorityScore: 49,
                minSourceAuthorityScore: 50,
                sourceStatus: "retired",
                sourceLifecycleState: "retired",
                evaluationContext: {
                  stage: "source_gate",
                  source: {
                    sourceId: "web:domain:retired.example.com",
                    sourceStatus: "retired",
                    sourceLifecycleState: "retired",
                    requiresSourceApproval: true,
                    minimumItemAuthorityScore: 50,
                    sourceAuthorityScore: 49,
                    weightedSourceAuthorityScore: 49,
                    effectiveSourceAuthorityScore: 49,
                  },
                },
              },
            ],
          };
        },
      },
    });
  }

  const firstTask = createRestartedTask("2026-03-12T21:30:00.000Z");
  await firstTask.publishNewsletterEdition();
  const secondTask = createRestartedTask("2026-03-13T21:30:00.000Z");
  const secondEdition = await secondTask.publishNewsletterEdition();
  const firstRawEdition = JSON.parse(
    await readFile(join(secondTask.paths.editionsDirectoryPath, "2026-03-12.json"), "utf8"),
  );
  const analytics = await secondTask.editionStore.loadExclusionAnalytics({
    now: "2026-03-13T21:30:00.000Z",
    itemId: secondEdition.exclusions[0].itemId,
    reason: "source_retired",
    phase: "source",
    minRecurringEditions: 2,
  });

  assert.equal(firstRawEdition.exclusions.length, 1);
  assert.equal(firstRawEdition.exclusions[0].reasonCode, "source_retired");
  assert.equal(firstRawEdition.exclusions[0].exclusionReasonCode, "source_retired");
  assert.equal(firstRawEdition.exclusions[0].sourceStatus, "retired");
  assert.equal(firstRawEdition.exclusions[0].sourceLifecycleState, "retired");
  assert.deepEqual(firstRawEdition.exclusions[0].evaluationContext, {
    stage: "source_gate",
    source: {
      sourceId: "web:domain:retired.example.com",
      sourceStatus: "retired",
      sourceLifecycleState: "retired",
      requiresSourceApproval: true,
      minimumItemAuthorityScore: 50,
      sourceAuthorityScore: 49,
      weightedSourceAuthorityScore: 49,
      effectiveSourceAuthorityScore: 49,
    },
  });
  assert.equal(secondEdition.exclusions[0].reason, "source_retired");
  assert.equal(secondEdition.exclusions[0].phase, "source");
  assert.deepEqual(analytics.totals, {
    scannedEditionCount: 2,
    matchedEditionCount: 2,
    exclusionCount: 2,
    distinctItemCount: 1,
    recurringItemCount: 1,
    blindSpotCount: 1,
  });
  assert.deepEqual(analytics.recurringItems, [
    {
      itemId: secondEdition.exclusions[0].itemId,
      name: secondEdition.exclusions[0].name,
      category: "library",
      exclusionCount: 2,
      editionCount: 2,
      reasons: ["source_retired"],
      firstExcludedAt: "2026-03-12T21:00:00.000Z",
      lastExcludedAt: "2026-03-13T21:00:00.000Z",
    },
  ]);
});

test("runPublicationOnce invokes the one-shot publication command for cron jobs", async () => {
  const logEntries = [];

  const edition = await runPublicationOnce({
    async publish() {
      return {
        publishedAt: "2026-03-12T21:00:00.000Z",
        items: [{ id: "agent-sdk" }, { id: "mcp-tool" }],
      };
    },
    logInfo(...args) {
      logEntries.push(args);
    },
  });

  assert.equal(edition.publishedAt, "2026-03-12T21:00:00.000Z");
  assert.deepEqual(logEntries, [
    [
      "Newsletter edition published.",
      {
        publishedAt: "2026-03-12T21:00:00.000Z",
        itemCount: 2,
      },
    ],
  ]);
});

test("createDefaultPublicationTask forwards the twitter client factory to adapter creation", async () => {
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

  createDefaultPublicationTask({
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
