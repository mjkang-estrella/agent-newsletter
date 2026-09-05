import test from "node:test";
import assert from "./helpers/legacy-contract-assert.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME,
  API_RATE_LIMIT_TRUST_PROXY_ENV_NAME,
  API_RATE_LIMIT_WINDOW_MS_ENV_NAME,
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  DEFAULT_MIN_RELEVANCE_SCORE,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  createPublicationConfig,
  createPublicationFlow,
  createNewsletterScopeDefinition,
  createNormalizedItem,
  createPublicationPlan,
  createNewsletterRuntimeConfig,
  NewsletterEditionStore,
  ItemIdentityRepository,
  PUBLICATION_TIMEZONE_ENV_NAME,
  SourceDiscoveryService,
  SourceRepository,
  createNormalizedItemFromSourceRecord,
} from "../src/index.js";

function buildScopeDefinition(version) {
  return createNewsletterScopeDefinition({
    currentVersion: version,
    scopeDefinition: {
      ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.scopeDefinition,
      version,
      effectiveAt: "2026-06-12T00:00:00.000Z",
      reviewedAt: "2026-06-12T00:00:00.000Z",
      nextReviewAt: "2026-09-12T00:00:00.000Z",
    },
    changelog: [
      ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.changelog,
      {
        version,
        changeType: "minor",
        effectiveAt: "2026-06-12T00:00:00.000Z",
        summary: "Refined the agent boundary for later editorial reviews.",
        rationale:
          "Published editions should retain the active scope version used for inclusion decisions.",
        scopeChanges: [
          "Tracked the active scope version on persisted edition items.",
        ],
      },
    ],
  });
}

test("createPublicationConfig defaults the deployment timezone to UTC", () => {
  assert.deepEqual(createPublicationConfig({}), {
    baseTimezone: "UTC",
    publicationHour: 21,
    publicationMinute: 0,
    publicationCronExpression: "0 21 * * *",
  });
});

test("createPublicationConfig reads and validates the deployment timezone", () => {
  assert.deepEqual(
    createPublicationConfig({
      [PUBLICATION_TIMEZONE_ENV_NAME]: "America/Los_Angeles",
    }),
    {
      baseTimezone: "America/Los_Angeles",
      publicationHour: 21,
      publicationMinute: 0,
      publicationCronExpression: "0 21 * * *",
    },
  );

  assert.throws(
    () =>
      createPublicationConfig({
        [PUBLICATION_TIMEZONE_ENV_NAME]: "Mars/Olympus_Mons",
      }),
    /baseTimezone must be a valid IANA timezone/,
  );
});

test("createNewsletterRuntimeConfig exposes the publication timezone in runtime config", () => {
  assert.deepEqual(createNewsletterRuntimeConfig({}), {
    api: {
      rateLimit: {
        maxRequests: 60,
        windowMs: 60_000,
        trustProxy: false,
      },
    },
    publication: {
      baseTimezone: "UTC",
      hour: 21,
      minute: 0,
      cronExpression: "0 21 * * *",
    },
  });

  assert.deepEqual(
    createNewsletterRuntimeConfig({
      [API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME]: "15",
      [API_RATE_LIMIT_WINDOW_MS_ENV_NAME]: "120000",
      [API_RATE_LIMIT_TRUST_PROXY_ENV_NAME]: "true",
      [PUBLICATION_TIMEZONE_ENV_NAME]: "America/Los_Angeles",
    }),
    {
      api: {
        rateLimit: {
          maxRequests: 15,
          windowMs: 120_000,
          trustProxy: true,
        },
      },
      publication: {
        baseTimezone: "America/Los_Angeles",
        hour: 21,
        minute: 0,
        cronExpression: "0 21 * * *",
      },
    },
  );
});

test("publication flow exposes deployment config through the app runtime config", () => {
  const flow = createPublicationFlow({
    env: {
      [API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME]: "15",
      [API_RATE_LIMIT_WINDOW_MS_ENV_NAME]: "120000",
      [API_RATE_LIMIT_TRUST_PROXY_ENV_NAME]: "true",
      [PUBLICATION_TIMEZONE_ENV_NAME]: "America/Los_Angeles",
    },
    pipeline: {
      async aggregate() {
        return { items: [] };
      },
    },
    editionStore: {
      async publish(edition) {
        return edition;
      },
    },
  });

  assert.deepEqual(flow.getConfig(), {
    api: {
      rateLimit: {
        maxRequests: 15,
        windowMs: 120_000,
        trustProxy: true,
      },
    },
    publication: {
      baseTimezone: "America/Los_Angeles",
      hour: 21,
      minute: 0,
      cronExpression: "0 21 * * *",
    },
  });
});

test("createPublicationPlan resolves the previous 24-hour edition window in the configured timezone", () => {
  const plan = createPublicationPlan({
    now: "2026-03-12T05:30:00.000Z",
    timezone: "America/Los_Angeles",
  });

  assert.deepEqual(plan, {
    publishedAt: "2026-03-12T04:00:00.000Z",
    window: {
      startsAt: "2026-03-11T04:00:00.000Z",
      endsAt: "2026-03-12T04:00:00.000Z",
      timezone: "America/Los_Angeles",
    },
  });
});

test("publication flow reads the base timezone from env at publish time", async () => {
  const env = {
    [PUBLICATION_TIMEZONE_ENV_NAME]: "America/Los_Angeles",
  };
  const aggregateWindows = [];
  const publishedEditions = [];
  const flow = createPublicationFlow({
    env,
    now: () => "2026-03-12T05:30:00.000Z",
    pipeline: {
      async aggregate(window) {
        aggregateWindows.push(window);
        return { items: [] };
      },
    },
    editionStore: {
      async publish(edition) {
        publishedEditions.push(edition);
        return edition;
      },
    },
  });

  await flow.publishEdition();

  env[PUBLICATION_TIMEZONE_ENV_NAME] = "America/New_York";

  await flow.publishEdition();

  assert.deepEqual(aggregateWindows, [
    {
      startsAt: "2026-03-11T04:00:00.000Z",
      endsAt: "2026-03-12T04:00:00.000Z",
      timezone: "America/Los_Angeles",
    },
    {
      startsAt: "2026-03-11T01:00:00.000Z",
      endsAt: "2026-03-12T01:00:00.000Z",
      timezone: "America/New_York",
    },
  ]);
  assert.deepEqual(publishedEditions, [
    {
      publishedAt: "2026-03-12T04:00:00.000Z",
      window: {
        startsAt: "2026-03-11T04:00:00.000Z",
        endsAt: "2026-03-12T04:00:00.000Z",
        timezone: "America/Los_Angeles",
      },
      exclusionSummary: {
        totalExcludedItems: 0,
        countsByCategory: [],
        countsByReasonCode: [],
        countsByCategoryAndReason: [],
      },
      items: [],
    },
    {
      publishedAt: "2026-03-12T01:00:00.000Z",
      window: {
        startsAt: "2026-03-11T01:00:00.000Z",
        endsAt: "2026-03-12T01:00:00.000Z",
        timezone: "America/New_York",
      },
      exclusionSummary: {
        totalExcludedItems: 0,
        countsByCategory: [],
        countsByReasonCode: [],
        countsByCategoryAndReason: [],
      },
      items: [],
    },
  ]);
});

