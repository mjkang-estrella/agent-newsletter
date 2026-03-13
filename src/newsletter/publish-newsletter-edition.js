import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { publishNewsletterEdition } from "./default-publication-task.js";

export async function runPublicationOnce({
  publish = publishNewsletterEdition,
  logInfo = (...args) => console.info(...args),
} = {}) {
  if (typeof publish !== "function") {
    throw new TypeError("publish must be a function");
  }

  if (typeof logInfo !== "function") {
    throw new TypeError("logInfo must be a function");
  }

  const edition = await publish();

  logInfo("Newsletter edition published.", {
    publishedAt: edition.publishedAt,
    itemCount: edition.items.length,
  });

  return edition;
}

function isExecutedDirectly() {
  return process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  await runPublicationOnce();
}
