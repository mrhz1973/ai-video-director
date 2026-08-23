/**
 * Server-side runtime interruption executor (Issue #51).
 */

import {
  comfyDeletePendingPrompts,
  comfyInterruptPrompt,
  fetchComfyQueue
} from "./comfy-runtime-api.mjs";
import { parseComfyQueuePayload } from "./comfy-queue.mjs";
import {
  planBatchCurrentInterrupt,
  planBatchStop,
  planSingleInterrupt,
  verifyPendingDeletions
} from "./runtime-control.mjs";

export function createRuntimeControlService({
  comfyUrl,
  ownershipRegistry,
  fetchFn = fetch,
  logger = null
} = {}) {
  if (!comfyUrl) throw new Error("comfyUrl required");
  if (!ownershipRegistry) throw new Error("ownershipRegistry required");

  const singleInFlight = new Set();
  const batchStopInFlight = new Set();
  const batchCurrentInFlight = new Set();

  function log(event, fields = {}) {
    logger?.info?.(event, fields);
  }

  async function loadQueue() {
    const result = await fetchComfyQueue(comfyUrl, fetchFn);
    if (!result.ok) {
      const error = new Error("Impossibile leggere la coda ComfyUI.");
      error.code = "queue-fetch-failed";
      error.status = result.status || 502;
      throw error;
    }
    return result.data;
  }

  async function executePlan(plan, { inFlightKey, inFlightSet }) {
    if (inFlightSet.has(inFlightKey)) {
      return { ok: true, status: "already-in-flight" };
    }
    inFlightSet.add(inFlightKey);
    try {
      let interruptedPromptId = null;
      if (plan.interruptPromptId) {
        const interrupt = await comfyInterruptPrompt(comfyUrl, plan.interruptPromptId, fetchFn);
        if (!interrupt.ok) {
          const error = new Error("Interruzione ComfyUI non riuscita.");
          error.code = "interrupt-failed";
          error.status = interrupt.status || 502;
          throw error;
        }
        interruptedPromptId = plan.interruptPromptId;
        log("runtime_interrupt_accepted", { prompt_id: plan.interruptPromptId?.slice?.(0, 8) });
      }

      let cancelledPromptIds = [];
      let skippedPromptIds = [];
      if (plan.pendingToDelete?.length) {
        const before = parseComfyQueuePayload(await loadQueue());
        const deleteResult = await comfyDeletePendingPrompts(comfyUrl, plan.pendingToDelete, fetchFn);
        if (!deleteResult.ok) {
          const error = new Error("Cancellazione coda ComfyUI non riuscita.");
          error.code = "delete-failed";
          error.status = deleteResult.status || 502;
          throw error;
        }
        const after = parseComfyQueuePayload(await loadQueue());
        const verified = verifyPendingDeletions(before.pendingPromptIds, after.pendingPromptIds, plan.pendingToDelete);
        cancelledPromptIds = verified.cancelled;
        skippedPromptIds = verified.skipped;
        log("batch_stop_cancelled_pending", {
          cancelled: cancelledPromptIds.length,
          skipped: skippedPromptIds.length
        });
      }

      return {
        ok: true,
        interruptedPromptId,
        cancelledPromptIds,
        skippedPromptIds,
        unrelatedPreserved: plan.unrelatedPreserved ?? 0
      };
    } finally {
      inFlightSet.delete(inFlightKey);
    }
  }

  return {
    registry: ownershipRegistry,

    registerQueueAcceptance({ promptId, batchId, batchIndex, clientId }) {
      const kind = batchId ? "batch" : "single";
      const record = ownershipRegistry.register(promptId, {
        kind,
        batchId: batchId || null,
        batchIndex: batchIndex ?? null,
        clientId: clientId || null,
        acceptedAt: Date.now()
      });
      log("runtime_ownership_registered", {
        kind,
        prompt_id: String(promptId || "").slice(0, 8),
        batch_id: batchId ? String(batchId).slice(0, 8) : null
      });
      return record;
    },

    getOwnershipQuery({ promptId, batchId } = {}) {
      if (promptId) {
        const entry = ownershipRegistry.get(promptId);
        return entry
          ? { controllable: true, ...entry }
          : { controllable: false, reason: "ownership-missing" };
      }
      if (batchId) {
        const owned = ownershipRegistry.listByBatchId(batchId);
        return owned.length
          ? { controllable: true, kind: "batch", batchId, owned }
          : { controllable: false, reason: "ownership-missing" };
      }
      return { controllable: false, reason: "missing-target" };
    },

    async interruptSingle({ expectedPromptId }) {
      log("runtime_interrupt_request", { scope: "single", prompt_id: String(expectedPromptId || "").slice(0, 8) });
      const queuePayload = await loadQueue();
      const plan = planSingleInterrupt({ expectedPromptId, queuePayload, registry: ownershipRegistry });
      if (!plan.ok) {
        log("runtime_interrupt_rejected", { scope: "single", code: plan.code });
        const error = new Error(plan.error);
        error.code = plan.code;
        error.status = 409;
        throw error;
      }
      return executePlan(plan, { inFlightKey: expectedPromptId, inFlightSet: singleInFlight });
    },

    async interruptBatchCurrent({ batchId, expectedPromptId }) {
      log("runtime_interrupt_request", { scope: "batch-current", batch_id: String(batchId || "").slice(0, 8) });
      const queuePayload = await loadQueue();
      const plan = planBatchCurrentInterrupt({ batchId, expectedPromptId, queuePayload, registry: ownershipRegistry });
      if (!plan.ok) {
        log("runtime_interrupt_rejected", { scope: "batch-current", code: plan.code });
        const error = new Error(plan.error);
        error.code = plan.code;
        error.status = 409;
        throw error;
      }
      const key = `${batchId}:${expectedPromptId}`;
      return executePlan(plan, { inFlightKey: key, inFlightSet: batchCurrentInFlight });
    },

    async stopBatch({ batchId, expectedRunningPromptId }) {
      log("batch_stop_request", { batch_id: String(batchId || "").slice(0, 8) });
      const queuePayload = await loadQueue();
      const plan = planBatchStop({ batchId, expectedRunningPromptId, queuePayload, registry: ownershipRegistry });
      if (!plan.ok) {
        log("batch_stop_rejected", { code: plan.code });
        const error = new Error(plan.error);
        error.code = plan.code;
        error.status = 409;
        throw error;
      }
      return executePlan(plan, { inFlightKey: batchId, inFlightSet: batchStopInFlight });
    }
  };
}