test("publication flow reuses an existing edition for the active publication slot", async () => {
  const existingEdition = {
    id: "2026-03-12",
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
    exclusionSummary: {
      totalExcludedItems: 0,
      countsByCategory: [],
      countsByReasonCode: [],
      countsByCategoryAndReason: [],
    },
    items: [
      {
        id: "github-agent-sdk",
        itemId: "persistent-agent-sdk-item",
        name: "Agent SDK",
        category: "library",
        sourceUrl: "https://github.com/example/agent-sdk",
        sourceUrls: ["https://github.com/example/agent-sdk"],
        summary: "A tool-using agent SDK.",
        integrationHint: "npm install agent-sdk",
        relevanceScore: 88,
        scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        publishedAt: "2026-03-12T21:00:00.000Z",
      },
    ],
  };
  let aggregateCalls = 0;
  let publishCalls = 0;
  let discoveryCalls = 0;
  const flow = createPublicationFlow({
    now: () => "2026-03-12T21:15:00.000Z",
    pipeline: {
      async aggregate() {
        aggregateCalls += 1;
        return { items: [] };
      },
    },
    sourceDiscoveryService: {
      async discoverFromItems() {
        discoveryCalls += 1;
      },
    },
    editionStore: {
      async loadLatest({ now }) {
        assert.equal(now, "2026-03-12T21:00:00.000Z");
        return existingEdition;
      },
      async publish() {
        publishCalls += 1;
        return null;
      },
    },
  });

  const edition = await flow.publishEdition();

  assert.equal(edition, existingEdition);
  assert.equal(aggregateCalls, 0);
  assert.equal(discoveryCalls, 0);
  assert.equal(publishCalls, 0);
});

test("publication flow finalizes and stores an exclusion summary grouped by category and reason", async () => {
  const publishedEditions = [];
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [],
          exclusionDecisions: [
            {
              itemId: "artifact-github-com-example-low-signal-agent",
              name: "Low-Signal Agent Repo",
              category: "tool",
              sourceUrl: "https://github.com/example/low-signal-agent",
              stage: "relevance_gate",
              reasonCode: "relevance_below_threshold",
            },
            {
              itemId: "artifact-docs-unknown-example-sdk",
              name: "Unknown Agent SDK",
              category: "library",
              sourceUrl: "https://unknown.example.com/post",
              stage: "source_gate",
              reasonCode: "source_not_approved",
            },
            {
              itemId: "artifact-docs-unknown-example-api",
              name: "Unknown Agent API",
              category: "library",
              sourceUrl: "https://unknown.example.com/api",
              stage: "source_gate",
              reasonCode: "source_not_approved",
            },
          ],
        };
      },
    },
    editionStore: {
      async publish(edition) {
        publishedEditions.push(edition);
        return edition;
      },
    },
  });

  const edition = await flow.publishEdition();

  assert.deepEqual(edition.exclusionSummary, {
    totalExcludedItems: 3,
    countsByCategory: [
      {
        category: "tool",
        count: 1,
      },
      {
        category: "library",
        count: 2,
      },
    ],
    countsByReasonCode: [
      {
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
      {
        reasonCode: "source_not_approved",
        count: 2,
      },
    ],
    countsByCategoryAndReason: [
      {
        category: "tool",
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
      {
        category: "library",
        reasonCode: "source_not_approved",
        count: 2,
      },
    ],
  });
  assert.deepEqual(publishedEditions, [edition]);
});

test("publication flow persists queryable exclusion records for downstream analytics", async () => {
  const publishedEditions = [];
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [],
          exclusionDecisions: [
            {
              itemId: "artifact-github-com-acme-agent-runtime-lite",
              name: "Agent Runtime Lite",
              sourceUrl: "https://github.com/acme/agent-runtime-lite",
              category: "library",
              sourceKinds: ["github"],
              adapterIds: ["github"],
              reason: "relevance_below_threshold",
              phase: "scoring",
              relevanceScore: 54,
              minRelevanceScore: 60,
              scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
              sourceAuthorityScore: 88,
            },
          ],
        };
      },
    },
    editionStore: {
      async publish(edition) {
        publishedEditions.push(edition);
        return edition;
      },
    },
  });

  const edition = await flow.publishEdition();

  assert.deepEqual(edition.exclusions, [
    {
      itemIdentity: {
        id: "artifact-github-com-acme-agent-runtime-lite",
        itemId: "artifact-github-com-acme-agent-runtime-lite",
        name: "Agent Runtime Lite",
        sourceUrl: "https://github.com/acme/agent-runtime-lite",
        sourceUrls: ["https://github.com/acme/agent-runtime-lite"],
        canonicalIdentifiers: null,
      },
      itemId: "artifact-github-com-acme-agent-runtime-lite",
      name: "Agent Runtime Lite",
      sourceUrl: "https://github.com/acme/agent-runtime-lite",
      category: "library",
      exclusionReasonCode: "relevance_below_threshold",
      reasonCode: "relevance_below_threshold",
      timestamp: "2026-03-12T21:00:00.000Z",
      evaluationContext: {
        stage: "relevance_gate",
        window: {
          startsAt: "2026-03-11T21:00:00.000Z",
          endsAt: "2026-03-12T21:00:00.000Z",
          timezone: "UTC",
        },
        relevance: {
          minRelevanceScore: 60,
          relevanceScore: 54,
          scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
        },
      },
      editionContext: {
        editionId: "2026-03-12",
        publishedAt: "2026-03-12T21:00:00.000Z",
        window: {
          startsAt: "2026-03-11T21:00:00.000Z",
          endsAt: "2026-03-12T21:00:00.000Z",
          timezone: "UTC",
        },
      },
      sourceKinds: ["github"],
      adapterIds: ["github"],
      reason: "relevance_below_threshold",
      phase: "scoring",
      relevanceScore: 54,
      minRelevanceScore: 60,
      scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
      sourceAuthorityScore: 88,
      minSourceAuthorityScore: null,
      sourceStatus: null,
      sourceLifecycleState: null,
    },
  ]);
  assert.deepEqual(edition.exclusionSummary, {
    totalExcludedItems: 1,
    countsByCategory: [
      {
        category: "library",
        count: 1,
      },
    ],
    countsByReasonCode: [
      {
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
    ],
    countsByCategoryAndReason: [
      {
        category: "library",
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
    ],
  });
  assert.deepEqual(publishedEditions, [edition]);
});

