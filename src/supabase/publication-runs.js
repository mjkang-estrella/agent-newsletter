export class SupabasePublicationRunRepository {
  constructor({ dataStore } = {}) {
    if (
      !dataStore ||
      typeof dataStore.tryStartPublicationRun !== "function" ||
      typeof dataStore.markPublicationRunCompleted !== "function" ||
      typeof dataStore.markPublicationRunFailed !== "function"
    ) {
      throw new TypeError(
        "dataStore must expose publication run methods",
      );
    }

    this.dataStore = dataStore;
  }

  async tryStartRun(options = {}) {
    return this.dataStore.tryStartPublicationRun(options);
  }

  async getRun(slot) {
    return this.dataStore.getPublicationRun(slot);
  }

  async markCompleted(options = {}) {
    return this.dataStore.markPublicationRunCompleted(options);
  }

  async markFailed(options = {}) {
    return this.dataStore.markPublicationRunFailed(options);
  }
}
