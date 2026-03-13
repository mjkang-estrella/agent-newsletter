import test from "node:test";
import assert from "node:assert/strict";

import {
  ENTITY_RESOLUTION_MATCH_KINDS,
  buildStableItemId,
  buildItemIdentitySignals,
  createNormalizedItem,
  createNormalizedItemFromSourceRecord,
  itemsShareIdentity,
  resolveEntityIdentityMatch,
} from "../src/index.js";

function buildItem(overrides = {}) {
  return createNormalizedItem({
    name: "Agent SDK launch thread",
    sourceUrl: "https://x.com/builder/status/123?ref=timeline",
    category: "library",
    summary: "Launch notes for the Agent SDK runtime.",
    integrationHint: "Read the launch notes before rollout.",
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 72,
    discoveredAt: "2026-03-11T21:00:00.000Z",
    ...overrides,
  });
}

function buildGitHubItem(overrides = {}) {
  return createNormalizedItem({
    name: "Agent SDK",
    sourceUrl: "https://github.com/acme/agent-sdk",
    category: "library",
    summary: "Official repository for Agent SDK.",
    integrationHint: "npm install agent-sdk",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 94,
    discoveredAt: "2026-03-11T20:30:00.000Z",
    ...overrides,
  });
}

test("buildItemIdentitySignals normalizes reusable identity evidence from source and outbound urls", () => {
  const item = buildItem({
    metadata: {
      outboundUrls: ["https://docs.example.com/agent-sdk?utm_source=x"],
    },
  });

  assert.deepEqual(buildItemIdentitySignals(item), [
    "identity:canonical_url:https://x.com/builder/status/123",
    "identity:canonical_url:https://docs.example.com/agent-sdk",
    "identity:alias:artifact:slug_alias:agent sdk",
    "identity:alias:artifact:name_alias:agent sdk",
  ]);
});

test("itemsShareIdentity matches X and web mentions through normalized identity signals", () => {
  const xThread = buildItem({
    metadata: {
      outboundUrls: ["https://docs.example.com/agent-sdk?utm_source=x"],
    },
  });
  const webGuide = createNormalizedItem({
    name: "Official setup guide",
    sourceUrl: "https://docs.example.com/agent-sdk/get-started?ref=launch",
    category: "library",
    summary: "Step-by-step setup guide for the Agent SDK runtime.",
    integrationHint: "Follow the guide after validating the runtime requirements.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 66,
    discoveredAt: "2026-03-11T21:00:00.000Z",
  });

  assert.equal(itemsShareIdentity(xThread, webGuide), true);
  assert.equal(buildStableItemId(xThread), buildStableItemId(webGuide));
});

test("buildStableItemId ignores reporting urls on first discovery when the entity can be inferred from content", () => {
  const firstReport = createNormalizedItem({
    name: "Official setup guide",
    sourceUrl: "https://blog.example.com/posts/march-roundup",
    category: "library",
    summary: "Setup guide for Agent SDK with rollout notes for operators.",
    integrationHint: "Validate Agent SDK prerequisites before rollout.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 66,
    discoveredAt: "2026-03-11T21:05:00.000Z",
  });
  const secondReport = createNormalizedItem({
    name: "Install notes",
    sourceUrl: "https://updates.example.org/releases/2026-03-11",
    category: "library",
    summary: "Install notes for Agent SDK covering the same runtime release.",
    integrationHint: "Review Agent SDK install steps before rollout.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 64,
    discoveredAt: "2026-03-11T21:10:00.000Z",
  });

  assert.equal(firstReport.itemId, "artifact-agent-sdk");
  assert.equal(secondReport.itemId, firstReport.itemId);
  assert.ok(!firstReport.itemId.includes("blog-example-com"));
  assert.ok(!secondReport.itemId.includes("updates-example-org"));
});

test("itemsShareIdentity keeps similarly named items separate without corroborating signals", () => {
  const xThread = buildItem({
    metadata: {
      outboundUrls: ["https://docs.example.com/agent-sdk?utm_source=x"],
    },
  });
  const unrelatedItem = createNormalizedItem({
    name: "Agent SDK",
    sourceUrl: "https://another.example.com/archive/weekly-roundup",
    category: "library",
    summary: "Weekly roundup that mentions several SDKs without focusing on one project.",
    integrationHint: "Treat this as commentary, not a canonical integration source.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 61,
    discoveredAt: "2026-03-11T21:00:00.000Z",
  });

  assert.equal(itemsShareIdentity(xThread, unrelatedItem), false);
});

