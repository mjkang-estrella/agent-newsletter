import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  ItemIdentityRepository,
  createNormalizedItem,
} from "../src/index.js";

test("ItemIdentityRepository persists stable identity records with canonical identifiers and scope version", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new ItemIdentityRepository({
    filePath: join(directoryPath, "item-identities.json"),
  });

  await repository.recordEdition(
    {
      id: "2026-03-12",
      publishedAt: "2026-03-12T21:00:00.000Z",
      window: {
        startsAt: "2026-03-11T21:00:00.000Z",
        endsAt: "2026-03-12T21:00:00.000Z",
        timezone: "UTC",
      },
      items: [
        createNormalizedItem({
          name: "Planning with Agent Graphs",
          sourceUrl: "https://arxiv.org/abs/2603.12345",
          sourceUrls: [
            "https://arxiv.org/abs/2603.12345",
            "https://doi.org/10.48550/arXiv.2603.12345",
          ],
          category: "technique",
          summary: "Paper covering planning strategies for agent graphs.",
          integrationHint: "Review the paper before adapting the planning strategy.",
          sourceKinds: ["arxiv"],
          adapterIds: ["arxiv"],
          sourceAuthorityScore: 88,
          discoveredAt: "2026-03-12T20:15:00.000Z",
          metadata: {
            canonicalId: "2603.12345",
            doi: "10.48550/arXiv.2603.12345",
            arxiv: {
              canonicalId: "2603.12345",
              doi: "10.48550/arXiv.2603.12345",
            },
          },
        }),
      ],
    },
    {
      scopeVersion: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
    },
  );

  const raw = JSON.parse(
    await readFile(join(directoryPath, "item-identities.json"), "utf8"),
  );

  assert.equal(raw.version, 1);
  assert.equal(raw.items[0].itemId, "technique-arxiv-2603-12345");
  assert.equal(raw.items[0].firstSeen, "2026-03-12T20:15:00.000Z");
  assert.equal(raw.items[0].editionCount, 1);
  assert.equal(raw.items[0].scopeVersion, CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion);
  assert.deepEqual(raw.items[0].canonicalIdentifiers, {
    entityName: "Planning with Agent Graphs",
    repositoryUrl: null,
    doi: "10.48550/arxiv.2603.12345",
    sourceIds: {
      arxiv: "2603.12345",
    },
  });
  assert.deepEqual(raw.items[0].appearanceHistory, [
    {
      editionId: "2026-03-12",
      publishedAt: "2026-03-12T21:00:00.000Z",
    },
  ]);
});

test("ItemIdentityRepository returns prior tracked state without double-counting the current edition slot", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new ItemIdentityRepository({
    filePath: join(directoryPath, "item-identities.json"),
  });
  const firstEditionItem = createNormalizedItem({
    id: "github-agent-runtime",
    itemId: "persistent-agent-runtime-item",
    name: "Agent Runtime",
    sourceUrl: "https://github.com/acme/agent-runtime",
    category: "library",
    summary: "Runtime for tool-using agents.",
    integrationHint: "npm install agent-runtime",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 92,
    discoveredAt: "2026-03-10T20:30:00.000Z",
  });

  await repository.recordEdition(
    {
      id: "2026-03-10",
      publishedAt: "2026-03-10T21:00:00.000Z",
      window: {
        startsAt: "2026-03-09T21:00:00.000Z",
        endsAt: "2026-03-10T21:00:00.000Z",
        timezone: "UTC",
      },
      items: [firstEditionItem],
    },
    {
      scopeVersion: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
    },
  );

  await repository.recordEdition(
    {
      id: "2026-03-11",
      publishedAt: "2026-03-11T21:00:00.000Z",
      window: {
        startsAt: "2026-03-10T21:00:00.000Z",
        endsAt: "2026-03-11T21:00:00.000Z",
        timezone: "UTC",
      },
      items: [
        createNormalizedItem({
          ...firstEditionItem,
          sourceUrl: "https://x.com/acme/status/123",
          sourceUrls: [
            "https://x.com/acme/status/123",
            "https://github.com/acme/agent-runtime",
          ],
          discoveredAt: "2026-03-11T20:40:00.000Z",
        }),
      ],
    },
    {
      scopeVersion: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
    },
  );

  const beforeSecondEdition = await repository.loadTrackedItemStates({
    before: "2026-03-11T21:00:00.000Z",
  });
  const afterSecondEdition = await repository.loadTrackedItemStates({
    before: "2026-03-12T21:00:00.000Z",
  });

  assert.deepEqual(beforeSecondEdition.get("persistent-agent-runtime-item"), {
    firstSeen: "2026-03-10T20:30:00.000Z",
    editionCount: 1,
    scopeVersion: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
    canonicalIdentifiers: {
      entityName: "Agent Runtime",
      repositoryUrl: "https://github.com/acme/agent-runtime",
      doi: null,
      sourceIds: {
        github: "acme/agent-runtime",
      },
    },
  });
  assert.deepEqual(afterSecondEdition.get("persistent-agent-runtime-item"), {
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
  });
});

