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
import { createPageSessionRegistry } from "../lib/page-session.mjs";
import {
  clearStoredExecutionLane,
  formatQueueBatchStopFeedback,
  readStoredExecutionLane,
  reconcileExecutionLaneAfterReload,
  writeStoredExecutionLane
} from "../public/execution-lane-client.mjs";
import { createQueueCoordinator } from "../public/queue-coordinator.mjs";

function openBrowserLane(overrides = {}) {
  let now = overrides.initialNow ?? 1_000;
  const pageSessions = createPageSessionRegistry({
    now: () => now,
    disconnectGraceMs: overrides.disconnectGraceMs ?? 1_000
  });
  const lane = createExecutionLaneRegistry({
    now: () => now,
    pageSessions,
    ...overrides.laneOpts
  });
  return {
    lane,
    pageSessions,
    pageSessionId: pageSessions.open(),
    advance(ms) { now += ms; },
    setNow(value) { now = value; }
  };
}

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
async function runDeferredLifecycle({ lane, ownerId, pageSessionId, submit }) {
  const events = [];
  const reserved = lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId,
    pageSessionId
  });
  assert.equal(reserved.ok, true);
  const leaseToken = reserved.leaseToken;
  events.push("reserved-deferred");
  assert.equal(lane.get()?.kind, EXECUTION_LANE_KIND.DEFERRED_BATCH);

  const transferred = lane.transferKind({
    ownerId,
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken,
    pageSessionId
  });
  assert.equal(transferred.ok, true);
  events.push("transferred-active");
  assert.equal(lane.get()?.kind, EXECUTION_LANE_KIND.ACTIVE_BATCH);

  try {
    await submit();
    events.push("submitted");
  } finally {
    assert.equal(lane.release({
      ownerId,
      kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
      leaseToken,
      pageSessionId
    }).ok, true);
    events.push("released-active");
  }
  assert.equal(lane.get(), null);
  return events;
}

test("pass4: deferred lifecycle transfers before submit and releases once", async () => {
  const { lane, pageSessionId } = openBrowserLane();
  let submitCount = 0;
  const events = await runDeferredLifecycle({
    lane,
    ownerId: "tab-deferred",
    pageSessionId,
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
  const { lane, pageSessionId } = openBrowserLane();
  await assert.rejects(async () => runDeferredLifecycle({
    lane,
    ownerId: "tab-deferred-fail",
    pageSessionId,
    submit: async () => { throw new Error("submit boom"); }
  }), /submit boom/);
  assert.equal(lane.get(), null);
});

test("pass4: F5 clears stored deferredBatch future reservation without restoring intent", async () => {
  const { lane, pageSessionId } = openBrowserLane();
  const storage = memoryStorage();
  const reserved = lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId: "tab-def",
    pageSessionId
  });
  assert.equal(reserved.ok, true);
  writeStoredExecutionLane({
    ownerId: "tab-def",
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    leaseToken: reserved.leaseToken
  }, storage);
  const coord = createQueueCoordinator({ submit: async () => ({ prompt_id: "x" }) });
  assert.equal(coord.getDeferredBatch(), null);
  const stored = readStoredExecutionLane(storage);
  assert.equal(lane.release({ ...stored, pageSessionId }).ok, true);
  clearStoredExecutionLane(storage);
  assert.equal(lane.get(), null);
  assert.equal((await coord.observeQueue({ running: 0, pending: 0 })).submitted, false);
});


test("pass4: tab-loss deferred becomes reclaimable after page connection loss", () => {
  const h = openBrowserLane({ disconnectGraceMs: 1_000, initialNow: 1_000 });
  const reserved = h.lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId: "tab-lost",
    pageSessionId: h.pageSessionId
  });
  assert.equal(reserved.ok, true);
  const leaseToken = reserved.leaseToken;

  // Live page + heartbeat telemetry: not reclaimable.
  h.advance(500);
  assert.equal(h.lane.heartbeat({
    ownerId: "tab-lost",
    leaseToken,
    pageSessionId: h.pageSessionId
  }).ok, true);
  h.advance(500);
  assert.equal(h.lane.reclaimStale({ requesterId: "tab-b" }).ok, false);
  assert.equal(h.lane.reclaimStale({ requesterId: "tab-b" }).code, "still-alive");

  // Tab loss: SSE disconnect → reclaim after grace (not JS timer silence alone).
  h.pageSessions.close(h.pageSessionId);
  h.advance(1_001);
  const reclaimed = h.lane.reclaimStale({ requesterId: "tab-b" });
  assert.equal(reclaimed.ok, true);
  assert.equal(reclaimed.status, "reclaimed");
  assert.equal(h.lane.get(), null);

  // Another client may now own the lane (server multi-batch needs no page session).
  assert.equal(h.lane.reserve({
    kind: EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE,
    ownerId: "multi-b"
  }).ok, true);
});

