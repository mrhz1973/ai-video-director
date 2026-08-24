/**
 * Persistent multi-Batch queue plan (Issue #47).
 */

import { randomUUID } from "node:crypto";
import { normalizeBatchDraft, serializeBatchDraft, assertNoExecutionAuthority } from "./batch-draft.mjs";
import { validateQueueBatchSnapshot } from "./batch-queue-validate.mjs";

export const MAX_BATCH_QUEUE_ENTRIES = 50;
export const BATCH_QUEUE_PLAN_VERSION = 1;

export const BATCH_QUEUE_FAILURE_POLICY = Object.freeze({
  STOP: "stop",
  CONTINUE: "continue"
});

export const QUEUE_ENTRY_STATE = Object.freeze({
  QUEUED: "queued",
  SUBMITTING: "submitting",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  RECOVERY_REQUIRED: "recovery-required"
});

export const QUEUE_OVERALL_STATE = Object.freeze({
  IDLE: "idle",
  ARMED: "armed",
  WAITING: "waiting",
  RUNNING: "running",
  PAUSED: "paused",
  PAUSED_FAILURE: "paused-failure",
  RECOVERY_REQUIRED: "recovery-required",
  COMPLETED: "completed"
});

const FORBIDDEN_PLAN_KEYS = Object.freeze([
  "queueRunId",
  "armed",
  "runtime",
  "prompt_id",
  "promptId",
  "submitted",
  "submitting",
  "submitAll",
  "batchActive",
  "deferredBatch",
  "queuedNext"
]);

export function isActiveQueueEntryState(state) {
  return [QUEUE_ENTRY_STATE.QUEUED, QUEUE_ENTRY_STATE.SUBMITTING, QUEUE_ENTRY_STATE.RUNNING].includes(String(state || ""));
}

export function isTerminalQueueEntryState(state) {
  return [
    QUEUE_ENTRY_STATE.COMPLETED,
    QUEUE_ENTRY_STATE.FAILED,
    QUEUE_ENTRY_STATE.CANCELLED,
    QUEUE_ENTRY_STATE.RECOVERY_REQUIRED
  ].includes(String(state || ""));
}

export function persistableQueueEntryState(state) {
  if (state === QUEUE_ENTRY_STATE.SUBMITTING || state === QUEUE_ENTRY_STATE.RUNNING) {
    return QUEUE_ENTRY_STATE.RECOVERY_REQUIRED;
  }
  return String(state || QUEUE_ENTRY_STATE.QUEUED);
}

export function entryEverClaimed(state) {
  return [
    QUEUE_ENTRY_STATE.SUBMITTING,
    QUEUE_ENTRY_STATE.RUNNING,
    QUEUE_ENTRY_STATE.COMPLETED,
    QUEUE_ENTRY_STATE.FAILED,
    QUEUE_ENTRY_STATE.RECOVERY_REQUIRED
  ].includes(String(state || ""));
}

export function defaultQueueEntryName(order) {
  return `Batch ${String(order).padStart(2, "0")}`;
}

export function createQueueJobId(queueEntryId, index) {
  return `${String(queueEntryId)}:job:${index}`;
}

function stripForbidden(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripForbidden);
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PLAN_KEYS.includes(key)) continue;
    out[key] = stripForbidden(child);
  }
  return out;
}

export function deepCloneBatchSnapshot(draft) {
  return JSON.parse(JSON.stringify(draft));
}

export function createQueueEntryFromDraft(draft, {
  queueEntryId,
  name,
  order,
  createdAt = Date.now()
} = {}) {
  const normalized = normalizeBatchDraft(draft);
  if (!normalized) throw new Error("Batch snapshot non valido.");
  const id = String(queueEntryId || "").trim() || cryptoRandomId();
  const snapshot = deepCloneBatchSnapshot({
    version: normalized.version,
    source: normalized.source,
    items: normalized.items.map((item, index) => ({
      ...item,
      queueJobId: createQueueJobId(id, index)
    }))
  });
  return {
    queueEntryId: id,
    name: String(name || defaultQueueEntryName(order)).trim() || defaultQueueEntryName(order),
    order: Number(order) || 1,
    createdAt: Number(createdAt) || Date.now(),
    state: QUEUE_ENTRY_STATE.QUEUED,
    snapshot
  };
}

