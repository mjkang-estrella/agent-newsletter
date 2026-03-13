import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_PUBLICATION_SCHEDULE,
  DEFAULT_SCHEDULED_PUBLICATION_GRACE_MINUTES,
  FORCE_PUBLICATION_ENV_NAME,
  SCHEDULED_PUBLICATION_GRACE_MINUTES_ENV_NAME,
  NEWSLETTER_DATA_DIR_ENV_NAME,
  createDefaultPublicationTask,
  createNormalizedItemFromSourceRecord,
  createPublicationSchedule,
  defineSourceAdapter,
  resolveForcedPublicationFromEnv,
  resolveScheduledPublicationGraceMinutesFromEnv,
  runScheduledPublication,
  shouldPublishScheduledEdition,
} from "../src/index.js";

const FIFTEEN_MINUTES_IN_MS = 15 * 60 * 1000;

function createScheduledWorkflowAdapters({ fetchWindows = [] } = {}) {
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

          const itemPublishedAt = new Date(
            new Date(window.endsAt).getTime() - FIFTEEN_MINUTES_IN_MS,
          ).toISOString();
          const slotId = window.endsAt.slice(0, 10);

          return {
            items: [
              createNormalizedItemFromSourceRecord({
                adapterId: "github",
                sourceType: "github",
                externalId: `agent-sdk-${slotId}`,
                title: `Agent SDK digest ${slotId}`,
                sourceName: "GitHub",
                sourceUrl: `https://github.com/example/agent-sdk/releases/${slotId}`,
                publishedAt: itemPublishedAt,
                discoveredAt: itemPublishedAt,
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

async function runUtcWorkflowPoll({ cwd, env, now, fetchWindows = [] }) {
  const task = createDefaultPublicationTask({
    cwd,
    env,
    now: () => now,
    createAdapters() {
      return createScheduledWorkflowAdapters({ fetchWindows });
    },
  });

  const result = await runScheduledPublication({
    env,
    now: () => now,
    publish: task.publishNewsletterEdition,
    logInfo() {},
  });

  return { result, task };
}

async function listEditionFiles(task) {
  try {
    return (await readdir(task.paths.editionsDirectoryPath)).sort();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

test("resolveScheduledPublicationGraceMinutesFromEnv defaults to a 20 minute scheduler grace window", () => {
  assert.equal(
    resolveScheduledPublicationGraceMinutesFromEnv({}),
    DEFAULT_SCHEDULED_PUBLICATION_GRACE_MINUTES,
  );
});

test("resolveScheduledPublicationGraceMinutesFromEnv validates deployment overrides", () => {
  assert.equal(
    resolveScheduledPublicationGraceMinutesFromEnv({
      [SCHEDULED_PUBLICATION_GRACE_MINUTES_ENV_NAME]: "35",
    }),
    35,
  );
  assert.throws(
    () =>
      resolveScheduledPublicationGraceMinutesFromEnv({
        [SCHEDULED_PUBLICATION_GRACE_MINUTES_ENV_NAME]: "-1",
      }),
    /NEWSLETTER_PUBLICATION_GRACE_MINUTES must be a non-negative integer/,
  );
});

test("resolveForcedPublicationFromEnv reads boolean-like deployment flags", () => {
  assert.equal(resolveForcedPublicationFromEnv({}), false);
  assert.equal(
    resolveForcedPublicationFromEnv({
      [FORCE_PUBLICATION_ENV_NAME]: "true",
    }),
    true,
  );
});

test("shouldPublishScheduledEdition returns true during the default 21:00 UTC publication window", () => {
  assert.equal(
    shouldPublishScheduledEdition({
      now: "2026-03-12T21:12:00.000Z",
    }),
    true,
  );
  assert.equal(
    shouldPublishScheduledEdition({
      now: "2026-03-12T21:25:00.000Z",
    }),
    false,
  );
});

test("shouldPublishScheduledEdition respects the configured deployment timezone", () => {
  const schedule = createPublicationSchedule({
    timezone: "America/Los_Angeles",
  });

  assert.equal(
    shouldPublishScheduledEdition({
      now: "2026-03-13T04:10:00.000Z",
      schedule,
    }),
    true,
  );
  assert.equal(
    shouldPublishScheduledEdition({
      now: "2026-03-13T03:59:00.000Z",
      schedule,
    }),
    false,
  );
});

test("runScheduledPublication skips runs outside the scheduled publication window", async () => {
  const logEntries = [];
  let publishCalls = 0;

  const result = await runScheduledPublication({
    env: {},
    now: () => "2026-03-12T18:00:00.000Z",
    publish: async () => {
      publishCalls += 1;
      return null;
    },
    runPublication: async () => {
      publishCalls += 1;
      return null;
    },
    logInfo(...args) {
      logEntries.push(args);
    },
  });

  assert.equal(publishCalls, 0);
  assert.deepEqual(result, {
    published: false,
    now: "2026-03-12T18:00:00.000Z",
    schedule: DEFAULT_PUBLICATION_SCHEDULE,
    nextRunAt: "2026-03-12T21:00:00.000Z",
    graceMinutes: DEFAULT_SCHEDULED_PUBLICATION_GRACE_MINUTES,
    forced: false,
  });
  assert.deepEqual(logEntries, [
    [
      "Newsletter publication skipped; outside the scheduled publication window.",
      {
        now: "2026-03-12T18:00:00.000Z",
        timezone: "UTC",
        cronExpression: "0 21 * * *",
        nextRunAt: "2026-03-12T21:00:00.000Z",
        graceMinutes: DEFAULT_SCHEDULED_PUBLICATION_GRACE_MINUTES,
        forced: false,
      },
    ],
  ]);
});

test("runScheduledPublication publishes once the configured publication window opens", async () => {
  const calls = [];

  const result = await runScheduledPublication({
    env: {
      NEWSLETTER_BASE_TIMEZONE: "America/Los_Angeles",
    },
    now: () => "2026-03-13T04:10:00.000Z",
    publish: async () => ({
      publishedAt: "2026-03-13T04:00:00.000Z",
      items: [{ id: "agent-sdk" }],
    }),
    runPublication: async ({ publish, logInfo }) => {
      calls.push({ publish, logInfo });
      return publish();
    },
    logInfo() {},
  });

  assert.equal(calls.length, 1);
  assert.equal(result.published, true);
  assert.equal(result.schedule.timezone, "America/Los_Angeles");
  assert.equal(result.edition.publishedAt, "2026-03-13T04:00:00.000Z");
});

test("runScheduledPublication aligns 21:00 UTC workflow polls to a single run per publication window", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
  };
  const fetchWindows = [];

  const beforeWindow = await runUtcWorkflowPoll({
    cwd,
    env,
    now: "2026-03-12T20:59:00.000Z",
    fetchWindows,
  });
  const firstScheduledPoll = await runUtcWorkflowPoll({
    cwd,
    env,
    now: "2026-03-12T21:00:00.000Z",
    fetchWindows,
  });
  const sameSlotRetry = await runUtcWorkflowPoll({
    cwd,
    env,
    now: "2026-03-12T21:15:00.000Z",
    fetchWindows,
  });
  const sameDayEditionFiles = await listEditionFiles(sameSlotRetry.task);
  const sameDayHistory = await sameSlotRetry.task.editionStore.loadHistory({
    now: "2026-03-12T21:15:00.000Z",
  });
  const afterWindow = await runUtcWorkflowPoll({
    cwd,
    env,
    now: "2026-03-12T21:21:00.000Z",
    fetchWindows,
  });
  const nextDayPoll = await runUtcWorkflowPoll({
    cwd,
    env,
    now: "2026-03-13T21:00:00.000Z",
    fetchWindows,
  });

  assert.equal(beforeWindow.result.published, false);
  assert.equal(firstScheduledPoll.result.published, true);
  assert.equal(firstScheduledPoll.result.edition.id, "2026-03-12");
  assert.equal(firstScheduledPoll.result.edition.publishedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(sameSlotRetry.result.published, true);
  assert.equal(sameSlotRetry.result.edition.id, firstScheduledPoll.result.edition.id);
  assert.equal(
    sameSlotRetry.result.edition.publishedAt,
    firstScheduledPoll.result.edition.publishedAt,
  );
  assert.equal(
    sameSlotRetry.result.edition.items[0].itemId,
    firstScheduledPoll.result.edition.items[0].itemId,
  );
  assert.equal(
    sameSlotRetry.result.edition.items[0].firstSeen,
    firstScheduledPoll.result.edition.items[0].firstSeen,
  );
  assert.deepEqual(sameDayEditionFiles, ["2026-03-12.json"]);
  assert.deepEqual(sameDayHistory, [sameSlotRetry.result.edition]);
  assert.equal(afterWindow.result.published, false);
  assert.equal(nextDayPoll.result.published, true);
  assert.equal(nextDayPoll.result.edition.id, "2026-03-13");
  assert.deepEqual(await listEditionFiles(nextDayPoll.task), [
    "2026-03-12.json",
    "2026-03-13.json",
  ]);
  assert.deepEqual(fetchWindows, [
    {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    {
      startsAt: "2026-03-12T21:00:00.000Z",
      endsAt: "2026-03-13T21:00:00.000Z",
      timezone: "UTC",
    },
  ]);
});

test("runScheduledPublication catches a missed 21:00 UTC poll on the next workflow tick inside grace", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    NEWSLETTER_BASE_TIMEZONE: "UTC",
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
    [SCHEDULED_PUBLICATION_GRACE_MINUTES_ENV_NAME]: "20",
  };
  const fetchWindows = [];

  const recoveredPoll = await runUtcWorkflowPoll({
    cwd,
    env,
    now: "2026-03-12T21:15:00.000Z",
    fetchWindows,
  });
  const afterGrace = await runUtcWorkflowPoll({
    cwd,
    env,
    now: "2026-03-12T21:21:00.000Z",
    fetchWindows,
  });

  assert.equal(recoveredPoll.result.published, true);
  assert.equal(recoveredPoll.result.edition.id, "2026-03-12");
  assert.equal(recoveredPoll.result.edition.publishedAt, "2026-03-12T21:00:00.000Z");
  assert.equal(afterGrace.result.published, false);
  assert.deepEqual(await listEditionFiles(afterGrace.task), ["2026-03-12.json"]);
  assert.deepEqual(fetchWindows, [
    {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
  ]);
});

test("runScheduledPublication can force a manual publish outside the scheduled window", async () => {
  let publishCalls = 0;

  const result = await runScheduledPublication({
    env: {
      [FORCE_PUBLICATION_ENV_NAME]: "true",
    },
    now: () => "2026-03-12T18:00:00.000Z",
    publish: async () => {
      publishCalls += 1;
      return {
        publishedAt: "2026-03-12T21:00:00.000Z",
        items: [],
      };
    },
    runPublication: async ({ publish }) => publish(),
    logInfo() {},
  });

  assert.equal(publishCalls, 1);
  assert.equal(result.published, true);
  assert.equal(result.forced, true);
});