test("publication flow accepts exclusionRecords as the persisted rejection input", async () => {
  const publishedEditions = [];
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [],
          exclusionRecords: [
            {
              itemId: "artifact-github-com-acme-agent-runtime-lite",
              name: "Agent Runtime Lite",
              sourceUrl: "https://github.com/acme/agent-runtime-lite",
              category: "library",
              sourceKinds: ["github"],
              adapterIds: ["github"],
              reasonCode: "below-threshold",
              phase: "scoring",
              relevanceScore: 54,
              minRelevanceScore: 60,
              scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
              sourceAuthorityScore: 88,
            },
          ],
        };
      },
    },
    editionStore: {
      async publish(edition) {
        publishedEditions.push(edition);
        return edition;
      },
    },
  });

  const edition = await flow.publishEdition();

  assert.equal(edition.exclusions.length, 1);
  assert.equal(edition.exclusions[0].itemId, "artifact-github-com-acme-agent-runtime-lite");
  assert.equal(edition.exclusions[0].reason, "relevance_below_threshold");
  assert.equal(edition.exclusions[0].reasonCode, "relevance_below_threshold");
  assert.equal(
    edition.exclusions[0].editionContext.editionId,
    "2026-03-12",
  );
  assert.equal(edition.exclusions[0].category, "library");
  assert.equal(edition.exclusions[0].relevanceScore, 54);
  assert.equal(edition.exclusions[0].minRelevanceScore, 60);
  assert.equal(
    edition.exclusions[0].scoreVersion,
    DEFAULT_RELEVANCE_SCORE_VERSION,
  );
  assert.deepEqual(edition.exclusionSummary, {
    totalExcludedItems: 1,
    countsByCategory: [
      {
        category: "library",
        count: 1,
      },
    ],
    countsByReasonCode: [
      {
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
    ],
    countsByCategoryAndReason: [
      {
        category: "library",
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
    ],
  });
  assert.deepEqual(publishedEditions, [edition]);
});

test("publication flow excludes explicit out-of-scope items and persists a standardized exclusion record", async () => {
  const publishedEditions = [];
  const outOfScopeItem = createNormalizedItem({
    name: "Prompt Helper Chat UI",
    sourceUrl: "https://example.com/prompt-helper",
    category: "tool",
    summary: "A human-facing chat product without autonomous execution.",
    integrationHint: "Do not integrate into the autonomous capability feed.",
    relevanceScore: 92,
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 73,
    discoveredAt: "2026-03-12T20:30:00.000Z",
  });
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [outOfScopeItem],
          exclusionDecisions: [
            {
              itemId: outOfScopeItem.itemId,
              reasonCode: "out-of-scope",
            },
          ],
        };
      },
    },
    editionStore: {
      async publish(edition) {
        publishedEditions.push(edition);
        return edition;
      },
    },
  });

  const edition = await flow.publishEdition();

  assert.deepEqual(edition.items, []);
  assert.equal(edition.exclusions.length, 1);
  assert.equal(edition.exclusions[0].itemId, outOfScopeItem.itemId);
  assert.equal(edition.exclusions[0].reason, "out_of_scope");
  assert.equal(edition.exclusions[0].reasonCode, "out_of_scope");
  assert.equal(edition.exclusions[0].exclusionReasonCode, "out_of_scope");
  assert.equal(edition.exclusions[0].phase, "scope");
  assert.deepEqual(edition.exclusions[0].editionContext, {
    editionId: "2026-03-12",
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
  });
  assert.equal(edition.exclusions[0].evaluationContext.stage, "scope_gate");
  assert.deepEqual(edition.exclusionSummary, {
    totalExcludedItems: 1,
    countsByCategory: [
      {
        category: "tool",
        count: 1,
      },
    ],
    countsByReasonCode: [
      {
        reasonCode: "out_of_scope",
        count: 1,
      },
    ],
    countsByCategoryAndReason: [
      {
        category: "tool",
        reasonCode: "out_of_scope",
        count: 1,
      },
    ],
  });
  assert.deepEqual(publishedEditions, [edition]);
});

test("publication flow only publishes items that meet the relevance floor", async () => {
  const publishedEditions = [];
  const discoveryCalls = [];
  const lowSignalItem = createNormalizedItem({
    name: "Speculative Agent Runtime",
    sourceUrl: "https://github.com/acme/speculative-agent-runtime",
    category: "library",
    summary: "A runtime announcement with too little corroboration to publish yet.",
    integrationHint: "Wait for more validation before adoption.",
    relevanceScore: 54,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 81,
    discoveredAt: "2026-03-12T20:15:00.000Z",
  });
  const qualifyingItem = createNormalizedItem({
    name: "Agent Runtime",
    sourceUrl: "https://github.com/acme/agent-runtime",
    category: "library",
    summary: "A runtime release that clears the publication relevance floor.",
    integrationHint: "npm install agent-runtime",
    relevanceScore: 87,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 95,
    discoveredAt: "2026-03-12T20:30:00.000Z",
  });
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      minRelevanceScore: DEFAULT_MIN_RELEVANCE_SCORE,
      async aggregate() {
        return {
          items: [lowSignalItem, qualifyingItem],
        };
      },
    },
    sourceDiscoveryService: {
      async discoverFromItems(items, options) {
        discoveryCalls.push({
          items,
          scoredItems: options.scoredItems,
        });
      },
    },
    editionStore: {
      async publish(edition) {
        publishedEditions.push(edition);
        return edition;
      },
    },
  });

  const edition = await flow.publishEdition();

  assert.deepEqual(edition.items.map((item) => item.name), ["Agent Runtime"]);
  assert.deepEqual(edition.exclusionSummary, {
    totalExcludedItems: 1,
    countsByCategory: [
      {
        category: "library",
        count: 1,
      },
    ],
    countsByReasonCode: [
      {
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
    ],
    countsByCategoryAndReason: [
      {
        category: "library",
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
    ],
  });
  assert.equal(edition.exclusions.length, 1);
  assert.equal(edition.exclusions[0].itemId, lowSignalItem.itemId);
  assert.equal(edition.exclusions[0].reason, "relevance_below_threshold");
  assert.equal(
    edition.exclusions[0].minRelevanceScore,
    DEFAULT_MIN_RELEVANCE_SCORE,
  );
  assert.equal(edition.exclusions[0].relevanceScore, 54);
  assert.equal(discoveryCalls.length, 1);
  assert.deepEqual(
    discoveryCalls[0].items.map((item) => item.name),
    ["Speculative Agent Runtime", "Agent Runtime"],
  );
  assert.deepEqual(
    discoveryCalls[0].scoredItems.map((item) => item.name),
    ["Agent Runtime"],
  );
  assert.deepEqual(publishedEditions, [edition]);
});

