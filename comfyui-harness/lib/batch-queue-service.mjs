/**
 * Server-side multi-Batch queue runtime service (Issue #47).
 * In-memory execution authority — never persisted to project JSON.
 */

import { randomUUID } from "node:crypto";
import {
  BATCH_QUEUE_FAILURE_POLICY,
  QUEUE_ENTRY_STATE,
  QUEUE_OVERALL_STATE,
  cancelQueueEntry,
  isActiveQueueEntryState,
  normalizeBatchQueuePlan,
  reorderQueueEntries,
  updateQueueEntry,
  validateQueueCapacity
} from "./batch-queue-plan.mjs";
import {
  claimEntryAtomic,
  classifyAuthorityLoss,
  computeOverallState,
  decideQueueAfterEntryTerminal,
  entryBatchTerminalFromJobs,
  isLaneSafe,
  mergeRuntimePublicView,
  selectNextQueuedEntry
} from "./batch-queue-runtime.mjs";
import {
  allJobsTerminal,
  applyActivePrompt,
  applyHistoryStates,
  executeEntryJobs,
  initEntryRuntimeJobs
} from "./batch-queue-executor.mjs";

const TICK_MS = 3000;

export function createBatchQueueRuntimeService({
  submitJob,
  fetchQueueCounts,
  fetchHistoryState,
  fetchActivePromptId,
  registerOwnership,
  logger = null,
  now = () => Date.now()
} = {}) {
  if (typeof submitJob !== "function") throw new Error("submitJob required");
  if (typeof fetchQueueCounts !== "function") throw new Error("fetchQueueCounts required");

  /** @type {Map<string, object>} */
  const byProject = new Map();
  let tickTimer = null;
  let armInFlight = new Set();

  function log(event, fields = {}) {
    logger?.info?.(event, fields);
  }

  function getBucket(projectId) {
    const id = String(projectId || "").trim();
    if (!id) return null;
    if (!byProject.has(id)) {
      byProject.set(id, { plan: null, runtime: null });
    }
    return byProject.get(id);
  }

  function publicView(projectId) {
    const bucket = getBucket(projectId);
    if (!bucket) return mergeRuntimePublicView({ plan: null, runtime: null });
    return mergeRuntimePublicView({ plan: bucket.plan, runtime: bucket.runtime });
  }

  function syncEntryStatesFromRuntime(bucket) {
    if (!bucket?.runtime?.entryJobs) return;
    const entryId = bucket.runtime.currentEntryId;
    if (!entryId || !bucket.plan) return;
    const entryIndex = bucket.plan.entries.findIndex(entry => entry.queueEntryId === entryId);
    if (entryIndex < 0) return;
    const entry = bucket.plan.entries[entryIndex];
    if (entry.state === QUEUE_ENTRY_STATE.RUNNING || entry.state === QUEUE_ENTRY_STATE.SUBMITTING) {
      bucket.runtime.entryStates = bucket.runtime.entryStates || {};
      bucket.runtime.entryStates[entryId] = bucket.runtime.entryJobs;
    }
  }

  async function pollCurrentEntry(bucket) {
    const runtime = bucket.runtime;
    if (!runtime?.currentEntryId || !runtime.entryJobs?.length) return false;
    const historyByPromptId = {};
    for (const job of runtime.entryJobs) {
      if (!job.promptId) continue;
      historyByPromptId[job.promptId] = await fetchHistoryState?.(job.promptId) || "running";
    }
    const activePromptId = await fetchActivePromptId?.() || null;
    let jobs = applyHistoryStates(runtime.entryJobs, historyByPromptId);
    jobs = applyActivePrompt(jobs, activePromptId);
    runtime.entryJobs = jobs;
  }

  async function finalizeCurrentEntry(bucket, { pauseRequested = false } = {}) {
    const runtime = bucket.runtime;
    if (!runtime?.currentEntryId) return;
    const entryId = runtime.currentEntryId;
    const entryIndex = bucket.plan.entries.findIndex(entry => entry.queueEntryId === entryId);
    if (entryIndex < 0) return;
    const jobs = runtime.entryJobs || [];
    const entryState = entryBatchTerminalFromJobs(jobs);
    bucket.plan.entries[entryIndex] = { ...bucket.plan.entries[entryIndex], state: entryState };
    runtime.currentEntryId = null;
    runtime.currentBatchId = null;
    runtime.currentJobIndex = null;
    runtime.entryJobs = null;
    runtime.overallState = decideQueueAfterEntryTerminal({
      failurePolicy: bucket.plan.failurePolicy,
      entryState,
      pauseRequested
    });
    log("batch_queue_entry_terminal", { entry_id: entryId.slice(0, 8), state: entryState });
  }

  async function startNextEntry(bucket) {
    const counts = await fetchQueueCounts();
    if (!isLaneSafe(counts)) {
      bucket.runtime.overallState = QUEUE_OVERALL_STATE.WAITING;
      return;
    }
    const next = selectNextQueuedEntry(bucket.plan.entries);
    if (!next) {
      bucket.runtime.overallState = QUEUE_OVERALL_STATE.COMPLETED;
      bucket.runtime.armed = false;
      return;
    }
    const claim = claimEntryAtomic(next);
    if (!claim.ok) return;
    const entryIndex = bucket.plan.entries.findIndex(entry => entry.queueEntryId === next.queueEntryId);
    bucket.plan.entries[entryIndex] = claim.entry;
    const batchId = randomUUID();
    const jobs = initEntryRuntimeJobs(claim.entry);
    bucket.runtime.currentEntryId = next.queueEntryId;
    bucket.runtime.currentBatchId = batchId;
    bucket.runtime.currentJobIndex = 0;
    bucket.runtime.entryJobs = jobs;
    bucket.runtime.overallState = QUEUE_OVERALL_STATE.RUNNING;
    log("batch_queue_entry_claim", { entry_id: next.queueEntryId.slice(0, 8), batch_id: batchId.slice(0, 8) });

    const { jobs: submittedJobs } = await executeEntryJobs({
      entry: claim.entry,
      jobs,
      submittedMap: bucket.runtime.submittedMap,
      batchId,
      queueRunId: bucket.runtime.queueRunId,
      queueEntryId: next.queueEntryId,
      submit: async ctx => {
        const payload = buildQueuePayload(ctx);
        const result = await submitJob(payload, {
          batchId: ctx.batchId,
          batchIndex: ctx.index,
          queueRunId: ctx.queueRunId,
          queueEntryId: ctx.queueEntryId,
          queueJobId: ctx.queueJobId
        });
        registerOwnership?.({
          promptId: result.prompt_id,
          batchId: ctx.batchId,
          batchIndex: ctx.index,
          queueRunId: ctx.queueRunId,
          queueEntryId: ctx.queueEntryId,
          queueJobId: ctx.queueJobId
        });
        return result;
      }
    });
    bucket.runtime.entryJobs = submittedJobs;
    bucket.plan.entries[entryIndex] = { ...bucket.plan.entries[entryIndex], state: QUEUE_ENTRY_STATE.RUNNING };
  }

  async function tickProject(projectId) {
    const bucket = getBucket(projectId);
    if (!bucket?.runtime?.armed || !bucket.runtime.queueRunId) return;
    if (bucket.runtime.tickInFlight) return;
    bucket.runtime.tickInFlight = true;
    try {
      if (bucket.runtime.overallState === QUEUE_OVERALL_STATE.PAUSED
        || bucket.runtime.overallState === QUEUE_OVERALL_STATE.PAUSED_FAILURE
        || bucket.runtime.overallState === QUEUE_OVERALL_STATE.RECOVERY_REQUIRED) {
        return;
      }
      if (bucket.runtime.currentEntryId) {
        await pollCurrentEntry(bucket);
        if (allJobsTerminal(bucket.runtime.entryJobs)) {
          await finalizeCurrentEntry(bucket, { pauseRequested: bucket.runtime.pauseRequested });
          bucket.runtime.pauseRequested = false;
        }
      }
      if (!bucket.runtime.currentEntryId && bucket.runtime.armed) {
        await startNextEntry(bucket);
      }
      syncEntryStatesFromRuntime(bucket);
    } finally {
      bucket.runtime.tickInFlight = false;
    }
  }

  async function tickAll() {
    for (const projectId of byProject.keys()) {
      await tickProject(projectId);
    }
  }

  function ensureTickTimer() {
    if (tickTimer) return;
    tickTimer = setInterval(() => { void tickAll(); }, TICK_MS);
    if (tickTimer.unref) tickTimer.unref();
  }

  return {
    syncPlan({ projectId, plan }) {
      const bucket = getBucket(projectId);
      const normalized = normalizeBatchQueuePlan(plan);
      const capacity = normalized ? validateQueueCapacity(normalized.entries) : { ok: true };
      if (!capacity.ok) return capacity;
      if (bucket.runtime?.queueRunId) {
        bucket.plan = normalized;
        return { ok: true, view: publicView(projectId) };
      }
      if (normalized) {
        bucket.plan = {
          ...normalized,
          entries: normalized.entries.map(entry => (
            entry.state === QUEUE_ENTRY_STATE.SUBMITTING || entry.state === QUEUE_ENTRY_STATE.RUNNING
              ? { ...entry, state: QUEUE_ENTRY_STATE.RECOVERY_REQUIRED }
              : entry
          ))
        };
      } else {
        bucket.plan = null;
      }
      return { ok: true, view: publicView(projectId) };
    },

    getRuntime(projectId) {
      return publicView(projectId);
    },

    async arm({ projectId, plan, failurePolicy = BATCH_QUEUE_FAILURE_POLICY.STOP }) {
      const existing = getBucket(projectId);
      if (existing?.runtime?.queueRunId && existing.runtime.armed) {
        return { ok: true, status: "already-armed", view: publicView(projectId) };
      }
      if (armInFlight.has(projectId)) {
        return { ok: true, status: "already-arming", view: publicView(projectId) };
      }
      const normalized = normalizeBatchQueuePlan(plan);
      if (!normalized?.entries?.length) {
        return { ok: false, code: "empty-queue", error: "Nessun batch in coda." };
      }
      const capacity = validateQueueCapacity(normalized.entries);
      if (!capacity.ok) return capacity;
      const hasExecutable = normalized.entries.some(entry => entry.state === QUEUE_ENTRY_STATE.QUEUED);
      if (!hasExecutable) {
        return { ok: false, code: "nothing-to-run", error: "Nessun batch eseguibile in coda." };
      }
      armInFlight.add(projectId);
      try {
        const bucket = getBucket(projectId);
        bucket.plan = {
          ...normalized,
          failurePolicy: failurePolicy === BATCH_QUEUE_FAILURE_POLICY.CONTINUE
            ? BATCH_QUEUE_FAILURE_POLICY.CONTINUE
            : BATCH_QUEUE_FAILURE_POLICY.STOP
        };
        bucket.runtime = {
          queueRunId: randomUUID(),
          projectId,
          armed: true,
          overallState: QUEUE_OVERALL_STATE.ARMED,
          currentEntryId: null,
          currentBatchId: null,
          currentJobIndex: null,
          entryJobs: null,
          submittedMap: new Map(),
          pauseRequested: false,
          tickInFlight: false,
          startedAt: now()
        };
        ensureTickTimer();
        log("batch_queue_armed", { project_id: String(projectId).slice(0, 8) });
        await tickProject(projectId);
        return { ok: true, view: publicView(projectId) };
      } finally {
        armInFlight.delete(projectId);
      }
    },

    async resume({ projectId, plan }) {
      const bucket = getBucket(projectId);
      if (bucket.runtime?.queueRunId && bucket.runtime.armed) {
        return { ok: true, status: "already-armed", view: publicView(projectId) };
      }
      const normalized = normalizeBatchQueuePlan(plan);
      const resetEntries = (normalized?.entries || []).map(entry => (
        entry.state === QUEUE_ENTRY_STATE.RECOVERY_REQUIRED
          ? { ...entry, state: QUEUE_ENTRY_STATE.QUEUED }
          : entry
      ));
      return this.arm({
        projectId,
        plan: normalized ? { ...normalized, entries: resetEntries } : plan,
        failurePolicy: normalized?.failurePolicy
      });
    },

    updateEntry({ projectId, queueEntryId, patch, expectedRevision }) {
      const bucket = getBucket(projectId);
      if (!bucket?.plan) return { ok: false, code: "no-plan", error: "Coda non presente." };
      if (bucket.runtime?.currentEntryId === queueEntryId) {
        return { ok: false, code: "immutable", error: "Batch in esecuzione." };
      }
      if (Number(expectedRevision) !== Number(bucket.plan.revision)) {
        return { ok: false, code: "stale-revision", error: "Revisione coda non aggiornata." };
      }
      const result = updateQueueEntry(bucket.plan, queueEntryId, patch);
      if (!result.ok) return result;
      bucket.plan = result.plan;
      return { ok: true, view: publicView(projectId) };
    },

    reorder({ projectId, fromIndex, toIndex, expectedRevision }) {
      const bucket = getBucket(projectId);
      if (!bucket?.plan) return { ok: false, code: "no-plan", error: "Coda non presente." };
      if (Number(expectedRevision) !== Number(bucket.plan.revision)) {
        return { ok: false, code: "stale-revision", error: "Revisione coda non aggiornata." };
      }
      const result = reorderQueueEntries(bucket.plan.entries, fromIndex, toIndex);
      if (!result.ok) return result;
      bucket.plan = { ...bucket.plan, revision: bucket.plan.revision + 1, entries: result.entries };
      return { ok: true, view: publicView(projectId) };
    },

    cancelEntry({ projectId, queueEntryId, expectedRevision }) {
      const bucket = getBucket(projectId);
      if (!bucket?.plan) return { ok: false, code: "no-plan", error: "Coda non presente." };
      if (bucket.runtime?.currentEntryId === queueEntryId) {
        return { ok: false, code: "immutable", error: "Batch in esecuzione." };
      }
      if (Number(expectedRevision) !== Number(bucket.plan.revision)) {
        return { ok: false, code: "stale-revision", error: "Revisione coda non aggiornata." };
      }
      const result = cancelQueueEntry(bucket.plan, queueEntryId);
      if (!result.ok) return result;
      bucket.plan = result.plan;
      return { ok: true, view: publicView(projectId) };
    },

    pauseQueue({ projectId, reason = "user" }) {
      const bucket = getBucket(projectId);
      if (!bucket?.runtime) return { ok: false, code: "not-armed", error: "Coda non armata." };
      bucket.runtime.overallState = QUEUE_OVERALL_STATE.PAUSED;
      bucket.runtime.pauseRequested = true;
      log("batch_queue_paused", { project_id: String(projectId).slice(0, 8), reason });
      return { ok: true, view: publicView(projectId) };
    },

    onFullBatchStop(projectId) {
      return this.pauseQueue({ projectId, reason: "full-batch-stop" });
    },

    loseAuthority(projectId) {
      const bucket = getBucket(projectId);
      if (!bucket) return;
      if (bucket.plan) {
        bucket.plan.entries = classifyAuthorityLoss(bucket.plan.entries);
      }
      bucket.runtime = null;
    },

    isQueueArmed(projectId) {
      const bucket = getBucket(projectId);
      return Boolean(bucket?.runtime?.armed && bucket?.runtime?.queueRunId);
    },

    tickProject,
    _stopTimerForTests() {
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

function buildQueuePayload(ctx) {
  const { item, snapshot } = ctx;
  const source = snapshot.source || {};
  return {
    clientId: `queue-${ctx.queueRunId}`,
    workflowId: source.workflowId,
    prompt: String(item.prompt || "").trim(),
    megapixels: Number(item.megapixels),
    model: source.model,
    steps: Number(item.steps),
    duration: Number(item.duration),
    aspect: item.aspect,
    seed: Number(item.seed),
    sharedFiles: source.files || {},
    files: item.files || {}
  };
}
