import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  NewsletterEditionStore,
  applyStorylineMembership,
  buildEditionStorylines,
  buildStorylineMembershipSnapshot,
  buildTrackedStorylineStatesFromEditions,
  createStoryline,
  createNormalizedItem,
  createPublicationFlow,
  resolveStorylineId,
} from "../src/index.js";

function buildStorylineItem({
  itemId,
  name,
  sourceUrl,
  discoveredAt,
  firstSeen = discoveredAt,
  editionCount = 1,
  relevanceScore = 80,
  topic = "agent runtime rollout",
  sourceKinds = ["github"],
  adapterIds = ["github"],
  summary = `${name} helps autonomous agents extend the runtime rollout safely.`,
  integrationHint = `Review ${name} before enabling it in production.`,
  canonicalIdentifiers = null,
  storylineMetadata = null,
}) {
  return createNormalizedItem({
    itemId,
    name,
    sourceUrl,
    category: "library",
    summary,
    integrationHint,
    relevanceScore,
    sourceKinds,
    adapterIds,
    sourceAuthorityScore: 91,
    discoveredAt,
    firstSeen,
    editionCount,
    canonicalIdentifiers,
    metadata: {
      ...(topic == null ? {} : { topic }),
      ...(storylineMetadata == null ? {} : { storyline: storylineMetadata }),
    },
  });
}

function buildEdition({ publishedAt, startsAt, items }) {
  return {
    publishedAt,
    window: {
      startsAt,
      endsAt: publishedAt,
      timezone: "UTC",
    },
    items,
  };
}

test("resolveStorylineId groups related items under the same storyline topic", () => {
  const runtimeCore = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-11T20:00:00.000Z",
  });
  const runtimeCli = buildStorylineItem({
    itemId: "agent-runtime-cli",
    name: "Agent Runtime CLI",
    sourceUrl: "https://github.com/acme/agent-runtime-cli",
    discoveredAt: "2026-03-11T20:05:00.000Z",
  });

  assert.equal(resolveStorylineId(runtimeCore), "storyline-artifact-agent-runtime-rollout");
  assert.equal(resolveStorylineId(runtimeCli), "storyline-artifact-agent-runtime-rollout");
  assert.notEqual(runtimeCore.itemId, runtimeCli.itemId);
});

test("createStoryline normalizes parent lineage and narrative metadata", () => {
  const storyline = createStoryline({
    storyline_id: "storyline-agent-runtime-cloud",
    title: "Agent Runtime expands into managed hosting",
    member_item_ids: ["artifact-agent-runtime-core", "artifact-agent-runtime-cloud"],
    parent_storyline_ids: ["storyline-agent-runtime-sdk"],
    narrative_type: {
      key: "managed-hosting-expansion",
      label: "Managed hosting expansion",
      metadata: {
        focus: "deployment",
      },
    },
    status: "developing",
  });

  assert.deepEqual(storyline, {
    storylineId: "storyline-agent-runtime-cloud",
    title: "Agent Runtime expands into managed hosting",
    memberItemIds: ["artifact-agent-runtime-core", "artifact-agent-runtime-cloud"],
    parentStorylineIds: ["storyline-agent-runtime-sdk"],
    narrativeType: {
      key: "managed-hosting-expansion",
      label: "Managed hosting expansion",
      metadata: {
        focus: "deployment",
      },
    },
    status: "developing",
  });
});

test("buildEditionStorylines preserves explicit snake_case storyline metadata ids", () => {
  const item = buildStorylineItem({
    itemId: "agent-runtime-cloud",
    name: "Agent Runtime Cloud",
    sourceUrl: "https://example.com/agent-runtime-cloud",
    discoveredAt: "2026-03-12T20:45:00.000Z",
    topic: "agent runtime orchestration",
    storylineMetadata: {
      storyline_id: "storyline-agent-runtime-cloud-hosting",
      title: "Agent Runtime expands into managed hosting",
      member_item_ids: ["agent-runtime-core", "agent-runtime-cloud"],
      parent_storyline_ids: ["storyline-agent-runtime-sdk"],
      narrative_type: {
        key: "managed-hosting-expansion",
        label: "Managed hosting expansion",
        metadata: {
          phase: "launch",
        },
      },
      status: "developing",
    },
  });

  const [storyline] = buildEditionStorylines([item]);

  assert.equal(item.storylineId, "storyline-agent-runtime-cloud-hosting");
  assert.deepEqual(storyline, {
    storylineId: "storyline-agent-runtime-cloud-hosting",
    title: "Agent Runtime expands into managed hosting",
    memberItemIds: ["agent-runtime-core", "agent-runtime-cloud"],
    parentStorylineIds: ["storyline-agent-runtime-sdk"],
    narrativeType: {
      key: "managed-hosting-expansion",
      label: "Managed hosting expansion",
      metadata: {
        phase: "launch",
      },
    },
    status: "developing",
  });
});

test("buildTrackedStorylineStatesFromEditions keeps member item ids unique and chronological", () => {
  const runtimeCore = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-10T20:00:00.000Z",
  });
  const runtimeCli = buildStorylineItem({
    itemId: "agent-runtime-cli",
    name: "Agent Runtime CLI",
    sourceUrl: "https://github.com/acme/agent-runtime-cli",
    discoveredAt: "2026-03-11T20:00:00.000Z",
  });
  const repeatedRuntimeCore = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-12T20:00:00.000Z",
    firstSeen: "2026-03-10T20:00:00.000Z",
    editionCount: 2,
  });
  const editions = [
    buildEdition({
      publishedAt: "2026-03-12T21:00:00.000Z",
      startsAt: "2026-03-11T21:00:00.000Z",
      items: [repeatedRuntimeCore],
    }),
    buildEdition({
      publishedAt: "2026-03-11T21:00:00.000Z",
      startsAt: "2026-03-10T21:00:00.000Z",
      items: [runtimeCli],
    }),
    buildEdition({
      publishedAt: "2026-03-10T21:00:00.000Z",
      startsAt: "2026-03-09T21:00:00.000Z",
      items: [runtimeCore],
    }),
  ];

  const trackedStorylines = buildTrackedStorylineStatesFromEditions(editions, {
    before: "2026-03-13T21:00:00.000Z",
  });
  const runtimeStoryline = trackedStorylines.get("storyline-artifact-agent-runtime-rollout");

  assert.equal(runtimeStoryline.id, "storyline-artifact-agent-runtime-rollout");
  assert.deepEqual(runtimeStoryline.memberItemIds, [
    "agent-runtime-core",
    "agent-runtime-cli",
  ]);
  assert.equal(runtimeStoryline.firstSeen, "2026-03-10T20:00:00.000Z");
  assert.equal(runtimeStoryline.lastSeen, "2026-03-12T20:00:00.000Z");
  assert.equal(runtimeStoryline.updatedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(runtimeStoryline.evolutionCount, 2);
  assert.ok(typeof runtimeStoryline.title === "string" && runtimeStoryline.title.length > 0);
});

test("buildTrackedStorylineStatesFromEditions keeps related releases inside one evolving storyline", () => {
  const runtimeCore = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-10T20:00:00.000Z",
    topic: "agent runtime orchestration",
  });
  const runtimeMemory = buildStorylineItem({
    itemId: "agent-runtime-memory",
    name: "Agent Runtime Memory Pack",
    sourceUrl: "https://docs.acme.dev/agent-runtime-memory",
    discoveredAt: "2026-03-11T20:15:00.000Z",
    topic: "agent runtime orchestration",
  });
  const runtimeSafety = buildStorylineItem({
    itemId: "agent-runtime-safety",
    name: "Agent Runtime Safety Pack",
    sourceUrl: "https://x.com/acme/status/999",
    discoveredAt: "2026-03-12T20:20:00.000Z",
    topic: "agent runtime orchestration",
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
  });

  const trackedStorylines = buildTrackedStorylineStatesFromEditions(
    [
      buildEdition({
        publishedAt: "2026-03-10T21:00:00.000Z",
        startsAt: "2026-03-09T21:00:00.000Z",
        items: [runtimeCore],
      }),
      buildEdition({
        publishedAt: "2026-03-11T21:00:00.000Z",
        startsAt: "2026-03-10T21:00:00.000Z",
        items: [runtimeMemory],
      }),
      buildEdition({
        publishedAt: "2026-03-12T21:00:00.000Z",
        startsAt: "2026-03-11T21:00:00.000Z",
        items: [runtimeSafety],
      }),
    ],
    {
      before: "2026-03-13T21:00:00.000Z",
    },
  );

  const storyline = trackedStorylines.get("storyline-artifact-agent-runtime-orchestration");

  assert.ok(storyline);
  assert.deepEqual(storyline.memberItemIds, [
    "agent-runtime-core",
    "agent-runtime-memory",
    "agent-runtime-safety",
  ]);
  assert.equal(storyline.evolutionCount, 3);
  assert.equal(storyline.repetitionCount, 0);
  assert.equal(storyline.lastSeen, "2026-03-12T20:20:00.000Z");
});

