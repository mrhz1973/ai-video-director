import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { FORBIDDEN_PERSISTENCE_KEYS } from "../lib/batch-draft.mjs";
import { createProjectStore } from "../lib/project-store.mjs";
import { normalizeProject } from "../lib/projects.mjs";
import {
  buildDuplicateProjectPayload,
  defaultDuplicateProjectLabel
} from "../lib/project-duplicate.mjs";
import {
  applyBatchWideSettings,
  detectBatchWideFieldState,
  formatBatchJobSummary,
  validateBatchWideSettings
} from "../public/batch-core.mjs";
import { serializeBatchDraft } from "../lib/batch-draft.mjs";

const sampleSource = {
  workflowId: "minimax-h3-i2v",
  workflowLabel: "I2V",
  model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
  files: { firstImage: "frame.png" },
  requiredKeys: ["firstImage"],
  base: { prompt: "base", seed: "1", duration: "5", steps: "20", megapixels: "0.3", aspect: "16:9" }
};

function escapeItems(count = 8) {
  return Array.from({ length: count }, (_, index) => ({
    prompt: `S0${index + 1} prompt`,
    seed: String(19 + index),
    duration: String(5 + (index % 3)),
    steps: String(20 + index),
    megapixels: "0.3",
    aspect: "16:9",
    files: { firstImage: `S0${index + 1}.png` }
  }));
}

function editorStateFromItems(items) {
  return {
    label: "Escape Sequence",
    workflowId: "minimax-h3-i2v",
    prompt: "shared prompt",
    settings: { model: sampleSource.model, megapixels: 0.3, steps: 20, duration: 5, aspect: "16:9", seed: 19 },
    library: {
      elements: [{ id: "g1", label: "Frames", members: [{ id: "m1", filename: "S01.png", type: "image" }] }],
      locations: [],
      objects: [],
      audio: []
    },
    files: { firstImage: "frame.png" },
    batchDraft: serializeBatchDraft({ source: sampleSource, items, includeUpdatedAt: false })
  };
}

test("duplicate creates new unique project with requested label", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-dup-"));
  const store = createProjectStore(dir);
  const items = escapeItems(2);
  const original = await store.create(buildDuplicateProjectPayload(editorStateFromItems(items), { newLabel: "Escape Sequence" }));
  const duplicateBody = buildDuplicateProjectPayload(editorStateFromItems(items), { newLabel: "Escape Sequence — 0.6MP Test" });
  const duplicate = await store.create(duplicateBody);
  assert.notEqual(duplicate.id, original.id);
  assert.equal(duplicate.label, "Escape Sequence — 0.6MP Test");
});

test("duplicate preserves editor payload; original unchanged after separate save", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-dup-orig-"));
  const store = createProjectStore(dir);
  const items = escapeItems(8);
  const state = editorStateFromItems(items);
  const original = await store.create(buildDuplicateProjectPayload(state, { newLabel: "Escape Sequence" }));
  const originalBefore = await store.read(original.id);

  const dupItems = items.map(item => ({ ...item, megapixels: "0.6", steps: "28" }));
  await store.create(buildDuplicateProjectPayload({
    ...state,
    batchDraft: serializeBatchDraft({ source: sampleSource, items: dupItems, includeUpdatedAt: false })
  }, { newLabel: "Escape Sequence — copia" }));

  const originalAfter = await store.read(original.id);
  assert.deepEqual(originalAfter.batchDraft.items.map(i => i.megapixels), originalBefore.batchDraft.items.map(i => i.megapixels));
  assert.equal(originalAfter.batchDraft.items[3].files.firstImage, "S04.png");
  assert.equal(originalAfter.batchDraft.items[0].prompt, "S01 prompt");
  assert.equal(originalAfter.batchDraft.items[7].seed, "26");
  assert.deepEqual(originalAfter.files, originalBefore.files);
});

test("duplicate payload strips runtime authority keys", () => {
  const items = escapeItems(2).map((item, index) => ({
    ...item,
    promptId: `runtime-${index}`,
    submitted: true
  }));
  const payload = buildDuplicateProjectPayload(editorStateFromItems(items), { newLabel: "Copy" });
  const raw = JSON.stringify(payload.batchDraft);
  for (const key of FORBIDDEN_PERSISTENCE_KEYS) {
    assert.doesNotMatch(raw, new RegExp(`"${key}"`));
  }
});

test("default duplicate label suggests copia suffix", () => {
  assert.equal(defaultDuplicateProjectLabel("Escape Sequence"), "Escape Sequence — copia");
});

test("buildDuplicateProjectPayload rejects empty label", () => {
  assert.throws(() => buildDuplicateProjectPayload(editorStateFromItems(escapeItems(2)), { newLabel: "  " }), /Nome progetto/);
});

test("applyBatchWideSettings updates MP/aspect/steps for every job", () => {
  const items = escapeItems(8);
  const next = applyBatchWideSettings(items, { megapixels: "0.6", aspect: "16:9", steps: "28" });
  assert.equal(next.length, 8);
  for (const item of next) {
    assert.equal(item.megapixels, "0.6");
    assert.equal(item.aspect, "16:9");
    assert.equal(item.steps, "28");
  }
});

test("applyBatchWideSettings preserves prompt seed duration files and order", () => {
  const items = escapeItems(8);
  const next = applyBatchWideSettings(items, { megapixels: "0.6", aspect: "16:9", steps: "28" });
  assert.deepEqual(next.map(i => i.prompt), items.map(i => i.prompt));
  assert.deepEqual(next.map(i => i.seed), items.map(i => i.seed));
  assert.deepEqual(next.map(i => i.duration), items.map(i => i.duration));
  assert.deepEqual(next.map(i => i.files), items.map(i => i.files));
  assert.notEqual(next, items);
  assert.notEqual(next[0], items[0]);
});

