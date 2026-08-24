/**
 * Server-issued top-level page/connection sessions (Issue #47 / sixth pass).
 * In-memory only — never persisted to project JSON.
 *
 * Each live SSE `/api/events` connection gets a unique pageSessionId.
 * Clients must not mint or resume these IDs from storage.
 */

import { randomUUID } from "node:crypto";

/** Grace after SSE disconnect before FUTURE lane may be reclaimed. */
export const PAGE_SESSION_DISCONNECT_GRACE_MS = 5_000;

export function createPageSessionRegistry({
  now = () => Date.now(),
  disconnectGraceMs = PAGE_SESSION_DISCONNECT_GRACE_MS
} = {}) {
  /** @type {Map<string, { connected: boolean, disconnectedAt: number|null, openedAt: number }>} */
  const sessions = new Map();

  return {
    /**
     * Issue a new page session and mark it connected (SSE attach).
     * Never accepts a client-supplied id.
     */
    open() {
      const id = randomUUID();
      sessions.set(id, {
        connected: true,
        disconnectedAt: null,
        openedAt: now()
      });
      return id;
    },

    /** Mark SSE/page connection closed. Starts reclaim grace for FUTURE lanes. */
    close(pageSessionId) {
      const id = String(pageSessionId || "").trim();
      const session = sessions.get(id);
      if (!session || !session.connected) return;
      session.connected = false;
      session.disconnectedAt = now();
    },

    isConnected(pageSessionId) {
      const session = sessions.get(String(pageSessionId || "").trim());
      return Boolean(session?.connected);
    },

    /**
     * True while the page must retain FUTURE execution authority:
     * SSE connected, or still inside post-disconnect grace.
     */
    isProtected(pageSessionId) {
      const session = sessions.get(String(pageSessionId || "").trim());
      if (!session) return false;
      if (session.connected) return true;
      if (session.disconnectedAt == null) return false;
      return (now() - session.disconnectedAt) < disconnectGraceMs;
    },

    get(pageSessionId) {
      const session = sessions.get(String(pageSessionId || "").trim());
      return session ? { ...session } : null;
    },

    clear() {
      sessions.clear();
    }
  };
}
