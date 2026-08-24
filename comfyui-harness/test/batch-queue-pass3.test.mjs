import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import { assertModuleDependencyContract } from "../lib/module-dependency.mjs";
import { createProjectStore } from "../lib/project-store.mjs";
import * as batchQueueSession from "../lib/batch-queue-session.mjs";
import {
  buildQueueSessionOutputRecordsFromOutputs
} from "../lib/batch-queue-session.mjs";
import {
  buildSessionOutputRecords,
  normalizeSessionOutput,
  readSessionOutputs,
  upsertSessionOutputs
} from "../public/session-outputs.mjs";
import { createQueueCoordinator } from "../public/queue-coordinator.mjs";

const batchQueueUiSource = readFileSync(
  new URL("../public/batch-queue-ui.mjs", import.meta.url),
  "utf8"
);

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

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
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

test("pass3: batch-queue-ui imports live CLIP SESSIONE helper (dependency contract)", async () => {
  const contract = assertModuleDependencyContract({
    source: batchQueueUiSource,
    moduleSpecifier: "../lib/batch-queue-session.mjs",
    requiredUsed: ["buildQueueSessionOutputRecordsFromOutputs", "selectCompletedQueueJobsForSession"],
    liveExports: batchQueueSession
  });
  assert.equal(contract.ok, true, contract.error);
  assert.equal(typeof batchQueueSession.buildQueueSessionOutputRecordsFromOutputs, "function");
  // Deterministic undefined-helper catch: a required helper that is not imported fails.
  const stripped = batchQueueUiSource.replace(
    /buildQueueSessionOutputRecordsFromOutputs\s*,?\s*/g,
    ""
  );
  const broken = assertModuleDependencyContract({
    source: stripped,
    moduleSpecifier: "../lib/batch-queue-session.mjs",
    requiredUsed: ["buildQueueSessionOutputRecordsFromOutputs"],
    liveExports: batchQueueSession
  });
  assert.equal(broken.ok, false);
  assert.equal(broken.code, "missing-import");
});

test("pass3: real reconnect path builds one playable CLIP SESSIONE row", async () => {
  const job = {
    promptId: "pid-reconnect-1",
    queueEntryId: "e1",
    queueBatchName: "Batch 01",
    queueJobId: "e1:job:0",
    jobIndex: 0,
    item: { seed: "9", duration: "10", megapixels: "0.7", aspect: "16:9", steps: "20" },
    workflowId: "minimax-h3-i2v",
    workflowLabel: "I2V",
    model: "model.gguf"
  };
  const outputs = [{
    filename: "clip_reconnect.mp4",
    subfolder: "",
    type: "output",
    url: "/view?filename=clip_reconnect.mp4"
  }];
  // promptId → authoritative output rows → buildSessionOutputRecords → queue meta → upsert
  const records = buildQueueSessionOutputRecordsFromOutputs(outputs, job, buildSessionOutputRecords);
  assert.equal(records.length, 1);
  const storage = memoryStorage();
  upsertSessionOutputs(storage, records);
  const stored = readSessionOutputs(storage);
  assert.equal(stored.length, 1);
  const normalized = normalizeSessionOutput(stored[0]);
  assert.equal(normalized.filename, "clip_reconnect.mp4");
  assert.equal(normalized.url, "/view?filename=clip_reconnect.mp4");
  assert.ok(normalized.url, "playable clip url must survive normalizeSessionOutput");
});

test("pass3: claim checkpoint persistence failure is fail-closed (submit=0)", async () => {
  const { service, submits, setLane } = mockService({
    historyMode: "running",
    persistDescriptivePlan: async ({ reason }) => {
      if (reason === "claim") throw new Error("disk full");
    }
  });
  setLane({ running: 0, pending: 0 });
  const plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(2), { order: 1 })).plan;
  await service.arm({ projectId: "p-claim-fail", plan });
  await service.tickProject("p-claim-fail");
  assert.equal(submits.length, 0);
  const view = service.getRuntime("p-claim-fail");
  assert.equal(view.overallState, QUEUE_OVERALL_STATE.RECOVERY_REQUIRED);
  assert.equal(view.entries[0].state, QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);
  assert.equal(view.currentEntryId, null);
  // no automatic retry
  await service.tickProject("p-claim-fail");
  assert.equal(submits.length, 0);
});

