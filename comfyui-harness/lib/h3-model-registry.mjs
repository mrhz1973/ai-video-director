/**
 * Issue #95 — validated H3 model registry (preset contract + ComfyUI discovery).
 * Never invent installed state; preset.options.models remains compatibility authority.
 */
import { shortModelName } from "../public/output-naming.mjs";

export const H3_UNET_LOADER_CLASS = "UnetLoaderGGUFDynamicVRAM";

export const MODEL_STATUS = Object.freeze({
  AVAILABLE: "available",
  MISSING: "missing",
  DECLARED: "declared",
  INCOMPATIBLE: "incompatible",
  INVALID: "invalid"
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
    selectableFilenames: entries
      .filter(e => e.status !== MODEL_STATUS.MISSING || !discoveryOk)
      .map(e => e.filename)
  };
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

  if (saved && selectable.includes(saved)) {
    const entry = entries.find(e => e.filename === saved);
    if (registry?.discoveryOk && entry?.status === MODEL_STATUS.MISSING) {
      return {
        model: fallback,
        warning: `Il modello salvato "${friendlyModelLabel(saved)}" (${saved}) non risulta installato in ComfyUI. Ripristino: ${friendlyModelLabel(fallback)}.`
      };
    }
    return { model: saved, warning: "" };
  }

  if (saved && !selectable.includes(saved)) {
    const entry = entries.find(e => e.filename === saved);
    if (entry?.status === MODEL_STATUS.MISSING) {
      return {
        model: fallback,
        warning: `Modello "${friendlyModelLabel(saved)}" non installato. Ripristino: ${friendlyModelLabel(fallback)}.`
      };
    }
    return {
      model: fallback,
      warning: saved
        ? `Modello "${saved}" non compatibile con questo workflow. Ripristino: ${friendlyModelLabel(fallback)}.`
        : ""
    };
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