test("publication flow persists rejected scored items even when aggregate.items is already filtered", async () => {
  const publishedEditions = [];
  const lowSignalItem = createNormalizedItem({
    name: "Speculative Agent Runtime",
    sourceUrl: "https://github.com/acme/speculative-agent-runtime",
    category: "library",
    summary: "A runtime announcement with too little corroboration to publish yet.",
    integrationHint: "Wait for more validation before adoption.",
    relevanceScore: 54,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 81,
    discoveredAt: "2026-03-12T20:15:00.000Z",
  });
  const qualifyingItem = createNormalizedItem({
    name: "Agent Runtime",
    sourceUrl: "https://github.com/acme/agent-runtime",
    category: "library",
    summary: "A runtime release that clears the publication relevance floor.",
    integrationHint: "npm install agent-runtime",
    relevanceScore: 87,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 95,
    discoveredAt: "2026-03-12T20:30:00.000Z",
  });
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      minRelevanceScore: DEFAULT_MIN_RELEVANCE_SCORE,
      async aggregate() {
        return {
          items: [qualifyingItem],
          scoredItems: [lowSignalItem, qualifyingItem],
        };
      },
    },
    editionStore: {
      async publish(edition) {
        publishedEditions.push(edition);
        return edition;
      },
    },
  });

  const edition = await flow.publishEdition();

  assert.deepEqual(edition.items.map((item) => item.name), ["Agent Runtime"]);
  assert.equal(edition.exclusions.length, 1);
  assert.equal(edition.exclusions[0].itemId, lowSignalItem.itemId);
  assert.equal(edition.exclusions[0].category, "library");
  assert.equal(edition.exclusions[0].reasonCode, "relevance_below_threshold");
  assert.equal(edition.exclusions[0].relevanceScore, 54);
  assert.equal(
    edition.exclusions[0].minRelevanceScore,
    DEFAULT_MIN_RELEVANCE_SCORE,
  );
  assert.equal(
    edition.exclusions[0].scoreVersion,
    DEFAULT_RELEVANCE_SCORE_VERSION,
  );
  assert.deepEqual(edition.exclusions[0].editionContext, {
    editionId: "2026-03-12",
    publishedAt: "2026-03-12T21:00:00.000Z",
    window: {
      startsAt: "2026-03-11T21:00:00.000Z",
      endsAt: "2026-03-12T21:00:00.000Z",
      timezone: "UTC",
    },
  });
  assert.deepEqual(edition.exclusionSummary, {
    totalExcludedItems: 1,
    countsByCategory: [
      {
        category: "library",
        count: 1,
      },
    ],
    countsByReasonCode: [
      {
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
    ],
    countsByCategoryAndReason: [
      {
        category: "library",
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
    ],
  });
  assert.deepEqual(publishedEditions, [edition]);
});

test("publication flow forwards the full scored stream to source discovery when available", async () => {
  const discoveryCalls = [];
  const lowSignalItem = createNormalizedItem({
    name: "Speculative Agent Runtime",
    sourceUrl: "https://github.com/acme/speculative-runtime",
    category: "library",
    summary: "A runtime announcement with too little corroboration to publish yet.",
    integrationHint: "Wait for more validation before adoption.",
    relevanceScore: 54,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 81,
    discoveredAt: "2026-03-12T20:15:00.000Z",
  });
  const qualifyingItem = createNormalizedItem({
    name: "Agent Runtime",
    sourceUrl: "https://github.com/acme/agent-runtime",
    category: "library",
    summary: "A runtime release that clears the publication relevance floor.",
    integrationHint: "npm install agent-runtime",
    relevanceScore: 87,
    scoreVersion: DEFAULT_RELEVANCE_SCORE_VERSION,
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 95,
    discoveredAt: "2026-03-12T20:30:00.000Z",
  });
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      minRelevanceScore: DEFAULT_MIN_RELEVANCE_SCORE,
      async aggregate() {
        return {
          items: [qualifyingItem],
          scoredItems: [lowSignalItem, qualifyingItem],
        };
      },
    },
    sourceDiscoveryService: {
      async discoverFromItems(items, options) {
        discoveryCalls.push({
          items,
          scoredItems: options.scoredItems,
        });
      },
    },
    editionStore: {
      async publish(edition) {
        return edition;
      },
    },
  });

  await flow.publishEdition();

  assert.equal(discoveryCalls.length, 1);
  assert.deepEqual(
    discoveryCalls[0].scoredItems.map((item) => item.name),
    ["Speculative Agent Runtime", "Agent Runtime"],
  );
});

test("publication flow increments edition counts for reappearing items and keeps current scores", async () => {
  const publishedEditions = [];
  const trackedStateLookups = [];
  const currentItem = createNormalizedItem({
    name: "Agent Runtime",
    sourceUrl: "https://github.com/acme/agent-runtime",
    category: "library",
    summary: "Runtime for tool-using agents.",
    integrationHint: "npm install agent-runtime",
    relevanceScore: 88,
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 95,
    discoveredAt: "2026-03-12T20:30:00.000Z",
    scoringSignals: {
      recencyHours: 1,
      sourceAuthority: 95,
      mentionCount: 2,
      githubStars: 4200,
      githubActivity: 91,
      socialEngagement: 240,
    },
  });
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    scopeDefinition: buildScopeDefinition("1.1.0"),
    pipeline: {
      async aggregate() {
        return {
          items: [currentItem],
        };
      },
    },
    editionStore: {
      async loadTrackedItemStates({ before }) {
        trackedStateLookups.push(before);

        return new Map([
          [
            currentItem.itemId,
            {
              firstSeen: "2026-03-10T20:30:00.000Z",
              editionCount: 2,
              scopeVersion: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
            },
          ],
        ]);
      },
      async publish(edition) {
        publishedEditions.push(edition);
        return edition;
      },
    },
  });

  const edition = await flow.publishEdition();

  assert.deepEqual(trackedStateLookups, ["2026-03-12T21:00:00.000Z"]);
  assert.equal(edition.items[0].itemId, currentItem.itemId);
  assert.equal(edition.items[0].firstSeen, "2026-03-10T20:30:00.000Z");
  assert.equal(edition.items[0].editionCount, 3);
  assert.equal(edition.items[0].relevanceScore, 88);
  assert.equal(edition.items[0].scoreVersion, currentItem.scoreVersion);
  assert.equal(edition.items[0].scopeVersion, "1.1.0");
  assert.deepEqual(edition.items[0].scoringSignals, currentItem.scoringSignals);
  assert.deepEqual(publishedEditions, [edition]);
});

