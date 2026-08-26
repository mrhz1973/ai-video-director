import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveBatchItemFiles } from "../public/batch-core.mjs";

const source = await readFile(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");

test("batch submission claims its lock before the first asynchronous preflight", () => {
  const start = source.indexOf("async function queueBatch()");
  const end = source.indexOf("\nfunction stateLabel", start);
  assert.ok(start >= 0 && end > start, "queueBatch function must exist");
  const body = source.slice(start, end);
  const lock = body.indexOf("submitting = true;");
  const firstAwait = body.indexOf("await ");
  assert.ok(lock >= 0, "queueBatch must claim submitting lock");
  assert.ok(firstAwait >= 0, "queueBatch must perform async work");
  assert.ok(lock < firstAwait, "submitting lock must be claimed before first await to prevent double-click races");
});

test("batch submission always releases the transient lock in finally", () => {
  const start = source.indexOf("async function queueBatch()");
  const end = source.indexOf("\nfunction stateLabel", start);
  const body = source.slice(start, end);
  assert.match(body, /finally\s*\{[\s\S]*submitting = false;[\s\S]*syncBatchModelGate\(\);[\s\S]*\}/);
});

test("batch UI documents per-job input overrides and keeps workflow/model/LoRA common", () => {
  assert.match(source, /Workflow, modello e LoRA restano impostazioni comuni del Batch; prompt, input\/asset, seed, durata, steps, MP e aspect possono essere modificati per job/);
  assert.doesNotMatch(source, /Workflow e modello restano comuni; prompt, input\/asset/);
});

test("batch UI owns global LoRA controls under Impostazioni globali batch", () => {
  assert.match(source, /id="batchLoraId"/);
  assert.match(source, /id="batchLoraStrength"/);
  assert.match(source, /initBatchH3LoraControls/);
  assert.match(source, /commitBatchLoraFromDom/);
  assert.match(source, /freezeBatchLoraFields/);
  assert.match(source, /queuePayloadLoraFields/);
  assert.doesNotMatch(source, /item\.loraId|items\.map\([^\)]*loraId/);
});

test("batch UI contract exposes per-job input selectors", () => {
  assert.match(source, /appendBatchJobInputSection/);
  assert.match(source, /batch-job-inputs/);
  assert.match(source, /dataset\.roleKey/);
  assert.match(source, /Eredita:/);
  assert.match(source, /setItemFileOverride/);
  assert.match(source, /setBatchAssetContextProvider/);
});

test("batch payload construction resolves files per job", () => {
  assert.match(source, /files:\s*resolveBatchItemFiles\(item,\s*snapshot\.files/);
  assert.match(source, /freezeSubmissionSnapshot/);
  assert.match(source, /cloneBatchItemSnapshot/);
  assert.match(source, /\.\.\.queuePayloadLoraFields\(snapshot\)/);
});

test("deferred batch snapshots retain per-job overrides", () => {
  const start = source.indexOf("async function queueBatch()");
  const end = source.indexOf("\nfunction stateLabel", start);
  const body = source.slice(start, end);
  assert.match(body, /cloneBatchItemSnapshot\(item\)/);
  assert.match(body, /armDeferredBatch\(/);
});

test("changing global Input does not force Batch re-prepare via sourceIdentity files", () => {
  assert.match(source, /JSON\.stringify\(\{\s*workflowId:\s*value\.workflowId,\s*model:\s*value\.model\s*\}\)/);
  assert.doesNotMatch(source, /workflow, modello o asset/);
});

test("prompt text is not used as an asset resolver", () => {
  assert.doesNotMatch(source, /parseFilename|extractFilename|filenameFromPrompt|prompt.*\.png|match\(.*\.png/);
});

test("batch preflight wires library into validateBatchDraft for orphan overrides", () => {
  const start = source.indexOf("function validateCurrentBatch(");
  const end = source.indexOf("\nfunction payloadFor", start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /library/);
  assert.match(body, /attachmentRoles/);
  assert.match(body, /unavailableFilenames/);
});

test("resolve helper used by payload matches pure merge semantics", () => {
  const shared = { firstImage: "frame-shared.png" };
  assert.deepEqual(
    resolveBatchItemFiles({ files: { firstImage: "frame-c.png" } }, shared),
    { firstImage: "frame-c.png" }
  );
});
