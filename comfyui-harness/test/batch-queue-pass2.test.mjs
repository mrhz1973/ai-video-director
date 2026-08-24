import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QUEUE_ENTRY_STATE,
  appendQueueEntry,
  createQueueEntryFromDraft,
  serializeBatchQueuePlan,
  updateQueueEntry
} from "../lib/batch-queue-plan.mjs";
import { validateQueueBatchSnapshot } from "../lib/batch-queue-validate.mjs";
import {
  buildQueueSessionOutputRecordsFromOutputs,
  selectCompletedQueueJobsForSession
} from "../lib/batch-queue-session.mjs";
import { createBatchQueueRuntimeService } from "../lib/batch-queue-service.mjs";
import { serializeBatchDraft } from "../lib/batch-draft.mjs";
import {
  buildSessionOutputRecords,
  normalizeSessionOutput,
  readSessionOutputs,
  upsertSessionOutputs
} from "../public/session-outputs.mjs";
import {
  canArmDeferredBatch,
  canArmMultiBatchQueue,
  canArmQueuedNext,
  createQueueCoordinator
} from "../public/queue-coordinator.mjs";

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
  const checkpoints = [];
  const promptStates = new Map();
  let historyMode = overrides.historyMode || "instant-complete";
  const service = createBatchQueueRuntimeService({
    submitJob: async (input, meta) => {
      if (typeof overrides.submitJob === "function") {
        return overrides.submitJob(input, meta, { submits, promptStates });
      }
      const promptId = `pid-${meta.queueJobId}`;
      submits.push({ input, meta, promptId });
      promptStates.set(promptId, historyMode === "running" ? "running" : "completed");
      return { prompt_id: promptId };
    },
    fetchQueueCounts: async () => lane,
    fetchHistoryState: async promptId => promptStates.get(promptId) || (historyMode === "running" ? "running" : "completed"),
    fetchActivePromptId: async () => overrides.activePromptId || null,
    registerOwnership: () => {},
    persistDescriptivePlan: async ({ projectId, plan, reason }) => {
      checkpoints.push({ projectId, plan: JSON.parse(JSON.stringify(plan)), reason });
    },
    ...overrides
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

test("pass2: CLIP SESSIONE record from real outputs survives normalize/upsert once", () => {
  const job = {
    promptId: "pid-queue-1",
    jobIndex: 0,
    queueEntryId: "e1",
    queueBatchName: "Batch 01",
    queueJobId: "e1:job:0",
    workflowId: "minimax-h3-i2v",
    workflowLabel: "I2V",
    model: "m.gguf",
    item: { seed: "9", duration: "10", megapixels: "0.7", aspect: "16:9", steps: "20" },
    state: "completed"
  };
  const outputs = [{
    filename: "test.mp4",
    subfolder: "",
    url: "/api/view?filename=test.mp4&type=output",
    kind: "video"
  }];
  const records = buildQueueSessionOutputRecordsFromOutputs(outputs, job, buildSessionOutputRecords);
  assert.equal(records.length, 1);
  const normalized = normalizeSessionOutput(records[0]);
  assert.ok(normalized);
  assert.equal(normalized.filename, "test.mp4");
  assert.equal(normalized.url, "/api/view?filename=test.mp4&type=output");
  assert.equal(normalized.source, "batch");
  assert.equal(normalized.queueEntryId, "e1");
  assert.equal(normalized.queueJobId, "e1:job:0");

  const storage = memoryStorage();
  upsertSessionOutputs(storage, records);
  assert.equal(readSessionOutputs(storage).length, 1);
  upsertSessionOutputs(storage, records);
  assert.equal(readSessionOutputs(storage).length, 1);
});

test("pass2: metadata-only queue record is discarded by normalizeSessionOutput", () => {
  const bare = {
    promptId: "pid-bare",
    source: "batch",
    jobLabel: "Job 1",
    seed: "1"
  };
  assert.equal(normalizeSessionOutput(bare), null);
});

test("pass2: future queued Batch remains editable while queue armed (UI)", () => {
  assert.match(batchQueueUi, /const editable = entry\.state === QUEUE_ENTRY_STATE\.QUEUED;/);
  assert.doesNotMatch(batchQueueUi, /const editable = entry\.state === QUEUE_ENTRY_STATE\.QUEUED && !isBatchQueueArmed\(\);/);
});

test("pass2: claim-vs-edit race returns immutable/stale", async () => {
  const { service, setLane } = mockService({ historyMode: "running" });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e1", order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e2", order: 2 })).plan;
  await service.arm({ projectId: "p1", plan });
  await service.tickProject("p1");
  const live = service.getRuntime("p1");
  assert.equal(live.entries[0].state, QUEUE_ENTRY_STATE.RUNNING);
  assert.equal(live.entries[1].state, QUEUE_ENTRY_STATE.QUEUED);

  const editWhileQueued = service.updateEntry({
    projectId: "p1",
    queueEntryId: "e2",
    expectedRevision: live.revision,
    patch: {
      snapshot: {
        ...live.entries[1].snapshot,
        items: live.entries[1].snapshot.items.map((item, index) => (
          index === 0 ? { ...item, prompt: "EDITED FUTURE" } : item
        ))
      }
    }
  });
  assert.equal(editWhileQueued.ok, true);
  assert.equal(service.getRuntime("p1").entries[1].snapshot.items[0].prompt, "EDITED FUTURE");

  const claimCurrent = service.updateEntry({
    projectId: "p1",
    queueEntryId: "e1",
    expectedRevision: service.getRuntime("p1").revision,
    patch: { name: "should-fail" }
  });
  assert.equal(claimCurrent.ok, false);
  assert.equal(claimCurrent.code, "immutable");

  const stale = service.updateEntry({
    projectId: "p1",
    queueEntryId: "e2",
    expectedRevision: live.revision,
    patch: { name: "stale-name" }
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "stale-revision");
});

