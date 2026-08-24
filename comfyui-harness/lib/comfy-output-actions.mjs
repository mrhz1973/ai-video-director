/**
 * Local OS actions for authoritative Comfy outputs (Issue #59).
 * Windows: Explorer /select via execFile — no shell.
 *
 * Note: argv must be a single `/select,<absolutePath>` argument.
 * Splitting `/select,` and the path into two argv entries is unreliable
 * and can open nothing while still appearing to "succeed".
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { realpath as fsRealpath } from "node:fs/promises";
import {
  ComfyOutputPathError,
  resolveAuthoritativeComfyOutput
} from "./comfy-output-authority.mjs";

const execFileAsync = promisify(execFile);

export function buildWindowsExplorerSelectArgs(absolutePath) {
  const target = String(absolutePath || "").trim();
  if (!target) {
    throw new ComfyOutputPathError("Resolved output path is missing.", {
      code: "explorer-path-missing",
      status: 500
    });
  }
  if (!path.isAbsolute(target)) {
    throw new ComfyOutputPathError("Resolved output path must be absolute.", {
      code: "explorer-path-invalid",
      status: 500
    });
  }
  // One argv element: "explorer /select,C:\path\to\file"
  return [`/select,${target}`];
}

export function explorerExecutable(platform = process.platform) {
  if (platform === "win32") return "explorer.exe";
  return null;
}

/**
 * Map any launch failure into a typed API error. Never swallow.
 */
export function classifyExplorerLaunchError(error, {
  action = "Explorer launch failed."
} = {}) {
  if (error instanceof ComfyOutputPathError) return error;
  const code = error?.code;
  const killed = Boolean(error?.killed);
  const signal = error?.signal || null;
  const message = String(error?.message || action);

  if (code === "ENOENT") {
    return new ComfyOutputPathError(message || "Explorer executable not found.", {
      code: "explorer-enoent",
      status: 500
    });
  }
  if (code === "EACCES") {
    return new ComfyOutputPathError(message || "Explorer access denied.", {
      code: "explorer-eacces",
      status: 500
    });
  }
  if (killed || code === "ETIMEDOUT" || signal === "SIGTERM") {
    return new ComfyOutputPathError(message || "Explorer launch timed out.", {
      code: "explorer-timeout",
      status: 500
    });
  }
  if (typeof code === "number" && code !== 0) {
    return new ComfyOutputPathError(
      message || `Explorer exited with code ${code}.`,
      { code: "explorer-exit", status: 500 }
    );
  }
  return new ComfyOutputPathError(message || action, {
    code: "explorer-failed",
    status: 500
  });
}

/**
 * Default Windows launcher: spawn Explorer and resolve once the process
 * starts. Do not wait for Explorer's quirky exit code (often 1 after handoff).
 * Injected execFileImpl remains supported for tests and must never be swallowed.
 */
export function launchWindowsExplorer(args, {
  exe = "explorer.exe",
  timeoutMs = 8000,
  execFileImpl = null,
  spawnImpl = spawn
} = {}) {
  if (typeof execFileImpl === "function") {
    return execFileImpl(exe, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 64
    }).then(
      result => result,
      error => {
        throw classifyExplorerLaunchError(error);
      }
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish(reject, classifyExplorerLaunchError({
        code: "ETIMEDOUT",
        killed: true,
        message: "Explorer launch timed out."
      }));
    }, timeoutMs);

    let child;
    try {
      child = spawnImpl(exe, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
    } catch (error) {
      finish(reject, classifyExplorerLaunchError(error));
      return;
    }

    child.once("error", error => {
      finish(reject, classifyExplorerLaunchError(error));
    });
    // Process started successfully — do not wait for exit code.
    child.unref();
    finish(resolve, { ok: true, pid: child.pid });
  });
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
  execFileImpl = null,
  spawnImpl = spawn
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

  const absolutePath = String(resolved.absolutePath || "").trim();
  if (!absolutePath) {
    throw new ComfyOutputPathError("Resolved output path is missing.", {
      code: "explorer-path-missing",
      status: 500
    });
  }

  const exe = explorerExecutable(platform);
  if (!exe) {
    throw new ComfyOutputPathError("Show in folder is only supported on Windows.", {
      code: "unsupported-platform",
      status: 501
    });
  }

  const args = buildWindowsExplorerSelectArgs(absolutePath);
  await launchWindowsExplorer(args, {
    exe,
    execFileImpl,
    spawnImpl
  });

  return {
    ok: true,
    filename: resolved.filename,
    subfolder: resolved.subfolder,
    promptId: resolved.promptId,
    absolutePath
  };
}

export { ComfyOutputPathError, resolveAuthoritativeComfyOutput, execFileAsync };
