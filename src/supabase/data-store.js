import {
  cloneJsonValue,
  isSupabaseNoRowsError,
  isSupabaseUniqueViolation,
  resolveNowTimestamp,
  serializeError,
} from "./shared.js";

export class SupabaseNewsletterDataStore {
  constructor({ client, now = () => new Date().toISOString() } = {}) {
    if (!client || typeof client.from !== "function" || typeof client.rpc !== "function") {
      throw new TypeError("client must expose from() and rpc()");
    }

    if (typeof now !== "function") {
      throw new TypeError("now must be a function");
    }

    this.client = client;
    this.now = now;
  }

  async getRuntimeState(key) {
    const { data, error } = await this.client
      .from("newsletter_runtime_state")
      .select("payload")
      .eq("key", key)
      .maybeSingle();

    if (error && !isSupabaseNoRowsError(error)) {
      throw error;
    }

    return data?.payload ? cloneJsonValue(data.payload) : null;
  }

  async setRuntimeState(key, snapshot, { updatedAt } = {}) {
    const normalizedUpdatedAt = updatedAt ?? snapshot?.updatedAt ?? resolveNowTimestamp(this.now);
    const { data, error } = await this.client
      .from("newsletter_runtime_state")
      .upsert(
        {
          key,
          payload: cloneJsonValue(snapshot),
          updated_at: normalizedUpdatedAt,
        },
        {
          onConflict: "key",
        },
      )
      .select("payload")
      .single();

    if (error) {
      throw error;
    }

    return cloneJsonValue(data.payload);
  }

  async insertEdition(edition) {
    const payload = cloneJsonValue(edition);
    const { data, error } = await this.client
      .from("newsletter_editions")
      .insert({
        id: edition.id,
        published_at: edition.publishedAt,
        payload,
        created_at: resolveNowTimestamp(this.now),
      })
      .select("payload")
      .single();

    if (error) {
      if (!isSupabaseUniqueViolation(error)) {
        throw error;
      }

      const existing =
        (await this.getEditionPayloadById(edition.id)) ??
        (await this.getEditionPayloadByPublishedAt(edition.publishedAt));

      if (existing) {
        return existing;
      }

      throw error;
    }

    return cloneJsonValue(data.payload);
  }

  async listEditionPayloads({ before = resolveNowTimestamp(this.now) } = {}) {
    const { data, error } = await this.client
      .from("newsletter_editions")
      .select("payload")
      .lte("published_at", before)
      .order("published_at", { ascending: false });

    if (error) {
      throw error;
    }

    return Array.isArray(data) ? data.map((row) => cloneJsonValue(row.payload)) : [];
  }

  async getEditionPayloadById(id) {
    const { data, error } = await this.client
      .from("newsletter_editions")
      .select("payload")
      .eq("id", id)
      .maybeSingle();

    if (error && !isSupabaseNoRowsError(error)) {
      throw error;
    }

    return data?.payload ? cloneJsonValue(data.payload) : null;
  }

  async getEditionPayloadByPublishedAt(publishedAt) {
    const { data, error } = await this.client
      .from("newsletter_editions")
      .select("payload")
      .eq("published_at", publishedAt)
      .maybeSingle();

    if (error && !isSupabaseNoRowsError(error)) {
      throw error;
    }

    return data?.payload ? cloneJsonValue(data.payload) : null;
  }

  async tryStartPublicationRun({
    slot,
    startedAt = resolveNowTimestamp(this.now),
    forced = false,
  } = {}) {
    const attemptedInsert = await this.client
      .from("newsletter_publication_runs")
      .insert({
        slot,
        status: "running",
        forced,
        started_at: startedAt,
      })
      .select("*")
      .single();

    if (!attemptedInsert.error) {
      return {
        acquired: true,
        record: normalizePublicationRunRecord(attemptedInsert.data),
      };
    }

    if (!isSupabaseUniqueViolation(attemptedInsert.error)) {
      throw attemptedInsert.error;
    }

    const existing = await this.getPublicationRun(slot);

    if (existing?.status === "failed" && !existing.editionId) {
      const retry = await this.client
        .from("newsletter_publication_runs")
        .update({
          status: "running",
          forced,
          started_at: startedAt,
          finished_at: null,
          error: null,
        })
        .eq("slot", slot)
        .eq("status", "failed")
        .select("*")
        .maybeSingle();

      if (retry.error && !isSupabaseNoRowsError(retry.error)) {
        throw retry.error;
      }

      if (retry.data) {
        return {
          acquired: true,
          record: normalizePublicationRunRecord(retry.data),
        };
      }
    }

    return {
      acquired: false,
      record: existing,
    };
  }

