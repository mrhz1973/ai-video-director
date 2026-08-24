import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const batch = readFileSync(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");
const queueUi = readFileSync(new URL("../public/batch-queue-ui.mjs", import.meta.url), "utf8");

test("v0.13.0 package version", () => {
  assert.equal(pkg.version, "0.13.0");
});

test("CODA BATCH section wired in client", () => {
  assert.match(queueUi, /batchQueueSection/);
  assert.match(queueUi, /batchQueueArm/);
  assert.match(queueUi, /batchQueueFailurePolicy/);
});

test("batch queue API routes wired in client", () => {
  assert.match(queueUi, /\/api\/batch-queue\/runtime/);
  assert.match(queueUi, /\/api\/batch-queue\/sync/);
  assert.match(app, /isBatchQueueArmed/);
});

test("Genera singolo Avvia batch and Aggiungi alla coda preserved", () => {
  assert.match(html, /id="send"[^>]*>Genera singolo</);
  assert.match(batch, /id="batchQueue">Avvia batch</);
  assert.match(batch, /id="batchAddToQueue">Aggiungi alla coda</);
});

test("v0.12 runtime interrupt controls still present", () => {
  assert.match(html, /id="interruptSingleRender"/);
  assert.match(batch, /\/api\/runtime\/stop-batch/);
});
