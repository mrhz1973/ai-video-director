/**
 * Browser-session gallery of finished Director outputs (sessionStorage only).
 * Does not delete media, queue jobs, or persist execution authority.
 */

import { LATEST_OUTPUT_KEY } from "./completion.mjs";

export const SESSION_OUTPUTS_KEY = "h3SessionOutputs:v1";
export const MAX_SESSION_OUTPUTS = 100;
export const SESSION_OUTPUTS_CHANGED = "h3-session-outputs-changed";
/** Matches batch-ui.mjs RUNTIME_KEY — read-only reconstruction source. */
export const BATCH_RUNTIME_STORAGE_KEY = "h3BatchRuntime:v1";
/** Once per browser tab session; clearing the gallery does not clear this flag. */
export const SESSION_OUTPUTS_RECONSTRUCTED_KEY = "h3SessionOutputsReconstructed:v1";

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

function settingString(value) {
  if (value == null || value === "") return "";
  return String(value);
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
    megapixels: settingString(raw.megapixels),
    aspect: settingString(raw.aspect),
    steps: settingString(raw.steps),
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
      megapixels: meta.megapixels,
      aspect: meta.aspect,
      steps: meta.steps,
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

/** Compact settings line for clip cards, e.g. "seed 22 · 5s · 0.3 MP · 16:9 · 20 steps". */
export function formatSessionClipSettingsLine(item = {}) {
  const parts = [];
  if (item.seed !== "" && item.seed != null) parts.push(`seed ${item.seed}`);
  if (item.duration != null && item.duration !== "") parts.push(`${item.duration}s`);
  if (item.megapixels !== "" && item.megapixels != null) parts.push(`${item.megapixels} MP`);
  if (item.aspect) parts.push(String(item.aspect));
  if (item.steps !== "" && item.steps != null) parts.push(`${item.steps} steps`);
  return parts.join(" · ");
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
      duration: next.duration != null && next.duration !== "" ? next.duration : prev.duration,
      megapixels: next.megapixels !== "" ? next.megapixels : prev.megapixels,
      aspect: next.aspect || prev.aspect,
      steps: next.steps !== "" ? next.steps : prev.steps,
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

/**
 * Best-effort records from persisted Batch runtime only.
 * Requires promptId + at least one output file already stored on the job — no folder scan.
 */
export function recordsFromBatchRuntime(runtime = null) {
  if (!runtime || typeof runtime !== "object") return [];
  if (Number(runtime.version) !== 1 || !Array.isArray(runtime.jobs)) return [];
  const out = [];
  for (const job of runtime.jobs) {
    if (!job || typeof job !== "object") continue;
    const promptId = String(job.promptId || "").trim();
    if (!promptId) continue;
    const outputs = Array.isArray(job.outputs) ? job.outputs : [];
    const usable = outputs.filter(item => item && (item.filename || item.name || item.url));
    if (!usable.length) continue;
    const item = job.item && typeof job.item === "object" ? job.item : {};
    out.push(...buildSessionOutputRecords(usable, {
      promptId,
      source: "batch",
      jobLabel: String(job.label || "").trim()
        || (Number.isFinite(Number(job.index)) ? `Job ${Number(job.index) + 1}` : ""),
      jobIndex: Number.isFinite(Number(job.index)) ? Number(job.index) : null,
      batchTotal: runtime.jobs.length,
      workflowId: runtime.workflowId || "",
      workflowLabel: runtime.workflowLabel || "",
      model: runtime.model || "",
      seed: item.seed ?? "",
      duration: item.duration ?? null,
      megapixels: item.megapixels ?? "",
      aspect: item.aspect ?? "",
      steps: item.steps ?? "",
      completedAt: Number(runtime.createdAt) || Date.now()
    }));
  }
  return out;
}

/**
 * Single-job latest-completion card → gallery record only when promptId is present
 * and that prompt is not already owned by a Batch runtime job.
 */
export function recordsFromLatestOutput(card = null, { batchRuntime = null } = {}) {
  if (!card || typeof card !== "object") return [];
  const promptId = String(card.promptId || "").trim();
  if (!promptId) return [];
  if (!card.filename && !card.url) return [];
  const batchJobs = Array.isArray(batchRuntime?.jobs) ? batchRuntime.jobs : [];
  if (batchJobs.some(job => String(job?.promptId || "").trim() === promptId)) {
    return [];
  }
  return buildSessionOutputRecords([{
    filename: card.filename,
    url: card.url,
    kind: "videos"
  }], {
    promptId,
    source: "single",
    seed: card.seed ?? "",
    duration: card.duration ?? null,
    megapixels: card.megapixels ?? "",
    aspect: card.aspect ?? "",
    steps: card.steps ?? "",
    model: card.model || "",
    completedAt: Number(card.completedAt) || Date.now()
  });
}

/** Pure: build gallery records from already-local metadata only. */
export function reconstructSessionOutputRecords({
  batchRuntime = null,
  latestOutput = null
} = {}) {
  return [
    ...recordsFromBatchRuntime(batchRuntime),
    ...recordsFromLatestOutput(latestOutput, { batchRuntime })
  ];
}

export function reconstructionSideEffects() {
  return {
    scansOutputFolder: false,
    guessesFromFilenames: false,
    queuePosts: 0,
    promptPosts: 0,
    gpuWrites: 0
  };
}

/**
 * One-shot per browser session: seed gallery from Batch runtime + latest completion
 * when authoritative promptId → job → output linkage already exists locally.
 */
export function applySessionGalleryReconstruction(sessionStorage, localStorage) {
  if (!sessionStorage?.getItem || !sessionStorage?.setItem) {
    return readSessionOutputs(sessionStorage);
  }
  try {
    if (sessionStorage.getItem(SESSION_OUTPUTS_RECONSTRUCTED_KEY) === "1") {
      return readSessionOutputs(sessionStorage);
    }
  } catch { /* continue */ }

  let batchRuntime = null;
  let latestOutput = null;
  try {
    batchRuntime = JSON.parse(localStorage?.getItem?.(BATCH_RUNTIME_STORAGE_KEY) || "null");
  } catch { batchRuntime = null; }
  try {
    const parsed = JSON.parse(sessionStorage.getItem(LATEST_OUTPUT_KEY) || "null");
    latestOutput = parsed?.card || null;
  } catch { latestOutput = null; }

  const records = reconstructSessionOutputRecords({ batchRuntime, latestOutput });
  const result = records.length
    ? upsertSessionOutputs(sessionStorage, records)
    : readSessionOutputs(sessionStorage);
  try {
    sessionStorage.setItem(SESSION_OUTPUTS_RECONSTRUCTED_KEY, "1");
  } catch { /* ignore */ }
  return result;
}
