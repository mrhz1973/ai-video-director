/**
 * Issue #97 — stable runtime checkout authority (testable, no PowerShell side effects).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const RUNTIME_HARNESS_DIR = "comfyui-harness";
export const RUNTIME_START_SCRIPT = path.join("scripts", "windows", "Start-AIVideoDirector.ps1");

export const RUNTIME_BLOCK = Object.freeze({
  ROOT_MISSING: "ROOT_MISSING",
  NOT_GIT: "NOT_GIT",
  HARNESS_MISSING: "HARNESS_MISSING",
  START_SCRIPT_MISSING: "START_SCRIPT_MISSING",
  PACKAGE_MISSING: "PACKAGE_MISSING",
  DIRTY: "DIRTY",
  ATTACHED_BRANCH: "ATTACHED_BRANCH",
  NOT_DETACHED: "NOT_DETACHED",
  SHA_MISMATCH: "SHA_MISMATCH",
  VERSION_MISMATCH: "VERSION_MISMATCH",
  HARNESS_ROOT_MISMATCH: "HARNESS_ROOT_MISMATCH",
  RUNTIME_ROOT_UNCONFIGURED: "RUNTIME_ROOT_UNCONFIGURED",
  RELEASE_OBJECT_MISSING: "RELEASE_OBJECT_MISSING",
  QUEUE_NOT_IDLE: "QUEUE_NOT_IDLE",
  DESKTOP_TARGET_DRIFT: "DESKTOP_TARGET_DRIFT",
  PORT_AMBIGUOUS: "PORT_AMBIGUOUS"
});

const REQUIRED_HARNESS_FILES = Object.freeze([
  "package.json",
  "server.mjs",
  RUNTIME_START_SCRIPT.replace(/\\/g, "/")
]);

export function normalizeRuntimeRoot(runtimeRoot = "") {
  return path.resolve(String(runtimeRoot || "").trim());
}

export function resolveRuntimeHarnessRoot(runtimeRoot = "") {
  return path.join(normalizeRuntimeRoot(runtimeRoot), RUNTIME_HARNESS_DIR);
}

export function planInstallerShortcut({ runtimeRoot = "" } = {}) {
  const harnessRoot = resolveRuntimeHarnessRoot(runtimeRoot);
  return {
    runtimeRoot: normalizeRuntimeRoot(runtimeRoot),
    harnessRoot,
    targetScriptPath: path.join(harnessRoot, ...RUNTIME_START_SCRIPT.split(/[/\\]/)),
    workingDirectory: harnessRoot
  };
}

export function assertHarnessRootMatchesRuntimeAuthority({ runtimeRoot = "", harnessRoot = "" } = {}) {
  if (!String(runtimeRoot || "").trim()) {
    const error = new Error(
      "Stable runtime root is not configured. Reinstall with Install-AIVideoDirectorLauncher.ps1 -RuntimeRoot <dedicated-runtime-repo-root>."
    );
    error.code = RUNTIME_BLOCK.RUNTIME_ROOT_UNCONFIGURED;
    throw error;
  }
  const expected = resolveRuntimeHarnessRoot(runtimeRoot);
  const actual = path.resolve(String(harnessRoot || "").trim());
  if (actual !== expected) {
    const error = new Error(
      `Launcher harness root mismatch. Configured stable runtime harness is ${expected}, but this launcher is running from ${actual}. Start Director only from the stable runtime checkout.`
    );
    error.code = RUNTIME_BLOCK.HARNESS_ROOT_MISMATCH;
    throw error;
  }
  return { expected, actual };
}

export function parseDesktopShortcutTarget({ argumentsText = "", workingDirectory = "" } = {}) {
  const args = String(argumentsText || "");
  const match = args.match(/-File\s+"([^"]+Start-AIVideoDirector\.ps1)"/i);
  return {
    targetScriptPath: match ? path.resolve(match[1]) : "",
    workingDirectory: workingDirectory ? path.resolve(String(workingDirectory)) : ""
  };
}

export function validateDesktopShortcutTarget({
  runtimeRoot = "",
  argumentsText = "",
  workingDirectory = ""
} = {}) {
  const planned = planInstallerShortcut({ runtimeRoot });
  const parsed = parseDesktopShortcutTarget({ argumentsText, workingDirectory });
  const errors = [];
  if (!parsed.targetScriptPath) {
    errors.push("Desktop shortcut does not reference Start-AIVideoDirector.ps1");
  } else if (parsed.targetScriptPath !== planned.targetScriptPath) {
    errors.push(`Desktop shortcut target ${parsed.targetScriptPath} does not match stable runtime ${planned.targetScriptPath}`);
  }
  if (!parsed.workingDirectory) {
    errors.push("Desktop shortcut WorkingDirectory is missing");
  } else if (parsed.workingDirectory !== planned.workingDirectory) {
    errors.push(`Desktop shortcut WorkingDirectory ${parsed.workingDirectory} does not match stable runtime ${planned.workingDirectory}`);
  }
  return { ok: errors.length === 0, errors, planned, parsed };
}

export async function readPackageVersion(harnessRoot = "", readFileFn = readFile) {
  const text = await readFileFn(path.join(path.resolve(harnessRoot), "package.json"), "utf8");
  const pkg = JSON.parse(text);
  if (!pkg?.version) throw new Error("package.json is missing version");
  return String(pkg.version);
}

export function validateRuntimeFilesystem({ runtimeRoot = "", existsFn = existsSync } = {}) {
  const root = normalizeRuntimeRoot(runtimeRoot);
  const errors = [];
  if (!root) errors.push("runtimeRoot is empty");
  if (root && !existsFn(root)) errors.push(`runtime root does not exist: ${root}`);
  const harnessRoot = resolveRuntimeHarnessRoot(root);
  if (root && !existsFn(harnessRoot)) errors.push(`harness directory missing: ${harnessRoot}`);
  for (const rel of REQUIRED_HARNESS_FILES) {
    const target = path.join(harnessRoot, ...rel.split("/"));
    if (root && existsFn(harnessRoot) && !existsFn(target)) {
      errors.push(`required harness file missing: ${rel}`);
    }
  }
  return { ok: errors.length === 0, errors, runtimeRoot: root, harnessRoot };
}

/**
 * @param {(args: string[], cwd: string) => Promise<string>} gitRunner
 */