test("pass3: queue checkpoint patch must not overwrite unrelated project edits", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-bq-ckpt-race-"));
  const store = createProjectStore(dir);
  const draftA = serializeBatchDraft({
    source: sampleSource,
    items: [{ prompt: "d1", seed: "1", duration: "10", steps: "20", megapixels: "0.7", aspect: "16:9" }]
  });
  const draftB = serializeBatchDraft({
    source: sampleSource,
    items: [{ prompt: "d2", seed: "2", duration: "10", steps: "20", megapixels: "0.7", aspect: "16:9" }]
  });
  const created = await store.create({
    label: "race",
    workflowId: "minimax-h3-i2v",
    prompt: "PROMPT-A",
    settings: { model: "model-a", steps: 20 },
    library: { elements: [], locations: [], objects: [], audio: [] },
    batchDraft: draftA
  });

  let releaseGate;
  const gate = new Promise(resolve => { releaseGate = resolve; });

  const checkpoint = (async () => {
    await gate;
    await store.update(created.id, {
      batchQueue: { version: 1, revision: 7, entries: [{ queueEntryId: "e1", state: "submitting", name: "B1", order: 1, snapshot: draftA, everClaimed: true }] }
    });
  })();

  await store.update(created.id, {
    prompt: "PROMPT-B",
    settings: { model: "model-b", steps: 40 },
    library: {
      elements: [{ id: "g1", label: "G", members: [{ id: "m2", filename: "f.png", originalName: "f.png", label: "m2", type: "image" }] }],
      locations: [],
      objects: [],
      audio: []
    },
    batchDraft: draftB
  });
  releaseGate();
  await checkpoint;

  const final = await store.read(created.id);
  assert.equal(final.prompt, "PROMPT-B");
  assert.equal(final.settings.model, "model-b");
  assert.equal(final.settings.steps, 40);
  assert.equal(final.library.elements[0].members[0].id, "m2");
  assert.equal(final.batchDraft.items[0].prompt, "d2");
  assert.equal(final.batchQueue.revision, 7);
});

test("pass3: full Batch stop durably checkpoints cancelled; reload does not resubmit", async () => {
  const durable = { plan: null };
  const { service, submits, setLane, checkpoints } = mockService({
    historyMode: "running",
    persistDescriptivePlan: async ({ plan, reason, checkpoints: cps }) => {
      const copy = JSON.parse(JSON.stringify(plan));
      (cps || checkpoints).push({ plan: copy, reason });
      durable.plan = copy;
    }
  });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { order: 2 })).plan;
  await service.arm({ projectId: "p-stop", plan });
  await service.tickProject("p-stop");
  assert.ok(submits.length >= 1);
  const before = service.getRuntime("p-stop");
  const stop = await service.onFullBatchStop("p-stop", { batchId: before.currentBatchId });
  assert.equal(stop.ok, true);
  const stopCp = checkpoints.find(item => item.reason === "full-stop");
  assert.ok(stopCp, "cancelled checkpoint required");
  assert.equal(stopCp.plan.entries[0].state, QUEUE_ENTRY_STATE.CANCELLED);

  service._stopTimerForTests();
  service.loseAuthority("p-stop");

  // Reload durable project only into a fresh runtime — no authority, no resubmit.
  const reloaded = mockService({ historyMode: "running" });
  reloaded.service.syncPlan({ projectId: "p-stop", plan: durable.plan });
  const view = reloaded.service.getRuntime("p-stop");
  assert.equal(view.entries[0].state, QUEUE_ENTRY_STATE.CANCELLED);
  await reloaded.service.tickProject("p-stop");
  assert.equal(reloaded.submits.length, 0);
});

