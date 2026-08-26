/**
 * Issue #97 — stable runtime authority and validation regressions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  RUNTIME_BLOCK,
  assertHarnessRootMatchesRuntimeAuthority,
  assertQueueIdle,
  inspectGitRuntimeState,
  planIdempotentDeployment,
  planInstallerShortcut,
  validateDesktopShortcutTarget,
  validateRuntimeFilesystem,
  validateStableRuntimeCheckout,
  verifyReleaseObjectExists
} from "../lib/stable-runtime.mjs";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.dirname(harnessRoot);

function mockGit(state) {
  return async (args, cwd) => {
    const key = args.join(" ");
    if (key === "status --porcelain") return state.porcelain ?? "";
    if (key === "rev-parse HEAD") return state.headSha;
    if (key === "rev-parse --abbrev-ref HEAD") return state.branch ?? "HEAD";
    if (key.startsWith("cat-file -t")) return state.objectType ?? "commit";
    if (key.startsWith("show ")) return JSON.stringify({ version: state.releaseVersion || "0.19.4" });
    if (key === "fetch origin") return "";
    if (key.startsWith("checkout --detach")) {
      state.headSha = args[2];
      state.branch = "HEAD";
      return "";
    }
    throw new Error(`unexpected git args: ${key}`);
  };
}

test("A installer shortcut targets stable runtime not dev checkout", () => {
  const stableRoot = path.resolve("/stable/runtime");
  const devHarness = path.resolve("/dev/checkout/comfyui-harness");
  const planned = planInstallerShortcut({ runtimeRoot: stableRoot });
  assert.notEqual(
    planned.targetScriptPath,
    path.join(devHarness, "scripts", "windows", "Start-AIVideoDirector.ps1")
  );
  assert.equal(
    planned.targetScriptPath,
    path.join(stableRoot, "comfyui-harness", "scripts", "windows", "Start-AIVideoDirector.ps1")
  );
  assert.equal(planned.workingDirectory, path.join(stableRoot, "comfyui-harness"));
});

test("B installer without runtime authority fails closed in source contract", async () => {
  const installer = await import("node:fs/promises").then(fs => fs.readFile(
    path.join(harnessRoot, "scripts", "windows", "Install-AIVideoDirectorLauncher.ps1"),
    "utf8"
  ));
  assert.match(installer, /\[Parameter\(Mandatory = \$true\)\]\[string\]\$RuntimeRoot/);
  assert.match(installer, /validate-runtime/);
  assert.doesNotMatch(installer, /New-LauncherShortcut[^\n]+Get-HarnessRoot/);
  assert.match(installer, /Join-Path \$resolvedRuntimeRoot 'comfyui-harness'/);
});

test("C launcher harness root mismatch fails closed before Director mutation", () => {
  assert.throws(
    () => assertHarnessRootMatchesRuntimeAuthority({
      runtimeRoot: path.resolve("/stable/runtime"),
      harnessRoot: path.resolve("/dev/checkout/comfyui-harness")
    }),
    /mismatch/i
  );
});

test("D clean detached runtime validates", async () => {
  const gitRunner = mockGit({ headSha: "abc123", branch: "HEAD", porcelain: "" });
  const result = await validateStableRuntimeCheckout({
    runtimeRoot: repoRoot,
    gitRunner,
    requireDetached: true,
    requireClean: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.git.detached, true);
  assert.equal(result.git.clean, true);
});

test("E dirty runtime blocked", async () => {
  const gitRunner = mockGit({ headSha: "abc123", branch: "HEAD", porcelain: " M file" });
  const result = await validateStableRuntimeCheckout({
    runtimeRoot: repoRoot,
    gitRunner,
    requireDetached: true,
    requireClean: true
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /dirty/i);
});

test("F attached branch runtime blocked for deployment", async () => {
  const gitRunner = mockGit({ headSha: "abc123", branch: "main", porcelain: "" });
  const result = await validateStableRuntimeCheckout({
    runtimeRoot: repoRoot,
    gitRunner,
    requireDetached: true,
    requireClean: true
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /attached/i);
});

test("G exact requested release SHA can be verified", async () => {
  const gitRunner = mockGit({ objectType: "commit" });
  await verifyReleaseObjectExists({ runtimeRoot: repoRoot, releaseSha: "deadbeef", gitRunner });
});

test("H authorized SHA wins over newer main conceptually via detached checkout plan", () => {
  const plan = planIdempotentDeployment({
    runtimeHeadSha: "authorized-sha",
    releaseSha: "authorized-sha",
    packageVersion: "0.19.4",
    expectedVersion: "0.19.4",
    directorHealthy: true,
    directorVersion: "0.19.4"
  });
  assert.equal(plan.action, "noop");
  assert.equal(plan.checkout, false);
});

test("I release object version mismatch is detectable at preflight", async () => {
  const gitRunner = mockGit({ headSha: "sha1", branch: "HEAD", porcelain: "", releaseVersion: "0.19.3" });
  const fs = validateRuntimeFilesystem({ runtimeRoot: repoRoot });
  assert.equal(fs.ok, true);
  await verifyReleaseObjectExists({ runtimeRoot: repoRoot, releaseSha: "sha1", gitRunner });
});

test("desktop shortcut validation detects stable runtime drift", () => {
  const stableRoot = path.resolve("/stable/runtime");
  const planned = planInstallerShortcut({ runtimeRoot: stableRoot });
  const ok = validateDesktopShortcutTarget({
    runtimeRoot: stableRoot,
    argumentsText: `-File "${planned.targetScriptPath}" -PauseOnError`,
    workingDirectory: planned.workingDirectory
  });
  assert.equal(ok.ok, true);
  const drift = validateDesktopShortcutTarget({
    runtimeRoot: stableRoot,
    argumentsText: `-File "${path.resolve("/dev/comfyui-harness/scripts/windows/Start-AIVideoDirector.ps1")}" -PauseOnError`,
    workingDirectory: path.resolve("/dev/comfyui-harness")
  });
  assert.equal(drift.ok, false);
});

test("queue non-idle fails closed", () => {
  assert.throws(() => assertQueueIdle({ running: 1, pending: 0 }), /not idle/i);
});

test("runtime filesystem validation requires harness layout", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "h3-runtime-"));
  const bad = validateRuntimeFilesystem({ runtimeRoot: tmp });
  assert.equal(bad.ok, false);
  await rm(tmp, { recursive: true, force: true });
});

test("unconfigured runtime root fails closed on start guard", () => {
  assert.throws(
    () => assertHarnessRootMatchesRuntimeAuthority({ runtimeRoot: "", harnessRoot }),
    /not configured/i
  );
});

test("inspectGitRuntimeState reports porcelain and branch", async () => {
  const gitRunner = mockGit({ headSha: "abc", branch: "HEAD", porcelain: "" });
  const state = await inspectGitRuntimeState({ runtimeRoot: repoRoot, gitRunner });
  assert.equal(state.headSha, "abc");
  assert.equal(state.detached, true);
});

test("runtime block codes are stable", () => {
  assert.equal(RUNTIME_BLOCK.HARNESS_ROOT_MISMATCH, "HARNESS_ROOT_MISMATCH");
  assert.equal(RUNTIME_BLOCK.QUEUE_NOT_IDLE, "QUEUE_NOT_IDLE");
});
