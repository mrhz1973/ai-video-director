/**
 * Pure UI helpers for runtime interruption controls (Issue #51).
 */

import { isTerminalBatchState } from "./batch-core.mjs";

export function singleInterruptActionable({
  phase,
  promptId,
  ownershipControllable,
  interruptPending
} = {}) {
  const running = phase === "running" || phase === "interrupting";
  if (!promptId || !running) {
    return { visible: false, enabled: false, label: "INTERROMPI RENDER" };
  }
  if (phase === "interrupting" || interruptPending) {
    return { visible: true, enabled: false, label: "Interruzione…" };
  }
  if (!ownershipControllable) {
    return { visible: true, enabled: false, label: "INTERROMPI RENDER" };
  }
  return { visible: true, enabled: true, label: "INTERROMPI RENDER" };
}

export function findActiveBatchJob(jobs = []) {
  return jobs.find(job => job?.state === "running" || job?.state === "interrupting") || null;
}

export function batchHasActiveWork(jobs = []) {
  return Array.isArray(jobs) && jobs.some(job => !isTerminalBatchState(job?.state));
}

export function batchCurrentInterruptActionable({
  jobs,
  ownershipControllable,
  interruptPending
} = {}) {
  const active = findActiveBatchJob(jobs);
  if (!active?.promptId || !batchHasActiveWork(jobs)) {
    return { visible: false, enabled: false };
  }
  if (active.state === "interrupting" || interruptPending) {
    return { visible: true, enabled: false };
  }
  return { visible: true, enabled: Boolean(ownershipControllable) };
}

export function batchStopActionable({
  jobs,
  ownershipControllable,
  stopPending
} = {}) {
  if (!batchHasActiveWork(jobs)) return { visible: false, enabled: false };
  if (stopPending) return { visible: true, enabled: false };
  return { visible: true, enabled: Boolean(ownershipControllable) };
}

export function batchCurrentInterruptConfirmMessage(jobLabel = "job corrente") {
  return `Interrompere ${jobLabel}?\nIl job corrente verrà interrotto.\nI job successivi già in coda del Batch CONTINUERANNO automaticamente.`;
}

export function batchStopConfirmMessage() {
  return [
    "Interrompere l'intero Batch?",
    "",
    "- il job attualmente in esecuzione verrà interrotto;",
    "- i job ancora in coda appartenenti a QUESTO Batch verranno cancellati;",
    "- i job già completati resteranno intatti;",
    "- eventuali altri job ComfyUI non appartenenti a questo Batch non verranno toccati."
  ].join("\n");
}

export function applyBatchStopResult(jobs = [], result = {}) {
  const cancelled = new Set(result.cancelledPromptIds || []);
  const interrupted = new Set([
    ...(result.interruptedPromptIds || []),
    ...(result.interruptedPromptId ? [result.interruptedPromptId] : [])
  ]);
  return jobs.map(job => {
    if (cancelled.has(job.promptId)) return { ...job, state: "cancelled" };
    if (interrupted.has(job.promptId) && job.state !== "completed") {
      return { ...job, state: "interrupting" };
    }
    return { ...job };
  });
}
