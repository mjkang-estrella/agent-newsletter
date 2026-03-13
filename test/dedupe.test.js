import test from "node:test";
import assert from "node:assert/strict";

import {
  consolidateMatchedItems,
  createDefaultDeduplicationHooks,
  createNormalizedItem,
  deduplicateItems,
  groupDuplicateItems,
  serializeNewsletterItem,
} from "../src/index.js";

function buildItem(overrides = {}) {
  return createNormalizedItem({
    name: "AgentOps",
    sourceUrl: "https://github.com/acme/agentops",
    category: "tool",
    summary: "Observability and evaluation tooling for agent systems.",
    integrationHint: "npm install @acme/agentops",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 90,
    discoveredAt: "2026-03-11T21:00:00.000Z",
    ...overrides,
  });
}

test("deduplicateItems collapses exact duplicates into a single item", () => {
  const items = [
    buildItem(),
    buildItem({
      summary: "Observability and evaluation tooling for production agent systems.",
      integrationHint: "pnpm add @acme/agentops",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
    }),
  ];

  const deduplicated = deduplicateItems(items);
  const [merged] = deduplicated;

  assert.equal(deduplicated.length, 1);
  assert.equal(merged.mentionCount, 2);
  assert.deepEqual(merged.sourceUrls, ["https://github.com/acme/agentops"]);
  assert.deepEqual(merged.sourceKinds.sort(), ["github", "web"]);
  assert.deepEqual(merged.adapterIds.sort(), ["github", "web-discovery"]);
});

test("deduplicateItems preserves stable item identity lifecycle fields", () => {
  const [merged] = deduplicateItems([
    buildItem({
      discoveredAt: "2026-03-11T21:00:00.000Z",
      firstSeen: "2026-03-10T21:00:00.000Z",
      editionCount: 3,
    }),
    buildItem({
      name: "AgentOps docs",
      sourceUrl: "https://docs.example.com/agentops/get-started",
      summary: "Official setup guide for AgentOps.",
      integrationHint: "Follow the setup guide after provisioning API keys.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 70,
      discoveredAt: "2026-03-12T02:00:00.000Z",
      firstSeen: "2026-03-11T18:00:00.000Z",
      editionCount: 1,
      metadata: {
        outboundUrls: ["https://github.com/acme/agentops"],
      },
    }),
  ]);

  assert.equal(merged.itemId, "artifact-github-com-acme-agentops");
  assert.equal(merged.firstSeen, "2026-03-10T21:00:00.000Z");
  assert.equal(merged.editionCount, 3);
});

test("deduplicateItems preserves the highest risk per typed dimension for shared serialization", () => {
  const [merged] = deduplicateItems([
    buildItem({
      itemId: "artifact-acme-risk-aware-runtime",
      name: "Risk Aware Runtime",
      category: "library",
      sourceUrl: "https://github.com/acme/risk-aware-runtime",
      sourceUrls: ["https://github.com/acme/risk-aware-runtime"],
      relevanceScore: 81,
      scoreVersion: "2.2.0",
      riskWarning: {
        security: {
          severity: "high",
          description: "Restrict filesystem and credential access before rollout.",
        },
        maturity: {
          severity: "low",
          description: "Stable enough for controlled pilots.",
        },
        adoption_complexity: {
          severity: "medium",
          description: "Tool policy mapping takes some setup work.",
        },
      },
    }),
    buildItem({
      id: "docs-guide",
      itemId: "artifact-acme-risk-aware-runtime",
      name: "Risk Aware Runtime ops guide",
      sourceUrl: "https://docs.example.com/risk-aware-runtime",
      sourceUrls: ["https://docs.example.com/risk-aware-runtime"],
      category: "library",
      summary: "Deployment guide for the same runtime entity.",
      integrationHint: "Use the guide to validate rollout prerequisites.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 72,
      relevanceScore: 74,
      scoreVersion: "2.2.0",
      metadata: {
        outboundUrls: ["https://github.com/acme/risk-aware-runtime"],
      },
      riskWarning: {
        security: {
          severity: "medium",
          description: "Security posture is improving but still needs validation.",
        },
        maturity: {
          severity: "high",
          description: "Breaking changes still land without enough migration guidance.",
        },
        adoption_complexity: {
          severity: "low",
          description: "The documented install path is straightforward.",
        },
      },
    }),
  ]);

  assert.equal(merged.riskWarning.severity, "high");
  assert.deepEqual(serializeNewsletterItem(merged).risk_warning, {
    security: {
      severity: "high",
      description: "Restrict filesystem and credential access before rollout.",
    },
    maturity: {
      severity: "high",
      description: "Breaking changes still land without enough migration guidance.",
    },
    adoption_complexity: {
      severity: "medium",
      description: "Tool policy mapping takes some setup work.",
    },
  });
});

test("deduplicateItems derives an agree sentiment spread when contributing sources share the same sentiment", () => {
  const [merged] = deduplicateItems([
    buildItem({
      id: "official-repo",
      name: "agent-memory",
      sourceUrl: "https://github.com/acme/agent-memory",
      category: "library",
      summary: "Official repository for Agent Memory.",
      integrationHint: "npm install agent-memory",
      sourceSentiment: "positive",
    }),
    buildItem({
      id: "launch-notes",
      name: "Agent Memory launch notes",
      sourceUrl: "https://blog.example.com/agent-memory-launch",
      category: "library",
      summary: "Launch notes recommending Agent Memory for production agent state.",
      integrationHint: "Review the launch notes before rollout.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 66,
      sourceSentiment: "positive",
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-memory"],
      },
    }),
  ]);

  assert.deepEqual(merged.sentimentSpread, {
    classification: "agree",
  });
  assert.equal(merged.sourceSentiment, "positive");
  assert.deepEqual(
    merged.metadata.sourceSentiments.sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl)),
    [
      {
        sourceUrl: "https://blog.example.com/agent-memory-launch",
        sentiment: "positive",
      },
      {
        sourceUrl: "https://github.com/acme/agent-memory",
        sentiment: "positive",
      },
    ],
  );
});