test("itemsShareIdentity gives canonical repo identifiers precedence over matching titles", () => {
  const acmeDocs = createNormalizedItem({
    name: "Agent Runtime",
    sourceUrl: "https://docs.example.com/agent-runtime/setup",
    category: "library",
    summary: "Setup guide for the Acme Agent Runtime.",
    integrationHint: "Use the Acme docs after validating the repo.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 70,
    discoveredAt: "2026-03-12T20:00:00.000Z",
    metadata: {
      outboundUrls: ["https://github.com/acme/agent-runtime?utm_source=docs"],
    },
  });
  const otherDocs = createNormalizedItem({
    name: "Agent Runtime",
    sourceUrl: "https://ops.example.com/agent-runtime/review",
    category: "library",
    summary: "Operational review for a different Agent Runtime implementation.",
    integrationHint: "Validate this runtime separately from Acme's release.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 68,
    discoveredAt: "2026-03-12T20:05:00.000Z",
    metadata: {
      outboundUrls: ["https://github.com/otherco/agent-runtime?ref=review"],
    },
  });

  assert.equal(itemsShareIdentity(acmeDocs, otherDocs), false);
  assert.notEqual(acmeDocs.itemId, otherDocs.itemId);
});

test("itemsShareIdentity falls back to corroborated text aliases when canonical identifiers are absent", () => {
  const launchPost = createNormalizedItem({
    name: "Announcing Agent Policy Orchestrator",
    sourceUrl: "https://blog.example.com/agent-policy-orchestrator-launch",
    category: "library",
    summary: "Launch notes for Agent Policy Orchestrator.",
    integrationHint: "Read the launch notes before rolling this into policy flows.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 63,
    discoveredAt: "2026-03-12T20:10:00.000Z",
  });
  const docsGuide = createNormalizedItem({
    name: "Agent Policy Orchestrator",
    sourceUrl: "https://docs.example.org/agent-policy-orchestrator",
    category: "library",
    summary: "Setup guide for Agent Policy Orchestrator.",
    integrationHint: "Use the guide to verify environment prerequisites.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 66,
    discoveredAt: "2026-03-12T20:15:00.000Z",
  });

  assert.equal(itemsShareIdentity(launchPost, docsGuide), true);
  assert.equal(buildStableItemId(launchPost), buildStableItemId(docsGuide));
});

test("itemsShareIdentity falls back to text similarity when no canonical or alias match exists", () => {
  const firstMention = createNormalizedItem({
    name: "Flowstate Memory Engine",
    sourceUrl: "https://signals.example.com/notes/day-1",
    category: "library",
    summary: "Early notes on the Flowstate Memory Engine architecture.",
    integrationHint: "Review the core primitives before integrating memory state.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 61,
    discoveredAt: "2026-03-12T20:20:00.000Z",
  });
  const followUpMention = createNormalizedItem({
    name: "Flowstate Memory Engine for production",
    sourceUrl: "https://analysis.example.org/briefs/production-note",
    category: "library",
    summary: "Production guidance for the Flowstate Memory Engine rollout.",
    integrationHint: "Use this as an operator-side supplement to the original notes.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 64,
    discoveredAt: "2026-03-12T20:25:00.000Z",
  });

  assert.equal(itemsShareIdentity(firstMention, followUpMention), true);
  assert.notEqual(firstMention.itemId, followUpMention.itemId);
});

test("resolveEntityIdentityMatch can disable text-similarity fallback for canonical-first candidate scans", () => {
  const firstMention = createNormalizedItem({
    name: "Flowstate Memory Engine",
    sourceUrl: "https://signals.example.com/notes/day-1",
    category: "library",
    summary: "Early notes on the Flowstate Memory Engine architecture.",
    integrationHint: "Review the core primitives before integrating memory state.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 61,
    discoveredAt: "2026-03-12T20:20:00.000Z",
  });
  const followUpMention = createNormalizedItem({
    name: "Flowstate Memory Engine for production",
    sourceUrl: "https://analysis.example.org/briefs/production-note",
    category: "library",
    summary: "Production guidance for the Flowstate Memory Engine rollout.",
    integrationHint: "Use this as an operator-side supplement to the original notes.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 64,
    discoveredAt: "2026-03-12T20:25:00.000Z",
  });

  assert.equal(
    resolveEntityIdentityMatch(firstMention, followUpMention, {
      allowTextSimilarity: false,
    }),
    null,
  );
});

