import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  SOURCE_RETIREMENT_REASONS,
  SourceRepository,
  WebDiscoverySourceAdapter,
} from "../src/index.js";

async function createSourceRepository(sources) {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new SourceRepository({
    filePath: join(directory, "source-registry.json"),
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources,
  });

  return repository;
}

function createApprovedDiscoveredSource({
  hostname = "docs.example.com",
  approvedAt = "2026-03-12T20:00:00.000Z",
  lastSeenAt = "2026-03-12T20:00:00.000Z",
  authorityScore = 78,
  categoryCoverage = ["library"],
  performance,
  lifecycle = {
    stage: "active",
    probationStartedAt: "2026-03-10T20:00:00.000Z",
    activatedAt: "2026-03-12T20:00:00.000Z",
    qualifyingCycles: [
      {
        cycleId: "2026-03-10",
        observedAt: "2026-03-10T20:00:00.000Z",
        score: 72,
      },
      {
        cycleId: "2026-03-11",
        observedAt: "2026-03-11T20:00:00.000Z",
        score: 74,
      },
      {
        cycleId: "2026-03-12",
        observedAt: "2026-03-12T20:00:00.000Z",
        score: 76,
      },
    ],
  },
  seed = false,
  status = "approved",
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
    status,
    seed,
    authorityScore,
    signalScore: 82,
    discoveredAt: "2026-03-12T18:00:00.000Z",
    approvedAt,
    lastSeenAt,
    lifecycle,
    evidence: {
      discoveryCount: 3,
      referrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
      trustedReferrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
      seedReferrers: ["github:domain:github.com", "reddit:domain:reddit.com"],
      referrerPlatforms: ["web"],
      cyclesSeen: ["2026-03-12"],
      topicHits: ["agent", "sdk", "library"],
      categoryCoverage,
      exampleUrls: [`https://${hostname}/guides/agent-sdk`],
    },
    discoveredFromUrls: [
      "https://github.com/trending",
      "https://reddit.com/r/LocalLLaMA/comments/abc123",
    ],
    ...(performance ? { performance } : {}),
  };
}

