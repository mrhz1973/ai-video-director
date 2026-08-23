import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  ACTION,
  PROCESS_CLASS,
  SERVICE,
  assertLauncherSourceSafe,
  buildComfyCommand,
  buildDirectorCommand,
  buildLauncherConfigPayload,
  classifyServiceState,
  decideServiceAction,
  normalizeConfig,
  planStartup,
  probeComfyHealth,
  probeDirectorHealth,
  readDirectorPackageVersion,
  readLauncherConfigFile,
  shouldOpenBrowser,
  stripUtf8Bom,
  validateComfyRoot,
  validateConfig,
  waitForHealth
} from "../lib/windows-launcher.mjs";
import {
  buildPortInspectionPowerShell,
  encodePowerShellCommand,
  inspectPort,
  normalizePortInspection,
  parsePortQueryRows,
  queryPortStateWindows,
  resolvePortInspectionPowerShellExecutable
} from "../lib/windows-port-inspect.mjs";
import { runStart, runStatus, assertServiceDecision } from "../scripts/windows/launcher-cli.mjs";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = path.join(harnessRoot, "scripts", "windows");

function absentPort() {
  return { listening: false, inspectionOk: true, processInfo: null };
}

function listeningPort(pid, extra = {}) {
  return { listening: true, inspectionOk: true, processInfo: { pid, ...extra } };
}

function failedInspection(diagnostic = "inspection failed") {
  return { listening: false, inspectionOk: false, processInfo: null, diagnostic };
}

async function runPowerShellSmoke(shellCommand) {
  const script = [
    `$lib = '${scriptsDir.replace(/\\/g, "\\\\")}\\launcher-lib.ps1'`,
    ". $lib",
    "$root = Get-HarnessRoot",
    "$desktop = Get-DesktopFolderPath",
    "Write-Output \"root=$root\"",
    "Write-Output \"desktop=$desktop\""
  ].join("; ");
  const { stdout, stderr } = await execFileAsync(shellCommand, ["-NoProfile", "-Command", script], { windowsHide: true });
  return { stdout: String(stdout), stderr: String(stderr) };
}

function comfyStats() {
  return new Response(JSON.stringify({ system: { os: "win" }, devices: [] }), { status: 200 });
}

function directorConfig(version = "0.11.0") {
  return new Response(JSON.stringify({ version, presets: [{ id: "minimax-h3-i2v" }] }), { status: 200 });
}

async function makeTempConfig(comfyRoot, overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-launcher-config-"));
  const configPath = path.join(dir, "launcher.json");
  const payload = buildLauncherConfigPayload({ comfyRoot, ...overrides });
  await writeFile(configPath, JSON.stringify(payload), "utf8");
  return { dir, configPath, payload };
}

async function makeFakeComfyRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-comfy-root-"));
  const pythonDir = path.join(root, "python_embeded");
  const comfyDir = path.join(root, "ComfyUI");
  mkdirSync(pythonDir, { recursive: true });
  mkdirSync(comfyDir, { recursive: true });
  writeFileSync(path.join(pythonDir, "python.exe"), "");
  writeFileSync(path.join(comfyDir, "main.py"), "");
  return root;
}