test("deduplicateItems derives a disagree sentiment spread for conflicting source sentiment", () => {
  const [merged] = deduplicateItems([
    buildItem({
      id: "official-repo",
      name: "agent-runtime",
      sourceUrl: "https://github.com/acme/agent-runtime",
      category: "library",
      summary: "Official repository for the Agent Runtime library.",
      integrationHint: "npm install agent-runtime",
      sourceSentiment: "positive",
      metadata: {
        sourceSentiments: [
          {
            sourceUrl: "https://github.com/acme/agent-runtime",
            sentiment: "positive",
            disagreementDimension: "security",
          },
        ],
      },
    }),
    buildItem({
      id: "critical-review",
      name: "Agent Runtime stability review",
      sourceUrl: "https://ops.example.com/agent-runtime-review",
      category: "library",
      summary: "Operational review covering breakages, regressions, and rollback issues.",
      integrationHint: "Validate failure modes before rollout.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 68,
      sourceSentiment: "negative",
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-runtime"],
        sourceSentiments: [
          {
            sourceUrl: "https://ops.example.com/agent-runtime-review",
            sentiment: "negative",
            disagreementDimension: "security",
          },
        ],
      },
    }),
  ]);

  assert.deepEqual(merged.sentimentSpread, {
    classification: "disagree",
    disagreementDimension: "security",
  });
  assert.equal(merged.sourceSentiment, "positive");
  assert.deepEqual(merged.metadata.sourceSentiments.sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl)), [
    {
      disagreementDimension: "security",
      sourceUrl: "https://github.com/acme/agent-runtime",
      sentiment: "positive",
    },
    {
      disagreementDimension: "security",
      sourceUrl: "https://ops.example.com/agent-runtime-review",
      sentiment: "negative",
    },
  ]);
});

test("deduplicateItems infers disagreement dimensions from adapter-like source evidence", () => {
  const [merged] = deduplicateItems([
    buildItem({
      id: "official-repo",
      name: "agent-firewall",
      sourceUrl: "https://github.com/acme/agent-firewall",
      category: "library",
      summary: "Official repository for Agent Firewall.",
      integrationHint: "npm install agent-firewall",
      sourceSentiment: "positive",
    }),
    buildItem({
      id: "security-audit",
      name: "Agent Firewall audit",
      sourceUrl: "https://audit.example.com/agent-firewall",
      category: "library",
      summary:
        "Independent audit flags prompt injection exposure, unsafe defaults, and secret handling gaps.",
      integrationHint: "Review auth boundaries before rollout.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 72,
      sourceSentiment: "negative",
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-firewall"],
      },
    }),
  ]);

  assert.deepEqual(merged.sentimentSpread, {
    classification: "disagree",
    disagreementDimension: "security",
  });
  assert.deepEqual(
    merged.metadata.sourceSentiments.sort((left, right) =>
      left.sourceUrl.localeCompare(right.sourceUrl),
    ),
    [
      {
        sourceUrl: "https://audit.example.com/agent-firewall",
        sentiment: "negative",
        disagreementDimension: "security",
      },
      {
        sourceUrl: "https://github.com/acme/agent-firewall",
        sentiment: "positive",
        disagreementDimension: "security",
      },
    ],
  );
});

test("deduplicateItems derives a mixed sentiment spread when sources blend positive and neutral coverage", () => {
  const [merged] = deduplicateItems([
    buildItem({
      id: "official-repo",
      name: "agent-router",
      sourceUrl: "https://github.com/acme/agent-router",
      category: "library",
      summary: "Official repository for Agent Router.",
      integrationHint: "npm install agent-router",
      sourceSentiment: "positive",
      metadata: {
        sourceSentiments: [
          {
            sourceUrl: "https://github.com/acme/agent-router",
            sentiment: "positive",
            disagreementDimension: "utility",
          },
        ],
      },
    }),
    buildItem({
      id: "neutral-guide",
      name: "Agent Router setup guide",
      sourceUrl: "https://docs.example.com/agent-router/setup",
      category: "library",
      summary: "Setup guide that documents prerequisites and caveats without a recommendation.",
      integrationHint: "Use the setup guide to validate environment prerequisites.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 70,
      sourceSentiment: "neutral",
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-router"],
        sourceSentiments: [
          {
            sourceUrl: "https://docs.example.com/agent-router/setup",
            sentiment: "neutral",
            disagreementDimension: "utility",
          },
        ],
      },
    }),
  ]);

  assert.deepEqual(merged.sentimentSpread, {
    classification: "mixed",
    disagreementDimension: "utility",
  });
  assert.deepEqual(merged.metadata.sourceSentiments.sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl)), [
    {
      disagreementDimension: "utility",
      sourceUrl: "https://docs.example.com/agent-router/setup",
      sentiment: "neutral",
    },
    {
      disagreementDimension: "utility",
      sourceUrl: "https://github.com/acme/agent-router",
      sentiment: "positive",
    },
  ]);
});

