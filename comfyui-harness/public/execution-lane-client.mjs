/**
 * Browser client for server in-memory execution-lane reservation (Issue #47).
 */

import { EXECUTION_LANE_KIND } from "../lib/execution-lane.mjs";

export { EXECUTION_LANE_KIND };

export async function reserveExecutionLane({ kind, ownerId, projectId = null } = {}) {
  const response = await fetch("/api/execution-lane/reserve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, ownerId, projectId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    return {
      ok: false,
      code: data.code || "lane-busy",
      error: data.error || "Lane di esecuzione già riservata.",
      reservation: data.reservation || null
    };
  }
  return { ok: true, reservation: data.reservation || null, status: data.status };
}

export async function releaseExecutionLane({ ownerId, kind = null } = {}) {
  const response = await fetch("/api/execution-lane/release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId, kind })
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
  return { ok: true, status: data.status || "released" };
}

export async function transferExecutionLaneKind({ ownerId, kind } = {}) {
  const response = await fetch("/api/execution-lane/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId, kind })
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
  return { ok: true, reservation: data.reservation || null };
}

export async function getExecutionLane() {
  const response = await fetch("/api/execution-lane");
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  return data.reservation || null;
}
