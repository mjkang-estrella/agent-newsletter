import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ArxivSourceAdapter,
  DEFAULT_ARXIV_BASE_URL,
} from "../src/sources/arxiv-source-adapter.js";
import { SourceAdapterConfigurationError } from "../src/sources/source-adapter.js";

const FIXTURE_URL = new URL("./fixtures/arxiv_feed.xml", import.meta.url);

async function loadFixture() {
  return readFile(FIXTURE_URL, "utf8");
}

test("arxiv adapter builds an AI agent paper query for the requested window", () => {
  const adapter = new ArxivSourceAdapter({
    fetch: async () => ({
      ok: true,
      text: async () => "",
    }),
  });

  const url = new URL(
    adapter.buildQueryUrl({
      since: new Date("2026-03-10T00:00:00.000Z"),
      until: new Date("2026-03-11T00:00:00.000Z"),
      limit: 5,
    }),
  );

  assert.equal(`${url.origin}${url.pathname}`, DEFAULT_ARXIV_BASE_URL);
  assert.equal(url.searchParams.get("max_results"), "5");
  assert.equal(url.searchParams.get("sortBy"), "submittedDate");
  assert.equal(url.searchParams.get("sortOrder"), "descending");
  assert.match(url.searchParams.get("search_query"), /all:"AI agent"/);
  assert.match(url.searchParams.get("search_query"), /cat:cs\.AI/);
  assert.match(
    url.searchParams.get("search_query"),
    /submittedDate:\[20260310000000 TO 20260311000000]/,
  );
});