test("deduplicateItems preserves disagreementDimension when duplicate source evidence omits it", () => {
  const [merged] = deduplicateItems([
    buildItem({
      id: "official-repo",
      name: "agent-guard",
      sourceUrl: "https://github.com/acme/agent-guard",
      category: "library",
      summary: "Official repository for Agent Guard.",
      integrationHint: "npm install agent-guard",
      sourceSentiment: "positive",
      metadata: {
        sourceSentiments: [
          {
            sourceUrl: "https://github.com/acme/agent-guard",
            sentiment: "positive",
            disagreementDimension: "security",
          },
          {
            sourceUrl: "https://github.com/acme/agent-guard",
            sentiment: "positive",
          },
        ],
      },
    }),
    buildItem({
      id: "security-audit",
      name: "Agent Guard security audit",
      sourceUrl: "https://audit.example.com/agent-guard",
      category: "library",
      summary: "Audit identifies unsafe defaults and key isolation gaps.",
      integrationHint: "Review the audit findings before rollout.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 71,
      sourceSentiment: "negative",
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-guard"],
        sourceSentiments: [
          {
            sourceUrl: "https://audit.example.com/agent-guard",
            sentiment: "negative",
          },
        ],
      },
    }),
  ]);

  assert.deepEqual(merged.sentimentSpread, {
    classification: "disagree",
    disagreementDimension: "security",
  });
  assert.deepEqual(
    merged.metadata.sourceSentiments.sort((left, right) =>
      left.sourceUrl.localeCompare(right.sourceUrl),
    ),
    [
      {
        sourceUrl: "https://audit.example.com/agent-guard",
        sentiment: "negative",
        disagreementDimension: "security",
      },
      {
        sourceUrl: "https://github.com/acme/agent-guard",
        sentiment: "positive",
        disagreementDimension: "security",
      },
    ],
  );
});

test("deduplicateItems preserves per-source disagreement evidence and resolves one top-level dimension", () => {
  const [merged] = deduplicateItems([
    buildItem({
      id: "official-repo",
      name: "agent-market-watch",
      sourceUrl: "https://github.com/acme/agent-market-watch",
      category: "library",
      summary: "Official repository for Agent Market Watch.",
      integrationHint: "npm install agent-market-watch",
      sourceSentiment: "positive",
      metadata: {
        sourceSentiments: [
          {
            sourceUrl: "https://github.com/acme/agent-market-watch",
            sentiment: "positive",
            disagreementDimension: "security",
          },
        ],
      },
    }),
    buildItem({
      id: "market-brief",
      name: "Agent Market Watch adoption brief",
      sourceUrl: "https://briefing.example.com/agent-market-watch",
      category: "library",
      summary: "Brief argues the release is commercially early despite strong engineering.",
      integrationHint: "Validate commercial fit before rollout.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 67,
      sourceSentiment: "negative",
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-market-watch"],
        sourceSentiments: [
          {
            sourceUrl: "https://briefing.example.com/agent-market-watch",
            sentiment: "negative",
            disagreementDimension: "market",
          },
        ],
      },
    }),
    buildItem({
      id: "analyst-note",
      name: "Agent Market Watch analyst note",
      sourceUrl: "https://analyst.example.com/agent-market-watch",
      category: "library",
      summary: "Analyst note is neutral on adoption timing and ecosystem demand.",
      integrationHint: "Review the ecosystem demand assumptions before rollout.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 65,
      sourceSentiment: "neutral",
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-market-watch"],
        sourceSentiments: [
          {
            sourceUrl: "https://analyst.example.com/agent-market-watch",
            sentiment: "neutral",
            disagreementDimension: "market",
          },
        ],
      },
    }),
  ]);

  assert.deepEqual(merged.sentimentSpread, {
    classification: "mixed",
    disagreementDimension: "market",
  });
  assert.deepEqual(
    merged.metadata.sourceSentiments.sort((left, right) =>
      left.sourceUrl.localeCompare(right.sourceUrl),
    ),
    [
      {
        sourceUrl: "https://analyst.example.com/agent-market-watch",
        sentiment: "neutral",
        disagreementDimension: "market",
      },
      {
        sourceUrl: "https://briefing.example.com/agent-market-watch",
        sentiment: "negative",
        disagreementDimension: "market",
      },
      {
        sourceUrl: "https://github.com/acme/agent-market-watch",
        sentiment: "positive",
        disagreementDimension: "security",
      },
    ],
  );
});

test("dedupe hooks match near-duplicates through normalized titles and related links", () => {
  const hooks = createDefaultDeduplicationHooks();
  const officialRepo = buildItem({
    category: "library",
    sourceUrl: "https://github.com/acme/open-agent-platform",
    name: "open-agent-platform",
    summary: "Agent runtime framework with tracing and memory primitives.",
    integrationHint: "npm install open-agent-platform",
  });
  const releasePost = buildItem({
    category: "library",
    sourceUrl: "https://news.example.com/posts/open-agent-platform-release",
    sourceUrls: ["https://news.example.com/posts/open-agent-platform-release"],
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 62,
    name: "Announcing Open Agent Platform release",
    summary: "Launch post covering the repo and setup details.",
    integrationHint: "Read the launch notes before wiring this into production.",
    metadata: {
      outboundUrls: ["https://github.com/Acme/Open-Agent-Platform?utm_source=launch-post"],
    },
  });

  assert.equal(hooks.isDuplicate(officialRepo, releasePost), true);

  const [merged] = deduplicateItems([officialRepo, releasePost], hooks);

  assert.equal(merged.mentionCount, 2);
  assert.deepEqual(merged.sourceUrls.sort(), [
    "https://github.com/acme/open-agent-platform",
    "https://news.example.com/posts/open-agent-platform-release",
  ]);
});

test("dedupe hooks avoid collapsing items that only share a generic title alias", () => {
  const hooks = createDefaultDeduplicationHooks();
  const runtimeDocs = buildItem({
    id: "runtime-docs",
    name: "Agent Runtime",
    sourceUrl: "https://docs.example.com/runtime-intro",
    category: "library",
    summary: "Introductory documentation for one runtime offering.",
    integrationHint: "Review the docs before adopting the runtime.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 70,
  });
  const runtimeOps = buildItem({
    id: "runtime-ops",
    name: "Agent Runtime",
    sourceUrl: "https://ops.example.com/runtime-observability",
    category: "library",
    summary: "Operational notes for a different runtime deployment surface.",
    integrationHint: "Validate this deployment path independently.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 66,
  });

  assert.equal(hooks.isDuplicate(runtimeDocs, runtimeOps), false);
  assert.equal(deduplicateItems([runtimeDocs, runtimeOps], hooks).length, 2);
});

