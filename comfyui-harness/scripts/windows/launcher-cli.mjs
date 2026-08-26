#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { inspectPort } from "../../lib/windows-port-inspect.mjs";
import { assertHarnessRootMatchesRuntimeAuthority, createDefaultGitRunner, validateRuntimeFilesystem, validateRuntimeForInstall } from "../../lib/stable-runtime.mjs";
import {
  ACTION,
  DEFAULT_CONFIG,
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
  readLauncherConfigFile,
  resolveConfigPath,
  resolveHarnessRootFromScript,
  serviceBaseUrl,
  validateConfig,
  waitForHealth,
  buildLauncherBrowserUrls,
  openLauncherBrowserPages
} from "../../lib/windows-launcher.mjs";

function parseArgs(argv = []) {
  const args = { command: "", harnessRoot: "", config: "", comfyRoot: "", runtimeRoot: "", openBrowser: true };
  const rest = [...argv];
  args.command = rest.shift() || "";
  while (rest.length) {
    const token = rest.shift();
    if (token === "--harness-root") args.harnessRoot = rest.shift() || "";
    else if (token === "--config") args.config = rest.shift() || "";
    else if (token === "--comfy-root") args.comfyRoot = rest.shift() || "";
    else if (token === "--runtime-root") args.runtimeRoot = rest.shift() || "";
    else if (token === "--no-browser") args.openBrowser = false;
  }
  return args;
}

function logLine(prefix, message) {
  console.log(`${prefix} ${message}`);
}

function resolveDeps(deps = {}) {
  return {
    fetchFn: deps.fetchFn || fetch,
    spawnFn: deps.spawnFn || spawnDetached,
    openBrowserFn: deps.openBrowserFn || openSystemBrowser,
    inspectPortFn: deps.inspectPortFn || inspectPort,
    sleepFn: deps.sleepFn || (ms => new Promise(resolve => setTimeout(resolve, ms))),
    log: deps.log || ((level, message) => logLine(level, message)),
    ...deps
  };
}

async function loadConfig(configPath, { required = true } = {}) {
  if (!configPath || !existsSync(configPath)) {
    if (!required) return null;
    throw new Error(`Launcher config not found: ${configPath || "(missing path)"}`);
  }
  const raw = await readLauncherConfigFile(configPath);
  return normalizeConfig(raw);
}

export function assertServiceDecision({
  decision,
  portState,
  service,
  port
}) {
  if (decision.action !== ACTION.FAIL) return;
  const label = service === SERVICE.COMFY ? "ComfyUI" : "Director";
  if (portState.inspectionOk === false) {
    throw new Error(
      `${label} port inspection failed on ${port}${portState.diagnostic ? `: ${portState.diagnostic}` : ""}`
    );
  }
  throw new Error(formatOccupiedPortError(service, port, portState.processInfo));
}

function buildServiceStatus({
  port,
  portState,
  health,
  service,
  version = null
}) {
  const decision = decideServiceAction({
    portState,
    healthy: health.healthy,
    service
  });
  return {
    reachable: health.healthy,
    port,
    version,
    pid: portState.processInfo?.pid ?? null,
    executable: portState.processInfo?.executable ?? null,
    commandLine: portState.processInfo?.commandLine ?? null,
    listening: portState.listening,
    inspectionOk: portState.inspectionOk,
    classification: decision.classification,
    health: health.healthy ? "healthy" : "unhealthy"
  };
}

export async function runStatus({
  harnessRoot,
  configPath,
  deps = {}
} = {}) {
  const { fetchFn, inspectPortFn } = resolveDeps(deps);
  const expectedVersion = await readDirectorPackageVersion(harnessRoot).catch(() => null);
  const config = await loadConfig(configPath, { required: false });

  const comfyPort = config?.comfyPort ?? DEFAULT_CONFIG.comfyPort;
  const directorPort = config?.directorPort ?? DEFAULT_CONFIG.directorPort;
  const comfyUrl = serviceBaseUrl(config || DEFAULT_CONFIG, SERVICE.COMFY);
  const directorUrl = serviceBaseUrl(config || DEFAULT_CONFIG, SERVICE.DIRECTOR);

  const comfyPortState = await inspectPortFn(comfyPort, deps);
  const directorPortState = await inspectPortFn(directorPort, deps);
  const comfyHealth = await probeComfyHealth(comfyUrl, { fetchFn });
  const directorHealth = await probeDirectorHealth(directorUrl, expectedVersion || "", { fetchFn });

  return {
    config: {
      path: configPath,
      found: Boolean(config),
      comfyRootValid: config ? validateConfig(config).length === 0 : false
    },
    comfy: buildServiceStatus({
      port: comfyPort,
      portState: comfyPortState,
      health: comfyHealth,
      service: SERVICE.COMFY
    }),
    director: buildServiceStatus({
      port: directorPort,
      portState: directorPortState,
      health: directorHealth,
      service: SERVICE.DIRECTOR,
      version: directorHealth.version || expectedVersion || null
    })
  };
}