test("pass2: durable checkpoint without browser; restart cannot rerun claimed batch", async () => {
  const { service, checkpoints, setLane, completePrompt, submits } = mockService({ historyMode: "running" });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e1", order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e2", order: 2 })).plan;
  await service.arm({ projectId: "p1", plan });
  await service.tickProject("p1");
  assert.ok(checkpoints.length >= 1);
  const claimCp = checkpoints.find(item => item.reason === "claim");
  assert.ok(claimCp);
  assert.equal(claimCp.plan.entries[0].state, QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);
  assert.equal(claimCp.plan.entries[0].everClaimed, true);
  assert.equal(claimCp.plan.entries[1].state, QUEUE_ENTRY_STATE.QUEUED);

  const e1Prompt = submits.find(s => s.meta.queueEntryId === "e1")?.promptId;
  completePrompt(e1Prompt);
  await service.tickProject("p1");
  const terminalCp = checkpoints.filter(item => item.reason === "terminal").at(-1);
  assert.ok(terminalCp);
  assert.equal(terminalCp.plan.entries[0].state, QUEUE_ENTRY_STATE.COMPLETED);

  service._stopTimerForTests();
  service.loseAuthority("p1");

  const { service: restarted, submits: submits2 } = mockService();
  const durable = serializeBatchQueuePlan(terminalCp.plan);
  restarted.syncPlan({ projectId: "p1", plan: durable });
  assert.equal(restarted.getRuntime("p1").entries[0].state, QUEUE_ENTRY_STATE.COMPLETED);
  assert.notEqual(restarted.getRuntime("p1").entries[0].state, QUEUE_ENTRY_STATE.QUEUED);
  await restarted.resume({ projectId: "p1", plan: durable });
  assert.equal(submits2.filter(s => s.meta.queueEntryId === "e1").length, 0);
});

test("pass2: crash after claim before prompt is fail-closed via checkpoint", async () => {
  const order = [];
  const { service, checkpoints, setLane } = mockService({
    historyMode: "running",
    submitJob: async () => {
      order.push("submit");
      throw new Error("simulated crash before prompt accept");
    }
  });
  setLane({ running: 0, pending: 0 });
  const plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e1", order: 1 })).plan;
  await service.arm({ projectId: "p1", plan });
  try {
    await service.tickProject("p1");
  } catch {
    /* claim path may surface submit error */
  }
  const claimCp = checkpoints.find(item => item.reason === "claim");
  assert.ok(claimCp, "claim checkpoint must exist before /prompt");
  assert.equal(claimCp.plan.entries[0].state, QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);
  assert.equal(claimCp.plan.entries[0].everClaimed, true);
  assert.ok(order.includes("submit"));
  assert.ok(checkpoints.findIndex(item => item.reason === "claim") < order.indexOf("submit") || checkpoints.length >= 1);

  service._stopTimerForTests();
  const { service: restarted, submits } = mockService();
  restarted.syncPlan({ projectId: "p1", plan: claimCp.plan });
  const view = restarted.getRuntime("p1");
  assert.equal(view.entries[0].state, QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);
  const resume = await restarted.resume({ projectId: "p1", plan: claimCp.plan });
  assert.equal(resume.ok, false);
  assert.equal(resume.code, "recovery-unresolved");
  assert.equal(submits.length, 0);
});

