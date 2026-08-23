import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Normalize raw port inspection output into a stable shape.
 */
export function normalizePortInspection(raw = {}) {
  const listening = Boolean(raw.listening);
  const inspectionOk = raw.inspectionOk !== false;
  const processInfo = raw.processInfo && (raw.processInfo.pid || listening)
    ? {
      pid: raw.processInfo.pid ?? null,
      executable: raw.processInfo.executable || null,
      commandLine: raw.processInfo.commandLine || null
    }
    : null;
  return {
    listening,
    inspectionOk,
    processInfo,
    diagnostic: raw.diagnostic ? String(raw.diagnostic) : ""
  };
}

/**
 * Parse fixture/query output for a specific port.
 */
export function parsePortQueryRows(port, { connections = [], processes = {}, inspectionOk = true, diagnostic = "" } = {}) {
  if (!inspectionOk) {
    return normalizePortInspection({
      listening: false,
      inspectionOk: false,
      processInfo: null,
      diagnostic: diagnostic || "Port inspection failed"
    });
  }
  const listener = connections.find(
    row => Number(row.LocalPort) === Number(port) && String(row.State).toLowerCase() === "listen"
  );
  if (!listener) {
    return normalizePortInspection({ listening: false, inspectionOk: true, processInfo: null });
  }
  const pid = listener.OwningProcess ?? listener.pid ?? null;
  const proc = pid != null ? processes[pid] || processes[String(pid)] || {} : {};
  return normalizePortInspection({
    listening: true,
    inspectionOk: true,
    processInfo: {
      pid,
      executable: proc.ExecutablePath || proc.executable || null,
      commandLine: proc.CommandLine || proc.commandLine || null
    }
  });
}

/**
 * Query Windows for the process listening on a TCP port.
 * Injectable via deps.queryPortState for tests.
 */
export async function queryPortStateWindows(port, deps = {}) {
  const execFileFn = deps.execFileFn || execFileAsync;
  const shell = deps.powershellExecutable || "powershell.exe";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$port = ${Number(port)}`,
    "$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (-not $conn) {",
    "  @{ listening = $false; inspectionOk = $true; processInfo = $null } | ConvertTo-Json -Compress",
    "  exit 0",
    "}",
    "$proc = Get-CimInstance Win32_Process -Filter (\"ProcessId=\" + $conn.OwningProcess) -ErrorAction SilentlyContinue",
    "$out = @{",
    "  listening = $true",
    "  inspectionOk = $true",
    "  processInfo = @{",
    "    pid = [int]$conn.OwningProcess",
    "    executable = $proc.ExecutablePath",
    "    commandLine = $proc.CommandLine",
    "  }",
    "}",
    "$out | ConvertTo-Json -Compress"
  ].join("; ");

  const { stdout } = await execFileFn(shell, ["-NoProfile", "-Command", script], { windowsHide: true });
  const text = String(stdout || "").trim();
  if (!text) {
    throw new Error("Port inspection returned empty output");
  }
  return JSON.parse(text);
}

/**
 * Inspect whether a local TCP port is listening and identify the owning process.
 */
export async function inspectPort(port, deps = {}) {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") {
    return normalizePortInspection({
      listening: false,
      inspectionOk: false,
      processInfo: null,
      diagnostic: `Port inspection is supported on Windows only (platform=${platform})`
    });
  }

  const query = deps.queryPortState || queryPortStateWindows;
  try {
    const raw = await query(port, deps);
    return normalizePortInspection(raw);
  } catch (error) {
    return normalizePortInspection({
      listening: false,
      inspectionOk: false,
      processInfo: null,
      diagnostic: error?.message || String(error)
    });
  }
}