test("Comfy healthy -> reuse, spawn count 0", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  const spawns = [];
  const result = await runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/config")) return directorConfig();
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async port => (port === 8188 || port === 8787 ? listeningPort(1000 + port) : absentPort()),
      spawnFn: cmd => spawns.push(cmd),
      openBrowserFn: () => {}
    }
  });
  assert.equal(result.spawns.comfy, 0);
  assert.equal(result.spawns.director, 0);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("Comfy absent -> exactly one intended start", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  const spawns = [];
  let comfyChecks = 0;
  const result = await runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) {
          comfyChecks += 1;
          return comfyChecks >= 2 ? comfyStats() : new Response("down", { status: 503 });
        }
        if (String(url).includes("/api/config")) return directorConfig();
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async port => (port === 8787 ? listeningPort(9877) : absentPort()),
      spawnFn: cmd => spawns.push(cmd),
      openBrowserFn: () => {},
      sleepFn: async () => {}
    }
  });
  assert.equal(spawns.length, 1);
  assert.match(spawns[0].displayCommand, /python_embeded/);
  assert.equal(result.spawns.comfy, 1);
  assert.equal(result.spawns.director, 0);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("Comfy port occupied by unexpected service -> fail closed", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  await assert.rejects(() => runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async () => new Response("not comfy", { status: 200 }),
      inspectPortFn: async () => listeningPort(4242, { executable: "other.exe", commandLine: "other.exe --port" }),
      spawnFn: () => { throw new Error("should not spawn"); }
    }
  }), /unexpected process/i);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("Comfy startup health timeout -> error", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot, { comfyTimeoutSeconds: 1 });
  await assert.rejects(() => runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async () => new Response("down", { status: 503 }),
      inspectPortFn: async () => absentPort(),
      spawnFn: () => {},
      sleepFn: async () => {}
    }
  }), /did not become healthy/i);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("Director healthy -> reuse, spawn count 0", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  const spawns = [];
  const result = await runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/config")) return directorConfig(await readDirectorPackageVersion(harnessRoot));
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async () => listeningPort(1),
      spawnFn: cmd => spawns.push(cmd),
      openBrowserFn: () => {}
    }
  });
  assert.equal(result.spawns.director, 0);
  assert.equal(spawns.length, 0);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("Director absent -> exactly one intended start", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  const spawns = [];
  let directorChecks = 0;
  const version = await readDirectorPackageVersion(harnessRoot);
  const result = await runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/config")) {
          directorChecks += 1;
          return directorChecks >= 2 ? directorConfig(version) : new Response("down", { status: 503 });
        }
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async port => (port === 8188 ? listeningPort(8188) : absentPort()),
      spawnFn: cmd => spawns.push(cmd),
      openBrowserFn: () => {},
      sleepFn: async () => {}
    }
  });
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].arguments[0], "server.mjs");
  assert.equal(result.spawns.director, 1);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("Director occupied by unexpected service -> fail closed", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  await assert.rejects(() => runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async () => listeningPort(7777, { executable: "node.exe", commandLine: "node other.js" }),
      spawnFn: () => { throw new Error("should not spawn"); }
    }
  }), /unexpected process/i);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("Director startup timeout -> error", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot, { directorTimeoutSeconds: 1 });
  await assert.rejects(() => runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        return new Response("down", { status: 503 });
      },
      inspectPortFn: async port => (port === 8188 ? listeningPort(8188) : absentPort()),
      spawnFn: () => {},
      sleepFn: async () => {}
    }
  }), /Director did not become healthy/i);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("both already healthy -> idempotent success", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  const spawns = [];
  const browsers = [];
  const result = await runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/config")) return directorConfig(await readDirectorPackageVersion(harnessRoot));
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async () => listeningPort(1),
      spawnFn: cmd => spawns.push(cmd),
      openBrowserFn: url => browsers.push(url)
    }
  });
  assert.equal(spawns.length, 0);
  assert.equal(result.comfy.action, ACTION.REUSE);
  assert.equal(result.director.action, ACTION.REUSE);
  assert.equal(browsers.length, 1);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("browser opens only after both health gates", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  const events = [];
  let directorChecks = 0;
  const version = await readDirectorPackageVersion(harnessRoot);
  await runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/config")) {
          directorChecks += 1;
          events.push(`director-probe-${directorChecks}`);
          return directorChecks >= 2 ? directorConfig(version) : new Response("down", { status: 503 });
        }
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async port => (port === 8188 ? listeningPort(8188) : absentPort()),
      spawnFn: () => events.push("spawn-director"),
      openBrowserFn: url => events.push(`open:${url}`),
      sleepFn: async () => {}
    }
  });
  const openIndex = events.findIndex(item => item.startsWith("open:"));
  const lastDirectorProbe = events.findLastIndex(item => item.startsWith("director-probe-"));
  assert.ok(openIndex > lastDirectorProbe);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("openBrowser=false -> browser count 0", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot, { openBrowser: false });
  const browsers = [];
  const result = await runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/config")) return directorConfig(await readDirectorPackageVersion(harnessRoot));
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async () => listeningPort(1),
      spawnFn: () => {},
      openBrowserFn: url => browsers.push(url)
    }
  });
  assert.equal(browsers.length, 0);
  assert.equal(result.browserOpened, false);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("status command performs no writes/spawns", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  const spawns = [];
  const status = await runStatus({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/config")) return directorConfig(await readDirectorPackageVersion(harnessRoot));
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async () => listeningPort(1)
    }
  });
  assert.equal(spawns.length, 0);
  assert.equal(status.comfy.reachable, true);
  assert.equal(status.director.reachable, true);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("installer config contains supplied machine path only in generated output", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const payload = buildLauncherConfigPayload({ comfyRoot, openBrowser: true });
  assert.equal(payload.comfyRoot, path.resolve(comfyRoot));
  const installer = await readFile(path.join(scriptsDir, "Install-AIVideoDirectorLauncher.ps1"), "utf8");
  assert.doesNotMatch(installer, /[A-Za-z]:\\Users\\/);
  assert.doesNotMatch(installer, /comfyRoot\s*=\s*['"][A-Za-z]:\\/);
  await rm(comfyRoot, { recursive: true, force: true });
});

test("Desktop path uses Known Folder API/shell resolution", async () => {
  const lib = await readFile(path.join(scriptsDir, "launcher-lib.ps1"), "utf8");
  assert.match(lib, /GetFolderPath\('Desktop'\)/);
  const installer = await readFile(path.join(scriptsDir, "Install-AIVideoDirectorLauncher.ps1"), "utf8");
  assert.match(installer, /Get-DesktopFolderPath/);
  assert.doesNotMatch(installer, /Users\\[^\\]+\\Desktop/);
});

test("launcher source contains no /api/queue POST or ComfyUI /prompt POST", async () => {
  const files = [
    path.join(harnessRoot, "lib", "windows-launcher.mjs"),
    path.join(harnessRoot, "lib", "windows-port-inspect.mjs"),
    path.join(scriptsDir, "launcher-cli.mjs"),
    path.join(scriptsDir, "Start-AIVideoDirector.ps1"),
    path.join(scriptsDir, "Get-AIVideoDirectorStatus.ps1"),
    path.join(scriptsDir, "Install-AIVideoDirectorLauncher.ps1"),
    path.join(scriptsDir, "launcher-lib.ps1")
  ];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const safety = assertLauncherSourceSafe(text);
    assert.equal(safety.safe, true, `${file} contains forbidden patterns: ${safety.hits.join(", ")}`);
  }
});

