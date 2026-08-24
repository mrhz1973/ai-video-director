/**
 * Pure helpers for executing one queued Batch entry (Issue #47).
 */

import { submitBatchSequentially } from "../public/batch-core.mjs";
import { entryBatchTerminalFromJobs } from "./batch-queue-runtime.mjs";
import { QUEUE_ENTRY_STATE } from "./batch-queue-plan.mjs";

export function initEntryRuntimeJobs(entry) {
  const items = entry?.snapshot?.items || [];
  return items.map((item, index) => ({
    queueJobId: String(item.queueJobId || `${entry.queueEntryId}:job:${index}`),
    index,
    label: `Job ${index + 1}`,
    promptId: null,
    state: "pending",
    item
  }));
}

export function markJobSubmitted(jobs, index, promptId) {
  return jobs.map((job, i) => i === index
    ? { ...job, promptId, state: "pending" }
    : job);
}

export function applyHistoryStates(jobs = [], historyByPromptId = {}) {
  return jobs.map(job => {
    if (!job.promptId) return job;
    const historyState = historyByPromptId[job.promptId];
    if (historyState === "completed") return { ...job, state: "completed" };
    if (historyState === "interrupted") return { ...job, state: "interrupted" };
    if (historyState === "failed") return { ...job, state: "error" };
    return job;
  });
}

export function applyActivePrompt(jobs = [], activePromptId = null) {
  if (!activePromptId) return jobs;
  return jobs.map(job => {
    if (job.promptId === activePromptId && !["completed", "error", "interrupted", "cancelled"].includes(job.state)) {
      return { ...job, state: "running" };
    }
    if (job.state === "running" && job.promptId !== activePromptId) {
      return { ...job, state: "pending" };
    }
    return job;
  });
}

export function allJobsTerminal(jobs = []) {
  const terminal = new Set(["completed", "error", "interrupted", "cancelled", "not-submitted"]);
  return jobs.length > 0 && jobs.every(job => terminal.has(job.state));
}

export function entryRuntimeSummary(jobs = []) {
  const terminalState = entryBatchTerminalFromJobs(jobs);
  return {
    jobs,
    entryState: terminalState === QUEUE_ENTRY_STATE.COMPLETED
      ? QUEUE_ENTRY_STATE.COMPLETED
      : terminalState
  };
}

export async function executeEntryJobs({
  entry,
  jobs,
  submit,
  submittedMap,
  batchId,
  queueRunId,
  queueEntryId
}) {
  const items = entry.snapshot.items || [];
  const result = await submitBatchSequentially(items, async (item, index) => {
    const job = jobs[index];
    const queueJobId = job?.queueJobId || `${queueEntryId}:job:${index}`;
    if (submittedMap.has(queueJobId)) {
      return { prompt_id: submittedMap.get(queueJobId) };
    }
    const response = await submit({
      item,
      index,
      batchId,
      queueRunId,
      queueEntryId,
      queueJobId,
      snapshot: entry.snapshot
    });
    if (!response?.prompt_id) throw new Error("Submission returned no prompt_id");
    submittedMap.set(queueJobId, response.prompt_id);
    return response;
  });
  const nextJobs = [...jobs];
  for (const accepted of result.accepted) {
    nextJobs[accepted.index] = {
      ...nextJobs[accepted.index],
      promptId: accepted.prompt_id,
      state: "pending"
    };
  }
  if (result.failure) {
    for (let i = result.failure.index; i < nextJobs.length; i += 1) {
      if (!result.accepted.some(item => item.index === i)) {
        nextJobs[i] = { ...nextJobs[i], state: "not-submitted" };
      }
    }
  }
  return { jobs: nextJobs, submitResult: result };
}
