import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditionExclusionSummary,
  createEditionExclusionSummary,
} from "../src/index.js";

test("buildEditionExclusionSummary aggregates excluded items by category and reason code", () => {
  const summary = buildEditionExclusionSummary([
    {
      category: "library",
      reasonCode: "source_not_approved",
      count: 2,
    },
    {
      category: "tool",
      reasonCode: "relevance_below_threshold",
    },
    {
      category: "tool",
      reasonCode: "source_not_approved",
    },
    {
      category: "library",
      reasonCode: "source_not_approved",
    },
  ]);

  assert.deepEqual(summary, {
    totalExcludedItems: 5,
    countsByCategory: [
      {
        category: "tool",
        count: 2,
      },
      {
        category: "library",
        count: 3,
      },
    ],
    countsByReasonCode: [
      {
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
      {
        reasonCode: "source_not_approved",
        count: 4,
      },
    ],
    countsByCategoryAndReason: [
      {
        category: "tool",
        reasonCode: "relevance_below_threshold",
        count: 1,
      },
      {
        category: "tool",
        reasonCode: "source_not_approved",
        count: 1,
      },
      {
        category: "library",
        reasonCode: "source_not_approved",
        count: 3,
      },
    ],
  });
});

test("createEditionExclusionSummary backfills category and reason rollups from legacy grouped data", () => {
  const summary = createEditionExclusionSummary({
    totalExcludedItems: 3,
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

  assert.deepEqual(summary, {
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
});

test("createEditionExclusionSummary rejects inconsistent category totals", () => {
  assert.throws(
    () =>
      createEditionExclusionSummary({
        totalExcludedItems: 3,
        countsByCategory: [
          {
            category: "library",
            count: 1,
          },
        ],
        countsByCategoryAndReason: [
          {
            category: "library",
            reasonCode: "source_not_approved",
            count: 3,
          },
        ],
      }),
    /countsByCategory must equal exclusionSummary.totalExcludedItems/,
  );
});
