import test from "node:test";
import assert from "node:assert/strict";

import {
  ItemResolutionService,
  createNormalizedItem,
} from "../src/index.js";

function buildItem(overrides = {}) {
  return createNormalizedItem({
    name: "Agent Runtime",
    sourceUrl: "https://example.com/agent-runtime",
    category: "library",
    summary: "Composable runtime for agent execution.",
    integrationHint: "Validate the runtime contract before rollout.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 68,
    discoveredAt: "2026-03-12T20:30:00.000Z",
    ...overrides,
  });
}

test("ItemResolutionService keeps the generated itemId on first discovery when no history matches", () => {
  const service = new ItemResolutionService();
  const item = buildItem({
    id: "agent-runtime-docs",
  });

  const resolution = service.resolve(item, []);

  assert.equal(resolution.matchedCandidate, null);
  assert.equal(resolution.id, item.id);
  assert.equal(resolution.itemId, item.itemId);
  assert.equal(resolution.firstSeen, item.firstSeen);
  assert.equal(resolution.editionCount, 1);
  assert.deepEqual(resolution.canonicalIdentifiers, item.canonicalIdentifiers);
});

test("ItemResolutionService prefers canonical matches before broader text fallback matches", () => {
  const service = new ItemResolutionService();
  const currentItem = buildItem({
    id: "agent-runtime-thread",
    name: "Agent Runtime rollout thread",
    sourceUrl: "https://x.com/acme/status/1001?ref=feed",
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 74,
    metadata: {
      outboundUrls: ["https://github.com/acme/agent-runtime?utm_source=x"],
    },
  });
  const fallbackCandidate = {
    id: "tracked-fallback-source",
    itemId: "tracked-fallback-item",
    firstSeen: "2026-03-09T20:30:00.000Z",
    editionCount: 8,
    item: buildItem({
      id: "tracked-fallback-source",
      itemId: "tracked-fallback-item",
      name: "Agent Runtime rollout notes",
      sourceUrl: "https://notes.example.com/agent-runtime-rollout",
      discoveredAt: "2026-03-09T20:30:00.000Z",
    }),
  };
  const canonicalCandidate = {
    id: "tracked-canonical-source",
    itemId: "tracked-canonical-item",
    firstSeen: "2026-03-11T20:30:00.000Z",
    editionCount: 2,
    item: buildItem({
      id: "tracked-canonical-source",
      itemId: "tracked-canonical-item",
      name: "Agent Runtime",
      sourceUrl: "https://github.com/acme/agent-runtime",
      sourceKinds: ["github"],
      adapterIds: ["github"],
      sourceAuthorityScore: 92,
      discoveredAt: "2026-03-11T20:30:00.000Z",
    }),
  };

  const resolution = service.resolve(currentItem, [
    fallbackCandidate,
    canonicalCandidate,
  ]);

  assert.equal(resolution.matchedCandidate, canonicalCandidate);
  assert.equal(resolution.id, currentItem.id);
  assert.equal(resolution.itemId, "tracked-canonical-item");
  assert.equal(resolution.firstSeen, "2026-03-11T20:30:00.000Z");
  assert.equal(resolution.editionCount, 3);
  assert.deepEqual(resolution.canonicalIdentifiers, {
    entityName: "Agent Runtime",
    repositoryUrl: "https://github.com/acme/agent-runtime",
    doi: null,
    sourceIds: {
      github: "acme/agent-runtime",
    },
  });
});

test("ItemResolutionService falls back to text similarity when no canonical match exists", () => {
  const service = new ItemResolutionService();
  const trackedCandidate = {
    id: "flowstate-notes",
    itemId: "persistent-flowstate-memory-engine",
    firstSeen: "2026-03-10T20:20:00.000Z",
    editionCount: 2,
    item: buildItem({
      id: "flowstate-notes",
      itemId: "persistent-flowstate-memory-engine",
      name: "Flowstate Memory Engine",
      sourceUrl: "https://signals.example.com/notes/day-1",
      discoveredAt: "2026-03-10T20:20:00.000Z",
    }),
  };
  const currentItem = buildItem({
    id: "flowstate-follow-up",
    name: "Flowstate Memory Engine for production",
    sourceUrl: "https://analysis.example.org/briefs/production-note",
    discoveredAt: "2026-03-12T20:25:00.000Z",
  });

  const resolution = service.resolve(currentItem, [trackedCandidate]);

  assert.equal(resolution.matchedCandidate, trackedCandidate);
  assert.equal(resolution.itemId, "persistent-flowstate-memory-engine");
  assert.equal(resolution.editionCount, 3);
  assert.equal(resolution.firstSeen, "2026-03-10T20:20:00.000Z");
});

