/**
 * Safe GPU power-limit control via nvidia-smi (read + strict mode allowlist).
 * Browser never supplies executable, GPU index, wattage, or argv.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const GPU_INDEX = 0;
export const EXEC_TIMEOUT_MS = 5000;
export const MODE_TOLERANCE_W = 0.5;

export const GPU_POWER_MODES = Object.freeze({
  eco: Object.freeze({ id: "eco", label: "ECO", watts: 100 }),
  balanced: Object.freeze({ id: "balanced", label: "BALANCED", watts: 130 }),
  normal: Object.freeze({ id: "normal", label: "NORMAL", watts: 170 })
});

export const ALLOWED_MODE_IDS = Object.freeze(Object.keys(GPU_POWER_MODES));

const QUERY_ARGS = Object.freeze([
  "--query-gpu=index,name,power.draw,power.limit,power.default_limit,power.min_limit,power.max_limit",
  "--format=csv,noheader,nounits"
]);

export class GpuPowerError extends Error {
  constructor(message, { code = "gpu-power-error", status = 500 } = {}) {
    super(message);
    this.name = "GpuPowerError";
    this.code = code;
    this.status = status;
  }
}

export function nvidiaSmiExecutable(platform = process.platform) {
  return platform === "win32" ? "nvidia-smi.exe" : "nvidia-smi";
}

export function listGpuPowerModes() {
  return ALLOWED_MODE_IDS.map(id => ({ ...GPU_POWER_MODES[id] }));
}

export function resolvePowerMode(mode) {
  if (typeof mode !== "string" || !Object.prototype.hasOwnProperty.call(GPU_POWER_MODES, mode)) {
    throw new GpuPowerError("Invalid GPU power mode.", { code: "invalid-mode", status: 400 });
  }
  return GPU_POWER_MODES[mode];
}

export function buildPowerLimitArgs(watts) {
  const n = Number(watts);
  if (!Number.isFinite(n) || n <= 0) {
    throw new GpuPowerError("Invalid power limit watts.", { code: "invalid-watts", status: 400 });
  }
  return ["-i", String(GPU_INDEX), "-pl", String(Math.round(n))];
}

export function classifyMode(currentLimitW, tolerance = MODE_TOLERANCE_W) {
  const limit = Number(currentLimitW);
  if (!Number.isFinite(limit)) return "custom";
  for (const id of ALLOWED_MODE_IDS) {
    if (Math.abs(limit - GPU_POWER_MODES[id].watts) <= tolerance) return id;
  }
  return "custom";
}

function parseNumericField(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text || /^\[?\s*n\/?a\s*\]?$/i.test(text) || /^not\s+supported$/i.test(text)) return null;
  const cleaned = text.replace(/[^\d.+-eE]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse one CSV row from the preferred nvidia-smi query.
 * Fields: index, name, power.draw, power.limit, power.default_limit, power.min_limit, power.max_limit
 */
export function parseGpuQueryCsv(line) {
  const text = String(line || "").trim();
  if (!text) throw new GpuPowerError("Empty nvidia-smi query output.", { code: "parse-error", status: 502 });
  const parts = text.split(",").map(p => p.trim());
  if (parts.length < 7) {
    throw new GpuPowerError("Unexpected nvidia-smi CSV shape.", { code: "parse-error", status: 502 });
  }
  const [indexRaw, name, drawRaw, limitRaw, defaultRaw, minRaw, maxRaw] = parts;
  const gpuIndex = Number(indexRaw);
  return {
    gpuIndex: Number.isFinite(gpuIndex) ? gpuIndex : GPU_INDEX,
    name: name || "GPU",
    drawW: parseNumericField(drawRaw),
    currentLimitW: parseNumericField(limitRaw),
    defaultLimitW: parseNumericField(defaultRaw),
    minLimitW: parseNumericField(minRaw),
    maxLimitW: parseNumericField(maxRaw)
  };
}

