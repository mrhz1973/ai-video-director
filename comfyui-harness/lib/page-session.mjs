/**
 * Server-issued top-level page sessions (Issue #47 / eighth pass).
 * In-memory only — never persisted to project JSON.
 *
 * Distinguishes:
 * - pageInstanceId: memory-only per top-level document (client reconnect nonce)
 * - pageSessionId: opaque server authority bound to that document
 * - connectionGeneration: individual SSE transport; stale close must not kill a live reattach
 *
 * Lifecycle after last SSE transport drops:
 *   CONNECTED → RECONNECTABLE (within abandonAfterMs) → ABANDONED
 *
 * FUTURE execution authority remains protected while CONNECTED or RECONNECTABLE
 * so a competing reserve cannot steal during a transport outage before reattach.
 * A dead document past abandonAfterMs becomes ABANDONED and reclaimable.
 *
 * Reconnects of the SAME pageInstanceId reattach the SAME pageSession.
 */

import { randomUUID } from "node:crypto";

/** Soft transport window (compat export); authority uses reconnect/abandon window. */
export const PAGE_SESSION_DISCONNECT_GRACE_MS = 5_000;

/**
 * After the last SSE drops, same-document reconnect remains protected for this long.
 * Competing FUTURE reserves must not steal during this reconnectable window.
 */
export const PAGE_SESSION_RECONNECT_WINDOW_MS = 60_000;

export const PAGE_SESSION_LIFECYCLE = Object.freeze({
  CONNECTED: "connected",
  RECONNECTABLE: "reconnectable",
  ABANDONED: "abandoned",
  UNKNOWN: "unknown"
});

export function createPageSessionRegistry({
  now = () => Date.now(),
  /** @deprecated use abandonAfterMs — kept as alias for test harnesses */
  disconnectGraceMs = null,
  abandonAfterMs = PAGE_SESSION_RECONNECT_WINDOW_MS
} = {}) {
  const abandonMs = disconnectGraceMs != null ? Number(disconnectGraceMs) : Number(abandonAfterMs);

  /** @type {Map<string, {
   *   id: string,
   *   pageInstanceId: string,
   *   connected: boolean,
   *   disconnectedAt: number|null,
   *   openedAt: number,
   *   connectionGeneration: number
   * }>} */
  const bySessionId = new Map();
  /** @type {Map<string, string>} pageInstanceId → pageSessionId */
  const byInstanceId = new Map();

  function lifecycleOf(session) {
    if (!session) return PAGE_SESSION_LIFECYCLE.UNKNOWN;
    if (session.connected) return PAGE_SESSION_LIFECYCLE.CONNECTED;
    if (session.disconnectedAt == null) return PAGE_SESSION_LIFECYCLE.ABANDONED;
    if ((now() - session.disconnectedAt) < abandonMs) {
      return PAGE_SESSION_LIFECYCLE.RECONNECTABLE;
    }
    return PAGE_SESSION_LIFECYCLE.ABANDONED;
  }

  return {
    /**
     * Attach or reattach a document instance.
     * pageInstanceId is a reconnect nonce, not the authority token.
     */
    attach(pageInstanceId = null) {
      const instance = String(pageInstanceId || "").trim() || randomUUID();
      const existingId = byInstanceId.get(instance);
      if (existingId) {
        const session = bySessionId.get(existingId);
        if (session) {
          session.connected = true;
          session.disconnectedAt = null;
          session.connectionGeneration += 1;
          return {
            pageSessionId: session.id,
            pageInstanceId: instance,
            connectionGeneration: session.connectionGeneration,
            reattached: true,
            lifecycle: PAGE_SESSION_LIFECYCLE.CONNECTED
          };
        }
      }
      const id = randomUUID();
      const rec = {
        id,
        pageInstanceId: instance,
        connected: true,
        disconnectedAt: null,
        openedAt: now(),
        connectionGeneration: 1
      };
      bySessionId.set(id, rec);
      byInstanceId.set(instance, id);
      return {
        pageSessionId: id,
        pageInstanceId: instance,
        connectionGeneration: 1,
        reattached: false,
        lifecycle: PAGE_SESSION_LIFECYCLE.CONNECTED
      };
    },

    /** Test helper: attach a fresh unnamed instance and return pageSessionId. */
    open() {
      return this.attach().pageSessionId;
    },

    /**
     * Mark one SSE transport closed.
     * Stale generation (replaced by a reconnect) does not declare the page dead.
     */
    close(pageSessionId, connectionGeneration = null) {
      const session = bySessionId.get(String(pageSessionId || "").trim());
      if (!session || !session.connected) return;
      if (connectionGeneration != null
        && Number(connectionGeneration) !== session.connectionGeneration) {
        return;
      }
      session.connected = false;
      session.disconnectedAt = now();
    },

    isConnected(pageSessionId) {
      const session = bySessionId.get(String(pageSessionId || "").trim());
      return Boolean(session?.connected);
    },

    getLifecycle(pageSessionId) {
      return lifecycleOf(bySessionId.get(String(pageSessionId || "").trim()));
    },

    /**
     * True while the document must retain execution authority:
     * CONNECTED or RECONNECTABLE (not yet ABANDONED).
     */
    isProtected(pageSessionId) {
      const life = this.getLifecycle(pageSessionId);
      return life === PAGE_SESSION_LIFECYCLE.CONNECTED
        || life === PAGE_SESSION_LIFECYCLE.RECONNECTABLE;
    },

    isAbandoned(pageSessionId) {
      return this.getLifecycle(pageSessionId) === PAGE_SESSION_LIFECYCLE.ABANDONED;
    },

    get(pageSessionId) {
      const session = bySessionId.get(String(pageSessionId || "").trim());
      if (!session) return null;
      return { ...session, lifecycle: lifecycleOf(session) };
    },

    getByInstance(pageInstanceId) {
      const id = byInstanceId.get(String(pageInstanceId || "").trim());
      return id ? this.get(id) : null;
    },

    clear() {
      bySessionId.clear();
      byInstanceId.clear();
    }
  };
}
