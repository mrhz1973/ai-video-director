/**
 * Pure CODA/BATCH runtime progress helpers (v0.18.0).
 *
 * Authoritative sources (do not invent execution authority):
 * - Queue plan entry states + snapshot.items → overall job counts
 * - runtimeView.currentEntryId / currentJobIndex / entryJobs → current job X/Y
 * - runtimeView.startedAt → queue elapsed (session clock)
 * - Comfy WS progress events (value/max/prompt_id) → step progress when promptId
 *   matches the active accepted/entry job; otherwise indeterminate (never fake %)
 */

import {
  QUEUE_ENTRY_STATE
} from "../lib/batch-queue-plan-core.mjs";
import { clampDisplayProgress, formatElapsed } from "./monitor.mjs";

/** Job terminal-ish states on entryJobs / acceptedJobs. */
const JOB_COMPLETED = new Set(["completed"]);
const JOB_RUNNING = new Set(["running"]);
const JOB_FAILED = new Set(["error"]);
const JOB_INTERRUPTED = new Set(["interrupted"]);
const JOB_CANCELLED = new Set(["cancelled", "not-submitted"]);

/**
 * Overall CODA progress by job counts (not entry counts alone).
 * @returns {{
 *   total: number,
 *   completed: number,
 *   running: number,
 *   pending: number,
 *   failed: number,
 *   interrupted: number,
 *   cancelled: number,
 *   percent: number|null
 * }}
 */
export function summarizeCodaJobProgress({ entries = [], runtimeView = null } = {}) {
  const currentId = runtimeView?.currentEntryId || null;
  const entryJobs = Array.isArray(runtimeView?.entryJobs) ? runtimeView.entryJobs : null;

  let total = 0;
  let completed = 0;
  let running = 0;
  let pending = 0;
  let failed = 0;
  let interrupted = 0;
  let cancelled = 0;

  for (const entry of entries) {
    const jobCount = Array.isArray(entry?.snapshot?.items) ? entry.snapshot.items.length : 0;
    total += jobCount;
    if (!jobCount) continue;

    const state = entry.state;
    if (state === QUEUE_ENTRY_STATE.COMPLETED) {
      completed += jobCount;
      continue;
    }
    if (state === QUEUE_ENTRY_STATE.FAILED) {
      failed += jobCount;
      continue;
    }
    if (state === QUEUE_ENTRY_STATE.CANCELLED) {
      cancelled += jobCount;
      continue;
    }
    if (state === QUEUE_ENTRY_STATE.RECOVERY_REQUIRED) {
      interrupted += jobCount;
      continue;
    }

    if (entry.queueEntryId === currentId && entryJobs?.length) {
      for (const job of entryJobs) {
        const js = String(job.state || "");
        if (JOB_COMPLETED.has(js)) completed += 1;
        else if (JOB_RUNNING.has(js)) running += 1;
        else if (JOB_FAILED.has(js)) failed += 1;
        else if (JOB_INTERRUPTED.has(js)) interrupted += 1;
        else if (JOB_CANCELLED.has(js)) cancelled += 1;
        else pending += 1;
      }
      continue;
    }

    // Only submitting/running count as in-progress for progress UI.
    // Note: isActiveQueueEntryState() also includes QUEUED (capacity semantics) — do not reuse it here.
    if (state === QUEUE_ENTRY_STATE.SUBMITTING || state === QUEUE_ENTRY_STATE.RUNNING) {
      running += 1;
      pending += Math.max(0, jobCount - 1);
      continue;
    }

    // QUEUED and unknown → pending
    pending += jobCount;
  }

  const percent = total > 0 ? Math.round((completed / total) * 100) : null;
  return { total, completed, running, pending, failed, interrupted, cancelled, percent };
}

/**
 * Current entry job position (1-based display values).
 * @returns {{ entryName: string|null, jobIndex: number|null, jobTotal: number, label: string }}
 */
export function resolveCurrentJobPointer({ entries = [], runtimeView = null } = {}) {
  const entryId = runtimeView?.currentEntryId || null;
  if (!entryId) {
    return { entryName: null, jobIndex: null, jobTotal: 0, label: "" };
  }
  const entry = entries.find(item => item.queueEntryId === entryId) || null;
  const jobTotal = entry?.snapshot?.items?.length || runtimeView?.entryJobs?.length || 0;
  const rawIndex = runtimeView?.currentJobIndex;
  const jobIndex = Number.isFinite(Number(rawIndex)) ? Number(rawIndex) + 1 : null;
  const entryName = runtimeView?.currentEntryName || entry?.name || null;
  const label = jobIndex != null && jobTotal
    ? `Job ${jobIndex} / ${jobTotal}`
    : jobTotal
      ? `${jobTotal} job`
      : "";
  return { entryName, jobIndex, jobTotal, label };
}

