import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_QUEUED_NEXT,
  canArmDeferredBatch,
  canArmQueuedNext,
  createQueueCoordinator,
  isQueueEmpty,
  resolveBatchQueueAction,
  resolveGenerateAction,
  shouldRestoreExecutionIntent,
  summarizeDeferredBatch,
  summarizeQueuedNext
} from "../public/queue-coordinator.mjs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const batchUi = readFileSync(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");
const autosave = readFileSync(new URL("../public/autosave.mjs", import.meta.url), "utf8");

function coordinator(submit = async payload => ({ prompt_id: `pid-${payload.seed || 1}` })) {
  return createQueueCoordinator({ submit });
}

test("busy queue offers explicit queue-next and caps at one pending job", async () => {
  const c = coordinator();
  c.markQueue({ running: 1, pending: 0 });
  const action = resolveGenerateAction({ running: 1, pending: 0 });
  assert.equal(action.action, "queue-next");
  assert.equal(action.label, "Metti in coda");
  assert.equal(MAX_QUEUED_NEXT, 1);
  assert.equal(c.armQueuedNext({ prompt: "A", seed: 1 }).ok, true);
  assert.equal(c.armQueuedNext({ prompt: "B", seed: 2 }).ok, false);
  assert.equal(c.getQueuedNext().prompt, "A");
});

test("double observe and double arm do not duplicate submits", async () => {
  let submits = 0;
  const c = coordinator(async () => {
    submits += 1;
    await new Promise(r => setTimeout(r, 20));
    return { prompt_id: "once" };
  });
  c.markQueue({ running: 1, pending: 0 });
  c.armQueuedNext({ prompt: "A", seed: 1 });
  const [a, b] = await Promise.all([
    c.observeQueue({ running: 0, pending: 0 }),
    c.observeQueue({ running: 0, pending: 0 })
  ]);
  const submitted = [a, b].filter(item => item.submitted);
  assert.equal(submitted.length, 1);
  assert.equal(submits, 1);
});

test("pending snapshot does not silently mutate when a later draft is passed to arm", () => {
  const c = coordinator();
  c.markQueue({ running: 1, pending: 0 });
  c.armQueuedNext({ prompt: "ONE", seed: 1 });
  const draft = { prompt: "TWO", seed: 2 };
  assert.equal(c.getQueuedNext().prompt, "ONE");
  assert.equal(c.updateQueuedNextFromDraft(draft).ok, true);
  assert.equal(c.getQueuedNext().prompt, "TWO");
});

test("cancel pending job prevents later empty-queue submit", async () => {
  let submits = 0;
  const c = coordinator(async () => {
    submits += 1;
    return { prompt_id: "x" };
  });
  c.markQueue({ running: 1, pending: 0 });
  c.armQueuedNext({ prompt: "A" });
  assert.equal(c.cancelQueuedNext().ok, true);
  const result = await c.observeQueue({ running: 0, pending: 0 });
  assert.equal(result.submitted, false);
  assert.equal(submits, 0);
});

test("queue 1→0 transition submits queued-next exactly once", async () => {
  let submits = 0;
  const c = coordinator(async () => {
    submits += 1;
    return { prompt_id: "n1" };
  });
  c.markQueue({ running: 1, pending: 0 });
  c.armQueuedNext({ prompt: "next" });
  await c.observeQueue({ running: 1, pending: 0 });
  assert.equal(submits, 0);
  await c.observeQueue({ running: 0, pending: 0 });
  await c.observeQueue({ running: 0, pending: 0 });
  assert.equal(submits, 1);
});

test("reload and recovery never restore armed execution intent", async () => {
  assert.equal(shouldRestoreExecutionIntent(), false);
  const first = coordinator();
  first.markQueue({ running: 1, pending: 0 });
  first.armQueuedNext({ prompt: "armed" });
  const reloaded = coordinator();
  const result = await reloaded.observeQueue({ running: 0, pending: 0 });
  assert.equal(result.submitted, false);
  assert.equal(reloaded.getQueuedNext(), null);
  assert.doesNotMatch(autosave, /queuedNext|deferredBatch|QUEUE_OWNER/);
});