export async function runStart({
  harnessRoot,
  configPath,
  configOverride = {},
  deps = {}
} = {}) {
  const { fetchFn, spawnFn, openBrowserFn, inspectPortFn, sleepFn, log } = resolveDeps(deps);

  const loaded = await loadConfig(configPath, { required: true });
  const config = normalizeConfig({ ...loaded, ...configOverride });
  assertHarnessRootMatchesRuntimeAuthority({ runtimeRoot: config.runtimeRoot, harnessRoot });
  const configErrors = validateConfig(config);
  if (configErrors.length) throw new Error(configErrors.join("; "));

  const expectedVersion = await readDirectorPackageVersion(harnessRoot);
  const comfyUrl = serviceBaseUrl(config, SERVICE.COMFY);
  const directorUrl = serviceBaseUrl(config, SERVICE.DIRECTOR);

  log("[OK]", "Config loaded");

  let comfyPortState = await inspectPortFn(config.comfyPort, deps);
  let comfyHealth = await probeComfyHealth(comfyUrl, { fetchFn });
  let comfyDecision = decideServiceAction({
    portState: comfyPortState,
    healthy: comfyHealth.healthy,
    service: SERVICE.COMFY
  });

  if (comfyDecision.action === ACTION.FAIL) {
    assertServiceDecision({
      decision: comfyDecision,
      portState: comfyPortState,
      service: SERVICE.COMFY,
      port: config.comfyPort
    });
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
    comfyPortState = await inspectPortFn(config.comfyPort, deps);
    comfyHealth = await probeComfyHealth(comfyUrl, { fetchFn });
    comfyDecision = decideServiceAction({
      portState: comfyPortState,
      healthy: comfyHealth.healthy,
      service: SERVICE.COMFY
    });
    assertServiceDecision({
      decision: comfyDecision,
      portState: comfyPortState,
      service: SERVICE.COMFY,
      port: config.comfyPort
    });
  }

  let directorSpawnCount = 0;
  let directorPortState = await inspectPortFn(config.directorPort, deps);
  let directorHealth = await probeDirectorHealth(directorUrl, expectedVersion, { fetchFn });
  let directorDecision = decideServiceAction({
    portState: directorPortState,
    healthy: directorHealth.healthy,
    service: SERVICE.DIRECTOR
  });

  if (directorDecision.action === ACTION.FAIL) {
    assertServiceDecision({
      decision: directorDecision,
      portState: directorPortState,
      service: SERVICE.DIRECTOR,
      port: config.directorPort
    });
  }

  if (directorDecision.action === ACTION.REUSE) {
    log("[OK]", `Director v${directorHealth.version || expectedVersion} already healthy on ${config.directorPort}`);
  } else {
    log("[START]", "Director...");
    const nodeExecutable = config.nodeExecutable || "node";
    const directorCmd = buildDirectorCommand(harnessRoot, nodeExecutable, {
      comfyRoot: config.comfyRoot
    });
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
    directorPortState = await inspectPortFn(config.directorPort, deps);
    directorHealth = await probeDirectorHealth(directorUrl, expectedVersion, { fetchFn });
    directorDecision = decideServiceAction({
      portState: directorPortState,
      healthy: directorHealth.healthy,
      service: SERVICE.DIRECTOR
    });
    assertServiceDecision({
      decision: directorDecision,
      portState: directorPortState,
      service: SERVICE.DIRECTOR,
      port: config.directorPort
    });
  }

  const startupPlan = planStartup({
    comfy: {
      listening: comfyPortState.listening,
      inspectionOk: comfyPortState.inspectionOk,
      healthy: true,
      processInfo: comfyPortState.processInfo
    },
    director: {
      listening: directorPortState.listening,
      inspectionOk: directorPortState.inspectionOk,
      healthy: true,
      processInfo: directorPortState.processInfo
    },
    openBrowser: config.openBrowser
  });

  if (startupPlan.openBrowser) {
    const browserUrls = buildLauncherBrowserUrls(directorUrl, comfyUrl);
    log("[OPEN]", browserUrls.directorUrl);
    log("[OPEN]", browserUrls.comfyUrl);
    openLauncherBrowserPages({
      directorBaseUrl: directorUrl,
      comfyBaseUrl: comfyUrl,
      openBrowserFn
    });
  }

  return {
    comfy: comfyDecision,
    director: directorDecision,
    directorVersion: directorHealth.version || expectedVersion,
    browserOpened: startupPlan.openBrowser,
    browserUrls: startupPlan.openBrowser
      ? buildLauncherBrowserUrls(directorUrl, comfyUrl)
      : null,
    spawns: {
      comfy: comfySpawnCount,
      director: directorSpawnCount
    }
  };
}

