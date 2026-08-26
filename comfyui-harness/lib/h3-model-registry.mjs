/**
 * Issue #95 — validated H3 model registry (preset contract + ComfyUI discovery).
 * Never invent installed state; preset.options.models remains compatibility authority.
 */
import { shortModelName } from "./model-name.mjs";

export const H3_UNET_LOADER_CLASS = "UnetLoaderGGUFDynamicVRAM";

export const MODEL_STATUS = Object.freeze({
  AVAILABLE: "available",
  MISSING: "missing",
  DECLARED: "declared",
  INCOMPATIBLE: "incompatible",
  INVALID: "invalid"
});

export const MODEL_BLOCKER_COPY = Object.freeze({
  noCompatibleInstalled: "Nessun checkpoint compatibile installato in ComfyUI per questo workflow.",
  noDeclared: "Nessun checkpoint compatibile dichiarato per questo workflow.",
  notSelected: "Seleziona un checkpoint compatibile installato.",
  missing: label => `Checkpoint "${label}" non installato in ComfyUI.`,
  incompatible: saved => `Modello "${saved}" non compatibile con questo workflow.`
});

/**
 * Friendly operator label derived from authoritative filename metadata only.
 * @param {string} filename
 * @returns {string}
 */
export function friendlyModelLabel(filename) {
  const raw = String(filename || "").trim();
  if (!raw) return "Modello";
  const lower = raw.toLowerCase();
  if (lower.includes("ref2va") || lower.includes("reference")) {
    const q = shortModelName(raw);
    return q && q !== "model" ? `H3 Ref ${q}` : "H3 Ref";
  }
  const q = shortModelName(raw);
  if (q && q !== "model") return `H3 ${q}`;
  return raw.replace(/\.(gguf|safetensors)$/i, "");
}

/**
 * @param {string} filename
 * @returns {string|null}
 */
export function modelQuantizationHint(filename) {
  const lower = String(filename || "").toLowerCase();
  if (lower.includes("q8_cr")) return "Q8_CR";
  if (lower.includes("q8")) return "Q8";
  if (lower.includes("q4_0")) return "Q4_0";
  if (lower.includes("q4")) return "Q4";
  if (lower.includes("fp16")) return "FP16";
  if (lower.includes("fp8")) return "FP8";
  if (lower.includes("bf16")) return "BF16";
  return null;
}

/**
 * Build registry entries for one preset against optional Comfy object_info names.
 * @param {object} preset
 * @param {string[]} [installedNames]
 * @param {{ discoveryOk?: boolean }} [opts]
 */
export function buildPresetModelRegistry(preset, installedNames = [], { discoveryOk = false } = {}) {
  const declared = Array.isArray(preset?.options?.models)
    ? preset.options.models.map(String).filter(Boolean)
    : [];
  const installed = new Set((installedNames || []).map(String));
  const seen = new Set();
  const entries = [];
  const duplicateFilenames = new Set();

  for (const filename of declared) {
    if (seen.has(filename)) {
      duplicateFilenames.add(filename);
      continue;
    }
    seen.add(filename);
    const quantization = modelQuantizationHint(filename);
    const friendlyLabel = friendlyModelLabel(filename);
    let status = MODEL_STATUS.DECLARED;
    let available = null;
    if (discoveryOk) {
      available = installed.has(filename);
      status = available ? MODEL_STATUS.AVAILABLE : MODEL_STATUS.MISSING;
    }
    entries.push({
      filename,
      friendlyLabel,
      quantization,
      compatible: true,
      available,
      status,
      help: discoveryOk
        ? (available
          ? `Checkpoint installato e compatibile con ${preset.label || preset.id}. File: ${filename}`
          : `Checkpoint dichiarato dal preset ma non presente in ComfyUI (${H3_UNET_LOADER_CLASS}). File: ${filename}`)
        : `Checkpoint dichiarato dal preset. Verifica ComfyUI non disponibile; file: ${filename}`
    });
  }

  return {
    presetId: preset?.id || "",
    presetLabel: preset?.label || "",
    mode: preset?.mode || "",
    loaderClass: H3_UNET_LOADER_CLASS,
    discoveryOk: Boolean(discoveryOk),
    entries,
    duplicateFilenames: [...duplicateFilenames],
    compatibleInstalledCount: discoveryOk
      ? entries.filter(e => e.status === MODEL_STATUS.AVAILABLE).length
      : null,
    selectableFilenames: entries
      .filter(e => e.status !== MODEL_STATUS.MISSING || !discoveryOk)
      .map(e => e.filename)
  };
}

/**
 * @param {{ discoveryOk?: boolean, entries?: object[] }} registry
 * @returns {number|null}
 */
export function countCompatibleInstalled(registry) {
  if (!registry?.discoveryOk) return null;
  return (registry.entries || []).filter(e => e.status === MODEL_STATUS.AVAILABLE).length;
}

/**
 * Fail-safe gate for render/queue submission paths.
 * @param {{ discoveryOk?: boolean, entries?: object[] }} registry
 * @param {string} [selectedModel]
 */
