/**
 * Browser-safe execution-lane constants and pure predicates.
 * Shared by server runtime and public/execution-lane-client.mjs.
 */

export const EXECUTION_LANE_KIND = Object.freeze({
  QUEUED_NEXT: "queued-next",
  DEFERRED_BATCH: "deferred-batch",
  ACTIVE_BATCH: "active-batch",
  MULTI_BATCH_QUEUE: "multi-batch-queue",
  IMMEDIATE_SINGLE: "immediate-single"
});

/** @deprecated Heartbeat silence is not reclaim authority; kept for telemetry only. */
export const FUTURE_LANE_STALE_MS = 45_000;

export const PROMPT_STATE = Object.freeze({
  RUNNING: "running",
  COMPLETED: "completed",
  INTERRUPTED: "interrupted",
  FAILED: "failed",
  UNKNOWN: "unknown"
});

const FUTURE_KINDS = new Set([
  EXECUTION_LANE_KIND.QUEUED_NEXT,
  EXECUTION_LANE_KIND.DEFERRED_BATCH
]);

const IN_FLIGHT_KINDS = new Set([
  EXECUTION_LANE_KIND.ACTIVE_BATCH,
  EXECUTION_LANE_KIND.IMMEDIATE_SINGLE
]);

const TERMINAL_COMFY_TYPES = new Set([
  "execution_success",
  "execution_error",
  "execution_interrupted"
]);

export function isFutureExecutionLaneKind(kind) {
  return FUTURE_KINDS.has(String(kind || ""));
}

export function isInFlightExecutionLaneKind(kind) {
  return IN_FLIGHT_KINDS.has(String(kind || ""));
}

export function terminalPromptIdFromComfyMessage(message) {
  let parsed = message;
  if (typeof message === "string") {
    try { parsed = JSON.parse(message); } catch { return null; }
  }
  const type = parsed?.type || parsed?.event;
  if (!TERMINAL_COMFY_TYPES.has(String(type || ""))) return null;
  const promptId = parsed?.data?.prompt_id || parsed?.prompt_id;
  return promptId ? String(promptId) : null;
}

export const TERMINAL_PROMPT_STATES = new Set([
  PROMPT_STATE.COMPLETED,
  PROMPT_STATE.INTERRUPTED,
  PROMPT_STATE.FAILED
]);
