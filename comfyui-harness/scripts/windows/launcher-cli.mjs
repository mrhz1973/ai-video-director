#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  ACTION,
  SERVICE,
  buildComfyCommand,
  buildDirectorCommand,
  buildLauncherConfigPayload,
  decideServiceAction,
  formatOccupiedPortError,
  normalizeConfig,
  planStartup,
  probeComfyHealth,
  probeDirectorHealth,
  readDirectorPackageVersion,
  resolveConfigPath,
  resolveHarnessRootFromScript,
  serviceBaseUrl,
  validateConfig,
  waitForHealth
} from "../../lib/windows-launcher.mjs";

function parseArgs(argv = []) {
  const args = { command: "", harnessRoot: "", config: "", comfyRoot: "", openBrowser: true };
  const rest = [...argv];
  args.command = rest.shift() || "";
  while (rest.length) {
    const token = rest.shift();
    if (token === "--harness-root") args.harnessRoot = rest.shift() || "";
    else if (token === "--config") args.config = rest.shift() || "";
    else if (token === "--comfy-root") args.comfyRoot = rest.shift() || "";
    else if (token === "--no-browser") args.openBrowser = false;
  }
  return args;
}

function logLine(prefix, message) {
  console.log(`${prefix} ${message}`);
}

async function loadConfig(configPath) {
  if (!configPath || !existsSync(configPath)) {
    throw new Error(`Launcher config not found: ${configPath || "(missing path)"}`);
  }
  const raw = JSON.parse(await readFile(configPath, "utf8"));
  return normalizeConfig(raw);
}

export async function runStatus({
  harnessRoot,
  configPath,
  deps = {}
} = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const getPortOwner = deps.getPortOwner || (async () => null);
  const config = await loadConfig(configPath);
  const expectedVersion = await readDirectorPackageVersion(harnessRoot);
  const comfyUrl = serviceBaseUrl(config, SERVICE.COMFY);
  const directorUrl = serviceBaseUrl(config, SERVICE.DIRECTOR);
  const comfyHealth = await probeComfyHealth(comfyUrl, { fetchFn });
  const directorHealth = await probeDirectorHealth(directorUrl, expectedVersion, { fetchFn });
  const comfyOwner = await getPortOwner(config.comfyPort);
  const directorOwner = await getPortOwner(config.directorPort);

  return {
    config: {
      path: configPath,
      found: true,
      comfyRootValid: validateConfig(config).length === 0
    },
    comfy: {
      reachable: comfyHealth.healthy,
      port: config.comfyPort,
      pid: comfyOwner?.pid || null,
      classification: decideServiceAction({
        listening: Boolean(comfyOwner),
        healthy: comfyHealth.healthy,
        service: SERVICE.COMFY
      }).classification,
      health: comfyHealth.healthy ? "healthy" : "unhealthy"
    },
    director: {
      reachable: directorHealth.healthy,
      port: config.directorPort,
      version: directorHealth.version || null,
      pid: directorOwner?.pid || null,
      classification: decideServiceAction({
        listening: Boolean(directorOwner),
        healthy: directorHealth.healthy,
        service: SERVICE.DIRECTOR
      }).classification,
      health: directorHealth.healthy ? "healthy" : "unhealthy"
    }
  };
}

