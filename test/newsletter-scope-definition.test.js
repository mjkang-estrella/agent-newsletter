import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  SCOPE_CHANGE_TYPES,
  SCOPE_REVIEW_CADENCES,
  SCOPE_VERSIONING_SCHEMES,
  createNewsletterScopeDefinition,
  formatNewsletterScopeDefinitionResponse,
} from "../src/index.js";

const SCOPE_DEFINITION_DOCUMENT_URL = new URL(
  "../src/newsletter/scope-definition.document.json",
  import.meta.url,
);

test("createNewsletterScopeDefinition returns the current versioned editorial boundary", () => {
  const scopeDefinition = createNewsletterScopeDefinition(CURRENT_NEWSLETTER_SCOPE_DEFINITION);

  assert.equal(scopeDefinition.currentVersion, "1.0.1");
  assert.equal(scopeDefinition.scopeDefinition.version, scopeDefinition.currentVersion);
  assert.equal(scopeDefinition.scopeDefinition.reviewCadence, "quarterly");
  assert.equal(
    scopeDefinition.scopeDefinition.inclusionPolicy.requiredCapabilities.length > 0,
    true,
  );
  assert.equal(
    scopeDefinition.scopeDefinition.inclusionPolicy.inclusionExamples.length > 0,
    true,
  );
  assert.equal(
    scopeDefinition.scopeDefinition.inclusionPolicy.exclusionExamples.length > 0,
    true,
  );
  assert.equal(scopeDefinition.scopeDefinition.coverageBoundaries.inScope.length > 0, true);
  assert.equal(scopeDefinition.scopeDefinition.coverageBoundaries.outOfScope.length > 0, true);
  assert.equal(scopeDefinition.changelog.length, 2);
  assert.ok(SCOPE_CHANGE_TYPES.includes(scopeDefinition.changelog[0].changeType));
});

test("createNewsletterScopeDefinition rejects changelogs that do not include the current version", () => {
  assert.throws(
    () =>
      createNewsletterScopeDefinition({
        currentVersion: "2.0.0",
        scopeDefinition: {
          ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.scopeDefinition,
          version: "2.0.0",
        },
        changelog: CURRENT_NEWSLETTER_SCOPE_DEFINITION.changelog,
      }),
    /changelog must include an entry for currentVersion/,
  );
});

test("createNewsletterScopeDefinition requires the changelog to be ordered and end at the current version", () => {
  assert.throws(
    () =>
      createNewsletterScopeDefinition({
        ...CURRENT_NEWSLETTER_SCOPE_DEFINITION,
        changelog: [
          CURRENT_NEWSLETTER_SCOPE_DEFINITION.changelog[1],
          CURRENT_NEWSLETTER_SCOPE_DEFINITION.changelog[0],
        ],
      }),
    /changelog\[0\]\.changeType must be initial/,
  );

  assert.throws(
    () =>
      createNewsletterScopeDefinition({
        ...CURRENT_NEWSLETTER_SCOPE_DEFINITION,
        currentVersion: "1.0.0",
        scopeDefinition: {
          ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.scopeDefinition,
          version: "1.0.0",
        },
      }),
    /currentVersion must match the latest changelog entry/,
  );
});

test("createNewsletterScopeDefinition rejects changelogs with non-monotonic semver versions", () => {
  assert.throws(
    () =>
      createNewsletterScopeDefinition({
        ...CURRENT_NEWSLETTER_SCOPE_DEFINITION,
        changelog: [
          {
            ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.changelog[0],
            version: "1.0.2",
          },
          {
            ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.changelog[1],
            version: "1.0.1",
          },
        ],
      }),
    /changelog versions must increase monotonically/,
  );
});

test("createNewsletterScopeDefinition requires explicit inclusion and exclusion examples", () => {
  assert.throws(
    () =>
      createNewsletterScopeDefinition({
        currentVersion: "1.0.1",
        scopeDefinition: {
          ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.scopeDefinition,
          inclusionPolicy: {
            ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.scopeDefinition.inclusionPolicy,
            exclusionExamples: [],
          },
        },
        changelog: CURRENT_NEWSLETTER_SCOPE_DEFINITION.changelog,
      }),
    /scopeDefinition\.inclusionPolicy\.exclusionExamples must be a non-empty array/,
  );
});

