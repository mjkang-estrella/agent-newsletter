import {
  SourceRepository,
  normalizeSourceRepositorySnapshot,
} from "../discovery/source-repository.js";
import { normalizeTimestamp } from "../core/contracts.js";
import { SOURCE_REGISTRY_STATE_KEY } from "./shared.js";

export class SupabaseSourceRepository extends SourceRepository {
  constructor({ dataStore, seedSources, config } = {}) {
    if (
      !dataStore ||
      typeof dataStore.getRuntimeState !== "function" ||
      typeof dataStore.setRuntimeState !== "function"
    ) {
      throw new TypeError(
        "dataStore must expose getRuntimeState() and setRuntimeState()",
      );
    }

    super({
      filePath: "__supabase__",
      ...(seedSources ? { seedSources } : {}),
      ...(config ? { config } : {}),
    });

    this.dataStore = dataStore;
  }

  async save(snapshot) {
    const normalizedSnapshot = normalizeSourceRepositorySnapshot(
      snapshot,
      snapshot?.updatedAt ?? new Date().toISOString(),
      this.config,
    );

    await this.dataStore.setRuntimeState(
      SOURCE_REGISTRY_STATE_KEY,
      normalizedSnapshot,
      {
        updatedAt: normalizedSnapshot.updatedAt,
      },
    );
  }

  async readSnapshot(now) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const snapshot = await this.dataStore.getRuntimeState(SOURCE_REGISTRY_STATE_KEY);
    return normalizeSourceRepositorySnapshot(snapshot, normalizedNow, this.config);
  }
}