export async function runDeployDirector({
  harnessRoot,
  configPath,
  configOverride = {},
  requiredComfyPid = null,
  deps = {}
} = {}) {
  const { fetchFn, spawnFn, inspectPortFn, sleepFn, log } = resolveDeps(deps);

  const loaded = await loadConfig(configPath, { required: true });
  const config = normalizeConfig({ ...loaded, ...configOverride });
  assertHarnessRootMatchesRuntimeAuthority({ runtimeRoot: config.runtimeRoot, harnessRoot });
  const configErrors = validateConfig(config);
  if (configErrors.length) throw new Error(configErrors.join("; "));

  const expectedVersion = await readDirectorPackageVersion(harnessRoot);
  const comfyUrl = serviceBaseUrl(config, SERVICE.COMFY);
  const directorUrl = serviceBaseUrl(config, SERVICE.DIRECTOR);

  const comfyPortState = await inspectPortFn(config.comfyPort, deps);
  const comfyHealth = await probeComfyHealth(comfyUrl, { fetchFn });
  const comfyDecision = decideServiceAction({
    portState: comfyPortState,
    healthy: comfyHealth.healthy,
    service: SERVICE.COMFY
  });

  if (comfyDecision.action === ACTION.FAIL) {
    assertServiceDecision({
      decision: comfyDecision,
      portState: comfyPortState,
      service: SERVICE.COMFY,
      port: config.comfyPort
    });
  }
  if (comfyDecision.action === ACTION.START) {
    throw new Error("deployment cannot start ComfyUI");
  }
  if (comfyDecision.action !== ACTION.REUSE) {
    throw new Error("ComfyUI must be healthy and running before deployment Director restart");
  }
  const comfyPid = comfyPortState.processInfo?.pid ?? null;
  if (requiredComfyPid != null && comfyPid !== requiredComfyPid) {
    throw new Error(`ComfyUI PID changed from ${requiredComfyPid} to ${comfyPid ?? "absent"}`);
  }
  log("[OK]", `ComfyUI reuse-only on ${config.comfyPort} (PID ${comfyPid ?? "unknown"})`);

  let directorSpawnCount = 0;
  let directorPortState = await inspectPortFn(config.directorPort, deps);
  let directorHealth = await probeDirectorHealth(directorUrl, expectedVersion, { fetchFn });
  let directorDecision = decideServiceAction({
    portState: directorPortState,
    healthy: directorHealth.healthy,
    service: SERVICE.DIRECTOR
  });

  if (directorDecision.action === ACTION.FAIL) {
    assertServiceDecision({
      decision: directorDecision,
      portState: directorPortState,
      service: SERVICE.DIRECTOR,
      port: config.directorPort
    });
  }

  if (directorDecision.action === ACTION.REUSE) {
    log("[OK]", `Director v${directorHealth.version || expectedVersion} already healthy on ${config.directorPort}`);
  } else {
    log("[START]", "Director...");
    const nodeExecutable = config.nodeExecutable || "node";
    const directorCmd = buildDirectorCommand(harnessRoot, nodeExecutable, {
      comfyRoot: config.comfyRoot
    });
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
    directorPortState = await inspectPortFn(config.directorPort, deps);
    directorHealth = await probeDirectorHealth(directorUrl, expectedVersion, { fetchFn });
    directorDecision = decideServiceAction({
      portState: directorPortState,
      healthy: directorHealth.healthy,
      service: SERVICE.DIRECTOR
    });
    assertServiceDecision({
      decision: directorDecision,
      portState: directorPortState,
      service: SERVICE.DIRECTOR,
      port: config.directorPort
    });
  }

  return {
    comfy: comfyDecision,
    director: directorDecision,
    directorVersion: directorHealth.version || expectedVersion,
    browserOpened: false,
    browserUrls: null,
    spawns: {
      comfy: 0,
      director: directorSpawnCount
    }
  };
}

export function spawnDetached(command) {
  const child = spawn(command.executable, command.arguments, {
    cwd: command.cwd,
    env: command.env || process.env,
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

export async function runValidateRuntime({
  runtimeRoot,
  requireDetached = true,
  requireClean = true,
  gitRunner = null,
  deps = {}
} = {}) {
  const fs = validateRuntimeFilesystem({ runtimeRoot });
  if (!fs.ok) throw new Error(fs.errors.join("; "));

  const git = gitRunner || (deps.execFileFn ? createDefaultGitRunner(deps.execFileFn) : null);
  const install = await validateRuntimeForInstall({
    runtimeRoot: fs.runtimeRoot,
    gitRunner: git,
    requireDetached,
    requireClean
  });
  if (!install.ok) throw new Error(install.errors.join("; "));

  return {
    ...fs,
    git: install.git,
    packageVersion: install.packageVersion
  };
}

const execFileAsync = promisify(execFile);

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
        runtimeRoot: args.runtimeRoot,
        comfyRoot: args.comfyRoot,
        openBrowser: args.openBrowser
      });
      await writeInstallerConfig(configPath, payload);
      console.log(JSON.stringify({ ok: true, configPath, payload }, null, 2));
      return;
    }
    if (args.command === "validate-runtime") {
      const gitRunner = createDefaultGitRunner(execFileAsync);
      const result = await runValidateRuntime({
        runtimeRoot: args.runtimeRoot,
        gitRunner
      });
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      return;
    }
    console.error("Usage: launcher-cli.mjs <start|status|write-config|validate-runtime> [--harness-root PATH] [--config PATH] [--runtime-root PATH]");
    process.exitCode = 2;
    return;
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main();
}