test("ItemIdentityRepository restores tracked lifecycle state from persisted records without appearance history", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new ItemIdentityRepository({
    filePath: join(directoryPath, "item-identities.json"),
  });

  await repository.save({
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

  const trackedStates = await repository.loadTrackedItemStates({
    before: "2026-03-12T21:00:00.000Z",
  });

  assert.deepEqual(trackedStates.get("persistent-agent-runtime-item"), {
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
  });
});

test("ItemIdentityRepository reuses the existing entity record when a later edition brings a stronger canonical match", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new ItemIdentityRepository({
    filePath: join(directoryPath, "item-identities.json"),
  });
  const firstEditionItem = createNormalizedItem({
    id: "docs-agent-sdk",
    name: "Agent SDK setup guide",
    sourceUrl: "https://docs.example.com/agent-sdk/get-started?utm_source=digest",
    category: "library",
    summary: "Setup guide for installing and configuring Agent SDK.",
    integrationHint: "Review the guide before rolling Agent SDK into production.",
    relevanceScore: 72,
    scoreVersion: "1.3.0",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 68,
    discoveredAt: "2026-03-11T20:30:00.000Z",
  });
  const secondEditionItem = createNormalizedItem({
    id: "github-agent-sdk",
    name: "agent-sdk",
    sourceUrl: "https://github.com/acme/agent-sdk?utm_source=release",
    category: "library",
    summary: "Official repository for Agent SDK with release notes.",
    integrationHint: "npm install agent-sdk",
    relevanceScore: 91,
    scoreVersion: "2.1.0",
    sourceKinds: ["github"],
    adapterIds: ["github"],
    sourceAuthorityScore: 94,
    discoveredAt: "2026-03-12T20:30:00.000Z",
  });

  assert.equal(firstEditionItem.itemId, "artifact-agent-sdk");
  assert.equal(secondEditionItem.itemId, "artifact-github-com-acme-agent-sdk");

  await repository.recordEdition(
    {
      id: "2026-03-11",
      publishedAt: "2026-03-11T21:00:00.000Z",
      window: {
        startsAt: "2026-03-10T21:00:00.000Z",
        endsAt: "2026-03-11T21:00:00.000Z",
        timezone: "UTC",
      },
      items: [firstEditionItem],
    },
    {
      scopeVersion: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
    },
  );

  await repository.recordEdition(
    {
      id: "2026-03-12",
      publishedAt: "2026-03-12T21:00:00.000Z",
      window: {
        startsAt: "2026-03-11T21:00:00.000Z",
        endsAt: "2026-03-12T21:00:00.000Z",
        timezone: "UTC",
      },
      items: [secondEditionItem],
    },
    {
      scopeVersion: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
    },
  );

  const raw = JSON.parse(
    await readFile(join(directoryPath, "item-identities.json"), "utf8"),
  );

  assert.equal(raw.items.length, 1);
  assert.equal(raw.items[0].itemId, firstEditionItem.itemId);
  assert.equal(raw.items[0].sourceId, firstEditionItem.id);
  assert.equal(raw.items[0].firstSeen, firstEditionItem.firstSeen);
  assert.equal(raw.items[0].editionCount, 2);
  assert.equal(raw.items[0].latestItem.itemId, firstEditionItem.itemId);
  assert.equal(raw.items[0].latestItem.id, secondEditionItem.id);
  assert.equal(raw.items[0].latestItem.relevanceScore, 91);
  assert.equal(raw.items[0].latestItem.scoreVersion, "2.1.0");
  assert.equal(
    raw.items[0].latestItem.sourceUrl,
    secondEditionItem.sourceUrl,
  );
  assert.equal(
    raw.items[0].canonicalIdentifiers.repositoryUrl,
    "https://github.com/acme/agent-sdk",
  );
  assert.equal(raw.items[0].canonicalIdentifiers.doi, null);
  assert.deepEqual(raw.items[0].canonicalIdentifiers.sourceIds, {
    github: "acme/agent-sdk",
  });
  assert.deepEqual(raw.items[0].appearanceHistory, [
    {
      editionId: "2026-03-11",
      publishedAt: "2026-03-11T21:00:00.000Z",
      relevanceScore: 72,
      scoreVersion: "1.3.0",
    },
    {
      editionId: "2026-03-12",
      publishedAt: "2026-03-12T21:00:00.000Z",
      relevanceScore: 91,
      scoreVersion: "2.1.0",
    },
  ]);
});

