import test from "node:test";
import assert from "node:assert/strict";
import {
  assertNoExecutionAuthority,
  batchesEqual,
  serializeBatchDraft
} from "../lib/batch-draft.mjs";
import {
  emptyLibrary,
  isProjectDirty,
  projectEditorSnapshot,
  toPersistedProject
} from "../lib/projects.mjs";
import {
  AUTOSAVE_DEBOUNCE_MS,
  SAVE_STATUS,
  createAutosaveController
} from "../public/autosave.mjs";
import { formatBatchRestoreLabel } from "../lib/project-load.mjs";

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

function sampleItems(count = 8) {
  return Array.from({ length: count }, (_, index) => ({
    prompt: `TEST PROMPT ${index + 1}`,
    seed: String(index + 1),
    duration: "10",
    steps: "20",
    megapixels: "0.7",
    aspect: "16:9"
  }));
}

function editorBaseState(batchDraft = null) {
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

function snapshotWithBatch(items = sampleItems(8)) {
  const batchDraft = serializeBatchDraft({
    source: sampleSource,
    items,
    includeUpdatedAt: false
  });
  return projectEditorSnapshot(editorBaseState(batchDraft));
}

function snapshotWithEditedBatch(editFn) {
  const items = sampleItems(8);
  editFn(items);
  return projectEditorSnapshot(editorBaseState(serializeBatchDraft({
    source: sampleSource,
    items,
    includeUpdatedAt: false
  })));
}

test("project with batch: load baseline is clean immediately", () => {
  const baseline = snapshotWithBatch();
  const afterLoad = snapshotWithBatch();
  assert.equal(isProjectDirty(baseline, afterLoad), false);
});

test("project with batch: manual save baseline stays clean", () => {
  const savedBaseline = snapshotWithBatch();
  const postSave = snapshotWithBatch();
  assert.equal(isProjectDirty(savedBaseline, postSave), false);
});

test("markBaselineFromDraft equivalent: consecutive snapshots without edits stay equal", () => {
  const baseline = snapshotWithBatch();
  const immediateFollowUp = snapshotWithBatch();
  assert.equal(baseline, immediateFollowUp);
  assert.equal(isProjectDirty(baseline, immediateFollowUp), false);
});

test("no semantic batch change: repeated snapshot calls ignore timestamps", () => {
  const first = serializeBatchDraft({ source: sampleSource, items: sampleItems(8), includeUpdatedAt: false });
  const second = serializeBatchDraft({ source: sampleSource, items: sampleItems(8), includeUpdatedAt: false });
  const persisted = serializeBatchDraft({
    source: sampleSource,
    items: sampleItems(8),
    updatedAt: new Date().toISOString(),
    includeUpdatedAt: true
  });
  assert.equal("updatedAt" in first, false);
  assert.equal("updatedAt" in second, false);
  assert.equal(typeof persisted.updatedAt, "string");
  assert.equal(batchesEqual(first, second), true);
  assert.equal(batchesEqual(first, persisted), true);
  assert.equal(
    projectEditorSnapshot(editorBaseState(first)),
    projectEditorSnapshot(editorBaseState(second))
  );
});

test("real batch prompt edit marks project dirty", () => {
  const baseline = snapshotWithBatch();
  const dirty = snapshotWithEditedBatch(items => {
    items[0].prompt = "EDITED PROMPT";
  });
  assert.equal(isProjectDirty(baseline, dirty), true);
});

test("real batch seed edit marks project dirty", () => {
  const baseline = snapshotWithBatch();
  const dirty = snapshotWithEditedBatch(items => {
    items[3].seed = "99";
  });
  assert.equal(isProjectDirty(baseline, dirty), true);
});

test("real batch duration edit marks project dirty", () => {
  const baseline = snapshotWithBatch();
  const dirty = snapshotWithEditedBatch(items => {
    items[2].duration = "12";
  });
  assert.equal(isProjectDirty(baseline, dirty), true);
});

test("after successful autosave dirty returns false", async () => {
  let saveCount = 0;
  const controller = createAutosaveController({
    debounceMs: 1,
    latestPayload: () => ({ id: "demo", label: "Demo" }),
    saveFn: async () => {
      saveCount += 1;
    }
  });

  const baseline = snapshotWithBatch();
  controller.markDirty();
  await controller.flush();
  assert.equal(saveCount, 1);
  assert.equal(controller.getStatus(), SAVE_STATUS.SAVED);

  const clean = snapshotWithBatch();
  assert.equal(isProjectDirty(baseline, clean), false);
});

test("no repeated autosave without another edit after clean state", async () => {
  let saveCount = 0;
  const controller = createAutosaveController({
    debounceMs: AUTOSAVE_DEBOUNCE_MS,
    latestPayload: () => ({ id: "demo", label: "Demo" }),
    saveFn: async () => {
      saveCount += 1;
    }
  });

  const baseline = snapshotWithBatch();
  controller.markDirty();
  await controller.flush();
  assert.equal(saveCount, 1);

  const stillClean = snapshotWithBatch();
  assert.equal(isProjectDirty(baseline, stillClean), false);
  controller.reset(SAVE_STATUS.SAVED);
  await new Promise(resolve => setTimeout(resolve, AUTOSAVE_DEBOUNCE_MS + 50));
  assert.equal(saveCount, 1);
});

test("persisted batch may include updatedAt while execution authority stays absent", () => {
  const persisted = toPersistedProject({
    id: "demo-project",
    label: "Demo",
    workflowId: "minimax-h3-i2v",
    prompt: "prompt",
    settings: { model: sampleSource.model },
    files: sampleSource.files,
    library: emptyLibrary(),
    batchDraft: serializeBatchDraft({
      source: sampleSource,
      items: sampleItems(2),
      updatedAt: "2026-08-22T09:00:00.000Z",
      includeUpdatedAt: true
    })
  });
  assert.equal(typeof persisted.batchDraft.updatedAt, "string");
  assert.doesNotMatch(JSON.stringify(persisted), /deferredBatch|queuedNext|submitAll|batchActive|"armed"/);
  assert.equal(assertNoExecutionAuthority(persisted.batchDraft), true);
});

test("cross-browser batch restore regression: semantic snapshots stay equal after server reload shape", () => {
  const serverDraft = serializeBatchDraft({
    source: sampleSource,
    items: sampleItems(8),
    updatedAt: "2026-08-22T10:15:00.000Z",
    includeUpdatedAt: true
  });
  const editorDraft = serializeBatchDraft({
    source: serverDraft.source,
    items: serverDraft.items,
    includeUpdatedAt: false
  });
  assert.equal(
    projectEditorSnapshot(editorBaseState(editorDraft)),
    projectEditorSnapshot(editorBaseState(editorDraft))
  );
  assert.equal(batchesEqual(serverDraft, editorDraft), true);
});

test("project-load feedback regression: batch restored label still formats", () => {
  const label = formatBatchRestoreLabel({ count: 8, restored: true });
  assert.equal(label, "✓ Batch ripristinato · 8 job");
});