test("groupDuplicateItems merges transitive duplicate chains into a single cluster", () => {
  const hooks = createDefaultDeduplicationHooks();
  const officialRepo = buildItem({
    id: "official-repo",
    name: "agent-grid",
    sourceUrl: "https://github.com/acme/agent-grid",
    category: "library",
    summary: "Official repository for Agent Grid.",
    integrationHint: "npm install agent-grid",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 94,
  });
  const docsGuide = buildItem({
    id: "docs-guide",
    name: "Agent Grid setup guide",
    sourceUrl: "https://docs.example.com/get-started?id=agent-grid&utm_source=docs",
    category: "library",
    summary: "Setup guide covering install and rollout sequencing.",
    integrationHint: "Use the docs to validate the install flow.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 67,
    metadata: {
      outboundUrls: ["https://github.com/acme/agent-grid?ref=docs"],
    },
  });
  const rolloutRecap = buildItem({
    id: "rollout-recap",
    name: "Operator rollout recap",
    sourceUrl: "https://signals.example.com/daily/2026-03-12",
    category: "library",
    summary: "Daily recap linking operators to the new setup guide.",
    integrationHint: "Read the linked guide before rollout.",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 61,
    metadata: {
      outboundUrls: ["https://docs.example.com/get-started?id=agent-grid&utm_source=recap"],
    },
  });

  assert.equal(hooks.isDuplicate(officialRepo, docsGuide), true);
  assert.equal(hooks.isDuplicate(docsGuide, rolloutRecap), true);
  assert.equal(hooks.isDuplicate(officialRepo, rolloutRecap), false);

  const groups = groupDuplicateItems([officialRepo, docsGuide, rolloutRecap], hooks);
  const [cluster] = groups;

  assert.equal(groups.length, 1);
  assert.equal(cluster.length, 3);
  assert.ok(
    cluster.every((item) => item.itemId === "artifact-github-com-acme-agent-grid"),
  );
  assert.ok(
    cluster.every(
      (item) => item.metadata.deduplicationClusterId === "artifact-github-com-acme-agent-grid",
    ),
  );
  assert.deepEqual(cluster[0].metadata.deduplicationClusterSourceIds.sort(), [
    "docs-guide",
    "official-repo",
    "rollout-recap",
  ]);
});

test("consolidateMatchedItems emits one canonical record for matched mentions", () => {
  const matchedMentions = [
    buildItem({
      id: "official-repo",
      name: "agent-graph",
      sourceUrl: "https://github.com/acme/agent-graph",
      category: "library",
      summary: "Official repository for the Agent Graph runtime.",
      integrationHint: "npm install agent-graph",
      sourceKinds: ["github"],
      adapterIds: ["github"],
      sourceAuthorityScore: 94,
      mentionCount: 1,
      scoringSignals: {
        githubStars: 4200,
        githubActivity: 88,
      },
    }),
    buildItem({
      id: "x-launch",
      name: "Agent Graph launch thread",
      sourceUrl: "https://x.com/builder/status/321?utm_source=x",
      sourceUrls: ["https://x.com/builder/status/321?ref=feed"],
      category: "library",
      summary: "Launch thread linking the docs and rollout notes.",
      integrationHint: "Read the launch thread before rollout.",
      sourceKinds: ["x"],
      adapterIds: ["x-twitter"],
      sourceAuthorityScore: 72,
      mentionCount: 2,
      scoringSignals: {
        socialEngagement: 134,
      },
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-graph?utm_source=x"],
      },
    }),
    buildItem({
      id: "docs-guide",
      name: "Introducing Agent Graph",
      sourceUrl: "https://docs.example.com/agent-graph/get-started?utm_source=docs",
      category: "library",
      summary: "Setup guide covering installation and rollout sequencing.",
      integrationHint: "Use the docs to validate the install flow.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 66,
      mentionCount: 1,
      riskWarning: {
        severity: "medium",
        description: "Review the tenancy model before production rollout.",
      },
      metadata: {
        outboundUrls: ["https://github.com/Acme/Agent-Graph"],
      },
    }),
  ];

  const consolidated = consolidateMatchedItems(matchedMentions);

  assert.equal(consolidated.id, "official-repo");
  assert.equal(consolidated.sourceUrl, "https://github.com/acme/agent-graph");
  assert.deepEqual(consolidated.sourceUrls.sort(), [
    "https://docs.example.com/agent-graph/get-started",
    "https://github.com/acme/agent-graph",
    "https://x.com/builder/status/321",
  ]);
  assert.equal(consolidated.mentionCount, 4);
  assert.equal(consolidated.scoringSignals.mentionCount, 4);
  assert.deepEqual(consolidated.sourceKinds.sort(), ["github", "web", "x"]);
  assert.deepEqual(consolidated.adapterIds.sort(), ["github", "web-discovery", "x-twitter"]);
  assert.equal(consolidated.riskWarning.severity, "medium");
});