test("deferred batch arms on 1 running / 0 pending and submits Job 1 once when empty", async () => {
  const calls = [];
  const c = coordinator(async payload => {
    calls.push(payload);
    return { prompt_id: `p-${calls.length}` };
  });
  c.markQueue({ running: 1, pending: 0 });
  assert.equal(canArmDeferredBatch({ running: 1, pending: 0, preparedCount: 2 }), true);
  let jobSubmits = 0;
  assert.equal(c.armDeferredBatch({
    items: [{ prompt: "1" }, { prompt: "2" }],
    snapshot: {},
    submitAll: async () => {
      jobSubmits += 1;
      return { accepted: [{ index: 0, prompt_id: "b1" }] };
    }
  }).ok, true);
  assert.equal(c.armDeferredBatch({
    items: [{ prompt: "1" }, { prompt: "2" }],
    snapshot: {},
    submitAll: async () => ({ accepted: [] })
  }).ok, false);
  await c.observeQueue({ running: 1, pending: 0 });
  assert.equal(jobSubmits, 0);
  await c.observeQueue({ running: 0, pending: 0 });
  await c.observeQueue({ running: 0, pending: 0 });
  assert.equal(jobSubmits, 1);
});

test("cancel deferred batch before first submission", async () => {
  let jobSubmits = 0;
  const c = coordinator();
  c.markQueue({ running: 1, pending: 0 });
  c.armDeferredBatch({
    items: [{}, {}],
    snapshot: {},
    submitAll: async () => {
      jobSubmits += 1;
      return {};
    }
  });
  assert.equal(c.cancelDeferredBatch().ok, true);
  await c.observeQueue({ running: 0, pending: 0 });
  assert.equal(jobSubmits, 0);
});

test("queued-next and deferred batch cannot be armed together", () => {
  const c = coordinator();
  c.markQueue({ running: 1, pending: 0 });
  assert.equal(c.armQueuedNext({ prompt: "A" }).ok, true);
  assert.equal(c.armDeferredBatch({ items: [{}, {}], snapshot: {}, submitAll: async () => ({}) }).ok, false);
  assert.equal(canArmQueuedNext({ running: 1, pending: 0, deferredBatch: { x: 1 } }), false);
});

test("existing sequential submit helper still sends Job 1 then 2", async () => {
  const { submitBatchSequentially } = await import("../public/batch-core.mjs");
  const order = [];
  const result = await submitBatchSequentially([{ id: 1 }, { id: 2 }], async (item, index) => {
    order.push(index);
    return { prompt_id: `j${index}` };
  });
  assert.deepEqual(order, [0, 1]);
  assert.equal(result.complete, true);
});

test("UI copy covers waiting states and no GPU writes", () => {
  const coordinatorSource = readFileSync(new URL("../public/queue-coordinator.mjs", import.meta.url), "utf8");
  assert.match(coordinatorSource, /Metti in coda/);
  assert.match(coordinatorSource, /Metti batch in attesa/);
  assert.match(app, /Annulla attesa|Annulla/);
  const next = summarizeQueuedNext({ prompt: "hello world", snapshot: { prompt: "hello world" } });
  assert.equal(next.status, "IN ATTESA");
  const batch = summarizeDeferredBatch({ items: [{}, {}] });
  assert.match(batch.status, /IN ATTESA DELLA CODA/);
  assert.equal(isQueueEmpty({ running: 0, pending: 0 }), true);
  assert.doesNotMatch(app, /\/api\/gpu-power/);
  assert.doesNotMatch(batchUi, /\/api\/gpu-power/);
});

test("batch button labels follow queue state", () => {
  assert.equal(resolveBatchQueueAction({
    preparedCount: 2,
    running: 1,
    pending: 0
  }).action, "defer");
  assert.equal(resolveBatchQueueAction({
    preparedCount: 2,
    running: 0,
    pending: 0
  }).action, "queue");
});