test(
  "buildTrackedStorylineStatesFromEditions reuses prior storyline membership when later snapshots are partial",
  () => {
    const runtimeCore = buildStorylineItem({
      itemId: "agent-runtime-core",
      name: "Agent Runtime Core",
      sourceUrl: "https://github.com/acme/agent-runtime",
      discoveredAt: "2026-03-10T20:00:00.000Z",
      topic: "agent runtime rollout",
    });
    const runtimeCloud = buildStorylineItem({
      itemId: "agent-runtime-cloud",
      name: "Agent Runtime Cloud",
      sourceUrl: "https://acme.example.com/agent-runtime-cloud",
      discoveredAt: "2026-03-11T20:15:00.000Z",
      topic: "agent runtime rollout",
      storylineMetadata: {
        storyline_id: resolveStorylineId(runtimeCore),
        title: "Agent Runtime rollout",
        status: "stable",
        member_item_ids: ["agent-runtime-cloud"],
      },
    });
    const storylineId = resolveStorylineId(runtimeCore);

    const trackedStorylines = buildTrackedStorylineStatesFromEditions(
      [
        {
          ...buildEdition({
            publishedAt: "2026-03-10T21:00:00.000Z",
            startsAt: "2026-03-09T21:00:00.000Z",
            items: [runtimeCore],
          }),
          storylines: [
            {
              storylineId,
              title: "Agent Runtime rollout",
              memberItemIds: [runtimeCore.itemId],
              status: "developing",
            },
          ],
        },
        {
          ...buildEdition({
            publishedAt: "2026-03-11T21:00:00.000Z",
            startsAt: "2026-03-10T21:00:00.000Z",
            items: [runtimeCloud],
          }),
          storylines: [
            {
              storylineId,
              title: "Agent Runtime rollout",
              memberItemIds: [runtimeCloud.itemId],
              status: "stable",
            },
          ],
        },
      ],
      {
        before: "2026-03-12T21:00:00.000Z",
      },
    );
    const storyline = trackedStorylines.get(storylineId);

    assert.ok(storyline);
    assert.deepEqual(storyline.memberItemIds, [
      runtimeCore.itemId,
      runtimeCloud.itemId,
    ]);
    assert.equal(storyline.firstSeen, runtimeCore.firstSeen);
    assert.equal(storyline.lastSeen, runtimeCloud.discoveredAt);
  },
);

test("applyStorylineMembership assigns new related items into an existing tracked storyline", () => {
  const trackedStorylines = new Map([
    [
      "storyline-agent-runtime",
      {
        id: "storyline-agent-runtime",
        title: "Agent Runtime expands into managed hosting",
        memberItemIds: ["agent-runtime-core"],
        firstSeen: "2026-03-10T20:00:00.000Z",
        lastSeen: "2026-03-11T20:00:00.000Z",
      },
    ],
  ]);
  const relatedItem = buildStorylineItem({
    itemId: "agent-runtime-cloud",
    name: "Agent Runtime Cloud",
    sourceUrl: "https://acme.example.com/agent-runtime-cloud",
    discoveredAt: "2026-03-12T20:30:00.000Z",
    topic: null,
    summary: "Managed hosting extends the Agent Runtime deployment story for autonomous agents.",
    integrationHint: "Review the hosted control plane before rollout.",
    canonicalIdentifiers: {
      entityName: "Agent Runtime",
      repositoryUrl: null,
      doi: null,
      sourceIds: {},
    },
  });

  const [annotatedItem] = applyStorylineMembership(
    [relatedItem],
    trackedStorylines,
    "2026-03-12T21:00:00.000Z",
  );

  assert.equal(annotatedItem.storylineId, "storyline-agent-runtime");
  assert.equal(annotatedItem.storylineMemberPosition, 2);
  assert.equal(
    annotatedItem.metadata.storyline.title,
    "Agent Runtime expands into managed hosting",
  );
  assert.deepEqual(annotatedItem.metadata.storyline.member_item_ids, [
    "agent-runtime-core",
    "agent-runtime-cloud",
  ]);
});

test("applyStorylineMembership creates a new storyline when no tracked storyline matches", () => {
  const trackedStorylines = new Map([
    [
      "storyline-agent-runtime",
      {
        id: "storyline-agent-runtime",
        title: "Agent Runtime expands into managed hosting",
        memberItemIds: ["agent-runtime-core"],
        firstSeen: "2026-03-10T20:00:00.000Z",
        lastSeen: "2026-03-11T20:00:00.000Z",
      },
    ],
  ]);
  const unrelatedItem = buildStorylineItem({
    itemId: "browser-operator-kit",
    name: "Browser Operator Kit",
    sourceUrl: "https://example.com/browser-operator-kit",
    discoveredAt: "2026-03-12T20:30:00.000Z",
    topic: null,
    summary: "Operator kit for browser-native agent workflows.",
    integrationHint: "Install the browser operator before rollout.",
    canonicalIdentifiers: {
      entityName: "Browser Operator",
      repositoryUrl: null,
      doi: null,
      sourceIds: {},
    },
  });

  const [annotatedItem] = applyStorylineMembership(
    [unrelatedItem],
    trackedStorylines,
    "2026-03-12T21:00:00.000Z",
  );

  assert.equal(annotatedItem.storylineId, resolveStorylineId(unrelatedItem));
  assert.notEqual(annotatedItem.storylineId, "storyline-agent-runtime");
  assert.equal(annotatedItem.storylineMemberPosition, 1);
  assert.deepEqual(annotatedItem.metadata.storyline.member_item_ids, [
    "browser-operator-kit",
  ]);
});

test(
  "buildStorylineMembershipSnapshot creates a new storyline and clusters related first-seen items into one storyline",
  () => {
    const runtimeCore = buildStorylineItem({
      itemId: "agent-runtime-core",
      name: "Agent Runtime Core",
      sourceUrl: "https://github.com/acme/agent-runtime",
      discoveredAt: "2026-03-12T20:10:00.000Z",
      topic: "agent runtime orchestration",
    });
    const runtimeCloud = buildStorylineItem({
      itemId: "agent-runtime-cloud",
      name: "Agent Runtime Cloud",
      sourceUrl: "https://example.com/agent-runtime-cloud",
      discoveredAt: "2026-03-12T20:25:00.000Z",
      topic: "agent runtime orchestration",
    });
    const storylineId = resolveStorylineId(runtimeCore);
    const snapshot = buildStorylineMembershipSnapshot(
      [runtimeCloud, runtimeCore],
      new Map(),
      "2026-03-12T21:00:00.000Z",
    );
    const annotatedCore = snapshot.items.find((item) => item.itemId === runtimeCore.itemId);
    const annotatedCloud = snapshot.items.find((item) => item.itemId === runtimeCloud.itemId);

    assert.ok(annotatedCore);
    assert.ok(annotatedCloud);
    assert.equal(annotatedCore.storylineId, storylineId);
    assert.equal(annotatedCloud.storylineId, storylineId);
    assert.equal(annotatedCore.storylineMemberPosition, 1);
    assert.equal(annotatedCloud.storylineMemberPosition, 2);
    assert.deepEqual(annotatedCloud.metadata.storyline.member_item_ids, [
      "agent-runtime-core",
      "agent-runtime-cloud",
    ]);
    assert.equal(snapshot.storylines.length, 1);
    assert.equal(snapshot.storylines[0].storylineId, storylineId);
    assert.deepEqual(snapshot.storylines[0].memberItemIds, [
      "agent-runtime-core",
      "agent-runtime-cloud",
    ]);
  },
);