test("decision helpers classify occupied and healthy ports", () => {
  assert.equal(decideServiceAction({ portState: listeningPort(1), healthy: true }).action, ACTION.REUSE);
  assert.equal(decideServiceAction({ portState: absentPort(), healthy: false }).action, ACTION.START);
  assert.equal(decideServiceAction({ portState: listeningPort(1), healthy: false }).action, ACTION.FAIL);
  assert.equal(decideServiceAction({ portState: failedInspection(), healthy: false }).action, ACTION.FAIL);
  assert.equal(classifyServiceState({ listening: true, healthy: false, inspectionOk: true }), PROCESS_CLASS.UNKNOWN);
  assert.equal(classifyServiceState({ listening: false, healthy: false, inspectionOk: false }), PROCESS_CLASS.UNKNOWN);
});

test("buildComfyCommand uses portable relative layout", () => {
  const cmd = buildComfyCommand("C:/ComfyPortable");
  assert.equal(cmd.displayCommand, "python_embeded\\python.exe -s ComfyUI\\main.py --windows-standalone-build");
  assert.match(cmd.executable.replace(/\\/g, "/"), /python_embeded\/python\.exe$/);
  assert.match(cmd.arguments[1].replace(/\\/g, "/"), /ComfyUI\/main\.py$/);
});

test("buildDirectorCommand targets server.mjs in harness root", () => {
  const cmd = buildDirectorCommand(harnessRoot, "node");
  assert.deepEqual(cmd.arguments, ["server.mjs"]);
  assert.equal(cmd.cwd, harnessRoot);
});

test("probe helpers recognize healthy ComfyUI and Director responses", async () => {
  const comfy = await probeComfyHealth("http://127.0.0.1:8188", {
    fetchFn: async () => comfyStats()
  });
  assert.equal(comfy.healthy, true);
  const director = await probeDirectorHealth("http://127.0.0.1:8787", "0.11.0", {
    fetchFn: async () => directorConfig("0.11.0")
  });
  assert.equal(director.healthy, true);
});

test("waitForHealth times out cleanly", async () => {
  const result = await waitForHealth(
    async () => ({ healthy: false }),
    { timeoutMs: 20, intervalMs: 5, sleepFn: async () => {} }
  );
  assert.equal(result.healthy, false);
});

