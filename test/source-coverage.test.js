import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  SOURCE_LIFECYCLE_STAGES,
  SOURCE_LIFECYCLE_STATES,
  SourceRepository,
  buildSourceCoverageMap,
  countActiveSourcesByTopicArea,
} from "../src/index.js";

function buildSource({
  id,
  categoryCoverage,
  state = SOURCE_LIFECYCLE_STATES.active,
  status = state === SOURCE_LIFECYCLE_STATES.retired ? "retired" : "approved",
  seed = false,
} = {}) {
  const value = id.replace(/^[^:]+:domain:/u, "");

  return {
    id,
    kind: "web",
    entityType: "domain",
    platform: "web",
    value,
    displayName: value,
    url: `https://${value}`,
    canonicalUrl: `https://${value}`,
    fetchUrl: `https://${value}`,
    status,
    seed,
    authorityScore: 78,
    signalScore: 64,
    discoveredAt: "2026-03-10T21:00:00.000Z",
    approvedAt: status === "approved" ? "2026-03-10T21:00:00.000Z" : null,
    lastSeenAt: "2026-03-11T21:00:00.000Z",
    lifecycle: {
      state,
      stage: state,
      probationStartedAt: "2026-03-10T21:00:00.000Z",
      activatedAt:
        state === SOURCE_LIFECYCLE_STATES.active ? "2026-03-11T21:00:00.000Z" : null,
      retiredAt:
        state === SOURCE_LIFECYCLE_STATES.retired ? "2026-03-11T21:00:00.000Z" : null,
      lowSignalStreak: 0,
      lowSignalCycles: [],
    },
    evidence: {
      discoveryCount: 1,
      referrers: ["github:domain:github.com"],
      trustedReferrers: ["github:domain:github.com"],
      seedReferrers: [],
      referrerPlatforms: ["web"],
      cyclesSeen: ["2026-03-11"],
      topicHits: ["agent", "tool"],
      categoryCoverage,
      exampleUrls: [`https://${value}/agents`],
    },
    discoveredFromUrls: ["https://github.com/trending"],
  };
}

test("buildSourceCoverageMap returns per-category active-source counts and statuses", () => {
  const coverageMap = buildSourceCoverageMap(
    [
      buildSource({
        id: "web:domain:tool-api.example.com",
        categoryCoverage: ["tool", "api"],
      }),
      buildSource({
        id: "web:domain:tool.example.com",
        categoryCoverage: ["tool"],
      }),
      buildSource({
        id: "web:domain:probation-api.example.com",
        categoryCoverage: ["api"],
        state: SOURCE_LIFECYCLE_STAGES.probation,
      }),
      buildSource({
        id: "web:domain:library.example.com",
        categoryCoverage: ["library"],
      }),
      buildSource({
        id: "web:domain:seed-library.example.com",
        categoryCoverage: ["library"],
        seed: true,
      }),
      buildSource({
        id: "web:domain:retired-technique.example.com",
        categoryCoverage: ["technique"],
        state: SOURCE_LIFECYCLE_STATES.retired,
      }),
    ],
    {
      minimumActiveCategorySources: 2,
    },
  );

  assert.deepEqual(coverageMap, [
    {
      topicArea: "tool",
      activeSourceCount: 2,
      coverageStatus: "covered",
    },
    {
      topicArea: "api",
      activeSourceCount: 1,
      coverageStatus: "underrepresented",
    },
    {
      topicArea: "library",
      activeSourceCount: 1,
      coverageStatus: "underrepresented",
    },
    {
      topicArea: "technique",
      activeSourceCount: 0,
      coverageStatus: "uncovered",
    },
  ]);
});

