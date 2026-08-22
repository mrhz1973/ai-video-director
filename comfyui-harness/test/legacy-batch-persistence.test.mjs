import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile } from "node:fs/promises";
import { createProjectStore } from "../lib/project-store.mjs";
import {
  emptyLibrary,
  isProjectDirty,
  normalizeProject,
  parseProjectJson,
  projectEditorSnapshot
} from "../lib/projects.mjs";
import {
  BATCH_RESTORE_ORIGIN,
  assertPersistedBatchMatches,
  batchesEqual,
  legacyDraftKey,
  resolvePostLoadBatchPersistence,
  serializeBatchDraft
} from "../lib/batch-draft.mjs";
import {
  AUTOSAVE_DEBOUNCE_MS,
  SAVE_STATUS,
  createAutosaveController
} from "../public/autosave.mjs";
import { shouldRestoreExecutionIntent } from "../public/queue-coordinator.mjs";
import { readFileSync } from "node:fs";

const sampleSource = {
  workflowId: "minimax-h3-i2v",
  workflowLabel: "I2V",
  model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
  files: { firstImage: "frame.png" },
  requiredKeys: ["firstImage"],
  base: {
    prompt: "base",
    seed: "1",
    duration: "10",
    steps: "20",
    megapixels: "0.7",
    aspect: "16:9"
  }
};

function sampleItems(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    prompt: `LEGACY PROMPT ${index + 1}`,
    seed: String(index + 1),
    duration: "10",
    steps: "20",
    megapixels: "0.7",
    aspect: "16:9"
  }));
}

function editorState(batchDraft = null) {
  return {
    label: "Martino — Capanna Radio — Acting Test",
    workflowId: "minimax-h3-i2v",
    prompt: "acting prompt",
    settings: {
      model: sampleSource.model,
      megapixels: 0.7,
      steps: 20,
      duration: 10,
      aspect: "16:9",
      seed: 1
    },
    library: emptyLibrary(),
    files: sampleSource.files,
    batchDraft
  };
}

test("exact observed bug: server baseline excludes unpersisted legacy Batch and is dirty", () => {
  const legacy = serializeBatchDraft({
    source: sampleSource,
    items: sampleItems(2),
    includeUpdatedAt: false
  });
  const decision = resolvePostLoadBatchPersistence({
    serverBatchDraft: null,
    origin: BATCH_RESTORE_ORIGIN.LEGACY_AUTO,
    restored: true
  });
  assert.equal(decision.needsPersistence, true);
  assert.equal(decision.initialSaveStatus, "dirty");
  assert.equal(decision.baselineBatchDraft, null);

  const baseline = projectEditorSnapshot(editorState(decision.baselineBatchDraft));
  const current = projectEditorSnapshot(editorState(legacy));
  assert.equal(isProjectDirty(baseline, current), true);
  assert.notEqual(decision.initialSaveStatus, "saved");
});

test("legacy Batch load schedules one autosave PUT with 2 jobs then becomes clean", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-legacy-persist-"));
  const store = createProjectStore(dir);
  const created = await store.create({
    label: "Legacy Persist",
    workflowId: "minimax-h3-i2v",
    prompt: "prompt",
    settings: { model: sampleSource.model, megapixels: 0.7, steps: 20, duration: 10, aspect: "16:9", seed: 1 },
    files: sampleSource.files,
    library: emptyLibrary()
  });
  assert.equal(normalizeProject(created).batchDraft, null);

  const legacy = serializeBatchDraft({
    source: sampleSource,
    items: sampleItems(2),
    includeUpdatedAt: true
  });
  const baseline = projectEditorSnapshot(editorState(null));
  const current = projectEditorSnapshot(editorState(serializeBatchDraft({
    source: sampleSource,
    items: sampleItems(2),
    includeUpdatedAt: false
  })));
  assert.equal(isProjectDirty(baseline, current), true);

  let putCount = 0;
  const controller = createAutosaveController({
    debounceMs: 1,
    latestPayload: () => ({
      id: created.id,
      label: created.label,
      workflowId: created.workflowId,
      prompt: created.prompt,
      settings: created.settings,
      library: created.library,
      files: created.files,
      batchDraft: legacy
    }),
    saveFn: async payload => {
      putCount += 1;
      assert.equal(payload.batchDraft.items.length, 2);
      const updated = await store.update(created.id, payload);
      assertPersistedBatchMatches(payload.batchDraft, updated.batchDraft);
      return updated;
    }
  });

  controller.markDirty();
  await controller.flush();
  assert.equal(putCount, 1);
  assert.equal(controller.getStatus(), SAVE_STATUS.SAVED);

  const reloaded = normalizeProject(await store.read(created.id));
  assert.equal(reloaded.batchDraft.items.length, 2);
  assert.equal(reloaded.batchDraft.items[0].prompt, "LEGACY PROMPT 1");
  assert.equal(reloaded.batchDraft.items[1].seed, "2");

  const disk = parseProjectJson(await readFile(store.filePathFor(created.id), "utf8"));
  assert.equal(disk.batchDraft.items.length, 2);

  const cleanBaseline = projectEditorSnapshot(editorState(serializeBatchDraft({
    source: reloaded.batchDraft.source,
    items: reloaded.batchDraft.items,
    includeUpdatedAt: false
  })));
  assert.equal(isProjectDirty(cleanBaseline, cleanBaseline), false);

  await new Promise(resolve => setTimeout(resolve, AUTOSAVE_DEBOUNCE_MS + 40));
  assert.equal(putCount, 1);
});

