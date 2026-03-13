import { assertNonEmptyString, normalizeTimestamp } from "./contracts.js";
import { annotateItemIdentitySignals } from "./item-identity.js";
import { createDiscoveredSource, createNormalizedItem } from "./schema.js";

export const DEFAULT_FETCH_WINDOW_HOURS = 24;
export const DEFAULT_FETCH_WINDOW_TIMEZONE = "UTC";

const HOUR_IN_MS = 60 * 60 * 1000;

export function createFetchWindow({
  startsAt,
  endsAt,
  since,
  until,
  timezone = DEFAULT_FETCH_WINDOW_TIMEZONE,
  windowHours = DEFAULT_FETCH_WINDOW_HOURS,
  now = new Date().toISOString(),
} = {}) {
  const normalizedEndsAt = normalizeTimestamp(endsAt ?? until ?? now, "endsAt");
  const normalizedStartsAt = normalizeTimestamp(
    startsAt ??
      since ??
      new Date(
        new Date(normalizedEndsAt).getTime() - normalizeWindowHours(windowHours) * HOUR_IN_MS,
      ).toISOString(),
    "startsAt",
  );

  if (new Date(normalizedStartsAt).getTime() > new Date(normalizedEndsAt).getTime()) {
    throw new RangeError("fetch window is invalid: startsAt must be earlier than endsAt");
  }

  return Object.freeze({
    startsAt: normalizedStartsAt,
    endsAt: normalizedEndsAt,
    timezone: assertNonEmptyString(timezone, "timezone"),
  });
}

export function createSourceFetchResult(
  input = {},
  { descriptor = null, window = null } = {},
) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("source fetch results must be an object");
  }

  const normalizedWindow = window == null ? null : createFetchWindow(window);
  const defaultDiscoveredAt = normalizedWindow?.endsAt ?? new Date().toISOString();
  const items = normalizeFetchItems(input.items ?? [], {
    descriptor,
    defaultDiscoveredAt,
  });
  const discoveredSources = normalizeDiscoveredSources(input.discoveredSources ?? []);

  return {
    items,
    discoveredSources,
    cursor: normalizeCursor(input.cursor),
  };
}

export function createFetchOrchestrationPlan({ registry, window } = {}) {
  if (!registry || typeof registry.list !== "function") {
    throw new TypeError("registry must expose list()");
  }

  const normalizedWindow = createFetchWindow(window);

  return Object.freeze(
    registry.list().map((adapter, index) =>
      Object.freeze({
        order: index,
        adapterId: adapter.descriptor.id,
        sourceKind: adapter.descriptor.kind,
        window: normalizedWindow,
      }),
    ),
  );
}

export class ContentFetcherCore {
  constructor({ registry, requiredSourceKinds = null } = {}) {
    if (!registry) {
      throw new TypeError("registry is required");
    }

    this.registry = registry;
    this.requiredSourceKinds = requiredSourceKinds;
  }

  async fetch(window) {
    const normalizedWindow = createFetchWindow(window);
    const fetchPlan = createFetchOrchestrationPlan({
      registry: this.registry,
      window: normalizedWindow,
    });

    if (
      Array.isArray(this.requiredSourceKinds) &&
      this.requiredSourceKinds.length > 0
    ) {
      this.registry.assertCoverage(this.requiredSourceKinds);
    }

    const batches = await Promise.all(
      fetchPlan.map((step) =>
        this.fetchFromAdapter(this.registry.get(step.adapterId), step.window),
      ),
    );
    const items = batches.flatMap((batch) => batch.items ?? []);
    const discoveredSources = batches.flatMap((batch) => batch.discoveredSources ?? []);
    const fetchReports = batches.map((batch) => batch.report);
    const fetchVerification = createFetchVerification(fetchReports, {
      requiredSourceKinds: this.requiredSourceKinds,
      fetchedItemCount: items.length,
      discoveredSourceCount: discoveredSources.length,
    });

    if (!fetchVerification.readyForCuration) {
      throw buildFetchFailureError(batches, fetchReports, fetchVerification);
    }

    return {
      window: normalizedWindow,
      fetchPlan,
      items,
      discoveredSources,
      fetchReports,
      fetchVerification,
    };
  }

