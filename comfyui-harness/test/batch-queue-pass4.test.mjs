import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QUEUE_ENTRY_STATE,
  QUEUE_OVERALL_STATE,
  appendQueueEntry,
  createQueueEntryFromDraft
} from "../lib/batch-queue-plan.mjs";
import { createBatchQueueRuntimeService } from "../lib/batch-queue-service.mjs";
import { serializeBatchDraft } from "../lib/batch-draft.mjs";
import {
  createExecutionLaneRegistry,
  EXECUTION_LANE_KIND,
  isFutureExecutionLaneKind
} from "../lib/execution-lane.mjs";
import {
  clearStoredExecutionLane,
  formatQueueBatchStopFeedback,
  readStoredExecutionLane,
  reconcileExecutionLaneAfterReload,
  writeStoredExecutionLane
} from "../public/execution-lane-client.mjs";
import { createQueueCoordinator } from "../public/queue-coordinator.mjs";

const sampleSource = {
  workflowId: "minimax-h3-i2v",
  workflowLabel: "I2V",
  model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
  files: { firstImage: "frame.png" },
  requiredKeys: ["firstImage"],
  base: { prompt: "base", seed: "1", duration: "10", steps: "20", megapixels: "0.7", aspect: "16:9" }
};

function sampleDraft(jobCount = 2, promptPrefix = "PROMPT") {
  return serializeBatchDraft({
    source: sampleSource,
    items: Array.from({ length: jobCount }, (_, i) => ({
      prompt: `${promptPrefix} ${i + 1}`,
      seed: String(i + 1),
      duration: "10",
      steps: "20",
      megapixels: "0.7",
      aspect: "16:9"
    }))
  });
}