test("consolidateMatchedItems preserves per-source provenance for matched mentions", () => {
  const consolidated = consolidateMatchedItems([
    buildItem({
      id: "official-repo",
      name: "agent-runtime",
      sourceUrl: "https://github.com/acme/agent-runtime",
      category: "library",
      summary: "Official repository for Agent Runtime.",
      integrationHint: "npm install agent-runtime",
      sourceKinds: ["github"],
      adapterIds: ["github"],
      sourceAuthorityScore: 94,
      mentionCount: 2,
      metadata: {
        sourceProvenance: [
          {
            adapterId: "github",
            sourceKind: "github",
            sourceName: "GitHub",
            channel: "search",
            requestUrl:
              "https://api.github.com/search/repositories?q=agent-runtime",
            fetchedAt: "2026-03-12T20:00:00.000Z",
          },
        ],
      },
    }),
    buildItem({
      id: "x-launch",
      name: "Agent Runtime launch thread",
      sourceUrl: "https://x.com/builder/status/123?utm_source=feed",
      category: "library",
      summary: "Launch thread linking the repository and rollout notes.",
      integrationHint: "Review the launch notes before rollout.",
      sourceKinds: ["x"],
      adapterIds: ["x-twitter"],
      sourceAuthorityScore: 72,
      metadata: {
        sourceName: "@builder",
        outboundUrls: ["https://github.com/acme/agent-runtime"],
      },
    }),
  ]);

  assert.deepEqual(
    consolidated.metadata.sourceProvenance
      .map((entry) => ({
        adapterId: entry.adapterId,
        channel: entry.channel ?? null,
        contributedMentionCount: entry.contributedMentionCount,
        fetchedAt: entry.fetchedAt ?? null,
        requestUrl: entry.requestUrl ?? null,
        sourceItemId: entry.sourceItemId,
        sourceKind: entry.sourceKind,
        sourceName: entry.sourceName ?? null,
        sourceUrl: entry.sourceUrl,
      }))
      .sort(
        (left, right) =>
          left.sourceUrl.localeCompare(right.sourceUrl) ||
          (left.channel ?? "").localeCompare(right.channel ?? ""),
      ),
    [
      {
        adapterId: "github",
        channel: "search",
        contributedMentionCount: 2,
        fetchedAt: "2026-03-12T20:00:00.000Z",
        requestUrl: "https://api.github.com/search/repositories?q=agent-runtime",
        sourceItemId: "official-repo",
        sourceKind: "github",
        sourceName: "GitHub",
        sourceUrl: "https://github.com/acme/agent-runtime",
      },
      {
        adapterId: "x-twitter",
        channel: null,
        contributedMentionCount: 1,
        fetchedAt: null,
        requestUrl: null,
        sourceItemId: "x-launch",
        sourceKind: "x",
        sourceName: "@builder",
        sourceUrl: "https://x.com/builder/status/123",
      },
    ],
  );
});

test("consolidateMatchedItems rejects empty matched mention groups", () => {
  assert.throws(() => consolidateMatchedItems([]), /matched item groups must contain at least one item/);
});

test("deduplicateItems retains the canonical higher-authority item as the primary record", () => {
  const items = [
    buildItem({
      id: "community-thread",
      name: "AgentOps community thread",
      sourceUrl: "https://www.reddit.com/r/LocalLLaMA/comments/abc123/agentops/",
      sourceUrls: ["https://www.reddit.com/r/LocalLLaMA/comments/abc123/agentops/"],
      sourceKinds: ["reddit"],
      adapterIds: ["reddit"],
      sourceAuthorityScore: 55,
      summary: "Operator thread with extra deployment notes and caveats.",
      integrationHint: "Compare the thread guidance with upstream docs.",
      metadata: {
        outboundUrls: ["https://github.com/Acme/AgentOps?utm_source=reddit"],
      },
    }),
    buildItem({
      id: "official-repo",
      summary: "Official repository for AgentOps observability and evaluation.",
    }),
  ];

  const [merged] = deduplicateItems(items);

  assert.equal(merged.id, "official-repo");
  assert.equal(merged.name, "AgentOps");
  assert.equal(merged.sourceUrl, "https://github.com/acme/agentops");
  assert.deepEqual(merged.sourceUrls.sort(), [
    "https://github.com/acme/agentops",
    "https://www.reddit.com/r/LocalLLaMA/comments/abc123/agentops",
  ]);
  assert.deepEqual(merged.metadata.mergedFrom.sort(), ["community-thread", "official-repo"]);
});

test("deduplicateItems emits one consolidated item per duplicate group with distinct source urls", () => {
  const items = [
    buildItem({
      id: "official-repo",
      name: "open-agent-platform",
      sourceUrl: "https://github.com/acme/open-agent-platform",
      category: "library",
      summary: "Official repository for the Open Agent Platform runtime.",
      integrationHint: "npm install open-agent-platform",
    }),
    buildItem({
      id: "community-thread",
      name: "Open Agent Platform released",
      sourceUrl:
        "https://www.reddit.com/r/LocalLLaMA/comments/dup123/open_agent_platform_released/",
      sourceUrls: [
        "https://www.reddit.com/r/LocalLLaMA/comments/dup123/open_agent_platform_released/",
      ],
      category: "library",
      summary: "Community rollout notes and caveats.",
      integrationHint: "Compare the thread notes with upstream docs.",
      sourceKinds: ["reddit"],
      adapterIds: ["reddit"],
      sourceAuthorityScore: 62,
      metadata: {
        outboundUrls: ["https://github.com/Acme/Open-Agent-Platform?utm_source=reddit"],
      },
    }),
    buildItem({
      id: "docs-guide",
      name: "Open Agent Platform setup guide",
      sourceUrl: "https://docs.example.com/open-agent-platform/get-started?ref=launch",
      sourceUrls: ["https://docs.example.com/open-agent-platform/get-started?ref=launch"],
      category: "library",
      summary: "Setup guide that links back to the official repository.",
      integrationHint: "Use the guide to validate the initial installation flow.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 65,
      metadata: {
        outboundUrls: ["https://github.com/acme/open-agent-platform"],
      },
    }),
  ];

  const deduplicated = deduplicateItems(items);
  const [merged] = deduplicated;

  assert.equal(deduplicated.length, 1);
  assert.equal(merged.mentionCount, 3);
  assert.equal(merged.scoringSignals.mentionCount, 3);
  assert.deepEqual(merged.sourceUrls.sort(), [
    "https://docs.example.com/open-agent-platform/get-started",
    "https://github.com/acme/open-agent-platform",
    "https://www.reddit.com/r/LocalLLaMA/comments/dup123/open_agent_platform_released",
  ]);
  assert.ok(
    merged.metadata.identitySignals.includes(
      "identity:repo_root:https://github.com/acme/open-agent-platform",
    ),
  );
});

