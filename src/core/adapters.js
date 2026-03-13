import { SOURCE_KINDS, assertNonEmptyString } from "./contracts.js";
import { createFetchWindow, createSourceFetchResult } from "./content-fetcher.js";
import { createNormalizedItemFromSourceRecord, createSourceDescriptor } from "./schema.js";

export const DEFAULT_SOURCE_DESCRIPTORS = [
  createSourceDescriptor({
    id: "x",
    kind: "x",
    displayName: "X / Twitter",
    authorityScore: 72,
    seeded: true,
    supportsDiscovery: true,
    minimumItemAuthorityScore: 55,
  }),
  createSourceDescriptor({
    id: "github",
    kind: "github",
    displayName: "GitHub",
    authorityScore: 95,
    seeded: true,
    supportsDiscovery: true,
    minimumItemAuthorityScore: 70,
  }),
  createSourceDescriptor({
    id: "arxiv",
    kind: "arxiv",
    displayName: "arXiv",
    authorityScore: 90,
    seeded: true,
    supportsDiscovery: true,
    minimumItemAuthorityScore: 70,
  }),
  createSourceDescriptor({
    id: "reddit",
    kind: "reddit",
    displayName: "Reddit",
    authorityScore: 60,
    seeded: true,
    supportsDiscovery: true,
    minimumItemAuthorityScore: 50,
  }),
  createSourceDescriptor({
    id: "web-discovery",
    kind: "web",
    displayName: "Broader Web Discovery",
    authorityScore: 50,
    seeded: true,
    supportsDiscovery: true,
    minimumItemAuthorityScore: 50,
  }),
];

export function createSourceRegistry(adapters = []) {
  return new SourceRegistry(collectRegistryAdapters(adapters));
}

export function defineSourceAdapter(input) {
  if (input?.descriptor) {
    const descriptor = createSourceDescriptor(input.descriptor);

    if (typeof input.fetch !== "function") {
      throw new TypeError(`adapter ${descriptor.id} must expose a fetch(window) function`);
    }

    const fetch = input.fetch.bind?.(input) ?? input.fetch;

    return {
      descriptor,
      async fetch(window) {
        const normalizedWindow = createFetchWindow(window);
        const result = await fetch(normalizedWindow);

        return createSourceFetchResult(result, {
          descriptor,
          window: normalizedWindow,
        });
      },
    };
  }

  if (typeof input?.fetchItems === "function") {
    const descriptor = createSourceDescriptor({
      id: input.id,
      kind: mapLegacyTypeToKind(input.type),
      displayName: input.name,
      authorityScore: defaultAuthorityForKind(mapLegacyTypeToKind(input.type)),
      seeded: false,
      supportsDiscovery: true,
      minimumItemAuthorityScore: defaultMinimumItemAuthorityForKind(
        mapLegacyTypeToKind(input.type),
      ),
    });

    return {
      descriptor,
      fetch: async (window) => {
        const normalizedWindow = createFetchWindow(window);
        const records = await input.fetchItems({
          since: normalizedWindow.startsAt,
          until: normalizedWindow.endsAt,
          timezone: normalizedWindow.timezone,
        });

        return createSourceFetchResult({
          items: records.map((record) =>
            createNormalizedItemFromSourceRecord(record, {
              sourceKind: descriptor.kind,
            }),
          ),
        }, {
          descriptor,
          window: normalizedWindow,
        });
      },
    };
  }

  throw new TypeError("source adapters must provide either { descriptor, fetch } or fetchItems()");
}

export class SourceRegistry {
  constructor(adapters = []) {
    this.adapters = new Map();
    this.registerMany(adapters);
  }

  register(adapter) {
    const normalizedAdapter = defineSourceAdapter(adapter);
    const { id } = normalizedAdapter.descriptor;

    if (this.adapters.has(id)) {
      throw new Error(`adapter "${id}" is already registered`);
    }

    this.adapters.set(id, normalizedAdapter);
    return normalizedAdapter;
  }

  registerMany(adapters) {
    for (const adapter of adapters) {
      this.register(adapter);
    }

    return this;
  }

  get(id) {
    return this.adapters.get(assertNonEmptyString(id, "id")) ?? null;
  }

  list() {
    return [...this.adapters.values()];
  }

  assertCoverage(requiredKinds = SOURCE_KINDS) {
    const availableKinds = new Set(this.list().map((adapter) => adapter.descriptor.kind));
    const missingKinds = requiredKinds.filter((kind) => !availableKinds.has(kind));

    if (missingKinds.length > 0) {
      throw new Error(`missing source adapter coverage for: ${missingKinds.join(", ")}`);
    }
  }
}

function collectRegistryAdapters(input, collected = []) {
  if (input == null) {
    return collected;
  }

  if (input instanceof Map) {
    for (const entry of input.values()) {
      collectRegistryAdapters(entry, collected);
    }

    return collected;
  }

  if (input instanceof SourceRegistry) {
    collected.push(...input.list());
    return collected;
  }

  if (Array.isArray(input)) {
    for (const entry of input) {
      collectRegistryAdapters(entry, collected);
    }

    return collected;
  }

  if (isIterableCollection(input)) {
    for (const entry of input) {
      collectRegistryAdapters(entry, collected);
    }

    return collected;
  }

  if (isAdapterLike(input)) {
    if (input.enabled !== false) {
      collected.push(input);
    }

    return collected;
  }

  if (typeof input === "object") {
    for (const entry of Object.values(input)) {
      collectRegistryAdapters(entry, collected);
    }

    return collected;
  }

  throw new TypeError(
    "source registry adapters must be adapters, arrays, iterables, or keyed adapter objects",
  );
}

function isAdapterLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (typeof value.fetchItems === "function" ||
        typeof value.fetch === "function" ||
        value.descriptor),
  );
}

function isIterableCollection(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !isAdapterLike(value) &&
    typeof value[Symbol.iterator] === "function"
  );
}

function mapLegacyTypeToKind(type) {
  const normalized = String(type ?? "web").trim().toLowerCase();

  if (normalized === "twitter") {
    return "x";
  }

  if (SOURCE_KINDS.includes(normalized)) {
    return normalized;
  }

  return "web";
}

function defaultAuthorityForKind(kind) {
  return DEFAULT_SOURCE_DESCRIPTORS.find((descriptor) => descriptor.kind === kind)?.authorityScore ?? 50;
}

function defaultMinimumItemAuthorityForKind(kind) {
  return (
    DEFAULT_SOURCE_DESCRIPTORS.find((descriptor) => descriptor.kind === kind)
      ?.minimumItemAuthorityScore ?? 50
  );
}
