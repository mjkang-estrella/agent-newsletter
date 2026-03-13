import {
  ItemIdentityRepository,
  normalizeItemIdentitySnapshot,
} from "../newsletter/item-identity-repository.js";
import { normalizeTimestamp } from "../core/contracts.js";
import { ITEM_IDENTITY_REGISTRY_STATE_KEY } from "./shared.js";

export class SupabaseItemIdentityRepository extends ItemIdentityRepository {
  constructor({ dataStore, defaultScopeVersion, itemResolutionService } = {}) {
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
      ...(defaultScopeVersion ? { defaultScopeVersion } : {}),
      ...(itemResolutionService ? { itemResolutionService } : {}),
    });

    this.dataStore = dataStore;
  }

  async save(snapshot) {
    const normalizedSnapshot = normalizeItemIdentitySnapshot(
      snapshot,
      snapshot?.updatedAt ?? new Date().toISOString(),
      {
        defaultScopeVersion: this.defaultScopeVersion,
      },
    );

    await this.dataStore.setRuntimeState(
      ITEM_IDENTITY_REGISTRY_STATE_KEY,
      normalizedSnapshot,
      {
        updatedAt: normalizedSnapshot.updatedAt,
      },
    );
  }

  async readSnapshot(now) {
    const normalizedNow = normalizeTimestamp(now, "now");
    const snapshot = await this.dataStore.getRuntimeState(ITEM_IDENTITY_REGISTRY_STATE_KEY);
    return normalizeItemIdentitySnapshot(snapshot, normalizedNow, {
      defaultScopeVersion: this.defaultScopeVersion,
    });
  }
}