/**
 * Normalize Comfy node progress for display. Never invents a percentage.
 * @returns {{ kind: "numeric"|"indeterminate"|"idle"|"complete", value: number|null, max: number|null, percent: number|null, promptId: string|null }}
 */
export function normalizeRenderProgress(progress = null) {
  if (!progress || typeof progress !== "object") {
    return { kind: "idle", value: null, max: null, percent: null, promptId: null };
  }
  if (progress.kind === "complete") {
    return { kind: "complete", value: null, max: null, percent: null, promptId: progress.promptId || null };
  }
  if (progress.kind === "numeric") {
    const clamped = clampDisplayProgress(progress.value, progress.max);
    return { ...clamped, promptId: progress.promptId || null };
  }
  if (progress.kind === "indeterminate" || progress.kind === "running") {
    return {
      kind: "indeterminate",
      value: null,
      max: null,
      percent: null,
      promptId: progress.promptId || null
    };
  }
  return { kind: "idle", value: null, max: null, percent: null, promptId: progress.promptId || null };
}

/**
 * Accept live Comfy progress only when promptId matches the active CODA/BATCH job.
 */
export function progressForActivePrompt({ progress = null, activePromptIds = [] } = {}) {
  const normalized = normalizeRenderProgress(progress);
  if (!normalized.promptId) {
    return activePromptIds.length ? { ...normalized, kind: normalized.kind === "idle" ? "indeterminate" : normalized.kind } : normalized;
  }
  if (!activePromptIds.includes(normalized.promptId)) {
    return { kind: "idle", value: null, max: null, percent: null, promptId: normalized.promptId };
  }
  return normalized;
}

export function collectActivePromptIds({ runtimeView = null, batchJobs = null } = {}) {
  const ids = [];
  if (Array.isArray(runtimeView?.entryJobs)) {
    for (const job of runtimeView.entryJobs) {
      if (job?.promptId && (job.state === "running" || job.state === "pending")) ids.push(String(job.promptId));
    }
  }
  if (Array.isArray(runtimeView?.acceptedJobs)) {
    for (const job of runtimeView.acceptedJobs) {
      if (job?.promptId && (job.state === "running" || job.historyState === "running")) {
        const id = String(job.promptId);
        if (!ids.includes(id)) ids.push(id);
      }
    }
  }
  if (Array.isArray(batchJobs)) {
    for (const job of batchJobs) {
      if (job?.promptId && (job.state === "running" || job.state === "pending")) {
        const id = String(job.promptId);
        if (!ids.includes(id)) ids.push(id);
      }
    }
  }
  return ids;
}

export function formatQueueElapsed(startedAt, now = Date.now()) {
  if (!Number.isFinite(Number(startedAt)) || Number(startedAt) <= 0) {
    return { text: "non disponibile", elapsedMs: null, approximate: true };
  }
  const elapsedMs = Math.max(0, now - Number(startedAt));
  return { text: formatElapsed(elapsedMs), elapsedMs, approximate: false };
}

/**
 * Honest ETA only when at least one job completed and we have queue startedAt.
 * Methodology: mean completed-job duration ≈ elapsed / completed, times remaining jobs.
 * Never claims precision; returns null when data is insufficient.
 */
export function estimateCodaEtaMs({
  startedAt = null,
  completed = 0,
  total = 0,
  running = 0,
  renderProgress = null,
  now = Date.now()
} = {}) {
  if (!Number.isFinite(Number(startedAt)) || Number(startedAt) <= 0) return null;
  if (!Number.isFinite(completed) || completed < 1) return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  const elapsed = Math.max(0, now - Number(startedAt));
  if (elapsed <= 0) return null;
  const avgMs = elapsed / completed;
  const remainingWhole = Math.max(0, total - completed - (running > 0 ? 1 : 0));
  let currentRemaining = 0;
  const progress = normalizeRenderProgress(renderProgress);
  if (running > 0) {
    if (progress.kind === "numeric" && progress.percent != null && progress.percent > 0 && progress.percent < 100) {
      currentRemaining = avgMs * (1 - progress.percent / 100);
    } else {
      currentRemaining = avgMs; // unknown progress: assume one average job left for the runner
    }
  }
  return Math.round(avgMs * remainingWhole + currentRemaining);
}

