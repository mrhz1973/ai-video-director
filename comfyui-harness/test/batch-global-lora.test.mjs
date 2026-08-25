import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  freezeBatchLoraFields,
  queuePayloadLoraFields
} from "../lib/batch-lora-snapshot.mjs";
import { normalizeBatchDraft, serializeBatchDraft } from "../lib/batch-draft.mjs";
import { H3_LORA_OFF, getH3LoraProfile } from "../lib/h3-lora-catalog.mjs";
import {
  createQueueEntryFromDraft,
  normalizeBatchQueuePlan,
  setBatchQueuePlanRandomIdFactory
} from "../lib/batch-queue-plan-core.mjs";
import "../lib/batch-queue-plan.mjs";

setBatchQueuePlanRandomIdFactory(() => "test-batch-queue-id");

const root = path.dirname(fileURLToPath(import.meta.url));
const batchUi = readFileSync(path.join(root, "../public/batch-ui.mjs"), "utf8");
const batchQueueService = readFileSync(path.join(root, "../lib/batch-queue-service.mjs"), "utf8");

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
