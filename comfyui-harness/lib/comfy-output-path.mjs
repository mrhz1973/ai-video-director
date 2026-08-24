/**
 * Resolve authoritative ComfyUI output files under a configured output root.
 * Used by show-in-folder and download — never trusts absolute client paths.
 */
import path from "node:path";
import { normalizeInputSubfolder } from "./asset-ref.mjs";

export class ComfyOutputPathError extends Error {
  constructor(message, { code = "comfy-output-path", status = 400 } = {}) {
    super(message);
    this.name = "ComfyOutputPathError";
    this.code = code;
    this.status = status;
  }
}

export function assertSafeOutputBasename(filename) {
  const name = String(filename || "").trim();
  if (!name) {
    throw new ComfyOutputPathError("Filename required.", { code: "filename-required", status: 400 });
  }
  if (name.includes("..") || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new ComfyOutputPathError("Filename must be a basename.", { code: "unsafe-filename", status: 400 });
  }
  if (path.isAbsolute(name) || /^[a-zA-Z]:/.test(name)) {
    throw new ComfyOutputPathError("Absolute filenames are not allowed.", {
      code: "absolute-filename",
      status: 400
    });
  }
  return name;
}

/**
 * Join configured output root + optional subfolder + basename.
 * Rejects traversal, absolute injection, and root escape.
 */
export function resolveSafeComfyOutputPath(outputRoot, { filename, subfolder = "", type = "output" } = {}) {
  void type; // reserved; only "output" tree is served from this root
  const rootRaw = String(outputRoot || "").trim();
  if (!rootRaw) {
    throw new ComfyOutputPathError("Comfy output directory is not configured.", {
      code: "output-root-unconfigured",
      status: 503
    });
  }
  const root = path.resolve(rootRaw);
  const safeName = assertSafeOutputBasename(filename);
  const folder = normalizeInputSubfolder(subfolder);
  if (folder == null) {
    throw new ComfyOutputPathError("Invalid subfolder.", { code: "unsafe-subfolder", status: 400 });
  }
  const target = folder
    ? path.resolve(root, ...folder.split("/"), safeName)
    : path.resolve(root, safeName);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ComfyOutputPathError("Path escapes Comfy output root.", {
      code: "root-escape",
      status: 400
    });
  }
  return { root, absolutePath: target, filename: safeName, subfolder: folder || "" };
}

export function isMp4Filename(filename) {
  return /\.mp4$/i.test(String(filename || ""));
}
