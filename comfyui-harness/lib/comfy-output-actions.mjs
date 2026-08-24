/**
 * Local OS actions for authoritative Comfy outputs (Issue #59).
 * Windows: fixed Explorer /select argv via execFile — no shell.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import {
  ComfyOutputPathError,
  resolveSafeComfyOutputPath
} from "./comfy-output-path.mjs";

const execFileAsync = promisify(execFile);

export function buildWindowsExplorerSelectArgs(absolutePath) {
  // Fixed Explorer select behavior — path is already server-resolved.
  return ["/select,", String(absolutePath)];
}

export function explorerExecutable(platform = process.platform) {
  if (platform === "win32") return "explorer.exe";
  return null;
}

/**
 * Reveal an authoritative output file in the OS file manager.
 * @param {{
 *   outputRoot: string,
 *   filename: string,
 *   subfolder?: string,
 *   type?: string,
 *   platform?: string,
 *   execFileImpl?: typeof execFileAsync,
 *   accessImpl?: typeof access
 * }} opts
 */
export async function showComfyOutputInFolder({
  outputRoot,
  filename,
  subfolder = "",
  type = "output",
  platform = process.platform,
  execFileImpl = execFileAsync,
  accessImpl = access
} = {}) {
  const resolved = resolveSafeComfyOutputPath(outputRoot, { filename, subfolder, type });
  try {
    await accessImpl(resolved.absolutePath, fsConstants.F_OK);
  } catch {
    throw new ComfyOutputPathError("Output file not found under Comfy output root.", {
      code: "file-not-found",
      status: 404
    });
  }

  const exe = explorerExecutable(platform);
  if (!exe) {
    throw new ComfyOutputPathError("Show in folder is only supported on Windows.", {
      code: "unsupported-platform",
      status: 501
    });
  }

  const args = buildWindowsExplorerSelectArgs(resolved.absolutePath);
  try {
    await execFileImpl(exe, args, {
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 1024 * 64
    });
  } catch (error) {
    // Explorer often returns non-zero even when the window opens; treat access errors only.
    if (error && (error.code === "ENOENT" || error.code === "EACCES")) {
      throw new ComfyOutputPathError(error.message || "Explorer launch failed.", {
        code: "explorer-failed",
        status: 500
      });
    }
  }
  return { ok: true, filename: resolved.filename, subfolder: resolved.subfolder };
}

export { ComfyOutputPathError, resolveSafeComfyOutputPath };
