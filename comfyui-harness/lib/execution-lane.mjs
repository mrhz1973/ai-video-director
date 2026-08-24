/**
 * Server in-memory global ComfyUI execution-lane reservation (Issue #47).
 * Not persisted — Director restart clears authority (fail-closed).
 */

export const EXECUTION_LANE_KIND = Object.freeze({
  QUEUED_NEXT: "queued-next",
  DEFERRED_BATCH: "deferred-batch",
  ACTIVE_BATCH: "active-batch",
  MULTI_BATCH_QUEUE: "multi-batch-queue"
});

const FUTURE_KINDS = new Set([
  EXECUTION_LANE_KIND.QUEUED_NEXT,
  EXECUTION_LANE_KIND.DEFERRED_BATCH,
  EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE
]);

export function isFutureExecutionLaneKind(kind) {
  return FUTURE_KINDS.has(String(kind || ""));
}

export function createExecutionLaneRegistry({ now = () => Date.now() } = {}) {
  /** @type {null | { kind: string, ownerId: string, projectId: string|null, reservedAt: number }} */
  let reservation = null;

  function snapshot() {
    return reservation ? { ...reservation } : null;
  }

  return {
    get: snapshot,

    reserve({ kind, ownerId, projectId = null } = {}) {
      const nextKind = String(kind || "").trim();
      const nextOwner = String(ownerId || "").trim();
      if (!nextKind || !nextOwner) {
        return { ok: false, code: "invalid-reservation", error: "kind e ownerId sono obbligatori." };
      }
      if (reservation) {
        if (reservation.ownerId === nextOwner && reservation.kind === nextKind) {
          return { ok: true, status: "already-held", reservation: snapshot() };
        }
        return {
          ok: false,
          code: "lane-busy",
          error: "Esiste già un job/batch in attesa o una Coda Batch attiva. Attendi o annullalo prima.",
          reservation: snapshot()
        };
      }
      reservation = {
        kind: nextKind,
        ownerId: nextOwner,
        projectId: projectId == null ? null : String(projectId),
        reservedAt: now()
      };
      return { ok: true, reservation: snapshot() };
    },

    release({ ownerId, kind = null } = {}) {
      const nextOwner = String(ownerId || "").trim();
      if (!reservation) return { ok: true, status: "empty" };
      if (!nextOwner || reservation.ownerId !== nextOwner) {
        return { ok: false, code: "not-owner", error: "La lane non appartiene a questo owner.", reservation: snapshot() };
      }
      if (kind != null && String(kind) !== reservation.kind) {
        return { ok: false, code: "kind-mismatch", error: "Kind non corrispondente.", reservation: snapshot() };
      }
      reservation = null;
      return { ok: true, status: "released" };
    },

    /**
     * Atomically change kind for the same owner (e.g. deferred-batch → active-batch).
     * Avoids a release/reserve race window with other clients.
     */
    transferKind({ ownerId, kind } = {}) {
      const nextOwner = String(ownerId || "").trim();
      const nextKind = String(kind || "").trim();
      if (!reservation) return { ok: false, code: "empty", error: "Nessuna lane riservata." };
      if (!nextOwner || reservation.ownerId !== nextOwner) {
        return { ok: false, code: "not-owner", error: "La lane non appartiene a questo owner.", reservation: snapshot() };
      }
      if (!nextKind) return { ok: false, code: "invalid-reservation", error: "kind obbligatorio." };
      reservation = { ...reservation, kind: nextKind, reservedAt: now() };
      return { ok: true, reservation: snapshot() };
    },

    /** Test/helper: wipe in-memory authority. */
    clear() {
      reservation = null;
    }
  };
}
