import test from "node:test";
import assert from "node:assert/strict";

import {
  annotateStorylineRelationship,
  buildHistoricalStorylineMap,
  classifyStorylineRelationship,
  createNormalizedItem,
} from "../src/index.js";

function buildItem({
  itemId = "persistent-agent-sdk-item",
  name = "Persistent Agent SDK",
  sourceUrl,
  sourceUrls = [sourceUrl],
  summary,
  integrationHint,
  discoveredAt = "2026-03-12T20:30:00.000Z",
}) {
  return createNormalizedItem({
    itemId,
    name,
    sourceUrl,
    sourceUrls,
    category: "tool",
    summary,
    integrationHint,
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 74,
    relevanceScore: 82,
    discoveredAt,
  });
}

function buildAppearance(day, item) {
  return {
    editionId: `2026-03-${String(day).padStart(2, "0")}`,
    publishedAt: `2026-03-${String(day).padStart(2, "0")}T21:00:00.000Z`,
    item,
  };
}

test("classifyStorylineRelationship marks the first appearance as an origin", () => {
  const item = buildItem({
    sourceUrl: "https://github.com/acme/agent-sdk",
    summary: "Agent SDK packages browser and shell tools for autonomous workflows.",
    integrationHint: "npm install agent-sdk",
  });

  const relationship = classifyStorylineRelationship(item, []);

  assert.deepEqual(relationship, {
    decision: "origin",
    explanation: "First appearance in this storyline.",
    priorAppearanceCount: 0,
    previousAppearance: null,
    signals: {
      factOverlapRatio: 0,
      novelFactCount: 0,
      novelTokenRatio: 0,
      newSourceClusterCount: 0,
    },
  });
});

test("classifyStorylineRelationship marks same-fact coverage from a new source as repetition", () => {
  const previousItem = buildItem({
    sourceUrl: "https://github.com/acme/agent-sdk",
    summary: "Agent SDK packages browser and shell tools for autonomous workflows.",
    integrationHint: "npm install agent-sdk and configure the browser and shell adapters.",
    discoveredAt: "2026-03-11T20:30:00.000Z",
  });
  const currentItem = buildItem({
    sourceUrl: "https://blog.example.com/agent-sdk-launch",
    summary: "Agent SDK packages browser and shell tools for autonomous workflows.",
    integrationHint: "Install agent-sdk, then enable the browser and shell adapters.",
  });

  const relationship = classifyStorylineRelationship(currentItem, [
    buildAppearance(11, previousItem),
  ]);

  assert.equal(relationship.decision, "repetition");
  assert.equal(relationship.priorAppearanceCount, 1);
  assert.equal(relationship.previousAppearance.editionId, "2026-03-11");
  assert.equal(relationship.signals.newSourceClusterCount, 1);
  assert.equal(relationship.signals.novelFactCount, 0);
});

test("classifyStorylineRelationship marks new developments in an existing storyline as evolution", () => {
  const previousItem = buildItem({
    sourceUrl: "https://github.com/acme/agent-sdk",
    summary: "Agent SDK packages browser and shell tools for autonomous workflows.",
    integrationHint: "npm install agent-sdk and configure the browser and shell adapters.",
    discoveredAt: "2026-03-11T20:30:00.000Z",
  });
  const currentItem = buildItem({
    sourceUrl: "https://docs.example.com/agent-sdk/evaluation-loop",
    summary:
      "Agent SDK now adds evaluation loops and resumable memory for autonomous workflows.",
    integrationHint:
      "Upgrade to the latest release and enable the evaluation and memory modules.",
  });

  const relationship = classifyStorylineRelationship(currentItem, [
    buildAppearance(11, previousItem),
  ]);

  assert.equal(relationship.decision, "evolution");
  assert.equal(relationship.priorAppearanceCount, 1);
  assert.ok(relationship.explanation.includes("Introduces"));
  assert.ok(relationship.signals.novelFactCount >= 1);
  assert.ok(relationship.signals.novelTokenRatio >= 0.18);
});

test("classifyStorylineRelationship ignores paraphrased rollout guidance when no material facts changed", () => {
  const previousItem = buildItem({
    itemId: "agent-runtime-item",
    name: "Agent Runtime",
    sourceUrl: "https://github.com/acme/agent-runtime",
    summary:
      "Agent Runtime adds browser sessions and approval policies for autonomous agents.",
    integrationHint:
      "Upgrade agent-runtime and enable browser sessions with approval policies.",
    discoveredAt: "2026-03-11T20:30:00.000Z",
  });
  const currentItem = buildItem({
    itemId: "agent-runtime-item",
    name: "Agent Runtime launch recap",
    sourceUrl: "https://blog.example.com/agent-runtime-recap",
    summary:
      "Agent Runtime adds browser sessions and approval policies for autonomous agents.",
    integrationHint:
      "Install the latest runtime release and turn on approval policies for browser sessions.",
  });

  const relationship = classifyStorylineRelationship(currentItem, [
    buildAppearance(11, previousItem),
  ]);

  assert.equal(relationship.decision, "repetition");
  assert.equal(relationship.signals.novelFactCount, 0);
  assert.ok(relationship.signals.novelTokenRatio < 0.18);
});

test("annotateStorylineRelationship stores the decision on item metadata", () => {
  const previousItem = buildItem({
    sourceUrl: "https://github.com/acme/agent-sdk",
    summary: "Agent SDK packages browser and shell tools for autonomous workflows.",
    integrationHint: "npm install agent-sdk and configure the browser and shell adapters.",
    discoveredAt: "2026-03-11T20:30:00.000Z",
  });
  const currentItem = buildItem({
    sourceUrl: "https://docs.example.com/agent-sdk/evaluation-loop",
    summary:
      "Agent SDK now adds evaluation loops and resumable memory for autonomous workflows.",
    integrationHint:
      "Upgrade to the latest release and enable the evaluation and memory modules.",
  });

  const annotatedItem = annotateStorylineRelationship(currentItem, [
    buildAppearance(11, previousItem),
  ]);

  assert.equal(annotatedItem.metadata.storyline.storylineId, "storyline-persistent-agent-sdk-item");
  assert.equal(annotatedItem.metadata.storyline.position, 2);
  assert.equal(annotatedItem.metadata.storyline.relationship.decision, "evolution");
});

test("buildHistoricalStorylineMap groups prior appearances by tracked item id", () => {
  const historicalItem = buildItem({
    sourceUrl: "https://github.com/acme/agent-sdk",
    summary: "Agent SDK packages browser and shell tools for autonomous workflows.",
    integrationHint: "npm install agent-sdk",
    discoveredAt: "2026-03-11T20:30:00.000Z",
  });

  const storylineMap = buildHistoricalStorylineMap([
    {
      id: "2026-03-11",
      publishedAt: "2026-03-11T21:00:00.000Z",
      items: [historicalItem],
    },
  ]);

  assert.equal(storylineMap.size, 1);
  assert.equal(
    storylineMap.get("persistent-agent-sdk-item")[0].item.itemId,
    "persistent-agent-sdk-item",
  );
});
