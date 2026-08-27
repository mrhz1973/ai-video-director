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
  assertComfyUnchangedForDeploy,
  assertFreshPreStopSafety,
  fetchAndVerifyReleaseAuthority,
  planDeploymentPreflight,
  planLocalDeploymentPreflight,
  runRuntimeDeployment,
  verifyPostDeployment
} from "../lib/windows-runtime-deploy.mjs";
import { resolveDeps } from "../scripts/windows/launcher-cli.mjs";
import { buildLauncherConfigPayload, DIRECTOR_HEALTH_IDENTITY } from "../lib/windows-launcher.mjs";
import { planInstallerShortcut } from "../lib/stable-runtime.mjs";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.dirname(harnessRoot);
const expectedVersion = JSON.parse(await import("node:fs/promises").then(fs => fs.readFile(path.join(harnessRoot, "package.json"), "utf8"))).version;

function mockGit(state) {
  state.knownObjects = state.knownObjects || new Set([state.headSha].filter(Boolean));
  return async (args, cwd) => {
    const key = args.join(" ");
    if (key === "status --porcelain") return state.porcelain ?? "";
    if (key === "rev-parse HEAD") return state.headSha;
    if (key === "rev-parse --abbrev-ref HEAD") return state.branch ?? "HEAD";
    if (key.startsWith("cat-file -t")) {
      const sha = args[2];
      if (!state.knownObjects.has(sha)) {
        throw new Error(`Not a valid object name: ${sha}`);
      }
      return state.objectType ?? "commit";
    }
    if (key.startsWith("show ")) {
      const ref = args[1].split(":")[0];
      if (!state.knownObjects.has(ref)) {
        throw new Error(`Not a valid object name: ${ref}`);
      }
      return JSON.stringify({ version: state.releaseVersion || expectedVersion });
    }
    if (key === "fetch origin") {
      state.fetched = true;
      if (state.releaseSha) state.knownObjects.add(state.releaseSha);
      return "";
    }
    if (key.startsWith("checkout --detach")) {
      state.headSha = args[2];
      state.branch = "HEAD";
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

async function makeTempConfig(comfyRoot, overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-deploy-config-"));
  const configPath = path.join(dir, "launcher.json");
  const payload = buildLauncherConfigPayload({
    runtimeRoot: repoRoot,
    comfyRoot,
    ...overrides
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

function directorConfig(version = expectedVersion) {
  return new Response(JSON.stringify({ version }), { status: 200 });
}

function directorIndex() {
  return new Response('<html><h1>MiniMax H3 Director <small id="version"></small></h1></html>', { status: 200 });
}

function idleQueue() {
  return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), { status: 200 });
}

function deployFetch(version = expectedVersion, { queue = idleQueue } = {}) {
  return async url => {
    const text = String(url);
    if (text.includes("/system_stats")) return comfyStats();
    if (text.includes("/api/health")) return directorHealth(version);
    if (text.includes("/api/config")) return directorConfig(version);
    if (text.endsWith("/") || text.match(/:\d+\/?$/)) return directorIndex();
    if (text.includes("/queue")) return queue();
    return new Response("{}", { status: 404 });
  };
}

function busyDeps({ directorPid = 8787, comfyPid = 8188, directorVersion = expectedVersion } = {}) {
  return {
    fetchFn: deployFetch(directorVersion),
    inspectPortFn: async port => (port === 8188 ? listeningPort(comfyPid) : listeningPort(directorPid))
  };
}

function shortcutReader(runtimeRoot = repoRoot) {
  const planned = planInstallerShortcut({ runtimeRoot });
  return async () => ({
    argumentsText: `-File "${planned.targetScriptPath}" -PauseOnError`,
    workingDirectory: planned.workingDirectory
  });
}

function restartGitState(overrides = {}) {
  return {
    headSha: "release-sha",
    branch: "HEAD",
    porcelain: "",
    releaseVersion: expectedVersion,
    releaseSha: "release-sha",
    knownObjects: new Set(["release-sha"]),
    ...overrides
  };
}

async function runRestartDeployment({
  gitState = restartGitState(),
  inspectPortFn,
  fetchFn = deployFetch("0.19.3"),
  stopProcessFn = async () => {},
  deps = {},
  configPath,
  readShortcutFn = shortcutReader()
} = {}) {
  const gitRunner = mockGit(gitState);
  return runRuntimeDeployment({
    runtimeRoot: repoRoot,
    releaseSha: "release-sha",
    expectedVersion,
    configPath,
    gitRunner,
    stopProcessFn,
    fetchFn,
    inspectPortFn,
    readShortcutFn,
    deps: {
      spawnFn: () => {},
      sleepFn: async () => {},
      log: () => {},
      ...deps
    }
  });
}

test("J deployment restart uses exact PID stop hook only", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const gitState = {
    headSha: "release-sha",
    branch: "HEAD",
    porcelain: "",
    releaseVersion: expectedVersion,
    releaseSha: "release-sha",
    knownObjects: new Set(["release-sha"])
  };
  const gitRunner = mockGit(gitState);
  const stopped = [];
  let directorListening = true;
  let directorVersion = "0.19.3";
  const fetchFn = async url => {
    if (String(url).includes("/system_stats")) return comfyStats();
    if (String(url).includes("/api/health")) return directorHealth(directorVersion);
    if (String(url).includes("/api/config")) return directorConfig(expectedVersion);
    if (String(url).endsWith("/8787/") || String(url).match(/8787\/?$/)) return directorIndex();
    if (String(url).includes("/queue")) return idleQueue();
    return new Response("{}", { status: 404 });
  };
  const inspectPortFn = async port => {
    if (port === 8787 && !directorListening) return absentPort();
    if (port === 8188) return listeningPort(8188);
    return listeningPort(9001);
  };
  const spawns = [];
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
    readShortcutFn: shortcutReader(),
    deps: {
      spawnFn: cmd => {
        spawns.push(cmd);
        directorListening = true;
      },
      sleepFn: async () => {},
      log: () => {}
    }
  });
  assert.deepEqual(stopped, [9001]);
  assert.equal(result.directorRestarted, true);
  assert.equal(spawns.length, 1);
  assert.equal(result.startResult.spawns.comfy, 0);
  assert.equal(result.ok, true);
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
    releaseVersion: expectedVersion,
    releaseSha: "release-sha",
    knownObjects: new Set(["release-sha"])
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
  const gitRunner = mockGit({
    headSha: "release-sha",
    branch: "HEAD",
    porcelain: "",
    releaseSha: "release-sha",
    knownObjects: new Set(["release-sha"])
  });
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
      return deployFetch()(url);
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
  const gitRunner = mockGit({
    headSha: releaseSha,
    branch: "HEAD",
    porcelain: "",
    releaseVersion: expectedVersion,
    releaseSha,
    knownObjects: new Set([releaseSha])
  });
  const spawns = [];
  const result = await runRuntimeDeployment({
    runtimeRoot: repoRoot,
    releaseSha,
    expectedVersion,
    configPath,
    gitRunner,
    stopProcessFn: async () => { throw new Error("should not stop"); },
    readShortcutFn: shortcutReader(),
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
  assert.equal(result.ok, true);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("N idempotent already-deployed target skips checkout", async () => {
  const gitState = {
    headSha: "target",
    branch: "HEAD",
    porcelain: "",
    releaseVersion: expectedVersion,
    releaseSha: "other",
    knownObjects: new Set(["other"])
  };
  const gitRunner = mockGit(gitState);
  const advanced = await advanceRuntimeCheckout({
    runtimeRoot: repoRoot,
    releaseSha: "other",
    gitRunner
  });
  assert.equal(advanced.headSha, "other");
});

test("exact release SHA checkout verifies package version", async () => {
  const gitState = {
    headSha: "old",
    branch: "HEAD",
    porcelain: "",
    releaseVersion: expectedVersion,
    releaseSha: "new-sha",
    knownObjects: new Set(["new-sha"])
  };
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
  const gitRunner = mockGit({ headSha: "sha", branch: "main", porcelain: "", releaseSha: "sha", knownObjects: new Set(["sha"]) });
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
  const gitRunner = mockGit({
    headSha: "sha",
    branch: "HEAD",
    porcelain: "",
    releaseVersion: "0.19.3",
    releaseSha: "sha",
    knownObjects: new Set(["sha"])
  });
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

test("unseen release object becomes available after fetch before verification", async () => {
  const gitState = {
    headSha: "main-head",
    branch: "HEAD",
    porcelain: "",
    releaseVersion: expectedVersion,
    releaseSha: "authorized-release",
    knownObjects: new Set(["main-head"])
  };
  const gitRunner = mockGit(gitState);
  await assert.rejects(
    () => fetchAndVerifyReleaseAuthority({
      runtimeRoot: repoRoot,
      releaseSha: "authorized-release",
      expectedVersion,
      gitRunner,
      skipFetch: true
    }),
    /Not a valid object name/
  );
  const verified = await fetchAndVerifyReleaseAuthority({
    runtimeRoot: repoRoot,
    releaseSha: "authorized-release",
    expectedVersion,
    gitRunner
  });
  assert.equal(verified.releaseVersion, expectedVersion);
  assert.equal(gitState.fetched, true);
});

test("unexpected Director owner blocks preflight before stopProcessFn", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const gitRunner = mockGit({
    headSha: "release-sha",
    branch: "HEAD",
    porcelain: "",
    releaseSha: "release-sha",
    knownObjects: new Set(["release-sha"])
  });
  const plan = await planDeploymentPreflight({
    runtimeRoot: repoRoot,
    releaseSha: "release-sha",
    expectedVersion,
    configPath,
    gitRunner,
    fetchFn: async url => {
      if (String(url).includes("/api/health")) {
        return new Response("{}", { status: 503 });
      }
      return deployFetch()(url);
    },
    inspectPortFn: async port => {
      if (port === 8188) return listeningPort(8188);
      return {
        listening: true,
        inspectionOk: true,
        processInfo: { pid: 99999, executable: "notepad.exe", commandLine: "notepad" }
      };
    }
  });
  assert.equal(plan.ok, false);
  assert.match(plan.blockers.join(" "), /unexpected process/i);
  await assert.rejects(() => runRuntimeDeployment({
    runtimeRoot: repoRoot,
    releaseSha: "release-sha",
    expectedVersion,
    configPath,
    gitRunner,
    stopProcessFn: async () => { throw new Error("must not stop"); },
    fetchFn: async url => {
      if (String(url).includes("/api/health")) {
        return new Response("{}", { status: 503 });
      }
      return deployFetch()(url);
    },
    inspectPortFn: async port => {
      if (port === 8188) return listeningPort(8188);
      return {
        listening: true,
        inspectionOk: true,
        processInfo: { pid: 99999, executable: "notepad.exe" }
      };
    }
  }), /unexpected process|DEPLOY_PREFLIGHT_BLOCKED/);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("ComfyUI absent between preflight and restart blocks deployment with spawn 0", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const spawns = [];
  const stopped = [];
  let comfyInspects = 0;
  const inspectPortFn = async port => {
    if (port === 8188) {
      comfyInspects += 1;
      if (comfyInspects === 1) return listeningPort(8188);
      return absentPort();
    }
    return listeningPort(9001);
  };
  await assert.rejects(() => runRestartDeployment({
    configPath,
    inspectPortFn,
    stopProcessFn: async pid => { stopped.push(pid); },
    deps: { spawnFn: cmd => spawns.push(cmd) }
  }), /ComfyUI|unhealthy|pre-stop/i);
  assert.equal(spawns.length, 0);
  assert.equal(stopped.length, 0);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("A fresh pre-stop Director PID change blocks before stopProcessFn", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const stopped = [];
  let directorInspects = 0;
  const inspectPortFn = async port => {
    if (port === 8188) return listeningPort(8188);
    directorInspects += 1;
    return listeningPort(directorInspects === 1 ? 9001 : 9002);
  };
  await assert.rejects(() => runRestartDeployment({
    configPath,
    inspectPortFn,
    stopProcessFn: async pid => { stopped.push(pid); }
  }), /Director PID changed/i);
  assert.equal(stopped.length, 0);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("B fresh pre-stop Director disappearance blocks before stopProcessFn", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const stopped = [];
  let directorInspects = 0;
  const inspectPortFn = async port => {
    if (port === 8188) return listeningPort(8188);
    directorInspects += 1;
    if (directorInspects === 1) return listeningPort(9001);
    return absentPort();
  };
  await assert.rejects(() => runRestartDeployment({
    configPath,
    inspectPortFn,
    stopProcessFn: async pid => { stopped.push(pid); }
  }), /Director disappeared/i);
  assert.equal(stopped.length, 0);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("C fresh pre-stop Comfy PID change blocks before stopProcessFn", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const stopped = [];
  const spawns = [];
  let comfyInspects = 0;
  const inspectPortFn = async port => {
    if (port === 8188) {
      comfyInspects += 1;
      return listeningPort(comfyInspects === 1 ? 8188 : 8199);
    }
    return listeningPort(9001);
  };
  await assert.rejects(() => runRestartDeployment({
    configPath,
    inspectPortFn,
    stopProcessFn: async pid => { stopped.push(pid); },
    deps: { spawnFn: cmd => spawns.push(cmd) }
  }), /ComfyUI PID changed/i);
  assert.equal(stopped.length, 0);
  assert.equal(spawns.length, 0);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("E fresh pre-stop queue busy blocks before stopProcessFn", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const stopped = [];
  let queueFetches = 0;
  const fetchFn = async url => {
    if (String(url).includes("/queue")) {
      queueFetches += 1;
      if (queueFetches === 1) return idleQueue();
      return new Response(JSON.stringify({ queue_running: [{}], queue_pending: [] }), { status: 200 });
    }
    return deployFetch("0.19.3")(url);
  };
  await assert.rejects(() => runRestartDeployment({
    configPath,
    fetchFn,
    inspectPortFn: busyDeps({ directorPid: 9001, comfyPid: 8188, directorVersion: "0.19.3" }).inspectPortFn,
    stopProcessFn: async pid => { stopped.push(pid); }
  }), /not idle|pre-stop/i);
  assert.equal(stopped.length, 0);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("F verifyPostDeployment fails when Director port inspection is ambiguous", async () => {
  const gitRunner = mockGit({ headSha: "sha", branch: "HEAD", porcelain: "" });
  const post = await verifyPostDeployment({
    runtimeRoot: repoRoot,
    releaseSha: "sha",
    expectedVersion,
    gitRunner,
    fetchFn: deployFetch(),
    inspectPortFn: async port => {
      if (port === 8188) return listeningPort(8188);
      return { listening: true, inspectionOk: false, processInfo: null };
    },
    config: buildLauncherConfigPayload({ runtimeRoot: repoRoot, comfyRoot: "C:/fake" }),
    comfyPidBefore: 8188
  });
  assert.equal(post.ok, false);
  assert.match(post.errors.join(" "), /port inspection failed/i);
});

test("G normal unchanged Director and Comfy PIDs allow exact single stop", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const stopped = [];
  const spawns = [];
  let directorListening = true;
  let directorVersion = "0.19.3";
  const fetchFn = async url => {
    if (String(url).includes("/system_stats")) return comfyStats();
    if (String(url).includes("/api/health")) return directorHealth(directorVersion);
    if (String(url).includes("/api/config")) return directorConfig(expectedVersion);
    if (String(url).endsWith("/8787/") || String(url).match(/8787\/?$/)) return directorIndex();
    if (String(url).includes("/queue")) return idleQueue();
    return new Response("{}", { status: 404 });
  };
  const inspectPortFn = async port => {
    if (port === 8787 && !directorListening) return absentPort();
    if (port === 8188) return listeningPort(8188);
    return listeningPort(9001);
  };
  const result = await runRestartDeployment({
    configPath,
    fetchFn,
    inspectPortFn,
    stopProcessFn: async pid => {
      stopped.push(pid);
      directorListening = false;
      directorVersion = expectedVersion;
    },
    deps: { spawnFn: cmd => {
      spawns.push(cmd);
      directorListening = true;
    } }
  });
  assert.deepEqual(stopped, [9001]);
  assert.equal(spawns.length, 1);
  assert.equal(result.ok, true);
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("verifyPostDeployment fails when Comfy PID changes", async () => {
  const gitRunner = mockGit({ headSha: "sha", branch: "HEAD", porcelain: "" });
  const post = await verifyPostDeployment({
    runtimeRoot: repoRoot,
    releaseSha: "sha",
    expectedVersion,
    gitRunner,
    fetchFn: deployFetch(),
    inspectPortFn: async port => listeningPort(port === 8188 ? 111 : 222),
    config: buildLauncherConfigPayload({ runtimeRoot: repoRoot, comfyRoot: "C:/fake" }),
    comfyPidBefore: 999
  });
  assert.equal(post.ok, false);
  assert.match(post.errors.join(" "), /PID changed/i);
});

test("verifyPostDeployment fails on final queue busy", async () => {
  const gitRunner = mockGit({ headSha: "sha", branch: "HEAD", porcelain: "" });
  const post = await verifyPostDeployment({
    runtimeRoot: repoRoot,
    releaseSha: "sha",
    expectedVersion,
    gitRunner,
    fetchFn: deployFetch(expectedVersion, {
      queue: () => new Response(JSON.stringify({ queue_running: [{}], queue_pending: [] }), { status: 200 })
    }),
    inspectPortFn: async port => listeningPort(port === 8188 ? 8188 : 8787),
    config: buildLauncherConfigPayload({ runtimeRoot: repoRoot, comfyRoot: "C:/fake" }),
    comfyPidBefore: 8188
  });
  assert.equal(post.ok, false);
  assert.match(post.errors.join(" "), /queue not idle/i);
});

test("verifyPostDeployment fails on desktop target drift", async () => {
  const gitRunner = mockGit({ headSha: "sha", branch: "HEAD", porcelain: "" });
  const post = await verifyPostDeployment({
    runtimeRoot: repoRoot,
    releaseSha: "sha",
    expectedVersion,
    gitRunner,
    fetchFn: deployFetch(),
    inspectPortFn: async port => listeningPort(port === 8188 ? 8188 : 8787),
    config: buildLauncherConfigPayload({ runtimeRoot: repoRoot, comfyRoot: "C:/fake" }),
    comfyPidBefore: 8188,
    readShortcutFn: async () => ({
      argumentsText: '-File "C:\\dev\\Start-AIVideoDirector.ps1" -PauseOnError',
      workingDirectory: "C:\\dev"
    })
  });
  assert.equal(post.ok, false);
  assert.match(post.errors.join(" "), /Desktop shortcut/i);
});

test("verifyPostDeployment fails on /api/config wrong version", async () => {
  const gitRunner = mockGit({ headSha: "sha", branch: "HEAD", porcelain: "" });
  const post = await verifyPostDeployment({
    runtimeRoot: repoRoot,
    releaseSha: "sha",
    expectedVersion,
    gitRunner,
    fetchFn: deployFetch("0.19.3"),
    inspectPortFn: async port => listeningPort(port === 8188 ? 8188 : 8787),
    config: buildLauncherConfigPayload({ runtimeRoot: repoRoot, comfyRoot: "C:/fake" }),
    comfyPidBefore: 8188
  });
  assert.equal(post.ok, false);
  assert.match(post.errors.join(" "), /\/api\/config version 0\.19\.3/);
});

test("verifyPostDeployment fails on UI wrong version", async () => {
  const gitRunner = mockGit({ headSha: "sha", branch: "HEAD", porcelain: "" });
  const post = await verifyPostDeployment({
    runtimeRoot: repoRoot,
    releaseSha: "sha",
    expectedVersion,
    gitRunner,
    fetchFn: async url => {
      if (String(url).includes("/api/health")) return directorHealth(expectedVersion);
      if (String(url).includes("/api/config")) return directorConfig("0.19.3");
      if (String(url).includes("/queue")) return idleQueue();
      if (String(url).includes("/system_stats")) return comfyStats();
      return directorIndex();
    },
    inspectPortFn: async port => listeningPort(port === 8188 ? 8188 : 8787),
    config: buildLauncherConfigPayload({ runtimeRoot: repoRoot, comfyRoot: "C:/fake" }),
    comfyPidBefore: 8188
  });
  assert.equal(post.ok, false);
  assert.match(post.errors.join(" "), /UI version|\/api\/config/i);
});

test("local preflight allows older healthy Director predecessor", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const plan = await planLocalDeploymentPreflight({
    runtimeRoot: repoRoot,
    configPath,
    gitRunner: mockGit({ headSha: "sha", branch: "HEAD", porcelain: "" }),
    ...busyDeps({ directorVersion: "0.19.3" })
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.director.version, "0.19.3");
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

test("assertComfyUnchangedForDeploy blocks when Comfy disappears", async () => {
  const config = buildLauncherConfigPayload({ runtimeRoot: repoRoot, comfyRoot: "C:/fake" });
  await assert.rejects(() => assertComfyUnchangedForDeploy({
    config,
    comfyPidBefore: 8188,
    inspectPortFn: async () => absentPort(),
    fetchFn: async () => new Response("{}", { status: 503 })
  }), /unhealthy|cannot start|inspection/i);
});

test("deploy-runtime-cli deps with undefined spawnFn restart does not throw spawnFn is not a function", async () => {
  const deployCliDeps = { execFileFn: async () => {} };
  assert.equal(typeof resolveDeps({
    fetchFn: async () => new Response("{}", { status: 404 }),
    inspectPortFn: async () => absentPort(),
    openBrowserFn: () => {},
    spawnFn: deployCliDeps.spawnFn,
    sleepFn: deployCliDeps.sleepFn,
    log: deployCliDeps.log || (() => {})
  }).spawnFn, "function");

  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, dir } = await makeTempConfig(comfyRoot);
  const stopped = [];
  let directorListening = true;
  let directorVersion = "0.19.3";
  let directorChecksAfterStop = 0;
  const fetchFn = async url => {
    if (String(url).includes("/system_stats")) return comfyStats();
    if (String(url).includes("/api/health")) return directorHealth(directorVersion);
    if (String(url).includes("/api/config")) return directorConfig(expectedVersion);
    if (String(url).endsWith("/8787/") || String(url).match(/8787\/?$/)) return directorIndex();
    if (String(url).includes("/queue")) return idleQueue();
    return new Response("{}", { status: 404 });
  };
  const inspectPortFn = async port => {
    if (port === 8188) return listeningPort(8188);
    if (port === 8787) {
      if (!directorListening) {
        if (stopped.length > 0) {
          directorChecksAfterStop += 1;
          if (directorChecksAfterStop >= 2) {
            directorListening = true;
            return listeningPort(9001);
          }
        }
        return absentPort();
      }
      return listeningPort(9001);
    }
    return absentPort();
  };

  let thrown = null;
  let result = null;
  try {
    result = await runRuntimeDeployment({
      runtimeRoot: repoRoot,
      releaseSha: "release-sha",
      expectedVersion,
      configPath,
      gitRunner: mockGit(restartGitState()),
      stopProcessFn: async pid => {
        stopped.push(pid);
        directorListening = false;
        directorVersion = expectedVersion;
      },
      fetchFn,
      inspectPortFn,
      readShortcutFn: shortcutReader(),
      deps: {
        execFileFn: deployCliDeps.execFileFn
      }
    });
  } catch (error) {
    thrown = error;
  }

  assert.deepEqual(stopped, [9001]);
  assert.doesNotMatch(String(thrown?.message || ""), /spawnFn is not a function/i);
  if (result) {
    assert.equal(result.directorRestarted, true);
    assert.doesNotMatch((result.post?.errors || []).join(" "), /spawnFn is not a function/i);
  }
  await rm(dir, { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});
