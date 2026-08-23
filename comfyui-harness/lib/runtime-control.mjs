/**
 * Pure ownership-safe runtime interruption planners (Issue #51).
 */

import { getCurrentRunningPromptId, parseComfyQueuePayload } from "./comfy-queue.mjs";

const MISMATCH_MSG = "Il job attivo non corrisponde al render controllato dal Director.";

export function ownershipControllable(registry, { promptId, batchId } = {}) {
  if (promptId) {
    const entry = registry.get(promptId);
    return entry ? { controllable: true, ...entry } : { controllable: false, reason: "ownership-missing" };
  }
  if (batchId) {
    const owned = registry.listByBatchId(batchId);
    return owned.length
      ? { controllable: true, kind: "batch", batchId: String(batchId), ownedCount: owned.length, owned }
      : { controllable: false, reason: "ownership-missing" };
  }
  return { controllable: false, reason: "missing-target" };
}

export function planSingleInterrupt({ expectedPromptId, queuePayload, registry }) {
  const expected = String(expectedPromptId || "").trim();
  if (!expected) return { ok: false, code: "missing-prompt-id", error: "promptId mancante." };

  const ownership = registry.get(expected);
  if (!ownership || ownership.kind !== "single") {
    return {
      ok: false,
      code: "ownership-missing",
      error: "Controllo interruzione non disponibile per questo job dopo il riavvio del Director."
    };
  }

  const queue = parseComfyQueuePayload(queuePayload);
  const runningId = getCurrentRunningPromptId(queue);
  if (!runningId) {
    return { ok: false, code: "nothing-running", error: "Nessun render in esecuzione." };
  }
  if (runningId !== expected) {
    return { ok: false, code: "prompt-mismatch", error: MISMATCH_MSG };
  }

  return { ok: true, interruptPromptId: expected, pendingToDelete: [], unrelatedPreserved: queue.pendingCount };
}

export function planBatchCurrentInterrupt({ batchId, expectedPromptId, queuePayload, registry }) {
  const bid = String(batchId || "").trim();
  const expected = String(expectedPromptId || "").trim();
  if (!bid || !expected) return { ok: false, code: "missing-ids", error: "batchId o promptId mancante." };

  const owned = registry.listByBatchId(bid);
  if (!owned.length) {
    return {
      ok: false,
      code: "ownership-missing",
      error: "Controllo interruzione non disponibile per questo Batch dopo il riavvio del Director."
    };
  }
  const ownedIds = new Set(owned.map(entry => entry.promptId));
  if (!ownedIds.has(expected)) {
    return { ok: false, code: "ownership-mismatch", error: "Il prompt non appartiene a questo Batch." };
  }

  const queue = parseComfyQueuePayload(queuePayload);
  const runningId = getCurrentRunningPromptId(queue);
  if (!runningId) {
    return { ok: false, code: "nothing-running", error: "Nessun job Batch in esecuzione." };
  }
  if (runningId !== expected) {
    return { ok: false, code: "prompt-mismatch", error: MISMATCH_MSG };
  }

  return {
    ok: true,
    interruptPromptId: expected,
    pendingToDelete: [],
    unrelatedPreserved: queue.pendingPromptIds.filter(id => !ownedIds.has(id)).length
  };
}

export function planBatchStop({ batchId, expectedRunningPromptId, queuePayload, registry }) {
  const bid = String(batchId || "").trim();
  const expectedRunning = String(expectedRunningPromptId || "").trim();
  if (!bid) return { ok: false, code: "missing-batch-id", error: "batchId mancante." };

  const owned = registry.listByBatchId(bid);
  if (!owned.length) {
    return {
      ok: false,
      code: "ownership-missing",
      error: "Controllo interruzione non disponibile per questo Batch dopo il riavvio del Director."
    };
  }

  const ownedIds = new Set(owned.map(entry => entry.promptId));
  const queue = parseComfyQueuePayload(queuePayload);
  const runningId = getCurrentRunningPromptId(queue);

  let interruptPromptId = null;
  if (runningId && ownedIds.has(runningId)) {
    if (expectedRunning && runningId !== expectedRunning) {
      return { ok: false, code: "prompt-mismatch", error: MISMATCH_MSG };
    }
    interruptPromptId = runningId;
  } else if (expectedRunning && ownedIds.has(expectedRunning)) {
    // Race: expected job no longer running — do not interrupt an unrelated successor.
    return { ok: false, code: "prompt-not-running", error: "Il job atteso non è più in esecuzione." };
  }

  const pendingToDelete = queue.pendingPromptIds.filter(id => ownedIds.has(id));
  const unrelatedPreserved = queue.pendingPromptIds.filter(id => !ownedIds.has(id)).length;

  if (!interruptPromptId && !pendingToDelete.length) {
    return { ok: false, code: "nothing-to-stop", error: "Nessun job Batch attivo o in coda." };
  }

  return {
    ok: true,
    interruptPromptId,
    pendingToDelete,
    unrelatedPreserved
  };
}

export function verifyPendingDeletions(beforeIds = [], afterIds = [], attempted = []) {
  const after = new Set(afterIds);
  const cancelled = [];
  const skipped = [];
  for (const id of attempted) {
    if (after.has(id)) skipped.push(id);
    else cancelled.push(id);
  }
  return { cancelled, skipped, unrelatedStillPending: beforeIds.filter(id => !attempted.includes(id) && after.has(id)) };
}

export function formatBatchStopSummary(jobs = []) {
  let completed = 0;
  let interrupted = 0;
  let cancelled = 0;
  for (const job of jobs) {
    const state = String(job?.state || "");
    if (state === "completed") completed += 1;
    else if (state === "interrupted") interrupted += 1;
    else if (state === "cancelled") cancelled += 1;
  }
  const parts = [];
  if (completed) parts.push(`${completed} completati`);
  if (interrupted) parts.push(`${interrupted} interrotti`);
  if (cancelled) parts.push(`${cancelled} annullati`);
  return parts.join(" · ") || "0 job";
}