test("publication flow carries tracked storyline ids onto resurfacing items", async () => {
  const currentItem = createNormalizedItem({
    name: "Agent Runtime Cloud",
    sourceUrl: "https://acme.example.com/agent-runtime-cloud",
    category: "tool",
    summary: "Managed hosting for the Agent Runtime ecosystem.",
    integrationHint: "Review deployment docs before adoption.",
    relevanceScore: 83,
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 78,
    discoveredAt: "2026-03-12T20:45:00.000Z",
  });
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [currentItem],
        };
      },
    },
    editionStore: {
      async loadTrackedItemStates() {
        return new Map([
          [
            currentItem.itemId,
            {
              firstSeen: "2026-03-10T20:45:00.000Z",
              editionCount: 2,
              storylineId: "storyline-agent-runtime",
              storylineMemberPosition: 3,
            },
          ],
        ]);
      },
      async publish(edition) {
        return edition;
      },
    },
  });

  const edition = await flow.publishEdition();

  assert.equal(edition.items[0].storylineId, "storyline-agent-runtime");
  assert.equal(edition.items[0].storylineMemberPosition, 1);
  assert.equal(edition.storylines.length, 1);
  assert.equal(edition.storylines[0].storylineId, "storyline-agent-runtime");
  assert.equal(edition.storylines[0].title, "Agent Runtime Cloud");
  assert.deepEqual(edition.storylines[0].memberItemIds, [currentItem.itemId]);
  assert.equal(edition.storylines[0].status, "developing");
});

test("publication flow groups a new related item into an existing tracked storyline", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const editionStore = new NewsletterEditionStore({ directoryPath });

  await editionStore.publish({
    publishedAt: "2026-03-11T21:00:00.000Z",
    window: {
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        itemId: "agent-runtime-core",
        name: "Agent Runtime Core",
        sourceUrl: "https://github.com/acme/agent-runtime",
        category: "library",
        summary: "Runtime foundation for autonomous agent tooling.",
        integrationHint: "npm install agent-runtime",
        relevanceScore: 84,
        sourceKinds: ["github"],
        adapterIds: ["github"],
        sourceAuthorityScore: 94,
        discoveredAt: "2026-03-11T20:30:00.000Z",
        firstSeen: "2026-03-11T20:30:00.000Z",
        editionCount: 1,
        storylineId: "storyline-agent-runtime",
        storylineMemberPosition: 1,
        canonicalIdentifiers: {
          entityName: "Agent Runtime",
          repositoryUrl: null,
          doi: null,
          sourceIds: {},
        },
        metadata: {
          storyline: {
            storylineId: "storyline-agent-runtime",
            id: "storyline-agent-runtime",
            title: "Agent Runtime expands into managed hosting",
            status: "developing",
            member_item_ids: ["agent-runtime-core"],
            first_seen: "2026-03-11T20:30:00.000Z",
            last_seen: "2026-03-11T20:30:00.000Z",
            updated_at: "2026-03-11T21:00:00.000Z",
            last_evolution_at: "2026-03-11T21:00:00.000Z",
            evolution_count: 1,
            repetition_count: 0,
            repetition_streak: 0,
            relationship: {
              decision: "origin",
            },
          },
        },
      },
    ],
    storylines: [
      {
        storylineId: "storyline-agent-runtime",
        title: "Agent Runtime expands into managed hosting",
        memberItemIds: ["agent-runtime-core"],
        status: "developing",
      },
    ],
  });

  const currentItem = createNormalizedItem({
    name: "Agent Runtime Cloud",
    sourceUrl: "https://acme.example.com/agent-runtime-cloud",
    category: "tool",
    summary: "Managed hosting extends the Agent Runtime deployment story.",
    integrationHint: "Review the hosted control plane before adoption.",
    relevanceScore: 83,
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 78,
    discoveredAt: "2026-03-12T20:45:00.000Z",
    canonicalIdentifiers: {
      entityName: "Agent Runtime",
      repositoryUrl: null,
      doi: null,
      sourceIds: {},
    },
  });
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [currentItem],
        };
      },
    },
    editionStore,
  });

  const edition = await flow.publishEdition();

  assert.equal(edition.items[0].storylineId, "storyline-agent-runtime");
  assert.equal(edition.items[0].storylineMemberPosition, 2);
  assert.deepEqual(edition.items[0].metadata.storyline.member_item_ids, [
    "agent-runtime-core",
    edition.items[0].itemId,
  ]);
  assert.equal(edition.storylines.length, 1);
  assert.equal(edition.storylines[0].storylineId, "storyline-agent-runtime");
  assert.deepEqual(edition.storylines[0].memberItemIds, [
    "agent-runtime-core",
    edition.items[0].itemId,
  ]);
});

test("publication flow stores repetition-vs-evolution decisions on published storyline items", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const editionStore = new NewsletterEditionStore({ directoryPath });

  await editionStore.publish({
    publishedAt: "2026-03-11T21:00:00.000Z",
    window: {
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        itemId: "persistent-agent-sdk-item",
        name: "Agent SDK",
        sourceUrl: "https://github.com/acme/agent-sdk",
        category: "library",
        summary: "Agent SDK packages browser and shell tools for autonomous workflows.",
        integrationHint:
          "npm install agent-sdk and configure the browser and shell adapters.",
        relevanceScore: 83,
        sourceKinds: ["github"],
        adapterIds: ["github"],
        sourceAuthorityScore: 94,
        discoveredAt: "2026-03-11T20:30:00.000Z",
        firstSeen: "2026-03-10T20:30:00.000Z",
        editionCount: 1,
      },
    ],
  });

  const currentItem = createNormalizedItem({
    itemId: "persistent-agent-sdk-item",
    name: "Agent SDK launch recap",
    sourceUrl: "https://blog.example.com/agent-sdk-launch",
    category: "library",
    summary: "Agent SDK packages browser and shell tools for autonomous workflows.",
    integrationHint: "Install agent-sdk, then enable the browser and shell adapters.",
    relevanceScore: 85,
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 72,
    discoveredAt: "2026-03-12T20:40:00.000Z",
  });
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [currentItem],
        };
      },
    },
    editionStore,
  });

  const edition = await flow.publishEdition();
  const relationship = edition.items[0].metadata.storyline.relationship;

  assert.equal(relationship.decision, "repetition");
  assert.equal(relationship.priorAppearanceCount, 1);
  assert.equal(relationship.previousAppearance.sourceUrl, "https://github.com/acme/agent-sdk");
  assert.equal(edition.items[0].storylineMemberPosition, 1);
  assert.deepEqual(edition.items[0].metadata.storyline.member_item_ids, [
    "persistent-agent-sdk-item",
  ]);
  assert.equal(edition.storylines.length, 1);
  assert.deepEqual(edition.storylines[0].memberItemIds, ["persistent-agent-sdk-item"]);
});

