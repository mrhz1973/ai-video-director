/**
 * Server-issued top-level page sessions (Issue #47 / seventh pass).
 * In-memory only — never persisted to project JSON.
 *
 * Distinguishes:
 * - pageInstanceId: memory-only per top-level document (client reconnect nonce)
 * - pageSessionId: opaque server authority bound to that document
 * - connectionGeneration: individual SSE transport; stale close must not kill a live reattach
 *
 * Reconnects of the SAME pageInstanceId reattach the SAME pageSession.
 * A new/duplicated document mints a different pageInstanceId and gets a new session.
 * Clients must not persist pageInstanceId in sessionStorage.
 */

import { randomUUID } from "node:crypto";

/** Grace after the last live SSE transport drops before the page is unprotected. */
export const PAGE_SESSION_DISCONNECT_GRACE_MS = 5_000;

export function createPageSessionRegistry({
  now = () => Date.now(),
  disconnectGraceMs = PAGE_SESSION_DISCONNECT_GRACE_MS
} = {}) {
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
            reattached: true
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
        reattached: false
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

    /**
     * True while the document must retain execution authority:
     * a live SSE transport, or still inside post-disconnect grace.
     */
    isProtected(pageSessionId) {
      const session = bySessionId.get(String(pageSessionId || "").trim());
      if (!session) return false;
      if (session.connected) return true;
      if (session.disconnectedAt == null) return false;
      return (now() - session.disconnectedAt) < disconnectGraceMs;
    },

    get(pageSessionId) {
      const session = bySessionId.get(String(pageSessionId || "").trim());
      return session ? { ...session } : null;
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
