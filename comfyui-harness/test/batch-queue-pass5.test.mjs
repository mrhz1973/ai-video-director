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
  EXECUTION_LANE_KIND
} from "../lib/execution-lane.mjs";
import { createPageSessionRegistry } from "../lib/page-session.mjs";

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
    logger,
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
    logger,
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

test("pass5: dead future owner is atomically reclaimed by normal reserve", () => {
  let now = 1_000;
  const pageSessions = createPageSessionRegistry({ now: () => now, disconnectGraceMs: 1_000 });
  const lane = createExecutionLaneRegistry({ now: () => now, pageSessions });
  const deadPage = pageSessions.open();
  const dead = lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId: "dead-tab",
    pageSessionId: deadPage
  });
  assert.equal(dead.ok, true);
  assert.ok(dead.leaseToken);
  assert.equal(lane.get()?.ownerId, "dead-tab");

  // Connection loss + grace — not JS heartbeat silence alone.
  pageSessions.close(deadPage);
  now = 3_000;
  const freshPage = pageSessions.open();
  const next = lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "fresh-tab",
    pageSessionId: freshPage
  });
  assert.equal(next.ok, true, next.error || next.code);
  assert.equal(lane.get()?.ownerId, "fresh-tab");
  assert.equal(lane.get()?.kind, EXECUTION_LANE_KIND.QUEUED_NEXT);
  assert.notEqual(next.leaseToken, dead.leaseToken);
  // Old intent is not restored — dead lease cannot heartbeat/release.
  assert.equal(lane.heartbeat({
    ownerId: "dead-tab",
    leaseToken: dead.leaseToken,
    pageSessionId: deadPage
  }).ok, false);
  assert.equal(lane.release({
    ownerId: "dead-tab",
    leaseToken: dead.leaseToken,
    pageSessionId: deadPage
  }).ok, false);
  assert.equal(lane.get()?.ownerId, "fresh-tab");
});

test("pass5: client cannot shrink stale timeout via staleAfterMs=0", () => {
  let now = 0;
  const pageSessions = createPageSessionRegistry({ now: () => now, disconnectGraceMs: 5_000 });
  const lane = createExecutionLaneRegistry({ now: () => now, pageSessions });
  const page = pageSessions.open();
  const reserved = lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "live-owner",
    pageSessionId: page
  });
  assert.equal(reserved.ok, true);
  now = 10;
  // Even if a client still sends staleAfterMs:0, reclaimStale ignores it; live page stays.
  const forced = lane.reclaimStale({ requesterId: "attacker", staleAfterMs: 0 });
  assert.equal(forced.ok, false);
  assert.equal(forced.code, "still-alive");
  assert.equal(lane.get()?.ownerId, "live-owner");

  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /staleAfterMs from clients is intentionally ignored/);
  assert.doesNotMatch(server, /staleAfterMs:\s*input\.staleAfterMs/);
  const client = readFileSync(new URL("../public/execution-lane-client.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(client, /body\.staleAfterMs/);
  assert.doesNotMatch(client, /staleAfterMs\s*=/);
});

test("pass5: identical ownerId+kind second reserve is lane-busy; lease required to submit", () => {
  const pageSessions = createPageSessionRegistry();
  const lane = createExecutionLaneRegistry({ pageSessions });
  const pageA = pageSessions.open();
  const a = lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "same-owner",
    pageSessionId: pageA
  });
  assert.equal(a.ok, true);
  assert.ok(a.leaseToken);

  const pageB = pageSessions.open();
  const b = lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "same-owner",
    pageSessionId: pageB
  });
  assert.equal(b.ok, false);
  assert.equal(b.code, "lane-busy");
  assert.notEqual(b.status, "already-held");

  // B cannot submit with owner string alone.
  assert.equal(lane.assertSubmitAllowed({
    ownerId: "same-owner",
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE
  }).ok, false);
  assert.equal(lane.assertSubmitAllowed({
    ownerId: "same-owner",
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    leaseToken: "forged-lease",
    pageSessionId: pageA
  }).ok, false);
  assert.equal(lane.assertSubmitAllowed({
    ownerId: "same-owner",
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    leaseToken: a.leaseToken,
    pageSessionId: pageB
  }).ok, false);
  assert.equal(lane.assertSubmitAllowed({
    ownerId: "same-owner",
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    leaseToken: a.leaseToken,
    pageSessionId: pageA
  }).ok, true);

  // Public snapshot never leaks leaseToken.
  assert.equal(lane.get().leaseToken, undefined);
});

