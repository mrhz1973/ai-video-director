/**
 * Post-terminal Single Render readiness helpers (Issue #73).
 *
 * After a terminal event, ownership is cleared and history polling stops.
 * Queue readiness must come from an authoritative running/pending sample —
 * never from blindly forcing 0/0, and never from a stale last poll alone.
 */

import { resolveGenerateAction } from "./queue-coordinator.mjs";

/**
 * Map an authoritative Comfy queue sample (+ coordinator intents) to the
 * SCENA generate-button action after a terminal single-render event.
 */
export function resolvePostTerminalGenerateAction({
  running = 0,
  pending = 0,
  queuedNext = null,
  deferredBatch = null,
  batchActive = false,
  batchQueueArmed = false,
  lockOwner,
  blocked = false,
  reason = "",
  submitting = false
} = {}) {
  return resolveGenerateAction({
    running: Number(running || 0),
    pending: Number(pending || 0),
    queuedNext,
    deferredBatch,
    batchActive,
    batchQueueArmed,
    lockOwner,
    blocked,
    reason,
    submitting
  });
}

/**
 * Whether a terminal clear may keep the previous queue sample without a
 * fresh authoritative refresh. Always false: stale samples caused #73.
 */
export function mayRetainStaleQueueSampleAfterTerminal() {
  return false;
}