test("buildStorylineMembershipSnapshot continues an existing storyline for later related coverage", () => {
  const storylineId = "storyline-artifact-agent-runtime-rollout";
  const continuedItem = buildStorylineItem({
    itemId: "agent-runtime-memory",
    name: "Agent Runtime Memory Pack",
    sourceUrl: "https://example.com/agent-runtime-memory",
    discoveredAt: "2026-03-12T20:25:00.000Z",
    topic: "agent runtime rollout",
  });
  const snapshot = buildStorylineMembershipSnapshot(
    [continuedItem],
    new Map([
      [
        storylineId,
        {
          id: storylineId,
          title: "Agent Runtime rollout",
          status: "developing",
          memberItemIds: ["agent-runtime-core"],
          firstSeen: "2026-03-10T20:00:00.000Z",
          lastSeen: "2026-03-11T20:00:00.000Z",
          updatedAt: "2026-03-11T21:00:00.000Z",
          lastEvolutionAt: "2026-03-11T21:00:00.000Z",
          evolutionCount: 1,
          repetitionCount: 0,
          repetitionStreak: 0,
        },
      ],
    ]),
    "2026-03-12T21:00:00.000Z",
  );
  const [annotatedItem] = snapshot.items;
  const [storyline] = snapshot.storylines;

  assert.equal(annotatedItem.storylineId, storylineId);
  assert.deepEqual(annotatedItem.metadata.storyline.member_item_ids, [
    "agent-runtime-core",
    "agent-runtime-memory",
  ]);
  assert.equal(storyline.storylineId, storylineId);
  assert.deepEqual(storyline.memberItemIds, [
    "agent-runtime-core",
    "agent-runtime-memory",
  ]);
  assert.equal(storyline.status, "stable");
});

test("buildStorylineMembershipSnapshot forks a divergent recurring item into a child storyline", () => {
  const parentStorylineId = "storyline-artifact-agent-runtime-rollout";
  const divergedItem = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Control Plane",
    sourceUrl: "https://example.com/agent-runtime-control-plane",
    discoveredAt: "2026-03-12T20:30:00.000Z",
    topic: "agent runtime control plane",
  });
  const childStorylineId = resolveStorylineId(divergedItem);
  const snapshot = buildStorylineMembershipSnapshot(
    [divergedItem],
    new Map([
      [
        parentStorylineId,
        {
          id: parentStorylineId,
          title: "Agent Runtime rollout",
          status: "stable",
          memberItemIds: ["agent-runtime-core"],
          firstSeen: "2026-03-10T20:00:00.000Z",
          lastSeen: "2026-03-11T20:00:00.000Z",
          updatedAt: "2026-03-11T21:00:00.000Z",
          lastEvolutionAt: "2026-03-11T21:00:00.000Z",
          evolutionCount: 2,
          repetitionCount: 0,
          repetitionStreak: 0,
        },
      ],
    ]),
    "2026-03-12T21:00:00.000Z",
    new Map([
      [
        divergedItem.itemId,
        {
          firstSeen: "2026-03-10T20:00:00.000Z",
          editionCount: 2,
          storylineId: parentStorylineId,
          item: buildStorylineItem({
            itemId: "agent-runtime-core",
            name: "Agent Runtime Core",
            sourceUrl: "https://github.com/acme/agent-runtime",
            discoveredAt: "2026-03-11T20:00:00.000Z",
            topic: "agent runtime rollout",
          }),
        },
      ],
    ]),
  );
  const [annotatedItem] = snapshot.items;
  const [storyline] = snapshot.storylines;

  assert.equal(annotatedItem.storylineId, childStorylineId);
  assert.deepEqual(annotatedItem.metadata.storyline.parent_storyline_ids, [
    parentStorylineId,
  ]);
  assert.equal(storyline.storylineId, childStorylineId);
  assert.deepEqual(storyline.parentStorylineIds, [parentStorylineId]);
});

test("buildStorylineMembershipSnapshot merges converging source storylines into one grouped narrative", () => {
  const runtimeSource = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-10T20:00:00.000Z",
    topic: "agent runtime rollout",
  });
  const sandboxSource = buildStorylineItem({
    itemId: "agent-sandbox-hardening",
    name: "Agent Sandbox Hardening",
    sourceUrl: "https://example.com/agent-sandbox-hardening",
    discoveredAt: "2026-03-11T20:00:00.000Z",
    topic: "agent sandbox hardening",
  });
  const runtimeStorylineId = resolveStorylineId(runtimeSource);
  const sandboxStorylineId = resolveStorylineId(sandboxSource);
  const convergedStorylineId = resolveStorylineId(
    buildStorylineItem({
      itemId: runtimeSource.itemId,
      name: "Agent Platform Control Plane",
      sourceUrl: "https://example.com/agent-platform-control-plane",
      discoveredAt: "2026-03-12T20:10:00.000Z",
      topic: "agent platform control plane",
    }),
  );
  const snapshot = buildStorylineMembershipSnapshot(
    [
      buildStorylineItem({
        itemId: runtimeSource.itemId,
        name: "Agent Platform Control Plane",
        sourceUrl: "https://example.com/agent-platform-control-plane",
        discoveredAt: "2026-03-12T20:10:00.000Z",
        topic: "agent platform control plane",
        storylineMetadata: {
          storyline_id: convergedStorylineId,
          previous_storyline_id: runtimeStorylineId,
        },
      }),
      buildStorylineItem({
        itemId: sandboxSource.itemId,
        name: "Agent Platform Safety Controls",
        sourceUrl: "https://example.com/agent-platform-safety-controls",
        discoveredAt: "2026-03-12T20:20:00.000Z",
        topic: "agent platform control plane",
        storylineMetadata: {
          storyline_id: convergedStorylineId,
          previous_storyline_id: sandboxStorylineId,
        },
      }),
    ],
    new Map([
      [
        runtimeStorylineId,
        {
          id: runtimeStorylineId,
          title: runtimeSource.name,
          status: "stable",
          memberItemIds: [runtimeSource.itemId],
          firstSeen: runtimeSource.firstSeen,
          lastSeen: runtimeSource.discoveredAt,
          updatedAt: "2026-03-10T21:00:00.000Z",
          lastEvolutionAt: "2026-03-10T21:00:00.000Z",
          evolutionCount: 2,
          repetitionCount: 0,
          repetitionStreak: 0,
        },
      ],
      [
        sandboxStorylineId,
        {
          id: sandboxStorylineId,
          title: sandboxSource.name,
          status: "stable",
          memberItemIds: [sandboxSource.itemId],
          firstSeen: sandboxSource.firstSeen,
          lastSeen: sandboxSource.discoveredAt,
          updatedAt: "2026-03-11T21:00:00.000Z",
          lastEvolutionAt: "2026-03-11T21:00:00.000Z",
          evolutionCount: 2,
          repetitionCount: 0,
          repetitionStreak: 0,
        },
      ],
    ]),
    "2026-03-12T21:00:00.000Z",
  );
  const [storyline] = snapshot.storylines;

  assert.equal(snapshot.storylines.length, 1);
  assert.ok(snapshot.items.every((item) => item.storylineId === convergedStorylineId));
  assert.deepEqual(
    [...snapshot.items[0].metadata.storyline.parent_storyline_ids].sort(),
    [runtimeStorylineId, sandboxStorylineId],
  );
  assert.deepEqual(
    [...snapshot.items[0].metadata.storyline.merged_storyline_ids].sort(),
    [runtimeStorylineId, sandboxStorylineId],
  );
  assert.equal(storyline.storylineId, convergedStorylineId);
  assert.deepEqual([...storyline.parentStorylineIds].sort(), [
    runtimeStorylineId,
    sandboxStorylineId,
  ]);
  assert.deepEqual([...storyline.mergedStorylineIds].sort(), [
    runtimeStorylineId,
    sandboxStorylineId,
  ]);
});

test("applyStorylineMembership classifies a later same-edition recap as repetition", () => {
  const launchItem = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-12T20:10:00.000Z",
    summary:
      "Agent Runtime adds browser sessions and approval policies for autonomous agents.",
    integrationHint:
      "Upgrade agent-runtime and enable browser sessions with approval policies.",
  });
  const recapItem = buildStorylineItem({
    itemId: "agent-runtime-launch-thread",
    name: "Agent Runtime launch thread",
    sourceUrl: "https://blog.example.com/agent-runtime-launch-thread",
    discoveredAt: "2026-03-12T20:30:00.000Z",
    summary:
      "Agent Runtime adds browser sessions and approval policies for autonomous agents.",
    integrationHint:
      "Install the latest runtime release and turn on approval policies for browser sessions.",
  });

  const annotatedItems = applyStorylineMembership(
    [recapItem, launchItem],
    new Map(),
    "2026-03-12T21:00:00.000Z",
  );
  const annotatedRecap = annotatedItems.find((item) => item.itemId === recapItem.itemId);

  assert.ok(annotatedRecap);
  assert.equal(annotatedRecap.metadata.storyline.relationship.decision, "repetition");
  assert.equal(annotatedRecap.metadata.storyline.relationship.priorAppearanceCount, 1);
  assert.equal(
    annotatedRecap.metadata.storyline.relationship.previousAppearance.sourceUrl,
    launchItem.sourceUrl,
  );
  assert.equal(annotatedRecap.metadata.storyline.relationship.signals.novelFactCount, 0);
});

