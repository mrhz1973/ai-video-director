import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QUEUE_ENTRY_STATE,
  QUEUE_OVERALL_STATE,
  appendQueueEntry,
  createQueueEntryFromDraft,
  updateQueueEntry
} from "../lib/batch-queue-plan.mjs";
import {
  mergeIncomingPlanWithRuntime,
  resolveRecoveryEntryInPlan
} from "../lib/batch-queue-reconcile.mjs";
import {
  entryBatchTerminalFromJobs,
  resolveCurrentJobIndex,
  selectNextQueuedEntry
} from "../lib/batch-queue-runtime.mjs";
import { createBatchQueueRuntimeService } from "../lib/batch-queue-service.mjs";
import { serializeBatchDraft } from "../lib/batch-draft.mjs";
import {
  buildQueueSessionOutputRecords,
  selectCompletedQueueJobsForSession
} from "../lib/batch-queue-session.mjs";

const batchQueueUi = readFileSync(new URL("../public/batch-queue-ui.mjs", import.meta.url), "utf8");

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
  const promptStates = new Map();
  let historyMode = overrides.historyMode || "instant-complete";
  const service = createBatchQueueRuntimeService({
    submitJob: async (input, meta) => {
      const promptId = `pid-${meta.queueJobId}`;
      submits.push({ input, meta, promptId });
      promptStates.set(promptId, historyMode === "running" ? "running" : "completed");
      return { prompt_id: promptId };
    },
    fetchQueueCounts: async () => lane,
    fetchHistoryState: async promptId => {
      if (typeof overrides.fetchHistoryState === "function") return overrides.fetchHistoryState(promptId);
      return promptStates.get(promptId) || (historyMode === "running" ? "running" : "completed");
    },
    fetchActivePromptId: async () => overrides.activePromptId || null,
    registerOwnership: () => {},
    ...overrides
  });
  return {
    service,
    submits,
    promptStates,
    setLane(next) { lane = next; },
    setHistoryMode(next) { historyMode = next; },
    completePrompt(promptId) { promptStates.set(promptId, "completed"); }
  };
}

test("blocker1: F5 sync does not downgrade completed/running to queued", () => {
  const serverPlan = {
    version: 1,
    failurePolicy: "stop",
    revision: 3,
    entries: [
      { queueEntryId: "e1", name: "Batch 01", order: 1, state: "completed", snapshot: sampleDraft(1) },
      { queueEntryId: "e2", name: "Batch 02", order: 2, state: "running", snapshot: sampleDraft(1) },
      { queueEntryId: "e3", name: "Batch 03", order: 3, state: "queued", snapshot: sampleDraft(1) }
    ]
  };
  const incomingPlan = {
    version: 1,
    failurePolicy: "stop",
    revision: 1,
    entries: [
      { queueEntryId: "e1", name: "Batch 01", order: 1, state: "queued", snapshot: sampleDraft(1) },
      { queueEntryId: "e2", name: "Batch 02", order: 2, state: "queued", snapshot: sampleDraft(1) },
      { queueEntryId: "e3", name: "Batch 03", order: 3, state: "queued", snapshot: sampleDraft(1) }
    ]
  };
  const merged = mergeIncomingPlanWithRuntime({ serverPlan, incomingPlan, expectedRevision: 1 });
  assert.equal(merged.ok, true);
  assert.equal(merged.plan.entries[0].state, QUEUE_ENTRY_STATE.COMPLETED);
  assert.equal(merged.plan.entries[1].state, QUEUE_ENTRY_STATE.RUNNING);
  assert.equal(merged.plan.entries[2].state, QUEUE_ENTRY_STATE.QUEUED);
});

test("blocker1: stale sync revision rejected while live runtime exists", async () => {
  const { service, setLane } = mockService({ historyMode: "running" });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e1", order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e2", order: 2 })).plan;
  await service.arm({ projectId: "p1", plan });
  const liveRevision = service.getRuntime("p1").revision;
  const renamed = {
    ...service.getRuntime("p1"),
    revision: liveRevision,
    entries: service.getRuntime("p1").entries.map((entry, index) => (
      index === 1 ? { ...entry, name: "Renamed batch" } : entry
    ))
  };
  const stale = service.syncPlan({
    projectId: "p1",
    plan: renamed,
    expectedRevision: Math.max(0, liveRevision - 1)
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "stale-revision");
});

