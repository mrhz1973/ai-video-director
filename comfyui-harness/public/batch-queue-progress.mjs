/**
 * Pure CODA/BATCH runtime progress helpers (v0.18.0).
 *
 * Authoritative sources (do not invent execution authority):
 * - Queue plan entry states + snapshot.items → overall job totals
 * - runtimeView.entryJobs (current entry) → per-job states
 * - runtimeView.acceptedJobs grouped by queueEntryId → historical per-job states
 * - runtimeView.currentEntryId / currentJobIndex → current job X/Y
 * - runtimeView.startedAt → queue elapsed (session clock)
 * - Comfy WS progress (value/max/prompt_id/nodeId/displayNode/source) → render progress
 *   when promptId matches the active job; never fake %; "Step" only for known sampler nodes
 */

import {
  QUEUE_ENTRY_STATE,
  QUEUE_OVERALL_STATE
} from "../lib/batch-queue-plan-core.mjs";
import { clampDisplayProgress, formatElapsed } from "./monitor.mjs";

const TERMINAL_ENTRY_STATES = new Set([
  QUEUE_ENTRY_STATE.COMPLETED,
  QUEUE_ENTRY_STATE.FAILED,
  QUEUE_ENTRY_STATE.CANCELLED
]);

/** Job terminal-ish states on entryJobs / acceptedJobs. */
const JOB_COMPLETED = new Set(["completed"]);
const JOB_RUNNING = new Set(["running"]);
const JOB_FAILED = new Set(["error"]);
const JOB_INTERRUPTED = new Set(["interrupted"]);
const JOB_CANCELLED = new Set(["cancelled", "not-submitted"]);

/**
 * Comfy node titles/class names that authoritatively emit generation-step progress.
 * BasicScheduler / VAE / loaders are deliberately excluded — do not infer "Step"
 * from value/max alone (e.g. max === configured steps).
 */
export const SAMPLER_STEP_NODE_NAMES = new Set([
  "SamplerCustomAdvanced",
  "SamplerCustom",
  "KSampler",
  "KSamplerAdvanced"
]);

/**
 * Classify one job state into progress buckets.
 * @returns {"completed"|"running"|"pending"|"failed"|"interrupted"|"cancelled"}
 */
export function classifyJobProgressState(state) {
  const js = String(state || "");
  if (JOB_COMPLETED.has(js)) return "completed";
  if (JOB_RUNNING.has(js)) return "running";
  if (JOB_FAILED.has(js)) return "failed";
  if (JOB_INTERRUPTED.has(js)) return "interrupted";
  if (JOB_CANCELLED.has(js)) return "cancelled";
  return "pending";
}

function emptyJobCounters() {
  return {
    completed: 0,
    running: 0,
    pending: 0,
    failed: 0,
    interrupted: 0,
    cancelled: 0
  };
}

function addJobState(counters, state) {
  counters[classifyJobProgressState(state)] += 1;
}

/**
 * Resolve per-job evidence for one queue entry.
 * Precedence: current entryJobs → acceptedJobs for that entry → null (caller falls back).
 * Avoids double-counting current entry when it also appears in acceptedJobs.
 */
export function resolveEntryJobEvidence({
  entry = null,
  runtimeView = null
} = {}) {
  const entryId = entry?.queueEntryId || null;
  if (!entryId) return null;
  const currentId = runtimeView?.currentEntryId || null;
  const entryJobs = Array.isArray(runtimeView?.entryJobs) ? runtimeView.entryJobs : [];
  if (currentId && entryId === currentId && entryJobs.length) {
    return entryJobs;
  }
  const accepted = Array.isArray(runtimeView?.acceptedJobs) ? runtimeView.acceptedJobs : [];
  const forEntry = accepted.filter(job => job?.queueEntryId === entryId);
  return forEntry.length ? forEntry : null;
}