test("resolveStorylineId does not collapse unrelated boilerplate repetition into one storyline", () => {
  const runtimeLaunchNotes = buildStorylineItem({
    itemId: "agent-runtime-launch-notes",
    name: "Introducing Agent Runtime Core launch notes",
    sourceUrl: "https://blog.acme.dev/agent-runtime-launch-notes",
    discoveredAt: "2026-03-12T20:00:00.000Z",
    topic: null,
    summary: "Official update notes for autonomous agent production rollout.",
    integrationHint: "Read the launch notes before enabling the runtime in production.",
  });
  const browserLaunchNotes = buildStorylineItem({
    itemId: "browser-operator-launch-notes",
    name: "Introducing Browser Operator Kit launch notes",
    sourceUrl: "https://blog.example.com/browser-operator-launch-notes",
    discoveredAt: "2026-03-12T20:05:00.000Z",
    topic: null,
    summary: "Official update notes for autonomous agent production rollout.",
    integrationHint: "Read the launch notes before enabling the operator in production.",
  });

  assert.equal(
    resolveStorylineId(runtimeLaunchNotes),
    "storyline-artifact-agent-runtime-core",
  );
  assert.equal(
    resolveStorylineId(browserLaunchNotes),
    "storyline-artifact-browser-operator-kit",
  );
  assert.notEqual(
    resolveStorylineId(runtimeLaunchNotes),
    resolveStorylineId(browserLaunchNotes),
  );
});

test("publication flow appends new storyline members in chronological order", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const editionStore = new NewsletterEditionStore({ directoryPath });

  await editionStore.publish(
    buildEdition({
      publishedAt: "2026-03-11T21:00:00.000Z",
      startsAt: "2026-03-10T21:00:00.000Z",
      items: [
        buildStorylineItem({
          itemId: "agent-runtime-core",
          name: "Agent Runtime Core",
          sourceUrl: "https://github.com/acme/agent-runtime",
          discoveredAt: "2026-03-11T20:00:00.000Z",
        }),
      ],
    }),
  );

  const laterItem = buildStorylineItem({
    itemId: "agent-runtime-safety",
    name: "Agent Runtime Safety Pack",
    sourceUrl: "https://github.com/acme/agent-runtime-safety",
    discoveredAt: "2026-03-12T20:55:00.000Z",
    relevanceScore: 88,
  });
  const earlierItem = buildStorylineItem({
    itemId: "agent-runtime-cli",
    name: "Agent Runtime CLI",
    sourceUrl: "https://github.com/acme/agent-runtime-cli",
    discoveredAt: "2026-03-12T20:40:00.000Z",
    relevanceScore: 79,
  });
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [laterItem, earlierItem],
        };
      },
    },
    editionStore,
  });

  const edition = await flow.publishEdition();
  const storylineMembers = edition.items[0].metadata.storyline.member_item_ids;

  assert.deepEqual(storylineMembers, [
    "agent-runtime-core",
    "agent-runtime-cli",
    "agent-runtime-safety",
  ]);
  assert.deepEqual(edition.items[1].metadata.storyline.member_item_ids, storylineMembers);
});

test("applyStorylineMembership reuses tracked storyline membership for recurring items", () => {
  const recurringItem = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Core rollout notes",
    sourceUrl: "https://x.com/acme/status/123",
    discoveredAt: "2026-03-12T20:30:00.000Z",
    firstSeen: "2026-03-10T20:00:00.000Z",
    editionCount: 3,
    topic: "different derived topic",
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
  });
  const trackedStorylines = new Map([
    [
      "storyline-artifact-agent-runtime-rollout",
      {
        id: "storyline-artifact-agent-runtime-rollout",
        memberItemIds: ["agent-runtime-core", "agent-runtime-cli"],
        firstSeen: "2026-03-10T20:00:00.000Z",
        lastSeen: "2026-03-11T20:00:00.000Z",
      },
    ],
  ]);

  const [annotatedItem] = applyStorylineMembership(
    [recurringItem],
    trackedStorylines,
    "2026-03-12T21:00:00.000Z",
  );

  assert.equal(annotatedItem.metadata.storyline.id, "storyline-artifact-agent-runtime-rollout");
  assert.equal(
    annotatedItem.metadata.storyline.storyline_id,
    "storyline-artifact-agent-runtime-rollout",
  );
  assert.deepEqual(annotatedItem.metadata.storyline.member_item_ids, [
    "agent-runtime-core",
    "agent-runtime-cli",
  ]);
});

test("applyStorylineMembership reassigns a recurring narrative using explicit previous storyline metadata", () => {
  const parentStorylineId = "storyline-artifact-agent-runtime-rollout";
  const divergedItem = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Control Plane",
    sourceUrl: "https://example.com/agent-runtime-control-plane",
    discoveredAt: "2026-03-12T20:30:00.000Z",
    topic: "agent runtime control plane",
    storylineMetadata: {
      previous_storyline_id: parentStorylineId,
    },
  });
  const trackedStorylines = new Map([
    [
      parentStorylineId,
      {
        id: parentStorylineId,
        title: "Agent Runtime rollout",
        status: "stable",
        memberItemIds: ["agent-runtime-core"],
        firstSeen: "2026-03-10T20:00:00.000Z",
        lastSeen: "2026-03-11T20:00:00.000Z",
        updatedAt: "2026-03-11T21:00:00.000Z",
        lastEvolutionAt: "2026-03-11T21:00:00.000Z",
        evolutionCount: 2,
        repetitionCount: 0,
        repetitionStreak: 0,
      },
    ],
  ]);

  const [annotatedItem] = applyStorylineMembership(
    [divergedItem],
    trackedStorylines,
    "2026-03-12T21:00:00.000Z",
  );
  const [childStoryline] = buildEditionStorylines([annotatedItem], trackedStorylines);

  assert.equal(annotatedItem.storylineId, resolveStorylineId(divergedItem));
  assert.notEqual(annotatedItem.storylineId, parentStorylineId);
  assert.deepEqual(annotatedItem.metadata.storyline.parent_storyline_ids, [
    parentStorylineId,
  ]);
  assert.equal(childStoryline.storylineId, annotatedItem.storylineId);
  assert.deepEqual(childStoryline.parentStorylineIds, [parentStorylineId]);
  assert.equal(childStoryline.status, "developing");
});

test("applyStorylineMembership forks a recurring item into a child storyline when the topic diverges", () => {
  const parentStorylineId = "storyline-artifact-agent-runtime-rollout";
  const divergedItem = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Control Plane",
    sourceUrl: "https://example.com/agent-runtime-control-plane",
    discoveredAt: "2026-03-12T20:30:00.000Z",
    topic: "agent runtime control plane",
  });
  const trackedStorylines = new Map([
    [
      parentStorylineId,
      {
        id: parentStorylineId,
        title: "Agent Runtime rollout",
        status: "stable",
        memberItemIds: ["agent-runtime-core"],
        firstSeen: "2026-03-10T20:00:00.000Z",
        lastSeen: "2026-03-11T20:00:00.000Z",
        updatedAt: "2026-03-11T21:00:00.000Z",
        lastEvolutionAt: "2026-03-11T21:00:00.000Z",
        evolutionCount: 2,
        repetitionCount: 0,
        repetitionStreak: 0,
      },
    ],
  ]);
  const trackedItemStates = new Map([
    [
      divergedItem.itemId,
      {
        firstSeen: "2026-03-10T20:00:00.000Z",
        editionCount: 2,
        storylineId: parentStorylineId,
        item: buildStorylineItem({
          itemId: "agent-runtime-core",
          name: "Agent Runtime Core",
          sourceUrl: "https://github.com/acme/agent-runtime",
          discoveredAt: "2026-03-11T20:00:00.000Z",
          topic: "agent runtime rollout",
        }),
      },
    ],
  ]);

  const [annotatedItem] = applyStorylineMembership(
    [divergedItem],
    trackedStorylines,
    "2026-03-12T21:00:00.000Z",
    trackedItemStates,
  );
  const storylines = buildEditionStorylines([annotatedItem], trackedStorylines);

  assert.equal(annotatedItem.storylineId, resolveStorylineId(divergedItem));
  assert.notEqual(annotatedItem.storylineId, parentStorylineId);
  assert.deepEqual(annotatedItem.metadata.storyline.parent_storyline_ids, [
    parentStorylineId,
  ]);
  assert.equal(annotatedItem.metadata.storyline.status, "developing");
  assert.equal(storylines[0].storylineId, annotatedItem.storylineId);
  assert.deepEqual(storylines[0].parentStorylineIds, [parentStorylineId]);
});