test("detectBatchWideFieldState reports uniform and mixed values", () => {
  const uniform = escapeItems(4);
  assert.deepEqual(detectBatchWideFieldState(uniform, "megapixels"), { mode: "uniform", value: "0.3" });
  const mixed = uniform.map((item, index) => ({ ...item, megapixels: index % 2 ? "0.4" : "0.3" }));
  assert.deepEqual(detectBatchWideFieldState(mixed, "megapixels"), { mode: "mixed" });
});

test("validateBatchWideSettings fails on invalid values and empty batch", () => {
  assert.equal(validateBatchWideSettings({ items: [], megapixels: "0.3", aspect: "16:9", steps: "20" }).valid, false);
  assert.equal(validateBatchWideSettings({ items: escapeItems(2), megapixels: "99", aspect: "16:9", steps: "20" }).valid, false);
  assert.equal(validateBatchWideSettings({ items: escapeItems(2), megapixels: "0.3", aspect: "bad", steps: "20" }).valid, false);
  assert.equal(validateBatchWideSettings({ items: escapeItems(2), megapixels: "0.3", aspect: "16:9", steps: "0" }).valid, false);
  assert.equal(validateBatchWideSettings({ items: escapeItems(2), megapixels: "0.6", aspect: "16:9", steps: "28" }).valid, true);
});

test("formatBatchJobSummary includes aspect and steps", () => {
  const summary = formatBatchJobSummary({ seed: "22", duration: "5", megapixels: "0.3", aspect: "16:9", steps: "20" });
  assert.match(summary, /seed 22/);
  assert.match(summary, /16:9/);
  assert.match(summary, /20 steps/);
});

test("integration: duplicate then global apply on copy only", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-dup-global-"));
  const store = createProjectStore(dir);
  const sourceItems = escapeItems(8);
  const original = await store.create(buildDuplicateProjectPayload(editorStateFromItems(sourceItems), { newLabel: "Escape Sequence" }));

  const duplicateItems = applyBatchWideSettings(sourceItems, { megapixels: "0.6", aspect: "16:9", steps: "28" });
  const duplicate = await store.create(buildDuplicateProjectPayload({
    ...editorStateFromItems(sourceItems),
    batchDraft: serializeBatchDraft({ source: sampleSource, items: duplicateItems, includeUpdatedAt: false })
  }, { newLabel: "Escape Sequence — 0.6MP Test" }));

  const reloadedOriginal = await store.read(original.id);
  const reloadedDuplicate = await store.read(duplicate.id);
  assert.equal(reloadedOriginal.batchDraft.items[0].megapixels, "0.3");
  assert.equal(reloadedDuplicate.batchDraft.items[0].megapixels, "0.6");
  assert.equal(reloadedDuplicate.batchDraft.items[3].files.firstImage, "S04.png");
  assert.equal(reloadedDuplicate.batchDraft.items[2].duration, "7");
});

test("v0.9.0 project without batchDraft still normalizes", () => {
  const normalized = normalizeProject({
    id: "legacy",
    label: "Legacy",
    workflowId: "minimax-h3-i2v",
    prompt: "p",
    settings: { model: "m" },
    library: { elements: [], locations: [], objects: [], audio: [] },
    files: {}
  });
  assert.equal(normalized.batchDraft, null);
});

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const batchUi = readFileSync(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const duplicateLib = readFileSync(new URL("../lib/project-duplicate.mjs", import.meta.url), "utf8");

test("Salva come UI and fail-closed duplicate wiring", () => {
  assert.match(html, /id="projectSaveAs"/);
  assert.match(html, /Salva come/);
  assert.match(app, /duplicateCurrentProject/);
  assert.match(app, /buildDuplicateProjectPayload/);
  assert.match(app, /activatePersistedProject/);
  const dupFn = app.slice(app.indexOf("async function duplicateCurrentProject"), app.indexOf("async function activatePersistedProject"));
  assert.doesNotMatch(dupFn, /draft\.id\s*=/);
  assert.match(dupFn, /await activatePersistedProject\(data\)/);
  assert.ok(dupFn.indexOf("fetch(\"/api/projects\"") < dupFn.indexOf("activatePersistedProject"));
});

test("global batch settings UI and explicit apply only", () => {
  assert.match(batchUi, /Impostazioni globali batch/);
  assert.match(batchUi, /batchGlobalApply/);
  assert.match(batchUi, /applyBatchWideSettings/);
  assert.match(batchUi, /Espandi tutti/);
  assert.match(batchUi, /Comprimi tutti/);
  const applyRegion = batchUi.slice(batchUi.indexOf("function applyBatchGlobalSettings"), batchUi.indexOf("function collectSourceSnapshot"));
  assert.match(applyRegion, /markEdited\(\)/);
  const expandRegion = batchUi.slice(
    batchUi.indexOf("function setAllBatchJobsExpanded"),
    batchUi.indexOf("\nfunction batchPresetForSource")
  );
  assert.doesNotMatch(expandRegion, /markEdited/);
  assert.doesNotMatch(expandRegion, /persistDraft/);
});

test("no queue/prompt/gpu side effects in duplicate/global/expand modules", () => {
  assert.doesNotMatch(duplicateLib, /\/api\/queue/);
  assert.doesNotMatch(duplicateLib, /["'`]\/prompt["'`]/);
  assert.doesNotMatch(batchUi, /batchGlobalApply[\s\S]{0,400}\/api\/queue/);
  assert.doesNotMatch(batchUi, /setAllBatchJobsExpanded[\s\S]{0,300}\/api\/queue/);
});
