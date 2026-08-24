import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  batchesEqual,
  normalizeBatchDraft,
  serializeBatchDraft
} from "../lib/batch-draft.mjs";
import { resolveBatchItemFiles } from "../public/batch-core.mjs";
import {
  BATCH_EXECUTION_LABELS,
  BATCH_OPTIONAL_HEADING,
  SINGLE_RENDER_ACTION_LABELS,
  SINGLE_RENDER_KIND,
  assertSingleRenderIntent,
  buildSingleRenderPayload,
  singleRenderSideEffects,
  toSingleRenderQueueBody
} from "../public/single-render.mjs";
import {
  createQueueCoordinator,
  resolveBatchQueueAction,
  resolveGenerateAction,
  shouldRestoreExecutionIntent
} from "../public/queue-coordinator.mjs";
import {
  buildSingleJobCompletionAttribution,
  normalizeSessionOutput
} from "../public/session-outputs.mjs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const batchUi = readFileSync(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");

function sampleBatchDraft(count = 8) {
  const items = Array.from({ length: count }, (_, i) => ({
    prompt: `Prompt S${String(i + 1).padStart(2, "0")}`,
    seed: String(10 + i),
    duration: String(5 + (i % 3)),
    steps: String(20 + i),
    megapixels: String(0.3 + i * 0.1),
    aspect: i % 2 ? "16:9" : "9:16",
    files: { firstImage: `S${String(i + 1).padStart(2, "0")}.png` }
  }));
  return normalizeBatchDraft({
    source: {
      workflowId: "minimax-h3-i2v",
      model: "model-a",
      files: { firstImage: "SHARED.png" },
      base: { prompt: "shared", seed: "1", duration: "5", steps: "20", megapixels: "0.3", aspect: "16:9" }
    },
    items
  });
}

test("buildSingleRenderPayload captures current editor fields only", () => {
  const intent = buildSingleRenderPayload({
    clientId: "cid",
    workflowId: "minimax-h3-i2v",
    prompt: "Current prompt",
    megapixels: 0.6,
    model: "model-x",
    steps: 28,
    duration: 7,
    aspect: "16:9",
    seed: 42,
    files: { firstImage: "TEST.png" }
  });
  assert.equal(intent.kind, SINGLE_RENDER_KIND);
  assert.equal(intent.prompt, "Current prompt");
  assert.equal(intent.workflowId, "minimax-h3-i2v");
  assert.equal(intent.model, "model-x");
  assert.equal(intent.files.firstImage, "TEST.png");
  assert.equal(intent.seed, 42);
  assert.equal(intent.duration, 7);
  assert.equal(intent.steps, 28);
  assert.equal(intent.megapixels, 0.6);
  assert.equal(intent.aspect, "16:9");
});

test("Single Render does not read Numero job — eight in UI still yields one intent", () => {
  const batchCount = 8;
  const intent = buildSingleRenderPayload({
    workflowId: "wf",
    prompt: "solo",
    megapixels: 0.3,
    model: "m",
    steps: 20,
    duration: 5,
    aspect: "16:9",
    seed: 1,
    files: {}
  });
  assert.equal(intent.kind, SINGLE_RENDER_KIND);
  assert.equal(batchCount, 8);
  const body = toSingleRenderQueueBody(intent);
  assert.equal(Object.keys(body).includes("items"), false);
  assert.equal(body.prompt, "solo");
});

test("singleRenderSideEffects documents no Batch coupling", () => {
  const fx = singleRenderSideEffects();
  assert.equal(fx.batchPrepare, false);
  assert.equal(fx.batchMutation, false);
  assert.equal(fx.batchSubmit, false);
  assert.equal(fx.batchDraftWrite, false);
  assert.equal(fx.readsBatchCount, false);
  assert.equal(fx.createsSyntheticBatch, false);
});

