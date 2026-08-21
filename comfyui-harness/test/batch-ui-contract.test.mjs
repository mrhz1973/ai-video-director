import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");

test("batch submission claims its lock before the first asynchronous preflight", () => {
  const start = source.indexOf("async function queueBatch()");
  const end = source.indexOf("\nfunction stateLabel", start);
  assert.ok(start >= 0 && end > start, "queueBatch function must exist");
  const body = source.slice(start, end);
  const lock = body.indexOf("submitting = true;");
  const firstAwait = body.indexOf("await ");
  assert.ok(lock >= 0, "queueBatch must claim submitting lock");
  assert.ok(firstAwait >= 0, "queueBatch must perform async work");
  assert.ok(lock < firstAwait, "submitting lock must be claimed before first await to prevent double-click races");
});

test("batch submission always releases the transient lock in finally", () => {
  const start = source.indexOf("async function queueBatch()");
  const end = source.indexOf("\nfunction stateLabel", start);
  const body = source.slice(start, end);
  assert.match(body, /finally\s*\{[\s\S]*submitting = false;[\s\S]*updateQueueButton\(\);[\s\S]*\}/);
});
