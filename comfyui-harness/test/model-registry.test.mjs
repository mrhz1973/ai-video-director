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
  MODEL_BLOCKER_COPY,
  MODEL_STATUS,
  assertModelSubmissionAllowed,
  buildAllPresetModelRegistries,
  buildPresetModelRegistry,
  describeModelSelectionBlocker,
  friendlyModelLabel,
  modelQuantizationHint,
  normalizeRegistryRecord,
  resolveModelSelection
} from "../lib/h3-model-registry.mjs";
import { describeGenerateBlockers } from "../lib/projects.mjs";
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

test("zero compatible installed blocks selection and submission paths", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, [], { discoveryOk: true });
  assert.equal(registry.compatibleInstalledCount, 0);

  const blocker = describeModelSelectionBlocker(registry, I2V_PRESET.options.models[0]);
  assert.equal(blocker.blocked, true);
  assert.match(blocker.reason, /Nessun checkpoint compatibile installato/i);

  const resolved = resolveModelSelection(registry, {
    savedModel: I2V_PRESET.options.models[0],
    presetDefault: I2V_PRESET.options.models[0]
  });
  assert.equal(resolved.model, "");

  const select = {
    options: [],
    value: "stale",
    disabled: false,
    classList: { toggle() {} },
    replaceChildren() { this.options = []; },
    append(node) { this.options.push(node); }
  };
  const ui = populateModelSelect(select, registry, { selected: I2V_PRESET.options.models[0] });
  assert.equal(ui.selected, "");
  assert.equal(ui.usable, false);
  assert.equal(select.value, "");
  assert.equal(select.disabled, true);

  assert.throws(
    () => assertModelSubmissionAllowed(registry, I2V_PRESET.options.models[0]),
    /Nessun checkpoint compatibile installato/
  );

  const gate = describeGenerateBlockers({
    prompt: "test prompt",
    modelBlockedReason: blocker.reason
  });
  assert.equal(gate.blocked, true);
  assert.equal(gate.code, "model-unavailable");
});

test("installed but incompatible checkpoint is blocked at submission", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, [
    "foreign-only.gguf",
    ...I2V_PRESET.options.models
  ], { discoveryOk: true });
  const blocker = describeModelSelectionBlocker(registry, "foreign-only.gguf");
  assert.equal(blocker.blocked, true);
  assert.match(blocker.reason, /non compatibile/i);
  assert.throws(() => assertModelSubmissionAllowed(registry, "foreign-only.gguf"), /non compatibile/i);
});

test("friendly-label collision keeps distinct filenames in registry", () => {
  const preset = {
    id: "collision",
    options: {
      models: [
        "minimax_h3_fl2va_pruned_fp8_Q4_0.gguf",
        "minimax-h3-ref2va-Q4_0.gguf"
      ]
    }
  };
  const registry = buildPresetModelRegistry(preset, preset.options.models, { discoveryOk: true });
  const labels = registry.entries.map(e => e.friendlyLabel);
  assert.equal(labels.filter(l => l.includes("Q4")).length, 2);
  assert.notEqual(registry.entries[0].filename, registry.entries[1].filename);
});

test("single render submission gate rejects empty model when none compatible", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, [], { discoveryOk: true });
  assert.throws(
    () => assertModelSubmissionAllowed(registry, ""),
    /Seleziona un checkpoint|Nessun checkpoint compatibile installato/
  );
});

test("batch source snapshot contract blocks when model gate fails", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, [], { discoveryOk: true });
  const blocker = describeModelSelectionBlocker(registry, "");
  assert.equal(blocker.blocked, true);
  assert.match(blocker.reason, /Nessun checkpoint compatibile installato|Seleziona un checkpoint/);
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

test("populateModelSelect never selects disabled missing checkpoint when all missing", () => {
  const registry = buildPresetModelRegistry(I2V_PRESET, [], { discoveryOk: true });
  const select = {
    options: [],
    value: I2V_PRESET.options.models[0],
    disabled: false,
    classList: { toggle() {} },
    replaceChildren() { this.options = []; },
    append(node) { this.options.push(node); }
  };
  const result = populateModelSelect(select, registry, { selected: I2V_PRESET.options.models[0] });
  assert.equal(result.selected, "");
  assert.ok(select.options.every(o => !o.value || o.disabled));
});

test("refreshModelHint surfaces filename as secondary detail", () => {
  const hint = { textContent: "", hidden: true, classList: { toggle() {} } };
  const registry = buildPresetModelRegistry(I2V_PRESET, I2V_PRESET.options.models, { discoveryOk: true });
  refreshModelHint(hint, registry, I2V_PRESET.options.models[1]);
  assert.match(hint.textContent, /H3 Q8CR/);
  assert.match(hint.textContent, /minimax_h3_fl2va_pruned_fp8_Q8_CR\.gguf/);
  assert.equal(hint.hidden, false);
});

test("refreshModelHint shows unavailable copy when zero compatible installed", () => {
  const hint = { textContent: "", hidden: true, classList: { toggle() {} } };
  const registry = buildPresetModelRegistry(I2V_PRESET, [], { discoveryOk: true });
  refreshModelHint(hint, registry, "");
  assert.equal(hint.textContent, MODEL_BLOCKER_COPY.noCompatibleInstalled);
});

test("batch-ui imports model gate for prepare/queue blocking", () => {
  const batchUi = readFileSync(path.join(ROOT, "public/batch-ui.mjs"), "utf8");
  assert.match(batchUi, /describeModelSelectionBlocker/);
  assert.match(batchUi, /currentModelBlocker/);
  assert.match(batchUi, /syncBatchModelGate/);
  assert.match(batchUi, /resolveBatchAddToQueueGate/);
  assert.match(batchUi, /batchAddToQueue/);
});

test("app.js wires modelBlockedReason into generate gate", () => {
  const app = readFileSync(path.join(ROOT, "public/app.js"), "utf8");
  assert.match(app, /modelBlockedReason:\s*h3ModelSelectionBlockedReason\(\)/);
  assert.match(app, /assertModelSubmissionAllowed/);
});

test("server exposes h3Models on /api/config", () => {
  const server = readFileSync(path.join(ROOT, "server.mjs"), "utf8");
  assert.match(server, /readH3ModelRegistry/);
  assert.match(server, /h3Models/);
  assert.match(server, /readComfyUnetAvailability/);
});
