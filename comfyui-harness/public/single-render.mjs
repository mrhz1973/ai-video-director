/**
 * Issue #53 — explicit Single Render path independent from Batch.
 * Payload comes only from current editor / Input bindings, never from Batch items.
 */

import { normalizeDurationSeconds } from "../lib/duration.mjs";
import { isValidMegapixels } from "./resolution.mjs";
import {
  BATCH_EXECUTION_LABELS,
  SINGLE_RENDER_ACTION_LABELS
} from "./queue-coordinator.mjs";

export { BATCH_EXECUTION_LABELS, SINGLE_RENDER_ACTION_LABELS };

export const SINGLE_RENDER_KIND = "single";

export const BATCH_OPTIONAL_HEADING = "BATCH — job preparati";


export function singleRenderSideEffects() {
  return Object.freeze({
    batchPrepare: false,
    batchMutation: false,
    batchSubmit: false,
    batchDraftWrite: false,
    readsBatchCount: false,
    createsSyntheticBatch: false
  });
}

/**
 * Pure queue payload for exactly one clip from current editor controls.
 * Does not read Batch count, items, source, or item.files.
 */
export function buildSingleRenderPayload({
  clientId = "",
  workflowId = "",
  prompt = "",
  megapixels,
  model = "",
  steps,
  duration,
  aspect = "16:9",
  seed,
  files = {}
} = {}) {
  const trimmedPrompt = String(prompt ?? "").trim();
  const mp = Number(megapixels);
  if (!isValidMegapixels(megapixels)) {
    throw new Error(`Megapixel non valido: ${megapixels}`);
  }
  return Object.freeze({
    kind: SINGLE_RENDER_KIND,
    clientId: String(clientId || ""),
    workflowId: String(workflowId || ""),
    prompt: trimmedPrompt,
    megapixels: mp,
    model: String(model ?? ""),
    steps: steps,
    duration: normalizeDurationSeconds(duration),
    aspect: String(aspect || "16:9"),
    seed: seed,
    files: { ...(files || {}) }
  });
}

/** Strip render metadata before POST /api/queue. */
export function toSingleRenderQueueBody(intent) {
  assertSingleRenderIntent(intent);
  const { kind: _kind, ...body } = intent;
  return body;
}

export function assertSingleRenderIntent(intent = {}) {
  if (intent?.kind !== SINGLE_RENDER_KIND) {
    throw new Error("Expected single render intent");
  }
  return intent;
}