export function normalizeQueueEntry(raw = {}, index = 0) {
  const entry = raw && typeof raw === "object" ? raw : {};
  const snapshot = normalizeBatchDraft(entry.snapshot);
  if (!snapshot) return null;
  const queueEntryId = String(entry.queueEntryId || "").trim() || cryptoRandomId();
  const items = snapshot.items.map((item, jobIndex) => ({
    ...item,
    queueJobId: String(item.queueJobId || createQueueJobId(queueEntryId, jobIndex))
  }));
  return {
    queueEntryId,
    name: String(entry.name || defaultQueueEntryName(index + 1)),
    order: Number(entry.order) || index + 1,
    createdAt: Number(entry.createdAt) || Date.now(),
    everClaimed: Boolean(entry.everClaimed) || entryEverClaimed(entry.state),
    state: isTerminalQueueEntryState(entry.state) || isActiveQueueEntryState(entry.state)
      ? String(entry.state)
      : QUEUE_ENTRY_STATE.QUEUED,
    snapshot: { ...snapshot, items }
  };
}

export function normalizeBatchQueuePlan(raw = null) {
  if (raw == null) return null;
  const source = stripForbidden(raw);
  const entriesRaw = Array.isArray(source.entries) ? source.entries : [];
  const entries = entriesRaw
    .map((entry, index) => normalizeQueueEntry(entry, index))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((entry, index) => ({ ...entry, order: index + 1 }));
  if (!entries.length) return null;
  const policy = source.failurePolicy === BATCH_QUEUE_FAILURE_POLICY.CONTINUE
    ? BATCH_QUEUE_FAILURE_POLICY.CONTINUE
    : BATCH_QUEUE_FAILURE_POLICY.STOP;
  return {
    version: BATCH_QUEUE_PLAN_VERSION,
    failurePolicy: policy,
    revision: Number(source.revision) || 0,
    entries
  };
}

export function serializeBatchQueuePlan(plan, { bumpRevision = false } = {}) {
  const normalized = normalizeBatchQueuePlan(plan);
  if (!normalized) return null;
  const revision = bumpRevision ? normalized.revision + 1 : normalized.revision;
  const out = {
    version: normalized.version,
    failurePolicy: normalized.failurePolicy,
    revision,
    entries: normalized.entries.map(entry => ({
      queueEntryId: entry.queueEntryId,
      name: entry.name,
      order: entry.order,
      createdAt: entry.createdAt,
      state: persistableQueueEntryState(entry.state),
      everClaimed: entryEverClaimed(entry.state) || Boolean(entry.everClaimed),
      snapshot: serializeBatchDraft({
        source: entry.snapshot.source,
        items: entry.snapshot.items.map(({ queueJobId, ...item }) => item),
        includeUpdatedAt: false
      })
    }))
  };
  assertNoQueuePlanAuthority(out);
  return out;
}

export function assertNoQueuePlanAuthority(raw = null) {
  assertNoExecutionAuthority(raw);
  const text = JSON.stringify(raw || {});
  for (const key of FORBIDDEN_PLAN_KEYS) {
    if (text.includes(`"${key}"`)) {
      throw new Error(`Queue execution authority must not be persisted: ${key}`);
    }
  }
  return true;
}

export function countActiveQueueEntries(entries = []) {
  return entries.filter(entry => isActiveQueueEntryState(entry.state)).length;
}

export function validateQueueCapacity(entries = [], { adding = 0 } = {}) {
  const active = countActiveQueueEntries(entries) + Number(adding || 0);
  if (active > MAX_BATCH_QUEUE_ENTRIES) {
    return {
      ok: false,
      code: "capacity-exceeded",
      error: `La coda Batch supporta al massimo ${MAX_BATCH_QUEUE_ENTRIES} batch attivi.`
    };
  }
  return { ok: true, active };
}

export function appendQueueEntry(plan, entry) {
  const normalized = normalizeBatchQueuePlan(plan) || {
    version: BATCH_QUEUE_PLAN_VERSION,
    failurePolicy: BATCH_QUEUE_FAILURE_POLICY.STOP,
    revision: 0,
    entries: []
  };
  const capacity = validateQueueCapacity(normalized.entries, { adding: 1 });
  if (!capacity.ok) return capacity;
  const order = normalized.entries.length + 1;
  const newEntry = typeof entry === "object" && entry.queueEntryId
    ? { ...entry, order, state: QUEUE_ENTRY_STATE.QUEUED }
    : entry;
  return {
    ok: true,
    plan: {
      ...normalized,
      revision: normalized.revision + 1,
      entries: [...normalized.entries, newEntry]
    }
  };
}

