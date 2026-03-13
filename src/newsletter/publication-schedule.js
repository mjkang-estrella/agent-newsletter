import { assertNonEmptyString, normalizeTimestamp } from "../core/contracts.js";

const MINUTES_PER_DAY = 24 * 60;
const SEARCH_WINDOW_MINUTES = MINUTES_PER_DAY * 2;
const FORMATTER_CACHE = new Map();
export const NEWSLETTER_BASE_TIMEZONE_ENV_NAME = "NEWSLETTER_BASE_TIMEZONE";

export const DEFAULT_PUBLICATION_SCHEDULE = Object.freeze({
  timezone: "UTC",
  hour: 21,
  minute: 0,
  cronExpression: "0 21 * * *",
});
export const DEFAULT_PUBLICATION_BASE_TIMEZONE = DEFAULT_PUBLICATION_SCHEDULE.timezone;

export function createPublicationSchedule({
  timezone = DEFAULT_PUBLICATION_SCHEDULE.timezone,
  hour = DEFAULT_PUBLICATION_SCHEDULE.hour,
  minute = DEFAULT_PUBLICATION_SCHEDULE.minute,
} = {}) {
  const normalizedTimezone = validateTimezone(timezone);
  const normalizedHour = validateIntegerInRange(hour, 0, 23, "hour");
  const normalizedMinute = validateIntegerInRange(minute, 0, 59, "minute");

  return Object.freeze({
    timezone: normalizedTimezone,
    hour: normalizedHour,
    minute: normalizedMinute,
    cronExpression: `${normalizedMinute} ${normalizedHour} * * *`,
  });
}

export function resolvePublicationScheduleFromEnv(env = process.env) {
  return createPublicationSchedule({
    timezone: resolvePublicationBaseTimezoneFromEnv(env),
    hour: DEFAULT_PUBLICATION_SCHEDULE.hour,
    minute: DEFAULT_PUBLICATION_SCHEDULE.minute,
  });
}

export function resolvePublicationBaseTimezoneFromEnv(env = process.env) {
  return validateTimezone(
    env?.[NEWSLETTER_BASE_TIMEZONE_ENV_NAME] ?? DEFAULT_PUBLICATION_BASE_TIMEZONE,
  );
}

export function resolvePublicationScheduleFromRuntimeConfig(runtimeConfig) {
  const publicationConfig = validatePublicationRuntimeConfig(runtimeConfig);

  return createPublicationSchedule({
    timezone: publicationConfig.baseTimezone,
    hour: publicationConfig.hour,
    minute: publicationConfig.minute,
  });
}

export function getNextPublicationTime({
  now = new Date().toISOString(),
  schedule = DEFAULT_PUBLICATION_SCHEDULE,
  inclusive = true,
} = {}) {
  const normalizedSchedule = createPublicationSchedule(schedule);
  const normalizedNow = normalizeNow(now);
  const nowDate = new Date(normalizedNow);
  const today = getLocalDateParts(nowDate, normalizedSchedule.timezone);
  const candidates = [today, addUtcDays(today, 1)];

  for (const candidateDate of candidates) {
    const candidate = findUtcTimeForLocalSchedule(candidateDate, normalizedSchedule);

    if (
      (inclusive && candidate.getTime() >= nowDate.getTime()) ||
      (!inclusive && candidate.getTime() > nowDate.getTime())
    ) {
      return candidate.toISOString();
    }
  }

  return findUtcTimeForLocalSchedule(addUtcDays(today, 2), normalizedSchedule).toISOString();
}

