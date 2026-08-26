/**
 * Issue #95 — Batch add-to-queue gate (model authority + prepared-batch eligibility).
 */
import { describeModelSelectionBlocker } from "./h3-model-registry.mjs";

export const BATCH_ADD_TO_QUEUE_UNPREPARED_HELP =
  "Prepara almeno un job Batch prima di aggiungere alla Coda.";

/**
 * Unrelated Batch eligibility: prepared job count below minimum.
 * @param {{ preparedCount?: number, minBatchJobs?: number }} input
 */
export function batchAddToQueueBaseDisabled({ preparedCount = 0, minBatchJobs = 1 } = {}) {
  return preparedCount < minBatchJobs;
}

/**
 * Compose model gate + unrelated prepared-batch eligibility without losing either.
 * @param {{ registry?: object|null, selectedModel?: string, preparedCount?: number, minBatchJobs?: number }} input
 */
export function resolveBatchAddToQueueGate({
  registry = null,
  selectedModel = "",
  preparedCount = 0,
  minBatchJobs = 1
} = {}) {
  const modelBlock = describeModelSelectionBlocker(registry, selectedModel);
  const baseDisabled = batchAddToQueueBaseDisabled({ preparedCount, minBatchJobs });
  const disabled = baseDisabled || modelBlock.blocked;
  const disabledReason = modelBlock.blocked
    ? modelBlock.reason
    : (baseDisabled ? BATCH_ADD_TO_QUEUE_UNPREPARED_HELP : "");
  return {
    disabled,
    disabledReason,
    modelBlocked: modelBlock.blocked,
    baseDisabled,
    modelReason: modelBlock.reason || ""
  };
}
