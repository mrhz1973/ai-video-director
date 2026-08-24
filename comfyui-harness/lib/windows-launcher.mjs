import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CONFIG = Object.freeze({
  comfyRoot: "",
  openBrowser: true,
  comfyTimeoutSeconds: 180,
  directorTimeoutSeconds: 30,
  comfyHost: "127.0.0.1",
  comfyPort: 8188,
  directorHost: "127.0.0.1",
  directorPort: 8787,
  nodeExecutable: ""
});

export const SERVICE = Object.freeze({
  COMFY: "comfy",
  DIRECTOR: "director"
});

export const PROCESS_CLASS = Object.freeze({
  HEALTHY: "healthy",
  ABSENT: "absent",
  UNKNOWN: "unknown"
});

export const ACTION = Object.freeze({
  REUSE: "reuse",
  START: "start",
  FAIL: "fail"
});

export function normalizeConfig(raw = {}, defaults = DEFAULT_CONFIG) {
  const merged = { ...defaults, ...(raw && typeof raw === "object" ? raw : {}) };
  return {
    comfyRoot: String(merged.comfyRoot || "").trim(),
    openBrowser: merged.openBrowser !== false,
    comfyTimeoutSeconds: Number(merged.comfyTimeoutSeconds ?? defaults.comfyTimeoutSeconds),
    directorTimeoutSeconds: Number(merged.directorTimeoutSeconds ?? defaults.directorTimeoutSeconds),
    comfyHost: String(merged.comfyHost || defaults.comfyHost),
    comfyPort: Number(merged.comfyPort ?? defaults.comfyPort),
    directorHost: String(merged.directorHost || defaults.directorHost),
    directorPort: Number(merged.directorPort ?? defaults.directorPort),
    nodeExecutable: String(merged.nodeExecutable || "").trim()
  };
}

export function validateConfig(config = {}) {
  const errors = [];
  if (!config.comfyRoot) errors.push("comfyRoot is required");
  else {
    const comfyErrors = validateComfyRoot(config.comfyRoot);
    errors.push(...comfyErrors);
  }
  if (!Number.isFinite(config.comfyTimeoutSeconds) || config.comfyTimeoutSeconds <= 0) {
    errors.push("comfyTimeoutSeconds must be a positive number");
  }
  if (!Number.isFinite(config.directorTimeoutSeconds) || config.directorTimeoutSeconds <= 0) {
    errors.push("directorTimeoutSeconds must be a positive number");
  }
  return errors;
}

export function validateComfyRoot(comfyRoot = "") {
  const errors = [];
  const root = path.resolve(String(comfyRoot || "").trim());
  if (!root) {
    errors.push("comfyRoot is empty");
    return errors;
  }
  const python = path.join(root, "python_embeded", "python.exe");
  const mainPy = path.join(root, "ComfyUI", "main.py");
  if (!existsSync(python)) errors.push(`ComfyUI python not found: ${path.join("python_embeded", "python.exe")}`);
  if (!existsSync(mainPy)) errors.push(`ComfyUI main.py not found: ${path.join("ComfyUI", "main.py")}`);
  return errors;
}

export function buildComfyCommand(comfyRoot = "") {
  const root = path.resolve(String(comfyRoot || "").trim());
  const python = path.join(root, "python_embeded", "python.exe");
  const mainPy = path.join(root, "ComfyUI", "main.py");
  return {
    cwd: root,
    executable: python,
    arguments: ["-s", mainPy, "--windows-standalone-build"],
    displayCommand: "python_embeded\\python.exe -s ComfyUI\\main.py --windows-standalone-build"
  };
}

export function deriveComfyOutputDirectoryFromComfyRoot(comfyRoot = "") {
  const root = String(comfyRoot || "").trim();
  if (!root) return null;
  return path.join(path.resolve(root), "ComfyUI", "output");
}

export function buildDirectorCommand(harnessRoot = "", nodeExecutable = "node", {
  comfyRoot = "",
  env = process.env
} = {}) {
  const root = path.resolve(String(harnessRoot || "").trim());
  const server = path.join(root, "server.mjs");
  if (!existsSync(server)) {
    throw new Error(`Director server.mjs not found in harness root`);
  }
  const executable = String(nodeExecutable || "node").trim() || "node";
  const nextEnv = { ...(env || {}) };
  const derived = deriveComfyOutputDirectoryFromComfyRoot(comfyRoot);
  // Launcher-derived output root; explicit H3_COMFY_OUTPUT_DIRECTORY / harness config win later in server.
  if (derived && !String(nextEnv.H3_COMFY_OUTPUT_DIRECTORY || "").trim()) {
    nextEnv.H3_COMFY_OUTPUT_DIRECTORY = derived;
  }
  return {
    cwd: root,
    executable,
    arguments: ["server.mjs"],
    env: nextEnv,
    displayCommand: `${executable} server.mjs`
  };
}

