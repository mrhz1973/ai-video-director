import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_BATCH_QUEUE_ENTRIES,
  BATCH_QUEUE_FAILURE_POLICY,
  QUEUE_ENTRY_STATE,
  QUEUE_OVERALL_STATE,
  appendQueueEntry,
  assertNoQueuePlanAuthority,
  cancelQueueEntry,
  countActiveQueueEntries,
  createQueueEntryFromDraft,
  createQueueJobId,
  deepCloneBatchSnapshot,
  defaultQueueEntryName,
  isActiveQueueEntryState,
  normalizeBatchQueuePlan,
  reorderQueueEntries,
  serializeBatchQueuePlan,
  summarizeQueuePlan,
  updateQueueEntry,
  validateQueueCapacity
} from "../lib/batch-queue-plan.mjs";
import {
  claimEntryAtomic,
  classifyAuthorityLoss,
  decideQueueAfterEntryTerminal,
  entryBatchTerminalFromJobs,
  isLaneSafe,
  mergeRuntimePublicView,
  queuePrecedenceAllowsQueuedNext,
  selectNextQueuedEntry,
  shouldBlockImmediateBatch,
  shouldBlockSingleRender
} from "../lib/batch-queue-runtime.mjs";
import { allJobsTerminal, executeEntryJobs, initEntryRuntimeJobs } from "../lib/batch-queue-executor.mjs";
import { createBatchQueueRuntimeService } from "../lib/batch-queue-service.mjs";
import { buildDuplicateProjectPayload } from "../lib/project-duplicate.mjs";
import { normalizeProject } from "../lib/projects.mjs";
import { resolveBatchQueueAction, resolveGenerateAction } from "../public/queue-coordinator.mjs";
import { serializeBatchDraft } from "../lib/batch-draft.mjs";

const batchUi = readFileSync(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");
const batchQueueUi = readFileSync(new URL("../public/batch-queue-ui.mjs", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

const sampleSource = {
  workflowId: "minimax-h3-i2v",
  workflowLabel: "I2V",
  model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
  files: { firstImage: "frame.png" },
  requiredKeys: ["firstImage"],
  base: {
    prompt: "base",
    seed: "1",
    duration: "10",
    steps: "20",
    megapixels: "0.7",
    aspect: "16:9"
  }
};

function sampleDraft(jobCount = 2) {
  return serializeBatchDraft({
    source: sampleSource,
    items: Array.from({ length: jobCount }, (_, i) => ({
      prompt: `PROMPT ${i + 1}`,
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
  let historyMode = overrides.historyMode || "instant-complete";
  const service = createBatchQueueRuntimeService({
    submitJob: async (input, meta) => {
      submits.push({ input, meta });
      return { prompt_id: `pid-${meta.queueJobId}` };
    },
    fetchQueueCounts: async () => lane,
    fetchHistoryState: async promptId => {
      if (typeof overrides.fetchHistoryState === "function") {
        return overrides.fetchHistoryState(promptId);
      }
      if (historyMode === "running") return "running";
      if (promptId.startsWith("pid-")) return "completed";
      return "running";
    },
    fetchActivePromptId: async () => null,
    registerOwnership: () => {},
    ...overrides
  });
  return {
    service,
    submits,
    setLane(next) { lane = next; },
    setHistoryMode(mode) { historyMode = mode; }
  };
}

test("empty queue plan is null", () => {
  assert.equal(normalizeBatchQueuePlan(null), null);
  assert.equal(normalizeBatchQueuePlan({ entries: [] }), null);
});

test("add prepared Batch creates deep-cloned independent snapshot", () => {
  const draft = sampleDraft(2);
  const entry = createQueueEntryFromDraft(draft, { order: 1 });
  draft.items[0].prompt = "MUTATED";
  assert.equal(entry.snapshot.items[0].prompt, "PROMPT 1");
  assert.notEqual(entry.snapshot, draft);
});

test("stable queueEntryId and queueJobId", () => {
  const entry = createQueueEntryFromDraft(sampleDraft(1), {
    queueEntryId: "entry-abc",
    order: 1
  });
  assert.equal(entry.queueEntryId, "entry-abc");
  assert.equal(entry.snapshot.items[0].queueJobId, createQueueJobId("entry-abc", 0));
});

test("append preserves prompts seeds durations mp aspect steps files order", () => {
  const draft = sampleDraft(3);
  draft.items[1].files = { firstImage: "override.png" };
  const entry = createQueueEntryFromDraft(draft, { order: 1 });
  assert.equal(entry.snapshot.items[1].prompt, "PROMPT 2");
  assert.equal(entry.snapshot.items[1].seed, "2");
  assert.equal(entry.snapshot.items[1].duration, "10");
  assert.equal(entry.snapshot.items[1].megapixels, "0.7");
  assert.equal(entry.snapshot.items[1].aspect, "16:9");
  assert.equal(entry.snapshot.items[1].steps, "20");
  assert.equal(entry.snapshot.items[1].files.firstImage, "override.png");
  assert.equal(entry.snapshot.source.files.firstImage, "frame.png");
});

test("editor changes do not mutate queued snapshot via deep clone", () => {
  const draft = sampleDraft(1);
  const cloned = deepCloneBatchSnapshot(draft);
  draft.items[0].prompt = "NEW";
  assert.equal(cloned.items[0].prompt, "PROMPT 1");
});

test("capacity accepts 50 active entries", () => {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    queueEntryId: `e-${i}`,
    state: QUEUE_ENTRY_STATE.QUEUED,
    snapshot: { items: [{ prompt: "x" }] }
  }));
  const result = validateQueueCapacity(entries);
  assert.equal(result.ok, true);
  assert.equal(result.active, 50);
});

test("51st active entry rejected without truncation", () => {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    queueEntryId: `e-${i}`,
    state: QUEUE_ENTRY_STATE.QUEUED
  }));
  const cap = validateQueueCapacity(entries, { adding: 1 });
  assert.equal(cap.ok, false);
  assert.match(cap.error, /50/);
});

test("append rejects over capacity", () => {
  const entries = Array.from({ length: MAX_BATCH_QUEUE_ENTRIES }, (_, i) =>
    createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: `e-${i}`, order: i + 1 })
  );
  const plan = { version: 1, failurePolicy: "stop", revision: 0, entries };
  const next = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { order: 51 }));
  assert.equal(next.ok, false);
});

