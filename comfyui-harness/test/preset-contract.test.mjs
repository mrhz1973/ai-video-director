import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { cloneAndBind, resolutionSettings } from "../lib/workflow.mjs";
import { MEGAPIXELS_LIMITS } from "../public/resolution.mjs";

const workflowDir = new URL("../workflows/", import.meta.url);
const readJson = async name => JSON.parse(await readFile(new URL(name, workflowDir), "utf8"));
const presetFiles = (await readdir(workflowDir)).filter(name => name.endsWith(".preset.json"));

const BASE_Q4 = "minimax_h3_fl2va_pruned_fp8_Q4_0.gguf";
const BASE_Q8 = "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf";

test("every H3 preset exists and binds megapixels to the ResolutionSelector", async () => {
  assert.equal(presetFiles.length, 4);
  for (const file of presetFiles) {
    const preset = await readJson(file);
    assert.deepEqual(preset.bindings.megapixels, { node: "115", input: "megapixels" }, file);
    assert.deepEqual(preset.bindings.aspectRatio, { node: "115", input: "aspect_ratio" }, file);
  }
});

test("no preset activates the dormant width or height bindings", async () => {
  for (const file of presetFiles) {
    const preset = await readJson(file);
    assert.equal(preset.bindings.width, undefined, file);
    assert.equal(preset.bindings.height, undefined, file);
  }
});

test("preset contract advertises real megapixel constraints and drops legacy qualities", async () => {
  for (const file of presetFiles) {
    const preset = await readJson(file);
    assert.equal(preset.options.qualities, undefined, file);
    assert.deepEqual(preset.options.megapixels, { default: 0.3, min: MEGAPIXELS_LIMITS.min, max: MEGAPIXELS_LIMITS.max, step: MEGAPIXELS_LIMITS.step, multiple: 32 }, file);
  }
});

test("base H3 modes expose both validated Q4 and Q8_CR checkpoints", async () => {
  for (const file of ["minimax-h3-t2v.preset.json", "minimax-h3-i2v.preset.json", "minimax-h3-fl2v.preset.json"]) {
    const preset = await readJson(file);
    assert.deepEqual(preset.options.models, [BASE_Q4, BASE_Q8], file);
  }
  const reference = await readJson("minimax-h3-reference.preset.json");
  assert.deepEqual(reference.options.models, ["minimax-h3-ref2va-Q4_0.gguf"]);
});

test("tracked reference workflow keeps the ResolutionSelector topology intact", async () => {
  const workflow = await readJson("minimax-h3-reference.workflow.json");
  assert.equal(workflow["115"].class_type, "ResolutionSelector");
  assert.equal(workflow["115"].inputs.multiple, 32);
  const preset = await readJson("minimax-h3-reference.preset.json");
  const settings = resolutionSettings("21:9", 0.4);
  const bound = cloneAndBind(workflow, preset.bindings, settings);
  assert.equal(bound["115"].inputs.megapixels, 0.4);
  assert.equal(bound["115"].inputs.aspect_ratio, "21:9 (Ultrawide)");
  assert.equal(bound["115"].inputs.multiple, 32);
  assert.equal(workflow["115"].inputs.megapixels, 0.3);
});
