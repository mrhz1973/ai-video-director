import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  freezeBatchLoraFields,
  queuePayloadLoraFields,
  validateBatchOwnedLora
} from "../lib/batch-lora-snapshot.mjs";
import { normalizeBatchDraft, serializeBatchDraft } from "../lib/batch-draft.mjs";
import { H3_LORA_OFF, getH3LoraProfile } from "../lib/h3-lora-catalog.mjs";
import {
  createQueueEntryFromDraft,
  normalizeBatchQueuePlan,
  setBatchQueuePlanRandomIdFactory
} from "../lib/batch-queue-plan-core.mjs";
import "../lib/batch-queue-plan.mjs";
import { batchLoraUiRepresentation } from "../public/h3-lora-ui.mjs";

setBatchQueuePlanRandomIdFactory(() => "test-batch-queue-id");

const root = path.dirname(fileURLToPath(import.meta.url));
const batchUi = readFileSync(path.join(root, "../public/batch-ui.mjs"), "utf8");
const batchQueueService = readFileSync(path.join(root, "../lib/batch-queue-service.mjs"), "utf8");
const h3LoraUi = readFileSync(path.join(root, "../public/h3-lora-ui.mjs"), "utf8");

const supportedPreset = { id: "minimax-h3-i2v", lora: { enabled: true } };
const unsupportedPreset = { id: "minimax-h3-ref2va", lora: { enabled: false } };

function allAvailable() {
  return {
    off: { available: true, comfyPath: null },
    "realism-people": {
      available: true,
      comfyPath: getH3LoraProfile("realism-people").comfyPath
    },
    "spatial-physics": {
      available: true,
      comfyPath: getH3LoraProfile("spatial-physics").comfyPath
    },
    "camera-motion": {
      available: true,
      comfyPath: getH3LoraProfile("camera-motion").comfyPath
    },
    action: {
      available: true,
      comfyPath: getH3LoraProfile("action").comfyPath
    }
  };
}

function sourceWithLora(lora = {}) {
  return {
    workflowId: "minimax-h3-i2v",
    workflowLabel: "I2V",
    model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
    files: {},
    requiredKeys: [],
    base: {
      prompt: "base",
      seed: "1",
      duration: "5",
      steps: "20",
      megapixels: "0.4",
      aspect: "16:9"
    },
    ...lora
  };
}

test("freezeBatchLoraFields defaults missing LoRA to OFF", () => {
  assert.deepEqual(freezeBatchLoraFields({}), { loraId: H3_LORA_OFF });
  assert.deepEqual(freezeBatchLoraFields(sourceWithLora()), { loraId: H3_LORA_OFF });
});

test("freezeBatchLoraFields preserves active Batch source LoRA", () => {
  assert.deepEqual(
    freezeBatchLoraFields(sourceWithLora({ loraId: "realism-people", loraStrength: 0.7 })),
    { loraId: "realism-people", loraStrength: 0.7 }
  );
});

test("freezeBatchLoraFields preserves invalid explicit strength for fail-closed validation", () => {
  assert.deepEqual(
    freezeBatchLoraFields(sourceWithLora({ loraId: "realism-people", loraStrength: 2.0 })),
    { loraId: "realism-people", loraStrength: 2.0 }
  );
  assert.deepEqual(
    freezeBatchLoraFields(sourceWithLora({ loraId: "action", loraStrength: "abc" })),
    { loraId: "action", loraStrength: "abc" }
  );
});

test("queuePayloadLoraFields OFF omits strength", () => {
  assert.deepEqual(queuePayloadLoraFields({ loraId: "off" }), { loraId: H3_LORA_OFF });
  assert.deepEqual(queuePayloadLoraFields({}), { loraId: H3_LORA_OFF });
});

test("queuePayloadLoraFields active includes numeric strength", () => {
  assert.deepEqual(
    queuePayloadLoraFields({ loraId: "spatial-physics", loraStrength: "0.30" }),
    { loraId: "spatial-physics", loraStrength: 0.3 }
  );
});

test("profile default strengths match SCENA catalog", () => {
  assert.equal(getH3LoraProfile("realism-people").defaultStrength, 0.7);
  assert.equal(getH3LoraProfile("spatial-physics").defaultStrength, 0.3);
  assert.equal(getH3LoraProfile("camera-motion").defaultStrength, 0.8);
  assert.equal(getH3LoraProfile("action").defaultStrength, 0.5);
});