  async fetchFromAdapter(adapter, window) {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();

    try {
      const result = await adapter.fetch(window);
      const normalizedResult = createSourceFetchResult(result, {
        descriptor: adapter.descriptor,
        window,
      });

      return {
        ok: true,
        items: normalizedResult.items.map((item) => annotateItemIdentitySignals(item)),
        discoveredSources: normalizedResult.discoveredSources.map((source) =>
          createDiscoveredSource(source),
        ),
        report: createFetchReport({
          adapter,
          status: "succeeded",
          fetchedCount: normalizedResult.items.length,
          discoveredSourceCount: normalizedResult.discoveredSources.length,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
        }),
      };
    } catch (error) {
      return {
        ok: false,
        error,
        items: [],
        discoveredSources: [],
        report: createFetchReport({
          adapter,
          status: "failed",
          fetchedCount: 0,
          discoveredSourceCount: 0,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
          error,
        }),
      };
    }
  }
}

function normalizeWindowHours(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError("windowHours must be a positive number");
  }

  return value;
}

function normalizeFetchItems(items, { descriptor, defaultDiscoveredAt }) {
  if (!Array.isArray(items)) {
    throw new TypeError("source fetch result items must be an array");
  }

  return items.map((item) =>
    createNormalizedItem({
      ...item,
      sourceKinds:
        item.sourceKinds ??
        (descriptor ? [descriptor.kind] : [item.sourceKind].filter(Boolean)),
      adapterIds:
        item.adapterIds ??
        (descriptor ? [descriptor.id] : [item.adapterId].filter(Boolean)),
      discoveredAt: item.discoveredAt ?? defaultDiscoveredAt,
      sourceAuthorityScore:
        item.sourceAuthorityScore ?? descriptor?.authorityScore ?? 0,
    }),
  );
}

function normalizeDiscoveredSources(discoveredSources) {
  if (!Array.isArray(discoveredSources)) {
    throw new TypeError("source fetch result discoveredSources must be an array");
  }

  return discoveredSources.map((source) => createDiscoveredSource(source));
}

function normalizeCursor(value) {
  if (value == null) {
    return null;
  }

  return assertNonEmptyString(value, "cursor");
}

function createFetchReport({
  adapter,
  status,
  fetchedCount,
  discoveredSourceCount,
  startedAt,
  completedAt,
  durationMs,
  error = null,
}) {
  const report = {
    adapterId: adapter.descriptor.id,
    sourceKind: adapter.descriptor.kind,
    status,
    fetchedCount,
    discoveredSourceCount,
    startedAt,
    completedAt,
    durationMs,
  };

  if (!error) {
    return report;
  }

  return {
    ...report,
    error: {
      name: error.name ?? "Error",
      message: error.message ?? String(error),
    },
  };
}

function createFetchVerification(
  fetchReports,
  { requiredSourceKinds = null, fetchedItemCount = 0, discoveredSourceCount = 0 } = {},
) {
  const successfulReports = fetchReports.filter((report) => report.status === "succeeded");
  const failedReports = fetchReports.filter((report) => report.status === "failed");
  const succeededSourceKinds = [...new Set(successfulReports.map((report) => report.sourceKind))];
  const failedSourceKinds = [...new Set(failedReports.map((report) => report.sourceKind))];
  const requiredKinds = Array.isArray(requiredSourceKinds)
    ? [...new Set(requiredSourceKinds)]
    : [];
  const missingRequiredSourceKinds = requiredKinds.filter(
    (kind) => !succeededSourceKinds.includes(kind),
  );
  const readyForCuration =
    successfulReports.length > 0 && missingRequiredSourceKinds.length === 0;
  const status = !readyForCuration
    ? "failed"
    : failedReports.length > 0 || missingRequiredSourceKinds.length > 0
      ? "partial"
      : "ok";

  return {
    status,
    readyForCuration,
    adapterCount: fetchReports.length,
    successfulAdapterCount: successfulReports.length,
    failedAdapterCount: failedReports.length,
    requiredSourceKinds: requiredKinds,
    succeededSourceKinds,
    failedSourceKinds,
    missingRequiredSourceKinds,
    fetchedItemCount,
    discoveredSourceCount,
  };
}

function buildFetchFailureError(batches, fetchReports, fetchVerification) {
  const failedBatches = batches.filter((batch) => !batch.ok);
  const error =
    failedBatches.length === 1
      ? failedBatches[0].error
      : new Error(
          failedBatches
            .map(
              (batch) =>
                `${batch.report.adapterId}: ${batch.report.error?.message ?? "unknown failure"}`,
            )
            .join("; "),
        );

  error.fetchReports = fetchReports;
  error.fetchVerification = fetchVerification;

  return error;
}