export async function runStart({
  harnessRoot,
  configPath,
  deps = {}
} = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const spawnFn = deps.spawnFn || spawnDetached;
  const openBrowserFn = deps.openBrowserFn || openSystemBrowser;
  const getPortOwner = deps.getPortOwner || (async () => null);
  const sleepFn = deps.sleepFn || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const log = deps.log || ((level, message) => logLine(level, message));

  const config = await loadConfig(configPath);
  const configErrors = validateConfig(config);
  if (configErrors.length) throw new Error(configErrors.join("; "));

  const expectedVersion = await readDirectorPackageVersion(harnessRoot);
  const comfyUrl = serviceBaseUrl(config, SERVICE.COMFY);
  const directorUrl = serviceBaseUrl(config, SERVICE.DIRECTOR);

  log("[OK]", "Config loaded");

  let comfyOwner = await getPortOwner(config.comfyPort);
  let comfyHealth = await probeComfyHealth(comfyUrl, { fetchFn });
  let comfyDecision = decideServiceAction({
    listening: Boolean(comfyOwner),
    healthy: comfyHealth.healthy,
    service: SERVICE.COMFY,
    processInfo: comfyOwner
  });

  if (comfyDecision.action === ACTION.FAIL) {
    throw new Error(formatOccupiedPortError(SERVICE.COMFY, config.comfyPort, comfyOwner));
  }
  let comfySpawnCount = 0;
  if (comfyDecision.action === ACTION.REUSE) {
    log("[OK]", `ComfyUI already healthy on ${config.comfyPort}`);
  } else {
    log("[START]", "ComfyUI...");
    const comfyCmd = buildComfyCommand(config.comfyRoot);
    spawnFn(comfyCmd);
    comfySpawnCount = 1;
    const wait = await waitForHealth(
      () => probeComfyHealth(comfyUrl, { fetchFn }),
      { timeoutMs: config.comfyTimeoutSeconds * 1000, intervalMs: 1000, sleepFn }
    );
    if (!wait.healthy) throw new Error(`ComfyUI did not become healthy within ${config.comfyTimeoutSeconds}s`);
    log("[OK]", `ComfyUI healthy on ${config.comfyPort}`);
    comfyHealth = wait.attempts;
    comfyOwner = await getPortOwner(config.comfyPort);
    comfyDecision = decideServiceAction({
      listening: Boolean(comfyOwner),
      healthy: true,
      service: SERVICE.COMFY,
      processInfo: comfyOwner
    });
  }

  let directorSpawnCount = 0;
  let directorOwner = await getPortOwner(config.directorPort);
  let directorHealth = await probeDirectorHealth(directorUrl, expectedVersion, { fetchFn });
  let directorDecision = decideServiceAction({
    listening: Boolean(directorOwner),
    healthy: directorHealth.healthy,
    service: SERVICE.DIRECTOR,
    processInfo: directorOwner
  });

  if (directorDecision.action === ACTION.FAIL) {
    throw new Error(formatOccupiedPortError(SERVICE.DIRECTOR, config.directorPort, directorOwner));
  }
  if (directorDecision.action === ACTION.REUSE) {
    log("[OK]", `Director v${directorHealth.version || expectedVersion} already healthy on ${config.directorPort}`);
  } else {
    log("[START]", "Director...");
    const nodeExecutable = config.nodeExecutable || "node";
    const directorCmd = buildDirectorCommand(harnessRoot, nodeExecutable);
    spawnFn(directorCmd);
    directorSpawnCount = 1;
    const wait = await waitForHealth(
      () => probeDirectorHealth(directorUrl, expectedVersion, { fetchFn }),
      { timeoutMs: config.directorTimeoutSeconds * 1000, intervalMs: 500, sleepFn }
    );
    if (!wait.healthy) {
      throw new Error(`Director did not become healthy within ${config.directorTimeoutSeconds}s`);
    }
    directorHealth = wait.attempts;
    log("[OK]", `Director v${directorHealth.version || expectedVersion} healthy on ${config.directorPort}`);
    directorOwner = await getPortOwner(config.directorPort);
    directorDecision = decideServiceAction({
      listening: Boolean(directorOwner),
      healthy: true,
      service: SERVICE.DIRECTOR,
      processInfo: directorOwner
    });
  }

  const startupPlan = planStartup({
    comfy: { listening: Boolean(comfyOwner), healthy: true, processInfo: comfyOwner },
    director: { listening: Boolean(directorOwner), healthy: true, processInfo: directorOwner },
    openBrowser: config.openBrowser
  });

  if (startupPlan.openBrowser) {
    const url = `${directorUrl}/`;
    log("[OPEN]", url);
    openBrowserFn(url);
  }

  return {
    comfy: comfyDecision,
    director: directorDecision,
    directorVersion: directorHealth.version || expectedVersion,
    browserOpened: startupPlan.openBrowser,
    spawns: {
      comfy: comfySpawnCount,
      director: directorSpawnCount
    }
  };
}

export function spawnDetached(command) {
  const child = spawn(command.executable, command.arguments, {
    cwd: command.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return child;
}

export function openSystemBrowser(url) {
  if (process.platform === "win32") {
    const child = spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    return;
  }
  const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  child.unref();
}

export async function writeInstallerConfig(configPath, payload) {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const harnessRoot = path.resolve(args.harnessRoot || resolveHarnessRootFromScript(scriptDir));
  const configPath = resolveConfigPath(args.config);

  try {
    if (args.command === "status") {
      const status = await runStatus({ harnessRoot, configPath });
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    if (args.command === "start") {
      console.log("AI VIDEO DIRECTOR");
      console.log("-----------------");
      const result = await runStart({ harnessRoot, configPath });
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      return;
    }
    if (args.command === "write-config") {
      const payload = buildLauncherConfigPayload({
        comfyRoot: args.comfyRoot,
        openBrowser: args.openBrowser
      });
      await writeInstallerConfig(configPath, payload);
      console.log(JSON.stringify({ ok: true, configPath, payload }, null, 2));
      return;
    }
    console.error("Usage: launcher-cli.mjs <start|status|write-config> [--harness-root PATH] [--config PATH]");
    process.exit(2);
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    process.exit(1);
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main();
}