test("ItemIdentityRepository reuses an existing record when a later discovery shares the official site url", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "agent-newsletter-"));
  const repository = new ItemIdentityRepository({
    filePath: join(directoryPath, "item-identities.json"),
  });
  const firstEditionItem = createNormalizedItem({
    id: "agent-runtime-homepage",
    name: "Release homepage",
    sourceUrl: "https://agent-runtime.dev/",
    category: "tool",
    summary: "Canonical homepage for the Agent Runtime release.",
    integrationHint: "Use the homepage to validate the current release channel.",
    relevanceScore: 70,
    scoreVersion: "1.3.0",
    sourceKinds: ["web"],
    adapterIds: ["web-discovery"],
    sourceAuthorityScore: 71,
    discoveredAt: "2026-03-11T20:30:00.000Z",
  });
  const secondEditionItem = createNormalizedItem({
    id: "agent-runtime-thread",
    name: "Weekend operator recap",
    sourceUrl: "https://x.com/acme/status/7001",
    category: "tool",
    summary: "Operator notes summarizing the release weekend.",
    integrationHint: "Treat this as commentary, not the integration source.",
    relevanceScore: 76,
    scoreVersion: "1.4.0",
    sourceKinds: ["x"],
    adapterIds: ["x-twitter"],
    sourceAuthorityScore: 74,
    discoveredAt: "2026-03-12T20:30:00.000Z",
    metadata: {
      outboundUrls: ["https://agent-runtime.dev/?utm_source=x"],
    },
  });

  await repository.recordEdition(
    {
      id: "2026-03-11",
      publishedAt: "2026-03-11T21:00:00.000Z",
      window: {
        startsAt: "2026-03-10T21:00:00.000Z",
        endsAt: "2026-03-11T21:00:00.000Z",
        timezone: "UTC",
      },
      items: [firstEditionItem],
    },
    {
      scopeVersion: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
    },
  );

  await repository.recordEdition(
    {
      id: "2026-03-12",
      publishedAt: "2026-03-12T21:00:00.000Z",
      window: {
        startsAt: "2026-03-11T21:00:00.000Z",
        endsAt: "2026-03-12T21:00:00.000Z",
        timezone: "UTC",
      },
      items: [secondEditionItem],
    },
    {
      scopeVersion: CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion,
    },
  );

  const raw = JSON.parse(
    await readFile(join(directoryPath, "item-identities.json"), "utf8"),
  );

  assert.equal(raw.items.length, 1);
  assert.equal(raw.items[0].itemId, firstEditionItem.itemId);
  assert.equal(raw.items[0].firstSeen, firstEditionItem.firstSeen);
  assert.equal(raw.items[0].editionCount, 2);
  assert.equal(raw.items[0].latestItem.id, secondEditionItem.id);
  assert.equal(raw.items[0].latestItem.sourceUrl, secondEditionItem.sourceUrl);
  assert.deepEqual(raw.items[0].appearanceHistory, [
    {
      editionId: "2026-03-11",
      publishedAt: "2026-03-11T21:00:00.000Z",
      relevanceScore: 70,
      scoreVersion: "1.3.0",
    },
    {
      editionId: "2026-03-12",
      publishedAt: "2026-03-12T21:00:00.000Z",
      relevanceScore: 76,
      scoreVersion: "1.4.0",
    },
  ]);
});