function mockService(overrides = {}) {
  let lane = { running: 0, pending: 0 };
  const submits = [];
  const checkpoints = [];
  const promptStates = new Map();
  let historyMode = overrides.historyMode || "instant-complete";
  const {
    persistDescriptivePlan: persistOverride,
    submitJob: submitOverride,
    executionLane = null,
    historyMode: _hm,
    activePromptId,
    ...rest
  } = overrides;
  void _hm;
  const service = createBatchQueueRuntimeService({
    submitJob: async (input, meta) => {
      if (typeof submitOverride === "function") {
        return submitOverride(input, meta, { submits, promptStates });
      }
      const promptId = `pid-${meta.queueJobId}`;
      submits.push({ input, meta, promptId });
      promptStates.set(promptId, historyMode === "running" ? "running" : "completed");
      return { prompt_id: promptId };
    },
    fetchQueueCounts: async () => lane,
    fetchHistoryState: async promptId => promptStates.get(promptId) || (historyMode === "running" ? "running" : "completed"),
    fetchActivePromptId: async () => activePromptId || null,
    registerOwnership: () => {},
    executionLane,
    persistDescriptivePlan: async ({ projectId, plan, reason }) => {
      if (typeof persistOverride === "function") {
        return persistOverride({ projectId, plan, reason, checkpoints });
      }
      checkpoints.push({ projectId, plan: JSON.parse(JSON.stringify(plan)), reason });
    },
    ...rest
  });
  return {
    service,
    submits,
    checkpoints,
    promptStates,
    setLane(next) { lane = next; },
    setHistoryMode(next) { historyMode = next; },
    completePrompt(promptId) { promptStates.set(promptId, "completed"); }
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

/**
 * Deterministic deferred→active→release lifecycle (mirrors batch-ui contract).
 */
async function runDeferredLifecycle({ lane, ownerId, submit }) {
  const events = [];
  assert.equal(lane.reserve({ kind: EXECUTION_LANE_KIND.DEFERRED_BATCH, ownerId }).ok, true);
  events.push("reserved-deferred");
  assert.equal(lane.get()?.kind, EXECUTION_LANE_KIND.DEFERRED_BATCH);

  const transferred = lane.transferKind({ ownerId, kind: EXECUTION_LANE_KIND.ACTIVE_BATCH });
  assert.equal(transferred.ok, true);
  events.push("transferred-active");
  assert.equal(lane.get()?.kind, EXECUTION_LANE_KIND.ACTIVE_BATCH);

  try {
    await submit();
    events.push("submitted");
  } finally {
    assert.equal(lane.release({ ownerId, kind: EXECUTION_LANE_KIND.ACTIVE_BATCH }).ok, true);
    events.push("released-active");
  }
  assert.equal(lane.get(), null);
  return events;
}

test("pass4: deferred lifecycle transfers before submit and releases once", async () => {
  const lane = createExecutionLaneRegistry();
  let submitCount = 0;
  const events = await runDeferredLifecycle({
    lane,
    ownerId: "tab-deferred",
    submit: async () => {
      assert.equal(lane.get()?.kind, EXECUTION_LANE_KIND.ACTIVE_BATCH, "must be ACTIVE before /api/queue");
      submitCount += 1;
    }
  });
  assert.deepEqual(events, ["reserved-deferred", "transferred-active", "submitted", "released-active"]);
  assert.equal(submitCount, 1);
  assert.equal(lane.get(), null);
});

test("pass4: deferred lifecycle releases on thrown submit (no orphan)", async () => {
  const lane = createExecutionLaneRegistry();
  await assert.rejects(async () => runDeferredLifecycle({
    lane,
    ownerId: "tab-deferred-fail",
    submit: async () => { throw new Error("submit boom"); }
  }), /submit boom/);
  assert.equal(lane.get(), null);
});

test("pass4: F5 clears stored deferredBatch future reservation without restoring intent", async () => {
  const lane = createExecutionLaneRegistry();
  const storage = memoryStorage();
  assert.equal(lane.reserve({ kind: EXECUTION_LANE_KIND.DEFERRED_BATCH, ownerId: "tab-def" }).ok, true);
  writeStoredExecutionLane({ ownerId: "tab-def", kind: EXECUTION_LANE_KIND.DEFERRED_BATCH }, storage);
  const coord = createQueueCoordinator({ submit: async () => ({ prompt_id: "x" }) });
  assert.equal(coord.getDeferredBatch(), null);
  const stored = readStoredExecutionLane(storage);
  assert.equal(lane.release(stored).ok, true);
  clearStoredExecutionLane(storage);
  assert.equal(lane.get(), null);
  assert.equal((await coord.observeQueue({ running: 0, pending: 0 })).submitted, false);
});


test("pass4: tab-loss deferred becomes reclaimable after heartbeat silence", () => {
  let now = 1_000;
  const lane = createExecutionLaneRegistry({ now: () => now, futureStaleMs: 1_000 });
  assert.equal(lane.reserve({ kind: EXECUTION_LANE_KIND.DEFERRED_BATCH, ownerId: "tab-lost" }).ok, true);

  // Live heartbeat: not reclaimable.
  now = 1_500;
  assert.equal(lane.heartbeat({ ownerId: "tab-lost" }).ok, true);
  now = 2_000;
  assert.equal(lane.reclaimStale({ requesterId: "tab-b" }).ok, false);
  assert.equal(lane.reclaimStale({ requesterId: "tab-b" }).code, "still-alive");

  // Tab loss: no heartbeat → reclaim after stale window.
  now = 3_500;
  const reclaimed = lane.reclaimStale({ requesterId: "tab-b" });
  assert.equal(reclaimed.ok, true);
  assert.equal(reclaimed.status, "reclaimed");
  assert.equal(lane.get(), null);

  // Another client may now own the lane.
  assert.equal(lane.reserve({ kind: EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE, ownerId: "multi-b" }).ok, true);
});

test("pass4: active/multi kinds are never stale-reclaimed", () => {
  let now = 0;
  const lane = createExecutionLaneRegistry({ now: () => now, futureStaleMs: 1 });
  assert.equal(lane.reserve({ kind: EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE, ownerId: "multi" }).ok, true);
  now = 10_000;
  const result = lane.reclaimStale({ requesterId: "other" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "not-reclaimable");
  assert.equal(lane.get()?.kind, EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE);
});

test("pass4: live future intent cannot be stolen by another client", () => {
  let now = 0;
  const lane = createExecutionLaneRegistry({ now: () => now, futureStaleMs: 5_000 });
  assert.equal(lane.reserve({ kind: EXECUTION_LANE_KIND.QUEUED_NEXT, ownerId: "live-a" }).ok, true);
  now = 100;
  lane.heartbeat({ ownerId: "live-a" });
  now = 200;
  assert.equal(lane.reserve({ kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE, ownerId: "live-b" }).ok, false);
  assert.equal(lane.reclaimStale({ requesterId: "live-b" }).ok, false);
  assert.equal(lane.get()?.ownerId, "live-a");
});

test("pass4: immediate Single vs multi-queue — exactly one submission path", async () => {
  const lane = createExecutionLaneRegistry();
  let pathCount = 0;

  // A wins with immediate single
  assert.equal(lane.reserve({ kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE, ownerId: "single-a" }).ok, true);
  const { service: multi, submits, setLane } = mockService({
    executionLane: lane,
    historyMode: "instant-complete"
  });
  setLane({ running: 0, pending: 0 });
  const plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  const arm = await multi.arm({ projectId: "p-race-single", plan });
  assert.equal(arm.ok, false);
  assert.equal(arm.code, "lane-busy");
  assert.equal(submits.length, 0);

  // Simulate accepted single submit then release
  pathCount += 1;
  lane.release({ ownerId: "single-a", kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE });

  // Inverse: multi wins first
  const lane2 = createExecutionLaneRegistry();
  const multi2 = mockService({ executionLane: lane2, historyMode: "running" });
  multi2.setLane({ running: 1, pending: 0 });
  assert.equal((await multi2.service.arm({ projectId: "p-race-multi", plan })).ok, true);
  assert.equal(lane2.reserve({ kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE, ownerId: "single-b" }).ok, false);
  assert.equal(lane2.assertSubmitAllowed({ ownerId: "single-b", kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE }).ok, false);
  pathCount += 1;
  assert.equal(pathCount, 2);
});

test("pass4: /api/queue boundary rejects foreign lane owner while reservation held", () => {
  const lane = createExecutionLaneRegistry();
  assert.equal(lane.reserve({ kind: EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE, ownerId: "multi" }).ok, true);
  assert.equal(lane.assertSubmitAllowed({ ownerId: null }).ok, false);
  assert.equal(lane.assertSubmitAllowed({ ownerId: "other", kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE }).ok, false);
  assert.equal(lane.assertSubmitAllowed({ ownerId: "multi", kind: EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE }).ok, true);
});

test("pass4: stop UI feedback is truthful for HTTP 200 + queueCheckpointFailed", () => {
  const ok = formatQueueBatchStopFeedback({ queueCheckpointFailed: false });
  assert.equal(ok.recoveryRequired, false);
  assert.match(ok.message, /pausa/i);

  const failed = formatQueueBatchStopFeedback({
    queueCheckpointFailed: true,
    queueCheckpoint: { ok: false, code: "checkpoint-failed" }
  });
  assert.equal(failed.level, "error");
  assert.equal(failed.recoveryRequired, true);
  assert.match(failed.message, /RECUPERO RICHIESTO/);
  assert.match(failed.message, /FALLITO|fallito/i);
  assert.doesNotMatch(failed.message, /^Batch corrente interrotto\. La coda multi-batch è in pausa\.$/);

  const ui = readFileSync(new URL("../public/batch-queue-ui.mjs", import.meta.url), "utf8");
  assert.match(ui, /formatQueueBatchStopFeedback/);
  assert.match(ui, /stopCurrentQueueBatch/);
  assert.doesNotMatch(ui, /setFeedback\("Batch corrente interrotto\. La coda multi-batch è in pausa\."/);
});

test("pass4: claim checkpoint failure → resolve → resume runs next Batch only once", async () => {
  let claimFails = true;
  const { service, submits, setLane } = mockService({
    historyMode: "instant-complete",
    persistDescriptivePlan: async ({ reason }) => {
      if (reason === "claim" && claimFails) {
        claimFails = false;
        throw new Error("disk full");
      }
    }
  });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { order: 2 })).plan;
  const entryA = plan.entries[0].queueEntryId;
  const entryB = plan.entries[1].queueEntryId;

  await service.arm({ projectId: "p-rec", plan });
  await service.tickProject("p-rec");

  let view = service.getRuntime("p-rec");
  assert.equal(view.overallState, QUEUE_OVERALL_STATE.RECOVERY_REQUIRED);
  assert.equal(view.entries[0].state, QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);
  assert.equal(submits.length, 0);

  const blocked = await service.resume({ projectId: "p-rec", plan: view });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "recovery-unresolved");
  assert.equal(submits.length, 0);

  const resolved = service.resolveRecoveryEntry({
    projectId: "p-rec",
    queueEntryId: entryA,
    resolution: "cancelled",
    expectedRevision: view.revision
  });
  assert.equal(resolved.ok, true, resolved.error || resolved.code);
  assert.equal(resolved.view.entries[0].state, QUEUE_ENTRY_STATE.CANCELLED);

  const resumed = await service.resume({
    projectId: "p-rec",
    plan: resolved.view,
    expectedRevision: resolved.view.revision
  });
  assert.equal(resumed.ok, true, resumed.error || resumed.code);
  await service.tickProject("p-rec");

  assert.equal(submits.length, 1, "only Batch B submits");
  assert.equal(submits[0].meta.queueEntryId, entryB);
  const finalView = service.getRuntime("p-rec");
  assert.equal(finalView.entries[0].state, QUEUE_ENTRY_STATE.CANCELLED);
  assert.notEqual(finalView.entries[0].state, QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);
});

test("pass4: resume fails closed when recovery persist still unavailable", async () => {
  const { service, submits, setLane } = mockService({
    historyMode: "running",
    persistDescriptivePlan: async ({ reason }) => {
      if (reason === "claim" || reason === "resume-from-recovery") {
        throw new Error("disk still full");
      }
    }
  });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { order: 2 })).plan;
  await service.arm({ projectId: "p-persist", plan });
  await service.tickProject("p-persist");
  const view = service.getRuntime("p-persist");
  assert.equal(view.overallState, QUEUE_OVERALL_STATE.RECOVERY_REQUIRED);

  const resolved = service.resolveRecoveryEntry({
    projectId: "p-persist",
    queueEntryId: view.entries[0].queueEntryId,
    resolution: "completed",
    expectedRevision: view.revision
  });
  assert.equal(resolved.ok, true);

  const resumed = await service.resume({
    projectId: "p-persist",
    plan: resolved.view,
    expectedRevision: resolved.view.revision
  });
  assert.equal(resumed.ok, false);
  assert.equal(resumed.code, "checkpoint-failed");
  assert.equal(service.getRuntime("p-persist").overallState, QUEUE_OVERALL_STATE.RECOVERY_REQUIRED);
  assert.equal(submits.length, 0);
});

test("pass4: future kinds helper", () => {
  assert.equal(isFutureExecutionLaneKind(EXECUTION_LANE_KIND.QUEUED_NEXT), true);
  assert.equal(isFutureExecutionLaneKind(EXECUTION_LANE_KIND.DEFERRED_BATCH), true);
  assert.equal(isFutureExecutionLaneKind(EXECUTION_LANE_KIND.IMMEDIATE_SINGLE), false);
  assert.equal(isFutureExecutionLaneKind(EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE), false);
});

test("pass4: reconcileExecutionLaneAfterReload helper keeps storage when local intent present", async () => {
  const storage = memoryStorage();
  writeStoredExecutionLane({ ownerId: "orphan", kind: EXECUTION_LANE_KIND.QUEUED_NEXT }, storage);
  const withIntent = await reconcileExecutionLaneAfterReload({
    hasLocalFutureIntent: true,
    storage
  });
  assert.equal(withIntent.status, "intent-present");
  assert.ok(readStoredExecutionLane(storage));
});