test("resolveEntityIdentityMatch matches shared official-site urls before falling back to similarity", () => {
  const trackedItem = createNormalizedItem({
    name: "Release homepage",
    sourceUrl: "https://agent-runtime.dev/",
    category: "tool",
    summary: "Canonical homepage for the Agent Runtime release.",
    integrationHint: "Use the homepage to validate the current release channel.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 71,
    discoveredAt: "2026-03-11T20:40:00.000Z",
  });
  const currentItem = createNormalizedItem({
    name: "Weekend operator recap",
    sourceUrl: "https://x.com/acme/status/7001",
    category: "tool",
    summary: "Operator notes summarizing the release weekend.",
    integrationHint: "Treat this as commentary, not the integration source.",
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 74,
    discoveredAt: "2026-03-12T20:45:00.000Z",
    metadata: {
      outboundUrls: ["https://agent-runtime.dev/?utm_source=x"],
    },
  });

  assert.deepEqual(resolveEntityIdentityMatch(currentItem, trackedItem), {
    kind: ENTITY_RESOLUTION_MATCH_KINDS.OFFICIAL_SITE_URL,
    priority: 2,
    value: "https://agent-runtime.dev/",
  });
});

test("itemsShareIdentity matches homepage-linked X mentions to generic docs pages on the same product domain", () => {
  const xThread = createNormalizedItem({
    name: "Launch thread",
    sourceUrl: "https://x.com/acme/status/7100?ref=timeline",
    category: "tool",
    summary: "Operator notes for the latest rollout.",
    integrationHint: "Review the rollout notes before adoption.",
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 76,
    discoveredAt: "2026-03-12T20:45:00.000Z",
    metadata: {
      outboundUrls: ["https://agent-runtime.dev/?utm_source=x"],
    },
  });
  const docsGuide = createNormalizedItem({
    name: "Getting started",
    sourceUrl: "https://agent-runtime.dev/docs/getting-started?ref=nav",
    category: "tool",
    summary: "Setup steps for the latest runtime release.",
    integrationHint: "Follow the guide after validating prerequisites.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 70,
    discoveredAt: "2026-03-12T20:50:00.000Z",
  });

  assert.ok(
    buildItemIdentitySignals(docsGuide).includes(
      "identity:alias:artifact:host_alias:agent runtime",
    ),
  );
  assert.equal(xThread.itemId, "artifact-agent-runtime");
  assert.equal(docsGuide.itemId, xThread.itemId);
  assert.equal(itemsShareIdentity(xThread, docsGuide), true);
});

test("resolveEntityIdentityMatch uses normalized entity names before lower-signal canonical ids", () => {
  const currentItem = createNormalizedItem({
    name: "Agent Runtime launch thread",
    sourceUrl: "https://x.com/acme/status/9001",
    category: "tool",
    summary: "Launch thread for the Agent Runtime operator workflow.",
    integrationHint: "Review the rollout notes before adoption.",
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 78,
    discoveredAt: "2026-03-12T20:45:00.000Z",
    canonicalIdentifiers: {
      entityName: "Agent Runtime",
      repositoryUrl: null,
      doi: null,
      sourceIds: {
        generic: "runtime-stack",
      },
    },
  });
  const trackedItem = createNormalizedItem({
    name: "Agent Runtime guide",
    sourceUrl: "https://docs.example.com/agent-runtime/get-started",
    category: "tool",
    summary: "Operator guide for Agent Runtime.",
    integrationHint: "Follow the guide before provisioning the hosted control plane.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 69,
    discoveredAt: "2026-03-11T20:45:00.000Z",
    canonicalIdentifiers: {
      entityName: "Agent Runtime",
      repositoryUrl: null,
      doi: null,
      sourceIds: {},
    },
  });

  assert.deepEqual(resolveEntityIdentityMatch(currentItem, trackedItem), {
    kind: ENTITY_RESOLUTION_MATCH_KINDS.ENTITY_NAME,
    priority: 3,
    value: "agent runtime",
  });
});