test("shouldOpenBrowser requires both services healthy and config enabled", () => {
  assert.equal(shouldOpenBrowser({ openBrowser: true, comfyHealthy: true, directorHealthy: true }), true);
  assert.equal(shouldOpenBrowser({ openBrowser: false, comfyHealthy: true, directorHealthy: true }), false);
  assert.equal(shouldOpenBrowser({ openBrowser: true, comfyHealthy: false, directorHealthy: true }), false);
});

test("validateConfig rejects missing comfy files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-bad-comfy-"));
  const errors = validateConfig(normalizeConfig({ comfyRoot: root }));
  assert.ok(errors.length > 0);
  await rm(root, { recursive: true, force: true });
});

test("validateComfyRoot checks portable files", async () => {
  const root = await makeFakeComfyRoot();
  assert.deepEqual(validateComfyRoot(root), []);
  await rm(root, { recursive: true, force: true });
});

test("planStartup fails closed when either service is unknown occupant", () => {
  const bad = planStartup({
    comfy: { listening: true, healthy: false, processInfo: { pid: 1 } },
    director: { listening: true, healthy: true }
  });
  assert.equal(bad.ok, false);
});

test("readDirectorPackageVersion reads local package.json", async () => {
  const version = await readDirectorPackageVersion(harnessRoot);
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test("production launcher wires inspectPort instead of null port-owner fallback", async () => {
  const cliSource = await readFile(path.join(scriptsDir, "launcher-cli.mjs"), "utf8");
  assert.match(cliSource, /inspectPortFn:\s*deps\.inspectPortFn\s*\|\|\s*inspectPort/);
  assert.doesNotMatch(cliSource, /getPortOwner/);
  assert.doesNotMatch(cliSource, /async\s*\(\)\s*=>\s*null/);
});

test("parsePortQueryRows distinguishes absent, listening, and inspection failure", () => {
  const absent = parsePortQueryRows(8188, { connections: [] });
  assert.equal(absent.listening, false);
  assert.equal(absent.inspectionOk, true);

  const listening = parsePortQueryRows(8188, {
    connections: [{ LocalPort: 8188, State: "Listen", OwningProcess: 4242 }],
    processes: { 4242: { ExecutablePath: "python.exe", CommandLine: "python main.py" } }
  });
  assert.equal(listening.listening, true);
  assert.equal(listening.processInfo.pid, 4242);

  const failed = parsePortQueryRows(8188, { inspectionOk: false, diagnostic: "powershell failed" });
  assert.equal(failed.inspectionOk, false);
  assert.equal(decideServiceAction({ portState: failed, healthy: false }).action, ACTION.FAIL);
});

test("listening with unavailable process metadata still fails closed when unhealthy", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  await assert.rejects(() => runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async () => new Response("not comfy", { status: 503 }),
      inspectPortFn: async () => ({ listening: true, inspectionOk: true, processInfo: { pid: 9999 } }),
      spawnFn: () => { throw new Error("should not spawn"); }
    }
  }), /unexpected process/i);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("port inspection failure fails closed and never starts", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  const spawns = [];
  await assert.rejects(() => runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async () => new Response("down", { status: 503 }),
      inspectPortFn: async () => failedInspection("Get-NetTCPConnection unavailable"),
      spawnFn: cmd => spawns.push(cmd)
    }
  }), /port inspection failed/i);
  assert.equal(spawns.length, 0);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("post-start Comfy reinspection failure rejects and does not open browser or start Director", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  const spawns = [];
  const browsers = [];
  let comfyInspectCount = 0;
  let comfyHealthChecks = 0;
  await assert.rejects(() => runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) {
          comfyHealthChecks += 1;
          return comfyHealthChecks >= 2 ? comfyStats() : new Response("down", { status: 503 });
        }
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async port => {
        if (port !== 8188) return absentPort();
        comfyInspectCount += 1;
        if (comfyInspectCount === 1) return absentPort();
        return failedInspection("post-start Comfy inspection unavailable");
      },
      spawnFn: cmd => spawns.push(cmd),
      openBrowserFn: url => browsers.push(url),
      sleepFn: async () => {}
    }
  }), /ComfyUI port inspection failed on 8188: post-start Comfy inspection unavailable/);
  assert.equal(spawns.length, 1);
  assert.equal(browsers.length, 0);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("post-start Director reinspection failure rejects and does not open browser", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  const spawns = [];
  const browsers = [];
  let directorInspectCount = 0;
  let directorHealthChecks = 0;
  const version = await readDirectorPackageVersion(harnessRoot);
  await assert.rejects(() => runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/config")) {
          directorHealthChecks += 1;
          return directorHealthChecks >= 2 ? directorConfig(version) : new Response("down", { status: 503 });
        }
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async port => {
        if (port === 8188) return listeningPort(8188);
        directorInspectCount += 1;
        if (directorInspectCount === 1) return absentPort();
        return failedInspection("post-start Director inspection unavailable");
      },
      spawnFn: cmd => spawns.push(cmd),
      openBrowserFn: url => browsers.push(url),
      sleepFn: async () => {}
    }
  }), /Director port inspection failed on 8787: post-start Director inspection unavailable/);
  assert.equal(spawns.length, 1);
  assert.match(spawns[0].displayCommand, /server\.mjs/);
  assert.equal(browsers.length, 0);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("post-start listening but invalid ownership fails closed after HTTP health", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  let comfyInspectCount = 0;
  let comfyHealthChecks = 0;
  await assert.rejects(() => runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) {
          comfyHealthChecks += 1;
          if (comfyHealthChecks === 1) return new Response("down", { status: 503 });
          if (comfyHealthChecks === 2) return comfyStats();
          return new Response("not comfy", { status: 503 });
        }
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async port => {
        if (port !== 8188) return absentPort();
        comfyInspectCount += 1;
        if (comfyInspectCount === 1) return absentPort();
        return listeningPort(4242, { executable: "other.exe", commandLine: "other.exe --listen" });
      },
      spawnFn: () => {},
      openBrowserFn: () => { throw new Error("browser should not open"); },
      sleepFn: async () => {}
    }
  }), /unexpected process/i);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("assertServiceDecision throws for inspection and occupied-port failures", () => {
  assert.throws(() => assertServiceDecision({
    decision: { action: ACTION.FAIL },
    portState: failedInspection("powershell failed"),
    service: SERVICE.COMFY,
    port: 8188
  }), /ComfyUI port inspection failed on 8188: powershell failed/);
  assert.throws(() => assertServiceDecision({
    decision: { action: ACTION.FAIL },
    portState: listeningPort(4242, { executable: "other.exe" }),
    service: SERVICE.DIRECTOR,
    port: 8787
  }), /unexpected process/i);
});

