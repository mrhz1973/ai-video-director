import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  H3_LORA_INJECT_NODE_ID,
  H3_LORA_LOADER_CLASS,
  H3_LORA_OFF,
  H3_LORA_PROFILE_IDS,
  listH3LoraProfiles,
  presetSupportsH3Lora
} from "../lib/h3-lora-catalog.mjs";
import {
  normalizePersistedLoraSettings,
  validateLoraSelection
} from "../lib/h3-lora-validation.mjs";
import {
  applyH3LoraPatch,
  countLoraNodes,
  findModelConsumers
} from "../lib/h3-lora-transform.mjs";
import { buildH3LoraAvailability } from "../lib/h3-lora-availability.mjs";
import { buildBoundWorkflowWithLora } from "../lib/h3-lora-workflow.mjs";
import { buildSingleRenderPayload } from "../public/single-render.mjs";
import {
  editorStateFromDomLike,
  normalizeProject
} from "../lib/projects.mjs";
import { normalizeBatchDraft, serializeBatchDraft } from "../lib/batch-draft.mjs";
import { normalizeBatchQueuePlan, createQueueEntryFromDraft, setBatchQueuePlanRandomIdFactory } from "../lib/batch-queue-plan-core.mjs";
import "../lib/batch-queue-plan.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = JSON.parse(
  readFileSync(path.join(ROOT, "test/fixtures/h3-i2v-model-topology.json"), "utf8")
);

const I2V_PRESET = {
  id: "minimax-h3-i2v",
  mode: "I2VA",
  lora: { enabled: true },
  bindings: {
    model: { node: "136", input: "unet_name" },
    prompt: { node: "133", input: "prompt" }
  }
};

const T2V_PRESET = {
  id: "minimax-h3-t2v",
  mode: "T2VA",
  bindings: { model: { node: "136", input: "unet_name" } }
};

const ALL_LORA_PATHS = listH3LoraProfiles()
  .filter(profile => profile.comfyPath)
  .map(profile => profile.comfyPath);

test("catalog contains exactly four production profiles plus OFF", () => {
  assert.deepEqual(H3_LORA_PROFILE_IDS, [
    "off",
    "realism-people",
    "spatial-physics",
    "camera-motion",
    "action"
  ]);
  assert.equal(listH3LoraProfiles().length, 5);
});

test("unknown LoRA IDs are rejected", () => {
  const result = validateLoraSelection({
    loraId: "turbo-v4",
    preset: I2V_PRESET,
    availableComfyPaths: ALL_LORA_PATHS
  });
  assert.equal(result.ok, false);
});

test("invalid strength values are rejected", () => {
  for (const strength of [NaN, Infinity, -0.1, 1.51]) {
    const result = validateLoraSelection({
      loraId: "realism-people",
      loraStrength: strength,
      preset: I2V_PRESET,
      availableComfyPaths: ALL_LORA_PATHS
    });
    assert.equal(result.ok, false, `expected reject for ${strength}`);
  }
});

test("OFF preserves existing model path with no LoRA node", () => {
  const original = structuredClone(FIXTURE);
  const patched = applyH3LoraPatch(FIXTURE, {
    preset: I2V_PRESET,
    loraSelection: { loraId: H3_LORA_OFF }
  });
  assert.equal(countLoraNodes(patched), 0);
  assert.deepEqual(patched["128"].inputs.model, ["136", 0]);
  assert.deepEqual(patched["130"].inputs.model, ["136", 0]);
  assert.deepEqual(FIXTURE, original);
});

function assertSingleLoraPatch(patched, expectedPath, expectedStrength) {
  assert.equal(countLoraNodes(patched), 1);
  const node = patched[H3_LORA_INJECT_NODE_ID];
  assert.equal(node.class_type, H3_LORA_LOADER_CLASS);
  assert.equal(node.inputs.lora_name, expectedPath);
  assert.equal(node.inputs.strength_model, expectedStrength);
  assert.deepEqual(node.inputs.model, ["136", 0]);
  assert.deepEqual(patched["128"].inputs.model, [H3_LORA_INJECT_NODE_ID, 0]);
  assert.deepEqual(patched["130"].inputs.model, [H3_LORA_INJECT_NODE_ID, 0]);
}