export function canEditQueueEntry(entry) {
  return entry?.state === QUEUE_ENTRY_STATE.QUEUED;
}

export function canReorderQueueEntries(entries = [], fromIndex, toIndex) {
  const list = [...entries];
  const from = Number(fromIndex);
  const to = Number(toIndex);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return false;
  if (from === to) return true;
  const moving = list[from];
  if (!canEditQueueEntry(moving)) return false;
  for (let i = 0; i < list.length; i += 1) {
    if (i === from) continue;
    if (!canEditQueueEntry(list[i]) && (i === to || (from < to ? i > from && i <= to : i >= to && i < from))) {
      return false;
    }
  }
  return true;
}

export function reorderQueueEntries(entries = [], fromIndex, toIndex) {
  const list = [...entries];
  if (!canReorderQueueEntries(list, fromIndex, toIndex)) {
    return { ok: false, code: "reorder-rejected", error: "Riordino non consentito." };
  }
  const [item] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, item);
  return {
    ok: true,
    entries: list.map((entry, index) => ({ ...entry, order: index + 1 }))
  };
}

export function updateQueueEntry(plan, queueEntryId, patch = {}) {
  const normalized = normalizeBatchQueuePlan(plan);
  if (!normalized) return { ok: false, code: "empty-plan", error: "Coda vuota." };
  const index = normalized.entries.findIndex(entry => entry.queueEntryId === queueEntryId);
  if (index < 0) return { ok: false, code: "not-found", error: "Batch non trovato in coda." };
  const entry = normalized.entries[index];
  if (!canEditQueueEntry(entry)) {
    return { ok: false, code: "immutable", error: "Il batch non è più modificabile." };
  }
  const next = { ...entry };
  if (patch.name != null) next.name = String(patch.name).trim() || next.name;
  if (patch.snapshot) {
    const validated = validateQueueBatchSnapshot(patch.snapshot);
    if (!validated.ok) return validated;
    const snap = validated.snapshot;
    next.snapshot = {
      ...snap,
      items: snap.items.map((item, jobIndex) => ({
        ...item,
        queueJobId: createQueueJobId(queueEntryId, jobIndex)
      }))
    };
  }
  const entries = [...normalized.entries];
  entries[index] = next;
  return {
    ok: true,
    plan: { ...normalized, revision: normalized.revision + 1, entries }
  };
}

export function cancelQueueEntry(plan, queueEntryId) {
  const normalized = normalizeBatchQueuePlan(plan);
  if (!normalized) return { ok: false, code: "empty-plan", error: "Coda vuota." };
  const index = normalized.entries.findIndex(entry => entry.queueEntryId === queueEntryId);
  if (index < 0) return { ok: false, code: "not-found", error: "Batch non trovato." };
  if (!canEditQueueEntry(normalized.entries[index])) {
    return { ok: false, code: "immutable", error: "Il batch non può essere annullato." };
  }
  const entries = [...normalized.entries];
  entries[index] = { ...entries[index], state: QUEUE_ENTRY_STATE.CANCELLED };
  return {
    ok: true,
    plan: { ...normalized, revision: normalized.revision + 1, entries }
  };
}

export function summarizeQueuePlan(entries = []) {
  let completed = 0;
  let activeJobs = 0;
  let remainingBatches = 0;
  for (const entry of entries) {
    const jobs = entry?.snapshot?.items || [];
    if (entry.state === QUEUE_ENTRY_STATE.COMPLETED) {
      completed += 1;
    } else if (isActiveQueueEntryState(entry.state)) {
      remainingBatches += 1;
      activeJobs += jobs.length;
    } else if (entry.state === QUEUE_ENTRY_STATE.QUEUED) {
      remainingBatches += 1;
      activeJobs += jobs.length;
    }
  }
  return {
    totalBatches: entries.length,
    completedBatches: completed,
    remainingBatches,
    remainingJobs: activeJobs
  };
}

function cryptoRandomId() {
  return randomUUID();
}
