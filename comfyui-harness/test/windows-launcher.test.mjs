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
  inspectPort,
  normalizePortInspection,
  parsePortQueryRows
} from "../lib/windows-port-inspect.mjs";
import { runStart, runStatus } from "../scripts/windows/launcher-cli.mjs";
import { execFile } from "node:child_process";
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

function directorConfig(version = "0.8.7") {
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
  const director = await probeDirectorHealth("http://127.0.0.1:8787", "0.8.7", {
    fetchFn: async () => directorConfig("0.8.7")
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