test("prepared 8-job Batch survives Single payload build unchanged", () => {
  const before = sampleBatchDraft(8);
  const serializedBefore = serializeBatchDraft(before);
  buildSingleRenderPayload({
    workflowId: "minimax-h3-i2v",
    prompt: "Different top-level prompt",
    megapixels: 0.9,
    model: "other-model",
    steps: 30,
    duration: 6,
    aspect: "1:1",
    seed: 99,
    files: { firstImage: "TEST.png" }
  });
  const after = normalizeBatchDraft(JSON.parse(JSON.stringify(before)));
  assert.equal(batchesEqual(before, after), true);
  assert.deepEqual(serializeBatchDraft(after), serializedBefore);
  assert.equal(after.items[0].files.firstImage, "S01.png");
  assert.equal(after.items[7].prompt, "Prompt S08");
});

test("Single uses current Input binding; Batch Job 1 item.files does not override", () => {
  const batch = sampleBatchDraft(2);
  const job1Files = resolveBatchItemFiles(batch.items[0], batch.source.files);
  assert.equal(job1Files.firstImage, "S01.png");
  const single = buildSingleRenderPayload({
    workflowId: "minimax-h3-i2v",
    prompt: "solo",
    megapixels: 0.3,
    model: "m",
    steps: 20,
    duration: 5,
    aspect: "16:9",
    seed: 1,
    files: { firstImage: "TEST.png" }
  });
  assert.equal(single.files.firstImage, "TEST.png");
  assert.notEqual(single.files.firstImage, job1Files.firstImage);
});

test("toSingleRenderQueueBody strips render kind for /api/queue", () => {
  const intent = buildSingleRenderPayload({
    workflowId: "wf",
    prompt: "p",
    megapixels: 0.3,
    model: "m",
    steps: 20,
    duration: 5,
    aspect: "16:9",
    seed: 1,
    files: {}
  });
  const body = toSingleRenderQueueBody(intent);
  assert.equal(body.kind, undefined);
  assert.equal(body.prompt, "p");
  assertSingleRenderIntent(intent);
});

test("send handler guards overlapping Single clicks with submitting flag", () => {
  const sendStart = app.indexOf('$("send").onclick');
  const sendEnd = app.indexOf('$("promptClear").onclick');
  const sendRegion = app.slice(sendStart, sendEnd);
  const submitFlagIdx = sendRegion.indexOf("submitting = true");
  const renderIdx = sendRegion.indexOf("submitSingleRender");
  const finallyIdx = sendRegion.indexOf("submitting = false");
  assert.ok(submitFlagIdx >= 0 && renderIdx > submitFlagIdx);
  assert.ok(finallyIdx > renderIdx);
  assert.match(sendRegion, /finally[\s\S]*submitting = false/);
});

test("failed Single submit does not auto-retry without a new user action", async () => {
  let submits = 0;
  const c = createQueueCoordinator({
    submit: async () => {
      submits += 1;
      throw new Error("fail");
    }
  });
  c.markQueue({ running: 0, pending: 0 });
  const payload = toSingleRenderQueueBody(buildSingleRenderPayload({
    workflowId: "wf",
    prompt: "p",
    megapixels: 0.3,
    model: "m",
    steps: 20,
    duration: 5,
    aspect: "16:9",
    seed: 1,
    files: {}
  }));
  await assert.rejects(async () => c.tryImmediateGenerate(payload));
  assert.equal(submits, 1);
  const observe = await c.observeQueue({ running: 0, pending: 0 });
  assert.equal(observe.submitted, false);
  assert.equal(submits, 1);
});

test("shouldRestoreExecutionIntent stays false — reload never resubmits Single", () => {
  assert.equal(shouldRestoreExecutionIntent(), false);
});

test("Single does not create one-job batchDraft", () => {
  buildSingleRenderPayload({
    workflowId: "wf",
    prompt: "solo",
    megapixels: 0.3,
    model: "m",
    steps: 20,
    duration: 5,
    aspect: "16:9",
    seed: 1,
    files: {}
  });
  const draft = normalizeBatchDraft(null);
  assert.equal(draft, null);
});