export async function readDirectorPackageVersion(harnessRoot = "") {
  const packagePath = path.join(path.resolve(harnessRoot), "package.json");
  const text = await readFile(packagePath, "utf8");
  const pkg = JSON.parse(text);
  if (!pkg?.version) throw new Error("package.json is missing version");
  return String(pkg.version);
}

export function serviceBaseUrl(config, service) {
  if (service === SERVICE.COMFY) {
    return `http://${config.comfyHost}:${config.comfyPort}`;
  }
  return `http://${config.directorHost}:${config.directorPort}`;
}

export function classifyServiceState({ listening = false, healthy = false, inspectionOk = true } = {}) {
  if (!inspectionOk) return PROCESS_CLASS.UNKNOWN;
  if (healthy) return PROCESS_CLASS.HEALTHY;
  if (!listening) return PROCESS_CLASS.ABSENT;
  return PROCESS_CLASS.UNKNOWN;
}

export function decideServiceAction({
  portState = { listening: false, inspectionOk: true, processInfo: null },
  healthy = false,
  service = SERVICE.COMFY
} = {}) {
  const listening = Boolean(portState?.listening);
  const inspectionOk = portState?.inspectionOk !== false;
  const processInfo = portState?.processInfo || null;

  if (!inspectionOk) {
    return {
      action: ACTION.FAIL,
      classification: PROCESS_CLASS.UNKNOWN,
      message: service === SERVICE.COMFY
        ? "ComfyUI port inspection failed"
        : "Director port inspection failed",
      processInfo
    };
  }

  if (healthy) {
    return {
      action: ACTION.REUSE,
      classification: PROCESS_CLASS.HEALTHY,
      message: service === SERVICE.COMFY
        ? "ComfyUI already healthy"
        : "Director already healthy"
    };
  }

  if (listening) {
    return {
      action: ACTION.FAIL,
      classification: PROCESS_CLASS.UNKNOWN,
      message: service === SERVICE.COMFY
        ? "Port occupied by unexpected process (not healthy ComfyUI)"
        : "Port occupied by unexpected process (not healthy Director)",
      processInfo
    };
  }

  return {
    action: ACTION.START,
    classification: PROCESS_CLASS.ABSENT,
    message: service === SERVICE.COMFY
      ? "ComfyUI not listening; start required"
      : "Director not listening; start required"
  };
}

export function shouldOpenBrowser({
  openBrowser = true,
  comfyHealthy = false,
  directorHealthy = false
} = {}) {
  return Boolean(openBrowser && comfyHealthy && directorHealthy);
}

/** Normalize launcher browser targets (Director first, then ComfyUI). */
export function buildLauncherBrowserUrls(directorBaseUrl, comfyBaseUrl) {
  const directorUrl = `${String(directorBaseUrl || "").replace(/\/$/, "")}/`;
  const comfyUrl = `${String(comfyBaseUrl || "").replace(/\/$/, "")}/`;
  return { directorUrl, comfyUrl };
}

/** Presentation-only: open Director then ComfyUI in the default browser. */
export function openLauncherBrowserPages({
  directorBaseUrl,
  comfyBaseUrl,
  openBrowserFn
} = {}) {
  const urls = buildLauncherBrowserUrls(directorBaseUrl, comfyBaseUrl);
  openBrowserFn(urls.directorUrl);
  openBrowserFn(urls.comfyUrl);
  return urls;
}