test("status reports PID metadata when available", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  const status = await runStatus({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/config")) return directorConfig(await readDirectorPackageVersion(harnessRoot));
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async port => listeningPort(1000 + port, {
        executable: port === 8188 ? "python.exe" : "node.exe",
        commandLine: port === 8188 ? "python main.py" : "node server.mjs"
      })
    }
  });
  assert.equal(status.comfy.pid, 9188);
  assert.equal(status.director.pid, 9787);
  assert.equal(status.comfy.executable, "python.exe");
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("status with missing config is useful and read-only", async () => {
  const missingPath = path.join(os.tmpdir(), `missing-launcher-${Date.now()}.json`);
  const status = await runStatus({
    harnessRoot,
    configPath: missingPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/config")) return directorConfig(await readDirectorPackageVersion(harnessRoot));
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async port => (port === 8787 ? listeningPort(9024) : absentPort())
    }
  });
  assert.equal(status.config.found, false);
  assert.equal(status.config.comfyRootValid, false);
  assert.equal(status.config.path, missingPath);
  assert.equal(status.director.pid, 9024);
});

test("launcher config loader accepts UTF-8 BOM and plain UTF-8", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-bom-config-"));
  const configPath = path.join(dir, "launcher.json");
  const payload = { comfyRoot: "C:/Comfy", openBrowser: true, comfyTimeoutSeconds: 180, directorTimeoutSeconds: 30 };
  await writeFile(configPath, `\uFEFF${JSON.stringify(payload)}`, "utf8");
  const withBom = await readLauncherConfigFile(configPath);
  assert.equal(withBom.comfyRoot, "C:/Comfy");
  await writeFile(configPath, JSON.stringify(payload), "utf8");
  const plain = await readLauncherConfigFile(configPath);
  assert.equal(plain.comfyRoot, "C:/Comfy");
  assert.equal(stripUtf8Bom("\uFEFFabc"), "abc");
  await rm(dir, { recursive: true, force: true });
});