test("blocker1: F5 integration preserves completed and only starts batch 3 after batch 2", async () => {
  const { service, submits, setLane, completePrompt } = mockService({ historyMode: "running" });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e1", order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e2", order: 2 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e3", order: 3 })).plan;
  await service.arm({ projectId: "p1", plan });
  await service.tickProject("p1");
  const e1Prompt = submits.find(s => s.meta.queueEntryId === "e1")?.promptId;
  completePrompt(e1Prompt);
  await service.tickProject("p1");
  assert.equal(service.getRuntime("p1").entries[0].state, QUEUE_ENTRY_STATE.COMPLETED);
  assert.equal(submits.filter(s => s.meta.queueEntryId === "e1").length, 1);

  const mid = service.getRuntime("p1");
  assert.equal(mid.entries[1].state, QUEUE_ENTRY_STATE.RUNNING);
  assert.equal(mid.entries[2].state, QUEUE_ENTRY_STATE.QUEUED);

  service.syncPlan({
    projectId: "p1",
    plan: {
      ...plan,
      revision: 0,
      entries: plan.entries.map(entry => ({ ...entry, state: QUEUE_ENTRY_STATE.QUEUED }))
    },
    expectedRevision: 0
  });
  const afterF5 = service.getRuntime("p1");
  assert.equal(afterF5.entries[0].state, QUEUE_ENTRY_STATE.COMPLETED);
  assert.equal(afterF5.entries[1].state, QUEUE_ENTRY_STATE.RUNNING);
  assert.equal(afterF5.entries[2].state, QUEUE_ENTRY_STATE.QUEUED);
  assert.equal(submits.filter(s => s.meta.queueEntryId === "e1").length, 1);

  const e2Prompt = submits.find(s => s.meta.queueEntryId === "e2")?.promptId;
  completePrompt(e2Prompt);
  await service.tickProject("p1");
  assert.equal(service.getRuntime("p1").entries[1].state, QUEUE_ENTRY_STATE.COMPLETED);
  await service.tickProject("p1");
  assert.equal(service.getRuntime("p1").entries[2].state, QUEUE_ENTRY_STATE.RUNNING);
  assert.equal(submits.filter(s => s.meta.queueEntryId === "e1").length, 1);
});

test("blocker2: resume does not requeue recovery-required", async () => {
  const { service } = mockService();
  const plan = {
    version: 1,
    failurePolicy: "stop",
    revision: 1,
    entries: [{
      queueEntryId: "e1",
      name: "Batch 01",
      order: 1,
      state: QUEUE_ENTRY_STATE.RECOVERY_REQUIRED,
      snapshot: sampleDraft(1)
    }]
  };
  service.syncPlan({ projectId: "p1", plan });
  const result = await service.resume({ projectId: "p1", plan });
  assert.equal(result.ok, false);
  assert.equal(result.code, "recovery-unresolved");
});

test("blocker2: unresolved recovery blocks later queued batch", () => {
  const entries = [
    { order: 1, state: QUEUE_ENTRY_STATE.RECOVERY_REQUIRED },
    { order: 2, state: QUEUE_ENTRY_STATE.QUEUED }
  ];
  assert.equal(selectNextQueuedEntry(entries), null);
});

test("blocker2: explicit recovery resolution allows resume path", () => {
  const plan = {
    version: 1,
    failurePolicy: "stop",
    revision: 1,
    entries: [{
      queueEntryId: "e1",
      name: "Batch 01",
      order: 1,
      state: QUEUE_ENTRY_STATE.RECOVERY_REQUIRED,
      snapshot: sampleDraft(1)
    }, {
      queueEntryId: "e2",
      name: "Batch 02",
      order: 2,
      state: QUEUE_ENTRY_STATE.QUEUED,
      snapshot: sampleDraft(1)
    }]
  };
  const resolved = resolveRecoveryEntryInPlan(plan, "e1", "completed");
  assert.equal(resolved.ok, true);
  assert.equal(resolved.plan.entries[0].state, QUEUE_ENTRY_STATE.COMPLETED);
  assert.equal(selectNextQueuedEntry(resolved.plan.entries)?.queueEntryId, "e2");
});

test("blocker3: future queued job fields editable via update-entry", () => {
  const entry = createQueueEntryFromDraft(sampleDraft(2), { queueEntryId: "e1", order: 1 });
  let plan = appendQueueEntry(null, entry).plan;
  const items = plan.entries[0].snapshot.items.map((item, index) => (
    index === 1 ? { ...item, prompt: "EDITED JOB 2", files: { firstImage: "override.png" } } : item
  ));
  const updated = updateQueueEntry(plan, "e1", { snapshot: { ...plan.entries[0].snapshot, items } });
  assert.equal(updated.ok, true);
  assert.equal(updated.plan.entries[0].snapshot.items[1].prompt, "EDITED JOB 2");
  assert.equal(updated.plan.entries[0].snapshot.items[1].files.firstImage, "override.png");
});