test("append order deterministic", () => {
  let plan = null;
  for (let i = 0; i < 3; i += 1) {
    const entry = createQueueEntryFromDraft(sampleDraft(1), { order: i + 1 });
    const result = appendQueueEntry(plan, entry);
    assert.equal(result.ok, true);
    plan = result.plan;
  }
  assert.deepEqual(plan.entries.map(e => e.order), [1, 2, 3]);
});

test("future entries can reorder running entry cannot", () => {
  const entries = [
    { queueEntryId: "a", order: 1, state: QUEUE_ENTRY_STATE.RUNNING, snapshot: { items: [] } },
    { queueEntryId: "b", order: 2, state: QUEUE_ENTRY_STATE.QUEUED, snapshot: { items: [] } },
    { queueEntryId: "c", order: 3, state: QUEUE_ENTRY_STATE.QUEUED, snapshot: { items: [] } }
  ];
  assert.equal(reorderQueueEntries(entries, 2, 1).ok, true);
  assert.equal(reorderQueueEntries(entries, 0, 2).ok, false);
});

test("claimed entry cannot reorder", () => {
  const entries = [
    { queueEntryId: "a", order: 1, state: QUEUE_ENTRY_STATE.SUBMITTING, snapshot: { items: [] } },
    { queueEntryId: "b", order: 2, state: QUEUE_ENTRY_STATE.QUEUED, snapshot: { items: [] } }
  ];
  assert.equal(reorderQueueEntries(entries, 1, 0).ok, false);
});

test("server revision prevents stale reorder", () => {
  const { service } = mockService();
  const entry = createQueueEntryFromDraft(sampleDraft(1), { order: 1 });
  let plan = appendQueueEntry(null, entry).plan;
  service.syncPlan({ projectId: "p1", plan });
  const stale = service.reorder({ projectId: "p1", fromIndex: 0, toIndex: 0, expectedRevision: 0 });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "stale-revision");
});

test("queued future entry editable running immutable", () => {
  const entry = createQueueEntryFromDraft(sampleDraft(1), { order: 1 });
  let plan = appendQueueEntry(null, entry).plan;
  const ok = updateQueueEntry(plan, plan.entries[0].queueEntryId, { name: "SCENA 01" });
  assert.equal(ok.ok, true);
  plan = ok.plan;
  plan.entries[0].state = QUEUE_ENTRY_STATE.RUNNING;
  const blocked = updateQueueEntry(plan, plan.entries[0].queueEntryId, { name: "X" });
  assert.equal(blocked.ok, false);
});

