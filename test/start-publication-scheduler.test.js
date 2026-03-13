import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_PUBLICATION_TASK_MODULE_PATH,
  DEFAULT_PUBLICATION_SCHEDULE,
  NEWSLETTER_DATA_DIR_ENV_NAME,
  createDefaultPublicationTask,
  createPublicationScheduler,
} from "../src/index.js";
import { startPublicationScheduler } from "../src/newsletter/start-publication-scheduler.js";

test("startPublicationScheduler falls back to the built-in publication task module", async () => {
  const scheduler = {
    start() {
      return "2026-03-12T21:00:00.000Z";
    },
    stop() {},
  };

  await startPublicationScheduler({
    env: {},
    importTaskModule: async (taskModulePath) => {
      assert.equal(taskModulePath, DEFAULT_PUBLICATION_TASK_MODULE_PATH);
      return {
        async publishNewsletterEdition() {},
      };
    },
    createScheduler() {
      return scheduler;
    },
    logInfo() {},
    processRef: {
      on() {},
      exit() {},
    },
  });
});

test("startPublicationScheduler registers the default daily 21:00 UTC job", async () => {
  const createSchedulerCalls = [];
  const logEntries = [];
  const signalHandlers = new Map();
  const scheduler = {
    startCalls: 0,
    stopCalls: 0,
    start() {
      this.startCalls += 1;
      return "2026-03-12T21:00:00.000Z";
    },
    stop() {
      this.stopCalls += 1;
    },
  };
  const publishNewsletterEdition = async () => {};

  const runtime = await startPublicationScheduler({
    env: {
      NEWSLETTER_PUBLICATION_TASK_MODULE: "./test/publication-task.js",
    },
    importTaskModule: async (taskModulePath) => {
      assert.equal(taskModulePath, "./test/publication-task.js");
      return { publishNewsletterEdition };
    },
    createScheduler(args) {
      createSchedulerCalls.push(args);
      return scheduler;
    },
    logInfo: (...args) => logEntries.push(args),
    processRef: {
      on(signal, handler) {
        signalHandlers.set(signal, handler);
      },
      exit() {},
    },
  });

  assert.equal(createSchedulerCalls.length, 1);
  assert.deepEqual(createSchedulerCalls[0], {
    schedule: DEFAULT_PUBLICATION_SCHEDULE,
    publishNewsletterEdition,
  });
  assert.equal(scheduler.startCalls, 1);
  assert.deepEqual(runtime.schedule, DEFAULT_PUBLICATION_SCHEDULE);
  assert.deepEqual(runtime.config, {
    api: {
      rateLimit: {
        maxRequests: 60,
        windowMs: 60_000,
        trustProxy: false,
      },
    },
    publication: {
      baseTimezone: "UTC",
      hour: 21,
      minute: 0,
      cronExpression: "0 21 * * *",
    },
  });
  assert.equal(runtime.nextRunAt, "2026-03-12T21:00:00.000Z");
  assert.deepEqual([...signalHandlers.keys()], ["SIGINT", "SIGTERM"]);
  assert.deepEqual(logEntries, [
    [
      "Newsletter publication scheduler started.",
      {
        cronExpression: "0 21 * * *",
        timezone: "UTC",
        nextRunAt: "2026-03-12T21:00:00.000Z",
      },
    ],
  ]);
});

test("startPublicationScheduler triggers the publication pipeline when the scheduled job fires", async () => {
  const timers = [];
  const publishedRuns = [];
  const nowValues = [
    "2026-03-12T20:15:00.000Z",
    "2026-03-13T04:00:00.000Z",
  ];

  const runtime = await startPublicationScheduler({
    env: {
      NEWSLETTER_BASE_TIMEZONE: "America/Los_Angeles",
      NEWSLETTER_PUBLICATION_TASK_MODULE: "./test/publication-task.js",
    },
    importTaskModule: async () => ({
      async publishNewsletterEdition(payload) {
        publishedRuns.push(payload);
      },
    }),
    createScheduler({ schedule, publishNewsletterEdition }) {
      return createPublicationScheduler({
        now: () => nowValues.shift() ?? "2026-03-13T04:00:00.000Z",
        schedule,
        publishNewsletterEdition,
        setTimeoutImpl(callback, delayMs) {
          const timer = { callback, delayMs, cleared: false };
          timers.push(timer);
          return timer;
        },
        clearTimeoutImpl(timer) {
          timer.cleared = true;
        },
        onError(error) {
          throw error;
        },
      });
    },
    logInfo() {},
    processRef: {
      on() {},
      exit() {},
    },
  });

  assert.deepEqual(runtime.config, {
    api: {
      rateLimit: {
        maxRequests: 60,
        windowMs: 60_000,
        trustProxy: false,
      },
    },
    publication: {
      baseTimezone: "America/Los_Angeles",
      hour: 21,
      minute: 0,
      cronExpression: "0 21 * * *",
    },
  });
  assert.equal(runtime.nextRunAt, "2026-03-13T04:00:00.000Z");
  assert.equal(timers[0].delayMs, (7 * 60 + 45) * 60 * 1000);

  await timers[0].callback();

  assert.deepEqual(publishedRuns, [
    {
      scheduledFor: "2026-03-13T04:00:00.000Z",
      schedule: {
        timezone: "America/Los_Angeles",
        hour: 21,
        minute: 0,
        cronExpression: "0 21 * * *",
      },
    },
  ]);
  assert.equal(runtime.scheduler.getNextRunAt(), "2026-03-14T04:00:00.000Z");
  assert.equal(timers[1].delayMs, 24 * 60 * 60 * 1000);
});