test("publication flow reuses historical item identity when the same discovery resurfaces through a new source", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const editionStore = new NewsletterEditionStore({ directoryPath });

  await editionStore.publish({
    publishedAt: "2026-03-11T21:00:00.000Z",
    window: {
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        id: "persistent-agent-sdk",
        itemId: "persistent-agent-sdk-item",
        name: "Agent SDK",
        sourceUrl: "https://github.com/acme/agent-sdk",
        category: "library",
        summary: "Official repository for Agent SDK.",
        integrationHint: "npm install agent-sdk",
        relevanceScore: 74,
        sourceKinds: ["github"],
        adapterIds: ["github"],
        sourceAuthorityScore: 94,
        discoveredAt: "2026-03-11T20:30:00.000Z",
        firstSeen: "2026-03-10T20:30:00.000Z",
        editionCount: 2,
      },
    ],
  });

  const currentItem = createNormalizedItem({
    name: "Agent SDK launch thread",
    sourceUrl: "https://x.com/builder/status/456?utm_source=feed",
    category: "library",
    summary: "Launch thread with fresh rollout notes for Agent SDK.",
    integrationHint: "Review the launch notes before rollout.",
    relevanceScore: 89,
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 72,
    discoveredAt: "2026-03-12T20:40:00.000Z",
    scoringSignals: {
      recencyHours: 1,
      sourceAuthority: 72,
      mentionCount: 3,
      githubStars: 4200,
      githubActivity: 90,
      socialEngagement: 240,
    },
    metadata: {
      outboundUrls: ["https://github.com/acme/agent-sdk?utm_source=x"],
    },
  });

  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [currentItem],
        };
      },
    },
    editionStore,
  });

  const edition = await flow.publishEdition();

  assert.equal(edition.items[0].id, currentItem.id);
  assert.equal(edition.items[0].itemId, "persistent-agent-sdk-item");
  assert.equal(edition.items[0].firstSeen, "2026-03-10T20:30:00.000Z");
  assert.equal(edition.items[0].editionCount, 3);
  assert.equal(edition.items[0].relevanceScore, 89);
  assert.equal(edition.items[0].sourceUrl, currentItem.sourceUrl);
  assert.equal(edition.items[0].summary, currentItem.summary);
  assert.deepEqual(edition.items[0].sourceKinds, ["x"]);
  assert.deepEqual(edition.items[0].canonicalIdentifiers, {
    entityName: "Agent SDK",
    repositoryUrl: "https://github.com/acme/agent-sdk",
    doi: null,
    sourceIds: {
      github: "acme/agent-sdk",
    },
  });
});

test("publication flow merges edition history with stale identity state while preserving the current report id", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const editionStore = new NewsletterEditionStore({ directoryPath });

  await editionStore.publish({
    id: "2026-03-10",
    publishedAt: "2026-03-10T21:00:00.000Z",
    window: {
      startsAt: "2026-03-09T21:00:00.000Z",
      endsAt: "2026-03-10T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        id: "persistent-agent-sdk",
        itemId: "persistent-agent-sdk-item",
        name: "Agent SDK",
        sourceUrl: "https://github.com/acme/agent-sdk",
        category: "library",
        summary: "Initial repository release for Agent SDK.",
        integrationHint: "npm install agent-sdk",
        relevanceScore: 76,
        sourceKinds: ["github"],
        adapterIds: ["github"],
        sourceAuthorityScore: 94,
        discoveredAt: "2026-03-10T20:30:00.000Z",
        firstSeen: "2026-03-10T20:30:00.000Z",
        editionCount: 1,
      },
    ],
  });
  await editionStore.publish({
    id: "2026-03-11",
    publishedAt: "2026-03-11T21:00:00.000Z",
    window: {
      startsAt: "2026-03-10T21:00:00.000Z",
      endsAt: "2026-03-11T21:00:00.000Z",
      timezone: "UTC",
    },
    items: [
      {
        id: "persistent-agent-sdk",
        itemId: "persistent-agent-sdk-item",
        name: "Agent SDK setup guide",
        sourceUrl: "https://docs.example.com/agent-sdk/get-started",
        category: "library",
        summary: "Docs update covering installation, auth setup, and migration notes.",
        integrationHint: "Apply the migration guide before enabling production traffic.",
        relevanceScore: 83,
        sourceKinds: ["web"],
        adapterIds: ["web-discovery"],
        sourceAuthorityScore: 72,
        discoveredAt: "2026-03-11T20:30:00.000Z",
        firstSeen: "2026-03-10T20:30:00.000Z",
        editionCount: 2,
      },
    ],
  });

  const currentItem = createNormalizedItem({
    name: "Agent SDK rollout thread",
    sourceUrl: "https://x.com/acme/status/123?utm_source=feed",
    category: "library",
    summary: "Rollout thread with updated caveats, telemetry notes, and patch guidance.",
    integrationHint: "Review the rollout thread before upgrading autonomous workers.",
    relevanceScore: 91,
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 72,
    discoveredAt: "2026-03-12T20:30:00.000Z",
    metadata: {
      outboundUrls: ["https://github.com/acme/agent-sdk?utm_source=x"],
    },
  });
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [currentItem],
        };
      },
    },
    editionStore,
    itemIdentityRepository: {
      async loadTrackedItemStates() {
        return new Map([
          [
            "persistent-agent-sdk-item",
            {
              id: "persistent-agent-sdk",
              itemId: "persistent-agent-sdk-item",
              firstSeen: "2026-03-10T20:30:00.000Z",
              editionCount: 1,
              canonicalIdentifiers: {
                entityName: "Agent SDK",
                repositoryUrl: "https://github.com/acme/agent-sdk",
                doi: null,
                sourceIds: {
                  github: "acme/agent-sdk",
                },
              },
              item: createNormalizedItem({
                id: "persistent-agent-sdk",
                itemId: "persistent-agent-sdk-item",
                name: "Agent SDK",
                sourceUrl: "https://github.com/acme/agent-sdk",
                category: "library",
                summary: "Initial repository release for Agent SDK.",
                integrationHint: "npm install agent-sdk",
                relevanceScore: 76,
                sourceKinds: ["github"],
                adapterIds: ["github"],
                sourceAuthorityScore: 94,
                discoveredAt: "2026-03-10T20:30:00.000Z",
                firstSeen: "2026-03-10T20:30:00.000Z",
                editionCount: 1,
              }),
            },
          ],
        ]);
      },
      async recordEdition() {},
    },
  });

  const edition = await flow.publishEdition();
  const relationship = edition.items[0].metadata.storyline.relationship;

  assert.equal(edition.items[0].id, currentItem.id);
  assert.equal(edition.items[0].itemId, "persistent-agent-sdk-item");
  assert.equal(edition.items[0].firstSeen, "2026-03-10T20:30:00.000Z");
  assert.equal(edition.items[0].editionCount, 3);
  assert.equal(edition.items[0].relevanceScore, 91);
  assert.equal(
    relationship.previousAppearance.sourceUrl,
    "https://docs.example.com/agent-sdk/get-started",
  );
});