test("buildTrackedStorylineStatesFromEditions backfills parent lineage from persisted child storyline references", () => {
  const parentStorylineId = "storyline-artifact-agent-runtime-rollout";
  const childStorylineId = "storyline-artifact-agent-runtime-control-plane";
  const parentItem = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-11T20:00:00.000Z",
    topic: "agent runtime rollout",
    storylineMetadata: {
      storyline_id: parentStorylineId,
      title: "Agent Runtime rollout",
      member_item_ids: ["agent-runtime-core"],
      child_storyline_ids: [childStorylineId],
      status: "stable",
      updated_at: "2026-03-11T21:00:00.000Z",
      last_evolution_at: "2026-03-11T21:00:00.000Z",
      evolution_count: 2,
    },
  });
  const childItem = buildStorylineItem({
    itemId: "agent-runtime-control-plane",
    name: "Agent Runtime Control Plane",
    sourceUrl: "https://example.com/agent-runtime-control-plane",
    discoveredAt: "2026-03-12T20:00:00.000Z",
    topic: "agent runtime control plane",
    storylineMetadata: {
      storyline_id: childStorylineId,
      title: "Agent Runtime Control Plane",
      member_item_ids: ["agent-runtime-control-plane"],
      status: "developing",
      updated_at: "2026-03-12T21:00:00.000Z",
      last_evolution_at: "2026-03-12T21:00:00.000Z",
      evolution_count: 1,
    },
  });

  const reconstructedStorylines = buildTrackedStorylineStatesFromEditions(
    [
      {
        ...buildEdition({
          publishedAt: "2026-03-11T21:00:00.000Z",
          startsAt: "2026-03-10T21:00:00.000Z",
          items: [parentItem],
        }),
        storylines: [
          {
            storylineId: parentStorylineId,
            title: "Agent Runtime rollout",
            memberItemIds: ["agent-runtime-core"],
            childStorylineIds: [childStorylineId],
            status: "stable",
          },
        ],
      },
      {
        ...buildEdition({
          publishedAt: "2026-03-12T21:00:00.000Z",
          startsAt: "2026-03-11T21:00:00.000Z",
          items: [childItem],
        }),
        storylines: [
          {
            storylineId: childStorylineId,
            title: "Agent Runtime Control Plane",
            memberItemIds: ["agent-runtime-control-plane"],
            status: "developing",
          },
        ],
      },
    ],
    {
      before: "2026-03-13T21:00:00.000Z",
    },
  );

  const parentStoryline = reconstructedStorylines.get(parentStorylineId);
  const childStoryline = reconstructedStorylines.get(childStorylineId);

  assert.deepEqual(parentStoryline.childStorylineIds, [childStorylineId]);
  assert.deepEqual(childStoryline.parentStorylineIds, [parentStorylineId]);
});

test("buildEditionStorylines preserves merge lineage from source storylines that only record merged_into_storyline_id", () => {
  const runtimeStorylineId = "storyline-artifact-agent-runtime-rollout";
  const sandboxStorylineId = "storyline-artifact-agent-sandbox-hardening";
  const convergedStorylineId = "storyline-artifact-agent-platform-control-plane";
  const convergedItem = buildStorylineItem({
    itemId: "agent-platform-control-plane",
    name: "Agent Platform Control Plane",
    sourceUrl: "https://example.com/agent-platform-control-plane",
    discoveredAt: "2026-03-12T20:20:00.000Z",
    topic: "agent platform control plane",
    storylineMetadata: {
      storyline_id: convergedStorylineId,
      title: "Agent Platform Control Plane",
      member_item_ids: ["agent-platform-control-plane"],
      status: "stable",
      updated_at: "2026-03-12T21:00:00.000Z",
      last_evolution_at: "2026-03-12T21:00:00.000Z",
      evolution_count: 2,
    },
  });

  const [convergedStoryline] = buildEditionStorylines(
    [convergedItem],
    new Map([
      [
        runtimeStorylineId,
        {
          id: runtimeStorylineId,
          title: "Agent Runtime rollout",
          status: "archived",
          memberItemIds: ["agent-runtime-core"],
          firstSeen: "2026-03-10T20:00:00.000Z",
          lastSeen: "2026-03-10T20:00:00.000Z",
          updatedAt: "2026-03-12T21:00:00.000Z",
          lastEvolutionAt: "2026-03-10T21:00:00.000Z",
          evolutionCount: 2,
          repetitionCount: 0,
          repetitionStreak: 0,
          mergedIntoStorylineId: convergedStorylineId,
        },
      ],
      [
        sandboxStorylineId,
        {
          id: sandboxStorylineId,
          title: "Agent Sandbox Hardening",
          status: "archived",
          memberItemIds: ["agent-sandbox-hardening"],
          firstSeen: "2026-03-11T20:00:00.000Z",
          lastSeen: "2026-03-11T20:00:00.000Z",
          updatedAt: "2026-03-12T21:00:00.000Z",
          lastEvolutionAt: "2026-03-11T21:00:00.000Z",
          evolutionCount: 1,
          repetitionCount: 0,
          repetitionStreak: 0,
          mergedIntoStorylineId: convergedStorylineId,
        },
      ],
      [
        convergedStorylineId,
        {
          id: convergedStorylineId,
          title: "Agent Platform Control Plane",
          status: "stable",
          memberItemIds: [],
          firstSeen: "2026-03-12T20:20:00.000Z",
          lastSeen: "2026-03-12T20:20:00.000Z",
          updatedAt: "2026-03-12T21:00:00.000Z",
          lastEvolutionAt: "2026-03-12T21:00:00.000Z",
          evolutionCount: 2,
          repetitionCount: 0,
          repetitionStreak: 0,
        },
      ],
    ]),
  );

  assert.equal(convergedStoryline.storylineId, convergedStorylineId);
  assert.deepEqual(convergedStoryline.parentStorylineIds.sort(), [
    runtimeStorylineId,
    sandboxStorylineId,
  ]);
  assert.deepEqual(convergedStoryline.mergedStorylineIds.sort(), [
    runtimeStorylineId,
    sandboxStorylineId,
  ]);
});

