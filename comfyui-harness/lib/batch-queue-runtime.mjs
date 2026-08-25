/**
 * Multi-Batch queue runtime state machine (Issue #47).
 */

import {
  BATCH_QUEUE_FAILURE_POLICY,
  QUEUE_ENTRY_STATE,
  QUEUE_OVERALL_STATE,
  isActiveQueueEntryState,
  isTerminalQueueEntryState,
  summarizeQueuePlan
} from "./batch-queue-plan.mjs";

export function isLaneSafe({ running = 0, pending = 0 } = {}) {
  return Number(running || 0) === 0 && Number(pending || 0) === 0;
}

export function selectNextQueuedEntry(entries = []) {
  const sorted = [...entries].sort((a, b) => a.order - b.order);
  for (const entry of sorted) {
    if (entry.state === QUEUE_ENTRY_STATE.RECOVERY_REQUIRED) return null;
    if (entry.state === QUEUE_ENTRY_STATE.QUEUED) return entry;
  }
  return null;
}

export function claimEntryAtomic(entry) {
  if (!entry || entry.state !== QUEUE_ENTRY_STATE.QUEUED) {
    return { ok: false, code: "not-claimable" };
  }
  return {
    ok: true,
    entry: { ...entry, state: QUEUE_ENTRY_STATE.SUBMITTING, everClaimed: true }
  };
}

export function entryBatchTerminalFromJobs(jobs = [], {
  submitFailed = false,
  userCancelled = false
} = {}) {
  if (submitFailed) return QUEUE_ENTRY_STATE.FAILED;
  if (!jobs.length) return QUEUE_ENTRY_STATE.FAILED;
  if (userCancelled) return QUEUE_ENTRY_STATE.CANCELLED;
  const allCompleted = jobs.every(job => job.state === "completed");
  if (allCompleted) return QUEUE_ENTRY_STATE.COMPLETED;
  const hasError = jobs.some(job => job.state === "error");
  const hasInterrupted = jobs.some(job => job.state === "interrupted");
  const allCancelled = jobs.every(job => job.state === "cancelled" || job.state === "not-submitted");
  const anyAccepted = jobs.some(job => job.promptId);
  if (allCancelled && !anyAccepted) return QUEUE_ENTRY_STATE.CANCELLED;
  if (hasError) return QUEUE_ENTRY_STATE.FAILED;
  if (hasInterrupted && jobs.every(job => ["completed", "interrupted", "cancelled", "not-submitted"].includes(job.state))) {
    return QUEUE_ENTRY_STATE.COMPLETED;
  }
  return QUEUE_ENTRY_STATE.FAILED;
}

export function resolveCurrentJobIndex(jobs = [], activePromptId = null) {
  if (!jobs.length) return null;
  if (activePromptId) {
    const idx = jobs.findIndex(job => job.promptId === activePromptId);
    if (idx >= 0) return idx;
  }
  const runningIdx = jobs.findIndex(job => job.state === "running");
  if (runningIdx >= 0) return runningIdx;
  const pendingIdx = jobs.findIndex(job => job.state === "pending" && job.promptId);
  return pendingIdx >= 0 ? pendingIdx : null;
}

export function decideQueueAfterEntryTerminal({
  failurePolicy = BATCH_QUEUE_FAILURE_POLICY.STOP,
  entryState,
  pauseRequested = false
} = {}) {
  if (pauseRequested) {
    return QUEUE_OVERALL_STATE.PAUSED;
  }
  if (entryState === QUEUE_ENTRY_STATE.FAILED && failurePolicy === BATCH_QUEUE_FAILURE_POLICY.STOP) {
    return QUEUE_OVERALL_STATE.PAUSED_FAILURE;
  }
  return QUEUE_OVERALL_STATE.WAITING;
}