test("ItemResolutionService prefers shared official-site urls before text similarity fallback matches", () => {
  const service = new ItemResolutionService();
  const officialSiteCandidate = {
    id: "tracked-official-site-source",
    itemId: "tracked-official-site-item",
    firstSeen: "2026-03-11T20:20:00.000Z",
    editionCount: 2,
    item: buildItem({
      id: "tracked-official-site-source",
      itemId: "tracked-official-site-item",
      name: "Release homepage",
      sourceUrl: "https://agent-runtime.dev/",
      category: "tool",
      summary: "Canonical homepage for the Agent Runtime release.",
      integrationHint: "Use the homepage to validate the current release channel.",
      discoveredAt: "2026-03-11T20:20:00.000Z",
    }),
  };
  const similarityCandidate = {
    id: "tracked-similarity-source",
    itemId: "tracked-similarity-item",
    firstSeen: "2026-03-08T20:20:00.000Z",
    editionCount: 9,
    item: buildItem({
      id: "tracked-similarity-source",
      itemId: "tracked-similarity-item",
      name: "Nightly operations recap",
      sourceUrl: "https://signals.example.com/nightly-ops-recap",
      discoveredAt: "2026-03-08T20:20:00.000Z",
    }),
  };
  const currentItem = buildItem({
    id: "weekend-operator-recap",
    name: "Nightly operations recap for production",
    sourceUrl: "https://x.com/acme/status/7001",
    category: "tool",
    summary: "Operator notes summarizing the release weekend.",
    integrationHint: "Treat this as commentary, not the integration source.",
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 74,
    discoveredAt: "2026-03-12T20:25:00.000Z",
    metadata: {
      outboundUrls: ["https://agent-runtime.dev/?utm_source=x"],
    },
  });

  const resolution = service.resolve(currentItem, [
    similarityCandidate,
    officialSiteCandidate,
  ]);

  assert.equal(resolution.matchedCandidate, officialSiteCandidate);
  assert.equal(resolution.itemId, "tracked-official-site-item");
  assert.equal(resolution.editionCount, 3);
  assert.equal(resolution.firstSeen, "2026-03-11T20:20:00.000Z");
});

test("ItemResolutionService only uses text similarity after canonical matching finds no candidate", () => {
  const service = new ItemResolutionService();
  const canonicalButUnmatchedCandidate = {
    id: "runtime-registry-source",
    itemId: "tracked-runtime-registry-item",
    firstSeen: "2026-03-08T20:20:00.000Z",
    editionCount: 5,
    item: buildItem({
      id: "runtime-registry-source",
      itemId: "tracked-runtime-registry-item",
      name: "Runtime Registry",
      sourceUrl: "https://registry.example.com/runtime-registry",
      discoveredAt: "2026-03-08T20:20:00.000Z",
      canonicalIdentifiers: {
        entityName: "Runtime Registry",
        repositoryUrl: null,
        doi: null,
        sourceIds: {
          generic: "runtime-registry",
        },
      },
    }),
  };
  const similarityCandidate = {
    id: "flowstate-notes",
    itemId: "persistent-flowstate-memory-engine",
    firstSeen: "2026-03-10T20:20:00.000Z",
    editionCount: 2,
    item: buildItem({
      id: "flowstate-notes",
      itemId: "persistent-flowstate-memory-engine",
      name: "Flowstate Memory Engine",
      sourceUrl: "https://signals.example.com/notes/day-1",
      discoveredAt: "2026-03-10T20:20:00.000Z",
    }),
  };
  const currentItem = buildItem({
    id: "flowstate-follow-up",
    name: "Flowstate Memory Engine for production",
    sourceUrl: "https://analysis.example.org/briefs/production-note",
    discoveredAt: "2026-03-12T20:25:00.000Z",
  });

  const resolution = service.resolve(currentItem, [
    canonicalButUnmatchedCandidate,
    similarityCandidate,
  ]);

  assert.equal(resolution.matchedCandidate, similarityCandidate);
  assert.equal(resolution.itemId, "persistent-flowstate-memory-engine");
  assert.equal(resolution.editionCount, 3);
});