test("publication flow carries tracked canonical identifiers when a recurring item resurfaces without them", async () => {
  const currentItem = createNormalizedItem({
    id: "x-agent-runtime-thread",
    itemId: "persistent-agent-runtime-item",
    name: "Agent Runtime rollout thread",
    sourceUrl: "https://x.com/example/status/123",
    category: "library",
    summary: "Thread covering the latest runtime rollout.",
    integrationHint: "Review the rollout notes before upgrading agents.",
    relevanceScore: 84,
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 74,
    discoveredAt: "2026-03-12T20:30:00.000Z",
  });
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [currentItem],
        };
      },
    },
    editionStore: {
      async loadTrackedItemStates() {
        return new Map([
          [
            "persistent-agent-runtime-item",
            {
              firstSeen: "2026-03-10T20:30:00.000Z",
              editionCount: 2,
              canonicalIdentifiers: {
                entityName: "Agent Runtime",
                repositoryUrl: "https://github.com/acme/agent-runtime",
                doi: null,
                sourceIds: {
                  github: "acme/agent-runtime",
                },
              },
            },
          ],
        ]);
      },
      async publish(edition) {
        return edition;
      },
    },
  });

  const edition = await flow.publishEdition();

  assert.equal(edition.items[0].itemId, "persistent-agent-runtime-item");
  assert.equal(edition.items[0].firstSeen, "2026-03-10T20:30:00.000Z");
  assert.equal(edition.items[0].editionCount, 3);
  assert.deepEqual(edition.items[0].canonicalIdentifiers, {
    entityName: "Agent Runtime",
    repositoryUrl: "https://github.com/acme/agent-runtime",
    doi: null,
    sourceIds: {
      github: "acme/agent-runtime",
    },
  });
});

test("publication flow preserves tracked item identity when stronger canonical evidence appears in a later run", async () => {
  const trackedItem = createNormalizedItem({
    id: "docs-agent-sdk",
    name: "Agent SDK setup guide",
    sourceUrl: "https://docs.example.com/agent-sdk/get-started?utm_source=digest",
    category: "library",
    summary: "Setup guide for installing and configuring Agent SDK.",
    integrationHint: "Follow the guide after validating the runtime requirements.",
    relevanceScore: 82,
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 68,
    discoveredAt: "2026-03-11T20:30:00.000Z",
  });
  const currentItem = createNormalizedItem({
    id: "github-agent-sdk",
    name: "agent-sdk",
    sourceUrl: "https://github.com/acme/agent-sdk?utm_source=trending",
    category: "library",
    summary: "Official repository for Agent SDK.",
    integrationHint: "npm install agent-sdk",
    relevanceScore: 91,
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 94,
    discoveredAt: "2026-03-12T20:30:00.000Z",
  });

  assert.equal(trackedItem.itemId, "artifact-agent-sdk");
  assert.equal(currentItem.itemId, "artifact-github-com-acme-agent-sdk");

  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [currentItem],
        };
      },
    },
    editionStore: {
      async loadTrackedItemStates() {
        return new Map([
          [
            trackedItem.itemId,
            {
              id: "persistent-agent-sdk",
              itemId: trackedItem.itemId,
              firstSeen: "2026-03-10T20:30:00.000Z",
              editionCount: 2,
              canonicalIdentifiers: {
                entityName: "Agent SDK",
                repositoryUrl: null,
                doi: null,
                sourceIds: {},
              },
              item: trackedItem,
            },
          ],
        ]);
      },
      async publish(edition) {
        return edition;
      },
    },
  });

  const edition = await flow.publishEdition();

  assert.equal(edition.items[0].id, currentItem.id);
  assert.equal(edition.items[0].itemId, "artifact-agent-sdk");
  assert.equal(edition.items[0].firstSeen, "2026-03-10T20:30:00.000Z");
  assert.equal(edition.items[0].editionCount, 3);
  assert.deepEqual(edition.items[0].canonicalIdentifiers, {
    entityName: "Agent SDK",
    repositoryUrl: "https://github.com/acme/agent-sdk",
    doi: null,
    sourceIds: {
      github: "acme/agent-sdk",
    },
  });
});