test("server rejects edit after claim via runtime currentEntryId", async () => {
  const { service } = mockService({ historyMode: "running" });
  const entry = createQueueEntryFromDraft(sampleDraft(1), { order: 1 });
  const plan = appendQueueEntry(null, entry).plan;
  service.syncPlan({ projectId: "p1", plan });
  await service.arm({ projectId: "p1", plan });
  await service.tickProject("p1");
  const view = service.getRuntime("p1");
  const blocked = service.updateEntry({
    projectId: "p1",
    queueEntryId: view.currentEntryId || plan.entries[0].queueEntryId,
    patch: { name: "X" },
    expectedRevision: plan.revision
  });
  assert.equal(blocked.ok, false);
});

test("future queued entry can be cancelled", () => {
  const entry = createQueueEntryFromDraft(sampleDraft(1), { order: 1 });
  const plan = appendQueueEntry(null, entry).plan;
  const result = cancelQueueEntry(plan, plan.entries[0].queueEntryId);
  assert.equal(result.ok, true);
  assert.equal(result.plan.entries[0].state, QUEUE_ENTRY_STATE.CANCELLED);
});

test("empty queue cannot arm", async () => {
  const { service } = mockService();
  const result = await service.arm({ projectId: "p1", plan: null });
  assert.equal(result.ok, false);
  assert.equal(result.code, "empty-queue");
});

test("repeated arm is idempotent", async () => {
  const { service } = mockService();
  const entry = createQueueEntryFromDraft(sampleDraft(1), { order: 1 });
  const plan = appendQueueEntry(null, entry).plan;
  const first = await service.arm({ projectId: "p1", plan });
  assert.equal(first.ok, true);
  const second = await service.arm({ projectId: "p1", plan });
  assert.equal(second.status, "already-armed");
});

test("busy ComfyUI causes waiting not interference", async () => {
  const { service, setLane } = mockService();
  setLane({ running: 1, pending: 0 });
  const entry = createQueueEntryFromDraft(sampleDraft(1), { order: 1 });
  const plan = appendQueueEntry(null, entry).plan;
  await service.arm({ projectId: "p1", plan });
  const view = service.getRuntime("p1");
  assert.equal(view.overallState, QUEUE_OVERALL_STATE.WAITING);
});

test("only first batch submitted initially", async () => {
  const { service, submits, setLane } = mockService({ historyMode: "running" });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { order: 2 })).plan;
  await service.arm({ projectId: "p1", plan });
  await service.tickProject("p1");
  assert.equal(submits.length, 1);
});

test("batch 2 begins after batch 1 terminal", async () => {
  const { service, submits, setLane, setHistoryMode } = mockService({ historyMode: "running" });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(2), { order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { order: 2 })).plan;
  await service.arm({ projectId: "p1", plan });
  await service.tickProject("p1");
  assert.equal(submits.length, 2);
  setHistoryMode("instant-complete");
  await service.tickProject("p1");
  assert.equal(submits.length, 3);
});

test("no cross-batch job flattening — one batchId per entry", async () => {
  const { service, submits, setLane } = mockService({ historyMode: "running" });
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(2), { order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(2), { order: 2 })).plan;
  await service.arm({ projectId: "p1", plan });
  await service.tickProject("p1");
  const batchIds = new Set(submits.map(s => s.meta.batchId));
  assert.equal(batchIds.size, 1);
});

test("loseAuthority marks recovery-required fail closed", () => {
  const entries = [
    { queueEntryId: "a", state: QUEUE_ENTRY_STATE.RUNNING },
    { queueEntryId: "b", state: QUEUE_ENTRY_STATE.QUEUED }
  ];
  const next = classifyAuthorityLoss(entries);
  assert.equal(next[0].state, QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);
  assert.equal(next[1].state, QUEUE_ENTRY_STATE.QUEUED);
});

test("syncPlan without runtime marks submitting/running as recovery-required", () => {
  const { service } = mockService();
  const plan = {
    version: 1,
    failurePolicy: "stop",
    revision: 1,
    entries: [{
      queueEntryId: "a",
      name: "Batch 01",
      order: 1,
      state: QUEUE_ENTRY_STATE.RUNNING,
      snapshot: sampleDraft(1)
    }]
  };
  service.syncPlan({ projectId: "p1", plan });
  const view = service.getRuntime("p1");
  assert.equal(view.entries[0].state, QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);
  assert.equal(view.authorityPresent, false);
});

