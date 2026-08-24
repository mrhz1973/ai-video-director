/**
 * Server in-memory global ComfyUI execution-lane reservation (Issue #47).
 * Not persisted — Director restart clears authority (fail-closed).
 *
 * Browser reservations bind to a server-issued pageSessionId (document identity).
 * SSE reconnects of the same document reattach that session while RECONNECTABLE.
 *
 * FUTURE reclaim: only after the owning page is ABANDONED (past reconnect window).
 * A RECONNECTABLE outage must not let a competing reserve steal FUTURE authority.
 *
 * ACTIVE_BATCH / IMMEDIATE_SINGLE: fail-closed while a submit transaction is live.
 * Accepted prompt settlement is SERVER-AUTHORITATIVE via resolvePromptState
 * (Comfy /history + /queue) — never exclusively via browser SSE delivery.
 *
 * Submit bookkeeping is bound to reservation generation + leaseToken so a
 * late completion cannot mutate a later unrelated reservation.
 *
 * MULTI_BATCH_QUEUE is server-owned (pageSessionId null).
 */

import { randomUUID } from "node:crypto";
import {
  createPageSessionRegistry,
  PAGE_SESSION_DISCONNECT_GRACE_MS,
  PAGE_SESSION_RECONNECT_WINDOW_MS,
  PAGE_SESSION_LIFECYCLE
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

export {
  PAGE_SESSION_DISCONNECT_GRACE_MS,
  PAGE_SESSION_RECONNECT_WINDOW_MS,
  PAGE_SESSION_LIFECYCLE
};

export const PROMPT_STATE = Object.freeze({
  RUNNING: "running",
  COMPLETED: "completed",
  INTERRUPTED: "interrupted",
  FAILED: "failed",
  UNKNOWN: "unknown"
});

const FUTURE_KINDS = new Set([
  EXECUTION_LANE_KIND.QUEUED_NEXT,
  EXECUTION_LANE_KIND.DEFERRED_BATCH
]);

const IN_FLIGHT_KINDS = new Set([
  EXECUTION_LANE_KIND.ACTIVE_BATCH,
  EXECUTION_LANE_KIND.IMMEDIATE_SINGLE
]);

const TERMINAL_COMFY_TYPES = new Set([
  "execution_success",
  "execution_error",
  "execution_interrupted"
]);

const TERMINAL_PROMPT_STATES = new Set([
  PROMPT_STATE.COMPLETED,
  PROMPT_STATE.INTERRUPTED,
  PROMPT_STATE.FAILED
]);

export function isFutureExecutionLaneKind(kind) {
  return FUTURE_KINDS.has(String(kind || ""));
}

export function isInFlightExecutionLaneKind(kind) {
  return IN_FLIGHT_KINDS.has(String(kind || ""));
}

function isServerOwnedKind(kind) {
  return String(kind || "") === EXECUTION_LANE_KIND.MULTI_BATCH_QUEUE;
}

export function terminalPromptIdFromComfyMessage(message) {
  let parsed = message;
  if (typeof message === "string") {
    try { parsed = JSON.parse(message); } catch { return null; }
  }
  const type = parsed?.type || parsed?.event;
  if (!TERMINAL_COMFY_TYPES.has(String(type || ""))) return null;
  const promptId = parsed?.data?.prompt_id || parsed?.prompt_id;
  return promptId ? String(promptId) : null;
}

export function createExecutionLaneRegistry({
  now = () => Date.now(),
  pageSessions = createPageSessionRegistry({ now }),
  futureStaleMs = FUTURE_LANE_STALE_MS,
  /**
   * Browser-independent Comfy settlement.
   * Must return PROMPT_STATE.* — never invent terminal from queue absence alone.
   */
  resolvePromptState = null
} = {}) {
  void futureStaleMs;
  /** @type {null | {
   *   kind: string,
   *   ownerId: string,
   *   projectId: string|null,
   *   pageSessionId: string|null,
   *   reservedAt: number,
   *   lastHeartbeatAt: number,
   *   generation: number,
   *   leaseToken: string,
   *   httpInFlight: number,
   *   acceptedPromptIds: Set<string>
   * }} */
  let reservation = null;

  function publicSnapshot() {
    if (!reservation) return null;
    const { leaseToken: _lease, httpInFlight: _http, acceptedPromptIds: _ids, ...rest } = reservation;
    void _lease;
    void _http;
    void _ids;
    return { ...rest };
  }

  function leaseMatches(leaseToken) {
    const token = String(leaseToken || "").trim();
    return Boolean(token && reservation && reservation.leaseToken === token);
  }

  function pageSessionMatches(pageSessionId) {
    if (!reservation) return false;
    if (reservation.pageSessionId == null) {
      return pageSessionId == null || String(pageSessionId).trim() === "";
    }
    return String(pageSessionId || "").trim() === reservation.pageSessionId;
  }

  function pageUnprotected() {
    if (!reservation?.pageSessionId) return true;
    return !pageSessions.isProtected(reservation.pageSessionId);
  }

  function hasLiveTransaction() {
    if (!reservation) return false;
    return reservation.httpInFlight > 0 || reservation.acceptedPromptIds.size > 0;
  }

  function bindingMatches(binding = {}) {
    if (!reservation) return false;
    if (binding.generation != null && Number(binding.generation) !== reservation.generation) {
      return false;
    }
    if (binding.leaseToken != null && String(binding.leaseToken) !== reservation.leaseToken) {
      return false;
    }
    return true;
  }

  function isFutureReclaimable() {
    if (!reservation || !isFutureExecutionLaneKind(reservation.kind)) return false;
    return pageUnprotected();
  }

  function isAbandonedInFlightReclaimable() {
    if (!reservation || !isInFlightExecutionLaneKind(reservation.kind)) return false;
    if (!pageUnprotected()) return false;
    return !hasLiveTransaction();
  }

  function tryReclaimStaleReservation() {
    if (isFutureReclaimable() || isAbandonedInFlightReclaimable()) {
      reservation = null;
      return true;
    }
    return false;
  }

  /**
   * Prune accepted prompts using server-authoritative Comfy state.
   * Does not rely on browser SSE. Unknown/unreachable → fail-closed (keep).
   */
  async function settleAbandonedAcceptedPrompts() {
    if (!reservation || !isInFlightExecutionLaneKind(reservation.kind)) {
      return { ok: true, status: "ignored" };
    }
    if (!pageUnprotected()) return { ok: true, status: "page-protected" };
    if (reservation.httpInFlight > 0) return { ok: true, status: "http-in-flight" };
    if (!reservation.acceptedPromptIds.size) return { ok: true, status: "empty" };
    if (typeof resolvePromptState !== "function") {
      return { ok: false, code: "settlement-unavailable", status: "fail-closed" };
    }

    const ids = [...reservation.acceptedPromptIds];
    let pruned = 0;
    for (const promptId of ids) {
      let state;
      try {
        state = await resolvePromptState(promptId);
      } catch {
        state = PROMPT_STATE.UNKNOWN;
      }
      if (TERMINAL_PROMPT_STATES.has(String(state || ""))) {
        reservation.acceptedPromptIds.delete(promptId);
        pruned += 1;
      }
      // running / unknown: keep — fail closed
    }
    return {
      ok: true,
      status: "settled",
      pruned,
      remaining: reservation.acceptedPromptIds.size
    };
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

    async reserve({ kind, ownerId, projectId = null, pageSessionId = null } = {}) {
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

      await settleAbandonedAcceptedPrompts();
      tryReclaimStaleReservation();

      if (reservation) {
        return {
          ok: false,
          code: "lane-busy",
          error: "Esiste già un job/batch in attesa o una Coda Batch attiva. Attendi o annullalo prima.",
          reservation: publicSnapshot(),
          reclaimable: isFutureReclaimable() || isAbandonedInFlightReclaimable(),
          transactionLive: hasLiveTransaction(),
          pageLifecycle: reservation.pageSessionId
            ? pageSessions.getLifecycle(reservation.pageSessionId)
            : null
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
        leaseToken,
        httpInFlight: 0,
        acceptedPromptIds: new Set()
      };
      return { ok: true, reservation: publicSnapshot(), leaseToken };
    },

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

    async reclaimStale({ requesterId = null } = {}) {
      if (!reservation) return { ok: true, status: "empty" };
      await settleAbandonedAcceptedPrompts();
      if (isFutureExecutionLaneKind(reservation.kind)) {
        if (!isFutureReclaimable()) {
          return {
            ok: false,
            code: "still-alive",
            error: "La page session proprietaria è ancora CONNECTED o RECONNECTABLE.",
            reservation: publicSnapshot(),
            pageLifecycle: reservation.pageSessionId
              ? pageSessions.getLifecycle(reservation.pageSessionId)
              : null
          };
        }
      } else if (isInFlightExecutionLaneKind(reservation.kind)) {
        if (!pageUnprotected()) {
          return {
            ok: false,
            code: "still-alive",
            error: "La page session proprietaria è ancora CONNECTED o RECONNECTABLE.",
            reservation: publicSnapshot()
          };
        }
        if (hasLiveTransaction()) {
          return {
            ok: false,
            code: "transaction-live",
            error: "Submit ancora in corso o prompt non ancora terminale in Comfy.",
            reservation: publicSnapshot()
          };
        }
      } else {
        return {
          ok: false,
          code: "not-reclaimable",
          error: "Questa reservation non è reclamabile per stale/page-loss.",
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
      return {
        ok: true,
        reservation: publicSnapshot(),
        generation: reservation.generation,
        leaseToken: reservation.leaseToken
      };
    },

    /** Bind submit bookkeeping to the reservation that passed assertSubmitAllowed. */
    beginSubmitTransaction(binding = {}) {
      if (!reservation || !isInFlightExecutionLaneKind(reservation.kind)) {
        return { ok: true, status: "ignored" };
      }
      if (binding.generation != null || binding.leaseToken != null) {
        if (!bindingMatches(binding)) {
          return { ok: true, status: "stale" };
        }
      }
      reservation.httpInFlight += 1;
      return {
        ok: true,
        status: "started",
        generation: reservation.generation,
        leaseToken: reservation.leaseToken
      };
    },

    endSubmitTransaction(binding = {}) {
      if (!reservation) return { ok: true, status: "empty" };
      if ((binding.generation != null || binding.leaseToken != null) && !bindingMatches(binding)) {
        return { ok: true, status: "stale" };
      }
      if (reservation.httpInFlight > 0) reservation.httpInFlight -= 1;
      return { ok: true, status: "ended", httpInFlight: reservation.httpInFlight };
    },

    notePromptAccepted(promptId, binding = {}) {
      if (!reservation || !promptId) return { ok: true, status: "ignored" };
      if ((binding.generation != null || binding.leaseToken != null) && !bindingMatches(binding)) {
        return { ok: true, status: "stale" };
      }
      reservation.acceptedPromptIds.add(String(promptId));
      return { ok: true, status: "accepted" };
    },

    notePromptTerminal(promptId) {
      if (!reservation || !promptId) return { ok: true, status: "ignored" };
      reservation.acceptedPromptIds.delete(String(promptId));
      return { ok: true, status: "terminal", remaining: reservation.acceptedPromptIds.size };
    },

    noteComfyMessage(message) {
      const promptId = terminalPromptIdFromComfyMessage(message);
      if (!promptId) return { ok: true, status: "ignored" };
      return this.notePromptTerminal(promptId);
    },

    settleAbandonedAcceptedPrompts,
    hasLiveTransaction,

    clear() {
      reservation = null;
    }
  };
}
