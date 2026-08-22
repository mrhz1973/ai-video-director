import test from "node:test";
import assert from "node:assert/strict";
import {
  LOAD_STATUS,
  auditProjectRestore,
  formatBatchRestoreLabel,
  formatProjectLoadLabel,
  resolveLoadStatusFromError,
  shouldCommitLoadGeneration
} from "../lib/project-load.mjs";

test("project load labels cover loading success warning and error", () => {
  assert.match(formatProjectLoadLabel(LOAD_STATUS.LOADING, { label: "Demo" }), /Caricamento Demo/);
  assert.match(formatProjectLoadLabel(LOAD_STATUS.SUCCESS, { label: "Demo" }), /✓ Demo caricato/);
  assert.match(formatProjectLoadLabel(LOAD_STATUS.WARNING, { label: "Demo" }), /⚠ Demo caricato con avvisi/);
  assert.equal(formatProjectLoadLabel(LOAD_STATUS.ERROR), "✕ Errore caricamento progetto");
});

test("auditProjectRestore warns when model is unavailable", () => {
  const audit = auditProjectRestore({
    project: {
      id: "demo",
      label: "Demo",
      workflowId: "minimax-h3-i2v",
      settings: { model: "missing.gguf" }
    },
    availableModels: ["available.gguf"],
    presetExists: true
  });
  assert.equal(audit.status, LOAD_STATUS.WARNING);
  assert.match(audit.summary, /modello salvato non disponibile/);
});

test("auditProjectRestore confirms batch restore count", () => {
  const audit = auditProjectRestore({
    project: { id: "demo", label: "Demo", workflowId: "minimax-h3-i2v", settings: {} },
    availableModels: [],
    presetExists: true,
    batchDraft: { version: 1, source: { workflowId: "minimax-h3-i2v", model: "m", files: {}, base: {} }, items: [{ prompt: "a", seed: "1", duration: "10", steps: "20", megapixels: "0.7", aspect: "16:9" }] }
  });
  assert.equal(audit.batchCount, 1);
  assert.equal(formatBatchRestoreLabel({ count: 8, restored: true }), "✓ Batch ripristinato · 8 job");
});

test("stale async load protection ignores older generations", () => {
  assert.equal(shouldCommitLoadGeneration(2, 3), false);
  assert.equal(shouldCommitLoadGeneration(3, 3), true);
});

test("load errors resolve to error status", () => {
  const resolved = resolveLoadStatusFromError(new Error("Progetto non trovato"));
  assert.equal(resolved.status, LOAD_STATUS.ERROR);
  assert.match(resolved.detail, /Progetto non trovato/);
});
