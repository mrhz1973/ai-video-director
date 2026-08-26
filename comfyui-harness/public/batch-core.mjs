import { formatDurationCompact, normalizeDurationSeconds } from "../lib/duration.mjs";
import { normalizeItemFiles, resolveBatchItemFiles } from "../lib/batch-draft.mjs";
import { membersCompatibleWithRole } from "../lib/projects.mjs";

export { resolveBatchItemFiles, normalizeItemFiles };

export const MIN_BATCH_JOBS = 2;
export const MAX_BATCH_JOBS = 8;

function toUnavailableSet(unavailableFiles = null) {
  if (unavailableFiles instanceof Set) return new Set(unavailableFiles);
  return new Set(Array.isArray(unavailableFiles) ? unavailableFiles : []);
}

function roleAcceptForKey(roleKey, attachmentRoles = [], accept = null) {
  if (accept) return accept;
  const role = (Array.isArray(attachmentRoles) ? attachmentRoles : []).find(item => item?.key === roleKey);
  return role?.accept || "image/*";
}

/**
 * Fail-closed check for an EXPLICIT per-job item.files override.
 * Does not consider source.files inheritance.
 */
export function isExplicitBatchFileOverrideAvailable({
  filename,
  roleKey = "",
  accept = null,
  library = null,
  attachmentRoles = [],
  unavailableFilenames = null
} = {}) {
  const name = String(filename || "").trim();
  if (!name) return false;
  const unavailable = toUnavailableSet(unavailableFilenames);
  if (unavailable.has(name)) return false;
  if (library == null) return true;
  const roleAccept = roleAcceptForKey(roleKey, attachmentRoles, accept);
  return membersCompatibleWithRole(library, roleAccept).some(member => member.filename === name);
}

/**
 * Expand unavailable filenames to include explicit overrides missing from the
 * current compatible Asset library (or already known missing/error).
 */
export function collectUnavailableExplicitBatchOverrides({
  items = [],
  attachmentRoles = [],
  library = null,
  unavailableFilenames = null
} = {}) {
  const out = toUnavailableSet(unavailableFilenames);
  if (library == null) return out;
  for (const item of items) {
    const overrides = normalizeItemFiles(item?.files) || {};
    for (const [roleKey, filename] of Object.entries(overrides)) {
      if (!isExplicitBatchFileOverrideAvailable({
        filename,
        roleKey,
        library,
        attachmentRoles,
        unavailableFilenames: out
      })) {
        out.add(filename);
      }
    }
  }
  return out;
}

export function clampBatchCount(value, { min = MIN_BATCH_JOBS, max = MAX_BATCH_JOBS } = {}) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

export function createBatchItems(base = {}, count = 4) {
  const total = clampBatchCount(count);
  const seed = Number(base.seed);
  const seedIsFinite = Number.isFinite(seed);
  return Array.from({ length: total }, (_, index) => ({
    id: `job-${index + 1}`,
    prompt: String(base.prompt || ""),
    seed: seedIsFinite ? String(Math.trunc(seed) + index) : String(base.seed ?? "1"),
    duration: String(normalizeDurationSeconds(base.duration ?? 5)),
    steps: String(base.steps ?? "20"),
    megapixels: String(base.megapixels ?? "0.3"),
    aspect: String(base.aspect || "16:9")
  }));
}

export function duplicateBatchItem(items = [], index = 0) {
  const source = items[index];
  if (!source || items.length >= MAX_BATCH_JOBS) return [...items];
  const seed = Number(source.seed);
  const files = normalizeItemFiles(source.files);
  const copy = {
    ...source,
    id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    seed: Number.isFinite(seed) ? String(Math.trunc(seed) + 1) : String(source.seed || "1")
  };
  if (files) copy.files = { ...files };
  else delete copy.files;
  const next = [...items];
  next.splice(index + 1, 0, copy);
  return next;
}

