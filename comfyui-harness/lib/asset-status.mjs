import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from "./projects.mjs";
import {
  assetStatusKey,
  normalizeInputSubfolder,
  uniqueAssetDescriptors
} from "./asset-ref.mjs";
import { buildInputViewQuery } from "../public/asset-url.mjs";

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

/**
 * Probe ComfyUI /view for each descriptor. Status map keys:
 * empty subfolder → filename (legacy); nested → "<subfolder>/<filename>".
 */
export async function probeAssetStatuses(descriptors = [], { fetchImpl = fetch, comfyUrl } = {}) {
  const unique = uniqueAssetDescriptors(descriptors);
  const statuses = {};
  const base = String(comfyUrl || "").replace(/\/$/, "");
  await Promise.all(unique.map(async ({ filename, subfolder }) => {
    const key = assetStatusKey({ filename, subfolder });
    if (!key || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      if (key) statuses[key] = "error";
      return;
    }
    const folder = normalizeInputSubfolder(subfolder);
    if (folder == null) {
      statuses[key] = "error";
      return;
    }
    try {
      const query = buildInputViewQuery({ filename, subfolder: folder, type: "input" });
      const upstream = await fetchImpl(`${base}/view?${query}`, { method: "GET" });
      const kind = assetKindFromFilename(filename);
      statuses[key] = classifyAssetAvailability({
        ok: upstream.ok,
        status: upstream.status,
        contentType: upstream.headers.get("content-type"),
        kind
      });
      try { await upstream.body?.cancel?.(); } catch { /* ignore */ }
    } catch {
      statuses[key] = "error";
    }
  }));
  return statuses;
}
