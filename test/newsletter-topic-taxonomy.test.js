import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_NEWSLETTER_TOPIC_TAXONOMY,
  TOPIC_TAXONOMY_CHANGE_TYPES,
  createNewsletterTopicTaxonomy,
  formatNewsletterTopicTaxonomyResponse,
  resolveCoverageAreasForSource,
} from "../src/index.js";

const TOPIC_TAXONOMY_DOCUMENT_URL = new URL(
  "../src/newsletter/topic-taxonomy.document.json",
  import.meta.url,
);

test("createNewsletterTopicTaxonomy returns the current versioned coverage taxonomy", () => {
  const taxonomy = createNewsletterTopicTaxonomy(CURRENT_NEWSLETTER_TOPIC_TAXONOMY);

  assert.equal(taxonomy.currentVersion, "1.0.0");
  assert.equal(taxonomy.taxonomyDefinition.version, taxonomy.currentVersion);
  assert.equal(taxonomy.taxonomyDefinition.reviewCadence, "quarterly");
  assert.equal(taxonomy.taxonomyDefinition.coverageAreas.length, 8);
  assert.equal(taxonomy.taxonomyDefinition.sourceCoverageMapping.length, 5);
  assert.ok(TOPIC_TAXONOMY_CHANGE_TYPES.includes(taxonomy.changelog[0].changeType));
});

test("createNewsletterTopicTaxonomy rejects source mappings that reference unknown coverage areas", () => {
  assert.throws(
    () =>
      createNewsletterTopicTaxonomy({
        currentVersion: "1.0.0",
        taxonomyDefinition: {
          ...CURRENT_NEWSLETTER_TOPIC_TAXONOMY.taxonomyDefinition,
          sourceCoverageMapping: [
            {
              ...CURRENT_NEWSLETTER_TOPIC_TAXONOMY.taxonomyDefinition.sourceCoverageMapping[0],
              primaryCoverageAreas: ["non-existent-area"],
            },
          ],
        },
        changelog: CURRENT_NEWSLETTER_TOPIC_TAXONOMY.changelog,
      }),
    /unknown coverage area key: non-existent-area/,
  );
});

test("topic taxonomy document is the canonical versioned source of truth", async () => {
  const rawDocument = JSON.parse(await readFile(TOPIC_TAXONOMY_DOCUMENT_URL, "utf8"));
  const normalizedDocument = createNewsletterTopicTaxonomy(rawDocument);

  assert.equal(rawDocument.currentVersion, CURRENT_NEWSLETTER_TOPIC_TAXONOMY.currentVersion);
  assert.equal(rawDocument.taxonomyDefinition.version, rawDocument.currentVersion);
  assert.ok(rawDocument.changelog.some((entry) => entry.version === rawDocument.currentVersion));
  assert.deepEqual(normalizedDocument, CURRENT_NEWSLETTER_TOPIC_TAXONOMY);
});

test("resolveCoverageAreasForSource falls back from adapter id to source kind", () => {
  const exactMatch = resolveCoverageAreasForSource({
    id: "web-discovery",
    kind: "web",
  });
  const kindFallback = resolveCoverageAreasForSource({
    id: "web:domain:example.com",
    kind: "web",
  });

  assert.equal(exactMatch.sourceKind, "web");
  assert.deepEqual(
    exactMatch.primaryCoverageAreas.map((area) => area.key),
    [
      "agent-runtimes",
      "tool-use-and-integrations",
      "security-and-governance",
      "deployment-and-adoption",
    ],
  );
  assert.deepEqual(
    kindFallback.secondaryCoverageAreas.map((area) => area.key),
    [
      "planning-and-reasoning",
      "memory-and-context",
      "multi-agent-coordination",
      "evaluation-and-observability",
    ],
  );
});

test("formatNewsletterTopicTaxonomyResponse exposes the machine-readable topic taxonomy", () => {
  const response = formatNewsletterTopicTaxonomyResponse({
    generatedAt: "2026-03-12T21:30:00.000Z",
    taxonomy: CURRENT_NEWSLETTER_TOPIC_TAXONOMY,
  });

  assert.equal(response.generated_at, "2026-03-12T21:30:00.000Z");
  assert.equal(response.current_version, "1.0.0");
  assert.equal(response.taxonomy_definition.coverage_areas.length, 8);
  assert.equal(response.taxonomy_definition.source_coverage_mapping.length, 5);
  assert.deepEqual(
    response.taxonomy_definition.coverage_areas[0],
    {
      key: "agent-runtimes",
      label: "Agent Runtimes",
      description:
        "Frameworks, SDKs, control planes, and execution environments that provide the core runtime for autonomous agents.",
      content_categories: ["tool", "api", "library"],
      signals: [
        "Agent SDK or framework launches.",
        "Runtime APIs for long-running or resumable execution.",
        "Control-plane capabilities for planning, state transitions, or worker coordination.",
      ],
    },
  );
  assert.deepEqual(
    response.taxonomy_definition.source_coverage_mapping[2],
    {
      source_kind: "arxiv",
      source_ids: ["arxiv"],
      primary_coverage_areas: [
        "planning-and-reasoning",
        "memory-and-context",
        "multi-agent-coordination",
        "evaluation-and-observability",
      ],
      secondary_coverage_areas: [
        "agent-runtimes",
        "tool-use-and-integrations",
        "security-and-governance",
      ],
      rationale:
        "arXiv is strongest for net-new techniques, benchmarks, and research-led changes to planning, memory, and multi-agent behavior.",
    },
  );
  assert.deepEqual(response.changelog, [
    {
      version: "1.0.0",
      change_type: "initial",
      effective_at: "2026-03-12T00:00:00.000Z",
      summary:
        "Established the canonical AI-agent topic taxonomy and seeded source-to-topic coverage mappings.",
      rationale:
        "Coverage checks need a stable, machine-readable taxonomy so the system can tell whether editions span the major capability areas autonomous agents depend on.",
      taxonomy_changes: [
        "Defined eight canonical coverage areas spanning runtimes, tool use, planning, memory, coordination, evaluation, security, and deployment.",
        "Mapped the current source families and adapter ids to primary and secondary coverage areas for later coverage evaluation.",
        "Adopted quarterly review and semver-based change tracking for taxonomy evolution.",
      ],
    },
  ]);
});