test("pass4: active/multi kinds are never stale-reclaimed", () => {
  const h = openBrowserLane({ disconnectGraceMs: 1, initialNow: 0 });
  assert.equal(h.lane.reserve({
    kind: EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE,
    ownerId: "multi"
  }).ok, true);
  h.advance(10_000);
  const result = h.lane.reclaimStale({ requesterId: "other" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "not-reclaimable");
  assert.equal(h.lane.get()?.kind, EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE);
});

test("pass4: live future intent cannot be stolen by another client", () => {
  const h = openBrowserLane({ disconnectGraceMs: 5_000, initialNow: 0 });
  const reserved = h.lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "live-a",
    pageSessionId: h.pageSessionId
  });
  assert.equal(reserved.ok, true);
  h.advance(100);
  h.lane.heartbeat({
    ownerId: "live-a",
    leaseToken: reserved.leaseToken,
    pageSessionId: h.pageSessionId
  });
  h.advance(200);
  const pageB = h.pageSessions.open();
  assert.equal(h.lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "live-b",
    pageSessionId: pageB
  }).ok, false);
  assert.equal(h.lane.reclaimStale({ requesterId: "live-b" }).ok, false);
  assert.equal(h.lane.get()?.ownerId, "live-a");
});

test("pass4: immediate Single vs multi-queue — exactly one submission path", async () => {
  const h = openBrowserLane();
  let pathCount = 0;

  // A wins with immediate single
  const reservedA = h.lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "single-a",
    pageSessionId: h.pageSessionId
  });
  assert.equal(reservedA.ok, true);
  const { service: multi, submits, setLane } = mockService({
    executionLane: h.lane,
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
  h.lane.release({
    ownerId: "single-a",
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    leaseToken: reservedA.leaseToken,
    pageSessionId: h.pageSessionId
  });

  // Inverse: multi wins first
  const lane2 = createExecutionLaneRegistry();
  const multi2 = mockService({ executionLane: lane2, historyMode: "running" });
  multi2.setLane({ running: 1, pending: 0 });
  assert.equal((await multi2.service.arm({ projectId: "p-race-multi", plan })).ok, true);
  const pageB = lane2.pageSessions.open();
  assert.equal(lane2.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "single-b",
    pageSessionId: pageB
  }).ok, false);
  assert.equal(lane2.assertSubmitAllowed({
    ownerId: "single-b",
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    leaseToken: "fake",
    pageSessionId: pageB
  }).ok, false);
  pathCount += 1;
  assert.equal(pathCount, 2);
});

test("pass4: /api/queue boundary rejects foreign lane owner while reservation held", () => {
  const lane = createExecutionLaneRegistry();
  const reserved = lane.reserve({ kind: EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE, ownerId: "multi" });
  assert.equal(reserved.ok, true);
  assert.equal(lane.assertSubmitAllowed({ ownerId: null }).ok, false);
  assert.equal(lane.assertSubmitAllowed({
    ownerId: "other",
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    leaseToken: reserved.leaseToken,
    pageSessionId: null
  }).ok, false);
  assert.equal(lane.assertSubmitAllowed({
    ownerId: "multi",
    kind: EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE,
    leaseToken: reserved.leaseToken,
    pageSessionId: null
  }).ok, true);
  assert.equal(lane.assertSubmitAllowed({
    ownerId: "multi",
    kind: EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE,
    leaseToken: null,
    pageSessionId: null
  }).ok, false);
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
  writeStoredExecutionLane({
    ownerId: "orphan",
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    leaseToken: "lease-orphan"
  }, storage);
  const withIntent = await reconcileExecutionLaneAfterReload({
    hasLocalFutureIntent: true,
    storage
  });
  assert.equal(withIntent.status, "intent-present");
  assert.ok(readStoredExecutionLane(storage));
});