test("pass3: cross-tab queuedNext vs multi-queue — only one owns future lane", async () => {
  const lane = createExecutionLaneRegistry();
  const clientA = createQueueCoordinator({ submit: async () => ({ prompt_id: "a" }) });
  const clientB = createQueueCoordinator({ submit: async () => ({ prompt_id: "b" }) });

  clientA.markQueue({ running: 1, pending: 0 });
  const reservedA = await lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "tab-a",
    projectId: "p1",
    pageSessionId: lane.pageSessions.open()
  });
  assert.equal(reservedA.ok, true);
  assert.equal(clientA.armQueuedNext({ prompt: "next", seed: 1 }).ok, true);

  const { service, submits, setLane } = mockService({ executionLane: lane, historyMode: "running" });
  setLane({ running: 0, pending: 0 });
  const plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  const armB = await service.arm({ projectId: "p-multi", plan });
  assert.equal(armB.ok, false);
  assert.equal(armB.code, "lane-busy");
  assert.equal(submits.length, 0);
  assert.equal(clientB.armQueuedNext({ prompt: "other" }).ok, false);
  void clientB;
});

test("pass3: cross-tab multi-queue vs deferredBatch — inverse order", async () => {
  const lane = createExecutionLaneRegistry();
  const { service, setLane } = mockService({ executionLane: lane, historyMode: "running" });
  setLane({ running: 1, pending: 0 });
  const plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  const arm = await service.arm({ projectId: "p-multi-2", plan });
  assert.equal(arm.ok, true);
  assert.equal(lane.get()?.kind, EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE);

  const clientA = createQueueCoordinator({ submit: async () => ({ prompt_id: "x" }) });
  clientA.markQueue({ running: 1, pending: 0 });
  const reservedLegacy = await lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId: "tab-a",
    projectId: "p1",
    pageSessionId: lane.pageSessions.open()
  });
  assert.equal(reservedLegacy.ok, false);
  assert.equal(reservedLegacy.code, "lane-busy");
});

test("pass3: when lane empties, only one submission path may proceed", async () => {
  const lane = createExecutionLaneRegistry();
  let pathCount = 0;
  const clientLegacy = createQueueCoordinator({
    submit: async () => {
      pathCount += 1;
      return { prompt_id: `legacy-${pathCount}` };
    }
  });
  const { service, submits, setLane } = mockService({
    executionLane: lane,
    historyMode: "instant-complete",
    submitJob: async (input, meta, ctx) => {
      pathCount += 1;
      const promptId = `multi-${pathCount}`;
      ctx.submits.push({ input, meta, promptId });
      ctx.promptStates.set(promptId, "completed");
      return { prompt_id: promptId };
    }
  });

  // Legacy owns future lane first.
  clientLegacy.markQueue({ running: 1, pending: 0 });
  const legacyPage = lane.pageSessions.open();
  const reservedLegacy = await lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "tab-legacy",
    pageSessionId: legacyPage
  });
  assert.equal(reservedLegacy.ok, true);
  assert.equal(clientLegacy.armQueuedNext({ prompt: "L", seed: 1 }).ok, true);

  setLane({ running: 0, pending: 0 });
  const plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  assert.equal((await service.arm({ projectId: "p-race", plan })).ok, false);

  // Release legacy reservation, then multi may arm — still a single path owner.
  lane.release({
    ownerId: "tab-legacy",
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    leaseToken: reservedLegacy.leaseToken,
    pageSessionId: legacyPage
  });
  clientLegacy.cancelQueuedNext();
  assert.equal((await service.arm({ projectId: "p-race", plan })).ok, true);
  await service.tickProject("p-race");
  assert.equal(submits.length, 1);
  assert.equal(pathCount, 1);
});

test("pass3: server.mjs has a single persistDescriptivePlan and patch-only update", async () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const matches = server.match(/persistDescriptivePlan\s*:/g) || [];
  assert.equal(matches.length, 1);
  assert.match(server, /projectStore\.update\(projectId,\s*\{\s*batchQueue:\s*plan\s*\}\)/);
  assert.doesNotMatch(server, /\.\.\.current,\s*batchQueue:\s*plan/);
  assert.match(server, /throw error/);
});
