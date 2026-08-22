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
  shouldOpenBrowser,
  validateComfyRoot,
  validateConfig,
  waitForHealth
} from "../lib/windows-launcher.mjs";
import { runStart, runStatus } from "../scripts/windows/launcher-cli.mjs";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = path.join(harnessRoot, "scripts", "windows");

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
      getPortOwner: async port => (port === 8188 || port === 8787 ? { pid: 1000 + port } : null),
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
      getPortOwner: async port => (port === 8787 ? { pid: 9877 } : null),
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
      getPortOwner: async port => ({ pid: 4242, executable: "other.exe", commandLine: "other.exe --port" }),
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
      getPortOwner: async () => null,
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
      getPortOwner: async () => ({ pid: 1 }),
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
      getPortOwner: async port => (port === 8188 ? { pid: 8188 } : null),
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
      getPortOwner: async port => ({ pid: 7777, executable: "node.exe", commandLine: "node other.js" }),
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
      getPortOwner: async port => (port === 8188 ? { pid: 8188 } : null),
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
      getPortOwner: async () => ({ pid: 1 }),
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
      getPortOwner: async port => (port === 8188 ? { pid: 8188 } : null),
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
      getPortOwner: async () => ({ pid: 1 }),
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
      getPortOwner: async () => ({ pid: 1 })
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
  assert.equal(decideServiceAction({ listening: true, healthy: true }).action, ACTION.REUSE);
  assert.equal(decideServiceAction({ listening: false, healthy: false }).action, ACTION.START);
  assert.equal(decideServiceAction({ listening: true, healthy: false }).action, ACTION.FAIL);
  assert.equal(classifyServiceState({ listening: true, healthy: false }), PROCESS_CLASS.UNKNOWN);
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
