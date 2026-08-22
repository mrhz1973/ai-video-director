import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile } from "node:fs/promises";
import { createProjectStore } from "../lib/project-store.mjs";
import { normalizeProject, parseProjectJson } from "../lib/projects.mjs";
import { serializeBatchDraft } from "../lib/batch-draft.mjs";
import { shouldRestoreExecutionIntent } from "../public/queue-coordinator.mjs";

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

test("saved project persists batchDraft on create and update", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-batch-persist-"));
  const store = createProjectStore(dir);
  const batchDraft = serializeBatchDraft({ source: sampleSource, items: sampleItems(8) });
  const created = await store.create({
    label: "Batch Persist Demo",
    workflowId: "minimax-h3-i2v",
    prompt: "prompt",
    settings: { model: sampleSource.model, megapixels: 0.7, steps: 20, duration: 10, aspect: "16:9", seed: 1 },
    files: sampleSource.files,
    library: { elements: [], locations: [], objects: [], audio: [] },
    batchDraft
  });
  const reloaded = await store.read(created.id);
  assert.equal(reloaded.batchDraft.items.length, 8);
  assert.equal(reloaded.batchDraft.items[7].prompt, "TEST PROMPT 8");

  const updated = await store.update(created.id, {
    batchDraft: serializeBatchDraft({
      source: sampleSource,
      items: [{ ...sampleItems(1)[0], prompt: "edited prompt" }]
    })
  });
  assert.equal(updated.batchDraft.items[0].prompt, "edited prompt");
});

test("clearing batchDraft removes it from persisted project JSON", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-batch-clear-"));
  const store = createProjectStore(dir);
  const created = await store.create({
    label: "Clear Batch",
    workflowId: "minimax-h3-i2v",
    prompt: "prompt",
    settings: { model: sampleSource.model },
    files: sampleSource.files,
    library: { elements: [], locations: [], objects: [], audio: [] },
    batchDraft: serializeBatchDraft({ source: sampleSource, items: sampleItems(2) })
  });
  await store.update(created.id, { batchDraft: null });
  const raw = await readFile(store.filePathFor(created.id), "utf8");
  const parsed = parseProjectJson(raw);
  assert.equal(parsed.batchDraft, null);
});

test("projects without batchDraft load normally (backward compatible)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-batch-legacy-"));
  const store = createProjectStore(dir);
  const created = await store.create({
    label: "Legacy",
    workflowId: "minimax-h3-i2v",
    prompt: "prompt",
    settings: { model: sampleSource.model },
    files: sampleSource.files,
    library: { elements: [], locations: [], objects: [], audio: [] }
  });
  const normalized = normalizeProject(await store.read(created.id));
  assert.equal(normalized.batchDraft, null);
});

test("cross-profile restore reads identical batch from server project file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-batch-cross-"));
  const store = createProjectStore(dir);
  const batchDraft = serializeBatchDraft({ source: sampleSource, items: sampleItems(8) });
  const created = await store.create({
    label: "Cross Browser",
    workflowId: "minimax-h3-i2v",
    prompt: "prompt",
    settings: { model: sampleSource.model, megapixels: 0.7, steps: 20, duration: 10, aspect: "16:9", seed: 1 },
    files: sampleSource.files,
    library: { elements: [], locations: [], objects: [], audio: [] },
    batchDraft
  });

  // Simulate Browser B with empty localStorage by reading only from server-side project store.
  const profileB = normalizeProject(await store.read(created.id));
  assert.equal(profileB.batchDraft.items.length, 8);
  assert.deepEqual(
    profileB.batchDraft.items.map(item => item.seed),
    ["1", "2", "3", "4", "5", "6", "7", "8"]
  );
});

test("harness restart restore reads identical batch from disk", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-batch-restart-"));
  const storeA = createProjectStore(dir);
  const created = await storeA.create({
    label: "Restart",
    workflowId: "minimax-h3-i2v",
    prompt: "prompt",
    settings: { model: sampleSource.model },
    files: sampleSource.files,
    library: { elements: [], locations: [], objects: [], audio: [] },
    batchDraft: serializeBatchDraft({ source: sampleSource, items: sampleItems(8) })
  });
  const storeB = createProjectStore(dir);
  const restored = normalizeProject(await storeB.read(created.id));
  assert.equal(restored.batchDraft.items[0].prompt, "TEST PROMPT 1");
  assert.equal(restored.batchDraft.items[7].duration, "10");
});

test("reload and restart never restore execution intent", () => {
  assert.equal(shouldRestoreExecutionIntent(), false);
});

test("persisted project JSON never stores queue execution authority", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-batch-safe-"));
  const store = createProjectStore(dir);
  const created = await store.create({
    label: "Safe",
    workflowId: "minimax-h3-i2v",
    prompt: "prompt",
    settings: { model: sampleSource.model },
    files: sampleSource.files,
    library: { elements: [], locations: [], objects: [], audio: [] },
    batchDraft: serializeBatchDraft({ source: sampleSource, items: sampleItems(2) })
  });
  const raw = await readFile(store.filePathFor(created.id), "utf8");
  assert.doesNotMatch(raw, /deferredBatch|queuedNext|submitAll|batchActive|"armed"/);
});
