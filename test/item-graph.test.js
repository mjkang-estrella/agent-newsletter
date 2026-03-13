import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStorylineMembershipSnapshot,
  buildTrackedStorylineStatesFromEditions,
  createNormalizedItem,
  resolveStorylineId,
  selectActiveStorylinesFromEditions,
} from "../src/index.js";

function buildItem({
  itemId,
  name,
  sourceUrl,
  discoveredAt,
  firstSeen = discoveredAt,
  editionCount = 1,
  category = "library",
  topic = "agent runtime rollout",
  sourceKinds = ["github"],
  adapterIds = ["github"],
  sourceAuthorityScore = 91,
  summary = `${name} helps autonomous agents extend a production runtime safely.`,
  integrationHint = `Review ${name} before enabling it in production.`,
  canonicalIdentifiers = null,
  storylineMetadata = null,
}) {
  return createNormalizedItem({
    itemId,
    name,
    sourceUrl,
    category,
    summary,
    integrationHint,
    relevanceScore: 84,
    sourceKinds,
    adapterIds,
    sourceAuthorityScore,
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

function buildEdition({ id, publishedAt, startsAt, snapshot }) {
  return {
    id,
    publishedAt,
    window: {
      startsAt,
      endsAt: publishedAt,
      timezone: "UTC",
    },
    items: snapshot.items,
    storylines: snapshot.storylines,
  };
}

function buildTrackedItemState(item, { storylineId, publishedAt, editionCount = 1 }) {
  return {
    firstSeen: item.firstSeen ?? item.discoveredAt,
    editionCount,
    storylineId,
    item,
    publishedAt,
  };
}

test("item graph keeps a stable item identity on one storyline node across repeated sightings", () => {
  const firstPublishedAt = "2026-03-10T21:00:00.000Z";
  const secondPublishedAt = "2026-03-11T21:00:00.000Z";
  const thirdPublishedAt = "2026-03-12T21:00:00.000Z";
  const runtimeCore = buildItem({
    itemId: "artifact-agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-10T20:15:00.000Z",
    canonicalIdentifiers: {
      entityName: "Agent Runtime",
      repositoryUrl: "https://github.com/acme/agent-runtime",
      doi: null,
      sourceIds: {
        github: "acme/agent-runtime",
      },
    },
  });
  const firstSnapshot = buildStorylineMembershipSnapshot(
    [runtimeCore],
    new Map(),
    firstPublishedAt,
  );
  const firstEdition = buildEdition({
    id: "2026-03-10",
    publishedAt: firstPublishedAt,
    startsAt: "2026-03-09T21:00:00.000Z",
    snapshot: firstSnapshot,
  });
  const storylineId = firstSnapshot.storylines[0].storylineId;
  const resurfacedRuntime = buildItem({
    itemId: runtimeCore.itemId,
    name: "Agent Runtime rollout thread",
    sourceUrl: "https://x.com/acme/status/123",
    discoveredAt: "2026-03-11T20:20:00.000Z",
    firstSeen: runtimeCore.firstSeen,
    editionCount: 2,
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 76,
  });
  const secondSnapshot = buildStorylineMembershipSnapshot(
    [resurfacedRuntime],
    buildTrackedStorylineStatesFromEditions([firstEdition], {
      before: secondPublishedAt,
    }),
    secondPublishedAt,
    new Map([
      [
        runtimeCore.itemId,
        buildTrackedItemState(firstSnapshot.items[0], {
          storylineId,
          publishedAt: firstPublishedAt,
        }),
      ],
    ]),
  );
  const secondEdition = buildEdition({
    id: "2026-03-11",
    publishedAt: secondPublishedAt,
    startsAt: "2026-03-10T21:00:00.000Z",
    snapshot: secondSnapshot,
  });
  const runtimeCloud = buildItem({
    itemId: "artifact-agent-runtime-cloud",
    name: "Agent Runtime Cloud",
    sourceUrl: "https://example.com/agent-runtime-cloud",
    discoveredAt: "2026-03-12T20:30:00.000Z",
    summary: "Managed hosting extends the Agent Runtime deployment story.",
    integrationHint: "Review the hosted control plane before adoption.",
    canonicalIdentifiers: {
      entityName: "Agent Runtime",
      repositoryUrl: null,
      doi: null,
      sourceIds: {},
    },
  });
  const thirdSnapshot = buildStorylineMembershipSnapshot(
    [runtimeCloud],
    buildTrackedStorylineStatesFromEditions([firstEdition, secondEdition], {
      before: thirdPublishedAt,
    }),
    thirdPublishedAt,
  );
  const thirdEdition = buildEdition({
    id: "2026-03-12",
    publishedAt: thirdPublishedAt,
    startsAt: "2026-03-11T21:00:00.000Z",
    snapshot: thirdSnapshot,
  });

  assert.equal(secondSnapshot.items[0].itemId, runtimeCore.itemId);
  assert.equal(secondSnapshot.items[0].storylineId, storylineId);
  assert.equal(secondSnapshot.items[0].storylineMemberPosition, 1);

  const trackedStorylines = buildTrackedStorylineStatesFromEditions(
    [firstEdition, secondEdition, thirdEdition],
    {
      before: "2026-03-13T21:00:00.000Z",
    },
  );
  const activeStorylines = selectActiveStorylinesFromEditions(
    [firstEdition, secondEdition, thirdEdition],
    {
      now: "2026-03-13T21:00:00.000Z",
    },
  );
  const activeStoryline = activeStorylines.find(
    (storyline) => storyline.storylineId === storylineId,
  );

  assert.ok(activeStoryline);
  assert.deepEqual(trackedStorylines.get(storylineId).memberItemIds, [
    runtimeCore.itemId,
    runtimeCloud.itemId,
  ]);
  assert.equal(trackedStorylines.get(storylineId).firstSeen, runtimeCore.firstSeen);
  assert.equal(trackedStorylines.get(storylineId).lastSeen, runtimeCloud.discoveredAt);
  assert.deepEqual(activeStoryline.memberItemIds, [
    runtimeCore.itemId,
    runtimeCloud.itemId,
  ]);
  assert.equal(activeStoryline.items[0].sourceUrl, resurfacedRuntime.sourceUrl);
  assert.equal(activeStoryline.items[1].sourceUrl, runtimeCloud.sourceUrl);
});

test("item graph preserves parent and child lineage when a recurring item forks into a new storyline", () => {
  const firstPublishedAt = "2026-03-10T21:00:00.000Z";
  const secondPublishedAt = "2026-03-11T21:00:00.000Z";
  const runtimeCore = buildItem({
    itemId: "artifact-agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-10T20:15:00.000Z",
  });
  const firstSnapshot = buildStorylineMembershipSnapshot(
    [runtimeCore],
    new Map(),
    firstPublishedAt,
  );
  const firstEdition = buildEdition({
    id: "2026-03-10",
    publishedAt: firstPublishedAt,
    startsAt: "2026-03-09T21:00:00.000Z",
    snapshot: firstSnapshot,
  });
  const parentStorylineId = firstSnapshot.storylines[0].storylineId;
  const divergedRuntime = buildItem({
    itemId: runtimeCore.itemId,
    name: "Agent Runtime Control Plane",
    sourceUrl: "https://example.com/agent-runtime-control-plane",
    discoveredAt: "2026-03-11T20:40:00.000Z",
    firstSeen: runtimeCore.firstSeen,
    editionCount: 2,
    topic: "agent runtime control plane",
  });
  const secondSnapshot = buildStorylineMembershipSnapshot(
    [divergedRuntime],
    buildTrackedStorylineStatesFromEditions([firstEdition], {
      before: secondPublishedAt,
    }),
    secondPublishedAt,
    new Map([
      [
        runtimeCore.itemId,
        buildTrackedItemState(firstSnapshot.items[0], {
          storylineId: parentStorylineId,
          publishedAt: firstPublishedAt,
        }),
      ],
    ]),
  );
  const secondEdition = buildEdition({
    id: "2026-03-11",
    publishedAt: secondPublishedAt,
    startsAt: "2026-03-10T21:00:00.000Z",
    snapshot: secondSnapshot,
  });
  const childStorylineId = resolveStorylineId(divergedRuntime);
  const trackedStorylines = buildTrackedStorylineStatesFromEditions(
    [firstEdition, secondEdition],
    {
      before: "2026-03-12T21:00:00.000Z",
    },
  );
  const activeStorylineIds = selectActiveStorylinesFromEditions(
    [firstEdition, secondEdition],
    {
      now: "2026-03-12T21:00:00.000Z",
    },
  )
    .map((storyline) => storyline.storylineId)
    .sort();

  assert.deepEqual(trackedStorylines.get(parentStorylineId).memberItemIds, [
    runtimeCore.itemId,
  ]);
  assert.deepEqual(trackedStorylines.get(parentStorylineId).childStorylineIds, [
    childStorylineId,
  ]);
  assert.deepEqual(trackedStorylines.get(childStorylineId).memberItemIds, [
    runtimeCore.itemId,
  ]);
  assert.deepEqual(trackedStorylines.get(childStorylineId).parentStorylineIds, [
    parentStorylineId,
  ]);
  assert.deepEqual(activeStorylineIds, [childStorylineId, parentStorylineId].sort());
});

test("item graph archives merged source storylines and keeps the converged storyline active", () => {
  const firstPublishedAt = "2026-03-10T21:00:00.000Z";
  const secondPublishedAt = "2026-03-11T21:00:00.000Z";
  const thirdPublishedAt = "2026-03-12T21:00:00.000Z";
  const runtimeSource = buildItem({
    itemId: "artifact-agent-runtime-core",
    name: "Agent Runtime Core",
    sourceUrl: "https://github.com/acme/agent-runtime",
    discoveredAt: "2026-03-10T20:10:00.000Z",
    topic: "agent runtime rollout",
  });
  const sandboxSource = buildItem({
    itemId: "artifact-agent-sandbox-hardening",
    name: "Agent Sandbox Hardening",
    sourceUrl: "https://example.com/agent-sandbox-hardening",
    discoveredAt: "2026-03-11T20:15:00.000Z",
    topic: "agent sandbox hardening",
    summary: "Hardening guide for tool-using agent sandboxes.",
    integrationHint: "Start in a staging environment before rollout.",
  });
  const firstEdition = buildEdition({
    id: "2026-03-10",
    publishedAt: firstPublishedAt,
    startsAt: "2026-03-09T21:00:00.000Z",
    snapshot: buildStorylineMembershipSnapshot([runtimeSource], new Map(), firstPublishedAt),
  });
  const secondEdition = buildEdition({
    id: "2026-03-11",
    publishedAt: secondPublishedAt,
    startsAt: "2026-03-10T21:00:00.000Z",
    snapshot: buildStorylineMembershipSnapshot([sandboxSource], new Map(), secondPublishedAt),
  });
  const runtimeStorylineId = firstEdition.storylines[0].storylineId;
  const sandboxStorylineId = secondEdition.storylines[0].storylineId;
  const convergedStorylineId = resolveStorylineId(
    buildItem({
      itemId: runtimeSource.itemId,
      name: "Agent Platform Control Plane",
      sourceUrl: "https://example.com/agent-platform-control-plane",
      discoveredAt: "2026-03-12T20:20:00.000Z",
      topic: "agent platform control plane",
    }),
  );
  const mergedSnapshot = buildStorylineMembershipSnapshot(
    [
      buildItem({
        itemId: runtimeSource.itemId,
        name: "Agent Platform Control Plane",
        sourceUrl: "https://example.com/agent-platform-control-plane",
        discoveredAt: "2026-03-12T20:20:00.000Z",
        topic: "agent platform control plane",
        storylineMetadata: {
          storyline_id: convergedStorylineId,
          previous_storyline_id: runtimeStorylineId,
        },
      }),
      buildItem({
        itemId: sandboxSource.itemId,
        name: "Agent Platform Safety Controls",
        sourceUrl: "https://example.com/agent-platform-safety-controls",
        discoveredAt: "2026-03-12T20:25:00.000Z",
        topic: "agent platform control plane",
        summary: "Safety controls absorb earlier sandbox hardening patterns.",
        integrationHint: "Review the unified control plane before adoption.",
        storylineMetadata: {
          storyline_id: convergedStorylineId,
          previous_storyline_id: sandboxStorylineId,
        },
      }),
    ],
    buildTrackedStorylineStatesFromEditions([firstEdition, secondEdition], {
      before: thirdPublishedAt,
    }),
    thirdPublishedAt,
  );
  const thirdEdition = buildEdition({
    id: "2026-03-12",
    publishedAt: thirdPublishedAt,
    startsAt: "2026-03-11T21:00:00.000Z",
    snapshot: mergedSnapshot,
  });
  const trackedStorylines = buildTrackedStorylineStatesFromEditions(
    [firstEdition, secondEdition, thirdEdition],
    {
      before: "2026-03-13T21:00:00.000Z",
    },
  );
  const activeStorylines = selectActiveStorylinesFromEditions(
    [firstEdition, secondEdition, thirdEdition],
    {
      now: "2026-03-13T21:00:00.000Z",
    },
  );
  const convergedStoryline = trackedStorylines.get(convergedStorylineId);

  assert.ok(convergedStoryline);
  assert.deepEqual(convergedStoryline.memberItemIds, [
    runtimeSource.itemId,
    sandboxSource.itemId,
  ]);
  assert.deepEqual([...convergedStoryline.mergedStorylineIds].sort(), [
    runtimeStorylineId,
    sandboxStorylineId,
  ]);
  assert.equal(trackedStorylines.get(runtimeStorylineId).mergedIntoStorylineId, convergedStorylineId);
  assert.equal(trackedStorylines.get(runtimeStorylineId).status, "archived");
  assert.equal(trackedStorylines.get(sandboxStorylineId).mergedIntoStorylineId, convergedStorylineId);
  assert.equal(trackedStorylines.get(sandboxStorylineId).status, "archived");
  assert.deepEqual(
    activeStorylines.map((storyline) => storyline.storylineId),
    [convergedStorylineId],
  );
});
