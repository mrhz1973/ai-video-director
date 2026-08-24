/**
 * Server in-memory global ComfyUI execution-lane reservation (Issue #47).
 * Not persisted — Director restart clears authority (fail-closed).
 *
 * Future browser intents (queued-next / deferred-batch) require heartbeats.
 * Stale FUTURE reservations are atomically reclaimed on the next reserve()
 * after the server-authoritative silence window (no client-tunable TTL).
 * Active / multi-queue / immediate-single kinds are not stale-reclaimable.
 *
 * Authority is an opaque in-memory leaseToken — ownerId alone is not enough.
 */

import { randomUUID } from "node:crypto";

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
   *   generation: number,
   *   leaseToken: string
   * }} */
  let reservation = null;

  function publicSnapshot() {
    if (!reservation) return null;
    const { leaseToken: _lease, ...rest } = reservation;
    void _lease;
    return { ...rest };
  }

  function silentMs(at = now()) {
    if (!reservation) return 0;
    const anchor = reservation.lastHeartbeatAt || reservation.reservedAt;
    return Math.max(0, at - anchor);
  }

  function isStaleFuture() {
    return Boolean(
      reservation
      && isFutureExecutionLaneKind(reservation.kind)
      && silentMs() >= futureStaleMs
    );
  }

  function leaseMatches(leaseToken) {
    const token = String(leaseToken || "").trim();
    return Boolean(token && reservation && reservation.leaseToken === token);
  }

  function requireOwnerAndLease({ ownerId, leaseToken } = {}) {
    const nextOwner = String(ownerId || "").trim();
    if (!reservation) {
      return { ok: false, code: "empty", error: "Nessuna lane riservata." };
    }
    if (!nextOwner || reservation.ownerId !== nextOwner) {
      return {
        ok: false,
        code: "not-owner",
        error: "La lane non appartiene a questo owner.",
        reservation: publicSnapshot()
      };
    }
    if (!leaseMatches(leaseToken)) {
      return {
        ok: false,
        code: "invalid-lease",
        error: "Lease token non valido o mancante.",
        reservation: publicSnapshot()
      };
    }
    return { ok: true };
  }

  return {
    get: publicSnapshot,

    reserve({ kind, ownerId, projectId = null } = {}) {
      const nextKind = String(kind || "").trim();
      const nextOwner = String(ownerId || "").trim();
      if (!nextKind || !nextOwner) {
        return { ok: false, code: "invalid-reservation", error: "kind e ownerId sono obbligatori." };
      }
      // Atomic stale FUTURE recovery: clear dead browser intent before granting.
      if (isStaleFuture()) {
        reservation = null;
      }
      if (reservation) {
        // Same ownerId+kind is still lane-busy — ownership is the lease, not the string.
        return {
          ok: false,
          code: "lane-busy",
          error: "Esiste già un job/batch in attesa o una Coda Batch attiva. Attendi o annullalo prima.",
          reservation: publicSnapshot(),
          reclaimable: isFutureExecutionLaneKind(reservation.kind)
            && silentMs() >= futureStaleMs
        };
      }
      const ts = now();
      const leaseToken = randomUUID();
      reservation = {
        kind: nextKind,
        ownerId: nextOwner,
        projectId: projectId == null ? null : String(projectId),
        reservedAt: ts,
        lastHeartbeatAt: ts,
        generation: 1,
        leaseToken
      };
      return { ok: true, reservation: publicSnapshot(), leaseToken };
    },

    heartbeat({ ownerId, leaseToken } = {}) {
      const gate = requireOwnerAndLease({ ownerId, leaseToken });
      if (!gate.ok) return gate;
      reservation.lastHeartbeatAt = now();
      return { ok: true, reservation: publicSnapshot() };
    },

    release({ ownerId, kind = null, leaseToken } = {}) {
      if (!reservation) return { ok: true, status: "empty" };
      const gate = requireOwnerAndLease({ ownerId, leaseToken });
      if (!gate.ok) return gate;
      if (kind != null && String(kind) !== reservation.kind) {
        return { ok: false, code: "kind-mismatch", error: "Kind non corrispondente.", reservation: publicSnapshot() };
      }
      reservation = null;
      return { ok: true, status: "released" };
    },

    /**
     * Atomically change kind for the same owner (e.g. deferred-batch → active-batch).
     * Avoids a release/reserve race window with other clients. Lease stays the same.
     */
    transferKind({ ownerId, kind, leaseToken } = {}) {
      const gate = requireOwnerAndLease({ ownerId, leaseToken });
      if (!gate.ok) return gate;
      const nextKind = String(kind || "").trim();
      if (!nextKind) return { ok: false, code: "invalid-reservation", error: "kind obbligatorio." };
      const ts = now();
      reservation = {
        ...reservation,
        kind: nextKind,
        reservedAt: ts,
        lastHeartbeatAt: ts,
        generation: Number(reservation.generation || 1) + 1
      };
      return { ok: true, reservation: publicSnapshot(), leaseToken: reservation.leaseToken };
    },

    /**
     * Reclaim a future browser intent whose heartbeat went silent (F5 / tab close / crash).
     * Staleness is always server-authoritative — client staleAfterMs is ignored.
     * Does not restore execution intent. Active/multi/immediate kinds are never reclaimed this way.
     */
    reclaimStale({ requesterId = null } = {}) {
      if (!reservation) return { ok: true, status: "empty" };
      if (!isFutureExecutionLaneKind(reservation.kind)) {
        return {
          ok: false,
          code: "not-reclaimable",
          error: "Solo intent futuri browser (queued-next / deferred-batch) possono essere reclamati.",
          reservation: publicSnapshot()
        };
      }
      const silent = silentMs();
      if (silent < futureStaleMs) {
        return {
          ok: false,
          code: "still-alive",
          error: "La reservation futura è ancora viva (heartbeat recente).",
          reservation: publicSnapshot(),
          silentMs: silent,
          staleAfterMs: futureStaleMs
        };
      }
      const previous = publicSnapshot();
      reservation = null;
      return {
        ok: true,
        status: "reclaimed",
        previous,
        requesterId: requesterId == null ? null : String(requesterId),
        silentMs: silent
      };
    },

    /** Whether /api/queue may accept a submit for this lane owner + lease. */
    assertSubmitAllowed({ ownerId, kind = null, leaseToken = null } = {}) {
      if (!reservation) return { ok: true, status: "lane-empty" };
      const nextOwner = String(ownerId || "").trim();
      if (!nextOwner || reservation.ownerId !== nextOwner) {
        return {
          ok: false,
          code: "lane-busy",
          error: "Un altro client detiene la lane di esecuzione.",
          reservation: publicSnapshot()
        };
      }
      if (!leaseMatches(leaseToken)) {
        return {
          ok: false,
          code: "invalid-lease",
          error: "Lease token non valido o mancante.",
          reservation: publicSnapshot()
        };
      }
      if (kind != null && String(kind) !== reservation.kind) {
        return {
          ok: false,
          code: "kind-mismatch",
          error: "Kind lane non corrispondente alla reservation.",
          reservation: publicSnapshot()
        };
      }
      return { ok: true, reservation: publicSnapshot() };
    },

    /** Test/helper: wipe in-memory authority. */
    clear() {
      reservation = null;
    }
  };
}