test("arxiv adapter normalizes Atom entries into newsletter source records", async () => {
  const calls = [];
  const adapter = new ArxivSourceAdapter({
    now: () => "2026-03-11T00:15:00.000Z",
    userAgent: "agent-newsletter-test/1.0 (+https://example.com)",
    fetch: async (url, options) => {
      calls.push({ url, options });

      return {
        ok: true,
        text: async () => loadFixture(),
      };
    },
  });

  const items = await adapter.fetchItems({
    since: "2026-03-10T00:00:00.000Z",
    until: "2026-03-11T00:00:00.000Z",
    limit: 10,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.accept, "application/atom+xml");
  assert.equal(
    calls[0].options.headers["user-agent"],
    "agent-newsletter-test/1.0 (+https://example.com)",
  );
  assert.match(calls[0].url, /max_results=10/);
  assert.equal(items.length, 2);

  const planningPaper = items.find((item) => item.externalId === "2603.12345");
  assert.ok(planningPaper);
  assert.equal(planningPaper.sourceType, "arxiv");
  assert.equal(
    planningPaper.title,
    "Coordinating LLM Agents with Retrieval-Augmented Planning",
  );
  assert.equal(planningPaper.sourceName, "arXiv");
  assert.equal(planningPaper.sourceUrl, "https://arxiv.org/abs/2603.12345");
  assert.equal(planningPaper.category, "technique");
  assert.equal(
    planningPaper.integrationHint,
    "Translate the paper's method, evaluation setup, and cited resources into a small experiment before shipping it into an agent workflow.",
  );
  assert.equal(planningPaper.author, "Ada Lovelace et al.");
  assert.equal(planningPaper.metrics.mentions, 1);
  assert.equal(planningPaper.sourceAuthority.authority, 95);
  assert.equal(planningPaper.riskWarning.severity, "medium");
  assert.deepEqual(planningPaper.sourceUrls, [
    "https://arxiv.org/abs/2603.12345",
    "https://arxiv.org/abs/2603.12345v1",
    "https://arxiv.org/pdf/2603.12345v1",
  ]);
  assert.deepEqual(planningPaper.outboundUrls, [
    "https://arxiv.org/pdf/2603.12345v1",
  ]);
  assert.equal(planningPaper.metadata.canonicalId, "2603.12345");
  assert.equal(planningPaper.metadata.versionedId, "2603.12345v1");
  assert.equal(
    planningPaper.metadata.versionedSourceUrl,
    "https://arxiv.org/abs/2603.12345v1",
  );
  assert.equal(planningPaper.metadata.primaryCategory, "cs.AI");
  assert.deepEqual(planningPaper.metadata.categories, ["cs.AI", "cs.CL"]);
  assert.equal(
    planningPaper.metadata.pdfUrl,
    "https://arxiv.org/pdf/2603.12345v1",
  );
  assert.equal(
    planningPaper.metadata.updatedAt,
    "2026-03-10T13:45:00.000Z",
  );
  assert.equal(planningPaper.metadata.fetchedAt, "2026-03-11T00:15:00.000Z");
  assert.equal(
    planningPaper.metadata.fetchedFromUrl,
    calls[0].url,
  );
  assert.deepEqual(planningPaper.metadata.fetchWindow, {
    since: "2026-03-10T00:00:00.000Z",
    until: "2026-03-11T00:00:00.000Z",
  });
  assert.equal(planningPaper.metadata.sourceProvenance.adapterId, "arxiv");
  assert.equal(planningPaper.metadata.sourceProvenance.sourceKind, "arxiv");
  assert.equal(planningPaper.metadata.sourceProvenance.sourceName, "arXiv");
  assert.equal(planningPaper.metadata.sourceProvenance.queryUrl, calls[0].url);
  assert.equal(
    planningPaper.metadata.sourceProvenance.fetchedFromUrl,
    calls[0].url,
  );
  assert.equal(
    planningPaper.metadata.sourceProvenance.fetchedAt,
    "2026-03-11T00:15:00.000Z",
  );
  assert.equal(planningPaper.metadata.arxiv.canonicalId, "2603.12345");
  assert.equal(
    planningPaper.metadata.arxiv.versionedSourceUrl,
    "https://arxiv.org/abs/2603.12345v1",
  );
  assert.equal(
    planningPaper.metadata.arxiv.fetchedAt,
    "2026-03-11T00:15:00.000Z",
  );
  assert.ok(planningPaper.tags.includes("source:arxiv"));
  assert.ok(planningPaper.tags.includes("topic:planning"));
  assert.ok(planningPaper.tags.includes("topic:retrieval"));
  assert.ok(planningPaper.tags.includes("topic:memory"));
  assert.ok(planningPaper.tags.includes("topic:evaluation"));
  assert.ok(planningPaper.tags.includes("arxiv:primary:cs.AI"));

  const apiPlanningPaper = items.find((item) => item.externalId === "2603.12346");
  assert.ok(apiPlanningPaper);
  assert.equal(apiPlanningPaper.category, "technique");
  assert.equal(apiPlanningPaper.metadata.doi, "10.1000/arxiv.2603.12346");
  assert.ok(apiPlanningPaper.sourceUrls.includes("https://doi.org/10.1000/arxiv.2603.12346"));
  assert.ok(
    apiPlanningPaper.outboundUrls.includes("https://doi.org/10.1000/arxiv.2603.12346"),
  );
  assert.equal(
    apiPlanningPaper.metadata.arxiv.doiUrl,
    "https://doi.org/10.1000/arxiv.2603.12346",
  );
  assert.ok(apiPlanningPaper.tags.includes("topic:evaluation"));
  assert.ok(apiPlanningPaper.tags.includes("candidate:api"));
});

test("arxiv adapter paginates Atom responses when more than one page is needed", async () => {
  const requests = [];
  const adapter = new ArxivSourceAdapter({
    fetch: async (url, options) => {
      requests.push({ url, options });
      const start = new URL(url).searchParams.get("start");

      if (start === "0") {
        return {
          ok: true,
          text: async () =>
            buildArxivFeed([
              createArxivEntry({
                id: "2603.20001",
                title: "Agent planning with retrieval",
                publishedAt: "2026-03-10T20:00:00.000Z",
                updatedAt: "2026-03-10T21:00:00.000Z",
                summary: "Agent planning with retrieval and tool use.",
              }),
              createArxivEntry({
                id: "2603.20002",
                title: "Browser agents for resilient automation",
                publishedAt: "2026-03-10T18:00:00.000Z",
                updatedAt: "2026-03-10T19:00:00.000Z",
                summary: "Browser agent runtime for resilient web automation.",
              }),
            ]),
        };
      }

      if (start === "2") {
        return {
          ok: true,
          text: async () =>
            buildArxivFeed([
              createArxivEntry({
                id: "2603.20003",
                title: "Hosted API design for tool-using agents",
                publishedAt: "2026-03-10T16:00:00.000Z",
                updatedAt: "2026-03-10T17:00:00.000Z",
                summary: "API design patterns for tool-using autonomous agents.",
              }),
            ]),
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const items = await adapter.fetchItems({
    since: "2026-03-10T00:00:00.000Z",
    until: "2026-03-11T00:00:00.000Z",
    limit: 3,
    pageSize: 2,
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.accept, "application/atom+xml");
  assert.match(requests[0].url, /start=0/);
  assert.match(requests[0].url, /max_results=2/);
  assert.match(requests[1].url, /start=2/);
  assert.match(requests[1].url, /max_results=1/);
  assert.equal(items.length, 3);
  assert.ok(items.find((item) => item.externalId === "2603.20001"));
  assert.ok(items.find((item) => item.externalId === "2603.20002"));
  assert.ok(items.find((item) => item.externalId === "2603.20003"));
});

test("arxiv adapter retries rate-limited requests", async () => {
  const fetchCalls = [];
  const sleepCalls = [];
  const adapter = new ArxivSourceAdapter({
    rateLimitMaxRetries: 1,
    rateLimitRetryAfterMs: 25,
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    fetch: async (url) => {
      fetchCalls.push(url);

      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          headers: {
            get(name) {
              return name.toLowerCase() === "retry-after" ? "0" : null;
            },
          },
        };
      }

      return {
        ok: true,
        text: async () => loadFixture(),
      };
    },
  });

  const items = await adapter.fetchItems({
    since: "2026-03-10T00:00:00.000Z",
    until: "2026-03-11T00:00:00.000Z",
  });

  assert.equal(fetchCalls.length, 2);
  assert.deepEqual(sleepCalls, []);
  assert.equal(items.length, 2);
});

test("arxiv adapter surfaces upstream request failures", async () => {
  const adapter = new ArxivSourceAdapter({
    rateLimitMaxRetries: 0,
    fetch: async () => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    }),
  });

  await assert.rejects(
    adapter.fetchItems({
      since: "2026-03-10T00:00:00.000Z",
      until: "2026-03-11T00:00:00.000Z",
    }),
    (error) => {
      assert.ok(error instanceof SourceAdapterConfigurationError);
      assert.match(error.message, /arXiv adapter request failed: 503 Service Unavailable/);
      return true;
    },
  );
});

test("arxiv adapter exposes the normalized source-adapter fetch contract", async () => {
  const adapter = new ArxivSourceAdapter({
    now: () => "2026-03-11T00:15:00.000Z",
    fetch: async () => ({
      ok: true,
      text: async () => loadFixture(),
    }),
  });

  const result = await adapter.fetch({
    startsAt: "2026-03-10T00:00:00.000Z",
    endsAt: "2026-03-11T00:00:00.000Z",
    timezone: "UTC",
  });

  assert.equal(adapter.descriptor.kind, "arxiv");
  assert.equal(adapter.descriptor.id, "arxiv");
  assert.equal(result.cursor, null);
  assert.deepEqual(result.discoveredSources, []);
  assert.equal(result.items.length, 2);

  const paper = result.items.find((item) => item.id === "arxiv-2603.12345");
  assert.ok(paper);
  assert.equal(paper.name, "Coordinating LLM Agents with Retrieval-Augmented Planning");
  assert.equal(paper.category, "technique");
  assert.equal(paper.sourceUrl, "https://arxiv.org/abs/2603.12345");
  assert.ok(paper.sourceUrls.includes("https://arxiv.org/abs/2603.12345v1"));
  assert.ok(paper.sourceUrls.includes("https://arxiv.org/pdf/2603.12345v1"));
  assert.deepEqual(paper.sourceKinds, ["arxiv"]);
  assert.deepEqual(paper.adapterIds, ["arxiv"]);
  assert.equal(paper.riskWarning.severity, "medium");
  assert.equal(paper.scoringSignals.sourceAuthority, 95);
  assert.equal(paper.metadata.primaryCategory, "cs.AI");
  assert.equal(paper.metadata.fetchedAt, "2026-03-11T00:15:00.000Z");
  assert.deepEqual(paper.metadata.fetchWindow, {
    since: "2026-03-10T00:00:00.000Z",
    until: "2026-03-11T00:00:00.000Z",
  });
  assert.equal(paper.metadata.sourceProvenance.adapterId, "arxiv");
  assert.equal(paper.metadata.sourceProvenance.sourceKind, "arxiv");
  assert.equal(paper.metadata.arxiv.canonicalId, "2603.12345");
  assert.deepEqual(paper.metadata.authorNames, ["Ada Lovelace", "Grace Hopper"]);
});

function createArxivEntry({
  id,
  title,
  publishedAt,
  updatedAt,
  summary,
  authors = ["Ada Lovelace"],
  primaryCategory = "cs.AI",
  categories = [primaryCategory],
}) {
  const versionedId = `${id}v1`;

  return `
    <entry>
      <id>https://arxiv.org/abs/${versionedId}</id>
      <updated>${updatedAt}</updated>
      <published>${publishedAt}</published>
      <title>${title}</title>
      <summary>${summary}</summary>
      ${authors
        .map(
          (author) => `
            <author>
              <name>${author}</name>
            </author>
          `,
        )
        .join("")}
      <link rel="alternate" href="https://arxiv.org/abs/${versionedId}" />
      <link title="pdf" href="https://arxiv.org/pdf/${versionedId}" />
      <arxiv:primary_category term="${primaryCategory}" />
      ${categories.map((category) => `<category term="${category}" />`).join("")}
    </entry>
  `;
}

function buildArxivFeed(entries) {
  return `
    <feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
      ${entries.join("\n")}
    </feed>
  `;
}