export async function probeHttp(url, { fetchFn = fetch, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status, response };
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeComfyHealth(baseUrl, { fetchFn = fetch, timeoutMs = 5000 } = {}) {
  const result = await probeHttp(`${baseUrl.replace(/\/$/, "")}/system_stats`, { fetchFn, timeoutMs });
  if (!result.ok) return { healthy: false, ...result };
  try {
    const data = await result.response.json();
    const healthy = Boolean(data && typeof data === "object" && ("system" in data || "devices" in data));
    return { healthy, data, status: result.status };
  } catch (error) {
    return { healthy: false, status: result.status, error: error?.message || String(error) };
  }
}

export async function probeDirectorHealth(baseUrl, expectedVersion = "", { fetchFn = fetch, timeoutMs = 5000 } = {}) {
  const result = await probeHttp(`${baseUrl.replace(/\/$/, "")}/api/config`, { fetchFn, timeoutMs });
  if (!result.ok) return { healthy: false, ...result };
  try {
    const data = await result.response.json();
    const healthy = Boolean(
      data
      && typeof data === "object"
      && typeof data.version === "string"
      && Array.isArray(data.presets)
      && (!expectedVersion || data.version === expectedVersion)
    );
    return { healthy, data, version: data?.version, status: result.status };
  } catch (error) {
    return { healthy: false, status: result.status, error: error?.message || String(error) };
  }
}

export async function waitForHealth(probeFn, {
  timeoutMs = 30000,
  intervalMs = 500,
  sleepFn = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await probeFn();
    if (last?.healthy) return { healthy: true, attempts: last, elapsedMs: Date.now() - started };
    await sleepFn(intervalMs);
  }
  return { healthy: false, attempts: last, elapsedMs: Date.now() - started };
}

export function formatOccupiedPortError(service, port, processInfo = {}) {
  const lines = [
    `${service === SERVICE.COMFY ? "ComfyUI" : "Director"} port ${port} is occupied by an unexpected process.`,
    "Fail closed: the launcher will not kill or replace it."
  ];
  if (processInfo.pid) lines.push(`PID: ${processInfo.pid}`);
  if (processInfo.executable) lines.push(`Executable: ${processInfo.executable}`);
  if (processInfo.commandLine) lines.push(`Command line: ${processInfo.commandLine}`);
  lines.push("Stop the occupying process manually or change the configured port.");
  return lines.join("\n");
}

export function planStartup({
  comfy = {},
  director = {},
  openBrowser = true
} = {}) {
  const steps = [];
  const comfyDecision = decideServiceAction({
    portState: {
      listening: Boolean(comfy.listening),
      inspectionOk: comfy.inspectionOk !== false,
      processInfo: comfy.processInfo || null
    },
    healthy: comfy.healthy,
    service: SERVICE.COMFY
  });
  steps.push({ service: SERVICE.COMFY, ...comfyDecision });

  if (comfyDecision.action === ACTION.FAIL) {
    return {
      ok: false,
      steps,
      openBrowser: false,
      error: comfyDecision.message
    };
  }

  const directorDecision = decideServiceAction({
    portState: {
      listening: Boolean(director.listening),
      inspectionOk: director.inspectionOk !== false,
      processInfo: director.processInfo || null
    },
    healthy: director.healthy,
    service: SERVICE.DIRECTOR
  });
  steps.push({ service: SERVICE.DIRECTOR, ...directorDecision });

  if (directorDecision.action === ACTION.FAIL) {
    return {
      ok: false,
      steps,
      openBrowser: false,
      error: directorDecision.message
    };
  }

  const comfyHealthy = comfyDecision.action === ACTION.REUSE || comfy.awaitStart;
  const directorHealthy = directorDecision.action === ACTION.REUSE || director.awaitStart;
  return {
    ok: true,
    steps,
    openBrowser: shouldOpenBrowser({
      openBrowser,
      comfyHealthy: comfy.healthy || comfyDecision.action === ACTION.REUSE,
      directorHealthy: director.healthy || directorDecision.action === ACTION.REUSE
    }),
    comfySpawn: comfyDecision.action === ACTION.START,
    directorSpawn: directorDecision.action === ACTION.START,
    comfyReuse: comfyDecision.action === ACTION.REUSE,
    directorReuse: directorDecision.action === ACTION.REUSE
  };
}

export function resolveHarnessRootFromScript(scriptDir = "") {
  return path.resolve(scriptDir, "..", "..");
}

export function stripUtf8Bom(text = "") {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

export async function readLauncherConfigFile(configPath) {
  const text = stripUtf8Bom(await readFile(configPath, "utf8"));
  return JSON.parse(text);
}

export function resolveConfigPath(explicitPath = "", env = process.env) {
  if (explicitPath && String(explicitPath).trim()) return path.resolve(String(explicitPath).trim());
  const localAppData = env.LOCALAPPDATA || "";
  if (!localAppData) return "";
  return path.join(localAppData, "AI Video Director", "launcher.json");
}

export function buildLauncherConfigPayload({
  comfyRoot,
  openBrowser = true,
  comfyTimeoutSeconds = 180,
  directorTimeoutSeconds = 30
} = {}) {
  return {
    comfyRoot: path.resolve(String(comfyRoot || "").trim()),
    openBrowser: Boolean(openBrowser),
    comfyTimeoutSeconds,
    directorTimeoutSeconds
  };
}

export function assertLauncherSourceSafe(sourceText = "") {
  const forbidden = [
    { pattern: /POST\s+['"`].*\/api\/queue/i, label: "/api/queue POST" },
    { pattern: /\bfetch\s*\([^)]*\/prompt\b/i, label: "ComfyUI /prompt fetch" },
    { pattern: /method\s*:\s*['"`]POST['"`][^)]*\/prompt\b/i, label: "ComfyUI /prompt POST" },
    { pattern: /fetch\s*\([^)]*method\s*:\s*['"`]POST['"`][^)]*\/api\/projects/i, label: "project write POST" },
    { pattern: /method\s*:\s*['"`]PUT['"`][^)]*\/api\/projects/i, label: "project write PUT" }
  ];
  const hits = forbidden.filter(item => item.pattern.test(sourceText)).map(item => item.label);
  return { safe: hits.length === 0, hits };
}

export function getModuleDir(metaUrl = import.meta.url) {
  return path.dirname(fileURLToPath(metaUrl));
}