export function moveBatchItem(items = [], fromIndex, toIndex) {
  const next = [...items];
  if (fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length || fromIndex === toIndex) return next;
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function removeBatchItem(items = [], index) {
  if (items.length <= MIN_BATCH_JOBS) return [...items];
  return items.filter((_, i) => i !== index);
}

export function validateBatchDraft({
  items = [],
  safeFitStatus = "not-applicable",
  requiredFiles = {},
  sharedFiles = null,
  requiredKeys = [],
  roleLabels = {},
  unavailableFiles = null,
  library = null,
  attachmentRoles = [],
  unsupportedVideoRoles = [],
  megapixelsMin = 0.1,
  megapixelsMax = 16,
  durationMin = 4,
  durationMax = 15
} = {}) {
  const errors = [];
  if (items.length < MIN_BATCH_JOBS || items.length > MAX_BATCH_JOBS) {
    errors.push(`Il batch deve contenere da ${MIN_BATCH_JOBS} a ${MAX_BATCH_JOBS} job.`);
  }
  if (["needs-apply", "unexpected"].includes(safeFitStatus)) {
    errors.push(safeFitStatus === "needs-apply" ? "Workflow image-fit non aggiornato." : "Workflow image-fit non valido.");
  }
  if (unsupportedVideoRoles.length) {
    errors.push(`Batch v1 non supporta ancora input video: ${unsupportedVideoRoles.join(", ")}.`);
  }

  const shared = sharedFiles && typeof sharedFiles === "object"
    ? sharedFiles
    : (requiredFiles || {});
  const unavailable = collectUnavailableExplicitBatchOverrides({
    items,
    attachmentRoles,
    library,
    unavailableFilenames: unavailableFiles
  });

  const perItem = [];
  items.forEach((item, index) => {
    const itemErrors = [];
    const label = `Job ${index + 1}`;
    if (!String(item.prompt || "").trim()) itemErrors.push("prompt vuoto");
    const seed = Number(item.seed);
    if (!Number.isFinite(seed)) itemErrors.push("seed non valido");
    const steps = Number(item.steps);
    if (!Number.isFinite(steps) || steps < 1) itemErrors.push("steps non validi");
    const durationRaw = Number(String(item.duration ?? "").replace(",", "."));
    if (!Number.isFinite(durationRaw)) itemErrors.push("durata non valida");
    else {
      const duration = normalizeDurationSeconds(durationRaw, { min: durationMin, max: durationMax });
      if (duration < durationMin || duration > durationMax) itemErrors.push(`durata fuori ${durationMin}–${durationMax}s`);
    }
    const mp = Number(item.megapixels);
    if (!Number.isFinite(mp) || mp < megapixelsMin || mp > megapixelsMax) itemErrors.push(`MP fuori ${megapixelsMin}–${megapixelsMax}`);
    if (!String(item.aspect || "").trim()) itemErrors.push("aspect mancante");

    const overrides = normalizeItemFiles(item.files) || {};
    for (const roleKey of requiredKeys) {
      const roleLabel = roleLabels[roleKey] || roleKey;
      const hasExplicitOverride = Object.prototype.hasOwnProperty.call(overrides, roleKey);
      if (hasExplicitOverride) {
        // Explicit override must never silently fall back to source.files.
        const filename = overrides[roleKey];
        if (!filename) {
          itemErrors.push(`input ${roleLabel} mancante`);
          continue;
        }
        if (!isExplicitBatchFileOverrideAvailable({
          filename,
          roleKey,
          library,
          attachmentRoles,
          unavailableFilenames: unavailable
        })) {
          itemErrors.push(`input ${roleLabel} non disponibile`);
        }
        continue;
      }

      const filename = shared[roleKey];
      if (!filename) {
        itemErrors.push(`input ${roleLabel} mancante`);
        continue;
      }
      if (unavailable.has(filename)) {
        itemErrors.push(`input ${roleLabel} non disponibile`);
      }
    }

    if (itemErrors.length) {
      perItem.push({ index, errors: itemErrors });
      errors.push(`${label}: ${itemErrors.join(", ")}.`);
    }
  });

  return { valid: errors.length === 0, errors, perItem };
}

/**
 * Sequentially submit already-preflighted items. Stops at the first failure,
 * never retries, and truthfully marks every remaining item as not submitted.
 */
export async function submitBatchSequentially(items = [], submit) {
  if (typeof submit !== "function") throw new Error("submit callback required");
  const accepted = [];
  let failure = null;
  for (let index = 0; index < items.length; index += 1) {
    try {
      const result = await submit(items[index], index);
      if (!result?.prompt_id) throw new Error("Submission returned no prompt_id");
      accepted.push({ index, prompt_id: result.prompt_id, result });
    } catch (error) {
      failure = { index, error: error instanceof Error ? error.message : String(error) };
      break;
    }
  }
  const acceptedIndexes = new Set(accepted.map(item => item.index));
  const notSubmitted = items
    .map((_, index) => index)
    .filter(index => !acceptedIndexes.has(index) && (!failure || index >= failure.index));
  return { complete: !failure && accepted.length === items.length, accepted, failure, notSubmitted };
}

export function summarizeBatchJobs(jobs = []) {
  const summary = {
    total: jobs.length,
    completed: 0,
    running: 0,
    pending: 0,
    failed: 0,
    interrupted: 0,
    cancelled: 0,
    interrupting: 0,
    notSubmitted: 0
  };
  for (const job of jobs) {
    const state = job?.state || "pending";
    if (state === "completed") summary.completed += 1;
    else if (state === "running") summary.running += 1;
    else if (state === "interrupting") summary.interrupting += 1;
    else if (state === "error") summary.failed += 1;
    else if (state === "interrupted") summary.interrupted += 1;
    else if (state === "cancelled") summary.cancelled += 1;
    else if (state === "not-submitted") summary.notSubmitted += 1;
    else summary.pending += 1;
  }
  return summary;
}

export function formatBatchRuntimeSummary(jobs = []) {
  const summary = summarizeBatchJobs(jobs);
  const parts = [];
  if (summary.completed) parts.push(`${summary.completed} completati`);
  if (summary.interrupted) parts.push(`${summary.interrupted} interrotti`);
  if (summary.cancelled) parts.push(`${summary.cancelled} annullati`);
  if (parts.length) return parts.join(" · ");
  return `${summary.total} job`;
}

export function isTerminalBatchState(state) {
  return ["completed", "error", "interrupted", "cancelled", "not-submitted"].includes(String(state || ""));
}

export function formatBatchJobSummary(item = {}) {
  const parts = [
    `seed ${item.seed}`,
    formatDurationCompact(item.duration),
    `${item.megapixels}MP`
  ];
  if (item.aspect) parts.push(String(item.aspect));
  if (item.steps != null && item.steps !== "") parts.push(`${item.steps} steps`);
  return parts.join(" · ");
}

/** Structured chips for collapsed Batch job summaries (Issue #92). */
export function buildBatchJobSummaryChips(item = {}, source = {}) {
  const files = item?.files && typeof item.files === "object" ? item.files : {};
  const sharedFiles = source?.files && typeof source.files === "object" ? source.files : {};
  const overrideKeys = Object.keys(files).filter(k => String(files[k] || "").trim());
  const chips = [
    { key: "duration", label: "Durata", value: formatDurationCompact(item.duration) },
    { key: "megapixels", label: "MP", value: item.megapixels != null && item.megapixels !== "" ? `${item.megapixels}MP` : "—" },
    { key: "aspect", label: "Aspect", value: item.aspect ? String(item.aspect) : "—" },
    { key: "steps", label: "Steps", value: item.steps != null && item.steps !== "" ? String(item.steps) : "—" },
    { key: "seed", label: "Seed", value: item.seed != null && item.seed !== "" ? String(item.seed) : "—" }
  ];
  const workflow = source?.workflowLabel || source?.workflowId;
  if (workflow) chips.push({ key: "workflow", label: "Workflow", value: String(workflow) });
  if (source?.model) chips.push({ key: "model", label: "Modello", value: String(source.model) });

  const inputNames = [];
  for (const key of new Set([...Object.keys(sharedFiles), ...Object.keys(files)])) {
    const name = String(files[key] || sharedFiles[key] || "").trim();
    if (name) inputNames.push(name);
  }
  if (inputNames.length) {
    chips.push({
      key: "inputs",
      label: overrideKeys.length ? "Override input" : "Input comune",
      value: inputNames.join(", "),
      overridden: overrideKeys.length > 0
    });
  }
  return chips;
}

export function jobHasInputOverrides(item = {}) {
  const files = item?.files && typeof item.files === "object" ? item.files : {};
  return Object.keys(files).some(k => String(files[k] || "").trim());
}

export const BATCH_ASPECT_OPTIONS = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);