test("publication flow restores persisted lifecycle fields from identity snapshots without appearance history", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const editionStore = new NewsletterEditionStore({
    directoryPath: join(directoryPath, "editions"),
  });
  const itemIdentityRepository = new ItemIdentityRepository({
    filePath: join(directoryPath, "item-identities.json"),
  });

  await itemIdentityRepository.save({
    updatedAt: "2026-03-11T21:00:00.000Z",
    items: [
      {
        itemId: "persistent-agent-runtime-item",
        sourceId: "github-agent-runtime",
        firstSeen: "2026-03-10T20:30:00.000Z",
        lastSeen: "2026-03-11T21:00:00.000Z",
        editionCount: 2,
        scopeVersion: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
        canonicalIdentifiers: {
          entityName: "Agent Runtime",
          repositoryUrl: "https://github.com/acme/agent-runtime",
          doi: null,
          sourceIds: {
            github: "acme/agent-runtime",
          },
        },
        latestItem: createNormalizedItem({
          id: "x-agent-runtime-thread",
          itemId: "persistent-agent-runtime-item",
          name: "Agent Runtime rollout thread",
          sourceUrl: "https://x.com/example/status/123",
          category: "library",
          summary: "Thread covering the runtime rollout.",
          integrationHint: "Review the rollout before upgrading agents.",
          sourceKinds: ["x"],
          adapterIds: ["x-twitter"],
          sourceAuthorityScore: 74,
          discoveredAt: "2026-03-11T20:30:00.000Z",
          firstSeen: "2026-03-10T20:30:00.000Z",
          editionCount: 2,
          scopeVersion: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
          canonicalIdentifiers: {
            entityName: "Agent Runtime",
            repositoryUrl: "https://github.com/acme/agent-runtime",
            doi: null,
            sourceIds: {
              github: "acme/agent-runtime",
            },
          },
        }),
      },
    ],
  });

  const currentItem = createNormalizedItem({
    id: "x-agent-runtime-upgrade",
    name: "Agent Runtime upgrade notes",
    sourceUrl: "https://x.com/example/status/456",
    category: "library",
    summary: "Updated rollout notes for the runtime upgrade.",
    integrationHint: "Review the upgrade notes before rollout.",
    relevanceScore: 88,
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 76,
    discoveredAt: "2026-03-12T20:30:00.000Z",
    canonicalIdentifiers: {
      entityName: "Agent Runtime",
      repositoryUrl: "https://github.com/acme/agent-runtime",
      doi: null,
      sourceIds: {
        github: "acme/agent-runtime",
      },
    },
  });
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    scopeDefinition: buildScopeDefinition("1.1.0"),
    pipeline: {
      async aggregate() {
        return {
          items: [currentItem],
        };
      },
    },
    editionStore,
    itemIdentityRepository,
  });

  const edition = await flow.publishEdition();
  const rawSnapshot = JSON.parse(
    await readFile(join(directoryPath, "item-identities.json"), "utf8"),
  );

  assert.equal(edition.items[0].itemId, "persistent-agent-runtime-item");
  assert.equal(edition.items[0].firstSeen, "2026-03-10T20:30:00.000Z");
  assert.equal(edition.items[0].editionCount, 3);
  assert.equal(edition.items[0].scopeVersion, "1.1.0");
  assert.equal(rawSnapshot.items[0].firstSeen, "2026-03-10T20:30:00.000Z");
  assert.equal(rawSnapshot.items[0].editionCount, 3);
  assert.equal(rawSnapshot.items[0].scopeVersion, "1.1.0");
  assert.equal(rawSnapshot.items[0].latestItem.firstSeen, "2026-03-10T20:30:00.000Z");
  assert.equal(rawSnapshot.items[0].latestItem.editionCount, 3);
  assert.equal(rawSnapshot.items[0].latestItem.scopeVersion, "1.1.0");
});

test("publication flow persists approved discovered sources from fetched item links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new SourceRepository({
    filePath: join(directory, "source-registry.json"),
  });
  const sourceDiscoveryService = new SourceDiscoveryService({ repository });
  const publishedEditions = [];
  const fetchedItems = [
    createNormalizedItemFromSourceRecord({
      adapterId: "github",
      sourceType: "github",
      externalId: "trending-1",
      title: "Agent tooling worth tracking",
      sourceName: "GitHub",
      sourceUrl: "https://github.com/trending",
      publishedAt: "2026-03-12T20:15:00.000Z",
      summary: "Framework docs worth watching.",
      outboundUrls: ["https://docs.agno.com/agents?utm_source=github"],
      tags: ["github", "ai-agents"],
      author: "github",
      metrics: {
        mentions: 1,
        upvotes: 50,
        comments: 0,
        shares: 0,
      },
      sourceAuthority: {
        authority: 95,
      },
      raw: {},
    }),
    createNormalizedItemFromSourceRecord({
      adapterId: "reddit",
      sourceType: "reddit",
      externalId: "t3_docs123",
      title: "Useful agent docs",
      sourceName: "r/LocalLLaMA",
      sourceUrl: "https://reddit.com/r/LocalLLaMA/comments/docs123",
      publishedAt: "2026-03-12T20:30:00.000Z",
      summary: "Another citation for the same docs.",
      outboundUrls: ["https://docs.agno.com/agents?utm_source=reddit"],
      tags: ["reddit", "ai-agents"],
      author: "builder",
      metrics: {
        mentions: 1,
        upvotes: 80,
        comments: 12,
        shares: 0,
      },
      sourceAuthority: {
        authority: 62,
      },
      raw: {},
    }),
  ];
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [],
          fetchedItems,
        };
      },
    },
    editionStore: {
      async publish(edition) {
        publishedEditions.push(edition);
        return edition;
      },
    },
    sourceDiscoveryService,
  });

  await flow.publishEdition();

  const fetchableSources = await repository.listFetchableSources({
    now: "2026-03-12T21:05:00.000Z",
  });
  const approved = fetchableSources.find(
    (source) => source.id === "web:domain:docs.agno.com",
  );

  assert.ok(approved);
  assert.equal(approved.status, "approved");
  assert.deepEqual(approved.evidence.cyclesSeen, ["2026-03-12"]);
  assert.deepEqual(publishedEditions, [
    {
      publishedAt: "2026-03-12T21:00:00.000Z",
      window: {
        startsAt: "2026-03-11T21:00:00.000Z",
        endsAt: "2026-03-12T21:00:00.000Z",
        timezone: "UTC",
      },
      exclusionSummary: {
        totalExcludedItems: 0,
        countsByCategory: [],
        countsByReasonCode: [],
        countsByCategoryAndReason: [],
      },
      items: [],
    },
  ]);
});

test("publication flow persists adapter-emitted discovered sources for later fetch cycles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new SourceRepository({
    filePath: join(directory, "source-registry.json"),
  });
  const sourceDiscoveryService = new SourceDiscoveryService({ repository });
  const flow = createPublicationFlow({
    now: () => "2026-03-12T22:15:00.000Z",
    pipeline: {
      async aggregate() {
        return {
          items: [],
          fetchedItems: [],
          discoveredSources: [
            {
              id: "web:domain:docs.agno.com",
              kind: "web",
              displayName: "docs.agno.com",
              url: "https://docs.agno.com/platform/agents?utm_source=github",
              authorityScore: 68,
              discoveredFromUrls: [
                "https://github.com/trending",
                "https://reddit.com/r/LocalLLaMA/comments/docs123?utm_source=home",
              ],
            },
          ],
        };
      },
    },
    editionStore: {
      async publish(edition) {
        return edition;
      },
    },
    sourceDiscoveryService,
  });

  await flow.publishEdition();

  const fetchableSources = await repository.listFetchableSources({
    now: "2026-03-12T21:05:00.000Z",
  });
  const approved = fetchableSources.find(
    (source) => source.id === "web:domain:docs.agno.com",
  );

  assert.ok(approved);
  assert.equal(approved.status, "approved");
  assert.equal(approved.fetchUrl, "https://docs.agno.com/platform/agents");
  assert.deepEqual(approved.discoveredFromUrls, [
    "https://github.com/trending",
    "https://reddit.com/r/LocalLLaMA/comments/docs123",
  ]);
});
