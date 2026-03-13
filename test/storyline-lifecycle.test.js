import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceStorylineLifecycle,
  applyStorylineMembership,
  createNormalizedItem,
} from "../src/index.js";

function buildItem({
  itemId = "agent-runtime-core",
  name = "Agent Runtime Core",
  sourceUrl = "https://github.com/acme/agent-runtime",
  discoveredAt = "2026-03-12T20:30:00.000Z",
  relationshipDecision = "repetition",
} = {}) {
  return createNormalizedItem({
    itemId,
    name,
    sourceUrl,
    category: "library",
    summary: `${name} helps autonomous agents extend the runtime rollout safely.`,
    integrationHint: `Review ${name} before enabling it in production.`,
    relevanceScore: 84,
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 91,
    discoveredAt,
    metadata: {
      topic: "agent runtime rollout",
      storyline: {
        relationship: {
          decision: relationshipDecision,
        },
      },
    },
  });
}

test("advanceStorylineLifecycle promotes a storyline to stable after continued evolution", () => {
  const lifecycle = advanceStorylineLifecycle(
    {
      status: "developing",
      evolutionCount: 1,
      repetitionCount: 0,
      repetitionStreak: 0,
      updatedAt: "2026-03-11T21:00:00.000Z",
      lastEvolutionAt: "2026-03-11T21:00:00.000Z",
    },
    {
      decision: "evolution",
      observedAt: "2026-03-12T21:00:00.000Z",
    },
  );

  assert.equal(lifecycle.status, "stable");
  assert.equal(lifecycle.evolutionCount, 2);
  assert.equal(lifecycle.repetitionStreak, 0);
  assert.equal(lifecycle.lastEvolutionAt, "2026-03-12T21:00:00.000Z");
});

test("advanceStorylineLifecycle archives a storyline after repeated repetition", () => {
  const lifecycle = advanceStorylineLifecycle(
    {
      status: "stable",
      evolutionCount: 2,
      repetitionCount: 1,
      repetitionStreak: 1,
      updatedAt: "2026-03-11T21:00:00.000Z",
      lastEvolutionAt: "2026-03-11T21:00:00.000Z",
    },
    {
      decision: "repetition",
      observedAt: "2026-03-12T21:00:00.000Z",
    },
  );

  assert.equal(lifecycle.status, "archived");
  assert.equal(lifecycle.repetitionCount, 2);
  assert.equal(lifecycle.repetitionStreak, 2);
});

test("advanceStorylineLifecycle archives stale storylines that only receive noise", () => {
  const lifecycle = advanceStorylineLifecycle(
    {
      status: "stable",
      evolutionCount: 2,
      repetitionCount: 0,
      repetitionStreak: 0,
      updatedAt: "2026-03-01T21:00:00.000Z",
      lastEvolutionAt: "2026-03-01T21:00:00.000Z",
    },
    {
      decision: "repetition",
      observedAt: "2026-03-12T21:00:00.000Z",
    },
  );

  assert.equal(lifecycle.status, "archived");
});

test("advanceStorylineLifecycle treats a fork as a developing evolutionary event", () => {
  const lifecycle = advanceStorylineLifecycle(
    {
      status: "stable",
      evolutionCount: 2,
      repetitionCount: 1,
      repetitionStreak: 1,
      updatedAt: "2026-03-11T21:00:00.000Z",
      lastEvolutionAt: "2026-03-11T21:00:00.000Z",
    },
    {
      decision: "fork",
      observedAt: "2026-03-12T21:00:00.000Z",
    },
  );

  assert.equal(lifecycle.status, "stable");
  assert.equal(lifecycle.evolutionCount, 3);
  assert.equal(lifecycle.repetitionStreak, 0);
  assert.equal(lifecycle.lastEvolutionAt, "2026-03-12T21:00:00.000Z");
});

test("advanceStorylineLifecycle archives source storylines when narratives merge", () => {
  const lifecycle = advanceStorylineLifecycle(
    {
      status: "stable",
      evolutionCount: 2,
      repetitionCount: 0,
      repetitionStreak: 0,
      updatedAt: "2026-03-11T21:00:00.000Z",
      lastEvolutionAt: "2026-03-11T21:00:00.000Z",
    },
    {
      decision: "merge",
      mergeDisposition: "source",
      observedAt: "2026-03-12T21:00:00.000Z",
    },
  );

  assert.equal(lifecycle.status, "archived");
  assert.equal(lifecycle.evolutionCount, 2);
  assert.equal(lifecycle.updatedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(lifecycle.lastEvolutionAt, "2026-03-11T21:00:00.000Z");
});

test("applyStorylineMembership stamps stable and archived statuses onto storyline metadata", () => {
  const evolvingItem = buildItem({
    itemId: "agent-runtime-memory",
    name: "Agent Runtime Memory Pack",
    sourceUrl: "https://github.com/acme/agent-runtime-memory",
    relationshipDecision: "evolution",
  });
  const archivedItem = buildItem({
    relationshipDecision: "repetition",
  });

  const [stableAnnotated] = applyStorylineMembership(
    [evolvingItem],
    new Map([
      [
        "storyline-artifact-agent-runtime-rollout",
        {
          id: "storyline-artifact-agent-runtime-rollout",
          title: "Agent Runtime Core",
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

  assert.equal(stableAnnotated.metadata.storyline.status, "stable");
  assert.equal(stableAnnotated.metadata.storyline.evolution_count, 2);

  const [archivedAnnotated] = applyStorylineMembership(
    [archivedItem],
    new Map([
      [
        "storyline-artifact-agent-runtime-rollout",
        {
          id: "storyline-artifact-agent-runtime-rollout",
          title: "Agent Runtime Core",
          status: "stable",
          memberItemIds: ["agent-runtime-core"],
          firstSeen: "2026-03-10T20:00:00.000Z",
          lastSeen: "2026-03-11T20:00:00.000Z",
          updatedAt: "2026-03-11T21:00:00.000Z",
          lastEvolutionAt: "2026-03-11T21:00:00.000Z",
          evolutionCount: 2,
          repetitionCount: 1,
          repetitionStreak: 1,
        },
      ],
    ]),
    "2026-03-12T21:00:00.000Z",
  );

  assert.equal(archivedAnnotated.metadata.storyline.status, "archived");
  assert.equal(archivedAnnotated.metadata.storyline.repetition_streak, 2);
});
