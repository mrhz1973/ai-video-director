/**
 * Queue runtime → CLIP SESSIONE reconstruction helpers (Issue #47 blockers).
 */

export function queueSessionOutputKey(promptId) {
  return String(promptId || "").trim();
}

export function selectCompletedQueueJobsForSession({
  acceptedJobs = [],
  historyByPromptId = {},
  existingPromptIds = new Set()
} = {}) {
  const out = [];
  for (const job of acceptedJobs) {
    const promptId = String(job.promptId || "").trim();
    if (!promptId || existingPromptIds.has(promptId)) continue;
    const history = historyByPromptId[promptId] || job.historyState || job.state;
    if (history !== "completed" && job.state !== "completed") continue;
    out.push(job);
  }
  return out;
}

export function buildQueueSessionOutputRecord(job) {
  const item = job.item || {};
  const promptId = String(job.promptId || "").trim();
  if (!promptId) return null;
  return {
    promptId,
    source: "batch",
    jobLabel: `Job ${Number(job.jobIndex) + 1}`,
    jobIndex: Number(job.jobIndex),
    batchTotal: null,
    workflowId: job.workflowId || "",
    workflowLabel: job.workflowLabel || "",
    model: job.model || "",
    seed: item.seed == null ? "" : String(item.seed),
    duration: item.duration == null ? null : String(item.duration),
    megapixels: item.megapixels == null ? "" : String(item.megapixels),
    aspect: item.aspect == null ? "" : String(item.aspect),
    steps: item.steps == null ? "" : String(item.steps),
    queueEntryId: job.queueEntryId,
    queueBatchName: job.queueBatchName,
    queueJobId: job.queueJobId,
    completedAt: Date.now(),
    available: true
  };
}

export function buildQueueSessionOutputRecords(jobs = []) {
  return jobs.map(buildQueueSessionOutputRecord).filter(Boolean);
}

export function escapeQueueDisplayText(value = "") {
  return String(value ?? "");
}