export function isPermissionDeniedMessage(stderr = "", stdout = "") {
  const blob = `${stderr}\n${stdout}`.toLowerCase();
  return (
    blob.includes("insufficient permissions") ||
    blob.includes("access denied") ||
    blob.includes("permission denied") ||
    blob.includes("not authorized") ||
    blob.includes("requires elevation") ||
    blob.includes("administrator")
  );
}

async function runNvidiaSmi(args, { execFileImpl = execFileAsync, timeout = EXEC_TIMEOUT_MS } = {}) {
  const executable = nvidiaSmiExecutable();
  try {
    return await execFileImpl(executable, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    const stderr = String(error?.stderr || "");
    const stdout = String(error?.stdout || "");
    if (error?.code === "ENOENT") {
      throw new GpuPowerError("nvidia-smi is not available.", { code: "unavailable", status: 503 });
    }
    if (isPermissionDeniedMessage(stderr, stdout)) {
      throw new GpuPowerError("GPU power limit requires elevated privileges.", {
        code: "permission-denied",
        status: 403
      });
    }
    if (error?.killed || error?.signal === "SIGTERM") {
      throw new GpuPowerError("nvidia-smi timed out.", { code: "timeout", status: 504 });
    }
    const detail = (stderr || stdout || error?.message || "nvidia-smi failed").trim();
    throw new GpuPowerError(detail.slice(0, 400), { code: "nvidia-smi-failed", status: 502 });
  }
}

function unavailableStatus(extra = {}) {
  return {
    available: false,
    gpuIndex: GPU_INDEX,
    name: null,
    drawW: null,
    currentLimitW: null,
    defaultLimitW: null,
    minLimitW: null,
    maxLimitW: null,
    mode: null,
    ...extra
  };
}

export async function readGpuPowerStatus({ execFileImpl = execFileAsync } = {}) {
  try {
    const { stdout } = await runNvidiaSmi([...QUERY_ARGS], { execFileImpl });
    const firstLine = String(stdout || "")
      .split(/\r?\n/)
      .map(l => l.trim())
      .find(Boolean);
    const parsed = parseGpuQueryCsv(firstLine);
    return {
      available: true,
      gpuIndex: parsed.gpuIndex,
      name: parsed.name,
      drawW: parsed.drawW,
      currentLimitW: parsed.currentLimitW,
      defaultLimitW: parsed.defaultLimitW,
      minLimitW: parsed.minLimitW,
      maxLimitW: parsed.maxLimitW,
      mode: classifyMode(parsed.currentLimitW)
    };
  } catch (error) {
    if (error instanceof GpuPowerError && error.code === "unavailable") {
      return unavailableStatus({ reason: error.code });
    }
    if (error instanceof GpuPowerError) {
      return unavailableStatus({ reason: error.code, error: error.message });
    }
    return unavailableStatus({ reason: "read-failed", error: String(error?.message || error) });
  }
}

export async function setGpuPowerMode(mode, { execFileImpl = execFileAsync } = {}) {
  const resolved = resolvePowerMode(mode);
  const args = buildPowerLimitArgs(resolved.watts);
  await runNvidiaSmi(args, { execFileImpl });
  const status = await readGpuPowerStatus({ execFileImpl });
  if (!status.available) {
    throw new GpuPowerError("Power limit command ran but GPU status is unavailable.", {
      code: "verify-unavailable",
      status: 502
    });
  }
  if (
    !Number.isFinite(status.currentLimitW) ||
    Math.abs(status.currentLimitW - resolved.watts) > MODE_TOLERANCE_W
  ) {
    throw new GpuPowerError(
      `Power limit did not apply (expected ${resolved.watts} W, observed ${status.currentLimitW}).`,
      { code: "verify-mismatch", status: 502 }
    );
  }
  return {
    ok: true,
    requested: { ...resolved },
    status
  };
}

export function gpuPowerPublicPayload(status) {
  return {
    ...status,
    modes: listGpuPowerModes()
  };
}
