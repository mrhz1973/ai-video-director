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
  validateQueueCapacity,
  serializeBatchQueuePlan
} from "./batch-queue-plan.mjs";
import {
  claimEntryAtomic,
  classifyAuthorityLoss,
  computeOverallState,
  decideQueueAfterEntryTerminal,
  entryBatchTerminalFromJobs,
  isLaneSafe,
  mergeRuntimePublicView,
  resolveCurrentJobIndex,
  selectNextQueuedEntry
} from "./batch-queue-runtime.mjs";
import {
  allJobsTerminal,
  applyActivePrompt,
  applyHistoryStates,
  executeEntryJobs,
  initEntryRuntimeJobs
} from "./batch-queue-executor.mjs";
import {
  mergeIncomingPlanWithRuntime,
  resolveRecoveryEntryInPlan
} from "./batch-queue-reconcile.mjs";

const TICK_MS = 3000;

export function createBatchQueueRuntimeService({
  submitJob,
  fetchQueueCounts,
  fetchHistoryState,
  fetchActivePromptId,
  registerOwnership,
  persistDescriptivePlan = null,
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

  async function checkpointDescriptivePlan(bucket, reason = "") {
    if (typeof persistDescriptivePlan !== "function" || !bucket?.plan) return;
    const projectId = bucket.runtime?.projectId || bucket.projectId;
    if (!projectId) return;
    const plan = serializeBatchQueuePlan(bucket.plan);
    await persistDescriptivePlan({ projectId, plan, reason });
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
    syncPlanEntryStatesFromRuntime(bucket);
    return mergeRuntimePublicView({
      plan: bucket.plan,
      runtime: enrichRuntimeForPublic(bucket)
    });
  }

  function enrichRuntimeForPublic(bucket) {
    if (!bucket?.runtime) return null;
    const runtime = bucket.runtime;
    const currentEntry = bucket.plan?.entries?.find(entry => entry.queueEntryId === runtime.currentEntryId);
    const entryJobs = runtime.entryJobs || [];
    const acceptedJobs = buildAcceptedJobsList(bucket);
    return {
      ...runtime,
      entries: bucket.plan?.entries,
      entryJobs,
      acceptedJobs,
      currentEntryName: currentEntry?.name || null,
      currentEntryOrder: currentEntry?.order ?? null
    };
  }

  function buildAcceptedJobsList(bucket) {
    const out = [];
    const runtime = bucket?.runtime;
    if (!runtime || !bucket.plan) return out;
    const pushJob = (entry, job, historyState = "pending") => {
      if (!job?.promptId) return;
      out.push({
        queueRunId: runtime.queueRunId,
        queueEntryId: entry.queueEntryId,
        queueBatchName: entry.name,
        queueJobId: job.queueJobId,
        batchId: entry.queueEntryId === runtime.currentEntryId ? runtime.currentBatchId : null,
        jobIndex: job.index,
        promptId: job.promptId,
        state: job.state,
        historyState,
        source: "batch",
        item: job.item,
        workflowId: entry.snapshot?.source?.workflowId || "",
        workflowLabel: entry.snapshot?.source?.workflowLabel || "",
        model: entry.snapshot?.source?.model || ""
      });
    };
    if (runtime.entryJobs?.length && runtime.currentEntryId) {
      const entry = bucket.plan.entries.find(e => e.queueEntryId === runtime.currentEntryId);
      for (const job of runtime.entryJobs) pushJob(entry, job, job.state);
    }
    for (const [entryId, jobs] of Object.entries(runtime.entryStates || {})) {
      const entry = bucket.plan.entries.find(e => e.queueEntryId === entryId);
      if (!entry || entryId === runtime.currentEntryId) continue;
      for (const job of jobs) pushJob(entry, job, job.state);
    }
    return out;
  }

  function syncPlanEntryStatesFromRuntime(bucket) {
    if (!bucket?.runtime?.currentEntryId || !bucket.plan) return;
    const entryIndex = bucket.plan.entries.findIndex(entry => entry.queueEntryId === bucket.runtime.currentEntryId);
    if (entryIndex < 0) return;
    const entry = bucket.plan.entries[entryIndex];
    if (entry.state === QUEUE_ENTRY_STATE.SUBMITTING || entry.state === QUEUE_ENTRY_STATE.RUNNING) {
      return;
    }
    if (bucket.runtime.entryJobs?.length) {
      bucket.plan.entries[entryIndex] = { ...entry, state: QUEUE_ENTRY_STATE.RUNNING, everClaimed: true };
    }
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
    runtime.currentJobIndex = resolveCurrentJobIndex(jobs, activePromptId);
    runtime.entryStates = runtime.entryStates || {};
    runtime.entryStates[runtime.currentEntryId] = jobs;
  }

  async function finalizeCurrentEntry(bucket, { pauseRequested = false } = {}) {
    const runtime = bucket.runtime;
    if (!runtime?.currentEntryId) return;
    const entryId = runtime.currentEntryId;
    const entryIndex = bucket.plan.entries.findIndex(entry => entry.queueEntryId === entryId);
    if (entryIndex < 0) return;
    const jobs = runtime.entryJobs || [];
    const submitFailed = Boolean(runtime.lastSubmitFailure);
    const userCancelled = Boolean(runtime.userCancelledCurrentEntry);
    const entryState = entryBatchTerminalFromJobs(jobs, { submitFailed, userCancelled });
    bucket.plan.entries[entryIndex] = {
      ...bucket.plan.entries[entryIndex],
      state: entryState,
      everClaimed: true
    };
    runtime.entryStates = runtime.entryStates || {};
    runtime.entryStates[entryId] = jobs;
    runtime.currentEntryId = null;
    runtime.currentBatchId = null;
    runtime.currentJobIndex = null;
    runtime.entryJobs = null;
    runtime.lastSubmitFailure = null;
    runtime.userCancelledCurrentEntry = false;
    runtime.overallState = decideQueueAfterEntryTerminal({
      failurePolicy: bucket.plan.failurePolicy,
      entryState,
      pauseRequested
    });
    log("batch_queue_entry_terminal", { entry_id: entryId.slice(0, 8), state: entryState });
    await checkpointDescriptivePlan(bucket, "terminal");
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
    await checkpointDescriptivePlan(bucket, "claim");

    const { jobs: submittedJobs, submitResult } = await executeEntryJobs({
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
    bucket.runtime.lastSubmitFailure = submitResult.failure || null;
    if (submitResult.failure && !submitResult.accepted.length) {
      bucket.plan.entries[entryIndex] = {
        ...bucket.plan.entries[entryIndex],
        state: QUEUE_ENTRY_STATE.FAILED,
        everClaimed: true
      };
      await checkpointDescriptivePlan(bucket, "submit-failure");
      bucket.runtime.entryStates = bucket.runtime.entryStates || {};
      bucket.runtime.entryStates[next.queueEntryId] = submittedJobs;
      bucket.runtime.currentEntryId = null;
      bucket.runtime.currentBatchId = null;
      bucket.runtime.currentJobIndex = null;
      bucket.runtime.entryJobs = null;
      bucket.runtime.overallState = decideQueueAfterEntryTerminal({
        failurePolicy: bucket.plan.failurePolicy,
        entryState: QUEUE_ENTRY_STATE.FAILED,
        pauseRequested: false
      });
      return;
    }
    bucket.plan.entries[entryIndex] = {
      ...bucket.plan.entries[entryIndex],
      state: QUEUE_ENTRY_STATE.RUNNING,
      everClaimed: true
    };
    bucket.runtime.currentJobIndex = resolveCurrentJobIndex(submittedJobs, null);
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
    syncPlan({ projectId, plan, expectedRevision = null }) {
      const bucket = getBucket(projectId);
      const normalized = normalizeBatchQueuePlan(plan);
      const capacity = normalized ? validateQueueCapacity(normalized.entries) : { ok: true };
      if (!capacity.ok) return capacity;
      if (bucket.runtime?.queueRunId) {
        const merged = mergeIncomingPlanWithRuntime({
          serverPlan: bucket.plan,
          incomingPlan: normalized,
          expectedRevision
        });
        if (!merged.ok) return merged;
        bucket.plan = merged.plan;
        return { ok: true, view: publicView(projectId), merged: merged.merged };
      }
      if (normalized) {
        bucket.plan = {
          ...normalized,
          entries: normalized.entries.map(entry => (
            entry.state === QUEUE_ENTRY_STATE.SUBMITTING || entry.state === QUEUE_ENTRY_STATE.RUNNING
              ? { ...entry, state: QUEUE_ENTRY_STATE.RECOVERY_REQUIRED, everClaimed: true }
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

    async resume({ projectId, plan, expectedRevision = null }) {
      const bucket = getBucket(projectId);
      if (bucket.runtime?.queueRunId && bucket.runtime.armed) {
        if (bucket.runtime.overallState === QUEUE_OVERALL_STATE.PAUSED
          || bucket.runtime.overallState === QUEUE_OVERALL_STATE.PAUSED_FAILURE) {
          bucket.runtime.overallState = QUEUE_OVERALL_STATE.WAITING;
          bucket.runtime.pauseRequested = false;
          await tickProject(projectId);
          return { ok: true, view: publicView(projectId) };
        }
        return { ok: true, status: "already-armed", view: publicView(projectId) };
      }
      const sync = this.syncPlan({ projectId, plan, expectedRevision });
      if (!sync.ok) return sync;
      const normalized = bucket.plan;
      const hasRecovery = normalized?.entries?.some(entry => entry.state === QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);
      if (hasRecovery) {
        bucket.runtime = bucket.runtime || {};
        bucket.runtime.overallState = QUEUE_OVERALL_STATE.RECOVERY_REQUIRED;
        return {
          ok: false,
          code: "recovery-unresolved",
          error: "Risolvi i batch in RECUPERO RICHIESTO prima di riprendere la coda.",
          view: publicView(projectId)
        };
      }
      const hasExecutable = normalized?.entries?.some(entry => entry.state === QUEUE_ENTRY_STATE.QUEUED);
      if (!hasExecutable) {
        return { ok: false, code: "nothing-to-run", error: "Nessun batch eseguibile in coda." };
      }
      return this.arm({
        projectId,
        plan: normalized,
        failurePolicy: normalized?.failurePolicy
      });
    },

    resolveRecoveryEntry({ projectId, queueEntryId, resolution, expectedRevision }) {
      const bucket = getBucket(projectId);
      if (!bucket?.plan) return { ok: false, code: "no-plan", error: "Coda non presente." };
      if (bucket.runtime?.currentEntryId === queueEntryId) {
        return { ok: false, code: "immutable", error: "Batch in esecuzione." };
      }
      if (Number(expectedRevision) !== Number(bucket.plan.revision)) {
        return { ok: false, code: "stale-revision", error: "Revisione coda non aggiornata." };
      }
      const result = resolveRecoveryEntryInPlan(bucket.plan, queueEntryId, resolution);
      if (!result.ok) return result;
      bucket.plan = result.plan;
      return { ok: true, view: publicView(projectId) };
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

    onFullBatchStop(projectId, { batchId = null } = {}) {
      const bucket = getBucket(projectId);
      if (bucket?.runtime?.currentEntryId && bucket.plan) {
        const entryId = bucket.runtime.currentEntryId;
        if (!batchId || bucket.runtime.currentBatchId === batchId) {
          const entryIndex = bucket.plan.entries.findIndex(entry => entry.queueEntryId === entryId);
          if (entryIndex >= 0) {
            bucket.plan.entries[entryIndex] = {
              ...bucket.plan.entries[entryIndex],
              state: QUEUE_ENTRY_STATE.CANCELLED,
              everClaimed: true
            };
          }
          bucket.runtime.userCancelledCurrentEntry = true;
          bucket.runtime.currentEntryId = null;
          bucket.runtime.currentBatchId = null;
          bucket.runtime.currentJobIndex = null;
          bucket.runtime.entryJobs = null;
        }
      }
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