export function detectBatchWideFieldState(items = [], field) {
  if (!Array.isArray(items) || !items.length) return { mode: "empty" };
  const values = items.map(item => String(item?.[field] ?? ""));
  const unique = [...new Set(values)];
  if (unique.length === 1) return { mode: "uniform", value: unique[0] };
  return { mode: "mixed" };
}

/**
 * Apply MP/aspect/steps to every prepared Batch item without rebuilding the batch.
 * Returns a new items array; unrelated fields (prompt, seed, duration, files) are preserved.
 */
export function applyBatchWideSettings(items = [], { megapixels, aspect, steps } = {}) {
  const list = Array.isArray(items) ? items : [];
  return list.map(item => {
    const files = normalizeItemFiles(item?.files);
    const next = { ...item };
    if (megapixels !== undefined && megapixels !== null && megapixels !== "") {
      next.megapixels = String(megapixels);
    }
    if (aspect !== undefined && aspect !== null && aspect !== "") {
      next.aspect = String(aspect);
    }
    if (steps !== undefined && steps !== null && steps !== "") {
      next.steps = String(steps);
    }
    if (files) next.files = { ...files };
    else delete next.files;
    return next;
  });
}

export function validateBatchWideSettings({
  items = [],
  megapixels,
  aspect,
  steps,
  megapixelsMin = 0.1,
  megapixelsMax = 16
} = {}) {
  const errors = [];
  if (!Array.isArray(items) || !items.length) {
    errors.push("Nessun batch preparato.");
  }
  const mp = Number(megapixels);
  if (!Number.isFinite(mp) || mp < megapixelsMin || mp > megapixelsMax) {
    errors.push(`Megapixel non valido (${megapixelsMin}–${megapixelsMax}).`);
  }
  if (!BATCH_ASPECT_OPTIONS.includes(String(aspect || ""))) {
    errors.push("Aspect non supportato.");
  }
  const stepNum = Number(steps);
  if (!Number.isFinite(stepNum) || stepNum < 1) {
    errors.push("Steps non validi.");
  }
  return { valid: errors.length === 0, errors };
}