test("buildTrackedStorylineStatesFromEditions honors explicit merge metadata when narratives converge", () => {
  const runtimeCore = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-10T20:00:00.000Z",
    topic: "agent runtime rollout",
  });
  const sandboxHardening = buildStorylineItem({
    itemId: "agent-sandbox-hardening",
    name: "Agent Sandbox Hardening",
    sourceUrl: "https://example.com/agent-sandbox-hardening",
    discoveredAt: "2026-03-11T20:00:00.000Z",
    topic: "agent sandbox hardening",
  });
  const convergedStorylineId = resolveStorylineId(
    buildStorylineItem({
      itemId: "agent-runtime-core",
      name: "Agent Platform Control Plane",
      sourceUrl: "https://example.com/agent-platform-control-plane",
      discoveredAt: "2026-03-12T20:10:00.000Z",
      topic: "agent platform control plane",
    }),
  );
  const convergedRuntime = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Platform Control Plane",
    sourceUrl: "https://example.com/agent-platform-control-plane",
    discoveredAt: "2026-03-12T20:10:00.000Z",
    topic: "agent platform control plane",
    storylineMetadata: {
      storyline_id: convergedStorylineId,
      previous_storyline_id: resolveStorylineId(runtimeCore),
    },
  });
  const convergedSandbox = buildStorylineItem({
    itemId: "agent-sandbox-hardening",
    name: "Agent Platform Safety Controls",
    sourceUrl: "https://example.com/agent-platform-safety-controls",
    discoveredAt: "2026-03-12T20:20:00.000Z",
    topic: "agent platform control plane",
    storylineMetadata: {
      storyline_id: convergedStorylineId,
      previous_storyline_id: resolveStorylineId(sandboxHardening),
    },
  });
  const runtimeStorylineId = resolveStorylineId(runtimeCore);
  const sandboxStorylineId = resolveStorylineId(sandboxHardening);
  const trackedStorylines = new Map([
    [
      runtimeStorylineId,
      {
        id: runtimeStorylineId,
        title: runtimeCore.name,
        status: "stable",
        memberItemIds: [runtimeCore.itemId],
        firstSeen: runtimeCore.firstSeen,
        lastSeen: runtimeCore.discoveredAt,
        updatedAt: "2026-03-10T21:00:00.000Z",
        lastEvolutionAt: "2026-03-10T21:00:00.000Z",
        evolutionCount: 2,
        repetitionCount: 0,
        repetitionStreak: 0,
      },
    ],
    [
      sandboxStorylineId,
      {
        id: sandboxStorylineId,
        title: sandboxHardening.name,
        status: "stable",
        memberItemIds: [sandboxHardening.itemId],
        firstSeen: sandboxHardening.firstSeen,
        lastSeen: sandboxHardening.discoveredAt,
        updatedAt: "2026-03-11T21:00:00.000Z",
        lastEvolutionAt: "2026-03-11T21:00:00.000Z",
        evolutionCount: 2,
        repetitionCount: 0,
        repetitionStreak: 0,
      },
    ],
  ]);

  const annotatedItems = applyStorylineMembership(
    [convergedRuntime, convergedSandbox],
    trackedStorylines,
    "2026-03-12T21:00:00.000Z",
  );
  const convergedStorylines = buildEditionStorylines(annotatedItems, trackedStorylines);
  const reconstructedStorylines = buildTrackedStorylineStatesFromEditions(
    [
      buildEdition({
        publishedAt: "2026-03-10T21:00:00.000Z",
        startsAt: "2026-03-09T21:00:00.000Z",
        items: [runtimeCore],
      }),
      buildEdition({
        publishedAt: "2026-03-11T21:00:00.000Z",
        startsAt: "2026-03-10T21:00:00.000Z",
        items: [sandboxHardening],
      }),
      {
        ...buildEdition({
          publishedAt: "2026-03-12T21:00:00.000Z",
          startsAt: "2026-03-11T21:00:00.000Z",
          items: annotatedItems,
        }),
        storylines: convergedStorylines,
      },
    ],
    {
      before: "2026-03-13T21:00:00.000Z",
    },
  );
  const convergedStoryline = reconstructedStorylines.get(convergedStorylineId);
  const runtimeSourceStoryline = reconstructedStorylines.get(runtimeStorylineId);
  const sandboxSourceStoryline = reconstructedStorylines.get(sandboxStorylineId);

  assert.equal(convergedStorylines.length, 1);
  assert.ok(annotatedItems.every((item) => item.storylineId === convergedStorylineId));
  assert.deepEqual(
    [...annotatedItems[0].metadata.storyline.parent_storyline_ids].sort(),
    [runtimeStorylineId, sandboxStorylineId],
  );
  assert.deepEqual(
    [...annotatedItems[0].metadata.storyline.merged_storyline_ids].sort(),
    [runtimeStorylineId, sandboxStorylineId],
  );
  assert.ok(convergedStoryline);
  assert.deepEqual([...convergedStoryline.parentStorylineIds].sort(), [
    runtimeStorylineId,
    sandboxStorylineId,
  ]);
  assert.deepEqual([...convergedStoryline.mergedStorylineIds].sort(), [
    runtimeStorylineId,
    sandboxStorylineId,
  ]);
  assert.equal(runtimeSourceStoryline.status, "archived");
  assert.equal(runtimeSourceStoryline.mergedIntoStorylineId, convergedStorylineId);
  assert.equal(sandboxSourceStoryline.status, "archived");
  assert.equal(sandboxSourceStoryline.mergedIntoStorylineId, convergedStorylineId);
});

test("buildTrackedStorylineStatesFromEditions archives merged source storylines when narratives converge", () => {
  const runtimeCore = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-10T20:00:00.000Z",
    topic: "agent runtime rollout",
  });
  const sandboxHardening = buildStorylineItem({
    itemId: "agent-sandbox-hardening",
    name: "Agent Sandbox Hardening",
    sourceUrl: "https://example.com/agent-sandbox-hardening",
    discoveredAt: "2026-03-11T20:00:00.000Z",
    topic: "agent sandbox hardening",
  });
  const convergedRuntime = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Platform Control Plane",
    sourceUrl: "https://example.com/agent-platform-control-plane",
    discoveredAt: "2026-03-12T20:10:00.000Z",
    topic: "agent platform control plane",
  });
  const convergedSandbox = buildStorylineItem({
    itemId: "agent-sandbox-hardening",
    name: "Agent Platform Safety Controls",
    sourceUrl: "https://example.com/agent-platform-safety-controls",
    discoveredAt: "2026-03-12T20:20:00.000Z",
    topic: "agent platform control plane",
  });
  const runtimeStorylineId = resolveStorylineId(runtimeCore);
  const sandboxStorylineId = resolveStorylineId(sandboxHardening);
  const convergedStorylineId = resolveStorylineId(convergedRuntime);
  const trackedStorylines = new Map([
    [
      runtimeStorylineId,
      {
        id: runtimeStorylineId,
        title: runtimeCore.name,
        status: "stable",
        memberItemIds: [runtimeCore.itemId],
        firstSeen: runtimeCore.firstSeen,
        lastSeen: runtimeCore.discoveredAt,
        updatedAt: "2026-03-10T21:00:00.000Z",
        lastEvolutionAt: "2026-03-10T21:00:00.000Z",
        evolutionCount: 2,
        repetitionCount: 0,
        repetitionStreak: 0,
      },
    ],
    [
      sandboxStorylineId,
      {
        id: sandboxStorylineId,
        title: sandboxHardening.name,
        status: "developing",
        memberItemIds: [sandboxHardening.itemId],
        firstSeen: sandboxHardening.firstSeen,
        lastSeen: sandboxHardening.discoveredAt,
        updatedAt: "2026-03-11T21:00:00.000Z",
        lastEvolutionAt: "2026-03-11T21:00:00.000Z",
        evolutionCount: 1,
        repetitionCount: 0,
        repetitionStreak: 0,
      },
    ],
  ]);
  const trackedItemStates = new Map([
    [
      runtimeCore.itemId,
      {
        firstSeen: runtimeCore.firstSeen,
        editionCount: 1,
        storylineId: runtimeStorylineId,
        item: runtimeCore,
      },
    ],
    [
      sandboxHardening.itemId,
      {
        firstSeen: sandboxHardening.firstSeen,
        editionCount: 1,
        storylineId: sandboxStorylineId,
        item: sandboxHardening,
      },
    ],
  ]);

  const annotatedItems = applyStorylineMembership(
    [convergedRuntime, convergedSandbox],
    trackedStorylines,
    "2026-03-12T21:00:00.000Z",
    trackedItemStates,
  );
  const convergedStorylines = buildEditionStorylines(annotatedItems, trackedStorylines);
  const reconstructedStorylines = buildTrackedStorylineStatesFromEditions(
    [
      buildEdition({
        publishedAt: "2026-03-10T21:00:00.000Z",
        startsAt: "2026-03-09T21:00:00.000Z",
        items: [runtimeCore],
      }),
      buildEdition({
        publishedAt: "2026-03-11T21:00:00.000Z",
        startsAt: "2026-03-10T21:00:00.000Z",
        items: [sandboxHardening],
      }),
      {
        ...buildEdition({
          publishedAt: "2026-03-12T21:00:00.000Z",
          startsAt: "2026-03-11T21:00:00.000Z",
          items: annotatedItems,
        }),
        storylines: convergedStorylines,
      },
    ],
    {
      before: "2026-03-13T21:00:00.000Z",
    },
  );
  const convergedStoryline = reconstructedStorylines.get(convergedStorylineId);
  const runtimeSourceStoryline = reconstructedStorylines.get(runtimeStorylineId);
  const sandboxSourceStoryline = reconstructedStorylines.get(sandboxStorylineId);

  assert.ok(convergedStoryline);
  assert.deepEqual(convergedStoryline.parentStorylineIds.sort(), [
    runtimeStorylineId,
    sandboxStorylineId,
  ]);
  assert.deepEqual(convergedStoryline.mergedStorylineIds.sort(), [
    runtimeStorylineId,
    sandboxStorylineId,
  ]);
  assert.deepEqual(convergedStoryline.memberItemIds, [
    "agent-runtime-core",
    "agent-sandbox-hardening",
  ]);
  assert.equal(runtimeSourceStoryline.status, "archived");
  assert.equal(runtimeSourceStoryline.mergedIntoStorylineId, convergedStorylineId);
  assert.equal(sandboxSourceStoryline.status, "archived");
  assert.equal(sandboxSourceStoryline.mergedIntoStorylineId, convergedStorylineId);
});

