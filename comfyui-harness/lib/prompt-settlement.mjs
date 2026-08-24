/**
 * Browser-independent Comfy prompt settlement for abandoned execution-lane txs.
 * Authoritative sources: GET /queue (still live) and GET /history/<id> (terminal).
 * Never infer terminal merely from queue absence without history confirmation.
 */

import { extractPromptIdFromQueueEntry } from "./comfy-queue.mjs";
import { PROMPT_STATE } from "./execution-lane.mjs";

export { PROMPT_STATE };

/**
 * Map Comfy history status messages to PROMPT_STATE.
 * @returns {string|null} terminal state or null if not terminal / missing
 */
export function promptStateFromHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const messages = entry.status?.messages || [];
  const types = messages.map(item => (Array.isArray(item) ? item[0] : item?.type)).filter(Boolean);
  if (types.includes("execution_success")) return PROMPT_STATE.COMPLETED;
  if (types.includes("execution_interrupted")) return PROMPT_STATE.INTERRUPTED;
  if (types.includes("execution_error")) return PROMPT_STATE.FAILED;
  return null;
}

export function promptIdInQueuePayload(payload, promptId) {
  const id = String(promptId || "").trim();
  if (!id) return false;
  const running = Array.isArray(payload?.queue_running) ? payload.queue_running : [];
  const pending = Array.isArray(payload?.queue_pending) ? payload.queue_pending : [];
  return [...running, ...pending].some(entry => extractPromptIdFromQueueEntry(entry) === id);
}

/**
 * @param {{
 *   comfyUrl: string,
 *   fetchFn?: typeof fetch
 * }} options
 */
export function createResolvePromptState({ comfyUrl, fetchFn = fetch } = {}) {
  const base = String(comfyUrl || "").replace(/\/$/, "");

  return async function resolvePromptState(promptId) {
    const id = String(promptId || "").trim();
    if (!id || !base) return PROMPT_STATE.UNKNOWN;

    let inQueue = false;
    try {
      const queueRes = await fetchFn(`${base}/queue`);
      if (!queueRes.ok) return PROMPT_STATE.UNKNOWN;
      const queueData = await queueRes.json();
      inQueue = promptIdInQueuePayload(queueData, id);
    } catch {
      return PROMPT_STATE.UNKNOWN;
    }

    if (inQueue) return PROMPT_STATE.RUNNING;

    try {
      const histRes = await fetchFn(`${base}/history/${encodeURIComponent(id)}`);
      if (!histRes.ok) return PROMPT_STATE.UNKNOWN;
      const histData = await histRes.json();
      const entry = histData?.[id];
      if (!entry) {
        // Not in queue and no history → uncertain (do NOT treat as done).
        return PROMPT_STATE.UNKNOWN;
      }
      const terminal = promptStateFromHistoryEntry(entry);
      if (terminal) return terminal;
      // History present but no terminal message yet.
      return PROMPT_STATE.RUNNING;
    } catch {
      return PROMPT_STATE.UNKNOWN;
    }
  };
}
