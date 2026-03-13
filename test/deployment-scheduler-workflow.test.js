import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("deployment workflow publishes once per day at 21:00 UTC", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/publish-newsletter.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /cron:\s*"0 21 \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /NEWSLETTER_BASE_TIMEZONE:\s*UTC/);
  assert.match(workflow, /run:\s*npm run publish:newsletter/);
  assert.doesNotMatch(workflow, /publish:newsletter:scheduled/);
});
