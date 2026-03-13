import {
  createNormalizedItemFromSourceRecord,
  createSourceDescriptor,
} from "../core/schema.js";
import {
  SourceAdapter,
  SourceAdapterConfigurationError,
} from "./source-adapter.js";
import {
  DEFAULT_TWITTER_ADAPTER_ID,
  DEFAULT_TWITTER_ADAPTER_NAME,
  DEFAULT_TWITTER_BASE_URL,
  DEFAULT_TWITTER_MAX_RESULTS,
  DEFAULT_TWITTER_PROVIDER,
  DEFAULT_TWITTER_QUERY,
  buildTwitterRequestPlan,
  createTwitterProviderContract,
  createTwitterProviderConfig,
  createTwitterProviderHooks,
  createTwitterProviderRequestContext,
  getTwitterCredentialStatus,
  resolveTwitterProviderClient,
  validateTwitterProviderConfig,
} from "./twitter-provider-client.js";

export {
  DEFAULT_TWITTER_ADAPTER_ID,
  DEFAULT_TWITTER_ADAPTER_NAME,
  DEFAULT_TWITTER_BASE_URL,
  DEFAULT_TWITTER_MAX_RESULTS,
  DEFAULT_TWITTER_PROVIDER,
  DEFAULT_TWITTER_QUERY,
} from "./twitter-provider-client.js";

const TWITTER_AUTHORITY_SCORE = 72;
const TWITTER_MINIMUM_ITEM_AUTHORITY_SCORE = 55;

export class TwitterSourceAdapter extends SourceAdapter {
  constructor({
    id = DEFAULT_TWITTER_ADAPTER_ID,
    name = DEFAULT_TWITTER_ADAPTER_NAME,
    enabled = true,
    client = null,
    clientFactory = null,
    fetch: fetchImpl = globalThis.fetch,
    provider = DEFAULT_TWITTER_PROVIDER,
    baseUrl = DEFAULT_TWITTER_BASE_URL,
    query = DEFAULT_TWITTER_QUERY,
    maxResults = DEFAULT_TWITTER_MAX_RESULTS,
    bearerToken = "",
    apiKey = "",
    apiSecret = "",
    accountId = "",
    rateLimitMaxRetries = undefined,
    rateLimitRetryAfterMs = undefined,
    providerHooks = {},
  } = {}) {
    super({
      id,
      name,
      type: "twitter",
      enabled,
    });

    this.descriptor = createSourceDescriptor({
      id,
      kind: "x",
      displayName: name,
      authorityScore: TWITTER_AUTHORITY_SCORE,
      seeded: true,
      supportsDiscovery: true,
      minimumItemAuthorityScore: TWITTER_MINIMUM_ITEM_AUTHORITY_SCORE,
    });
    this.config = createTwitterProviderConfig({
      provider,
      baseUrl,
      query,
      maxResults,
      bearerToken,
      apiKey,
      apiSecret,
      accountId,
      rateLimitMaxRetries,
      rateLimitRetryAfterMs,
    });
    this.providerHooks = createTwitterProviderHooks(providerHooks);
    this.provider = this.config.provider;
    this.baseUrl = this.config.baseUrl;
    this.query = this.config.query;
    this.maxResults = this.config.maxResults;
    this.bearerToken = this.config.bearerToken;
    this.apiKey = this.config.apiKey;
    this.apiSecret = this.config.apiSecret;
    this.accountId = this.config.accountId;
    this.rateLimitMaxRetries = this.config.rateLimitMaxRetries;
    this.rateLimitRetryAfterMs = this.config.rateLimitRetryAfterMs;
    this.providerContract = createTwitterProviderContract({
      adapterId: this.id,
      adapterName: this.name,
      config: this.config,
      hooks: this.providerHooks,
    });
    this.client = resolveTwitterProviderClient({
      client,
      clientFactory,
      adapterId: this.id,
      adapterName: this.name,
      config: this.config,
      hooks: this.providerHooks,
      fetch: fetchImpl,
    });
  }

  getCredentialStatus() {
    if (!this.enabled) {
      return {
        configured: false,
        missing: [],
        authStrategy: "disabled",
      };
    }

    return getTwitterCredentialStatus(this.config);
  }

  validateConfig() {
    return validateTwitterProviderConfig(this.config);
  }

  buildRequestPlan({ since, until } = {}) {
    return buildTwitterRequestPlan(this.config, { since, until });
  }

  buildRequestContext({ since, until } = {}) {
    return createTwitterProviderRequestContext({
      adapterId: this.id,
      adapterName: this.name,
      requestPlan: this.buildRequestPlan({ since, until }),
      providerContract: this.providerContract,
    });
  }

  async search(window = {}) {
    this.assertEnabled();
    const response = await this.client.searchRecent(
      this.buildRequestContext(window),
    );

    if (!Array.isArray(response.records)) {
      throw new SourceAdapterConfigurationError(
        "X/Twitter provider client must return a response with a records array.",
      );
    }

    return response;
  }

  async fetchItems(window = {}) {
    const response = await this.search(window);
    return response.records;
  }

  async fetch(window = {}) {
    const response = await this.search({
      since: window.startsAt ?? window.since,
      until: window.endsAt ?? window.until,
    });

    return {
      items: response.records.map((record) =>
        createNormalizedItemFromSourceRecord(record, {
          sourceKind: this.descriptor.kind,
        }),
      ),
      discoveredSources: [],
      cursor: response.cursor ?? null,
    };
  }
}