test("deduplicateItems aggregates cluster mention counts without overcounting alternate urls", () => {
  const [merged] = deduplicateItems([
    buildItem({
      id: "official-repo",
      name: "agent-graph",
      sourceUrl: "https://github.com/acme/agent-graph",
      category: "library",
      summary: "Official repository for Agent Graph.",
      integrationHint: "npm install agent-graph",
    }),
    buildItem({
      id: "docs-guide",
      name: "Agent Graph setup guide",
      sourceUrl: "https://docs.example.com/agent-graph/get-started?ref=docs",
      sourceUrls: [
        "https://docs.example.com/agent-graph/get-started/print?view=full",
        "https://docs.example.com/agent-graph/get-started?ref=docs",
      ],
      category: "library",
      summary: "Setup guide that links back to the official repository.",
      integrationHint: "Use the guide to validate installation prerequisites.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 66,
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-graph"],
      },
    }),
  ]);

  assert.deepEqual(merged.sourceUrls.sort(), [
    "https://docs.example.com/agent-graph/get-started",
    "https://docs.example.com/agent-graph/get-started/print?view=full",
    "https://github.com/acme/agent-graph",
  ]);
  assert.equal(merged.mentionCount, 2);
  assert.equal(merged.scoringSignals.mentionCount, 2);
});

test("deduplicateItems collapses transitive overlap into one canonical merged record", () => {
  const deduplicated = deduplicateItems([
    buildItem({
      id: "x-launch",
      name: "Launch thread for the spring runtime release",
      sourceUrl: "https://x.com/builder/status/999?utm_source=x",
      sourceUrls: ["https://x.com/builder/status/999?ref=timeline"],
      category: "library",
      summary: "Launch thread that directs operators to the release notes.",
      integrationHint: "Read the thread for rollout context before adoption.",
      sourceKinds: ["x"],
      adapterIds: ["x-twitter"],
      sourceAuthorityScore: 72,
      mentionCount: 1,
      metadata: {
        outboundUrls: ["https://docs.example.com/releases/spring-2026?utm_source=x"],
      },
    }),
    buildItem({
      id: "docs-release",
      name: "Atlas Runtime spring release",
      sourceUrl: "https://docs.example.com/releases/spring-2026?ref=site-nav",
      sourceUrls: ["https://docs.example.com/releases/spring-2026?ref=site-nav"],
      category: "library",
      summary: "Release notes with install instructions and a linked repository.",
      integrationHint: "Use the release notes to validate installation prerequisites.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 68,
      metadata: {
        outboundUrls: ["https://github.com/acme/atlas-runtime?utm_source=docs"],
      },
    }),
    buildItem({
      id: "official-repo",
      name: "atlas-runtime",
      sourceUrl: "https://github.com/acme/atlas-runtime",
      category: "library",
      summary: "Official Atlas Runtime repository.",
      integrationHint: "npm install atlas-runtime",
      sourceKinds: ["github"],
      adapterIds: ["github"],
      sourceAuthorityScore: 95,
    }),
  ]);
  const [merged] = deduplicated;

  assert.equal(deduplicated.length, 1);
  assert.equal(merged.id, "official-repo");
  assert.equal(merged.sourceUrl, "https://github.com/acme/atlas-runtime");
  assert.equal(merged.mentionCount, 3);
  assert.deepEqual(merged.sourceUrls.sort(), [
    "https://docs.example.com/releases/spring-2026",
    "https://github.com/acme/atlas-runtime",
    "https://x.com/builder/status/999",
  ]);
  assert.deepEqual(merged.metadata.mergedFrom.sort(), [
    "docs-release",
    "official-repo",
    "x-launch",
  ]);
});

test("deduplicateItems removes duplicate story urls across tracking variants and preserves the canonical source url", () => {
  const items = [
    buildItem({
      id: "official-repo",
      name: "agent-runtime",
      sourceUrl: "https://github.com/acme/agent-runtime",
      category: "library",
      summary: "Official repository for the Agent Runtime library.",
      integrationHint: "npm install agent-runtime",
      mentionCount: 1,
      sourceUrls: [
        "https://github.com/acme/agent-runtime",
        "https://github.com/acme/agent-runtime?utm_source=github",
      ],
    }),
    buildItem({
      id: "launch-post",
      name: "Introducing Agent Runtime",
      sourceUrl: "https://news.example.com/posts/agent-runtime-launch?ref=hn",
      sourceUrls: [
        "https://news.example.com/posts/agent-runtime-launch?utm_medium=social",
        "https://github.com/Acme/Agent-Runtime?utm_source=launch-post",
      ],
      category: "library",
      summary: "Launch post covering installation, rollout notes, and the linked repository.",
      integrationHint: "Read the launch notes before wiring this into production.",
      mentionCount: 1,
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 64,
      metadata: {
        outboundUrls: ["https://github.com/Acme/Agent-Runtime?utm_campaign=launch-post"],
      },
    }),
  ];

  const [merged] = deduplicateItems(items);

  assert.equal(merged.sourceUrl, "https://github.com/acme/agent-runtime");
  assert.deepEqual(merged.sourceUrls.sort(), [
    "https://github.com/acme/agent-runtime",
    "https://news.example.com/posts/agent-runtime-launch",
  ]);
  assert.equal(merged.mentionCount, 2);
});