test("ItemResolutionService prefers repository matches over entity-name and canonical-id matches", () => {
  const service = new ItemResolutionService();
  const currentItem = buildItem({
    id: "agent-runtime-cloud",
    name: "Agent Runtime Cloud",
    sourceUrl: "https://acme.example.com/agent-runtime-cloud",
    category: "tool",
    summary: "Hosted control plane for Agent Runtime deployments.",
    integrationHint: "Review the hosted deployment flow before rollout.",
    sourceAuthorityScore: 78,
    metadata: {
      outboundUrls: ["https://github.com/acme/agent-runtime?utm_source=cloud"],
    },
    canonicalIdentifiers: {
      entityName: "Agent Runtime",
      repositoryUrl: "https://github.com/acme/agent-runtime",
      doi: null,
      sourceIds: {
        github: "acme/agent-runtime",
        generic: "runtime-stack",
      },
    },
  });
  const entityCandidate = {
    id: "tracked-entity-source",
    itemId: "tracked-entity-item",
    firstSeen: "2026-03-09T20:30:00.000Z",
    editionCount: 9,
    item: buildItem({
      id: "tracked-entity-source",
      itemId: "tracked-entity-item",
      name: "Agent Runtime guide",
      sourceUrl: "https://docs.example.com/agent-runtime/get-started",
      category: "tool",
      discoveredAt: "2026-03-09T20:30:00.000Z",
      canonicalIdentifiers: {
        entityName: "Agent Runtime",
        repositoryUrl: null,
        doi: null,
        sourceIds: {},
      },
    }),
  };
  const canonicalIdCandidate = {
    id: "tracked-canonical-id-source",
    itemId: "tracked-canonical-id-item",
    firstSeen: "2026-03-08T20:30:00.000Z",
    editionCount: 12,
    item: buildItem({
      id: "tracked-canonical-id-source",
      itemId: "tracked-canonical-id-item",
      name: "Runtime Stack",
      sourceUrl: "https://registry.example.com/runtime-stack",
      category: "tool",
      discoveredAt: "2026-03-08T20:30:00.000Z",
      canonicalIdentifiers: {
        entityName: "Runtime Stack",
        repositoryUrl: null,
        doi: null,
        sourceIds: {
          generic: "runtime-stack",
        },
      },
    }),
  };
  const repositoryCandidate = {
    id: "tracked-repository-source",
    itemId: "tracked-repository-item",
    firstSeen: "2026-03-11T20:30:00.000Z",
    editionCount: 2,
    item: buildItem({
      id: "tracked-repository-source",
      itemId: "tracked-repository-item",
      name: "Agent Runtime",
      sourceUrl: "https://github.com/acme/agent-runtime",
      category: "tool",
      sourceKinds: ["github"],
      adapterIds: ["github"],
      sourceAuthorityScore: 92,
      discoveredAt: "2026-03-11T20:30:00.000Z",
    }),
  };

  const resolution = service.resolve(currentItem, [
    canonicalIdCandidate,
    entityCandidate,
    repositoryCandidate,
  ]);

  assert.equal(resolution.matchedCandidate, repositoryCandidate);
  assert.equal(resolution.itemId, "tracked-repository-item");
  assert.equal(resolution.editionCount, 3);
});

test("ItemResolutionService prefers entity-name matches before lower-priority canonical ids", () => {
  const service = new ItemResolutionService();
  const currentItem = buildItem({
    id: "agent-runtime-cloud",
    name: "Agent Runtime launch thread",
    sourceUrl: "https://x.com/acme/status/9001",
    category: "tool",
    summary: "Launch thread for the Agent Runtime operator workflow.",
    integrationHint: "Review the rollout notes before adoption.",
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 78,
    canonicalIdentifiers: {
      entityName: "Agent Runtime",
      repositoryUrl: null,
      doi: null,
      sourceIds: {
        generic: "runtime-stack",
      },
    },
  });
  const entityCandidate = {
    id: "tracked-entity-source",
    itemId: "tracked-entity-item",
    firstSeen: "2026-03-11T20:30:00.000Z",
    editionCount: 2,
    item: buildItem({
      id: "tracked-entity-source",
      itemId: "tracked-entity-item",
      name: "Agent Runtime guide",
      sourceUrl: "https://docs.example.com/agent-runtime/get-started",
      category: "tool",
      discoveredAt: "2026-03-11T20:30:00.000Z",
      canonicalIdentifiers: {
        entityName: "Agent Runtime",
        repositoryUrl: null,
        doi: null,
        sourceIds: {},
      },
    }),
  };
  const canonicalIdCandidate = {
    id: "tracked-canonical-id-source",
    itemId: "tracked-canonical-id-item",
    firstSeen: "2026-03-08T20:30:00.000Z",
    editionCount: 10,
    item: buildItem({
      id: "tracked-canonical-id-source",
      itemId: "tracked-canonical-id-item",
      name: "Runtime Stack",
      sourceUrl: "https://registry.example.com/runtime-stack",
      category: "tool",
      discoveredAt: "2026-03-08T20:30:00.000Z",
      canonicalIdentifiers: {
        entityName: "Runtime Stack",
        repositoryUrl: null,
        doi: null,
        sourceIds: {
          generic: "runtime-stack",
        },
      },
    }),
  };

  const resolution = service.resolve(currentItem, [
    canonicalIdCandidate,
    entityCandidate,
  ]);

  assert.equal(resolution.matchedCandidate, entityCandidate);
  assert.equal(resolution.itemId, "tracked-entity-item");
  assert.equal(resolution.editionCount, 3);
});
