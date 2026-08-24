/**
 * Local OS actions for authoritative Comfy outputs (Issue #59).
 * Windows: fixed Explorer /select argv via execFile — no shell.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath as fsRealpath } from "node:fs/promises";
import {
  ComfyOutputPathError,
  resolveAuthoritativeComfyOutput
} from "./comfy-output-authority.mjs";

const execFileAsync = promisify(execFile);

export function buildWindowsExplorerSelectArgs(absolutePath) {
  return ["/select,", String(absolutePath)];
}

export function explorerExecutable(platform = process.platform) {
  if (platform === "win32") return "explorer.exe";
  return null;
}

/**
 * Reveal an authoritative output after history + realpath checks.
 */
export async function showComfyOutputInFolder({
  outputRoot,
  comfyUrl,
  promptId,
  filename,
  subfolder = "",
  type = "output",
  platform = process.platform,
  fetchFn = fetch,
  realpathImpl = fsRealpath,
  execFileImpl = execFileAsync
} = {}) {
  const resolved = await resolveAuthoritativeComfyOutput({
    outputRoot,
    comfyUrl,
    promptId,
    filename,
    subfolder,
    type,
    fetchFn,
    realpathImpl
  });

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
    if (error && (error.code === "ENOENT" || error.code === "EACCES")) {
      throw new ComfyOutputPathError(error.message || "Explorer launch failed.", {
        code: "explorer-failed",
        status: 500
      });
    }
  }
  return {
    ok: true,
    filename: resolved.filename,
    subfolder: resolved.subfolder,
    promptId: resolved.promptId
  };
}

export { ComfyOutputPathError, resolveAuthoritativeComfyOutput };
