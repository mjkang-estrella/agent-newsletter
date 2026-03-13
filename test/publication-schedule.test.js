import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PUBLICATION_BASE_TIMEZONE,
  DEFAULT_PUBLICATION_SCHEDULE,
  NEWSLETTER_BASE_TIMEZONE_ENV_NAME,
  createPublicationSchedule,
  createPublicationScheduler,
  getNextPublicationTime,
  resolvePublicationBaseTimezoneFromEnv,
  resolvePublicationScheduleFromEnv,
  resolvePublicationScheduleFromRuntimeConfig,
} from "../src/index.js";

test("createPublicationSchedule defaults to the daily 21:00 UTC publication job", () => {
  const schedule = createPublicationSchedule();

  assert.deepEqual(schedule, DEFAULT_PUBLICATION_SCHEDULE);
});

test("resolvePublicationBaseTimezoneFromEnv defaults to UTC for deployments", () => {
  assert.equal(
    resolvePublicationBaseTimezoneFromEnv({}),
    DEFAULT_PUBLICATION_BASE_TIMEZONE,
  );
});

test("resolvePublicationBaseTimezoneFromEnv validates deployment overrides", () => {
  assert.equal(
    resolvePublicationBaseTimezoneFromEnv({
      [NEWSLETTER_BASE_TIMEZONE_ENV_NAME]: "America/Los_Angeles",
    }),
    "America/Los_Angeles",
  );

  assert.throws(
    () =>
      resolvePublicationBaseTimezoneFromEnv({
        [NEWSLETTER_BASE_TIMEZONE_ENV_NAME]: "Mars/Olympus_Mons",
      }),
    /timezone must be a valid IANA timezone: Mars\/Olympus_Mons/,
  );
});

test("resolvePublicationScheduleFromEnv allows deployment-time timezone overrides", () => {
  const schedule = resolvePublicationScheduleFromEnv({
    [NEWSLETTER_BASE_TIMEZONE_ENV_NAME]: "America/Los_Angeles",
  });

  assert.deepEqual(schedule, {
    timezone: "America/Los_Angeles",
    hour: 21,
    minute: 0,
    cronExpression: "0 21 * * *",
  });
});

test("resolvePublicationScheduleFromEnv falls back to the deployment base timezone", () => {
  const schedule = resolvePublicationScheduleFromEnv({
    [NEWSLETTER_BASE_TIMEZONE_ENV_NAME]: "America/New_York",
  });

  assert.deepEqual(schedule, {
    timezone: "America/New_York",
    hour: 21,
    minute: 0,
    cronExpression: "0 21 * * *",
  });
});