test("createNewsletterScopeDefinition ties the active scope definition metadata to the current changelog entry", () => {
  assert.throws(
    () =>
      createNewsletterScopeDefinition({
        ...CURRENT_NEWSLETTER_SCOPE_DEFINITION,
        scopeDefinition: {
          ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.scopeDefinition,
          effectiveAt: "2026-03-13T00:00:00.000Z",
          reviewedAt: "2026-03-13T00:00:00.000Z",
          nextReviewAt: "2026-06-13T00:00:00.000Z",
        },
      }),
    /scopeDefinition\.effectiveAt must match the currentVersion changelog effectiveAt/,
  );
});

test("createNewsletterScopeDefinition enforces quarterly review cadence and semver versioning", () => {
  assert.deepEqual(SCOPE_REVIEW_CADENCES, ["quarterly"]);
  assert.deepEqual(SCOPE_VERSIONING_SCHEMES, ["semver"]);

  assert.throws(
    () =>
      createNewsletterScopeDefinition({
        ...CURRENT_NEWSLETTER_SCOPE_DEFINITION,
        scopeDefinition: {
          ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.scopeDefinition,
          reviewCadence: "monthly",
        },
      }),
    /scopeDefinition\.reviewCadence must be one of: quarterly/,
  );

  assert.throws(
    () =>
      createNewsletterScopeDefinition({
        currentVersion: "scope-v2",
        scopeDefinition: {
          ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.scopeDefinition,
        },
        changelog: CURRENT_NEWSLETTER_SCOPE_DEFINITION.changelog,
      }),
    /currentVersion must be a semver version/,
  );

  assert.throws(
    () =>
      createNewsletterScopeDefinition({
        currentVersion: "2.0.0",
        scopeDefinition: {
          ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.scopeDefinition,
          version: "scope-v2",
        },
        changelog: [
          {
            ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.changelog[0],
            version: "2.0.0",
          },
        ],
      }),
    /scopeDefinition\.version must be a semver version/,
  );

  assert.throws(
    () =>
      createNewsletterScopeDefinition({
        ...CURRENT_NEWSLETTER_SCOPE_DEFINITION,
        scopeDefinition: {
          ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.scopeDefinition,
          changeTracking: {
            ...CURRENT_NEWSLETTER_SCOPE_DEFINITION.scopeDefinition.changeTracking,
            versioningScheme: "date-based",
          },
        },
      }),
    /scopeDefinition\.changeTracking\.versioningScheme must be one of: semver/,
  );
});

test("scope definition document is the canonical versioned source of truth", async () => {
  const rawDocument = JSON.parse(await readFile(SCOPE_DEFINITION_DOCUMENT_URL, "utf8"));
  const normalizedDocument = createNewsletterScopeDefinition(rawDocument);

  assert.equal(rawDocument.currentVersion, CURRENT_NEWSLETTER_SCOPE_DEFINITION.currentVersion);
  assert.equal(rawDocument.scopeDefinition.version, rawDocument.currentVersion);
  assert.ok(rawDocument.changelog.some((entry) => entry.version === rawDocument.currentVersion));
  assert.deepEqual(normalizedDocument, CURRENT_NEWSLETTER_SCOPE_DEFINITION);
});