test("Realism People patch uses allowlisted filename and user strength", () => {
  const patched = applyH3LoraPatch(FIXTURE, {
    preset: I2V_PRESET,
    loraSelection: { loraId: "realism-people", loraStrength: 0.65 }
  });
  assertSingleLoraPatch(
    patched,
    "minimax_h3\\production\\h3-realism-people-t2v-i2v-r2v.safetensors",
    0.65
  );
});

test("Spatial Physics patch uses allowlisted filename and user strength", () => {
  const patched = applyH3LoraPatch(FIXTURE, {
    preset: I2V_PRESET,
    loraSelection: { loraId: "spatial-physics", loraStrength: 0.25 }
  });
  assertSingleLoraPatch(
    patched,
    "minimax_h3\\production\\wushu_spatial_physics_clean_3000_pruned.safetensors",
    0.25
  );
});

test("Camera Motion patch uses allowlisted filename and user strength", () => {
  const patched = applyH3LoraPatch(FIXTURE, {
    preset: I2V_PRESET,
    loraSelection: { loraId: "camera-motion", loraStrength: 0.9 }
  });
  assertSingleLoraPatch(
    patched,
    "minimax_h3\\production\\camera_motion_h3_lora_v1_3000_pruned.safetensors",
    0.9
  );
});

test("Action patch uses allowlisted filename and user strength", () => {
  const patched = applyH3LoraPatch(FIXTURE, {
    preset: I2V_PRESET,
    loraSelection: { loraId: "action", loraStrength: 0.4 }
  });
  assertSingleLoraPatch(
    patched,
    "minimax_h3\\production\\wushu_action_h3_lora_v5_3000_pruned.safetensors",
    0.4
  );
});