/**
 * Count jobs for one entry from per-job evidence, padding missing slots.
 * Missing jobs (snapshot longer than evidence) are not-submitted when the entry
 * is terminal, otherwise pending.
 */
export function countJobsFromEvidence(entry, evidence) {
  const counters = emptyJobCounters();
  const jobCount = Array.isArray(entry?.snapshot?.items) ? entry.snapshot.items.length : 0;
  if (!jobCount) return counters;
  const list = Array.isArray(evidence) ? evidence : [];
  for (const job of list) addJobState(counters, job?.state);
  const known = list.length;
  if (known < jobCount) {
    const missing = jobCount - known;
    const terminal = isTerminalQueueEntryStateLocal(entry?.state);
    if (terminal) counters.cancelled += missing;
    else counters.pending += missing;
  }
  return counters;
}

function isTerminalQueueEntryStateLocal(state) {
  return [
    QUEUE_ENTRY_STATE.COMPLETED,
    QUEUE_ENTRY_STATE.FAILED,
    QUEUE_ENTRY_STATE.CANCELLED,
    QUEUE_ENTRY_STATE.RECOVERY_REQUIRED
  ].includes(state);
}

/**
 * Fall back to entry-level state only when no per-job evidence exists.
 */
export function countJobsFromEntryState(entry) {
  const counters = emptyJobCounters();
  const jobCount = Array.isArray(entry?.snapshot?.items) ? entry.snapshot.items.length : 0;
  if (!jobCount) return counters;
  const state = entry?.state;
  if (state === QUEUE_ENTRY_STATE.COMPLETED) {
    counters.completed = jobCount;
  } else if (state === QUEUE_ENTRY_STATE.FAILED) {
    counters.failed = jobCount;
  } else if (state === QUEUE_ENTRY_STATE.CANCELLED) {
    counters.cancelled = jobCount;
  } else if (state === QUEUE_ENTRY_STATE.RECOVERY_REQUIRED) {
    counters.interrupted = jobCount;
  } else if (state === QUEUE_ENTRY_STATE.SUBMITTING || state === QUEUE_ENTRY_STATE.RUNNING) {
    // Without per-job evidence: one running slot, rest pending.
    counters.running = 1;
    counters.pending = Math.max(0, jobCount - 1);
  } else {
    counters.pending = jobCount;
  }
  return counters;
}

/**
 * Overall CODA progress by actual job counts (not entry-level blanket mapping).
 *
 * percent = successful completion only (completed / total). Textual counts include
 * failed / interrupted / cancelled separately. Display-only — never gates authority.
 *
 * @returns {{
 *   total: number,
 *   completed: number,
 *   running: number,
 *   pending: number,
 *   failed: number,
 *   interrupted: number,
 *   cancelled: number,
 *   percent: number|null,
 *   percentSemantics: "successful-completion"
 * }}
 */
