import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeTimestamp } from "../core/contracts.js";
import { createPublicationPlan } from "./publication-flow.js";
import { publishNewsletterEdition } from "./default-publication-task.js";
import {
  DEFAULT_PUBLICATION_SCHEDULE,
  getNextPublicationTime,
  resolvePublicationScheduleFromRuntimeConfig,
} from "./publication-schedule.js";
import { runPublicationOnce } from "./publish-newsletter-edition.js";
import { createNewsletterRuntimeConfig } from "./runtime-config.js";

export const DEFAULT_SCHEDULED_PUBLICATION_GRACE_MINUTES = 20;
export const SCHEDULED_PUBLICATION_GRACE_MINUTES_ENV_NAME =
  "NEWSLETTER_PUBLICATION_GRACE_MINUTES";
export const FORCE_PUBLICATION_ENV_NAME = "NEWSLETTER_FORCE_PUBLICATION";

export function resolveScheduledPublicationGraceMinutesFromEnv(env = process.env) {
  const rawValue = env[SCHEDULED_PUBLICATION_GRACE_MINUTES_ENV_NAME];

  if (rawValue == null || rawValue === "") {
    return DEFAULT_SCHEDULED_PUBLICATION_GRACE_MINUTES;
  }

  const value = Number.parseInt(String(rawValue), 10);

  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(
      `${SCHEDULED_PUBLICATION_GRACE_MINUTES_ENV_NAME} must be a non-negative integer`,
    );
  }

  return value;
}

export function resolveForcedPublicationFromEnv(env = process.env) {
  return parseBooleanFlag(env[FORCE_PUBLICATION_ENV_NAME] ?? false);
}

export function shouldPublishScheduledEdition({
  now = new Date().toISOString(),
  schedule = DEFAULT_PUBLICATION_SCHEDULE,
  graceMinutes = DEFAULT_SCHEDULED_PUBLICATION_GRACE_MINUTES,
} = {}) {
  const normalizedNow = normalizeNow(now);
  const normalizedGraceMinutes = normalizeGraceMinutes(graceMinutes);
  const publicationPlan = createPublicationPlan({
    now: normalizedNow,
    schedule,
  });
  const elapsedMs =
    new Date(normalizedNow).getTime() - new Date(publicationPlan.publishedAt).getTime();

  return elapsedMs >= 0 && elapsedMs <= normalizedGraceMinutes * 60_000;
}

export async function runScheduledPublication({
  env = process.env,
  now = () => new Date(),
  publish = publishNewsletterEdition,
  runPublication = runPublicationOnce,
  logInfo = (...args) => console.info(...args),
} = {}) {
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  if (typeof runPublication !== "function") {
    throw new TypeError("runPublication must be a function");
  }

  if (typeof logInfo !== "function") {
    throw new TypeError("logInfo must be a function");
  }

  const normalizedNow = normalizeNow(now());
  const schedule = resolvePublicationScheduleFromRuntimeConfig(
    createNewsletterRuntimeConfig(env),
  );
  const graceMinutes = resolveScheduledPublicationGraceMinutesFromEnv(env);
  const forced = resolveForcedPublicationFromEnv(env);

  if (
    !forced &&
    !shouldPublishScheduledEdition({
      now: normalizedNow,
      schedule,
      graceMinutes,
    })
  ) {
    const nextRunAt = getNextPublicationTime({
      now: normalizedNow,
      schedule,
      inclusive: true,
    });

    logInfo("Newsletter publication skipped; outside the scheduled publication window.", {
      now: normalizedNow,
      timezone: schedule.timezone,
      cronExpression: schedule.cronExpression,
      nextRunAt,
      graceMinutes,
      forced,
    });

    return {
      published: false,
      now: normalizedNow,
      schedule,
      nextRunAt,
      graceMinutes,
      forced,
    };
  }

  const edition = await runPublication({
    publish,
    logInfo,
  });

  return {
    published: true,
    now: normalizedNow,
    schedule,
    graceMinutes,
    forced,
    edition,
  };
}

function normalizeNow(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return normalizeTimestamp(value, "now");
}

function normalizeGraceMinutes(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError("graceMinutes must be a non-negative integer");
  }

  return value;
}

function parseBooleanFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isExecutedDirectly() {
  return process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  await runScheduledPublication();
}