test("requests cannot supply arbitrary LoRA filesystem paths", () => {
  const result = validateLoraSelection({
    loraId: "realism-people",
    lora_name: "evil\\path.safetensors",
    preset: I2V_PRESET,
    availableComfyPaths: ALL_LORA_PATHS
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /non consentito/);
});

test("existing project without LoRA loads as OFF", () => {
  const project = normalizeProject({
    id: "p1",
    label: "Legacy",
    settings: { model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf" }
  });
  assert.equal(project.settings.loraId, H3_LORA_OFF);
  assert.equal(project.settings.loraStrength, undefined);
});

test("project round-trip preserves loraId and strength", () => {
  const snapshot = editorStateFromDomLike({
    label: "Test",
    workflowId: "minimax-h3-i2v",
    prompt: "scene",
    megapixels: "0.4",
    model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
    steps: "20",
    duration: "5",
    aspect: "16:9",
    seed: "1",
    loraId: "camera-motion",
    loraStrength: "0.75"
  });
  assert.equal(snapshot.settings.loraId, "camera-motion");
  assert.equal(snapshot.settings.loraStrength, 0.75);
});

test("single payload preserves loraId and strength", () => {
  const intent = buildSingleRenderPayload({
    clientId: "c1",
    workflowId: "minimax-h3-i2v",
    prompt: "test",
    megapixels: 0.4,
    model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
    steps: 20,
    duration: 5,
    aspect: "16:9",
    seed: 1,
    loraId: "spatial-physics",
    loraStrength: 0.3
  });
  assert.equal(intent.loraId, "spatial-physics");
  assert.equal(intent.loraStrength, 0.3);
});

test("batch source snapshot preserves loraId and strength", () => {
  const draft = serializeBatchDraft({
    source: {
      workflowId: "minimax-h3-i2v",
      workflowLabel: "I2V",
      model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
      files: {},
      requiredKeys: [],
      loraId: "realism-people",
      loraStrength: 0.7,
      base: {
        prompt: "base",
        seed: "1",
        duration: "5",
        steps: "20",
        megapixels: "0.4",
        aspect: "16:9"
      }
    },
    items: [{ prompt: "job", seed: "1", duration: "5", steps: "20", megapixels: "0.4", aspect: "16:9" }]
  });
  const normalized = normalizeBatchDraft(draft);
  assert.equal(normalized.source.loraId, "realism-people");
  assert.equal(normalized.source.loraStrength, 0.7);
});

test("queue persistence remains descriptive only", () => {
  const draft = serializeBatchDraft({
    source: {
      workflowId: "minimax-h3-i2v",
      model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
      files: {},
      requiredKeys: ["firstImage"],
      loraId: "action",
      loraStrength: 0.5,
      base: { prompt: "p", seed: "1", duration: "5", steps: "20", megapixels: "0.4", aspect: "16:9" }
    },
    items: [{ prompt: "job", seed: "1", duration: "5", steps: "20", megapixels: "0.4", aspect: "16:9" }]
  });
  const entry = createQueueEntryFromDraft(draft, { name: "Batch A", order: 1 });
  const plan = normalizeBatchQueuePlan({ entries: [entry] });
  assert.equal(plan.entries[0].snapshot.source.loraId, "action");
  assert.equal(plan.entries[0].snapshot.source.loraStrength, 0.5);
  assert.equal(plan.entries[0].snapshot.source.queuedNext, undefined);
});

test("existing batch without LoRA fields remains OFF", () => {
  const normalized = normalizeBatchDraft({
    version: 1,
    source: {
      workflowId: "minimax-h3-i2v",
      model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
      files: {},
      requiredKeys: [],
      base: { prompt: "p", seed: "1", duration: "5", steps: "20", megapixels: "0.4", aspect: "16:9" }
    },
    items: [{ prompt: "job", seed: "1", duration: "5", steps: "20", megapixels: "0.4", aspect: "16:9" }]
  });
  assert.equal(normalized.source.loraId, H3_LORA_OFF);
});

test("unsupported preset disables LoRA safely", () => {
  assert.equal(presetSupportsH3Lora(T2V_PRESET), false);
  const result = validateLoraSelection({
    loraId: "realism-people",
    loraStrength: 0.7,
    preset: T2V_PRESET,
    availableComfyPaths: ALL_LORA_PATHS
  });
  assert.equal(result.ok, false);
});

test("missing local LoRA fails closed", () => {
  const result = validateLoraSelection({
    loraId: "realism-people",
    loraStrength: 0.7,
    preset: I2V_PRESET,
    availableComfyPaths: []
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "lora-unavailable");
});

test("workflow transform does not mutate the original workflow object", () => {
  const original = structuredClone(FIXTURE);
  applyH3LoraPatch(FIXTURE, {
    preset: I2V_PRESET,
    loraSelection: { loraId: "realism-people", loraStrength: 0.7 }
  });
  assert.deepEqual(FIXTURE, original);
});

test("exactly one LoRA can be active", () => {
  const patched = applyH3LoraPatch(FIXTURE, {
    preset: I2V_PRESET,
    loraSelection: { loraId: "realism-people", loraStrength: 0.7 }
  });
  assert.equal(countLoraNodes(patched), 1);
});

test("model consumers are discovered for sanitized fixture", () => {
  const consumers = findModelConsumers(FIXTURE, "136");
  assert.equal(consumers.length, 2);
});

test("availability map marks missing production LoRAs unavailable", () => {
  const availability = buildH3LoraAvailability(["minimax_h3\\production\\h3-realism-people-t2v-i2v-r2v.safetensors"]);
  assert.equal(availability.off.available, true);
  assert.equal(availability["realism-people"].available, true);
  assert.equal(availability.action.available, false);
});

test("bound workflow builder applies LoRA after bindings", () => {
  const workflow = structuredClone(FIXTURE);
  workflow["133"] = { class_type: "Text", inputs: { prompt: "old" } };
  const bound = buildBoundWorkflowWithLora({
    workflow,
    preset: { ...I2V_PRESET, bindings: { ...I2V_PRESET.bindings, prompt: { node: "133", input: "prompt" } } },
    values: { prompt: "new" },
    loraSelection: { loraId: "realism-people", loraStrength: 0.7 }
  });
  assert.equal(bound["133"].inputs.prompt, "new");
  assert.equal(countLoraNodes(bound), 1);
});

test("index exposes LoRA controls in SCENA generation grid", () => {
  const html = readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  assert.match(html, /id="loraId"/);
  assert.match(html, /id="loraStrength"/);
  assert.match(html, /id="loraHint"/);
});

test("normalizePersistedLoraSettings defaults missing fields to OFF", () => {
  assert.deepEqual(normalizePersistedLoraSettings({}), { loraId: H3_LORA_OFF });
});

test("normalizePersistedLoraSettings keeps explicit invalid strength distinguishable from missing", () => {
  assert.deepEqual(
    normalizePersistedLoraSettings({ loraId: "realism-people", loraStrength: "abc" }),
    { loraId: "realism-people", loraStrength: "abc" }
  );
  assert.deepEqual(
    normalizePersistedLoraSettings({ loraId: "realism-people" }),
    { loraId: "realism-people" }
  );
});