export function summarizeCodaJobProgress({ entries = [], runtimeView = null } = {}) {
  const totals = emptyJobCounters();
  let total = 0;

  for (const entry of entries) {
    const jobCount = Array.isArray(entry?.snapshot?.items) ? entry.snapshot.items.length : 0;
    total += jobCount;
    if (!jobCount) continue;

    const evidence = resolveEntryJobEvidence({ entry, runtimeView });
    const part = evidence
      ? countJobsFromEvidence(entry, evidence)
      : countJobsFromEntryState(entry);
    totals.completed += part.completed;
    totals.running += part.running;
    totals.pending += part.pending;
    totals.failed += part.failed;
    totals.interrupted += part.interrupted;
    totals.cancelled += part.cancelled;
  }

  const percent = total > 0 ? Math.round((totals.completed / total) * 100) : null;
  return {
    total,
    ...totals,
    percent,
    percentSemantics: "successful-completion"
  };
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
 * True only when displayNode is a known sampler / generation-step emitter.
 * Never infers from value/max or configured steps.
 */
export function isSamplerStepProgress(progress = null) {
  if (!progress || progress.kind !== "numeric") return false;
  const name = String(progress.displayNode || "").trim();
  if (!name) return false;
  return SAMPLER_STEP_NODE_NAMES.has(name);
}

/**
 * Normalize Comfy node progress for display. Preserves node/source metadata.
 * Never invents a percentage.
 * @returns {{
 *   kind: "numeric"|"indeterminate"|"idle"|"complete",
 *   value: number|null,
 *   max: number|null,
 *   percent: number|null,
 *   promptId: string|null,
 *   nodeId: string|null,
 *   displayNode: string|null,
 *   source: string|null,
 *   labelKind: "sampler-step"|"node"|"percent"|"indeterminate"|"idle"|"complete",
 *   label: string
 * }}
 */
export function normalizeRenderProgress(progress = null) {
  const baseMeta = {
    promptId: progress?.promptId ?? null,
    nodeId: progress?.nodeId != null ? String(progress.nodeId) : null,
    displayNode: progress?.displayNode != null ? String(progress.displayNode) : null,
    source: progress?.source != null ? String(progress.source) : null
  };

  if (!progress || typeof progress !== "object") {
    return finishProgress({ kind: "idle", value: null, max: null, percent: null, ...baseMeta });
  }
  if (progress.kind === "complete") {
    return finishProgress({ kind: "complete", value: null, max: null, percent: null, ...baseMeta });
  }
  if (progress.kind === "numeric") {
    const clamped = clampDisplayProgress(progress.value, progress.max);
    return finishProgress({ ...clamped, ...baseMeta });
  }
  if (progress.kind === "indeterminate" || progress.kind === "running") {
    return finishProgress({
      kind: "indeterminate",
      value: null,
      max: null,
      percent: null,
      ...baseMeta
    });
  }
  return finishProgress({ kind: "idle", value: null, max: null, percent: null, ...baseMeta });
}

function finishProgress(progress) {
  const labelInfo = describeRenderProgress(progress);
  return { ...progress, labelKind: labelInfo.labelKind, label: labelInfo.label };
}

/**
 * Display contract for numeric/indeterminate progress.
 * "Step X / Y" ONLY for known sampler nodes; otherwise truthful generic wording.
 */
export function describeRenderProgress(progress = null) {
  if (!progress || progress.kind === "idle") {
    return { labelKind: "idle", label: "In attesa" };
  }
  if (progress.kind === "complete") {
    return { labelKind: "complete", label: "Completato" };
  }
  if (progress.kind === "indeterminate") {
    const node = progress.displayNode || progress.nodeId;
    return {
      labelKind: "indeterminate",
      label: node ? `Processing current node · ${node}` : "Processing current node"
    };
  }
  if (progress.kind === "numeric" && progress.value != null && progress.max != null && progress.percent != null) {
    if (isSamplerStepProgress(progress)) {
      return {
        labelKind: "sampler-step",
        label: `Step ${progress.value} / ${progress.max} · ${progress.percent}%`
      };
    }
    const node = progress.displayNode || progress.nodeId;
    if (node) {
      return {
        labelKind: "node",
        label: `Progresso nodo ${progress.value} / ${progress.max} · ${progress.percent}%`
      };
    }
    return {
      labelKind: "percent",
      label: `Render ${progress.percent}%`
    };
  }
  return { labelKind: "indeterminate", label: "Processing current node" };
}

/** Alias used by UI modules. */
export function formatRenderProgressLabel(progress = null) {
  return normalizeRenderProgress(progress).label;
}

/**
 * Merge displayNode from a prior executing event (same nodeId) onto a progress
 * event that only carries node id — needed for sampler-step identification.
 */
export function enrichProgressWithNodeContext(progress = null, nodeDisplayById = null) {
  if (!progress || typeof progress !== "object") return progress;
  if (progress.displayNode) return progress;
  const nodeId = progress.nodeId != null ? String(progress.nodeId) : null;
  if (!nodeId || !nodeDisplayById || typeof nodeDisplayById.get !== "function") return progress;
  const known = nodeDisplayById.get(nodeId);
  if (!known) return progress;
  return { ...progress, displayNode: known };
}

/**
 * Accept live Comfy progress only when promptId matches the active CODA/BATCH job.
 */
export function progressForActivePrompt({ progress = null, activePromptIds = [] } = {}) {
  const normalized = normalizeRenderProgress(progress);
  if (!normalized.promptId) {
    if (!activePromptIds.length) return normalized;
    // Prompt-less events while a job is active stay indeterminate — never attach stale %.
    return finishProgress({
      kind: normalized.kind === "idle" ? "indeterminate" : "indeterminate",
      value: null,
      max: null,
      percent: null,
      promptId: null,
      nodeId: normalized.nodeId,
      displayNode: normalized.displayNode,
      source: normalized.source
    });
  }
  if (!activePromptIds.includes(normalized.promptId)) {
    return finishProgress({
      kind: "idle",
      value: null,
      max: null,
      percent: null,
      promptId: normalized.promptId,
      nodeId: normalized.nodeId,
      displayNode: normalized.displayNode,
      source: normalized.source
    });
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
 * Operator-facing CODA heading/summary for empty + terminal queues.
 * Never presents failed/cancelled work as "completati".
 * Returns terminal:false when the active/queued/recovery path should keep rendering.
 */
export function formatCodaTerminalSummary({
  entries = [],
  overallState = "",
  jobs = null,
  runtimeView = null
} = {}) {
  if (!entries.length) {
    return {
      heading: "CODA VUOTA",
      text: "Nessun lavoro da eseguire",
      state: "empty",
      terminal: true
    };
  }

  const recovery = overallState === QUEUE_OVERALL_STATE.RECOVERY_REQUIRED
    || entries.some(entry => entry.state === QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);
  if (recovery) {
    return { heading: "CODA", text: null, state: "recovery-required", terminal: false };
  }

  if (
    overallState === QUEUE_OVERALL_STATE.PAUSED
    || overallState === QUEUE_OVERALL_STATE.PAUSED_FAILURE
  ) {
    return { heading: "CODA", text: null, state: overallState, terminal: false };
  }

  const hasQueued = entries.some(entry => entry.state === QUEUE_ENTRY_STATE.QUEUED);
  const allTerminal = !hasQueued && entries.every(entry => TERMINAL_ENTRY_STATES.has(entry.state));
  const completedOverall = overallState === QUEUE_OVERALL_STATE.COMPLETED;
  if (!allTerminal && !completedOverall) {
    return { heading: "CODA", text: null, state: "active", terminal: false };
  }

  const counts = jobs || summarizeCodaJobProgress({ entries, runtimeView });
  const completed = Number(counts.completed) || 0;
  const failed = Number(counts.failed) || 0;
  const cancelled = Number(counts.cancelled) || 0;

  if (failed === 0 && cancelled === 0) {
    return {
      heading: "✓ CODA COMPLETATA",
      text: `${completed} job completati`,
      state: "completed",
      terminal: true
    };
  }

  const bits = [];
  if (completed > 0) bits.push(`${completed} completati`);
  if (failed > 0) bits.push(`${failed} falliti`);
  if (cancelled > 0) bits.push(`${cancelled} annullati`);

  if (failed > 0) {
    return {
      heading: "CODA TERMINATA CON PROBLEMI",
      text: bits.join(" · ") || "Problemi in coda",
      state: "terminal-problems",
      terminal: true
    };
  }

  return {
    heading: "CODA TERMINATA",
    text: bits.join(" · ") || "Coda terminata",
    state: "terminal",
    terminal: true
  };
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
    else if (state === "cancelled" || state === "not-submitted") { /* skip from pending */ }
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

