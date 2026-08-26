/**
 * Issue #95 — H3 model registry / discovery / selection safety.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  H3_UNET_LOADER_CLASS,
  MODEL_STATUS,
  buildAllPresetModelRegistries,
  buildPresetModelRegistry,
  friendlyModelLabel,
  modelQuantizationHint,
  normalizeRegistryRecord,
  resolveModelSelection
} from "../lib/h3-model-registry.mjs";
import {
  fetchComfyUnetNames,
  readComfyUnetAvailability
} from "../lib/h3-model-availability.mjs";
import { populateModelSelect, refreshModelHint } from "../public/model-select-ui.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const I2V_PRESET = {
  id: "minimax-h3-i2v",
  label: "MiniMax H3 · Image to Video",
  mode: "I2VA",
  options: {
    models: [
      "minimax_h3_fl2va_pruned_fp8_Q4_0.gguf",
      "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf"
    ]
  }
};

const REF_PRESET = {
  id: "minimax-h3-reference",
  label: "MiniMax H3 · Ref",
  mode: "Ref2VA",
  options: { models: ["minimax-h3-ref2va-Q4_0.gguf"] }
};

test("friendly labels derive from filename metadata only", () => {
  assert.equal(friendlyModelLabel("minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf"), "H3 Q8CR");
  assert.equal(friendlyModelLabel("minimax-h3-ref2va-Q4_0.gguf"), "H3 Ref Q4");
  assert.equal(modelQuantizationHint("minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf"), "Q8_CR");
});

test("installed + compatible models are available when discovery succeeds", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, [
    "minimax_h3_fl2va_pruned_fp8_Q4_0.gguf",
    "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf"
  ], { discoveryOk: true });
  assert.equal(registry.entries.length, 2);
  assert.ok(registry.entries.every(e => e.status === MODEL_STATUS.AVAILABLE));
  assert.deepEqual(registry.selectableFilenames, I2V_PRESET.options.models);
});

test("declared but missing models are not silently selectable", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, [
    "minimax_h3_fl2va_pruned_fp8_Q4_0.gguf"
  ], { discoveryOk: true });
  const missing = registry.entries.find(e => e.filename.includes("Q8_CR"));
  assert.equal(missing.status, MODEL_STATUS.MISSING);
  assert.equal(missing.available, false);
  assert.ok(!registry.selectableFilenames.includes(missing.filename));
});

test("discovery failure keeps declared-only state without inventing availability", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, [], { discoveryOk: false });
  assert.equal(registry.discoveryOk, false);
  assert.ok(registry.entries.every(e => e.status === MODEL_STATUS.DECLARED));
  assert.ok(registry.entries.every(e => e.available === null));
  assert.deepEqual(registry.selectableFilenames, I2V_PRESET.options.models);
});

test("duplicate declared filenames are deduplicated", () => {
  const preset = {
    id: "dup",
    options: { models: ["a.gguf", "a.gguf", "b.gguf"] }
  };
  const registry = buildPresetModelRegistry(preset, ["a.gguf", "b.gguf"], { discoveryOk: true });
  assert.deepEqual(registry.duplicateFilenames, ["a.gguf"]);
  assert.equal(registry.entries.length, 2);
});

test("resolveModelSelection fails safe for missing saved model", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, [
    "minimax_h3_fl2va_pruned_fp8_Q4_0.gguf"
  ], { discoveryOk: true });
  const result = resolveModelSelection(registry, {
    savedModel: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
    presetDefault: "minimax_h3_fl2va_pruned_fp8_Q4_0.gguf"
  });
  assert.equal(result.model, "minimax_h3_fl2va_pruned_fp8_Q4_0.gguf");
  assert.match(result.warning, /non risulta installato|non installato/i);
});

test("resolveModelSelection rejects incompatible saved model", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, I2V_PRESET.options.models, { discoveryOk: true });
  const result = resolveModelSelection(registry, {
    savedModel: "foreign-model.gguf",
    presetDefault: I2V_PRESET.options.models[0]
  });
  assert.equal(result.model, I2V_PRESET.options.models[0]);
  assert.match(result.warning, /non compatibile/i);
});

test("normalizeRegistryRecord guards malformed records", () => {
  assert.equal(normalizeRegistryRecord(null).valid, false);
  assert.equal(normalizeRegistryRecord({}).valid, false);
  assert.equal(normalizeRegistryRecord({ filename: "x.gguf" }).valid, true);
});

test("zero-model preset yields empty selectable list", () => {
  const registry = buildPresetModelRegistry({ id: "empty", options: { models: [] } }, [], { discoveryOk: true });
  assert.deepEqual(registry.entries, []);
  assert.deepEqual(registry.selectableFilenames, []);
});

test("buildAllPresetModelRegistries indexes by preset id", () => {
  const all = buildAllPresetModelRegistries([I2V_PRESET, REF_PRESET], {
    names: ["minimax_h3_fl2va_pruned_fp8_Q4_0.gguf"],
    discoveryOk: true
  });
  assert.equal(all.loaderClass, H3_UNET_LOADER_CLASS);
  assert.ok(all.byPreset["minimax-h3-i2v"]);
  assert.ok(all.byPreset["minimax-h3-reference"]);
});

test("readComfyUnetAvailability does not invent names on fetch failure", async () => {
  const result = await readComfyUnetAvailability("http://127.0.0.1:1", {
    fetchFn: async () => ({ ok: false, status: 503 })
  });
  assert.equal(result.discoveryOk, false);
  assert.deepEqual(result.names, []);
  assert.ok(result.error);
});

test("fetchComfyUnetNames reads unet_name enum from object_info", async () => {
  const payload = {
    [H3_UNET_LOADER_CLASS]: {
      input: { required: { unet_name: [["a.gguf", "b.gguf"]] } }
    }
  };
  const names = await fetchComfyUnetNames("http://comfy.test", {
    fetchFn: async () => ({ ok: true, json: async () => payload })
  });
  assert.deepEqual(names, ["a.gguf", "b.gguf"]);
});

test("populateModelSelect disables missing options and keeps friendly labels", () => {
  const select = {
    options: [],
    value: "",
    replaceChildren() { this.options = []; },
    append(node) { this.options.push(node); }
  };
  const registry = buildPresetModelRegistry(I2V_PRESET, [
    "minimax_h3_fl2va_pruned_fp8_Q4_0.gguf"
  ], { discoveryOk: true });
  const result = populateModelSelect(select, registry, {
    selected: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf"
  });
  const q8 = select.options.find(o => o.value.includes("Q8_CR"));
  assert.ok(q8.disabled);
  assert.match(q8.textContent, /non installato/i);
  assert.equal(result.selected, "minimax_h3_fl2va_pruned_fp8_Q4_0.gguf");
});

test("refreshModelHint surfaces filename as secondary detail", () => {
  const hint = { textContent: "", hidden: true, classList: { toggle() {} } };
  const registry = buildPresetModelRegistry(I2V_PRESET, I2V_PRESET.options.models, { discoveryOk: true });
  refreshModelHint(hint, registry, I2V_PRESET.options.models[1]);
  assert.match(hint.textContent, /H3 Q8CR/);
  assert.match(hint.textContent, /minimax_h3_fl2va_pruned_fp8_Q8_CR\.gguf/);
  assert.equal(hint.hidden, false);
});

test("server exposes h3Models on /api/config", () => {
  const server = readFileSync(path.join(ROOT, "server.mjs"), "utf8");
  assert.match(server, /readH3ModelRegistry/);
  assert.match(server, /h3Models/);
  assert.match(server, /readComfyUnetAvailability/);
});
