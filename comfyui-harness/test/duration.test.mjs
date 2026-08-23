import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatDurationCompact,
  formatDurationLabel,
  hasDecimalDurationDisplay,
  normalizeDurationSeconds
} from "../lib/duration.mjs";
import { createBatchItems, formatBatchJobSummary, validateBatchDraft } from "../public/batch-core.mjs";
import { buildRecoverySnapshot } from "../public/autosave.mjs";
import { normalizeProject } from "../lib/projects.mjs";
import { buildOutputTokens } from "../public/output-naming.mjs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const batchUi = readFileSync(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("normalizes 5.0, commas, fractions, and clamps to workflow min/max", () => {
  assert.equal(normalizeDurationSeconds("5.0"), 5);
  assert.equal(normalizeDurationSeconds(5.0), 5);
  assert.equal(normalizeDurationSeconds("5,5"), 6);
  assert.equal(normalizeDurationSeconds(3.2), 4);
  assert.equal(normalizeDurationSeconds(40), 15);
  assert.equal(normalizeDurationSeconds("nope"), 5);
  assert.equal(formatDurationCompact("5.0"), "5s");
  assert.equal(formatDurationLabel(10), "10 s");
  assert.equal(hasDecimalDurationDisplay("5.0 s"), true);
  assert.equal(hasDecimalDurationDisplay("5 s"), false);
});

test("single duration control is integer step only", () => {
  assert.match(html, /id="duration"[^>]*step="1"/);
  assert.doesNotMatch(html, /id="duration"[^>]*step="0\.1"/);
  assert.match(batchUi, /data-field="duration"[^>]*step="1"/);
});

test("project load and recovery draft normalize duration without generation", () => {
  const project = normalizeProject({
    id: "p",
    label: "P",
    settings: { duration: "5.0", megapixels: 0.3, steps: 20, seed: 1, aspect: "16:9" }
  });
  assert.equal(project.settings.duration, 5);
  const snap = buildRecoverySnapshot({ duration: "5,0", prompt: "x" });
  assert.equal(normalizeProject(snap.project).settings.duration, 5);
  assert.doesNotMatch(app, /normalizeDurationSeconds\([^\)]*\).*\/api\/queue/);
});

test("batch prepare/summary use compact integer seconds", () => {
  const items = createBatchItems({ prompt: "ok", seed: 1, duration: "5.0", steps: 20, megapixels: 0.3, aspect: "16:9" }, 2);
  assert.equal(items[0].duration, "5");
  assert.equal(formatBatchJobSummary(items[0]), "seed 1 · 5s · 0.3MP · 16:9 · 20 steps");
  assert.equal(hasDecimalDurationDisplay(formatBatchJobSummary(items[0])), false);
  const valid = validateBatchDraft({
    items,
    requiredFiles: {},
    requiredKeys: []
  });
  assert.equal(valid.valid, true);
});

test("output tokens store whole seconds", () => {
  const tokens = buildOutputTokens({ duration: "5.0", project: "A", scene: "s", workflow: "minimax-h3-t2v", model: "x.gguf", megapixels: 0.3, steps: 20, seed: 1 });
  assert.equal(tokens.duration, "5");
});

test("normal UI sources do not keep decimal duration labels", () => {
  const ui = html + batchUi + readFileSync(new URL("../public/monitor.mjs", import.meta.url), "utf8");
  assert.equal(hasDecimalDurationDisplay(ui.replace(/5\.0/g, "5")), false);
});