test("installer writes UTF-8 without BOM", async () => {
  const installer = await readFile(path.join(scriptsDir, "Install-AIVideoDirectorLauncher.ps1"), "utf8");
  assert.match(installer, /UTF8Encoding \$false/);
  assert.match(installer, /WriteAllText/);
  assert.doesNotMatch(installer, /Set-Content -LiteralPath \$resolvedConfig -Encoding UTF8/);
});

test("launcher-lib.ps1 is dot-source safe", async () => {
  const lib = await readFile(path.join(scriptsDir, "launcher-lib.ps1"), "utf8");
  assert.doesNotMatch(lib, /Export-ModuleMember/);
});

test("buildPortInspectionPowerShell produces valid block-oriented script", () => {
  const script = buildPortInspectionPowerShell(54321);
  assert.match(script, /\$port = 54321/);
  assert.match(script, /if \(-not \$conn\) \{/);
  assert.doesNotMatch(script, /\{;/);
  assert.doesNotMatch(script, /@\{;/);
  assert.doesNotMatch(script, /join\("; "\)/);
});

test("encodePowerShellCommand produces UTF-16LE Base64 for -EncodedCommand", () => {
  const source = "Write-Output 'ok'";
  const encoded = encodePowerShellCommand(source);
  const decoded = Buffer.from(encoded, "base64").toString("utf16le");
  assert.equal(decoded, source);
});

test("port inspection source does not use fragile semicolon-joined blocks", async () => {
  const source = await readFile(path.join(harnessRoot, "lib", "windows-port-inspect.mjs"), "utf8");
  assert.doesNotMatch(source, /\.join\("; "\)/);
  assert.match(source, /-EncodedCommand/);
  assert.match(source, /buildPortInspectionPowerShell/);
});

test("installer shortcut includes -PauseOnError", async () => {
  const lib = await readFile(path.join(scriptsDir, "launcher-lib.ps1"), "utf8");
  assert.match(lib, /-PauseOnError/);
  const start = await readFile(path.join(scriptsDir, "Start-AIVideoDirector.ps1"), "utf8");
  assert.match(start, /\[switch\]\$PauseOnError/);
  assert.match(start, /Wait-LauncherErrorPause/);
  const status = await readFile(path.join(scriptsDir, "Get-AIVideoDirectorStatus.ps1"), "utf8");
  assert.doesNotMatch(status, /PauseOnError/);
});

test("Start script preserves noninteractive path without PauseOnError", async () => {
  const start = await readFile(path.join(scriptsDir, "Start-AIVideoDirector.ps1"), "utf8");
  assert.match(start, /if \(\$PauseOnError\)/);
  assert.match(start, /\[ERROR\].*\$_.Exception\.Message/);
  assert.doesNotMatch(start, /-NoExit/);
});

test("queryPortStateWindows honors explicit powershellExecutable override", async () => {
  const fakeShell = "X:\\Fake\\powershell.exe";
  let receivedShell = null;
  let receivedArgs = null;
  await queryPortStateWindows(49152, {
    powershellExecutable: fakeShell,
    execFileFn: async (shell, args) => {
      receivedShell = shell;
      receivedArgs = args;
      return {
        stdout: JSON.stringify({
          listening: false,
          inspectionOk: true,
          processInfo: null
        })
      };
    }
  });
  assert.equal(receivedShell, fakeShell);
  assert.notEqual(receivedShell.toLowerCase(), `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`.toLowerCase());
  assert.ok(receivedArgs.includes("-EncodedCommand"));
});

test("resolvePortInspectionPowerShellExecutable prefers override then SystemRoot", () => {
  assert.equal(
    resolvePortInspectionPowerShellExecutable({ powershellExecutable: "X:\\Fake\\powershell.exe" }),
    "X:\\Fake\\powershell.exe"
  );
  if (process.env.SystemRoot) {
    assert.equal(
      resolvePortInspectionPowerShellExecutable({}),
      `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    );
  }
});

async function parsePowerShellScript(script) {
  if (script.includes("'@")) {
    throw new Error("script cannot contain a PowerShell here-string terminator");
  }
  const shell = process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : "powershell.exe";
  const parser = [
    "$errors = $null",
    "$tokens = $null",
    "$source = @'",
    script,
    "'@",
    "[void][System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)",
    "if ($errors.Count -gt 0) {",
    "  $errors | ForEach-Object { Write-Output $_.Message }",
    "  exit 1",
    "}",
    "exit 0"
  ].join("\n");
  const encodedParser = encodePowerShellCommand(parser);
  const { stdout, stderr } = await execFileAsync(shell, [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encodedParser
  ], { windowsHide: true });
  return { stdout: String(stdout), stderr: String(stderr) };
}

async function runPowerShellFunction(functionName, setupLines = []) {
  const shell = process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : "powershell.exe";
  const script = [
    `$lib = '${scriptsDir.replace(/\\/g, "\\\\")}\\launcher-lib.ps1'`,
    ". $lib",
    ...setupLines,
    `$result = ${functionName}`,
    'Write-Output ("SELECTED=" + $result)'
  ].join("\n");
  const { stdout, stderr } = await execFileAsync(shell, [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encodePowerShellCommand(script)
  ], { windowsHide: true });
  const match = String(stdout).match(/^SELECTED=(.*)$/m);
  return { stdout: match ? match[1].trim() : String(stdout).trim(), stderr: String(stderr) };
}

if (process.platform === "win32") {
  test("generated port inspection PowerShell parses without ParserError", async () => {
    const script = buildPortInspectionPowerShell(49152);
    const result = await parsePowerShellScript(script);
    assert.equal(result.stdout.trim(), "");
    assert.equal(result.stderr.trim(), "");
  });

  test("real Windows temporary TCP listener is detected by queryPortStateWindows", async () => {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : null;
    assert.ok(port);
    assert.notEqual(port, 8188);
    assert.notEqual(port, 8787);
    assert.notEqual(port, 8788);
    try {
      const raw = await queryPortStateWindows(port);
      assert.equal(raw.inspectionOk, true);
      assert.equal(raw.listening, true);
      if (raw.processInfo?.pid != null) {
        assert.ok(Number(raw.processInfo.pid) > 0);
      }
      const wrapped = await inspectPort(port);
      assert.equal(wrapped.inspectionOk, true);
      assert.equal(wrapped.listening, true);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test("real Windows inspection reports absent port as listening=false inspectionOk=true", async () => {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const usedPort = typeof address === "object" && address ? address.port : null;
    assert.ok(usedPort);
    await new Promise(resolve => server.close(resolve));
    const freePort = usedPort;
    const raw = await queryPortStateWindows(freePort);
    assert.equal(raw.inspectionOk, true);
    assert.equal(raw.listening, false);
    assert.equal(raw.processInfo, null);
  });

  test("Get-PowerShellLauncherExecutable rejects WindowsApps alias and uses concrete shell", async () => {
    const ps51 = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const result = await runPowerShellFunction("Get-PowerShellLauncherExecutable");
    assert.equal(result.stdout.toLowerCase(), ps51.toLowerCase());
    assert.doesNotMatch(result.stdout, /WindowsApps/i);
  });

  test("Get-PowerShellLauncherExecutable prefers concrete PS7 when fixture path exists", async () => {
    const shell = process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : "powershell.exe";
    const script = [
      `$lib = '${scriptsDir.replace(/\\/g, "\\\\")}\\launcher-lib.ps1'`,
      ". $lib",
      "$tempRoot = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ('ps7-fixture-' + [guid]::NewGuid().ToString())) -Force",
      "$ps7Dir = Join-Path $tempRoot.FullName 'PowerShell\\7'",
      "New-Item -ItemType Directory -Path $ps7Dir -Force | Out-Null",
      "$fakePs7 = Join-Path $ps7Dir 'pwsh.exe'",
      "Set-Content -LiteralPath $fakePs7 -Value 'fake' -NoNewline",
      "$savedProgramFiles = $env:ProgramFiles",
      "$env:ProgramFiles = $tempRoot.FullName",
      "try {",
      "  $selected = Get-PowerShellLauncherExecutable",
      "  Write-Output $selected",
      "} finally {",
      "  $env:ProgramFiles = $savedProgramFiles",
      "  Remove-Item -LiteralPath $tempRoot.FullName -Recurse -Force",
      "}"
    ].join("\n");
    const { stdout } = await execFileAsync(shell, [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodePowerShellCommand(script)
    ], { windowsHide: true });
    assert.match(stdout.trim(), /PowerShell\\7\\pwsh\.exe$/i);
    assert.doesNotMatch(stdout, /WindowsApps/i);
  });

  test("Get-PowerShellLauncherExecutable throws when no usable shell exists", async () => {
    const shell = process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : "powershell.exe";
    const script = [
      `$lib = '${scriptsDir.replace(/\\/g, "\\\\")}\\launcher-lib.ps1'`,
      ". $lib",
      "function Test-ConcretePowerShellExecutable { param([string]$Path) return $false }",
      "try {",
      "  Get-PowerShellLauncherExecutable | Out-Null",
      "  exit 2",
      "} catch {",
      "  Write-Output ('ERROR=' + $_.Exception.Message)",
      "  exit 0",
      "}"
    ].join("\n");
    const { stdout } = await execFileAsync(shell, [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodePowerShellCommand(script)
    ], { windowsHide: true });
    const match = String(stdout).match(/^ERROR=(.*)$/m);
    assert.ok(match);
    assert.match(match[1], /No usable PowerShell executable/i);
  });

  test("production port inspection script executes via Windows PowerShell 5.1", async () => {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : null;
    assert.ok(port);
    const shell = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const source = buildPortInspectionPowerShell(port);
    const encoded = encodePowerShellCommand(source);
    try {
      const { stdout } = await execFileAsync(shell, [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        encoded
      ], { windowsHide: true });
      const parsed = JSON.parse(String(stdout).trim());
      assert.equal(parsed.inspectionOk, true);
      assert.equal(parsed.listening, true);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test("Start-AIVideoDirector.ps1 displays simulated PowerShell-layer error without pausing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "h3-start-script-"));
    const libSource = await readFile(path.join(scriptsDir, "launcher-lib.ps1"), "utf8");
    const startSource = await readFile(path.join(scriptsDir, "Start-AIVideoDirector.ps1"), "utf8");
    const throwingLib = libSource.replace(
      /function Invoke-LauncherCli \{[\s\S]*?\n\}\r?\n\r?\nfunction Wait-LauncherErrorPause/,
      [
        "function Invoke-LauncherCli {",
        "    param(",
        "        [Parameter(Mandatory = $true)][ValidateSet('start', 'status')][string]$Command,",
        "        [string]$HarnessRoot = (Get-HarnessRoot),",
        "        [string]$ConfigPath = (Get-LauncherConfigPath)",
        "    )",
        "    throw 'SIMULATED LAUNCHER FAILURE'",
        "}",
        "",
        "function Wait-LauncherErrorPause"
      ].join("\n")
    );
    await writeFile(path.join(tempDir, "launcher-lib.ps1"), throwingLib, "utf8");
    await writeFile(path.join(tempDir, "Start-AIVideoDirector.ps1"), startSource, "utf8");
    const shell = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const startScript = path.join(tempDir, "Start-AIVideoDirector.ps1");
    let proc;
    try {
      proc = await new Promise((resolve, reject) => {
        execFile(shell, [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          startScript
        ], { windowsHide: true }, (error, stdout, stderr) => {
          resolve({ error, stdout: String(stdout), stderr: String(stderr) });
        });
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
    assert.ok(proc.error, "expected non-zero exit");
    assert.notEqual(proc.error.code, 0);
    const combined = `${proc.stdout}\n${proc.stderr}`;
    assert.match(combined, /SIMULATED LAUNCHER FAILURE/);
    assert.match(combined, /\[ERROR\]/);
    assert.doesNotMatch(combined, /Press Enter to close this window/i);
  });
}

if (process.platform === "win32") {
  test("PowerShell 7 helper runtime smoke", async () => {
    try {
      const result = await runPowerShellSmoke("pwsh");
      assert.match(result.stdout, /root=/);
      assert.match(result.stdout, /desktop=/);
    } catch (error) {
      if (String(error?.message || error).includes("ENOENT")) return;
      throw error;
    }
  });

  test("Windows PowerShell 5.1 helper runtime smoke", async () => {
    const result = await runPowerShellSmoke("powershell");
    assert.match(result.stdout, /root=/);
    assert.match(result.stdout, /desktop=/);
  });
}