test("consolidateMatchedItems canonicalizes grouped source urls for the retained primary record", () => {
  const consolidated = consolidateMatchedItems([
    buildItem({
      id: "official-repo",
      name: "agent-runtime",
      sourceUrl: "https://github.com/Acme/Agent-Runtime?utm_source=github",
      sourceUrls: ["https://github.com/Acme/Agent-Runtime?ref=repository"],
      category: "library",
      summary: "Official repository for the Agent Runtime library.",
      integrationHint: "npm install agent-runtime",
      mentionCount: 2,
      sourceKinds: ["github"],
      adapterIds: ["github"],
      sourceAuthorityScore: 95,
      scoringSignals: {
        githubStars: 4800,
        githubActivity: 92,
      },
    }),
    buildItem({
      id: "x-launch",
      name: "Agent Runtime launch thread",
      sourceUrl: "https://x.com/builder/status/123?utm_source=feed",
      category: "library",
      summary: "Launch thread linking the repository and rollout notes.",
      integrationHint: "Review the launch notes before rollout.",
      mentionCount: 1,
      sourceKinds: ["x"],
      adapterIds: ["x-twitter"],
      sourceAuthorityScore: 72,
      scoringSignals: {
        socialEngagement: 180,
      },
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-runtime"],
      },
    }),
    buildItem({
      id: "docs-guide",
      name: "Agent Runtime setup guide",
      sourceUrl: "https://docs.example.com/agent-runtime/get-started?ref=launch",
      category: "library",
      summary: "Setup guide covering installation and rollout sequencing.",
      integrationHint: "Use the guide to validate installation prerequisites.",
      mentionCount: 1,
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 68,
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-runtime"],
      },
    }),
  ]);

  assert.equal(consolidated.sourceUrl, "https://github.com/acme/agent-runtime");
  assert.deepEqual(consolidated.sourceUrls.sort(), [
    "https://docs.example.com/agent-runtime/get-started",
    "https://github.com/acme/agent-runtime",
    "https://x.com/builder/status/123",
  ]);
  assert.equal(consolidated.mentionCount, 4);
  assert.equal(consolidated.scoringSignals.mentionCount, 4);
});

test("deduplicateItems preserves a canonical merged record when a later duplicate story is consolidated", () => {
  const [canonicalRecord] = deduplicateItems([
    buildItem({
      id: "official-repo",
      name: "agent-orchestrator",
      sourceUrl: "https://github.com/acme/agent-orchestrator",
      category: "library",
      summary: "Official repository for the Agent Orchestrator runtime.",
      integrationHint: "npm install agent-orchestrator",
    }),
    buildItem({
      id: "community-thread",
      name: "Agent Orchestrator thread",
      sourceUrl:
        "https://www.reddit.com/r/LocalLLaMA/comments/xyz123/agent_orchestrator_thread/",
      sourceUrls: [
        "https://www.reddit.com/r/LocalLLaMA/comments/xyz123/agent_orchestrator_thread/",
      ],
      category: "library",
      summary: "Operator thread with rollout notes, caveats, and linked upstream docs.",
      integrationHint: "Compare the operator thread with the upstream repository docs.",
      sourceKinds: ["reddit"],
      adapterIds: ["reddit"],
      sourceAuthorityScore: 58,
      riskWarning: {
        severity: "medium",
        description: "Community guidance needs validation before production rollout.",
      },
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-orchestrator?utm_source=reddit"],
      },
    }),
  ]);
  const [merged] = deduplicateItems([
    buildItem({
      id: "docs-guide",
      name: "Agent Orchestrator operations guide",
      sourceUrl: "https://docs.example.com/agent-orchestrator/ops?ref=weekly",
      sourceUrls: ["https://docs.example.com/agent-orchestrator/ops?ref=weekly"],
      category: "library",
      summary:
        "Detailed guide covering rollout sequencing, rollback checks, observability setup, and versioning for Agent Orchestrator deployments.",
      integrationHint:
        "Use the guide to stage rollout checks and rollback hooks before installing the runtime.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 63,
      riskWarning: {
        severity: "high",
        description: "Review tenancy boundaries and secret-handling defaults before rollout.",
      },
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-orchestrator"],
      },
    }),
    canonicalRecord,
  ]);

  assert.equal(merged.id, "official-repo");
  assert.equal(merged.name, "agent-orchestrator");
  assert.equal(merged.sourceUrl, "https://github.com/acme/agent-orchestrator");
  assert.equal(merged.mentionCount, 3);
  assert.equal(merged.riskWarning.severity, "high");
  assert.deepEqual(merged.sourceUrls.sort(), [
    "https://docs.example.com/agent-orchestrator/ops",
    "https://github.com/acme/agent-orchestrator",
    "https://www.reddit.com/r/LocalLLaMA/comments/xyz123/agent_orchestrator_thread",
  ]);
  assert.deepEqual(merged.metadata.mergedFrom.sort(), [
    "community-thread",
    "docs-guide",
    "official-repo",
  ]);
});

test("groupDuplicateItems clusters transitive duplicate candidates across X, web, and github", () => {
  const groups = groupDuplicateItems([
    buildItem({
      id: "x-launch",
      name: "Agent SDK launch thread",
      sourceUrl: "https://x.com/builder/status/123",
      category: "library",
      summary: "Launch thread with an install walkthrough and docs link.",
      integrationHint: "Read the thread before rollout.",
      sourceKinds: ["x"],
      adapterIds: ["x-twitter"],
      sourceAuthorityScore: 72,
      metadata: {
        outboundUrls: ["https://docs.example.com/agent-sdk?utm_source=x"],
      },
    }),
    buildItem({
      id: "docs-post",
      name: "Introducing Agent SDK",
      sourceUrl: "https://docs.example.com/agent-sdk?ref=launch",
      category: "library",
      summary: "Product announcement with setup instructions and repository link.",
      integrationHint: "Follow the setup guide after validating the repo.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 68,
      metadata: {
        outboundUrls: ["https://github.com/acme/agent-sdk?utm_source=docs"],
      },
    }),
    buildItem({
      id: "official-repo",
      name: "agent-sdk",
      sourceUrl: "https://github.com/acme/agent-sdk",
      category: "library",
      summary: "Official Agent SDK repository.",
      integrationHint: "npm install agent-sdk",
      sourceKinds: ["github"],
      adapterIds: ["github"],
      sourceAuthorityScore: 95,
    }),
    buildItem({
      id: "toolkit-docs",
      name: "Agent Toolkit docs",
      sourceUrl: "https://docs.example.com/agent-toolkit",
      category: "tool",
      summary: "Separate toolkit with a different integration path.",
      integrationHint: "Validate the toolkit independently.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 68,
    }),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => group.map((item) => item.id).sort()),
    [
      ["docs-post", "official-repo", "x-launch"],
      ["toolkit-docs"],
    ],
  );
  assert.deepEqual(
    [...new Set(groups[0].map((item) => item.itemId))],
    ["artifact-github-com-acme-agent-sdk"],
  );
  assert.deepEqual(
    [...new Set(groups[0].map((item) => item.metadata.deduplicationClusterId))],
    ["artifact-github-com-acme-agent-sdk"],
  );
  assert.deepEqual(groups[0][0].metadata.deduplicationClusterSourceIds, [
    "x-launch",
    "docs-post",
    "official-repo",
  ]);
  assert.deepEqual(
    [...new Set(groups[1].map((item) => item.metadata.deduplicationClusterId))],
    ["artifact-agent-toolkit"],
  );
});