export function computeOverallState({
  armed = false,
  authorityPresent = false,
  entries = [],
  currentEntryId = null,
  laneSafe = true,
  pauseRequested = false,
  queueState = QUEUE_OVERALL_STATE.IDLE
} = {}) {
  if (!armed || !authorityPresent) {
    if (queueState === QUEUE_OVERALL_STATE.RECOVERY_REQUIRED) return QUEUE_OVERALL_STATE.RECOVERY_REQUIRED;
    return QUEUE_OVERALL_STATE.IDLE;
  }
  if (pauseRequested || queueState === QUEUE_OVERALL_STATE.PAUSED) return QUEUE_OVERALL_STATE.PAUSED;
  if (queueState === QUEUE_OVERALL_STATE.PAUSED_FAILURE) return QUEUE_OVERALL_STATE.PAUSED_FAILURE;
  const hasActive = entries.some(entry => isActiveQueueEntryState(entry.state));
  const hasQueued = entries.some(entry => entry.state === QUEUE_ENTRY_STATE.QUEUED);
  if (!hasActive && !hasQueued) return QUEUE_OVERALL_STATE.COMPLETED;
  if (currentEntryId && entries.some(entry => entry.queueEntryId === currentEntryId && entry.state === QUEUE_ENTRY_STATE.RUNNING)) {
    return QUEUE_OVERALL_STATE.RUNNING;
  }
  if (!laneSafe) return QUEUE_OVERALL_STATE.WAITING;
  if (hasQueued || hasActive) return QUEUE_OVERALL_STATE.RUNNING;
  return QUEUE_OVERALL_STATE.WAITING;
}

export function classifyAuthorityLoss(entries = []) {
  return entries.map(entry => {
    if (entry.state === QUEUE_ENTRY_STATE.SUBMITTING || entry.state === QUEUE_ENTRY_STATE.RUNNING) {
      return { ...entry, state: QUEUE_ENTRY_STATE.RECOVERY_REQUIRED };
    }
    return entry;
  });
}

export function shouldBlockSingleRender({ queueArmed = false, queueRunning = false } = {}) {
  return Boolean(queueArmed || queueRunning);
}

export function shouldBlockImmediateBatch({ queueArmed = false } = {}) {
  return Boolean(queueArmed);
}

export function mergeRuntimePublicView({
  plan,
  runtime = null
} = {}) {
  const entries = (plan?.entries || []).map(entry => {
    const live = runtime?.entries?.find(item => item.queueEntryId === entry.queueEntryId);
    return live ? { ...entry, ...live, snapshot: entry.snapshot } : entry;
  });
  const summary = summarizeQueuePlan(entries);
  return {
    queueRunId: runtime?.queueRunId || null,
    projectId: runtime?.projectId || null,
    revision: plan?.revision ?? 0,
    failurePolicy: plan?.failurePolicy || BATCH_QUEUE_FAILURE_POLICY.STOP,
    overallState: runtime?.overallState || QUEUE_OVERALL_STATE.IDLE,
    armed: Boolean(runtime?.armed),
    authorityPresent: Boolean(runtime?.queueRunId),
    // Session clock for display elapsed/ETA only — not execution authority.
    startedAt: Number.isFinite(Number(runtime?.startedAt)) ? Number(runtime.startedAt) : null,
    currentEntryId: runtime?.currentEntryId || null,
    currentBatchId: runtime?.currentBatchId || null,
    currentJobIndex: runtime?.currentJobIndex ?? null,
    currentEntryName: runtime?.currentEntryName || null,
    currentEntryOrder: runtime?.currentEntryOrder ?? null,
    entryJobs: runtime?.entryJobs || [],
    acceptedJobs: runtime?.acceptedJobs || [],
    entries,
    summary,
    recoveryMessage: runtime?.overallState === QUEUE_OVERALL_STATE.RECOVERY_REQUIRED
      ? "Il piano della coda è stato ripristinato, ma l'esecuzione automatica deve essere riattivata."
      : null
  };
}

export function hasRemainingExecutableEntries(entries = []) {
  return entries.some(entry => entry.state === QUEUE_ENTRY_STATE.QUEUED);
}

export function queuePrecedenceAllowsQueuedNext({ queuedNextArmed = false, queueArmed = false } = {}) {
  if (!queueArmed) return true;
  return !queuedNextArmed;
}

export { isTerminalQueueEntryState, isActiveQueueEntryState };
