/**
 * Issue #97 — Windows runtime deployment planning regressions (mocked, no live production).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  advanceRuntimeCheckout,
  planDeploymentPreflight,
  runRuntimeDeployment
} from "../lib/windows-runtime-deploy.mjs";
import { buildLauncherConfigPayload, DIRECTOR_HEALTH_IDENTITY } from "../lib/windows-launcher.mjs";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.dirname(harnessRoot);
const expectedVersion = JSON.parse(await import("node:fs/promises").then(fs => fs.readFile(path.join(harnessRoot, "package.json"), "utf8"))).version;

function mockGit(state) {
  return async (args, cwd) => {
    const key = args.join(" ");
    if (key === "status --porcelain") return state.porcelain ?? "";
    if (key === "rev-parse HEAD") return state.headSha;
    if (key === "rev-parse --abbrev-ref HEAD") return state.branch ?? "HEAD";
    if (key.startsWith("cat-file -t")) return "commit";
    if (key.startsWith("show ")) return JSON.stringify({ version: state.releaseVersion || expectedVersion });
    if (key === "fetch origin") return "";
    if (key.startsWith("checkout --detach")) {
      state.headSha = args[2];
      return "";
    }
    throw new Error(`unexpected git: ${key}`);
  };
}

async function makeFakeComfyRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-comfy-root-"));
  mkdirSync(path.join(root, "python_embeded"), { recursive: true });
  mkdirSync(path.join(root, "ComfyUI"), { recursive: true });
  writeFileSync(path.join(root, "python_embeded", "python.exe"), "");
  writeFileSync(path.join(root, "ComfyUI", "main.py"), "");
  return root;
}

async function makeTempConfig(comfyRoot) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-deploy-config-"));
  const configPath = path.join(dir, "launcher.json");
  const payload = buildLauncherConfigPayload({
    runtimeRoot: repoRoot,
    comfyRoot
  });
  await writeFile(configPath, JSON.stringify(payload), "utf8");
  return { dir, configPath, payload };
}

function absentPort() {
  return { listening: false, inspectionOk: true, processInfo: null };
}

function listeningPort(pid, extra = {}) {
  return { listening: true, inspectionOk: true, processInfo: { pid, ...extra } };
}

function comfyStats() {
  return new Response(JSON.stringify({ system: {}, devices: [] }), { status: 200 });
}

function directorHealth(version = expectedVersion) {
  return new Response(JSON.stringify({ service: DIRECTOR_HEALTH_IDENTITY, version }), { status: 200 });
}

function idleQueue() {
  return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), { status: 200 });
}

function busyDeps({ directorPid = 8787, comfyPid = 8188, directorVersion = expectedVersion } = {}) {
  return {
    fetchFn: async url => {
      if (String(url).includes("/system_stats")) return comfyStats();
      if (String(url).includes("/api/health")) return directorHealth(directorVersion);
      if (String(url).includes("/queue")) return idleQueue();
      return new Response("{}", { status: 404 });
    },
    inspectPortFn: async port => (port === 8188 ? listeningPort(comfyPid) : listeningPort(directorPid))
  };
}

test("J deployment restart uses exact PID stop hook only", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const gitState = { headSha: "release-sha", branch: "HEAD", porcelain: "", releaseVersion: expectedVersion };
  const gitRunner = mockGit(gitState);
  const stopped = [];
  let directorListening = true;
  let directorVersion = "0.19.3";
  const fetchFn = async url => {
    if (String(url).includes("/system_stats")) return comfyStats();
    if (String(url).includes("/api/health")) return directorHealth(directorVersion);
    if (String(url).includes("/queue")) return idleQueue();
    return new Response("{}", { status: 404 });
  };
  const inspectPortFn = async port => {
    if (port === 8787 && !directorListening) return absentPort();
    if (port === 8188) return listeningPort(8188);
    return listeningPort(9001);
  };
  const result = await runRuntimeDeployment({
    runtimeRoot: repoRoot,
    releaseSha: "release-sha",
    expectedVersion,
    configPath,
    gitRunner,
    stopProcessFn: async pid => {
      stopped.push(pid);
      directorListening = false;
      directorVersion = expectedVersion;
    },
    fetchFn,
    inspectPortFn,
    deps: {
      spawnFn: () => {},
      sleepFn: async () => {},
      log: () => {}
    }
  });
  assert.deepEqual(stopped, [9001]);
  assert.equal(result.directorRestarted, true);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("K ComfyUI PID preserved across deployment plan", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const gitRunner = mockGit({
    headSha: "release-sha",
    branch: "HEAD",
    porcelain: "",
    releaseVersion: expectedVersion
  });
  const plan = await planDeploymentPreflight({
    runtimeRoot: repoRoot,
    releaseSha: "release-sha",
    expectedVersion,
    configPath,
    gitRunner,
    ...busyDeps({ comfyPid: 34240, directorPid: 47800 })
  });
  assert.equal(plan.comfy.pid, 34240);
  assert.equal(plan.ok, true);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("L queue non-idle blocks deployment preflight", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const gitRunner = mockGit({ headSha: "release-sha", branch: "HEAD", porcelain: "" });
  const plan = await planDeploymentPreflight({
    runtimeRoot: repoRoot,
    releaseSha: "release-sha",
    expectedVersion,
    configPath,
    gitRunner,
    fetchFn: async url => {
      if (String(url).includes("/queue")) {
        return new Response(JSON.stringify({ queue_running: [{}], queue_pending: [] }), { status: 200 });
      }
      if (String(url).includes("/system_stats")) return comfyStats();
      if (String(url).includes("/api/health")) return directorHealth();
      return new Response("{}", { status: 404 });
    },
    inspectPortFn: busyDeps().inspectPortFn
  });
  assert.equal(plan.ok, false);
  assert.match(plan.blockers.join(" "), /not idle/i);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("M same-version healthy deployment is noop with spawn 0", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const releaseSha = "already-there";
  const gitRunner = mockGit({ headSha: releaseSha, branch: "HEAD", porcelain: "", releaseVersion: expectedVersion });
  const spawns = [];
  const result = await runRuntimeDeployment({
    runtimeRoot: repoRoot,
    releaseSha,
    expectedVersion,
    configPath,
    gitRunner,
    stopProcessFn: async () => { throw new Error("should not stop"); },
    ...busyDeps({ directorPid: 47800 }),
    deps: {
      spawnFn: cmd => spawns.push(cmd),
      sleepFn: async () => {},
      log: () => {}
    }
  });
  assert.equal(result.action, "noop");
  assert.equal(result.checkoutPerformed, false);
  assert.equal(result.directorRestarted, false);
  assert.equal(spawns.length, 0);
  assert.equal(result.startResult.spawns.director, 0);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("N idempotent already-deployed target skips checkout", async () => {
  const gitState = { headSha: "target", branch: "HEAD", porcelain: "", releaseVersion: expectedVersion };
  const gitRunner = mockGit(gitState);
  const advanced = await advanceRuntimeCheckout({
    runtimeRoot: repoRoot,
    releaseSha: "other",
    gitRunner
  });
  assert.equal(advanced.headSha, "other");
});

test("exact release SHA checkout verifies package version", async () => {
  const gitState = { headSha: "old", branch: "HEAD", porcelain: "", releaseVersion: expectedVersion };
  const gitRunner = mockGit(gitState);
  const advanced = await advanceRuntimeCheckout({
    runtimeRoot: repoRoot,
    releaseSha: "new-sha",
    gitRunner
  });
  assert.equal(advanced.headSha, "new-sha");
  assert.equal(advanced.packageVersion, expectedVersion);
});

test("attached branch blocks deployment preflight", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const gitRunner = mockGit({ headSha: "sha", branch: "main", porcelain: "" });
  const plan = await planDeploymentPreflight({
    runtimeRoot: repoRoot,
    releaseSha: "sha",
    expectedVersion,
    configPath,
    gitRunner,
    ...busyDeps()
  });
  assert.equal(plan.ok, false);
  assert.match(plan.blockers.join(" "), /attached/i);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("I release version mismatch blocks deployment preflight", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const gitRunner = mockGit({ headSha: "sha", branch: "HEAD", porcelain: "", releaseVersion: "0.19.3" });
  const plan = await planDeploymentPreflight({
    runtimeRoot: repoRoot,
    releaseSha: "sha",
    expectedVersion,
    configPath,
    gitRunner,
    ...busyDeps()
  });
  assert.equal(plan.ok, false);
  assert.match(plan.blockers.join(" "), /advertises version 0\.19\.3/);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("runStart rejects harness root mismatch before spawn", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const { runStart } = await import("../scripts/windows/launcher-cli.mjs");
  const wrongHarness = await mkdtemp(path.join(os.tmpdir(), "wrong-harness-"));
  await assert.rejects(() => runStart({
    harnessRoot: wrongHarness,
    configPath,
    deps: {
      fetchFn: async () => new Response("{}", { status: 404 }),
      inspectPortFn: async () => absentPort(),
      spawnFn: () => { throw new Error("should not spawn"); }
    }
  }), /mismatch/i);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
  await rm(wrongHarness, { recursive: true, force: true });
});
