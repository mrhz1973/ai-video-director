import test from "node:test";
import assert from "node:assert/strict";
import {
  BATCH_DRAFT_VERSION,
  BATCH_RESTORE_ORIGIN,
  assertNoExecutionAuthority,
  assertPersistedBatchMatches,
  batchesEqual,
  findLegacyMigrationCandidate,
  legacyDraftKey,
  normalizeBatchDraft,
  resolvePostLoadBatchPersistence,
  scoreLegacyDraftCandidate,
  serializeBatchDraft
} from "../lib/batch-draft.mjs";

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

test("normalizeBatchDraft round-trips source and items", () => {
  const draft = serializeBatchDraft({ source: sampleSource, items: sampleItems(3) });
  assert.equal(draft.version, BATCH_DRAFT_VERSION);
  assert.equal(draft.items.length, 3);
  assert.equal(draft.items[2].prompt, "TEST PROMPT 3");
  const normalized = normalizeBatchDraft(draft);
  assert.equal(normalized.items[0].duration, "10");
});

test("execution authority fields are rejected from persisted batch drafts", () => {
  assert.throws(() => assertNoExecutionAuthority({
    version: 1,
    source: sampleSource,
    items: sampleItems(1),
    deferredBatch: { armed: true }
  }));
});

test("exact legacy key migrates when identity matches", () => {
  const draft = serializeBatchDraft({ source: sampleSource, items: sampleItems(8) });
  const scored = scoreLegacyDraftCandidate({
    projectId: "demo",
    projectWorkflowId: "minimax-h3-i2v",
    projectModel: sampleSource.model,
    projectFiles: sampleSource.files,
    legacyKey: legacyDraftKey("demo"),
    legacyDraft: draft
  });
  assert.equal(scored.ok, true);
  assert.equal(scored.jobCount, 8);
});

test("ambiguous legacy keys are not auto-migrated", () => {
  const draft = serializeBatchDraft({ source: sampleSource, items: sampleItems(4) });
  const entries = [
    { key: legacyDraftKey("other-a"), raw: JSON.stringify(draft) },
    { key: legacyDraftKey("other-b"), raw: JSON.stringify(draft) }
  ];
  const candidate = findLegacyMigrationCandidate({
    projectId: "demo",
    projectWorkflowId: "minimax-h3-i2v",
    projectModel: sampleSource.model,
    projectFiles: sampleSource.files,
    storageEntries: entries
  });
  assert.equal(candidate?.mode, "ambiguous");
});

test("none legacy key offers recovery instead of silent overwrite", () => {
  const draft = serializeBatchDraft({ source: sampleSource, items: sampleItems(8) });
  const candidate = findLegacyMigrationCandidate({
    projectId: "demo",
    projectWorkflowId: "minimax-h3-i2v",
    projectModel: sampleSource.model,
    projectFiles: sampleSource.files,
    storageEntries: [{ key: legacyDraftKey("none"), raw: JSON.stringify(draft) }]
  });
  assert.equal(candidate?.mode, "offer");
  assert.equal(candidate.jobCount, 8);
});

test("batchesEqual compares items and source identity", () => {
  const left = serializeBatchDraft({ source: sampleSource, items: sampleItems(2) });
  const right = serializeBatchDraft({ source: sampleSource, items: sampleItems(2) });
  assert.equal(batchesEqual(left, right), true);
  const changed = serializeBatchDraft({
    source: sampleSource,
    items: [{ ...sampleItems(2)[0], seed: "9" }, sampleItems(2)[1]]
  });
  assert.equal(batchesEqual(left, changed), false);
});

test("serializeBatchDraft omits updatedAt unless includeUpdatedAt is true", () => {
  const semantic = serializeBatchDraft({ source: sampleSource, items: sampleItems(2), includeUpdatedAt: false });
  const persisted = serializeBatchDraft({
    source: sampleSource,
    items: sampleItems(2),
    updatedAt: "2026-08-22T09:00:00.000Z",
    includeUpdatedAt: true
  });
  assert.equal("updatedAt" in semantic, false);
  assert.equal(persisted.updatedAt, "2026-08-22T09:00:00.000Z");
});

test("resolvePostLoadBatchPersistence marks legacy auto dirty until server Batch exists", () => {
  const legacy = resolvePostLoadBatchPersistence({
    serverBatchDraft: null,
    origin: BATCH_RESTORE_ORIGIN.LEGACY_AUTO,
    restored: true
  });
  assert.equal(legacy.needsPersistence, true);
  assert.equal(legacy.initialSaveStatus, "dirty");
  const server = resolvePostLoadBatchPersistence({
    serverBatchDraft: serializeBatchDraft({ source: sampleSource, items: sampleItems(2) }),
    origin: BATCH_RESTORE_ORIGIN.SERVER,
    restored: true
  });
  assert.equal(server.needsPersistence, false);
  assert.equal(server.initialSaveStatus, "saved");
});

test("assertPersistedBatchMatches rejects omitted Batch in response", () => {
  const requested = serializeBatchDraft({ source: sampleSource, items: sampleItems(2), includeUpdatedAt: true });
  assert.throws(() => assertPersistedBatchMatches(requested, null), /Batch non persistito/);
  assert.equal(assertPersistedBatchMatches(null, null), true);
});