export function describeModelSelectionBlocker(registry, selectedModel = "") {
  const entries = registry?.entries || [];
  const selected = String(selectedModel || "").trim();

  if (!entries.length) {
    return { blocked: true, reason: MODEL_BLOCKER_COPY.noDeclared, code: "model-unavailable" };
  }

  if (!registry?.discoveryOk) {
    if (selected && !entries.some(e => e.filename === selected)) {
      return {
        blocked: true,
        reason: MODEL_BLOCKER_COPY.incompatible(selected),
        code: "model-incompatible"
      };
    }
    return { blocked: false, reason: "", code: null };
  }

  if (countCompatibleInstalled(registry) === 0) {
    return {
      blocked: true,
      reason: MODEL_BLOCKER_COPY.noCompatibleInstalled,
      code: "model-unavailable"
    };
  }

  if (!selected) {
    return {
      blocked: true,
      reason: MODEL_BLOCKER_COPY.notSelected,
      code: "model-unavailable"
    };
  }

  const entry = entries.find(e => e.filename === selected);
  if (!entry) {
    return {
      blocked: true,
      reason: MODEL_BLOCKER_COPY.incompatible(selected),
      code: "model-incompatible"
    };
  }
  if (entry.status === MODEL_STATUS.MISSING) {
    return {
      blocked: true,
      reason: MODEL_BLOCKER_COPY.missing(entry.friendlyLabel),
      code: "model-unavailable"
    };
  }

  return { blocked: false, reason: "", code: null };
}

/** @throws {Error & { code?: string }} */
export function assertModelSubmissionAllowed(registry, selectedModel = "") {
  const blocker = describeModelSelectionBlocker(registry, selectedModel);
  if (blocker.blocked) {
    const error = new Error(blocker.reason);
    error.code = blocker.code;
    throw error;
  }
}

/**
 * @param {object[]} presets
 * @param {{ names?: string[], discoveryOk?: boolean }} discovery
 */
export function buildAllPresetModelRegistries(presets = [], discovery = {}) {
  const names = discovery.names || [];
  const discoveryOk = Boolean(discovery.discoveryOk);
  const byPreset = {};
  for (const preset of presets || []) {
    if (!preset?.id) continue;
    byPreset[preset.id] = buildPresetModelRegistry(preset, names, { discoveryOk });
  }
  return {
    loaderClass: H3_UNET_LOADER_CLASS,
    discoveryOk,
    installedCount: names.length,
    byPreset
  };
}

/**
 * Resolve model selection against registry; fail-safe fallback to preset default.
 * @param {{ entries?: object[], selectableFilenames?: string[] }} registry
 * @param {{ savedModel?: string, presetDefault?: string }} input
 */
export function resolveModelSelection(registry, { savedModel = "", presetDefault = "" } = {}) {
  const entries = registry?.entries || [];
  const selectable = registry?.selectableFilenames?.length
    ? registry.selectableFilenames
    : entries.map(e => e.filename);
  const saved = String(savedModel || "").trim();
  const fallback = String(presetDefault || selectable[0] || "").trim();

  if (registry?.discoveryOk && countCompatibleInstalled(registry) === 0) {
    return {
      model: "",
      warning: MODEL_BLOCKER_COPY.noCompatibleInstalled
    };
  }

  if (saved && selectable.includes(saved)) {
    const entry = entries.find(e => e.filename === saved);
    if (registry?.discoveryOk && entry?.status === MODEL_STATUS.MISSING) {
      const usable = selectable.find(name => {
        const row = entries.find(e => e.filename === name);
        return row?.status !== MODEL_STATUS.MISSING;
      });
      return {
        model: usable || "",
        warning: usable
          ? `Il modello salvato "${friendlyModelLabel(saved)}" (${saved}) non risulta installato in ComfyUI. Ripristino: ${friendlyModelLabel(usable)}.`
          : MODEL_BLOCKER_COPY.noCompatibleInstalled
      };
    }
    return { model: saved, warning: "" };
  }

  if (saved && !selectable.includes(saved)) {
    const entry = entries.find(e => e.filename === saved);
    if (entry?.status === MODEL_STATUS.MISSING) {
      const usable = selectable[0] || "";
      return {
        model: usable,
        warning: usable
          ? `Modello "${friendlyModelLabel(saved)}" non installato. Ripristino: ${friendlyModelLabel(usable)}.`
          : MODEL_BLOCKER_COPY.noCompatibleInstalled
      };
    }
    const usable = selectable[0] || "";
    return {
      model: usable,
      warning: saved
        ? `Modello "${saved}" non compatibile con questo workflow. Ripristino: ${usable ? friendlyModelLabel(usable) : "nessuno"}.`
        : ""
    };
  }

  if (registry?.discoveryOk && fallback) {
    const fb = entries.find(e => e.filename === fallback);
    if (fb?.status === MODEL_STATUS.MISSING) {
      return { model: "", warning: MODEL_BLOCKER_COPY.noCompatibleInstalled };
    }
  }

  return { model: fallback, warning: "" };
}

/**
 * Normalize raw registry record for tests / malformed input guard.
 * @param {unknown} record
 */
export function normalizeRegistryRecord(record) {
  if (!record || typeof record !== "object") {
    return { valid: false, reason: "invalid_record" };
  }
  const filename = String(record.filename || "").trim();
  if (!filename) return { valid: false, reason: "missing_filename" };
  return {
    valid: true,
    filename,
    friendlyLabel: String(record.friendlyLabel || friendlyModelLabel(filename)),
    status: String(record.status || MODEL_STATUS.DECLARED)
  };
}