test("idempotency map prevents duplicate queueJobId submission", async () => {
  const submits = new Map();
  const jobs = initEntryRuntimeJobs(createQueueEntryFromDraft(sampleDraft(2), { queueEntryId: "e1", order: 1 }));
  const submittedMap = new Map();
  await executeEntryJobs({
    entry: createQueueEntryFromDraft(sampleDraft(2), { queueEntryId: "e1", order: 1 }),
    jobs,
    submittedMap,
    batchId: "b1",
    queueRunId: "run1",
    queueEntryId: "e1",
    submit: async ctx => {
      if (submits.has(ctx.queueJobId)) return { prompt_id: submits.get(ctx.queueJobId) };
      submits.set(ctx.queueJobId, `pid-${ctx.index}`);
      return { prompt_id: `pid-${ctx.index}` };
    }
  });
  assert.equal(submits.size, 2);
  submittedMap.set(jobs[0].queueJobId, "pid-0");
  const again = await executeEntryJobs({
    entry: createQueueEntryFromDraft(sampleDraft(2), { queueEntryId: "e1", order: 1 }),
    jobs,
    submittedMap,
    batchId: "b1",
    queueRunId: "run1",
    queueEntryId: "e1",
    submit: async ctx => ({ prompt_id: submittedMap.get(ctx.queueJobId) })
  });
  assert.equal(submits.size, 2);
  assert.equal(again.jobs[0].promptId, "pid-0");
});

test("default failure policy stop", () => {
  const plan = normalizeBatchQueuePlan({ entries: [createQueueEntryFromDraft(sampleDraft(1), { order: 1 })] });
  assert.equal(plan.failurePolicy, BATCH_QUEUE_FAILURE_POLICY.STOP);
});

test("stop policy pauses after failed batch", () => {
  const state = decideQueueAfterEntryTerminal({
    failurePolicy: BATCH_QUEUE_FAILURE_POLICY.STOP,
    entryState: QUEUE_ENTRY_STATE.FAILED
  });
  assert.equal(state, QUEUE_OVERALL_STATE.PAUSED_FAILURE);
});

test("continue policy waits for next batch", () => {
  const state = decideQueueAfterEntryTerminal({
    failurePolicy: BATCH_QUEUE_FAILURE_POLICY.CONTINUE,
    entryState: QUEUE_ENTRY_STATE.FAILED
  });
  assert.equal(state, QUEUE_OVERALL_STATE.WAITING);
});

test("intentional interrupt may still complete batch entry", () => {
  const state = entryBatchTerminalFromJobs([
    { state: "completed" },
    { state: "interrupted" }
  ]);
  assert.equal(state, QUEUE_ENTRY_STATE.COMPLETED);
});

test("full batch stop pauses queue", async () => {
  const { service } = mockService();
  const plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  await service.arm({ projectId: "p1", plan });
  await service.onFullBatchStop("p1");
  assert.equal(service.getRuntime("p1").overallState, QUEUE_OVERALL_STATE.PAUSED);
});

test("batch queue armed blocks Genera singolo and Avvia batch", () => {
  const single = resolveGenerateAction({ batchQueueArmed: true });
  assert.equal(single.action, "blocked");
  assert.match(single.reason, /Coda Batch attiva/);
  const batch = resolveBatchQueueAction({ batchQueueArmed: true, preparedCount: 4 });
  assert.equal(batch.action, "blocked");
});

test("queued-next Single precedence when queue armed without prior queued-next", () => {
  assert.equal(queuePrecedenceAllowsQueuedNext({ queuedNextArmed: false, queueArmed: true }), true);
  assert.equal(queuePrecedenceAllowsQueuedNext({ queuedNextArmed: true, queueArmed: true }), false);
});

test("shouldBlockSingleRender and shouldBlockImmediateBatch", () => {
  assert.equal(shouldBlockSingleRender({ queueArmed: true }), true);
  assert.equal(shouldBlockImmediateBatch({ queueArmed: true }), true);
});

test("project save persists queue plan without authority", () => {
  const entry = createQueueEntryFromDraft(sampleDraft(2), { order: 1 });
  const plan = appendQueueEntry(null, entry).plan;
  const serialized = serializeBatchQueuePlan(plan);
  assertNoQueuePlanAuthority(serialized);
  assert.equal(serialized.entries.length, 1);
});

test("v0.12 project without batchQueue loads", () => {
  const project = normalizeProject({
    id: "demo",
    label: "Demo",
    workflowId: "minimax-h3-i2v",
    prompt: "x",
    settings: {},
    library: { elements: [], locations: [], objects: [], audio: [] },
    files: {}
  });
  assert.equal(project.batchQueue, null);
});