test("server-existing Batch load stays clean with zero autosave", () => {
  const serverBatch = serializeBatchDraft({
    source: sampleSource,
    items: sampleItems(2),
    includeUpdatedAt: true
  });
  const decision = resolvePostLoadBatchPersistence({
    serverBatchDraft: serverBatch,
    origin: BATCH_RESTORE_ORIGIN.SERVER,
    restored: true
  });
  assert.equal(decision.needsPersistence, false);
  assert.equal(decision.initialSaveStatus, "saved");
  const semantic = serializeBatchDraft({
    source: serverBatch.source,
    items: serverBatch.items,
    includeUpdatedAt: false
  });
  const baseline = projectEditorSnapshot(editorState(semantic));
  const current = projectEditorSnapshot(editorState(semantic));
  assert.equal(isProjectDirty(baseline, current), false);
});

test("manual Save treats HTTP 200 without Batch as error", () => {
  const requested = serializeBatchDraft({
    source: sampleSource,
    items: sampleItems(2),
    includeUpdatedAt: true
  });
  assert.throws(
    () => assertPersistedBatchMatches(requested, null),
    /Batch non persistito/
  );
  assert.throws(
    () => assertPersistedBatchMatches(requested, { version: 1, source: sampleSource, items: [] }),
    /Batch non persistito|non corrisponde/
  );
});

test("autosave treats response that drops Batch as failure and keeps dirty", async () => {
  const requested = serializeBatchDraft({
    source: sampleSource,
    items: sampleItems(2),
    includeUpdatedAt: true
  });
  let putCount = 0;
  const controller = createAutosaveController({
    debounceMs: 1,
    latestPayload: () => ({ batchDraft: requested }),
    saveFn: async payload => {
      putCount += 1;
      // Simulate buggy 200 response that omits batchDraft.
      assertPersistedBatchMatches(payload.batchDraft, null);
    }
  });
  controller.markDirty();
  await controller.flush();
  assert.equal(putCount, 1);
  assert.equal(controller.getStatus(), SAVE_STATUS.ERROR);
  assert.ok(controller.getLastError());
});

test("successful persistence verification ignores updatedAt volatility", () => {
  const requested = serializeBatchDraft({
    source: sampleSource,
    items: sampleItems(2),
    updatedAt: "2026-08-22T10:00:00.000Z",
    includeUpdatedAt: true
  });
  const returned = serializeBatchDraft({
    source: sampleSource,
    items: sampleItems(2),
    updatedAt: "2026-08-22T11:00:00.000Z",
    includeUpdatedAt: true
  });
  assert.equal(assertPersistedBatchMatches(requested, returned), true);
  assert.equal(batchesEqual(requested, returned), true);
});

test("fresh browser / harness restart restore from server after migration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-legacy-restart-"));
  const storeA = createProjectStore(dir);
  const created = await storeA.create({
    label: "Cross Profile",
    workflowId: "minimax-h3-i2v",
    prompt: "prompt",
    settings: { model: sampleSource.model },
    files: sampleSource.files,
    library: emptyLibrary(),
    batchDraft: serializeBatchDraft({
      source: sampleSource,
      items: sampleItems(2),
      includeUpdatedAt: true
    })
  });

  // Fresh browser B: empty localStorage — read only from server store.
  const storeB = createProjectStore(dir);
  const profileB = normalizeProject(await storeB.read(created.id));
  assert.equal(profileB.batchDraft.items.length, 2);
  assert.deepEqual(
    profileB.batchDraft.items.map(item => item.prompt),
    ["LEGACY PROMPT 1", "LEGACY PROMPT 2"]
  );
  assert.deepEqual(
    profileB.batchDraft.items.map(item => item.seed),
    ["1", "2"]
  );
});

test("execution authority never restored and migration has zero autosubmit semantics", () => {
  assert.equal(shouldRestoreExecutionIntent(), false);
  assert.equal(legacyDraftKey("martino-capanna-radio-acting-test"), "h3BatchDraft:v1:martino-capanna-radio-acting-test");
});

test("app.js wires server-authoritative baseline and persist verification", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /assertPersistedBatchMatches/);
  assert.match(app, /resolvePostLoadBatchPersistence/);
  assert.match(app, /markBaselineFromServerBatch/);
  assert.match(app, /BATCH_RESTORE_ORIGIN\.LEGACY_AUTO/);
  assert.match(app, /needsPersistence/);
  // Must not mark SAVED immediately after legacy restore before persistence.
  const loadFn = app.slice(app.indexOf("async function loadProjectById"), app.indexOf("function resetDraft"));
  assert.match(loadFn, /persistence\.needsPersistence/);
  assert.match(loadFn, /SAVE_STATUS\.DIRTY/);
});
