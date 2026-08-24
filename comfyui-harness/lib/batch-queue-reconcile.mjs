/**
 * Ownership-safe plan/runtime reconciliation (Issue #47 review blockers).
 */

import {
  QUEUE_ENTRY_STATE,
  normalizeBatchQueuePlan,
  canEditQueueEntry
} from "./batch-queue-plan.mjs";

export const SERVER_AUTHORITATIVE_STATES = new Set([
  QUEUE_ENTRY_STATE.COMPLETED,
  QUEUE_ENTRY_STATE.FAILED,
  QUEUE_ENTRY_STATE.CANCELLED,
  QUEUE_ENTRY_STATE.SUBMITTING,
  QUEUE_ENTRY_STATE.RUNNING,
  QUEUE_ENTRY_STATE.RECOVERY_REQUIRED
]);

export function isServerAuthoritativeEntryState(state) {
  return SERVER_AUTHORITATIVE_STATES.has(String(state || ""));
}

export function hasUnresolvedRecoveryBefore(entries = [], targetOrder = Infinity) {
  return entries.some(entry =>
    entry.state === QUEUE_ENTRY_STATE.RECOVERY_REQUIRED
    && Number(entry.order) < Number(targetOrder)
  );
}

export function canSelectQueuedEntry(entry, entries = []) {
  if (entry?.state !== QUEUE_ENTRY_STATE.QUEUED) return false;
  return !hasUnresolvedRecoveryBefore(entries, entry.order);
}

/**
 * Merge browser/project plan into live server plan without downgrading authority.
 */
export function mergeIncomingPlanWithRuntime({
  serverPlan = null,
  incomingPlan = null,
  expectedRevision = null
} = {}) {
  const server = normalizeBatchQueuePlan(serverPlan);
  const incoming = normalizeBatchQueuePlan(incomingPlan);
  if (!server) {
    return { ok: true, plan: incoming, merged: Boolean(incoming) };
  }
  const staleRevision = expectedRevision != null && Number(expectedRevision) < Number(server.revision);
  if (staleRevision && incoming) {
    const incomingById = new Map(incoming.entries.map(entry => [entry.queueEntryId, entry]));
    const downgradeAttempt = server.entries.some(serverEntry => {
      const patch = incomingById.get(serverEntry.queueEntryId);
      return patch
        && isServerAuthoritativeEntryState(serverEntry.state)
        && String(patch.state) !== String(serverEntry.state);
    });
    if (!downgradeAttempt) {
      return { ok: false, code: "stale-revision", error: "Revisione coda non aggiornata." };
    }
  } else if (staleRevision) {
    return { ok: false, code: "stale-revision", error: "Revisione coda non aggiornata." };
  }
  if (!incoming) {
    return { ok: true, plan: server, merged: false };
  }

  const incomingById = new Map(incoming.entries.map(entry => [entry.queueEntryId, entry]));
  const mergedEntries = server.entries.map(serverEntry => {
    const patch = incomingById.get(serverEntry.queueEntryId);
    if (isServerAuthoritativeEntryState(serverEntry.state)) {
      return { ...serverEntry };
    }
    if (canEditQueueEntry(serverEntry) && patch && !staleRevision) {
      return {
        ...serverEntry,
        name: patch.name || serverEntry.name,
        snapshot: patch.snapshot || serverEntry.snapshot
      };
    }
    if (canEditQueueEntry(serverEntry) && patch && staleRevision) {
      return { ...serverEntry };
    }
    return { ...serverEntry };
  });

  if (!staleRevision) {
    for (const patch of incoming.entries) {
      if (!server.entries.some(entry => entry.queueEntryId === patch.queueEntryId)) {
        if (canEditQueueEntry(patch)) {
          mergedEntries.push({ ...patch, order: mergedEntries.length + 1 });
        }
      }
    }
  }

  const plan = {
    ...server,
    failurePolicy: staleRevision ? server.failurePolicy : (incoming.failurePolicy || server.failurePolicy),
    revision: staleRevision ? Number(server.revision) : Math.max(Number(server.revision), Number(incoming.revision)),
    entries: mergedEntries.map((entry, index) => ({ ...entry, order: index + 1 }))
  };
  return { ok: true, plan, merged: true, staleRevision: staleRevision || undefined };
}

export function resolveRecoveryEntryInPlan(plan, queueEntryId, resolution = "") {
  const normalized = normalizeBatchQueuePlan(plan);
  if (!normalized) return { ok: false, code: "empty-plan", error: "Coda vuota." };
  const index = normalized.entries.findIndex(entry => entry.queueEntryId === queueEntryId);
  if (index < 0) return { ok: false, code: "not-found", error: "Batch non trovato." };
  const entry = normalized.entries[index];
  if (entry.state !== QUEUE_ENTRY_STATE.RECOVERY_REQUIRED) {
    return { ok: false, code: "not-recovery", error: "Il batch non richiede recupero." };
  }
  const nextState = resolution === "completed"
    ? QUEUE_ENTRY_STATE.COMPLETED
    : resolution === "cancelled"
      ? QUEUE_ENTRY_STATE.CANCELLED
      : null;
  if (!nextState) {
    return { ok: false, code: "invalid-resolution", error: "Risoluzione non valida." };
  }
  const entries = [...normalized.entries];
  entries[index] = { ...entry, state: nextState };
  return {
    ok: true,
    plan: { ...normalized, revision: normalized.revision + 1, entries }
  };
}

