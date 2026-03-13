import { resolveRateLimitConfigFromEnv } from "./rate-limit.js";
import { resolvePublicationScheduleFromEnv } from "./publication-schedule.js";

export function createNewsletterRuntimeConfig(env = process.env) {
  const publicationSchedule = resolvePublicationRuntimeSchedule(env);
  const rateLimit = resolveRateLimitConfigFromEnv(env);

  return Object.freeze({
    api: Object.freeze({
      rateLimit: Object.freeze({
        maxRequests: rateLimit.maxRequests,
        windowMs: rateLimit.windowMs,
        trustProxy: rateLimit.trustProxy,
      }),
    }),
    publication: Object.freeze({
      baseTimezone: publicationSchedule.timezone,
      hour: publicationSchedule.hour,
      minute: publicationSchedule.minute,
      cronExpression: publicationSchedule.cronExpression,
    }),
  });
}

function resolvePublicationRuntimeSchedule(env) {
  try {
    return resolvePublicationScheduleFromEnv(env);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("timezone must be a valid IANA timezone")
    ) {
      throw new TypeError("baseTimezone must be a valid IANA timezone");
    }

    throw error;
  }
}