test("pass5 A: terminal checkpoint throw blocks Batch B (RECOVERY_REQUIRED, no auto-retry)", async () => {
  const { service, submits, setLane } = mockService({
    historyMode: "instant-complete",
    persistDescriptivePlan: async ({ reason }) => {
      if (reason === "terminal") throw new Error("disk full on terminal");
    }
  });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1, "A"), { order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1, "B"), { order: 2 })).plan;

  await service.arm({ projectId: "p-term", plan });
  await service.tickProject("p-term");

  const view = service.getRuntime("p-term");
  assert.equal(view.overallState, QUEUE_OVERALL_STATE.RECOVERY_REQUIRED);
  assert.equal(submits.length, 1, "only Batch A submitted");
  assert.equal(submits[0].meta.queueEntryId, plan.entries[0].queueEntryId);

  await service.tickProject("p-term");
  await service.tickProject("p-term");
  assert.equal(submits.length, 1, "later ticks still 0 Batch B submits");
  assert.equal(service.getRuntime("p-term").overallState, QUEUE_OVERALL_STATE.RECOVERY_REQUIRED);
});

test("pass5 B: submit-failure checkpoint throw blocks next Batch", async () => {
  const { service, submits, setLane } = mockService({
    historyMode: "instant-complete",
    submitJob: async () => {
      throw new Error("comfy reject");
    },
    persistDescriptivePlan: async ({ reason }) => {
      if (reason === "submit-failure") throw new Error("disk full on submit-failure");
    }
  });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1, "A"), { order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1, "B"), { order: 2 })).plan;

  await service.arm({ projectId: "p-subfail", plan });
  await service.tickProject("p-subfail");

  const view = service.getRuntime("p-subfail");
  assert.equal(view.overallState, QUEUE_OVERALL_STATE.RECOVERY_REQUIRED);
  assert.equal(view.entries[0].state, QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);
  assert.equal(submits.length, 0);

  await service.tickProject("p-subfail");
  assert.equal(submits.length, 0);
  assert.equal(service.getRuntime("p-subfail").overallState, QUEUE_OVERALL_STATE.RECOVERY_REQUIRED);
});

test("pass5 C: tickAll contains async persistence rejection (no unhandled throw)", async () => {
  const logs = [];
  const { service, submits, setLane } = mockService({
    historyMode: "instant-complete",
    logger: { info: (event, fields) => logs.push({ event, fields }) },
    persistDescriptivePlan: async ({ reason }) => {
      if (reason === "terminal") throw new Error("async disk fail");
    }
  });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { order: 2 })).plan;

  await service.arm({ projectId: "p-tick", plan });
  await assert.doesNotReject(() => service.tickAll());

  assert.equal(service.getRuntime("p-tick").overallState, QUEUE_OVERALL_STATE.RECOVERY_REQUIRED);
  assert.equal(submits.length, 1);
  assert.ok(logs.some(entry => entry.event === "batch_queue_checkpoint_failed"));

  // Second tickAll still contained and does not advance Batch B.
  await assert.doesNotReject(() => service.tickAll());
  assert.equal(submits.length, 1);

  service._stopTimerForTests();
});

test("pass5: lease token is not exposed in public runtime view", async () => {
  const lane = createExecutionLaneRegistry();
  const { service, setLane } = mockService({
    executionLane: lane,
    historyMode: "running"
  });
  setLane({ running: 1, pending: 0 });
  const plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  assert.equal((await service.arm({ projectId: "p-lease", plan })).ok, true);
  const view = service.getRuntime("p-lease");
  assert.equal("laneLeaseToken" in view, false);
  assert.equal(JSON.stringify(view).includes("laneLeaseToken"), false);
  assert.equal(lane.get().leaseToken, undefined);
  assert.ok(lane.get()?.ownerId);
  service._stopTimerForTests();
});