test("createNormalizedItem initializes persistence lifecycle fields on first discovery", () => {
  const item = buildItem();

  assert.equal(item.itemId, "artifact-agent-sdk");
  assert.equal(item.firstSeen, item.discoveredAt);
  assert.equal(item.editionCount, 1);
  assert.deepEqual(item.canonicalIdentifiers, {
    entityName: "Agent SDK",
    repositoryUrl: null,
    doi: null,
    sourceIds: {},
  });
});

test("createNormalizedItem prefers explicit canonical entity names for first-discovery item ids", () => {
  const launchThread = createNormalizedItem({
    name: "Launch thread for the new Agent Runtime control plane",
    sourceUrl: "https://x.com/acme/status/9001?ref=timeline",
    category: "tool",
    summary: "Rollout notes for the hosted Agent Runtime control plane.",
    integrationHint: "Review the rollout notes before enabling the control plane.",
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 78,
    discoveredAt: "2026-03-12T20:45:00.000Z",
    canonicalIdentifiers: {
      entityName: "Agent Runtime",
      repositoryUrl: null,
      doi: null,
      sourceIds: {},
    },
  });
  const operatorBrief = createNormalizedItem({
    name: "Operator briefing: Agent Runtime adoption notes",
    sourceUrl: "https://analysis.example.com/briefs/runtime-adoption-notes",
    category: "tool",
    summary: "Operational guidance for the Agent Runtime rollout.",
    integrationHint: "Use the briefing as an operator-side companion to the rollout thread.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 66,
    discoveredAt: "2026-03-12T20:50:00.000Z",
    canonicalIdentifiers: {
      entityName: "Agent Runtime",
      repositoryUrl: null,
      doi: null,
      sourceIds: {},
    },
  });

  assert.equal(launchThread.itemId, "artifact-agent-runtime");
  assert.equal(operatorBrief.itemId, launchThread.itemId);
  assert.equal(buildStableItemId(launchThread), launchThread.itemId);
  assert.equal(buildStableItemId(operatorBrief), operatorBrief.itemId);
});

test("createNormalizedItemFromSourceRecord derives canonical identifiers for repositories and papers", () => {
  const repositoryItem = createNormalizedItemFromSourceRecord({
    adapterId: "github",
    sourceType: "github",
    externalId: "acme/open-agent-platform",
    title: "open-agent-platform",
    sourceName: "GitHub",
    sourceUrl: "https://github.com/acme/open-agent-platform",
    sourceUrls: ["https://github.com/acme/open-agent-platform"],
    category: "library",
    summary: "Framework for agent orchestration with tracing and memory.",
    integrationHint: "npm install open-agent-platform",
    publishedAt: "2026-03-11T19:30:00.000Z",
    discoveredAt: "2026-03-11T21:00:00.000Z",
    outboundUrls: ["https://github.com/acme/open-agent-platform"],
    tags: ["github", "ai-agents"],
    metrics: { mentions: 1, upvotes: 100, comments: 0, shares: 0 },
    sourceAuthority: { authority: 95 },
    raw: {},
  });
  const paperItem = createNormalizedItemFromSourceRecord({
    adapterId: "arxiv",
    sourceType: "arxiv",
    externalId: "2603.12345",
    title: "Planning with Agent Graphs",
    sourceName: "arXiv",
    sourceUrl: "https://arxiv.org/abs/2603.12345",
    sourceUrls: [
      "https://arxiv.org/abs/2603.12345",
      "https://doi.org/10.48550/arXiv.2603.12345",
    ],
    category: "technique",
    summary: "Paper covering planning strategies for agent graphs.",
    integrationHint: "Review the paper before adapting the planning strategy.",
    publishedAt: "2026-03-11T18:00:00.000Z",
    discoveredAt: "2026-03-11T21:00:00.000Z",
    outboundUrls: ["https://doi.org/10.48550/arXiv.2603.12345"],
    tags: ["arxiv", "planning"],
    metrics: { mentions: 1, upvotes: 0, comments: 0, shares: 0 },
    sourceAuthority: { authority: 88 },
    metadata: {
      canonicalId: "2603.12345",
      doi: "10.48550/arXiv.2603.12345",
      arxiv: {
        canonicalId: "2603.12345",
        doi: "10.48550/arXiv.2603.12345",
      },
    },
    raw: {},
  });

  assert.deepEqual(repositoryItem.canonicalIdentifiers, {
    entityName: "Open Agent Platform",
    repositoryUrl: "https://github.com/acme/open-agent-platform",
    doi: null,
    sourceIds: {
      github: "acme/open-agent-platform",
    },
  });
  assert.deepEqual(paperItem.canonicalIdentifiers, {
    entityName: "Planning with Agent Graphs",
    repositoryUrl: null,
    doi: "10.48550/arxiv.2603.12345",
    sourceIds: {
      arxiv: "2603.12345",
    },
  });
});

