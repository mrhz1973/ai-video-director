/**
 * Native Windows folder picker for archive destination (no browser FS write authority).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ComfyOutputPathError } from "./comfy-output-path.mjs";

const execFileAsync = promisify(execFile);

export function archiveFolderPickerScriptPath(root = path.dirname(fileURLToPath(import.meta.url))) {
  return path.resolve(root, "..", "scripts", "windows", "Select-ArchiveFolder.ps1");
}

export async function pickArchiveFolderNative({
  platform = process.platform,
  scriptPath = archiveFolderPickerScriptPath(),
  execFileImpl = execFileAsync,
  timeoutMs = 300_000
} = {}) {
  if (platform !== "win32") {
    throw new ComfyOutputPathError("La scelta cartella nativa è disponibile solo su Windows.", {
      code: "unsupported-platform",
      status: 501
    });
  }
  try {
    const { stdout } = await execFileImpl(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath
      ],
      {
        timeout: timeoutMs,
        windowsHide: false,
        maxBuffer: 1024 * 64,
        encoding: "utf8"
      }
    );
    const selected = String(stdout || "").trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
    if (!selected) {
      throw new ComfyOutputPathError("Nessuna cartella selezionata.", {
        code: "archive-pick-cancelled",
        status: 409
      });
    }
    return path.resolve(selected);
  } catch (error) {
    if (error instanceof ComfyOutputPathError) throw error;
    if (error && (error.code === 2 || error.status === 2 || Number(error.code) === 2)) {
      throw new ComfyOutputPathError("Scelta cartella annullata.", {
        code: "archive-pick-cancelled",
        status: 409
      });
    }
    throw new ComfyOutputPathError(error?.message || "Folder picker failed.", {
      code: "archive-pick-failed",
      status: 500
    });
  }
}

export async function openArchiveFolder({
  absolutePath,
  platform = process.platform,
  execFileImpl = execFileAsync
} = {}) {
  const target = path.resolve(String(absolutePath || ""));
  if (!target) {
    throw new ComfyOutputPathError("Cartella archivio non configurata.", {
      code: "archive-unconfigured",
      status: 409
    });
  }
  if (platform !== "win32") {
    throw new ComfyOutputPathError("Apertura cartella supportata solo su Windows.", {
      code: "unsupported-platform",
      status: 501
    });
  }
  try {
    await execFileImpl("explorer.exe", [target], {
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
  return { ok: true, absolutePath: target };
}
