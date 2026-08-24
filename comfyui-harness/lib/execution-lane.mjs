/**
 * Server in-memory global ComfyUI execution-lane reservation (Issue #47).
 * Not persisted — Director restart clears authority (fail-closed).
 *
 * Future browser intents (queued-next / deferred-batch) require heartbeats.
 * Stale future reservations can be reclaimed without restoring execution intent.
 * Active / multi-queue / immediate-single kinds are not stale-reclaimable.
 */

export const EXECUTION_LANE_KIND = Object.freeze({
  QUEUED_NEXT: "queued-next",
  DEFERRED_BATCH: "deferred-batch",
  ACTIVE_BATCH: "active-batch",
  MULTI_BATCH_QUEUE: "multi-batch-queue",
  IMMEDIATE_SINGLE: "immediate-single"
});

/** Default silence before a future intent may be reclaimed (not a blind short TTL on live work). */
export const FUTURE_LANE_STALE_MS = 45_000;

const FUTURE_KINDS = new Set([
  EXECUTION_LANE_KIND.QUEUED_NEXT,
  EXECUTION_LANE_KIND.DEFERRED_BATCH
]);

export function isFutureExecutionLaneKind(kind) {
  return FUTURE_KINDS.has(String(kind || ""));
}

export function createExecutionLaneRegistry({
  now = () => Date.now(),
  futureStaleMs = FUTURE_LANE_STALE_MS
} = {}) {
  /** @type {null | {
   *   kind: string,
   *   ownerId: string,
   *   projectId: string|null,
   *   reservedAt: number,
   *   lastHeartbeatAt: number,
   *   generation: number
   * }} */
  let reservation = null;

  function snapshot() {
    return reservation ? { ...reservation } : null;
  }

  function silentMs(at = now()) {
    if (!reservation) return 0;
    const anchor = reservation.lastHeartbeatAt || reservation.reservedAt;
    return Math.max(0, at - anchor);
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
          reservation.lastHeartbeatAt = now();
          return { ok: true, status: "already-held", reservation: snapshot() };
        }
        return {
          ok: false,
          code: "lane-busy",
          error: "Esiste già un job/batch in attesa o una Coda Batch attiva. Attendi o annullalo prima.",
          reservation: snapshot(),
          reclaimable: isFutureExecutionLaneKind(reservation.kind)
            && silentMs() >= futureStaleMs
        };
      }
      const ts = now();
      reservation = {
        kind: nextKind,
        ownerId: nextOwner,
        projectId: projectId == null ? null : String(projectId),
        reservedAt: ts,
        lastHeartbeatAt: ts,
        generation: 1
      };
      return { ok: true, reservation: snapshot() };
    },

    heartbeat({ ownerId } = {}) {
      const nextOwner = String(ownerId || "").trim();
      if (!reservation) return { ok: false, code: "empty", error: "Nessuna lane riservata." };
      if (!nextOwner || reservation.ownerId !== nextOwner) {
        return { ok: false, code: "not-owner", error: "La lane non appartiene a questo owner.", reservation: snapshot() };
      }
      reservation.lastHeartbeatAt = now();
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
      const ts = now();
      reservation = {
        ...reservation,
        kind: nextKind,
        reservedAt: ts,
        lastHeartbeatAt: ts,
        generation: Number(reservation.generation || 1) + 1
      };
      return { ok: true, reservation: snapshot() };
    },

    /**
     * Reclaim a future browser intent whose heartbeat went silent (F5 / tab close / crash).
     * Does not restore execution intent. Active/multi/immediate kinds are never reclaimed this way.
     */
    reclaimStale({ requesterId = null, staleAfterMs = futureStaleMs } = {}) {
      if (!reservation) return { ok: true, status: "empty" };
      if (!isFutureExecutionLaneKind(reservation.kind)) {
        return {
          ok: false,
          code: "not-reclaimable",
          error: "Solo intent futuri browser (queued-next / deferred-batch) possono essere reclamati.",
          reservation: snapshot()
        };
      }
      const silent = silentMs();
      if (silent < Number(staleAfterMs)) {
        return {
          ok: false,
          code: "still-alive",
          error: "La reservation futura è ancora viva (heartbeat recente).",
          reservation: snapshot(),
          silentMs: silent,
          staleAfterMs: Number(staleAfterMs)
        };
      }
      const previous = snapshot();
      reservation = null;
      return {
        ok: true,
        status: "reclaimed",
        previous,
        requesterId: requesterId == null ? null : String(requesterId),
        silentMs: silent
      };
    },

    /** Whether /api/queue may accept a submit for this lane owner. */
    assertSubmitAllowed({ ownerId, kind = null } = {}) {
      if (!reservation) return { ok: true, status: "lane-empty" };
      const nextOwner = String(ownerId || "").trim();
      if (!nextOwner || reservation.ownerId !== nextOwner) {
        return {
          ok: false,
          code: "lane-busy",
          error: "Un altro client detiene la lane di esecuzione.",
          reservation: snapshot()
        };
      }
      if (kind != null && String(kind) !== reservation.kind) {
        return {
          ok: false,
          code: "kind-mismatch",
          error: "Kind lane non corrispondente alla reservation.",
          reservation: snapshot()
        };
      }
      return { ok: true, reservation: snapshot() };
    },

    /** Test/helper: wipe in-memory authority. */
    clear() {
      reservation = null;
    }
  };
}