test("deduplicateItems groups X and web mentions under one canonical item id when canonical identifiers are explicit", () => {
  const canonicalIdentifiers = {
    entityName: "Nova Planner",
    repositoryUrl: null,
    doi: null,
    sourceIds: {
      generic: "nova-planner",
    },
  };
  const [merged] = deduplicateItems([
    buildItem({
      id: "x-thread",
      name: "Nova Planner launch thread",
      sourceUrl: "https://x.com/acme/status/1001?ref=timeline",
      category: "library",
      summary: "Launch thread for Nova Planner.",
      integrationHint: "Review the rollout thread before integrating Nova Planner.",
      sourceKinds: ["x"],
      adapterIds: ["x-twitter"],
      sourceAuthorityScore: 74,
      canonicalIdentifiers,
    }),
    buildItem({
      id: "web-guide",
      name: "Nova Planner setup guide",
      sourceUrl: "https://docs.example.com/nova-planner/get-started?utm_source=nav",
      category: "library",
      summary: "Setup guide for Nova Planner.",
      integrationHint: "Follow the setup guide after validating prerequisites.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 68,
      canonicalIdentifiers,
    }),
  ]);

  assert.equal(merged.itemId, "artifact-generic-nova-planner");
  assert.equal(merged.mentionCount, 2);
  assert.deepEqual(merged.sourceKinds.sort(), ["web", "x"]);
  assert.deepEqual(merged.sourceUrls.sort(), [
    "https://docs.example.com/nova-planner/get-started",
    "https://x.com/acme/status/1001",
  ]);
});

test("deduplicateItems preserves stronger canonical identifiers contributed by a lower-authority duplicate", () => {
  const [merged] = deduplicateItems([
    buildItem({
      id: "ops-guide",
      name: "Flowstate Memory Engine rollout guide",
      sourceUrl: "https://ops.example.com/flowstate-memory-rollout",
      category: "library",
      summary: "Operational guidance for rolling out the Flowstate Memory Engine.",
      integrationHint: "Review the rollout guide before production adoption.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 88,
    }),
    buildItem({
      id: "launch-thread",
      name: "Announcing Flowstate Memory Engine",
      sourceUrl: "https://x.com/acme/status/3001",
      category: "library",
      summary: "Launch thread for the Flowstate Memory Engine.",
      integrationHint: "Review the launch notes before rollout.",
      sourceKinds: ["x"],
      adapterIds: ["x-twitter"],
      sourceAuthorityScore: 61,
      canonicalIdentifiers: {
        entityName: "Flowstate Memory Engine",
        repositoryUrl: null,
        doi: null,
        sourceIds: {
          generic: "flowstate-memory-engine",
        },
      },
    }),
  ]);

  assert.equal(merged.itemId, "artifact-generic-flowstate-memory-engine");
  assert.deepEqual(merged.canonicalIdentifiers, {
    entityName: "Flowstate Memory Engine rollout",
    repositoryUrl: null,
    doi: null,
    sourceIds: {
      generic: "flowstate-memory-engine",
    },
  });
});

test("groupDuplicateItems propagates consolidated canonical identifiers across the deduplication cluster", () => {
  const [cluster] = groupDuplicateItems([
    buildItem({
      id: "ops-guide",
      name: "Flowstate Memory Engine rollout guide",
      sourceUrl: "https://ops.example.com/flowstate-memory-rollout",
      category: "library",
      summary: "Operational guidance for rolling out the Flowstate Memory Engine.",
      integrationHint: "Review the rollout guide before production adoption.",
      sourceKinds: ["web"],
      adapterIds: ["web-discovery"],
      sourceAuthorityScore: 88,
    }),
    buildItem({
      id: "launch-thread",
      name: "Announcing Flowstate Memory Engine",
      sourceUrl: "https://x.com/acme/status/3001",
      category: "library",
      summary: "Launch thread for the Flowstate Memory Engine.",
      integrationHint: "Review the launch notes before rollout.",
      sourceKinds: ["x"],
      adapterIds: ["x-twitter"],
      sourceAuthorityScore: 61,
      canonicalIdentifiers: {
        entityName: "Flowstate Memory Engine",
        repositoryUrl: null,
        doi: null,
        sourceIds: {
          generic: "flowstate-memory-engine",
        },
      },
    }),
  ]);

  assert.deepEqual(
    [...new Set(cluster.map((item) => item.itemId))],
    ["artifact-generic-flowstate-memory-engine"],
  );
  assert.deepEqual(
    cluster.map((item) => item.canonicalIdentifiers.sourceIds.generic),
    ["flowstate-memory-engine", "flowstate-memory-engine"],
  );
});