test("createNormalizedItem extracts canonical repo identifiers from source content before similarity fallback", () => {
  const releaseRecap = createNormalizedItem({
    name: "Weekend operator recap",
    sourceUrl: "https://signals.example.com/briefs/weekend-recap",
    category: "library",
    summary:
      "GitHub repo: https://github.com/Acme/Agent-Control-Plane?utm_source=recap",
    integrationHint: "Validate the repository before production rollout.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 64,
    discoveredAt: "2026-03-12T20:40:00.000Z",
  });
  const repositoryItem = createNormalizedItem({
    name: "Agent Control Plane",
    sourceUrl: "https://github.com/acme/agent-control-plane",
    category: "library",
    summary: "Canonical repository for Agent Control Plane.",
    integrationHint: "Install from the repository root.",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 95,
    discoveredAt: "2026-03-12T20:41:00.000Z",
  });

  assert.deepEqual(releaseRecap.canonicalIdentifiers, {
    entityName: "Agent Control Plane",
    repositoryUrl: "https://github.com/acme/agent-control-plane",
    doi: null,
    sourceIds: {
      github: "acme/agent-control-plane",
    },
  });
  assert.ok(
    buildItemIdentitySignals(releaseRecap).includes(
      "identity:repo_root:https://github.com/acme/agent-control-plane",
    ),
  );
  assert.equal(itemsShareIdentity(releaseRecap, repositoryItem), true);
  assert.equal(releaseRecap.itemId, repositoryItem.itemId);
});

test("createNormalizedItemFromSourceRecord extracts arxiv and doi identifiers from source content", () => {
  const readingNote = createNormalizedItemFromSourceRecord({
    adapterId: "web-discovery",
    sourceType: "web",
    externalId: "analysis-note-1",
    title: "Field notes for planning loops",
    sourceName: "analysis.example.com",
    sourceUrl: "https://analysis.example.com/field-notes/planning-loops",
    category: "technique",
    summary:
      "Review arXiv:2603.12345v2 alongside DOI 10.48550/arXiv.2603.12345 before rollout.",
    integrationHint: "Read the paper before adapting the planner.",
    publishedAt: "2026-03-12T18:00:00.000Z",
    discoveredAt: "2026-03-12T20:45:00.000Z",
    outboundUrls: [],
    tags: ["planning"],
    metrics: { mentions: 1, upvotes: 0, comments: 0, shares: 0 },
    sourceAuthority: { authority: 68 },
    raw: {},
  });
  const paperItem = createNormalizedItemFromSourceRecord({
    adapterId: "arxiv",
    sourceType: "arxiv",
    externalId: "2603.12345",
    title: "Planning with Agent Graphs",
    sourceName: "arXiv",
    sourceUrl: "https://arxiv.org/abs/2603.12345",
    sourceUrls: [
      "https://arxiv.org/abs/2603.12345",
      "https://doi.org/10.48550/arXiv.2603.12345",
    ],
    category: "technique",
    summary: "Paper covering planning strategies for agent graphs.",
    integrationHint: "Review the paper before adapting the planning strategy.",
    publishedAt: "2026-03-12T17:00:00.000Z",
    discoveredAt: "2026-03-12T20:46:00.000Z",
    outboundUrls: ["https://doi.org/10.48550/arXiv.2603.12345"],
    tags: ["arxiv", "planning"],
    metrics: { mentions: 1, upvotes: 0, comments: 0, shares: 0 },
    sourceAuthority: { authority: 88 },
    metadata: {
      canonicalId: "2603.12345",
      doi: "10.48550/arXiv.2603.12345",
      arxiv: {
        canonicalId: "2603.12345",
        doi: "10.48550/arXiv.2603.12345",
      },
    },
    raw: {},
  });

  assert.equal(readingNote.canonicalIdentifiers.sourceIds.arxiv, "2603.12345");
  assert.equal(readingNote.canonicalIdentifiers.doi, "10.48550/arxiv.2603.12345");
  assert.ok(
    buildItemIdentitySignals(readingNote).includes("identity:canonical_id:arxiv:2603.12345"),
  );
  assert.equal(itemsShareIdentity(readingNote, paperItem), true);
  assert.equal(readingNote.itemId, paperItem.itemId);
});

