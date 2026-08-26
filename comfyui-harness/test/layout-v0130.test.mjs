import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const batch = readFileSync(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");
const queueUi = readFileSync(new URL("../public/batch-queue-ui.mjs", import.meta.url), "utf8");

test("package version is at least v0.13 lineage", () => {
  assert.match(pkg.version, /^0\.1[3456789]\./);
});

test("CODA section wired in client", () => {
  assert.match(queueUi, /batchQueueSection/);
  assert.match(queueUi, /batchQueueArm/);
  assert.match(queueUi, /batchQueueFailurePolicy/);
});

test("batch queue API routes wired in client", () => {
  assert.match(queueUi, /\/api\/batch-queue\/runtime/);
  assert.match(queueUi, /\/api\/batch-queue\/sync/);
  assert.match(app, /isBatchQueueArmed/);
});

test("Genera singolo, Aggiungi alla coda, and advanced Avvia batch preserved", () => {
  assert.match(html, /id="send"[^>]*>GENERA SINGOLO</);
  assert.match(batch, /id="batchQueue"/);
  assert.match(batch, /Avvia questo Batch immediatamente/);
  assert.match(batch, /id="batchAddToQueue"[^>]*>\+ AGGIUNGI ALLA CODA</);
});

test("v0.12 runtime interrupt controls still present", () => {
  assert.match(html, /id="interruptSingleRender"/);
  assert.match(batch, /\/api\/runtime\/stop-batch/);
});