test("resolvePublicationScheduleFromRuntimeConfig derives the schedule from deployment config", () => {
  const schedule = resolvePublicationScheduleFromRuntimeConfig({
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

  assert.deepEqual(schedule, {
    timezone: "America/Los_Angeles",
    hour: 21,
    minute: 0,
    cronExpression: "0 21 * * *",
  });
});

test("getNextPublicationTime schedules the same UTC day before the 21:00 cutoff", () => {
  const nextRunAt = getNextPublicationTime({
    now: "2026-03-12T20:15:00.000Z",
  });

  assert.equal(nextRunAt, "2026-03-12T21:00:00.000Z");
});

test("getNextPublicationTime rolls forward to the next day after the 21:00 UTC cutoff", () => {
  const nextRunAt = getNextPublicationTime({
    now: "2026-03-12T21:00:01.000Z",
  });

  assert.equal(nextRunAt, "2026-03-13T21:00:00.000Z");
});

test("getNextPublicationTime keeps the current publication slot when started exactly at 21:00 UTC", () => {
  const nextRunAt = getNextPublicationTime({
    now: "2026-03-12T21:00:00.000Z",
  });

  assert.equal(nextRunAt, "2026-03-12T21:00:00.000Z");
});

test("getNextPublicationTime converts the configured local timezone to UTC correctly", () => {
  const nextRunAt = getNextPublicationTime({
    now: "2026-01-15T20:00:00.000Z",
    schedule: createPublicationSchedule({
      timezone: "America/Los_Angeles",
    }),
  });

  assert.equal(nextRunAt, "2026-01-16T05:00:00.000Z");
});

test("createPublicationScheduler schedules the default publish job for 21:00 UTC", () => {
  const timers = [];

  const scheduler = createPublicationScheduler({
    now: () => "2026-03-12T13:30:00.000Z",
    publishNewsletterEdition: async () => {},
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

  const firstRunAt = scheduler.start();

  assert.deepEqual(scheduler.schedule, DEFAULT_PUBLICATION_SCHEDULE);
  assert.equal(firstRunAt, "2026-03-12T21:00:00.000Z");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, (7 * 60 + 30) * 60 * 1000);
});

test("createPublicationScheduler advances to the next 21:00 UTC slot when restarted after the cutoff", () => {
  const timers = [];

  const scheduler = createPublicationScheduler({
    now: () => "2026-03-12T21:00:01.000Z",
    publishNewsletterEdition: async () => {},
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

  const nextRunAt = scheduler.start();

  assert.equal(nextRunAt, "2026-03-13T21:00:00.000Z");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, 24 * 60 * 60 * 1000 - 1000);
});

test("createPublicationScheduler triggers the publication task and immediately schedules the next daily run", async () => {
  const timers = [];
  const publishedRuns = [];
  const nowValues = [
    "2026-03-12T20:15:00.000Z",
    "2026-03-12T21:00:00.000Z",
  ];

  const scheduler = createPublicationScheduler({
    now: () => nowValues.shift() ?? "2026-03-12T21:00:00.000Z",
    schedule: DEFAULT_PUBLICATION_SCHEDULE,
    publishNewsletterEdition: async ({ scheduledFor, schedule }) => {
      publishedRuns.push({ scheduledFor, schedule });
    },
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

  const firstRunAt = scheduler.start();

  assert.equal(firstRunAt, "2026-03-12T21:00:00.000Z");
  assert.equal(timers[0].delayMs, 45 * 60 * 1000);

  await timers[0].callback();

  assert.deepEqual(publishedRuns, [
    {
      scheduledFor: "2026-03-12T21:00:00.000Z",
      schedule: DEFAULT_PUBLICATION_SCHEDULE,
    },
  ]);
  assert.equal(timers[1].delayMs, 24 * 60 * 60 * 1000);
  assert.equal(scheduler.getNextRunAt(), "2026-03-13T21:00:00.000Z");
});

test("createPublicationScheduler triggers newsletter generation exactly once per scheduled window", async () => {
  const timers = [];
  const publishedRuns = [];
  const nowValues = [
    "2026-03-12T20:45:00.000Z",
    "2026-03-12T21:00:00.000Z",
  ];

  const scheduler = createPublicationScheduler({
    now: () => nowValues.shift() ?? "2026-03-12T21:00:00.000Z",
    schedule: DEFAULT_PUBLICATION_SCHEDULE,
    publishNewsletterEdition: async ({ scheduledFor }) => {
      publishedRuns.push(scheduledFor);
    },
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

  const firstRunAt = scheduler.start();
  const secondStart = scheduler.start();
  const thirdStart = scheduler.start();

  assert.equal(firstRunAt, "2026-03-12T21:00:00.000Z");
  assert.equal(secondStart, firstRunAt);
  assert.equal(thirdStart, firstRunAt);
  assert.equal(timers.length, 1);

  await timers[0].callback();

  assert.deepEqual(publishedRuns, ["2026-03-12T21:00:00.000Z"]);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delayMs, 24 * 60 * 60 * 1000);
  assert.equal(scheduler.getNextRunAt(), "2026-03-13T21:00:00.000Z");
  assert.equal(scheduler.start(), "2026-03-13T21:00:00.000Z");
  assert.equal(timers.length, 2);
});

test("createPublicationScheduler stop clears the pending timer", () => {
  const timers = [];

  const scheduler = createPublicationScheduler({
    now: () => "2026-03-12T20:15:00.000Z",
    publishNewsletterEdition: async () => {},
    setTimeoutImpl(callback, delayMs) {
      const timer = { callback, delayMs, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl(timer) {
      timer.cleared = true;
    },
  });

  scheduler.start();
  scheduler.stop();

  assert.equal(timers[0].cleared, true);
  assert.equal(scheduler.getNextRunAt(), null);
});