export async function inspectGitRuntimeState({
  runtimeRoot = "",
  gitRunner
} = {}) {
  const root = normalizeRuntimeRoot(runtimeRoot);
  const porcelain = await gitRunner(["status", "--porcelain"], root);
  const headSha = await gitRunner(["rev-parse", "HEAD"], root);
  let branch = "";
  try {
    branch = await gitRunner(["rev-parse", "--abbrev-ref", "HEAD"], root);
  } catch {
    branch = "HEAD";
  }
  const detached = branch === "HEAD";
  return {
    runtimeRoot: root,
    headSha,
    branch,
    detached,
    clean: porcelain.length === 0,
    porcelain
  };
}

export async function validateStableRuntimeCheckout({
  runtimeRoot = "",
  gitRunner,
  existsFn = existsSync,
  requireDetached = true,
  requireClean = true
} = {}) {
  const fs = validateRuntimeFilesystem({ runtimeRoot, existsFn });
  const errors = [...fs.errors];
  let git = null;
  if (fs.ok && gitRunner) {
    git = await inspectGitRuntimeState({ runtimeRoot: fs.runtimeRoot, gitRunner });
    if (requireClean && !git.clean) {
      errors.push("runtime working tree is dirty");
    }
    if (requireDetached && !git.detached) {
      errors.push(`runtime checkout is attached to branch ${git.branch}; production authority requires detached HEAD`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    runtimeRoot: fs.runtimeRoot,
    harnessRoot: fs.harnessRoot,
    git
  };
}

export async function readPackageVersionAtGitRef({
  runtimeRoot = "",
  gitRef = "",
  gitRunner
} = {}) {
  const text = await gitRunner(["show", `${gitRef}:comfyui-harness/package.json`], normalizeRuntimeRoot(runtimeRoot));
  const pkg = JSON.parse(text);
  if (!pkg?.version) throw new Error(`Release object ${gitRef} is missing comfyui-harness/package.json version`);
  return String(pkg.version);
}

export async function verifyReleaseObjectExists({
  runtimeRoot = "",
  releaseSha = "",
  gitRunner
} = {}) {
  const type = await gitRunner(["cat-file", "-t", releaseSha], normalizeRuntimeRoot(runtimeRoot));
  if (type !== "commit") {
    const error = new Error(`Release object ${releaseSha} is not a commit (${type})`);
    error.code = RUNTIME_BLOCK.RELEASE_OBJECT_MISSING;
    throw error;
  }
  return true;
}

export function planRuntimeAdvancement({
  currentHeadSha = "",
  releaseSha = "",
  currentVersion = "",
  expectedVersion = ""
} = {}) {
  const needsCheckout = currentHeadSha !== releaseSha;
  const versionMismatch = currentVersion && expectedVersion && currentVersion !== expectedVersion;
  return {
    needsCheckout,
    versionMismatch,
    blocked: versionMismatch && !needsCheckout
  };
}

export function planIdempotentDeployment({
  runtimeHeadSha = "",
  releaseSha = "",
  packageVersion = "",
  expectedVersion = "",
  directorHealthy = false,
  directorVersion = ""
} = {}) {
  const atReleaseSha = runtimeHeadSha === releaseSha;
  const versionOk = packageVersion === expectedVersion;
  if (atReleaseSha && versionOk && directorHealthy && directorVersion === expectedVersion) {
    return {
      action: "noop",
      checkout: false,
      restartDirector: false,
      message: "Runtime already at release SHA with healthy Director at expected version"
    };
  }
  if (atReleaseSha && versionOk && (!directorHealthy || directorVersion !== expectedVersion)) {
    return {
      action: "restart_director",
      checkout: false,
      restartDirector: true,
      message: "Runtime already at release SHA; Director restart required"
    };
  }
  return {
    action: "checkout_and_restart",
    checkout: true,
    restartDirector: true,
    message: "Runtime checkout advancement and Director restart required"
  };
}

export function assertQueueIdle({ running = 0, pending = 0 } = {}) {
  if (Number(running) !== 0 || Number(pending) !== 0) {
    const error = new Error(`ComfyUI queue is not idle (${running} running, ${pending} pending)`);
    error.code = RUNTIME_BLOCK.QUEUE_NOT_IDLE;
    throw error;
  }
}

export function createDefaultGitRunner(execFileFn) {
  return async function gitRunner(args, cwd) {
    const { stdout, stderr } = await execFileFn("git", args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    if (stderr && /fatal:|error:/i.test(stderr) && !stdout) {
      throw new Error(String(stderr).trim());
    }
    return String(stdout || "").trim();
  };
}
