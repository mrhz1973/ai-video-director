import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OUTPUT_TEMPLATE,
  buildOutputFilename,
  buildOutputTokens,
  extensionFromFilename,
  formatMegapixels,
  outputCounterStorageKey,
  resolveOutputBaseName,
  sanitizeOutputSegment,
  shortModelName,
  shortWorkflowName
} from "../public/output-naming.mjs";

test("sanitizes Windows-invalid filename characters", () => {
  assert.equal(sanitizeOutputSegment('Porto:venere / test*?'), "Porto-venere_-_test-");
});

test("recognizes common H3 quantization labels", () => {
  assert.equal(shortModelName("minimax_h3_fl2va_pruned_fp8_Q4_0.gguf"), "Q4");
  assert.equal(shortModelName("minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf"), "Q8CR");
  assert.equal(shortModelName("minimax_h3_fl2va_pruned_bf16.safetensors"), "BF16");
});

test("recognizes workflow mode labels", () => {
  assert.equal(shortWorkflowName("minimax-h3-i2v", "MiniMax H3 · Image to Video (I2VA)"), "I2VA");
  assert.equal(shortWorkflowName("minimax-h3-fl2v", "MiniMax H3 · First/Last Image to Video (FL2VA)"), "FL2VA");
  assert.equal(shortWorkflowName("minimax-h3-ref2va", "Reference Images to Video"), "REF2VA");
});

test("formats megapixels without meaningless trailing zeros", () => {
  assert.equal(formatMegapixels(0.3), "0.3");
  assert.equal(formatMegapixels("1.00"), "1");
});

test("resolves default filename with padded progressive counter", () => {
  const tokens = buildOutputTokens({
    project: "Portovenere",
    scene: "follow me",
    workflow: "minimax-h3-i2v",
    workflowLabel: "Image to Video (I2VA)",
    model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
    megapixels: 0.3,
    duration: 15,
    steps: 20,
    seed: 628211386369717
  });
  assert.equal(
    buildOutputFilename({ template: DEFAULT_OUTPUT_TEMPLATE, tokens, counter: 7, sourceFilename: "MiniMax_H3_00039_.mp4" }),
    "Portovenere_follow_me_I2VA_Q8CR_0.3MP_15s_20st_seed628211386369717_0007.mp4"
  );
});

test("supports explicit counter width token", () => {
  assert.equal(resolveOutputBaseName("take_{counter:06}", {}, { counter: 42 }), "take_000042");
});

test("preserves generated output extension", () => {
  assert.equal(extensionFromFilename("clip.WEBM"), ".webm");
  assert.equal(extensionFromFilename("clip"), ".mp4");
});

test("unknown template tokens remain deterministic safe text", () => {
  assert.equal(resolveOutputBaseName("{project}_{unknown}_{counter:04}", { project: "Rambo" }, { counter: 1 }), "Rambo_unknown_0001");
});

test("counter storage can be global, per project, or per scene", () => {
  assert.equal(outputCounterStorageKey({ scope: "global" }), "h3OutputCounter:global");
  assert.equal(outputCounterStorageKey({ scope: "project", projectId: "porto" }), "h3OutputCounter:project:porto");
  assert.equal(outputCounterStorageKey({ scope: "scene", projectId: "porto", scene: "follow me" }), "h3OutputCounter:scene:porto:follow_me");
});

test("variant token can be used without forcing it into the default template", () => {
  const tokens = buildOutputTokens({ variant: "candidate 2" });
  assert.equal(resolveOutputBaseName("clip_{variant}_{counter:04}", tokens, { counter: 3 }), "clip_candidate_2_0003");
});
