import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  batchJobOutputRows,
  buildCompletionCard,
  outputActionSideEffects,
  persistLatestOutput,
  readLatestOutput,
  reconstructCompletionFromOutputs
} from "../public/completion.mjs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const batchUi = readFileSync(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");

test("single completion card shows filename and Apri video", () => {
  assert.match(html, /id="completionCard"/);
  assert.match(app, /Apri video/);
  const card = buildCompletionCard({
    filename: "clip.mp4",
    url: "/api/view?filename=clip.mp4",
    duration: "5.0",
    model: "Q4",
    seed: 9
  });
  assert.equal(card.title.includes("LAVORO FINITO"), true);
  assert.equal(card.filename, "clip.mp4");
  assert.equal(card.duration, 5);
  assert.equal(card.url.includes("clip.mp4"), true);
});

test("no false completed state without identifiable output", () => {
  assert.equal(buildCompletionCard({}), null);
  assert.equal(reconstructCompletionFromOutputs([]), null);
  assert.equal(reconstructCompletionFromOutputs([{ name: "x" }]), null);
});

test("refresh reconstruction persists when outputs exist", () => {
  const store = {
    data: {},
    getItem(key) { return this.data[key] ?? null; },
    setItem(key, value) { this.data[key] = String(value); },
    removeItem(key) { delete this.data[key]; }
  };
  const card = reconstructCompletionFromOutputs([
    { filename: "out.mp4", url: "/api/view?filename=out.mp4" }
  ], { duration: 10, promptId: "abc" });
  persistLatestOutput(card, store);
  const restored = readLatestOutput(store);
  assert.equal(restored.filename, "out.mp4");
  assert.equal(restored.duration, 10);
});

test("batch jobs expose per-job Apri video and latest marker", () => {
  const rows = batchJobOutputRows([
    { label: "Job 1", state: "completed", outputs: [{ filename: "a.mp4", url: "/api/view?filename=a.mp4" }], item: { duration: "5.0" } },
    { label: "Job 2", state: "completed", outputs: [{ filename: "b.mp4", url: "/api/view?filename=b.mp4" }], item: { duration: 8 } }
  ]);
  assert.equal(rows[0].url.includes("a.mp4"), true);
  assert.equal(rows[1].latest, true);
  assert.equal(rows[0].latest, false);
  assert.match(batchUi, /Apri video/);
  assert.match(batchUi, /ULTIMO OUTPUT/);
});

test("opening output has zero queue or GPU side effects", () => {
  assert.deepEqual(outputActionSideEffects(), { queuePosts: 0, promptPosts: 0, gpuWrites: 0 });
  const openSlice = app.slice(app.indexOf("Apri video"), app.indexOf("Apri video") + 400);
  assert.doesNotMatch(openSlice, /\/api\/queue/);
  assert.doesNotMatch(openSlice, /\/api\/gpu-power/);
});