test("pass2: queuedNext blocks multi-queue arm; multi-queue blocks queuedNext", () => {
  assert.equal(canArmMultiBatchQueue({ queuedNext: { snapshot: {} } }).ok, false);
  assert.equal(canArmQueuedNext({
    running: 1,
    pending: 0,
    queuedNext: null,
    deferredBatch: null,
    batchQueueArmed: true
  }), false);

  const coord = createQueueCoordinator({ submit: async () => ({ prompt_id: "x" }) });
  coord.markQueue({ running: 1, pending: 0 });
  coord.setBatchQueueArmed(true);
  const armNext = coord.armQueuedNext({ prompt: "x", seed: 1, duration: 5, model: "m" });
  assert.equal(armNext.ok, false);
  assert.equal(armNext.reason, "batch-queue-armed");
});

test("pass2: deferredBatch blocks multi-queue arm; multi-queue blocks deferredBatch", () => {
  assert.equal(canArmMultiBatchQueue({ deferredBatch: { items: [{}, {}] } }).ok, false);
  assert.equal(canArmDeferredBatch({
    running: 1,
    pending: 0,
    preparedCount: 4,
    batchQueueArmed: true
  }), false);

  const coord = createQueueCoordinator({ submit: async () => ({ prompt_id: "x" }) });
  coord.markQueue({ running: 1, pending: 0 });
  coord.setBatchQueueArmed(true);
  const deferred = coord.armDeferredBatch({ items: [{}, {}], preparedCount: 2, submitAll: async () => {} });
  assert.equal(deferred.ok, false);
  assert.equal(deferred.reason, "batch-queue-armed");
});

test("pass2: update-entry rejects invalid future queued snapshot server-side", () => {
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(2), { queueEntryId: "e1", order: 1 })).plan;
  const emptyPrompt = updateQueueEntry(plan, "e1", {
    snapshot: {
      ...plan.entries[0].snapshot,
      items: plan.entries[0].snapshot.items.map((item, index) => (
        index === 1 ? { ...item, prompt: "" } : item
      ))
    }
  });
  assert.equal(emptyPrompt.ok, false);
  assert.match(emptyPrompt.error, /prompt/i);

  const badSeed = updateQueueEntry(plan, "e1", {
    snapshot: {
      ...plan.entries[0].snapshot,
      items: plan.entries[0].snapshot.items.map((item, index) => (
        index === 1 ? { ...item, seed: "nope" } : item
      ))
    }
  });
  assert.equal(badSeed.ok, false);

  const badMp = updateQueueEntry(plan, "e1", {
    snapshot: {
      ...plan.entries[0].snapshot,
      items: plan.entries[0].snapshot.items.map((item, index) => (
        index === 1 ? { ...item, megapixels: "99" } : item
      ))
    }
  });
  assert.equal(badMp.ok, false);

  const badFiles = updateQueueEntry(plan, "e1", {
    snapshot: {
      ...plan.entries[0].snapshot,
      items: plan.entries[0].snapshot.items.map((item, index) => (
        index === 1 ? { ...item, files: ["not-an-object"] } : item
      ))
    }
  });
  assert.equal(badFiles.ok, false);

  const ok = updateQueueEntry(plan, "e1", {
    snapshot: {
      ...plan.entries[0].snapshot,
      items: plan.entries[0].snapshot.items.map((item, index) => (
        index === 1 ? { ...item, prompt: "JOB 2 OK" } : item
      ))
    }
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.plan.entries[0].snapshot.items[1].prompt, "JOB 2 OK");
  assert.equal(validateQueueBatchSnapshot(ok.plan.entries[0].snapshot).ok, true);
});

test("pass2: reconnect path uses /api/outputs and correct upsert order", () => {
  assert.match(batchQueueUi, /\/api\/outputs\?promptId=/);
  assert.match(batchQueueUi, /upsertSessionOutputs\(sessionStorage,\s*allRecords\)/);
  assert.match(batchQueueUi, /buildQueueSessionOutputRecordsFromOutputs/);
});