test("createNormalizedItem keeps a stable itemId across refetches when labels and tracked urls change", () => {
  const firstFetch = buildGitHubItem({
    sourceUrl: "https://github.com/Acme/Agent-SDK?utm_source=trending",
    summary: "Official repository for Agent SDK with initial release notes.",
    integrationHint: "npm install agent-sdk",
  });
  const refreshedFetch = buildGitHubItem({
    name: "Announcing Agent SDK 2.0",
    sourceUrl: "https://github.com/acme/agent-sdk/tree/main?ref=daily-digest",
    summary: "Updated release notes covering the 2.0 rollout and migration steps.",
    integrationHint: "Review the migration notes before upgrading existing agents.",
    discoveredAt: "2026-03-12T20:30:00.000Z",
  });

  assert.notEqual(firstFetch.id, refreshedFetch.id);
  assert.equal(itemsShareIdentity(firstFetch, refreshedFetch), true);
  assert.equal(firstFetch.itemId, "artifact-github-com-acme-agent-sdk");
  assert.equal(refreshedFetch.itemId, firstFetch.itemId);
  assert.equal(buildStableItemId(refreshedFetch), firstFetch.itemId);
});

test("buildStableItemId stays aligned when the same item moves across repo, docs, and X sources", () => {
  const repositoryItem = buildGitHubItem();
  const docsItem = createNormalizedItem({
    name: "Agent SDK setup guide",
    sourceUrl: "https://docs.example.com/agent-sdk/get-started?utm_source=nav",
    category: "library",
    summary: "Setup guide for installing and configuring Agent SDK.",
    integrationHint: "Follow the setup guide after reviewing the repo.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 68,
    discoveredAt: "2026-03-12T20:00:00.000Z",
    metadata: {
      outboundUrls: ["https://github.com/acme/agent-sdk?ref=docs"],
    },
  });
  const xThread = buildItem({
    sourceUrl: "https://x.com/builder/status/456?ref=feed",
    metadata: {
      outboundUrls: ["https://github.com/acme/agent-sdk?utm_source=x"],
    },
  });

  assert.equal(itemsShareIdentity(repositoryItem, docsItem), true);
  assert.equal(itemsShareIdentity(docsItem, xThread), true);
  assert.equal(repositoryItem.itemId, "artifact-github-com-acme-agent-sdk");
  assert.equal(docsItem.itemId, repositoryItem.itemId);
  assert.equal(xThread.itemId, repositoryItem.itemId);
});

test("createNormalizedItem uses explicit canonical identifiers when assigning cross-source item ids", () => {
  const canonicalIdentifiers = {
    entityName: "Nova Planner",
    repositoryUrl: null,
    doi: null,
    sourceIds: {
      generic: "nova-planner",
    },
  };
  const xThread = createNormalizedItem({
    name: "Nova Planner launch thread",
    sourceUrl: "https://x.com/acme/status/1001?ref=timeline",
    category: "library",
    summary: "Launch thread for Nova Planner.",
    integrationHint: "Review the rollout notes before integrating Nova Planner.",
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 74,
    canonicalIdentifiers,
  });
  const webGuide = createNormalizedItem({
    name: "Nova Planner setup guide",
    sourceUrl: "https://docs.example.com/nova-planner/get-started?utm_source=nav",
    category: "library",
    summary: "Setup guide for Nova Planner.",
    integrationHint: "Follow the setup guide after validating prerequisites.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 68,
    canonicalIdentifiers,
  });

  assert.equal(itemsShareIdentity(xThread, webGuide), true);
  assert.equal(xThread.itemId, "artifact-generic-nova-planner");
  assert.equal(webGuide.itemId, xThread.itemId);
  assert.equal(buildStableItemId(xThread), xThread.itemId);
  assert.equal(buildStableItemId(webGuide), webGuide.itemId);
});
