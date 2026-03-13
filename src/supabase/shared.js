import { assertNonEmptyString, normalizeTimestamp } from "../core/contracts.js";

export const SUPABASE_URL_ENV_NAME = "SUPABASE_URL";
export const SUPABASE_SECRET_KEY_ENV_NAME = "SUPABASE_SECRET_KEY";
export const SUPABASE_SERVICE_ROLE_KEY_ENV_NAME = "SUPABASE_SERVICE_ROLE_KEY";
export const CRON_SECRET_ENV_NAME = "CRON_SECRET";

export const SOURCE_REGISTRY_STATE_KEY = "source_registry";
export const ITEM_IDENTITY_REGISTRY_STATE_KEY = "item_identity_registry";

export function resolveSupabaseServerConfig(env = process.env) {
  const url = assertNonEmptyString(
    env?.[SUPABASE_URL_ENV_NAME],
    SUPABASE_URL_ENV_NAME,
  );
  const key =
    normalizeOptionalSecret(env?.[SUPABASE_SECRET_KEY_ENV_NAME]) ??
    normalizeOptionalSecret(env?.[SUPABASE_SERVICE_ROLE_KEY_ENV_NAME]);

  if (!key) {
    throw new TypeError(
      `${SUPABASE_SECRET_KEY_ENV_NAME} or ${SUPABASE_SERVICE_ROLE_KEY_ENV_NAME} is required`,
    );
  }

  return Object.freeze({
    url,
    key,
  });
}

export function resolveCronSecret(env = process.env) {
  return assertNonEmptyString(env?.[CRON_SECRET_ENV_NAME], CRON_SECRET_ENV_NAME);
}

export function cloneJsonValue(value) {
  if (value == null) {
    return value ?? null;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

export function isSupabaseNoRowsError(error) {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error.code === "PGRST116" ||
        error.code === "PGRST123" ||
        /0 rows/i.test(error.message ?? "")),
  );
}

export function isSupabaseUniqueViolation(error) {
  return Boolean(error && typeof error === "object" && error.code === "23505");
}

export function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}

export function resolveNowTimestamp(now = () => new Date().toISOString()) {
  const value = now();

  if (value instanceof Date) {
    return value.toISOString();
  }

  return normalizeTimestamp(value, "now");
}

export function normalizeOptionalSecret(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
