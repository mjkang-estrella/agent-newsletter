import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { discoverNewsletterSources } from "./default-source-discovery-task.js";

export async function runSourceDiscoveryWorker({
  discover = discoverNewsletterSources,
  logInfo = (...args) => console.info(...args),
} = {}) {
  if (typeof discover !== "function") {
    throw new TypeError("discover must be a function");
  }

  if (typeof logInfo !== "function") {
    throw new TypeError("logInfo must be a function");
  }

  const result = await discover();

  logInfo("Source discovery worker completed.", {
    window: result.window,
    fetchedItemCount: result.fetchedItems.length,
    approvedSourceCount: result.approvedSources.length,
    candidateSourceCount: result.candidateSources.length,
    newlyApprovedSourceCount: result.newlyApproved.length,
    newlyPromotedSourceCount: result.newlyPromoted.length,
    newlyRetiredSourceCount: result.newlyRetired.length,
  });

  return result;
}

function isExecutedDirectly() {
  return process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  await runSourceDiscoveryWorker();
}