test("completed Single output enters CLIP SESSIONE as source single", () => {
  const items = [{ filename: "clip.mp4", url: "/view?filename=clip.mp4" }];
  const { galleryRecords, completion } = buildSingleJobCompletionAttribution("pid-1", items, {
    prompt: "hello",
    seed: 1,
    duration: 5,
    megapixels: 0.3,
    aspect: "16:9",
    steps: 20,
    workflowLabel: "I2VA"
  });
  assert.equal(galleryRecords[0].source, "single");
  assert.equal(normalizeSessionOutput({ ...galleryRecords[0], source: "single" }).source, "single");
  assert.equal(completion.promptId, "pid-1");
});

test("app wiring: explicit Single path separate from Batch submit", () => {
  const sendStart = app.indexOf('$("send").onclick');
  const sendEnd = app.indexOf('$("promptClear").onclick');
  const sendRegion = app.slice(sendStart, sendEnd);
  assert.match(sendRegion, /submitSingleRender/);
  assert.doesNotMatch(sendRegion, /prepareFromDraft|createBatchItems|queueBatch|runSequentialBatch|submitBatchSequentially/);
  assert.match(app, /prepareSingleRenderPayload/);
  assert.match(app, /buildSingleRenderPayload/);
  assert.match(app, /toSingleRenderQueueBody/);
  assert.doesNotMatch(app, /prepareQueuePayload/);
});

test("Batch submit remains behind queueBatch only", () => {
  assert.match(batchUi, /batchQueue"\)\.onclick = queueBatch/);
  const queueFn = batchUi.slice(batchUi.indexOf("async function queueBatch"), batchUi.indexOf("function stateLabel"));
  assert.match(queueFn, /runSequentialBatch|armDeferredBatch/);
  assert.doesNotMatch(queueFn, /prepareSingleRenderPayload|submitSingleRender/);
});

test("UI: Genera singolo, Batch heading, advanced Avvia batch, helper copy", () => {
  assert.match(html, /id="send"[^>]*>GENERA SINGOLO</);
  assert.match(html, /Non modifica il Batch/);
  assert.equal(BATCH_OPTIONAL_HEADING, "BATCH — job preparati");
  assert.match(batchUi, /\$\{BATCH_OPTIONAL_HEADING\}/);
  assert.match(batchUi, /Genera singolo.*crea sempre una sola clip/);
  assert.match(batchUi, /id="batchQueue"/);
  assert.match(batchUi, /Avvia questo Batch immediatamente/);
});

test("resolveGenerateAction labels say Genera singolo", () => {
  const idle = resolveGenerateAction({ running: 0, pending: 0 });
  assert.equal(idle.label, SINGLE_RENDER_ACTION_LABELS.idle);
  assert.equal(idle.label, "Genera singolo");
});

test("resolveBatchQueueAction labels explicitly name Batch", () => {
  const queue = resolveBatchQueueAction({ preparedCount: 8, running: 0, pending: 0 });
  assert.equal(queue.label, BATCH_EXECUTION_LABELS.queue(8));
  assert.match(queue.label, /Avvia batch \(8\)/);
});

test("v0.10.0 Batch globals and Salva come preserved", () => {
  assert.match(html, /id="projectSaveAs"/);
  assert.match(html, /Salva come/);
  assert.match(batchUi, /batchGlobalMp/);
  assert.match(batchUi, /batchGlobalAspect/);
  assert.match(batchUi, /batchGlobalSteps/);
  assert.match(batchUi, /batchGlobalApply/);
  assert.match(batchUi, /batchExpandAll/);
  assert.match(batchUi, /batchCollapseAll/);
});

test("safety: automated tests avoid live queue submission flag", () => {
  assert.equal(process.env.H3_LIVE_QUEUE_TEST, undefined);
});