export function formatEtaMs(etaMs) {
  if (!Number.isFinite(etaMs) || etaMs < 0) return "estimating…";
  if (etaMs < 60_000) return `~${Math.max(1, Math.round(etaMs / 1000))}s`;
  const totalMin = Math.round(etaMs / 60_000);
  if (totalMin < 60) return `~${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `~${h}h ${m}m` : `~${h}h`;
}

export function entryStatusLabel(state) {
  switch (state) {
    case QUEUE_ENTRY_STATE.QUEUED: return "IN CODA";
    case QUEUE_ENTRY_STATE.SUBMITTING: return "IN ESECUZIONE";
    case QUEUE_ENTRY_STATE.RUNNING: return "IN ESECUZIONE";
    case QUEUE_ENTRY_STATE.COMPLETED: return "COMPLETATO";
    case QUEUE_ENTRY_STATE.FAILED: return "FALLITO";
    case QUEUE_ENTRY_STATE.CANCELLED: return "ANNULLATO";
    case QUEUE_ENTRY_STATE.RECOVERY_REQUIRED: return "RECUPERO RICHIESTO";
    default: return String(state || "—");
  }
}

/**
 * Build a DOM-free snapshot for the CODA progress panel / tests.
 * Does not mutate runtime or plan.
 */
export function buildCodaProgressView({
  entries = [],
  runtimeView = null,
  renderProgress = null,
  now = Date.now()
} = {}) {
  const jobs = summarizeCodaJobProgress({ entries, runtimeView });
  const pointer = resolveCurrentJobPointer({ entries, runtimeView });
  const activePromptIds = collectActivePromptIds({ runtimeView });
  const render = progressForActivePrompt({ progress: renderProgress, activePromptIds });
  const armed = Boolean(runtimeView?.armed && runtimeView?.authorityPresent);
  const elapsed = formatQueueElapsed(runtimeView?.startedAt, now);
  const etaMs = armed
    ? estimateCodaEtaMs({
      startedAt: runtimeView?.startedAt,
      completed: jobs.completed,
      total: jobs.total,
      running: jobs.running,
      renderProgress: render,
      now
    })
    : null;

  return {
    armed,
    jobs,
    pointer,
    render,
    elapsed,
    etaText: etaMs == null ? (armed && jobs.completed < 1 ? "estimating…" : null) : formatEtaMs(etaMs),
    // Explicit: this view is display-only and must never gate queue authority.
    authority: "display-only"
  };
}

/**
 * Immediate BATCH progress (browser-sequenced jobs), display-only.
 */
export function buildBatchProgressView({
  jobs = [],
  renderProgress = null,
  startedAt = null,
  now = Date.now()
} = {}) {
  const total = jobs.length;
  let completed = 0;
  let running = 0;
  let pending = 0;
  let failed = 0;
  let interrupted = 0;
  let currentIndex = null;
  let currentLabel = null;
  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    const state = String(job?.state || "");
    if (state === "completed") completed += 1;
    else if (state === "running") {
      running += 1;
      if (currentIndex == null) {
        currentIndex = i + 1;
        currentLabel = job.label || `Job ${i + 1}`;
      }
    } else if (state === "error") failed += 1;
    else if (state === "interrupted") interrupted += 1;
    else if (state === "cancelled" || state === "not-submitted") { /* skip */ }
    else pending += 1;
  }
  const activePromptIds = collectActivePromptIds({ batchJobs: jobs });
  const render = progressForActivePrompt({ progress: renderProgress, activePromptIds });
  const elapsed = formatQueueElapsed(startedAt, now);
  const etaMs = estimateCodaEtaMs({
    startedAt,
    completed,
    total,
    running,
    renderProgress: render,
    now
  });
  return {
    total,
    completed,
    running,
    pending,
    failed,
    interrupted,
    currentIndex,
    currentLabel,
    label: currentIndex != null ? `Job ${currentIndex} / ${total}` : `${completed} / ${total}`,
    render,
    elapsed,
    etaText: etaMs == null ? (completed < 1 && running > 0 ? "estimating…" : null) : formatEtaMs(etaMs),
    authority: "display-only"
  };
}