test("buildTrackedStorylineStatesFromEditions preserves merged storyline history across later editions", () => {
  const runtimeCore = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-10T20:00:00.000Z",
    topic: "agent runtime rollout",
  });
  const sandboxHardening = buildStorylineItem({
    itemId: "agent-sandbox-hardening",
    name: "Agent Sandbox Hardening",
    sourceUrl: "https://example.com/agent-sandbox-hardening",
    discoveredAt: "2026-03-11T20:00:00.000Z",
    topic: "agent sandbox hardening",
  });
  const convergedRuntime = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Platform Control Plane",
    sourceUrl: "https://example.com/agent-platform-control-plane",
    discoveredAt: "2026-03-12T20:10:00.000Z",
    topic: "agent platform control plane",
  });
  const convergedSandbox = buildStorylineItem({
    itemId: "agent-sandbox-hardening",
    name: "Agent Platform Safety Controls",
    sourceUrl: "https://example.com/agent-platform-safety-controls",
    discoveredAt: "2026-03-12T20:20:00.000Z",
    topic: "agent platform control plane",
  });
  const unrelatedMemory = buildStorylineItem({
    itemId: "agent-memory-router",
    name: "Agent Memory Router",
    sourceUrl: "https://example.com/agent-memory-router",
    discoveredAt: "2026-03-13T20:10:00.000Z",
    topic: "agent memory routing",
  });
  const runtimeStorylineId = resolveStorylineId(runtimeCore);
  const sandboxStorylineId = resolveStorylineId(sandboxHardening);
  const convergedStorylineId = resolveStorylineId(convergedRuntime);
  const trackedStorylines = new Map([
    [
      runtimeStorylineId,
      {
        id: runtimeStorylineId,
        title: runtimeCore.name,
        status: "stable",
        memberItemIds: [runtimeCore.itemId],
        firstSeen: runtimeCore.firstSeen,
        lastSeen: runtimeCore.discoveredAt,
        updatedAt: "2026-03-10T21:00:00.000Z",
        lastEvolutionAt: "2026-03-10T21:00:00.000Z",
        evolutionCount: 2,
        repetitionCount: 0,
        repetitionStreak: 0,
      },
    ],
    [
      sandboxStorylineId,
      {
        id: sandboxStorylineId,
        title: sandboxHardening.name,
        status: "stable",
        memberItemIds: [sandboxHardening.itemId],
        firstSeen: sandboxHardening.firstSeen,
        lastSeen: sandboxHardening.discoveredAt,
        updatedAt: "2026-03-11T21:00:00.000Z",
        lastEvolutionAt: "2026-03-11T21:00:00.000Z",
        evolutionCount: 2,
        repetitionCount: 0,
        repetitionStreak: 0,
      },
    ],
  ]);
  const trackedItemStates = new Map([
    [
      runtimeCore.itemId,
      {
        firstSeen: runtimeCore.firstSeen,
        editionCount: 1,
        storylineId: runtimeStorylineId,
        item: runtimeCore,
      },
    ],
    [
      sandboxHardening.itemId,
      {
        firstSeen: sandboxHardening.firstSeen,
        editionCount: 1,
        storylineId: sandboxStorylineId,
        item: sandboxHardening,
      },
    ],
  ]);

  const annotatedItems = applyStorylineMembership(
    [convergedRuntime, convergedSandbox],
    trackedStorylines,
    "2026-03-12T21:00:00.000Z",
    trackedItemStates,
  );
  const convergedStorylines = buildEditionStorylines(annotatedItems, trackedStorylines);
  const reconstructedStorylines = buildTrackedStorylineStatesFromEditions(
    [
      buildEdition({
        publishedAt: "2026-03-10T21:00:00.000Z",
        startsAt: "2026-03-09T21:00:00.000Z",
        items: [runtimeCore],
      }),
      buildEdition({
        publishedAt: "2026-03-11T21:00:00.000Z",
        startsAt: "2026-03-10T21:00:00.000Z",
        items: [sandboxHardening],
      }),
      {
        ...buildEdition({
          publishedAt: "2026-03-12T21:00:00.000Z",
          startsAt: "2026-03-11T21:00:00.000Z",
          items: annotatedItems,
        }),
        storylines: convergedStorylines,
      },
      buildEdition({
        publishedAt: "2026-03-13T21:00:00.000Z",
        startsAt: "2026-03-12T21:00:00.000Z",
        items: [unrelatedMemory],
      }),
    ],
    {
      before: "2026-03-14T21:00:00.000Z",
    },
  );
  const convergedStoryline = reconstructedStorylines.get(convergedStorylineId);
  const runtimeSourceStoryline = reconstructedStorylines.get(runtimeStorylineId);
  const sandboxSourceStoryline = reconstructedStorylines.get(sandboxStorylineId);

  assert.ok(convergedStoryline);
  assert.deepEqual(convergedStoryline.parentStorylineIds.sort(), [
    runtimeStorylineId,
    sandboxStorylineId,
  ]);
  assert.deepEqual(convergedStoryline.mergedStorylineIds.sort(), [
    runtimeStorylineId,
    sandboxStorylineId,
  ]);
  assert.equal(runtimeSourceStoryline.status, "archived");
  assert.equal(runtimeSourceStoryline.updatedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(runtimeSourceStoryline.lastEvolutionAt, "2026-03-10T21:00:00.000Z");
  assert.deepEqual(runtimeSourceStoryline.childStorylineIds, [convergedStorylineId]);
  assert.equal(runtimeSourceStoryline.mergedIntoStorylineId, convergedStorylineId);
  assert.equal(sandboxSourceStoryline.status, "archived");
  assert.equal(sandboxSourceStoryline.updatedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(sandboxSourceStoryline.lastEvolutionAt, "2026-03-11T21:00:00.000Z");
  assert.deepEqual(sandboxSourceStoryline.childStorylineIds, [convergedStorylineId]);
  assert.equal(sandboxSourceStoryline.mergedIntoStorylineId, convergedStorylineId);
});

test(
  "buildStorylineMembershipSnapshot reassigns post-merge related coverage onto the surviving storyline",
  () => {
    const runtimeStorylineId = "storyline-artifact-agent-runtime-rollout";
    const sandboxStorylineId = "storyline-artifact-agent-sandbox-hardening";
    const convergedStorylineId = "storyline-artifact-agent-platform-control";
    const postMergeItem = buildStorylineItem({
      itemId: "agent-runtime-deploy",
      name: "Agent Runtime Deploy",
      sourceUrl: "https://example.com/agent-runtime-deploy",
      discoveredAt: "2026-03-13T20:30:00.000Z",
      topic: "agent runtime rollout",
      summary:
        "Deployment workflow extends the merged Agent Platform control-plane narrative.",
      integrationHint: "Review the deployment workflow before rollout.",
    });

    const snapshot = buildStorylineMembershipSnapshot(
      [postMergeItem],
      new Map([
        [
          runtimeStorylineId,
          {
            id: runtimeStorylineId,
            title: "Agent Runtime rollout",
            status: "archived",
            memberItemIds: ["agent-runtime-core"],
            childStorylineIds: [convergedStorylineId],
            mergedIntoStorylineId: convergedStorylineId,
            firstSeen: "2026-03-10T20:00:00.000Z",
            lastSeen: "2026-03-10T20:00:00.000Z",
            updatedAt: "2026-03-12T21:00:00.000Z",
            lastEvolutionAt: "2026-03-10T21:00:00.000Z",
            evolutionCount: 2,
            repetitionCount: 0,
            repetitionStreak: 0,
          },
        ],
        [
          sandboxStorylineId,
          {
            id: sandboxStorylineId,
            title: "Agent Sandbox Hardening",
            status: "archived",
            memberItemIds: ["agent-sandbox-hardening"],
            childStorylineIds: [convergedStorylineId],
            mergedIntoStorylineId: convergedStorylineId,
            firstSeen: "2026-03-11T20:00:00.000Z",
            lastSeen: "2026-03-11T20:00:00.000Z",
            updatedAt: "2026-03-12T21:00:00.000Z",
            lastEvolutionAt: "2026-03-11T21:00:00.000Z",
            evolutionCount: 2,
            repetitionCount: 0,
            repetitionStreak: 0,
          },
        ],
        [
          convergedStorylineId,
          {
            id: convergedStorylineId,
            title: "Agent Platform Control Plane",
            status: "stable",
            memberItemIds: [
              "agent-runtime-core",
              "agent-sandbox-hardening",
            ],
            parentStorylineIds: [runtimeStorylineId, sandboxStorylineId],
            mergedStorylineIds: [runtimeStorylineId, sandboxStorylineId],
            firstSeen: "2026-03-10T20:00:00.000Z",
            lastSeen: "2026-03-12T20:20:00.000Z",
            updatedAt: "2026-03-12T21:00:00.000Z",
            lastEvolutionAt: "2026-03-12T21:00:00.000Z",
            evolutionCount: 3,
            repetitionCount: 0,
            repetitionStreak: 0,
          },
        ],
      ]),
      "2026-03-13T21:00:00.000Z",
    );
    const [annotatedItem] = snapshot.items;
    const [storyline] = snapshot.storylines;

    assert.equal(annotatedItem.storylineId, convergedStorylineId);
    assert.equal(annotatedItem.storylineMemberPosition, 3);
    assert.deepEqual(annotatedItem.metadata.storyline.member_item_ids, [
      "agent-runtime-core",
      "agent-sandbox-hardening",
      "agent-runtime-deploy",
    ]);
    assert.deepEqual(
      [...annotatedItem.metadata.storyline.merged_storyline_ids].sort(),
      [runtimeStorylineId, sandboxStorylineId],
    );
    assert.equal(snapshot.storylines.length, 1);
    assert.equal(storyline.storylineId, convergedStorylineId);
    assert.deepEqual(storyline.memberItemIds, [
      "agent-runtime-core",
      "agent-sandbox-hardening",
      "agent-runtime-deploy",
    ]);
  },
);