  async getPublicationRun(slot) {
    const { data, error } = await this.client
      .from("newsletter_publication_runs")
      .select("*")
      .eq("slot", slot)
      .maybeSingle();

    if (error && !isSupabaseNoRowsError(error)) {
      throw error;
    }

    return data ? normalizePublicationRunRecord(data) : null;
  }

  async markPublicationRunCompleted({
    slot,
    editionId,
    finishedAt = resolveNowTimestamp(this.now),
  } = {}) {
    const { error } = await this.client
      .from("newsletter_publication_runs")
      .update({
        status: "completed",
        edition_id: editionId,
        finished_at: finishedAt,
        error: null,
      })
      .eq("slot", slot);

    if (error) {
      throw error;
    }
  }

  async markPublicationRunFailed({
    slot,
    error,
    finishedAt = resolveNowTimestamp(this.now),
  } = {}) {
    const { error: updateError } = await this.client
      .from("newsletter_publication_runs")
      .update({
        status: "failed",
        finished_at: finishedAt,
        error: cloneJsonValue(error ?? null),
      })
      .eq("slot", slot);

    if (updateError) {
      throw updateError;
    }
  }

  async consumeRateLimit({
    key,
    maxRequests,
    windowMs,
    now = resolveNowTimestamp(this.now),
  } = {}) {
    const { data, error } = await this.client.rpc("consume_newsletter_rate_limit", {
      p_key: key,
      p_limit: maxRequests,
      p_window_ms: windowMs,
      p_now: now,
    });

    if (error) {
      throw error;
    }

    const record = Array.isArray(data) ? data[0] : data;

    if (!record) {
      throw new Error("consume_newsletter_rate_limit returned no record");
    }

    return {
      key: record.key,
      count: Number(record.count),
      remaining: Number(record.remaining),
      limited: Boolean(record.limited),
      resetAt: record.reset_at,
    };
  }

  async insertConsumerEvent(event) {
    const { error } = await this.client.from("newsletter_consumer_events").insert({
      occurred_at: event.occurredAt,
      consumer_id: event.consumerId,
      identity_source: event.identitySource,
      declared_id: event.declaredId ?? null,
      user_agent: event.userAgent ?? null,
      client_ip: event.clientIp ?? null,
      method: event.method,
      path: event.path,
      outcome: event.outcome,
      rate_limit: cloneJsonValue(event.rateLimit ?? null),
      metadata: cloneJsonValue(event.metadata ?? null),
    });

    if (error) {
      throw error;
    }
  }
}

export class InMemorySupabaseNewsletterDataStore {
  constructor({ now = () => new Date().toISOString() } = {}) {
    if (typeof now !== "function") {
      throw new TypeError("now must be a function");
    }

    this.now = now;
    this.runtimeStates = new Map();
    this.editionsById = new Map();
    this.editionIdsByPublishedAt = new Map();
    this.publicationRuns = new Map();
    this.rateLimits = new Map();
    this.consumerEvents = [];
  }

  async getRuntimeState(key) {
    return cloneJsonValue(this.runtimeStates.get(key) ?? null);
  }

  async setRuntimeState(key, snapshot) {
    this.runtimeStates.set(key, cloneJsonValue(snapshot));
    return cloneJsonValue(snapshot);
  }

  async insertEdition(edition) {
    const existingId = this.editionIdsByPublishedAt.get(edition.publishedAt);

    if (existingId) {
      return cloneJsonValue(this.editionsById.get(existingId));
    }

    const payload = cloneJsonValue(edition);
    this.editionsById.set(edition.id, payload);
    this.editionIdsByPublishedAt.set(edition.publishedAt, edition.id);
    return cloneJsonValue(payload);
  }

  async listEditionPayloads({ before = resolveNowTimestamp(this.now) } = {}) {
    return [...this.editionsById.values()]
      .filter((edition) => new Date(edition.publishedAt).getTime() <= new Date(before).getTime())
      .sort(
        (left, right) =>
          new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
      )
      .map((edition) => cloneJsonValue(edition));
  }

