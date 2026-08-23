/**
 * Pure helpers for ComfyUI GET /queue payloads (Issue #51).
 * Queue tuple shape after sanitization: [number, prompt_id, prompt, extra_data, outputs_to_execute]
 * prompt_id is always index 1.
 */

export function extractPromptIdFromQueueEntry(entry) {
  if (Array.isArray(entry)) return String(entry[1] || "").trim();
  if (entry && typeof entry === "object") {
    return String(entry.prompt_id || entry.promptId || entry[1] || "").trim();
  }
  return "";
}

export function parseComfyQueuePayload(payload = {}) {
  const running = Array.isArray(payload.queue_running) ? payload.queue_running : [];
  const pending = Array.isArray(payload.queue_pending) ? payload.queue_pending : [];
  const runningPromptIds = running.map(extractPromptIdFromQueueEntry).filter(Boolean);
  const pendingPromptIds = pending.map(extractPromptIdFromQueueEntry).filter(Boolean);
  return {
    running,
    pending,
    runningPromptIds,
    pendingPromptIds,
    runningCount: runningPromptIds.length,
    pendingCount: pendingPromptIds.length
  };
}

export function getCurrentRunningPromptId(queue = {}) {
  return queue.runningPromptIds?.[0] || null;
}
