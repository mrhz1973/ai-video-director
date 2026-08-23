/**
 * Browser-session gallery of finished Director outputs (sessionStorage only).
 * Does not delete media, queue jobs, or persist execution authority.
 */

export const SESSION_OUTPUTS_KEY = "h3SessionOutputs:v1";
export const MAX_SESSION_OUTPUTS = 100;
export const SESSION_OUTPUTS_CHANGED = "h3-session-outputs-changed";

export function subfolderFromOutputUrl(url = "") {
  try {
    return new URL(String(url || ""), "http://local.invalid").searchParams.get("subfolder") || "";
  } catch {
    return "";
  }
}

export function sessionOutputId({
  promptId = "",
  subfolder = "",
  filename = ""
} = {}) {
  return `${String(promptId || "")}:${String(subfolder || "")}:${String(filename || "")}`;
}

export function normalizeSessionOutput(raw = null) {
  if (!raw || typeof raw !== "object") return null;
  const filename = String(raw.filename || raw.name || "").trim();
  const url = String(raw.url || "").trim();
  if (!filename && !url) return null;
  const subfolder = String(raw.subfolder || subfolderFromOutputUrl(url) || "").trim();
  const promptId = String(raw.promptId || "").trim();
  const id = String(raw.id || sessionOutputId({ promptId, subfolder, filename })).trim();
  if (!id || id === "::") return null;
  const archive = raw.archive && typeof raw.archive === "object"
    ? {
      filename: String(raw.archive.filename || "").trim() || null,
      folderLabel: String(raw.archive.folderLabel || "").trim() || null,
      archivedAt: Number(raw.archive.archivedAt) || null,
      bytes: Number.isFinite(Number(raw.archive.bytes)) ? Number(raw.archive.bytes) : null
    }
    : null;
  return {
    id,
    promptId,
    source: raw.source === "batch" ? "batch" : "single",
    jobLabel: String(raw.jobLabel || "").trim(),
    jobIndex: Number.isFinite(Number(raw.jobIndex)) ? Number(raw.jobIndex) : null,
    batchTotal: Number.isFinite(Number(raw.batchTotal)) ? Number(raw.batchTotal) : null,
    workflowId: String(raw.workflowId || "").trim(),
    workflowLabel: String(raw.workflowLabel || "").trim(),
    model: String(raw.model || "").trim(),
    seed: raw.seed == null || raw.seed === "" ? "" : String(raw.seed),
    duration: raw.duration == null || raw.duration === "" ? null : String(raw.duration),
    kind: String(raw.kind || "").trim(),
    filename,
    subfolder,
    url,
    completedAt: Number(raw.completedAt) || Date.now(),
    available: raw.available !== false,
    archive: archive && (archive.filename || archive.folderLabel) ? archive : null
  };
}

export function buildSessionOutputRecords(items = [], meta = {}) {
  if (!Array.isArray(items) || !items.length) return [];
  const completedAt = Number(meta.completedAt) || Date.now();
  return items
    .map(item => normalizeSessionOutput({
      promptId: meta.promptId,
      source: meta.source,
      jobLabel: meta.jobLabel,
      jobIndex: meta.jobIndex,
      batchTotal: meta.batchTotal,
      workflowId: meta.workflowId,
      workflowLabel: meta.workflowLabel,
      model: meta.model,
      seed: meta.seed,
      duration: meta.duration,
      kind: item?.kind,
      filename: item?.filename || item?.name,
      subfolder: item?.subfolder,
      url: item?.url,
      completedAt,
      available: true,
      archive: meta.archive || null
    }))
    .filter(Boolean);
}

export function readSessionOutputs(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(SESSION_OUTPUTS_KEY) || "null");
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items.map(normalizeSessionOutput).filter(Boolean);
  } catch {
    return [];
  }
}

export function writeSessionOutputs(storage, items = []) {
  if (!storage?.setItem) return [];
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeSessionOutput)
    .filter(Boolean)
    .slice(0, MAX_SESSION_OUTPUTS);
  try {
    storage.setItem(SESSION_OUTPUTS_KEY, JSON.stringify({
      version: 1,
      items: normalized
    }));
  } catch { /* sessionStorage quota / private mode */ }
  return normalized;
}

export function clearSessionOutputs(storage) {
  try { storage?.removeItem?.(SESSION_OUTPUTS_KEY); } catch { /* ignore */ }
  return [];
}

/**
 * Upsert records by stable id. Newer metadata wins; archive fields merge.
 * Returns the full gallery list (newest first).
 */
export function upsertSessionOutputs(storage, records = []) {
  const incoming = (Array.isArray(records) ? records : [])
    .map(normalizeSessionOutput)
    .filter(Boolean);
  if (!incoming.length) return readSessionOutputs(storage);

  const byId = new Map();
  for (const item of readSessionOutputs(storage)) byId.set(item.id, item);
  for (const next of incoming) {
    const prev = byId.get(next.id);
    if (!prev) {
      byId.set(next.id, next);
      continue;
    }
    byId.set(next.id, {
      ...prev,
      ...next,
      jobLabel: next.jobLabel || prev.jobLabel,
      source: next.source === "batch" || prev.source === "batch" ? "batch" : (next.source || prev.source),
      jobIndex: next.jobIndex ?? prev.jobIndex,
      batchTotal: next.batchTotal ?? prev.batchTotal,
      workflowId: next.workflowId || prev.workflowId,
      workflowLabel: next.workflowLabel || prev.workflowLabel,
      model: next.model || prev.model,
      seed: next.seed !== "" ? next.seed : prev.seed,
      archive: next.archive || prev.archive || null,
      available: next.available !== false && prev.available !== false
    });
  }

  const merged = [...byId.values()].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  return writeSessionOutputs(storage, merged);
}

export function attachArchiveMetadata(storage, {
  promptId = "",
  filename = "",
  subfolder = "",
  archive = null
} = {}) {
  const id = sessionOutputId({ promptId, subfolder, filename });
  const items = readSessionOutputs(storage);
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return readSessionOutputs(storage);
  const current = items[index];
  items[index] = normalizeSessionOutput({
    ...current,
    archive: {
      ...(current.archive || {}),
      ...(archive || {})
    }
  });
  return writeSessionOutputs(storage, items);
}

export function markSessionOutputUnavailable(storage, id) {
  const items = readSessionOutputs(storage);
  const next = items.map(item => (
    item.id === id ? { ...item, available: false } : item
  ));
  return writeSessionOutputs(storage, next);
}

export function notifySessionOutputsChanged(target = globalThis) {
  try {
    target?.dispatchEvent?.(new Event(SESSION_OUTPUTS_CHANGED));
  } catch { /* ignore */ }
}

/** Pure helper: clearing gallery never encodes media/queue/GPU actions. */
export function sessionGalleryClearSideEffects() {
  return {
    deletesComfyOutputs: false,
    deletesArchives: false,
    modifiesProjects: false,
    queuePosts: 0,
    promptPosts: 0,
    gpuWrites: 0
  };
}
