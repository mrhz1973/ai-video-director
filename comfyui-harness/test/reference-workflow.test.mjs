import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cloneAndBind } from "../lib/workflow.mjs";

const readJson = async relative => JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));

test("reference workflow exposes every declared attachment binding", async () => {
  const preset = await readJson("../workflows/minimax-h3-reference.preset.json");
  const workflow = await readJson("../workflows/minimax-h3-reference.workflow.json");
  const values = Object.fromEntries(preset.attachments.map(field => [field.key, `test-${field.key}`]));
  const bound = cloneAndBind(workflow, preset.bindings, { prompt: "test", ...values });
  for (const field of preset.attachments) {
    const binding = preset.bindings[field.key];
    assert.equal(bound[String(binding.node)].inputs[binding.input], `test-${field.key}`);
  }
});

test("sanitized reference workflow contains no private filenames or local paths", async () => {
  const source = await readFile(new URL("../workflows/minimax-h3-reference.workflow.json", import.meta.url), "utf8");
  assert.doesNotMatch(source, /[A-Z]:\\\\|hf_|char_|prop_|Portovenere|Martino|IRONMAN/i);
});
