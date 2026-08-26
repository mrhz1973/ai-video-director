/**
 * Issue #95 — Batch add-to-queue model gate regressions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BATCH_ADD_TO_QUEUE_UNPREPARED_HELP,
  batchAddToQueueBaseDisabled,
  resolveBatchAddToQueueGate
} from "../lib/batch-model-gate.mjs";
import { buildPresetModelRegistry, MODEL_BLOCKER_COPY } from "../lib/h3-model-registry.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const I2V_PRESET = {
  id: "minimax-h3-i2v",
  options: {
    models: [
      "minimax_h3_fl2va_pruned_fp8_Q4_0.gguf",
      "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf"
    ]
  }
};

test("zero compatible models disables add-to-queue with Italian model reason", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, [], { discoveryOk: true });
  const gate = resolveBatchAddToQueueGate({
    registry,
    selectedModel: "",
    preparedCount: 4,
    minBatchJobs: 1
  });
  assert.equal(gate.disabled, true);
  assert.equal(gate.modelBlocked, true);
  assert.match(gate.disabledReason, /Nessun checkpoint compatibile installato/);
});

test("compatible model clears model blocker but unprepared batch stays disabled", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, I2V_PRESET.options.models, { discoveryOk: true });
  const gate = resolveBatchAddToQueueGate({
    registry,
    selectedModel: I2V_PRESET.options.models[0],
    preparedCount: 0,
    minBatchJobs: 1
  });
  assert.equal(gate.modelBlocked, false);
  assert.equal(gate.baseDisabled, true);
  assert.equal(gate.disabled, true);
  assert.equal(gate.disabledReason, BATCH_ADD_TO_QUEUE_UNPREPARED_HELP);
});

test("compatible model with prepared batch enables add-to-queue", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, I2V_PRESET.options.models, { discoveryOk: true });
  const gate = resolveBatchAddToQueueGate({
    registry,
    selectedModel: I2V_PRESET.options.models[0],
    preparedCount: 2,
    minBatchJobs: 1
  });
  assert.equal(gate.disabled, false);
  assert.equal(gate.disabledReason, "");
});

test("model blocker takes precedence over prepared batch eligibility", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, [], { discoveryOk: true });
  const gate = resolveBatchAddToQueueGate({
    registry,
    selectedModel: I2V_PRESET.options.models[0],
    preparedCount: 8,
    minBatchJobs: 1
  });
  assert.equal(gate.disabled, true);
  assert.match(gate.disabledReason, /Nessun checkpoint compatibile installato/);
  assert.notEqual(gate.disabledReason, BATCH_ADD_TO_QUEUE_UNPREPARED_HELP);
});

test("batchAddToQueueBaseDisabled respects unrelated minimum job count", () => {
  assert.equal(batchAddToQueueBaseDisabled({ preparedCount: 0, minBatchJobs: 1 }), true);
  assert.equal(batchAddToQueueBaseDisabled({ preparedCount: 1, minBatchJobs: 1 }), false);
});

test("deeper snapshot path still rejects invalid model via registry gate", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, I2V_PRESET.options.models, { discoveryOk: true });
  const gate = resolveBatchAddToQueueGate({
    registry,
    selectedModel: "foreign-only.gguf",
    preparedCount: 3,
    minBatchJobs: 1
  });
  assert.equal(gate.disabled, true);
  assert.match(gate.disabledReason, /non compatibile/);
});

test("syncBatchModelGate wires batchAddToQueue through resolveBatchAddToQueueGate", () => {
  const batchUi = readFileSync(path.join(ROOT, "public/batch-ui.mjs"), "utf8");
  assert.match(batchUi, /resolveBatchAddToQueueGate/);
  assert.match(batchUi, /\$\("batchAddToQueue"\)/);
  assert.match(batchUi, /addQueue\.disabled = addGate\.disabled/);
  assert.match(batchUi, /whenDisabled: addGate\.disabledReason/);
});

test("getCurrentBatchSnapshotForQueue remains deeper fail-safe via collectSourceSnapshot", () => {
  const batchUi = readFileSync(path.join(ROOT, "public/batch-ui.mjs"), "utf8");
  assert.match(batchUi, /export function getCurrentBatchSnapshotForQueue/);
  assert.match(batchUi, /collectSourceSnapshot\(\)/);
  assert.match(batchUi, /currentModelBlocker\(\)/);
  assert.match(batchUi, /if \(modelBlock\.blocked\) return \{ error: modelBlock\.reason \}/);
});

test("MODEL_BLOCKER_COPY remains authoritative Italian surface", () => {
  assert.match(MODEL_BLOCKER_COPY.noCompatibleInstalled, /ComfyUI/);
});