test("validateBatchOwnedLora rejects strength 2.0", () => {
  const result = validateBatchOwnedLora({
    loraId: "realism-people",
    loraStrength: 2.0,
    preset: supportedPreset,
    availability: allAvailable()
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Forza LoRA non valida/i);
});

test("validateBatchOwnedLora rejects strength -0.1", () => {
  const result = validateBatchOwnedLora({
    loraId: "realism-people",
    loraStrength: -0.1,
    preset: supportedPreset,
    availability: allAvailable()
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Forza LoRA non valida/i);
});

test("validateBatchOwnedLora rejects non-numeric strength abc", () => {
  const result = validateBatchOwnedLora({
    loraId: "realism-people",
    loraStrength: "abc",
    preset: supportedPreset,
    availability: allAvailable()
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Forza LoRA non valida/i);
});

test("validateBatchOwnedLora rejects unknown loraId", () => {
  const result = validateBatchOwnedLora({
    loraId: "not-a-real-profile",
    loraStrength: 0.5,
    preset: supportedPreset,
    availability: allAvailable()
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /sconosciuto/i);
});

test("validateBatchOwnedLora rejects unavailable profile", () => {
  const availability = allAvailable();
  availability.action = {
    available: false,
    comfyPath: getH3LoraProfile("action").comfyPath
  };
  const result = validateBatchOwnedLora({
    loraId: "action",
    loraStrength: 0.5,
    preset: supportedPreset,
    availability
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /non disponibile/i);
});

test("validateBatchOwnedLora rejects unsupported preset with active LoRA", () => {
  const result = validateBatchOwnedLora({
    loraId: "realism-people",
    loraStrength: 0.7,
    preset: unsupportedPreset,
    availability: allAvailable()
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /non supportato/i);
});

test("validateBatchOwnedLora OFF is valid and omits active strength", () => {
  const result = validateBatchOwnedLora({
    loraId: H3_LORA_OFF,
    loraStrength: 0.9,
    preset: supportedPreset,
    availability: allAvailable()
  });
  assert.equal(result.ok, true);
  assert.equal(result.selection.loraId, H3_LORA_OFF);
  assert.equal(result.selection.loraStrength, null);
});

test("validateBatchOwnedLora preserves valid custom strength", () => {
  const result = validateBatchOwnedLora({
    loraId: "camera-motion",
    loraStrength: 0.95,
    preset: supportedPreset,
    availability: allAvailable()
  });
  assert.equal(result.ok, true);
  assert.equal(result.selection.loraId, "camera-motion");
  assert.equal(result.selection.loraStrength, 0.95);
});

test("validateBatchOwnedLora does not coerce invalid strength to profile default", () => {
  const result = validateBatchOwnedLora({
    loraId: "realism-people",
    loraStrength: 2.0,
    preset: supportedPreset,
    availability: allAvailable()
  });
  assert.equal(result.ok, false);
  assert.equal(result.selection, undefined);
});

test("persisted invalid LoRA ID cannot appear as OFF while source remains invalid", () => {
  const ui = batchLoraUiRepresentation({ loraId: "ghost-lora-from-disk" });
  assert.equal(ui.kind, "invalid-id");
  assert.equal(ui.pretendsOff, false);
  assert.equal(ui.sourceLoraId, "ghost-lora-from-disk");
  assert.notEqual(ui.selectValue, H3_LORA_OFF);
  assert.match(ui.label, /non valido/i);
});

test("syncBatchH3LoraFromSettings keeps invalid ID explicit in UI source", () => {
  assert.match(h3LoraUi, /dataset\.invalidLora/);
  assert.match(h3LoraUi, /non valido/);
  assert.match(h3LoraUi, /batchLoraUiRepresentation/);
  assert.doesNotMatch(
    h3LoraUi.slice(h3LoraUi.indexOf("export function syncBatchH3LoraFromSettings")),
    /select\.value = isKnownSelectValue\(loraId\) \? loraId : H3_LORA_OFF/
  );
});

test("Batch UI gates queue paths with validateBatchOwnedLora", () => {
  assert.match(batchUi, /validatePreparedBatchLora/);
  assert.match(batchUi, /validateBatchOwnedLora/);
  assert.match(batchUi, /function getCurrentBatchSnapshotForQueue/);
  const codaStart = batchUi.indexOf("export function getCurrentBatchSnapshotForQueue");
  const codaEnd = batchUi.indexOf("\nexport function bindBatchProjectKey", codaStart);
  const codaBody = batchUi.slice(codaStart, codaEnd);
  assert.match(codaBody, /validatePreparedBatchLora\(source\)/);
  assert.doesNotMatch(codaBody, /normalizePersistedLoraSettings/);

  const queueStart = batchUi.indexOf("async function queueBatch()");
  const queueEnd = batchUi.indexOf("\nfunction stateLabel", queueStart);
  const queueBody = batchUi.slice(queueStart, queueEnd);
  assert.match(queueBody, /validatePreparedBatchLora\(snapshot\)/);
  assert.doesNotMatch(queueBody, /normalizePersistedLoraSettings/);
});

test("commitBatchLoraFromDom does not use normalizePersistedLoraSettings as validation", () => {
  const start = batchUi.indexOf("function commitBatchLoraFromDom");
  const end = batchUi.indexOf("\nfunction validatePreparedBatchLora", start);
  const body = batchUi.slice(start, end);
  assert.doesNotMatch(body, /normalizePersistedLoraSettings/);
  assert.match(body, /readBatchH3LoraFromDom/);
});

test("prepared Batch source remains independent of later SCENA-like values in draft", () => {
  const draft = serializeBatchDraft({
    source: sourceWithLora({ loraId: "realism-people", loraStrength: 0.7 }),
    items: [
      { prompt: "a", seed: "1", duration: "5", steps: "20", megapixels: "0.4", aspect: "16:9" },
      { prompt: "b", seed: "2", duration: "5", steps: "20", megapixels: "0.4", aspect: "16:9" }
    ]
  });
  const afterSceneOff = normalizeBatchDraft({
    ...draft,
    // Simulate SCENA changing to OFF — Batch draft source must stay Realism.
    scenaLoraId: "off"
  });
  assert.equal(afterSceneOff.source.loraId, "realism-people");
  assert.equal(afterSceneOff.source.loraStrength, 0.7);
  assert.equal(afterSceneOff.items[0].loraId, undefined);
  assert.equal(afterSceneOff.items[1].loraStrength, undefined);
});

test("changing Batch source LoRA updates only source, not items", () => {
  const draft = serializeBatchDraft({
    source: sourceWithLora({ loraId: "spatial-physics", loraStrength: 0.3 }),
    items: [{ prompt: "a", seed: "1", duration: "5", steps: "20", megapixels: "0.4", aspect: "16:9" }]
  });
  assert.equal(draft.source.loraId, "spatial-physics");
  assert.equal(draft.source.loraStrength, 0.3);
  assert.equal(draft.items[0].loraId, undefined);
});

test("custom valid strength persists through normalize round-trip", () => {
  const draft = serializeBatchDraft({
    source: sourceWithLora({ loraId: "camera-motion", loraStrength: 0.95 }),
    items: [{ prompt: "a", seed: "1", duration: "5", steps: "20", megapixels: "0.4", aspect: "16:9" }]
  });
  const again = normalizeBatchDraft(draft);
  assert.equal(again.source.loraId, "camera-motion");
  assert.equal(again.source.loraStrength, 0.95);
});

test("multi-Batch CODA snapshot preserves Batch-owned LoRA", () => {
  const draft = serializeBatchDraft({
    source: sourceWithLora({ loraId: "action", loraStrength: 0.5 }),
    items: [{ prompt: "job", seed: "1", duration: "5", steps: "20", megapixels: "0.4", aspect: "16:9" }]
  });
  const entry = createQueueEntryFromDraft(draft, { name: "Batch A", order: 1 });
  const plan = normalizeBatchQueuePlan({ entries: [entry] });
  assert.equal(plan.entries[0].snapshot.source.loraId, "action");
  assert.equal(plan.entries[0].snapshot.source.loraStrength, 0.5);
});

test("immediate Batch payload wiring uses frozen Batch LoRA helpers", () => {
  assert.match(batchUi, /freezeBatchLoraFields\(base\)/);
  assert.match(batchUi, /\.\.\.queuePayloadLoraFields\(snapshot\)/);
  assert.match(batchUi, /freezeSubmissionSnapshot\(source,\s*live\)/);
  const freezeStart = batchUi.indexOf("function freezeSubmissionSnapshot");
  const freezeEnd = batchUi.indexOf("\nfunction setItemFileOverride", freezeStart);
  const freezeBody = batchUi.slice(freezeStart, freezeEnd);
  assert.match(freezeBody, /\.\.\.lora/);
  assert.doesNotMatch(freezeBody, /\$\("loraId"\)/);
  assert.doesNotMatch(freezeBody, /\$\("loraStrength"\)/);
});

test("deferred Batch freezes snapshot LoRA without reading SCENA DOM later", () => {
  const start = batchUi.indexOf("async function queueBatch()");
  const end = batchUi.indexOf("\nfunction stateLabel", start);
  const body = batchUi.slice(start, end);
  assert.match(body, /armDeferredBatch\(/);
  assert.match(body, /submitAll:\s*\(\)\s*=>\s*runSequentialBatch\(snapshot\)/);
  assert.match(body, /freezeSubmissionSnapshot\(source,\s*live\)/);
});

test("multi-Batch CODA buildQueuePayload still forwards source LoRA", () => {
  assert.match(batchQueueService, /loraId:\s*source\.loraId\s*\|\|\s*"off"/);
  assert.match(batchQueueService, /loraStrength:\s*Number\(source\.loraStrength\)/);
});

test("Batch prepare inherits SCENA LoRA once via collectSourceSnapshot", () => {
  assert.match(batchUi, /loraId:\s*\$\("loraId"\)\?\.value/);
  assert.match(batchUi, /loraStrength:\s*\$\("loraStrength"\)\?\.value/);
});

test("no per-job LoRA fields in Batch item export path", () => {
  assert.doesNotMatch(batchUi, /items\[.*\]\.loraId/);
  assert.doesNotMatch(batchUi, /item\.loraId\s*=/);
});