test("applyStorylineMembership treats same-topic recap from a new item id as repetition", () => {
  const recapItem = buildStorylineItem({
    itemId: "agent-runtime-launch-thread",
    name: "Agent Runtime launch thread",
    sourceUrl: "https://blog.example.com/agent-runtime-launch-thread",
    discoveredAt: "2026-03-12T20:30:00.000Z",
    summary:
      "Agent Runtime adds browser sessions and approval policies for autonomous agents.",
    integrationHint:
      "Install the latest runtime release and turn on approval policies for browser sessions.",
  });
  const trackedStorylines = new Map([
    [
      "storyline-artifact-agent-runtime-rollout",
      {
        id: "storyline-artifact-agent-runtime-rollout",
        title: "Agent Runtime rollout",
        status: "stable",
        memberItemIds: ["agent-runtime-core"],
        firstSeen: "2026-03-10T20:00:00.000Z",
        lastSeen: "2026-03-11T20:00:00.000Z",
        updatedAt: "2026-03-11T21:00:00.000Z",
        lastEvolutionAt: "2026-03-11T21:00:00.000Z",
        evolutionCount: 2,
        repetitionCount: 0,
        repetitionStreak: 0,
      },
    ],
  ]);
  const trackedItemStates = new Map([
    [
      "agent-runtime-core",
      {
        firstSeen: "2026-03-10T20:00:00.000Z",
        editionCount: 1,
        item: createNormalizedItem({
          itemId: "agent-runtime-core",
          name: "Agent Runtime Core",
          sourceUrl: "https://github.com/acme/agent-runtime",
          category: "library",
          summary:
            "Agent Runtime adds browser sessions and approval policies for autonomous agents.",
          integrationHint:
            "Upgrade agent-runtime and enable browser sessions with approval policies.",
          relevanceScore: 84,
          sourceKinds: ["github"],
          adapterIds: ["github"],
          sourceAuthorityScore: 91,
          discoveredAt: "2026-03-11T20:00:00.000Z",
          metadata: {
            topic: "agent runtime rollout",
          },
        }),
      },
    ],
  ]);

  const [annotatedItem] = applyStorylineMembership(
    [recapItem],
    trackedStorylines,
    "2026-03-12T21:00:00.000Z",
    trackedItemStates,
  );

  assert.equal(annotatedItem.metadata.storyline.relationship.decision, "repetition");
  assert.equal(annotatedItem.storylineMemberPosition, null);
  assert.deepEqual(annotatedItem.metadata.storyline.member_item_ids, [
    "agent-runtime-core",
  ]);
  assert.equal(annotatedItem.metadata.storyline.evolution_count, 2);
  assert.equal(annotatedItem.metadata.storyline.repetition_count, 1);
  assert.equal(annotatedItem.metadata.storyline.repetition_streak, 1);
});

test("buildTrackedStorylineStatesFromEditions keeps repetition-only recap items out of storyline members", () => {
  const storylineId = "storyline-artifact-agent-runtime-rollout";
  const recapItem = buildStorylineItem({
    itemId: "agent-runtime-launch-thread",
    name: "Agent Runtime launch thread",
    sourceUrl: "https://blog.example.com/agent-runtime-launch-thread",
    discoveredAt: "2026-03-12T20:30:00.000Z",
    summary:
      "Agent Runtime adds browser sessions and approval policies for autonomous agents.",
    integrationHint:
      "Install the latest runtime release and turn on approval policies for browser sessions.",
    storylineMetadata: {
      storyline_id: storylineId,
      title: "Agent Runtime rollout",
      status: "stable",
      member_item_ids: ["agent-runtime-core"],
      first_seen: "2026-03-10T20:00:00.000Z",
      last_seen: "2026-03-12T20:30:00.000Z",
      updated_at: "2026-03-12T21:00:00.000Z",
      last_evolution_at: "2026-03-11T21:00:00.000Z",
      evolution_count: 2,
      repetition_count: 1,
      repetition_streak: 1,
      relationship: {
        decision: "repetition",
      },
    },
  });

  const trackedStorylines = buildTrackedStorylineStatesFromEditions(
    [
      {
        ...buildEdition({
          publishedAt: "2026-03-12T21:00:00.000Z",
          startsAt: "2026-03-11T21:00:00.000Z",
          items: [recapItem],
        }),
        storylines: [
          {
            storylineId,
            title: "Agent Runtime rollout",
            memberItemIds: ["agent-runtime-core"],
            status: "stable",
            updatedAt: "2026-03-12T21:00:00.000Z",
            lastEvolutionAt: "2026-03-11T21:00:00.000Z",
            evolutionCount: 2,
            repetitionCount: 1,
            repetitionStreak: 1,
          },
        ],
      },
    ],
    {
      before: "2026-03-13T21:00:00.000Z",
    },
  );
  const storyline = trackedStorylines.get(storylineId);

  assert.ok(storyline);
  assert.deepEqual(storyline.memberItemIds, ["agent-runtime-core"]);
  assert.equal(storyline.repetitionCount, 1);
  assert.equal(storyline.repetitionStreak, 1);
  assert.equal(storyline.appearanceHistory.length, 1);
});

test("applyStorylineMembership compares new storyline items against older storyline appearances across editions", () => {
  const firstAppearance = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-10T20:00:00.000Z",
    summary:
      "Agent Runtime adds browser sessions and approval policies for autonomous agents.",
    integrationHint:
      "Upgrade agent-runtime and enable browser sessions with approval policies.",
  });
  const secondAppearance = buildStorylineItem({
    itemId: "agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://docs.acme.dev/agent-runtime/evaluation-loop",
    discoveredAt: "2026-03-11T20:00:00.000Z",
    firstSeen: "2026-03-10T20:00:00.000Z",
    editionCount: 2,
    summary:
      "Agent Runtime now adds evaluation loops and resumable memory for autonomous workflows.",
    integrationHint:
      "Upgrade to the latest runtime release and enable the evaluation and memory modules.",
  });
  const recapItem = buildStorylineItem({
    itemId: "agent-runtime-approval-recap",
    name: "Agent Runtime approval policy recap",
    sourceUrl: "https://blog.example.com/agent-runtime-approval-recap",
    discoveredAt: "2026-03-12T20:30:00.000Z",
    summary:
      "Agent Runtime adds browser sessions and approval policies for autonomous agents.",
    integrationHint:
      "Install the latest runtime release and turn on approval policies for browser sessions.",
  });
  const trackedStorylines = buildTrackedStorylineStatesFromEditions(
    [
      buildEdition({
        publishedAt: "2026-03-10T21:00:00.000Z",
        startsAt: "2026-03-09T21:00:00.000Z",
        items: [firstAppearance],
      }),
      buildEdition({
        publishedAt: "2026-03-11T21:00:00.000Z",
        startsAt: "2026-03-10T21:00:00.000Z",
        items: [secondAppearance],
      }),
    ],
    {
      before: "2026-03-13T21:00:00.000Z",
    },
  );
  const storylineId = resolveStorylineId(firstAppearance);
  const trackedItemStates = new Map([
    [
      firstAppearance.itemId,
      {
        firstSeen: firstAppearance.firstSeen,
        editionCount: 2,
        storylineId,
        publishedAt: "2026-03-11T21:00:00.000Z",
        item: secondAppearance,
      },
    ],
  ]);

  const [annotatedItem] = applyStorylineMembership(
    [recapItem],
    trackedStorylines,
    "2026-03-12T21:00:00.000Z",
    trackedItemStates,
  );

  assert.equal(annotatedItem.storylineId, storylineId);
  assert.equal(annotatedItem.metadata.storyline.relationship.decision, "repetition");
  assert.equal(annotatedItem.metadata.storyline.relationship.priorAppearanceCount, 2);
  assert.equal(annotatedItem.metadata.storyline.relationship.signals.novelFactCount, 0);
  assert.equal(
    annotatedItem.metadata.storyline.relationship.previousAppearance.sourceUrl,
    secondAppearance.sourceUrl,
  );
});