test("blocker4: full queued batch stop pauses multi-queue", async () => {
  const { service, setLane } = mockService({ historyMode: "running" });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { order: 2 })).plan;
  await service.arm({ projectId: "p1", plan });
  await service.tickProject("p1");
  const view = service.getRuntime("p1");
  service.onFullBatchStop("p1", { batchId: view.currentBatchId });
  const after = service.getRuntime("p1");
  assert.equal(after.overallState, QUEUE_OVERALL_STATE.PAUSED);
  assert.equal(after.currentEntryId, null);
});

test("blocker5: completed queued jobs reconstruct session outputs once", () => {
  const accepted = [{
    promptId: "pid-abc",
    queueEntryId: "e1",
    queueBatchName: "Batch 01",
    queueJobId: "e1:job:0",
    jobIndex: 0,
    state: "completed",
    item: { seed: "1", duration: "10", megapixels: "0.7", aspect: "16:9", steps: "20" },
    workflowId: "minimax-h3-i2v",
    workflowLabel: "I2V",
    model: "model.gguf"
  }];
  const existing = new Set();
  const ready = selectCompletedQueueJobsForSession({
    acceptedJobs: accepted,
    historyByPromptId: { "pid-abc": "completed" },
    existingPromptIds: existing
  });
  assert.equal(ready.length, 1);
  const records = buildQueueSessionOutputRecords(ready);
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "batch");
  assert.equal(records[0].promptId, "pid-abc");
  const again = selectCompletedQueueJobsForSession({
    acceptedJobs: accepted,
    historyByPromptId: { "pid-abc": "completed" },
    existingPromptIds: new Set(["pid-abc"])
  });
  assert.equal(again.length, 0);
});

test("blocker6: first submit failure is FAILED not CANCELLED", () => {
  const jobs = [{ state: "not-submitted" }, { state: "not-submitted" }];
  assert.equal(entryBatchTerminalFromJobs(jobs, { submitFailed: true }), QUEUE_ENTRY_STATE.FAILED);
});

test("blocker6: stop policy pauses on first-submit failure", async () => {
  const { service, setLane } = mockService({
    submitJob: async () => { throw new Error("submit failed"); }
  });
  setLane({ running: 0, pending: 0 });
  const plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  await service.arm({ projectId: "p1", plan });
  await service.tickProject("p1");
  const view = service.getRuntime("p1");
  assert.equal(view.entries[0].state, QUEUE_ENTRY_STATE.FAILED);
  assert.equal(view.overallState, QUEUE_OVERALL_STATE.PAUSED_FAILURE);
});

test("blocker6: continue policy starts next batch after submit failure", async () => {
  let call = 0;
  const { service, setLane } = mockService({
    historyMode: "running",
    submitJob: async (_input, meta) => {
      call += 1;
      if (call === 1) throw new Error("fail");
      return { prompt_id: `pid-${meta.queueJobId}` };
    }
  });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { order: 2 })).plan;
  plan.failurePolicy = "continue";
  await service.arm({ projectId: "p1", plan, failurePolicy: "continue" });
  await service.tickProject("p1");
  assert.equal(service.getRuntime("p1").entries[0].state, QUEUE_ENTRY_STATE.FAILED);
  await service.tickProject("p1");
  assert.equal(service.getRuntime("p1").entries[1].state, QUEUE_ENTRY_STATE.RUNNING);
});

test("blocker7: currentJobIndex follows active prompt", () => {
  const jobs = Array.from({ length: 8 }, (_, index) => ({
    index,
    promptId: `pid-${index}`,
    state: index === 3 ? "running" : "pending"
  }));
  assert.equal(resolveCurrentJobIndex(jobs, "pid-3"), 3);
});

test("blocker8: malicious queue name renders as text only", () => {
  assert.match(batchQueueUi, /title\.textContent = `\$\{index \+ 1\}\. \$\{entry\.name\}`/);
  assert.doesNotMatch(batchQueueUi, /innerHTML\s*=\s*[`'"].*\$\{entry\.name/);
  assert.match(batchQueueUi, /renderEntryCard/);
});

test("blocker8: workflow label with HTML stays text", () => {
  assert.match(batchQueueUi, /meta\.textContent = `\$\{jobProgress\} · \$\{workflow\}`/);
  assert.doesNotMatch(batchQueueUi, /innerHTML\s*=\s*[`'"].*\$\{workflow/);
});

test("blocker wiring: interrupt controls and resolve-recovery route present", () => {
  assert.match(batchQueueUi, /batchQueueInterruptCurrent/);
  assert.match(batchQueueUi, /batchQueueInterruptAll/);
  assert.match(batchQueueUi, /resolve-recovery/);
  assert.match(batchQueueUi, /appendJobEditor/);
});
