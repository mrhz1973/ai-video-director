/**
 * Issue #73 — Single Render readiness after terminal state.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createQueueCoordinator,
  resolveGenerateAction,
  SINGLE_RENDER_ACTION_LABELS
} from "../public/queue-coordinator.mjs";
import {
  mayRetainStaleQueueSampleAfterTerminal,
  resolvePostTerminalGenerateAction
} from "../public/post-terminal-queue.mjs";
import { buildSingleRenderPayload } from "../public/single-render.mjs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const helper = readFileSync(new URL("../public/post-terminal-queue.mjs", import.meta.url), "utf8");

test("#73: authoritative 0/0 after terminal restores Genera singolo", () => {
  const action = resolvePostTerminalGenerateAction({ running: 0, pending: 0 });
  assert.equal(action.action, "generate");
  assert.equal(action.disabled, false);
  assert.equal(action.label, SINGLE_RENDER_ACTION_LABELS.idle);
  assert.equal(action.label, "Genera singolo");
});

test("#73: stale running=1 without reconcile would offer Metti in coda (documents bug)", () => {
  const stale = resolveGenerateAction({ running: 1, pending: 0 });
  assert.equal(stale.action, "queue-next");
  assert.equal(stale.label, "Metti in coda");
  assert.equal(mayRetainStaleQueueSampleAfterTerminal(), false);
});

test("#73: terminal while another job remains running does not expose Generate", () => {
  const action = resolvePostTerminalGenerateAction({ running: 1, pending: 0 });
  assert.notEqual(action.action, "generate");
  assert.equal(action.action, "queue-next");
});

test("#73: terminal while pending remains does not expose Generate", () => {
  const action = resolvePostTerminalGenerateAction({ running: 0, pending: 1 });
  assert.notEqual(action.action, "generate");
  assert.equal(action.disabled, true);
});

test("#73: queued-next submits exactly once when queue becomes 0/0", async () => {
  let submits = 0;
  const payloads = [];
  const c = createQueueCoordinator({
    submit: async payload => {
      submits += 1;
      payloads.push(payload);
      return { prompt_id: `pid-${submits}` };
    }
  });
  c.markQueue({ running: 1, pending: 0 });
  assert.equal(c.armQueuedNext({ prompt: "NEXT", seed: 9, duration: 6 }).ok, true);
  const first = await c.observeQueue({ running: 0, pending: 0 });
  const second = await c.observeQueue({ running: 0, pending: 0 });
  assert.equal(first.submitted, "queued-next");
  assert.equal(second.submitted, false);
  assert.equal(submits, 1);
  assert.equal(payloads[0].prompt, "NEXT");
  assert.equal(payloads[0].seed, 9);
});

test("#73: after completed render, edited fields produce one new payload", () => {
  const first = buildSingleRenderPayload({
    workflowId: "minimax-h3-fl2v",
    prompt: "before",
    megapixels: 0.3,
    model: "m",
    steps: 20,
    duration: 5,
    aspect: "16:9",
    seed: 1,
    files: {}
  });
  const second = buildSingleRenderPayload({
    workflowId: "minimax-h3-fl2v",
    prompt: "after edit",
    megapixels: 0.6,
    model: "m",
    steps: 28,
    duration: 8,
    aspect: "9:16",
    seed: 99,
    files: {}
  });
  assert.notEqual(first.prompt, second.prompt);
  assert.equal(second.prompt, "after edit");
  assert.equal(second.seed, 99);
  assert.equal(second.steps, 28);
  assert.equal(second.duration, 8);
  assert.equal(second.megapixels, 0.6);
});

test("#73: failed terminal + empty queue => Generate ready", () => {
  const action = resolvePostTerminalGenerateAction({ running: 0, pending: 0 });
  assert.equal(action.action, "generate");
  assert.equal(action.disabled, false);
});

test("#73: interrupted terminal + empty queue => Generate ready", () => {
  const action = resolvePostTerminalGenerateAction({ running: 0, pending: 0 });
  assert.equal(action.action, "generate");
  assert.equal(action.label, "Genera singolo");
});

test("#73: app.js reconciles after terminal rememberJob (no reload required)", () => {
  assert.match(app, /async function reconcileQueueAfterTerminal/);
  assert.match(app, /await reconcileQueueAfterTerminal\(\)/);
  assert.match(app, /await refreshQueueCounts\(\)/);

  const outputsIdx = app.indexOf("async function outputs()");
  const outputsBlock = app.slice(outputsIdx, app.indexOf("async function handleHistoryFailure"));
  assert.match(outputsBlock, /rememberJob\(\)/);
  assert.match(outputsBlock, /await reconcileQueueAfterTerminal\(\)/);
  assert.ok(outputsBlock.indexOf("rememberJob()") < outputsBlock.indexOf("await reconcileQueueAfterTerminal()"));

  const failIdx = app.indexOf("async function handleHistoryFailure");
  const failBlock = app.slice(failIdx, app.indexOf("async function pollHistory"));
  assert.match(failBlock, /rememberJob\(\)/);
  assert.match(failBlock, /await reconcileQueueAfterTerminal\(\)/);

  const errIdx = app.indexOf('if (["execution_error", "execution_interrupted"]');
  const errBlock = app.slice(errIdx, errIdx + 900);
  assert.match(errBlock, /rememberJob\(\)/);
  assert.match(errBlock, /await reconcileQueueAfterTerminal\(\)/);
});

test("#73: rememberJob clear keeps queue polling and requires post-terminal reconcile", () => {
  const clearStart = app.indexOf("sessionStorage.removeItem(\"h3CurrentPrompt\")");
  assert.ok(clearStart > 0);
  const clearBlock = app.slice(clearStart, clearStart + 1400);
  assert.doesNotMatch(clearBlock, /stopQueuePolling\(\)/);
  assert.match(app, /await reconcileQueueAfterTerminal\(\)/);
  assert.match(helper, /never from blindly forcing/);
});

test("#73: safety — no queue clear / prompt mutation helpers in post-terminal module", () => {
  assert.doesNotMatch(helper, /\/prompt|queue\/clear|interrupt|kill/i);
  assert.doesNotMatch(app.slice(app.indexOf("reconcileQueueAfterTerminal"), app.indexOf("reconcileQueueAfterTerminal") + 400), /\/prompt/);
});

test("#73: deferred/active Batch still blocks Generate after terminal 0/0", () => {
  assert.equal(
    resolvePostTerminalGenerateAction({ running: 0, pending: 0, deferredBatch: { items: [1, 2] } }).action,
    "blocked"
  );
  assert.equal(
    resolvePostTerminalGenerateAction({ running: 0, pending: 0, batchActive: true }).action,
    "blocked"
  );
  assert.equal(
    resolvePostTerminalGenerateAction({ running: 0, pending: 0, batchQueueArmed: true }).action,
    "blocked"
  );
});
