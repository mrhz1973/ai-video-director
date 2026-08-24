/**
 * Server in-memory global ComfyUI execution-lane reservation (Issue #47).
 * Not persisted — Director restart clears authority (fail-closed).
 *
 * Browser FUTURE intents bind to a server-issued pageSessionId (SSE connection).
 * JS heartbeat silence alone never makes a live page stealable.
 * FUTURE reclaim is allowed only after server-visible connection loss + grace.
 *
 * Destructive ops require leaseToken + matching pageSessionId.
 * Opaque lease in sessionStorage is insufficient without the live page session.
 *
 * MULTI_BATCH_QUEUE is server-owned (pageSessionId null).
 */

import { randomUUID } from "node:crypto";
import {
  createPageSessionRegistry,
  PAGE_SESSION_DISCONNECT_GRACE_MS
} from "./page-session.mjs";

export const EXECUTION_LANE_KIND = Object.freeze({
  QUEUED_NEXT: "queued-next",
  DEFERRED_BATCH: "deferred-batch",
  ACTIVE_BATCH: "active-batch",
  MULTI_BATCH_QUEUE: "multi-batch-queue",
  IMMEDIATE_SINGLE: "immediate-single"
});

/** @deprecated Heartbeat silence is not reclaim authority; kept for telemetry only. */
export const FUTURE_LANE_STALE_MS = 45_000;

export { PAGE_SESSION_DISCONNECT_GRACE_MS };

const FUTURE_KINDS = new Set([
  EXECUTION_LANE_KIND.QUEUED_NEXT,
  EXECUTION_LANE_KIND.DEFERRED_BATCH
]);

export function isFutureExecutionLaneKind(kind) {
  return FUTURE_KINDS.has(String(kind || ""));
}

function isServerOwnedKind(kind) {
  return String(kind || "") === EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE;
}

export function createExecutionLaneRegistry({
  now = () => Date.now(),
  pageSessions = createPageSessionRegistry({ now }),
  futureStaleMs = FUTURE_LANE_STALE_MS
} = {}) {
  void futureStaleMs; // retained for API compat; not used as reclaim authority
  /** @type {null | {
   *   kind: string,
   *   ownerId: string,
   *   projectId: string|null,
   *   pageSessionId: string|null,
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

  function leaseMatches(leaseToken) {
    const token = String(leaseToken || "").trim();
    return Boolean(token && reservation && reservation.leaseToken === token);
  }

  function pageSessionMatches(pageSessionId) {
    if (!reservation) return false;
    if (reservation.pageSessionId == null) {
      // Server-owned reservation: only server paths (null/empty page session).
      return pageSessionId == null || String(pageSessionId).trim() === "";
    }
    return String(pageSessionId || "").trim() === reservation.pageSessionId;
  }

  function isFutureReclaimable() {
    if (!reservation || !isFutureExecutionLaneKind(reservation.kind)) return false;
    if (!reservation.pageSessionId) return true;
    return !pageSessions.isProtected(reservation.pageSessionId);
  }

  function requireOwnerLeaseAndPage({ ownerId, leaseToken, pageSessionId } = {}) {
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
    if (!pageSessionMatches(pageSessionId)) {
      return {
        ok: false,
        code: "invalid-page-session",
        error: "Page session non corrispondente alla reservation.",
        reservation: publicSnapshot()
      };
    }
    return { ok: true };
  }

  return {
    get: publicSnapshot,
    pageSessions,

    reserve({ kind, ownerId, projectId = null, pageSessionId = null } = {}) {
      const nextKind = String(kind || "").trim();
      const nextOwner = String(ownerId || "").trim();
      if (!nextKind || !nextOwner) {
        return { ok: false, code: "invalid-reservation", error: "kind e ownerId sono obbligatori." };
      }

      const serverOwned = isServerOwnedKind(nextKind);
      const nextPage = pageSessionId == null ? null : String(pageSessionId).trim() || null;

      if (!serverOwned) {
        if (!nextPage || !pageSessions.isConnected(nextPage)) {
          return {
            ok: false,
            code: "page-session-required",
            error: "Serve una page session SSE viva per riservare la lane."
          };
        }
      }

      // Atomic FUTURE recovery only after server-visible connection loss (+ grace).
      if (isFutureReclaimable()) {
        reservation = null;
      }

      if (reservation) {
        return {
          ok: false,
          code: "lane-busy",
          error: "Esiste già un job/batch in attesa o una Coda Batch attiva. Attendi o annullalo prima.",
          reservation: publicSnapshot(),
          reclaimable: isFutureReclaimable()
        };
      }

      const ts = now();
      const leaseToken = randomUUID();
      reservation = {
        kind: nextKind,
        ownerId: nextOwner,
        projectId: projectId == null ? null : String(projectId),
        pageSessionId: serverOwned ? null : nextPage,
        reservedAt: ts,
        lastHeartbeatAt: ts,
        generation: 1,
        leaseToken
      };
      return { ok: true, reservation: publicSnapshot(), leaseToken };
    },

    /** Secondary telemetry only — does not authorize reclaim. */
    heartbeat({ ownerId, leaseToken, pageSessionId } = {}) {
      const gate = requireOwnerLeaseAndPage({ ownerId, leaseToken, pageSessionId });
      if (!gate.ok) return gate;
      reservation.lastHeartbeatAt = now();
      return { ok: true, reservation: publicSnapshot() };
    },

    release({ ownerId, kind = null, leaseToken, pageSessionId } = {}) {
      if (!reservation) return { ok: true, status: "empty" };
      const gate = requireOwnerLeaseAndPage({ ownerId, leaseToken, pageSessionId });
      if (!gate.ok) return gate;
      if (kind != null && String(kind) !== reservation.kind) {
        return { ok: false, code: "kind-mismatch", error: "Kind non corrispondente.", reservation: publicSnapshot() };
      }
      reservation = null;
      return { ok: true, status: "released" };
    },

    /**
     * Atomically change kind for the same owner (e.g. deferred-batch → active-batch).
     * Lease and pageSession stay the same.
     */
    transferKind({ ownerId, kind, leaseToken, pageSessionId } = {}) {
      const gate = requireOwnerLeaseAndPage({ ownerId, leaseToken, pageSessionId });
      if (!gate.ok) return gate;
      const nextKind = String(kind || "").trim();
      if (!nextKind) return { ok: false, code: "invalid-reservation", error: "kind obbligatorio." };
      if (isServerOwnedKind(nextKind)) {
        return { ok: false, code: "invalid-transfer", error: "Transfer verso multi-batch non consentito." };
      }
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
     * Reclaim FUTURE intent after owning page connection is dead past grace.
     * Does not restore execution intent. Active/multi/immediate never reclaimed here.
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
      if (!isFutureReclaimable()) {
        return {
          ok: false,
          code: "still-alive",
          error: "La page session proprietaria è ancora viva (connessione SSE o grace).",
          reservation: publicSnapshot()
        };
      }
      const previous = publicSnapshot();
      reservation = null;
      return {
        ok: true,
        status: "reclaimed",
        previous,
        requesterId: requesterId == null ? null : String(requesterId)
      };
    },

    /** Whether /api/queue may accept a submit for this lane owner + lease + page. */
    assertSubmitAllowed({ ownerId, kind = null, leaseToken = null, pageSessionId = null } = {}) {
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
      if (!pageSessionMatches(pageSessionId)) {
        return {
          ok: false,
          code: "invalid-page-session",
          error: "Page session non corrispondente alla reservation.",
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

    clear() {
      reservation = null;
    }
  };
}