export function createPublicationScheduler({
  schedule = DEFAULT_PUBLICATION_SCHEDULE,
  publishNewsletterEdition,
  now = () => new Date(),
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  onError = defaultOnError,
} = {}) {
  if (typeof publishNewsletterEdition !== "function") {
    throw new TypeError("publishNewsletterEdition must be a function");
  }

  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  if (typeof setTimeoutImpl !== "function") {
    throw new TypeError("setTimeoutImpl must be a function");
  }

  if (typeof clearTimeoutImpl !== "function") {
    throw new TypeError("clearTimeoutImpl must be a function");
  }

  if (typeof onError !== "function") {
    throw new TypeError("onError must be a function");
  }

  const normalizedSchedule = createPublicationSchedule(schedule);
  let timerId = null;
  let nextRunAt = null;
  let active = false;

  return {
    schedule: normalizedSchedule,

    start() {
      if (active) {
        return nextRunAt;
      }

      active = true;
      return scheduleNextRun({ inclusive: true });
    },

    stop() {
      active = false;
      nextRunAt = null;

      if (timerId != null) {
        clearTimeoutImpl(timerId);
        timerId = null;
      }
    },

    getNextRunAt() {
      return nextRunAt;
    },
  };

  function scheduleNextRun({ inclusive }) {
    const currentNow = normalizeNow(resolveNowValue(now));
    nextRunAt = getNextPublicationTime({
      now: currentNow,
      schedule: normalizedSchedule,
      inclusive,
    });

    const delayMs = Math.max(0, new Date(nextRunAt).getTime() - new Date(currentNow).getTime());
    timerId = setTimeoutImpl(async () => {
      timerId = null;
      const scheduledFor = nextRunAt;

      try {
        await publishNewsletterEdition({
          scheduledFor,
          schedule: normalizedSchedule,
        });
      } catch (error) {
        onError(error, { scheduledFor, schedule: normalizedSchedule });
      } finally {
        if (active) {
          scheduleNextRun({ inclusive: false });
        }
      }
    }, delayMs);

    return nextRunAt;
  }
}

function validateTimezone(value) {
  const timezone = assertNonEmptyString(value, "timezone");

  try {
    getFormatter(timezone).format(new Date());
  } catch (error) {
    throw new TypeError(`timezone must be a valid IANA timezone: ${timezone}`);
  }

  return timezone;
}

function validatePublicationRuntimeConfig(runtimeConfig) {
  if (runtimeConfig == null || typeof runtimeConfig !== "object") {
    throw new TypeError("runtimeConfig must be an object");
  }

  if (
    runtimeConfig.publication == null ||
    typeof runtimeConfig.publication !== "object"
  ) {
    throw new TypeError("runtimeConfig.publication must be an object");
  }

  return {
    baseTimezone: assertNonEmptyString(
      runtimeConfig.publication.baseTimezone,
      "runtimeConfig.publication.baseTimezone",
    ),
    hour: validateIntegerInRange(
      runtimeConfig.publication.hour,
      0,
      23,
      "runtimeConfig.publication.hour",
    ),
    minute: validateIntegerInRange(
      runtimeConfig.publication.minute,
      0,
      59,
      "runtimeConfig.publication.minute",
    ),
  };
}

function validateIntegerInRange(value, min, max, fieldName) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${fieldName} must be an integer between ${min} and ${max}`);
  }

  return value;
}

function normalizeNow(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return normalizeTimestamp(value, "now");
}

function resolveNowValue(now) {
  return now();
}

function getLocalDateParts(date, timezone) {
  const parts = getFormatter(timezone).formatToParts(date);
  const entries = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number.parseInt(entries.year, 10),
    month: Number.parseInt(entries.month, 10),
    day: Number.parseInt(entries.day, 10),
    hour: Number.parseInt(entries.hour, 10),
    minute: Number.parseInt(entries.minute, 10),
    second: Number.parseInt(entries.second, 10),
  };
}

function addUtcDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function findUtcTimeForLocalSchedule(dateParts, schedule) {
  const approximateUtc = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    schedule.hour,
    schedule.minute,
    0,
    0,
  );

  // Search around the naive UTC guess because Date lacks a direct "local time in timezone -> UTC" API.
  const start = approximateUtc - SEARCH_WINDOW_MINUTES * 60_000;
  const end = approximateUtc + SEARCH_WINDOW_MINUTES * 60_000;

  for (let timestamp = start; timestamp <= end; timestamp += 60_000) {
    const candidateDate = new Date(timestamp);
    const candidateParts = getLocalDateParts(candidateDate, schedule.timezone);

    if (
      candidateParts.year === dateParts.year &&
      candidateParts.month === dateParts.month &&
      candidateParts.day === dateParts.day &&
      candidateParts.hour === schedule.hour &&
      candidateParts.minute === schedule.minute
    ) {
      return candidateDate;
    }
  }

  throw new RangeError(
    `Unable to resolve ${dateParts.year}-${pad(dateParts.month)}-${pad(dateParts.day)} ${pad(schedule.hour)}:${pad(schedule.minute)} in ${schedule.timezone}`,
  );
}

function getFormatter(timezone) {
  if (!FORMATTER_CACHE.has(timezone)) {
    FORMATTER_CACHE.set(
      timezone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    );
  }

  return FORMATTER_CACHE.get(timezone);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function defaultOnError(error, context) {
  console.error("Newsletter publication job failed.", {
    error,
    scheduledFor: context?.scheduledFor,
    schedule: context?.schedule,
  });
}