test("startPublicationScheduler publishes every day at 21:00 UTC by default", async () => {
  const timers = [];
  const publishedRuns = [];
  const nowValues = [
    "2026-03-12T20:59:30.000Z",
    "2026-03-12T21:00:00.000Z",
    "2026-03-13T21:00:00.000Z",
  ];

  const runtime = await startPublicationScheduler({
    env: {
      NEWSLETTER_PUBLICATION_TASK_MODULE: "./test/publication-task.js",
    },
    importTaskModule: async () => ({
      async publishNewsletterEdition(payload) {
        publishedRuns.push(payload);
      },
    }),
    createScheduler({ schedule, publishNewsletterEdition }) {
      return createPublicationScheduler({
        now: () => nowValues.shift() ?? "2026-03-14T21:00:00.000Z",
        schedule,
        publishNewsletterEdition,
        setTimeoutImpl(callback, delayMs) {
          const timer = { callback, delayMs, cleared: false };
          timers.push(timer);
          return timer;
        },
        clearTimeoutImpl(timer) {
          timer.cleared = true;
        },
        onError(error) {
          throw error;
        },
      });
    },
    logInfo() {},
    processRef: {
      on() {},
      exit() {},
    },
  });

  assert.deepEqual(runtime.schedule, DEFAULT_PUBLICATION_SCHEDULE);
  assert.deepEqual(runtime.config, {
    api: {
      rateLimit: {
        maxRequests: 60,
        windowMs: 60_000,
        trustProxy: false,
      },
    },
    publication: {
      baseTimezone: "UTC",
      hour: 21,
      minute: 0,
      cronExpression: "0 21 * * *",
    },
  });
  assert.equal(runtime.nextRunAt, "2026-03-12T21:00:00.000Z");
  assert.equal(timers[0].delayMs, 30 * 1000);

  await timers[0].callback();

  assert.deepEqual(publishedRuns, [
    {
      scheduledFor: "2026-03-12T21:00:00.000Z",
      schedule: DEFAULT_PUBLICATION_SCHEDULE,
    },
  ]);
  assert.equal(timers[1].delayMs, 24 * 60 * 60 * 1000);

  await timers[1].callback();

  assert.deepEqual(publishedRuns, [
    {
      scheduledFor: "2026-03-12T21:00:00.000Z",
      schedule: DEFAULT_PUBLICATION_SCHEDULE,
    },
    {
      scheduledFor: "2026-03-13T21:00:00.000Z",
      schedule: DEFAULT_PUBLICATION_SCHEDULE,
    },
  ]);
  assert.equal(runtime.scheduler.getNextRunAt(), "2026-03-14T21:00:00.000Z");
  assert.equal(timers[2].delayMs, 24 * 60 * 60 * 1000);
});

test("startPublicationScheduler protects the 21:00 UTC edition from duplicate scheduler firings", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const env = {
    [NEWSLETTER_DATA_DIR_ENV_NAME]: "newsletter-state",
    NEWSLETTER_PUBLICATION_TASK_MODULE: "./test/publication-task.js",
  };
  const timers = [];
  const aggregateWindows = [];
  const publishedEditions = [];
  const schedulerNowValues = [
    ["2026-03-12T20:45:00.000Z", "2026-03-12T21:00:00.000Z"],
    ["2026-03-12T20:45:00.000Z", "2026-03-12T21:00:00.000Z"],
  ];
  let schedulerIndex = 0;

  async function importTaskModule() {
    return {
      async publishNewsletterEdition({ scheduledFor }) {
        const task = createDefaultPublicationTask({
          cwd,
          env,
          now: () => scheduledFor,
          pipeline: {
            async aggregate(window) {
              aggregateWindows.push(window);
              return { items: [] };
            },
          },
        });
        const edition = await task.publishNewsletterEdition();
        publishedEditions.push(edition);
        return edition;
      },
    };
  }

  async function startRuntime() {
    const nowValues = schedulerNowValues[schedulerIndex];
    schedulerIndex += 1;

    return startPublicationScheduler({
      env,
      importTaskModule,
      createScheduler({ schedule, publishNewsletterEdition }) {
        return createPublicationScheduler({
          now: () => nowValues.shift() ?? "2026-03-12T21:00:00.000Z",
          schedule,
          publishNewsletterEdition,
          setTimeoutImpl(callback, delayMs) {
            const timer = { callback, delayMs, cleared: false };
            timers.push(timer);
            return timer;
          },
          clearTimeoutImpl(timer) {
            timer.cleared = true;
          },
          onError(error) {
            throw error;
          },
        });
      },
      logInfo() {},
      processRef: {
        on() {},
        exit() {},
      },
    });
  }

  await startRuntime();
  await startRuntime();

  assert.equal(timers.length, 2);
  assert.equal(timers[0].delayMs, 15 * 60 * 1000);
  assert.equal(timers[1].delayMs, 15 * 60 * 1000);

  await timers[0].callback();
  await timers[1].callback();

  assert.equal(publishedEditions.length, 2);
  assert.equal(aggregateWindows.length, 1);
  assert.deepEqual(aggregateWindows, [
    {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
  ]);
  assert.equal(publishedEditions[0].id, "2026-03-12");
  assert.equal(publishedEditions[1].id, publishedEditions[0].id);
  assert.equal(publishedEditions[1].publishedAt, publishedEditions[0].publishedAt);
  assert.deepEqual(
    await readdir(join(cwd, "newsletter-state", "editions")),
    ["2026-03-12.json"],
  );
});