test("formatNewsletterScopeDefinitionResponse exposes the machine-readable scope contract", () => {
  const response = formatNewsletterScopeDefinitionResponse({
    generatedAt: "2026-03-12T21:30:00.000Z",
    scopeDefinition: CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  });

  assert.deepEqual(response, {
    generated_at: "2026-03-12T21:30:00.000Z",
    current_version: "1.0.1",
    scope_definition: {
      version: "1.0.1",
      effective_at: "2026-03-12T00:00:00.000Z",
      reviewed_at: "2026-03-12T00:00:00.000Z",
      next_review_at: "2026-06-12T00:00:00.000Z",
      review_cadence: "quarterly",
      audience: {
        primary_subscribers:
          "Autonomous AI agent programs that subscribe to the JSON API and act on the resulting items.",
        secondary_operators:
          "Human operators who deploy, supervise, and review the autonomous agents consuming the newsletter.",
      },
      definition:
        "AI agents are software systems that autonomously pursue goals by planning what to do next, using tools or external systems, and executing work across multiple steps with limited human intervention.",
      inclusion_policy: {
        qualification_rule:
          "Treat a candidate as AI-agent-relevant only when the underlying system can accept a goal, decide or revise what to do next at runtime, use external tools or systems, and carry out multiple steps with limited human intervention.",
        required_capabilities: [
          "Maintains an explicit delegated goal beyond answering a single prompt.",
          "Chooses or adapts the next action at runtime based on state, observations, or prior tool results.",
          "Uses tools or external systems such as APIs, browsers, shells, files, databases, or code execution environments.",
          "Executes work across multiple steps without requiring a human prompt before every action.",
        ],
        inclusion_examples: [
          "A coding agent that inspects a repository, plans code changes, runs tests, and iterates until checks pass.",
          "A browser agent that researches vendors, fills forms, and retries failed steps while pursuing a delegated task.",
          "A multi-agent orchestration runtime that delegates work to specialized workers, verifies outputs, and merges the result.",
          "An agent memory or evaluation system that materially improves autonomous planning, tool selection, or long-horizon execution.",
        ],
        exclusion_examples: [
          "A chatbot interface that only returns text answers and never takes autonomous actions in external systems.",
          "A single-shot LLM wrapper that sends one prompt to a model and returns the response without planning or tool use.",
          "A fixed automation script or deterministic workflow whose steps are fully predeclared and never chosen dynamically at runtime.",
          "A generic AI productivity feature where any agent integration is hypothetical or secondary to a human-driven workflow.",
        ],
      },
      coverage_boundaries: {
        in_scope: [
          "Autonomous, goal-directed systems that plan or adapt their next action before executing work.",
          "Tool-using systems that interact with APIs, browsers, shells, files, databases, or code execution environments as part of runtime decision-making.",
          "Infrastructure that materially improves autonomous behavior, including planning, memory, tool use, evaluation, orchestration, verification, or multi-agent coordination.",
          "Tools, APIs, libraries, and techniques that subscribing agents could directly integrate to expand or harden their capabilities.",
        ],
        out_of_scope: [
          "Plain chatbots or assistants that only return text and do not take autonomous actions.",
          "Single-shot LLM wrappers that call a model once without planning, tool use, or multi-step execution.",
          "Static automation scripts, deterministic DAGs, or fixed workflows that do not choose actions dynamically at runtime.",
          "Generic AI news, model launches, or prompt-writing advice without a direct autonomous-agent implication.",
          "Human-only productivity tools unless the agent integration surface is the primary, operationally real capability.",
        ],
        decision_rule:
          "Include a candidate only when a deployed system could use it to autonomously decide and execute the next step toward a goal.",
      },
      change_tracking: {
        versioning_scheme: "semver",
        update_policy:
          "Any scope-boundary change requires a version bump and a new changelog entry. Quarterly reviews that do not change coverage only refresh reviewedAt and nextReviewAt for the current version.",
        version_change_rules: {
          major:
            "Use a major version bump when the inclusion boundary changes in a way that would add or remove a broad class of content.",
          minor:
            "Use a minor version bump when the scope gains or narrows a specific covered pattern, source family, or edge-case rule without redefining the core agent standard.",
          patch:
            "Use a patch version bump for clarifications, examples, or wording changes that do not alter editorial behavior.",
        },
      },
    },
    changelog: [
      {
        version: "1.0.0",
        change_type: "initial",
        effective_at: "2026-03-12T00:00:00.000Z",
        summary: "Established the initial machine-readable editorial scope for the newsletter.",
        rationale:
          "The newsletter needs an explicit, versioned boundary so consuming agents and operators can reason about what coverage means and how it changes over time.",
        scope_changes: [
          "Included autonomous software that plans, uses tools, and executes toward goals with limited human intervention.",
          "Included direct capability enablers such as agent runtimes, tool protocols, sandboxes, evaluators, and orchestration systems.",
          "Excluded plain chatbots, single-shot LLM wrappers, static automation scripts, and generic AI coverage without direct agent relevance.",
          "Defined quarterly review and semver-based change tracking for future boundary updates.",
        ],
      },
      {
        version: "1.0.1",
        change_type: "patch",
        effective_at: "2026-03-12T00:00:00.000Z",
        summary:
          "Added an explicit AI-agent inclusion policy with qualifying criteria and boundary examples.",
        rationale:
          "Editorial decisions need machine-readable examples so operators and consuming agents can distinguish autonomous systems from adjacent chatbot or automation tooling.",
        scope_changes: [
          "Added a qualification rule that defines what capabilities a system must have to count as an AI agent for newsletter inclusion.",
          "Documented concrete inclusion examples such as coding agents, browser agents, multi-agent runtimes, and autonomy-focused memory or evaluation systems.",
          "Documented concrete exclusion examples such as chat UIs, single-shot wrappers, static automation scripts, and generic human-only AI productivity features.",
        ],
      },
    ],
  });
});