function buildTopicSource({
  id,
  topicHits = [],
  state = SOURCE_LIFECYCLE_STATES.active,
  status = state === SOURCE_LIFECYCLE_STATES.retired ? "retired" : "approved",
  seed = false,
  includeLifecycle = true,
} = {}) {
  const value = id.replace(/^[^:]+:domain:/u, "");

  return {
    id,
    kind: "web",
    entityType: "domain",
    platform: "web",
    value,
    displayName: value,
    url: `https://${value}`,
    canonicalUrl: `https://${value}`,
    fetchUrl: `https://${value}`,
    status,
    seed,
    authorityScore: 78,
    signalScore: 64,
    discoveredAt: "2026-03-10T21:00:00.000Z",
    approvedAt: status === "approved" ? "2026-03-10T21:00:00.000Z" : null,
    lastSeenAt: "2026-03-11T21:00:00.000Z",
    ...(includeLifecycle
      ? {
          lifecycle: {
            state,
            stage: state,
            probationStartedAt: "2026-03-10T21:00:00.000Z",
            activatedAt:
              state === SOURCE_LIFECYCLE_STATES.active
                ? "2026-03-11T21:00:00.000Z"
                : null,
            retiredAt:
              state === SOURCE_LIFECYCLE_STATES.retired
                ? "2026-03-11T21:00:00.000Z"
                : null,
            lowSignalStreak: 0,
            lowSignalCycles: [],
          },
        }
      : {}),
    evidence: {
      discoveryCount: 1,
      referrers: ["github:domain:github.com"],
      trustedReferrers: ["github:domain:github.com"],
      seedReferrers: [],
      referrerPlatforms: ["web"],
      cyclesSeen: ["2026-03-11"],
      topicHits,
      categoryCoverage: [],
      exampleUrls: [`https://${value}/agents`],
    },
    discoveredFromUrls: ["https://github.com/trending"],
  };
}

test("countActiveSourcesByTopicArea counts only explicitly active non-seed sources once per topic", () => {
  const coverage = countActiveSourcesByTopicArea([
    buildTopicSource({
      id: "web:domain:legacy-docs.example.com",
      topicHits: ["Agent", "sdk", "sdk", "unknown-topic"],
      includeLifecycle: false,
    }),
    buildTopicSource({
      id: "web:domain:active-docs.example.com",
      topicHits: ["agent", "tool"],
    }),
    buildTopicSource({
      id: "web:domain:probation-docs.example.com",
      topicHits: ["agent", "api"],
      state: SOURCE_LIFECYCLE_STAGES.probation,
    }),
    buildTopicSource({
      id: "web:domain:retired-docs.example.com",
      topicHits: ["sdk"],
      state: SOURCE_LIFECYCLE_STATES.retired,
    }),
    buildTopicSource({
      id: "github:domain:github.com",
      seed: true,
      topicHits: ["agent", "tool"],
    }),
    buildTopicSource({
      id: "web:domain:candidate-docs.example.com",
      status: "candidate",
      topicHits: ["automation"],
    }),
  ]);

  assert.equal(coverage.get("agent"), 1);
  assert.equal(coverage.get("tool"), 1);
  assert.equal(coverage.has("sdk"), false);
  assert.equal(coverage.has("api"), false);
  assert.equal(coverage.has("automation"), false);
  assert.equal(coverage.has("unknown-topic"), false);
});

test("source repository aggregates topic coverage from explicitly active persisted sources", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new SourceRepository({
    filePath: join(directory, "source-registry.json"),
  });

  await repository.save({
    version: 1,
    updatedAt: "2026-03-12T21:00:00.000Z",
    sources: [
      buildTopicSource({
        id: "web:domain:legacy-docs.example.com",
        topicHits: ["agent", "framework"],
        includeLifecycle: false,
      }),
      buildTopicSource({
        id: "web:domain:active-docs.example.com",
        topicHits: ["framework", "api"],
      }),
      buildTopicSource({
        id: "web:domain:probation-docs.example.com",
        topicHits: ["framework", "api"],
        state: SOURCE_LIFECYCLE_STAGES.probation,
      }),
    ],
  });

  const coverage = await repository.countActiveSourcesByTopicArea({
    now: "2026-03-12T21:05:00.000Z",
  });

  assert.equal(coverage.has("agent"), false);
  assert.equal(coverage.get("framework"), 1);
  assert.equal(coverage.get("api"), 1);
});