  async getEditionPayloadById(id) {
    return cloneJsonValue(this.editionsById.get(id) ?? null);
  }

  async getEditionPayloadByPublishedAt(publishedAt) {
    const editionId = this.editionIdsByPublishedAt.get(publishedAt);
    return editionId ? cloneJsonValue(this.editionsById.get(editionId) ?? null) : null;
  }

  async tryStartPublicationRun({
    slot,
    startedAt = resolveNowTimestamp(this.now),
    forced = false,
  } = {}) {
    const existing = this.publicationRuns.get(slot);

    if (existing && !(existing.status === "failed" && !existing.editionId)) {
      return {
        acquired: false,
        record: cloneJsonValue(existing),
      };
    }

    const nextRecord = normalizePublicationRunRecord({
      slot,
      status: "running",
      forced,
      started_at: startedAt,
      finished_at: null,
      edition_id: null,
      error: null,
    });
    this.publicationRuns.set(slot, nextRecord);

    return {
      acquired: true,
      record: cloneJsonValue(nextRecord),
    };
  }

  async getPublicationRun(slot) {
    return cloneJsonValue(this.publicationRuns.get(slot) ?? null);
  }

  async markPublicationRunCompleted({
    slot,
    editionId,
    finishedAt = resolveNowTimestamp(this.now),
  } = {}) {
    const existing = this.publicationRuns.get(slot);

    if (!existing) {
      throw new Error(`Unknown publication run slot: ${slot}`);
    }

    this.publicationRuns.set(
      slot,
      normalizePublicationRunRecord({
        ...existing,
        status: "completed",
        edition_id: editionId,
        finished_at: finishedAt,
        error: null,
      }),
    );
  }

  async markPublicationRunFailed({
    slot,
    error,
    finishedAt = resolveNowTimestamp(this.now),
  } = {}) {
    const existing = this.publicationRuns.get(slot);

    if (!existing) {
      throw new Error(`Unknown publication run slot: ${slot}`);
    }

    this.publicationRuns.set(
      slot,
      normalizePublicationRunRecord({
        ...existing,
        status: "failed",
        finished_at: finishedAt,
        error: cloneJsonValue(error ?? null),
      }),
    );
  }

  async consumeRateLimit({
    key,
    maxRequests,
    windowMs,
    now = resolveNowTimestamp(this.now),
  } = {}) {
    const nowMs = new Date(now).getTime();
    const existing = this.rateLimits.get(key);
    const isActive = existing && existing.resetAtMs > nowMs;
    const nextRecord = isActive
      ? {
          count: existing.count + 1,
          resetAtMs: existing.resetAtMs,
        }
      : {
          count: 1,
          resetAtMs: nowMs + windowMs,
        };

    this.rateLimits.set(key, nextRecord);

    return {
      key,
      count: nextRecord.count,
      remaining: Math.max(maxRequests - nextRecord.count, 0),
      limited: nextRecord.count > maxRequests,
      resetAt: new Date(nextRecord.resetAtMs).toISOString(),
    };
  }

  async insertConsumerEvent(event) {
    this.consumerEvents.push(cloneJsonValue(event));
  }

  snapshot() {
    return {
      runtimeStates: cloneJsonValue(Object.fromEntries(this.runtimeStates)),
      editions: cloneJsonValue([...this.editionsById.values()]),
      publicationRuns: cloneJsonValue([...this.publicationRuns.values()]),
      rateLimits: cloneJsonValue(
        [...this.rateLimits.entries()].map(([key, value]) => ({
          key,
          ...value,
        })),
      ),
      consumerEvents: cloneJsonValue(this.consumerEvents),
    };
  }
}

function normalizePublicationRunRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  return {
    slot: record.slot,
    status: record.status,
    forced: Boolean(record.forced),
    startedAt: record.started_at ?? record.startedAt ?? null,
    finishedAt: record.finished_at ?? record.finishedAt ?? null,
    editionId: record.edition_id ?? record.editionId ?? null,
    error: cloneJsonValue(record.error ?? null),
  };
}

export function createSerializedErrorRecord(error) {
  return serializeError(error);
}
