/**
 * Queue runtime → CLIP SESSIONE reconstruction helpers.
 * Metadata only until real /api/outputs rows are attached.
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

export function buildQueueSessionJobMeta(job = {}) {
  const item = job.item || {};
  const promptId = String(job.promptId || "").trim();
  if (!promptId) return null;
  return {
    promptId,
    source: "batch",
    jobLabel: `Job ${Number(job.jobIndex) + 1}`,
    jobIndex: Number.isFinite(Number(job.jobIndex)) ? Number(job.jobIndex) : null,
    batchTotal: null,
    workflowId: job.workflowId || "",
    workflowLabel: job.workflowLabel || "",
    model: job.model || "",
    seed: item.seed == null ? "" : String(item.seed),
    duration: item.duration == null ? null : String(item.duration),
    megapixels: item.megapixels == null ? "" : String(item.megapixels),
    aspect: item.aspect == null ? "" : String(item.aspect),
    steps: item.steps == null ? "" : String(item.steps),
    queueEntryId: job.queueEntryId || "",
    queueBatchName: job.queueBatchName || "",
    queueJobId: job.queueJobId || "",
    completedAt: Date.now()
  };
}

/**
 * Build playable CLIP SESSIONE records from authoritative output rows + job meta.
 * Without filename/url rows this returns [] (fail-closed).
 */
export function buildQueueSessionOutputRecordsFromOutputs(outputItems, job, buildSessionOutputRecords) {
  if (typeof buildSessionOutputRecords !== "function") {
    throw new Error("buildSessionOutputRecords required");
  }
  const meta = buildQueueSessionJobMeta(job);
  if (!meta) return [];
  const items = Array.isArray(outputItems) ? outputItems : [];
  if (!items.length) return [];
  return buildSessionOutputRecords(items, meta);
}

/** @deprecated metadata-only records are not playable; use buildQueueSessionOutputRecordsFromOutputs */
export function buildQueueSessionOutputRecord(job) {
  return buildQueueSessionJobMeta(job);
}

export function buildQueueSessionOutputRecords(jobs = []) {
  return jobs.map(buildQueueSessionJobMeta).filter(Boolean);
}

export function escapeQueueDisplayText(value = "") {
  return String(value ?? "");
}
