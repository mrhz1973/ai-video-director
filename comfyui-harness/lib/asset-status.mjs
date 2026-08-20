import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from "./projects.mjs";

function extensionOf(name) {
  const lower = String(name || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot < 0 ? "" : lower.slice(dot);
}

export function assetKindFromFilename(filename) {
  const ext = extensionOf(filename);
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "unknown";
}

/**
 * Classify ComfyUI /view result for harness asset-status.
 * Images require an image/* content-type. Audio must not use image MIME rules.
 */
export function classifyAssetAvailability({ ok, status, contentType, kind = "image" } = {}) {
  if (!ok) return Number(status) === 404 ? "missing" : "error";
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (kind === "image") {
    return mime.startsWith("image/") ? "available" : "error";
  }
  if (kind === "audio") {
    if (mime.startsWith("image/")) return "error";
    if (mime.startsWith("application/json")) return "error";
    return "available";
  }
  if (mime.startsWith("application/json")) return "error";
  return "available";
}