test("web discovery adapter fetches approved discovered sources into normalized items", async () => {
  const repository = await createSourceRepository([createApprovedDiscoveredSource()]);
  const calls = [];
  const adapter = new WebDiscoverySourceAdapter({
    sourceRepository: repository,
    fetch: async (url) => {
      calls.push(url);

      return new Response(
        `
          <html>
            <head>
              <title>Acme Agent SDK</title>
              <meta name="description" content="A library for autonomous agent workflows and MCP integrations." />
              <link rel="canonical" href="/guides/agent-sdk?utm_source=home" />
            </head>
            <body>
              <a href="/docs/install">Install</a>
              <a href="https://github.com/acme/agent-sdk">GitHub</a>
            </body>
          </html>
        `,
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "last-modified": "Thu, 12 Mar 2026 20:20:00 GMT",
          },
        },
      );
    },
  });

  const result = await adapter.fetch({
    startsAt: "2026-03-11T21:00:00.000Z",
    endsAt: "2026-03-12T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.deepEqual(calls, ["https://docs.example.com"]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, "Acme Agent SDK");
  assert.equal(result.items[0].category, "library");
  assert.equal(result.items[0].sourceUrl, "https://docs.example.com/guides/agent-sdk");
  assert.deepEqual(result.items[0].sourceKinds, ["web"]);
  assert.deepEqual(result.items[0].adapterIds, ["web-discovery"]);
  assert.equal(result.items[0].publishedAt, "2026-03-12T20:20:00.000Z");
  assert.deepEqual(result.items[0].metadata.outboundUrls, [
    "https://docs.example.com/docs/install",
    "https://github.com/acme/agent-sdk",
  ]);

  const persisted = await repository.load({
    now: "2026-03-12T21:00:00.000Z",
  });
  const source = persisted.sources.find((entry) => entry.id === "web:domain:docs.example.com");

  assert.equal(source.performance.lastFetchedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(source.performance.lastSuccessfulFetchAt, "2026-03-12T21:00:00.000Z");
  assert.equal(source.performance.successfulFetchCount, 1);
  assert.equal(source.performance.failedFetchCount, 0);
  assert.equal(source.performance.consecutiveFetchFailures, 0);
  assert.equal(source.performance.nextEligibleFetchAt, null);
});

test("web discovery adapter only fetches approved non-seed web sources and skips stale pages", async () => {
  const repository = await createSourceRepository([
    createApprovedDiscoveredSource({
      hostname: "docs.example.com",
      approvedAt: "2026-03-10T20:00:00.000Z",
      lastSeenAt: "2026-03-10T20:00:00.000Z",
    }),
    createApprovedDiscoveredSource({
      hostname: "retired.example.com",
      status: "retired",
    }),
    {
      ...createApprovedDiscoveredSource({
        hostname: "github.com",
        authorityScore: 100,
        seed: true,
      }),
      kind: "github",
      id: "github:domain:github.com",
    },
  ]);
  const calls = [];
  const adapter = new WebDiscoverySourceAdapter({
    sourceRepository: repository,
    fetch: async (url) => {
      calls.push(url);

      return new Response("<html><head><title>Static docs</title></head></html>", {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "last-modified": "Tue, 10 Mar 2026 20:20:00 GMT",
        },
      });
    },
  });

  const result = await adapter.fetch({
    startsAt: "2026-03-11T21:00:00.000Z",
    endsAt: "2026-03-12T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.deepEqual(calls, ["https://docs.example.com"]);
  assert.deepEqual(result.items, []);
});

test("web discovery adapter deprioritizes probationary approved sources when maxSources is constrained", async () => {
  const repository = await createSourceRepository([
    createApprovedDiscoveredSource({
      hostname: "trusted.example.com",
      authorityScore: 74,
    }),
    createApprovedDiscoveredSource({
      hostname: "new-hotness.example.com",
      authorityScore: 92,
      lifecycle: {
        stage: "probation",
        probationStartedAt: "2026-03-12T20:00:00.000Z",
        activatedAt: null,
        qualifyingCycles: [
          {
            cycleId: "2026-03-12",
            observedAt: "2026-03-12T20:00:00.000Z",
            score: 81,
          },
        ],
      },
    }),
  ]);
  const calls = [];
  const adapter = new WebDiscoverySourceAdapter({
    sourceRepository: repository,
    maxSources: 1,
    fetch: async (url) => {
      calls.push(url);

      return new Response(
        `
          <html>
            <head>
              <title>Trusted Agent Docs</title>
              <meta
                name="description"
                content="A library for autonomous agent workflows and MCP integrations."
              />
            </head>
          </html>
        `,
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "last-modified": "Thu, 12 Mar 2026 20:20:00 GMT",
          },
        },
      );
    },
  });

  await adapter.fetch({
    startsAt: "2026-03-11T21:00:00.000Z",
    endsAt: "2026-03-12T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.deepEqual(calls, ["https://trusted.example.com"]);
});

test("web discovery adapter records fetch failures, applies backoff, and retries after the cooldown", async () => {
  const repository = await createSourceRepository([
    createApprovedDiscoveredSource({
      hostname: "flaky.example.com",
      performance: {
        failedFetchCount: 0,
        successfulFetchCount: 0,
      },
    }),
  ]);
  const calls = [];
  let attempt = 0;
  const adapter = new WebDiscoverySourceAdapter({
    sourceRepository: repository,
    fetch: async (url) => {
      calls.push(url);
      attempt += 1;

      if (attempt === 1) {
        throw new Error("network timeout");
      }

      return new Response(
        `
          <html>
            <head>
              <title>Flaky Agent SDK</title>
              <meta
                name="description"
                content="Recovered docs for an autonomous agent SDK."
              />
            </head>
          </html>
        `,
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "last-modified": "Thu, 12 Mar 2026 22:15:00 GMT",
          },
        },
      );
    },
  });

  const firstResult = await adapter.fetch({
    startsAt: "2026-03-11T21:00:00.000Z",
    endsAt: "2026-03-12T21:00:00.000Z",
    timezone: "UTC",
  });
  const afterFailure = await repository.load({
    now: "2026-03-12T21:00:00.000Z",
  });
  const failedSource = afterFailure.sources.find(
    (entry) => entry.id === "web:domain:flaky.example.com",
  );

  assert.deepEqual(firstResult.items, []);
  assert.equal(calls.length, 1);
  assert.equal(failedSource.performance.lastFetchedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(failedSource.performance.lastFailedFetchAt, "2026-03-12T21:00:00.000Z");
  assert.equal(failedSource.performance.failedFetchCount, 1);
  assert.equal(failedSource.performance.consecutiveFetchFailures, 1);
  assert.equal(failedSource.performance.nextEligibleFetchAt, "2026-03-12T22:00:00.000Z");

  const skippedResult = await adapter.fetch({
    startsAt: "2026-03-11T21:30:00.000Z",
    endsAt: "2026-03-12T21:30:00.000Z",
    timezone: "UTC",
  });

  assert.deepEqual(skippedResult.items, []);
  assert.equal(calls.length, 1);

  const recoveredResult = await adapter.fetch({
    startsAt: "2026-03-11T22:00:00.000Z",
    endsAt: "2026-03-12T22:00:00.000Z",
    timezone: "UTC",
  });
  const afterRecovery = await repository.load({
    now: "2026-03-12T22:00:00.000Z",
  });
  const recoveredSource = afterRecovery.sources.find(
    (entry) => entry.id === "web:domain:flaky.example.com",
  );

  assert.equal(calls.length, 2);
  assert.equal(recoveredResult.items.length, 1);
  assert.equal(recoveredSource.performance.lastFetchedAt, "2026-03-12T22:00:00.000Z");
  assert.equal(
    recoveredSource.performance.lastSuccessfulFetchAt,
    "2026-03-12T22:00:00.000Z",
  );
  assert.equal(recoveredSource.performance.successfulFetchCount, 1);
  assert.equal(recoveredSource.performance.failedFetchCount, 1);
  assert.equal(recoveredSource.performance.consecutiveFetchFailures, 0);
  assert.equal(recoveredSource.performance.nextEligibleFetchAt, null);
});

test("web discovery adapter retires persistently failing sources and removes them from later fetch runs", async () => {
  const repository = await createSourceRepository([
    createApprovedDiscoveredSource({
      hostname: "failing.example.com",
      performance: {
        lastFetchedAt: "2026-03-12T19:00:00.000Z",
        lastFailedFetchAt: "2026-03-12T19:00:00.000Z",
        successfulFetchCount: 1,
        failedFetchCount: 2,
        consecutiveFetchFailures: 2,
        nextEligibleFetchAt: "2026-03-12T20:00:00.000Z",
      },
    }),
  ]);
  repository.config = {
    ...repository.config,
    retirementConsecutiveFetchFailures: 3,
    minimumActiveCategorySources: 1,
  };
  const calls = [];
  const adapter = new WebDiscoverySourceAdapter({
    sourceRepository: repository,
    fetch: async (url) => {
      calls.push(url);
      throw new Error("upstream timeout");
    },
  });

  const firstResult = await adapter.fetch({
    startsAt: "2026-03-11T21:00:00.000Z",
    endsAt: "2026-03-12T21:00:00.000Z",
    timezone: "UTC",
  });
  const afterRetirement = await repository.load({
    now: "2026-03-12T21:00:00.000Z",
  });
  const retiredSource = afterRetirement.sources.find(
    (entry) => entry.id === "web:domain:failing.example.com",
  );

  assert.deepEqual(firstResult.items, []);
  assert.equal(calls.length, 1);
  assert.equal(retiredSource.status, "retired");
  assert.equal(
    retiredSource.lifecycle.retirementAudit.current.reason,
    SOURCE_RETIREMENT_REASONS.poorPerformance,
  );

  const secondResult = await adapter.fetch({
    startsAt: "2026-03-12T21:00:00.000Z",
    endsAt: "2026-03-13T21:00:00.000Z",
    timezone: "UTC",
  });

  assert.deepEqual(secondResult.items, []);
  assert.equal(calls.length, 1);
});

test("web discovery adapter blocks poor-performance retirement when the source preserves category coverage", async () => {
  const repository = await createSourceRepository([
    createApprovedDiscoveredSource({
      hostname: "fragile-techniques.example.com",
      categoryCoverage: ["technique"],
      performance: {
        lastFetchedAt: "2026-03-12T19:00:00.000Z",
        lastFailedFetchAt: "2026-03-12T19:00:00.000Z",
        successfulFetchCount: 1,
        failedFetchCount: 2,
        consecutiveFetchFailures: 2,
        nextEligibleFetchAt: "2026-03-12T20:00:00.000Z",
      },
    }),
  ]);
  repository.config = {
    ...repository.config,
    retirementConsecutiveFetchFailures: 3,
    minimumActiveCategorySources: 2,
  };
  const calls = [];
  const adapter = new WebDiscoverySourceAdapter({
    sourceRepository: repository,
    fetch: async (url) => {
      calls.push(url);
      throw new Error("upstream timeout");
    },
  });

  const result = await adapter.fetch({
    startsAt: "2026-03-11T21:00:00.000Z",
    endsAt: "2026-03-12T21:00:00.000Z",
    timezone: "UTC",
  });
  const persisted = await repository.load({
    now: "2026-03-12T21:00:00.000Z",
  });
  const source = persisted.sources.find(
    (entry) => entry.id === "web:domain:fragile-techniques.example.com",
  );

  assert.deepEqual(result.items, []);
  assert.equal(calls.length, 1);
  assert.equal(source.status, "approved");
  assert.equal(source.lifecycle.retirementAudit.current, null);
  assert.deepEqual(source.governance.retirementDecisions, [
    {
      decidedAt: "2026-03-12T21:00:00.000Z",
      outcome: "blocked",
      reason: SOURCE_RETIREMENT_REASONS.poorPerformance,
      evidence: {
        threshold: 3,
        consecutiveFetchFailures: 3,
        failedFetchCount: 3,
        successfulFetchCount: 1,
        lastFetchedAt: "2026-03-12T21:00:00.000Z",
        lastFailedFetchAt: "2026-03-12T21:00:00.000Z",
        nextEligibleFetchAt: "2026-03-13T01:00:00.000Z",
      },
      blockedCategories: ["technique"],
      reversedAt: null,
      reverseReason: null,
      reverseEvidence: null,
      restoredState: null,
      restoreSnapshot: null,
    },
  ]);
});