test("Save As copies plan but no runtime authority", () => {
  const entry = createQueueEntryFromDraft(sampleDraft(1), { order: 1 });
  const plan = appendQueueEntry(null, entry).plan;
  const payload = buildDuplicateProjectPayload({
    label: "Src",
    workflowId: "minimax-h3-i2v",
    prompt: "p",
    settings: { model: sampleSource.model },
    library: { elements: [], locations: [], objects: [], audio: [] },
    files: {},
    batchQueue: plan
  }, { newLabel: "Copy" });
  assert.ok(payload.batchQueue);
  assertNoQueuePlanAuthority(payload.batchQueue);
  assert.throws(() => assertNoQueuePlanAuthority({ ...payload.batchQueue, queueRunId: "x" }));
});

test("summary counts completed and remaining jobs", () => {
  const entries = [
    { state: QUEUE_ENTRY_STATE.COMPLETED, snapshot: { items: [{}, {}] } },
    { state: QUEUE_ENTRY_STATE.QUEUED, snapshot: { items: [{}, {}, {}] } }
  ];
  const summary = summarizeQueuePlan(entries);
  assert.equal(summary.completedBatches, 1);
  assert.equal(summary.remainingJobs, 3);
});

test("lane safe requires empty Comfy queue", () => {
  assert.equal(isLaneSafe({ running: 0, pending: 0 }), true);
  assert.equal(isLaneSafe({ running: 1, pending: 0 }), false);
});

test("atomic claim transitions queued to submitting", () => {
  const entry = { queueEntryId: "a", state: QUEUE_ENTRY_STATE.QUEUED };
  const claim = claimEntryAtomic(entry);
  assert.equal(claim.ok, true);
  assert.equal(claim.entry.state, QUEUE_ENTRY_STATE.SUBMITTING);
});

test("race: future edit vs claim uses revision on server", async () => {
  const { service } = mockService();
  const plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  service.syncPlan({ projectId: "p1", plan });
  const edit = service.updateEntry({
    projectId: "p1",
    queueEntryId: plan.entries[0].queueEntryId,
    patch: { name: "Edited" },
    expectedRevision: plan.revision + 99
  });
  assert.equal(edit.ok, false);
});

test("race: director runtime loss prevents batch 2 auto submit", async () => {
  const { service, setLane } = mockService();
  setLane({ running: 0, pending: 0 });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { order: 2 })).plan;
  await service.arm({ projectId: "p1", plan });
  await service.tickProject("p1");
  service.loseAuthority("p1");
  await service.tickProject("p1");
  const view = service.getRuntime("p1");
  assert.equal(view.authorityPresent, false);
});

test("UI wiring exposes CODA BATCH and Aggiungi alla coda", () => {
  assert.match(batchQueueUi, /CODA BATCH/);
  assert.match(batchQueueUi, /AVVIA CODA/);
  assert.match(batchQueueUi, /RIPRENDI CODA/);
  assert.match(batchUi, /batchAddToQueue/);
  assert.match(batchUi, /Aggiungi alla coda/);
  assert.match(app, /exportBatchQueueForPersistence/);
  assert.match(batchQueueUi, /\/api\/batch-queue\/arm/);
});

test("all jobs terminal helper", () => {
  assert.equal(allJobsTerminal([{ state: "completed" }, { state: "interrupted" }]), true);
  assert.equal(allJobsTerminal([{ state: "running" }]), false);
});

test("mergeRuntimePublicView exposes recovery message", () => {
  const view = mergeRuntimePublicView({
    plan: { revision: 1, failurePolicy: "stop", entries: [] },
    runtime: { overallState: QUEUE_OVERALL_STATE.RECOVERY_REQUIRED, armed: false }
  });
  assert.match(view.recoveryMessage, /riattivata/);
});

test("selectNextQueuedEntry respects order", () => {
  const next = selectNextQueuedEntry([
    { order: 2, state: QUEUE_ENTRY_STATE.QUEUED, queueEntryId: "b" },
    { order: 1, state: QUEUE_ENTRY_STATE.QUEUED, queueEntryId: "a" }
  ]);
  assert.equal(next.queueEntryId, "a");
});

test("default queue entry names", () => {
  assert.equal(defaultQueueEntryName(1), "Batch 01");
  assert.equal(defaultQueueEntryName(12), "Batch 12");
});

test("countActiveQueueEntries excludes terminal states", () => {
  const entries = [
    { state: QUEUE_ENTRY_STATE.QUEUED },
    { state: QUEUE_ENTRY_STATE.COMPLETED },
    { state: QUEUE_ENTRY_STATE.RUNNING }
  ];
  assert.equal(countActiveQueueEntries(entries), 2);
  assert.equal(isActiveQueueEntryState(QUEUE_ENTRY_STATE.QUEUED), true);
});
