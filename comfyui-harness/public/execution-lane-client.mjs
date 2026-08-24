/**
 * Browser client for server in-memory execution-lane reservation (Issue #47).
 *
 * pageInstanceId is generated once per top-level document in JS memory and is
 * sent on SSE reconnect so the server reattaches the same pageSessionId.
 * Never persist pageInstanceId or pageSessionId in sessionStorage.
 */

import { EXECUTION_LANE_KIND, isFutureExecutionLaneKind } from "../lib/execution-lane-kinds.mjs";

export { EXECUTION_LANE_KIND, isFutureExecutionLaneKind };

const SESSION_LANE_KEY = "h3ExecutionLane";

/** @type {string|null} Memory-only per-document reconnect nonce. */
let memoryPageInstanceId = null;
/** @type {string|null} Server-issued opaque page session — memory only. */
let memoryPageSessionId = null;

function newDocumentNonce() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `page-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Stable for this JS document; never read from storage. */
export function getPageInstanceId() {
  if (!memoryPageInstanceId) memoryPageInstanceId = newDocumentNonce();
  return memoryPageInstanceId;
}

export function getPageSessionId() {
  return memoryPageSessionId;
}

/** Called when SSE issues a page-session event. Never load from storage. */
export function setPageSessionId(pageSessionId) {
  const next = pageSessionId == null ? null : String(pageSessionId).trim() || null;
  memoryPageSessionId = next;
  return memoryPageSessionId;
}

export function clearPageSessionId() {
  memoryPageSessionId = null;
}

/** Test helper: simulate a brand-new top-level document. */
export function resetDocumentIdentityForTests() {
  memoryPageInstanceId = null;
  memoryPageSessionId = null;
}

export function readStoredExecutionLane(storage = sessionStorage) {
  try {
    const raw = storage.getItem(SESSION_LANE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ownerId || !parsed?.kind || !parsed?.leaseToken) return null;
    return {
      ownerId: String(parsed.ownerId),
      kind: String(parsed.kind),
      leaseToken: String(parsed.leaseToken)
    };
  } catch {
    return null;
  }
}

export function writeStoredExecutionLane(lane, storage = sessionStorage) {
  if (!lane?.ownerId || !lane?.kind || !lane?.leaseToken) {
    storage.removeItem(SESSION_LANE_KEY);
    return;
  }
  // Intentionally omit pageSessionId — it must not travel via copied storage.
  storage.setItem(SESSION_LANE_KEY, JSON.stringify({
    ownerId: String(lane.ownerId),
    kind: String(lane.kind),
    leaseToken: String(lane.leaseToken)
  }));
}

export function clearStoredExecutionLane(storage = sessionStorage) {
  storage.removeItem(SESSION_LANE_KEY);
}

function withPageSession(body = {}) {
  const pageSessionId = getPageSessionId();
  return pageSessionId ? { ...body, pageSessionId } : { ...body };
}

export async function reserveExecutionLane({ kind, ownerId, projectId = null } = {}) {
  const response = await fetch("/api/execution-lane/reserve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withPageSession({ kind, ownerId, projectId }))
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    return {
      ok: false,
      code: data.code || "lane-busy",
      error: data.error || "Lane di esecuzione già riservata.",
      reservation: data.reservation || null,
      reclaimable: Boolean(data.reclaimable)
    };
  }
  const leaseToken = data.leaseToken || null;
  writeStoredExecutionLane({ ownerId, kind, leaseToken });
  return {
    ok: true,
    reservation: data.reservation || null,
    leaseToken,
    pageSessionId: getPageSessionId(),
    status: data.status
  };
}

export async function releaseExecutionLane({
  ownerId,
  kind = null,
  leaseToken = null,
  pageSessionId = null
} = {}) {
  const body = {
    ownerId,
    kind,
    leaseToken,
    pageSessionId: pageSessionId != null ? pageSessionId : getPageSessionId()
  };
  const response = await fetch("/api/execution-lane/release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    return {
      ok: false,
      code: data.code || "release-failed",
      error: data.error || "Impossibile rilasciare la lane.",
      reservation: data.reservation || null
    };
  }
  const stored = readStoredExecutionLane();
  if (stored && stored.ownerId === ownerId) clearStoredExecutionLane();
  return { ok: true, status: data.status || "released" };
}

export async function transferExecutionLaneKind({
  ownerId,
  kind,
  leaseToken = null,
  pageSessionId = null
} = {}) {
  const body = {
    ownerId,
    kind,
    leaseToken,
    pageSessionId: pageSessionId != null ? pageSessionId : getPageSessionId()
  };
  const response = await fetch("/api/execution-lane/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    return {
      ok: false,
      code: data.code || "transfer-failed",
      error: data.error || "Impossibile aggiornare la lane.",
      reservation: data.reservation || null
    };
  }
  const nextLease = data.leaseToken || leaseToken;
  writeStoredExecutionLane({ ownerId, kind, leaseToken: nextLease });
  return { ok: true, reservation: data.reservation || null, leaseToken: nextLease };
}

export async function heartbeatExecutionLane({
  ownerId,
  leaseToken = null,
  pageSessionId = null
} = {}) {
  const body = {
    ownerId,
    leaseToken,
    pageSessionId: pageSessionId != null ? pageSessionId : getPageSessionId()
  };
  const response = await fetch("/api/execution-lane/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    return {
      ok: false,
      code: data.code || "heartbeat-failed",
      error: data.error || "Heartbeat rifiutato.",
      reservation: data.reservation || null
    };
  }
  return { ok: true, reservation: data.reservation || null };
}

/** Reclaim uses server connection-loss policy only — no client staleAfterMs. */
export async function reclaimStaleExecutionLane({ requesterId = null } = {}) {
  const response = await fetch("/api/execution-lane/reclaim-stale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requesterId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    return {
      ok: false,
      code: data.code || "reclaim-failed",
      error: data.error || "Reclaim rifiutato.",
      reservation: data.reservation || null,
      silentMs: data.silentMs
    };
  }
  return { ok: true, status: data.status, previous: data.previous || null };
}

export async function getExecutionLane() {
  const response = await fetch("/api/execution-lane");
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  return data.reservation || null;
}

/**
 * On reload: local future intent is gone by design.
 * Do not release using copied storage alone. A new document has a new
 * pageInstanceId; abandoned ACTIVE/IMMEDIATE are reconciled server-side
 * after the old page is unprotected and any submit transaction settles.
 * Does not restore or auto-submit execution intent.
 */
export async function reconcileExecutionLaneAfterReload({
  hasLocalFutureIntent = false,
  storage = sessionStorage
} = {}) {
  const stored = readStoredExecutionLane(storage);
  if (!stored) return { ok: true, status: "none" };
  if (hasLocalFutureIntent) return { ok: true, status: "intent-present", stored };
  if (!isFutureExecutionLaneKind(stored.kind)
    && stored.kind !== EXECUTION_LANE_KIND.IMMEDIATE_SINGLE
    && stored.kind !== EXECUTION_LANE_KIND.ACTIVE_BATCH) {
    clearStoredExecutionLane(storage);
    return { ok: true, status: "ignored-kind", stored };
  }
  const pageSessionId = getPageSessionId();
  if (!pageSessionId) {
    // New document / bootstrap before SSE — cannot authorize with copied storage.
    // Server reconciles abandoned in-flight kinds after page loss + settled txn.
    clearStoredExecutionLane(storage);
    return { ok: true, status: "cleared-local-await-session", stored };
  }
  const released = await releaseExecutionLane({ ...stored, pageSessionId });
  clearStoredExecutionLane(storage);
  return {
    ok: true,
    status: released.ok ? "released-orphan" : "cleared-local-only",
    released,
    stored
  };
}

let heartbeatTimer = null;

export function startExecutionLaneHeartbeat(ownerId, { intervalMs = 10_000, leaseToken = null } = {}) {
  stopExecutionLaneHeartbeat();
  if (!ownerId || !leaseToken) return;
  const tick = () => {
    void heartbeatExecutionLane({
      ownerId,
      leaseToken,
      pageSessionId: getPageSessionId()
    });
  };
  tick();
  heartbeatTimer = setInterval(tick, intervalMs);
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

export function stopExecutionLaneHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

/** Best-effort unload release for future intents (does not restore intent). */
export function bindExecutionLaneUnloadRelease() {
  const handler = () => {
    const stored = readStoredExecutionLane();
    const pageSessionId = getPageSessionId();
    if (!stored || !pageSessionId || !isFutureExecutionLaneKind(stored.kind)) return;
    try {
      const body = JSON.stringify({ ...stored, pageSessionId });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/execution-lane/release", new Blob([body], { type: "application/json" }));
      }
    } catch { /* ignore */ }
  };
  window.addEventListener("pagehide", handler);
  return () => window.removeEventListener("pagehide", handler);
}

/** Headers for /api/queue lane gate. */
export function executionLaneSubmitHeaders(lane = null) {
  const current = lane || null;
  if (!current?.ownerId) return {};
  const headers = {
    "x-h3-lane-owner": current.ownerId,
    "x-h3-lane-kind": current.kind
  };
  if (current.leaseToken) headers["x-h3-lane-lease"] = current.leaseToken;
  const pageSessionId = current.pageSessionId || getPageSessionId();
  if (pageSessionId) headers["x-h3-page-session"] = pageSessionId;
  return headers;
}

/** Pure helper for batch-queue-ui stop feedback contract. */
export function formatQueueBatchStopFeedback(data = {}) {
  const checkpointFailed = Boolean(
    data.queueCheckpointFailed
    || (data.queueCheckpoint && data.queueCheckpoint.ok === false)
  );
  if (checkpointFailed) {
    return {
      level: "error",
      recoveryRequired: true,
      message: "Batch interrotto a runtime, ma il checkpoint durable della coda è FALLITO. RECUPERO RICHIESTO — non riprendere automaticamente. Persistenza CANCELLED non confermata."
    };
  }
  return {
    level: "warn",
    recoveryRequired: false,
    message: "Batch corrente interrotto. La coda multi-batch è in pausa."
  };
}
