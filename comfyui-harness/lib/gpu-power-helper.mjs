/**
 * Optional Windows Scheduled Task helper for GPU power modes (v0.7.5).
 *
 * Security model:
 * - The harness process stays NON-ELEVATED. It never elevates, never shows UAC,
 *   never runs an installer, and never stores credentials.
 * - Three fixed, immutable Scheduled Tasks (installed once, manually, by an
 *   Administrator via scripts/install_gpu_power_tasks.ps1) carry the privilege.
 *   Each task's action is a DIRECT nvidia-smi.exe call with fixed arguments.
 * - Before running a task, its definition is exported via `schtasks /Query /XML`
 *   and strictly validated (command basename, exact argv, RunLevel, LogonType,
 *   no triggers, single Exec action). Anything unexpected fails closed.
 * - The browser only ever sends { "mode": "eco"|"balanced"|"normal" }. Task
 *   names, wattages, executables and argv are fixed server-side constants.
 * - `schtasks /Run` success only means "launch accepted"; the real GPU limit is
 *   verified by polling nvidia-smi read-back for a short bounded period.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  GpuPowerError,
  MODE_TOLERANCE_W,
  readGpuPowerStatus,
  resolvePowerMode,
  setGpuPowerMode
} from "./gpu-power.mjs";

const execFileAsync = promisify(execFile);

export const HELPER_TYPE = "windows-scheduled-tasks";
export const HELPER_EXEC_TIMEOUT_MS = 5000;
export const VERIFY_POLL_INTERVAL_MS = 400;
export const VERIFY_TIMEOUT_MS = 5000;

export const HELPER_TASK_FOLDER = "\\AI Video Director\\GPU Power";

/** Fixed, immutable mode -> Scheduled Task mapping. Browser never supplies these. */
export const HELPER_TASKS = Object.freeze({
  eco: Object.freeze({ mode: "eco", taskName: `${HELPER_TASK_FOLDER}\\ECO`, watts: 100 }),
  balanced: Object.freeze({ mode: "balanced", taskName: `${HELPER_TASK_FOLDER}\\BALANCED`, watts: 130 }),
  normal: Object.freeze({ mode: "normal", taskName: `${HELPER_TASK_FOLDER}\\NORMAL`, watts: 170 })
});

export const HELPER_TASK_MODE_IDS = Object.freeze(Object.keys(HELPER_TASKS));

export const HELPER_STATES = Object.freeze({
  READY: "ready",
  NOT_INSTALLED: "not-installed",
  PARTIAL: "partial",
  INVALID: "invalid",
  UNSUPPORTED: "unsupported"
});

export function schtasksExecutable() {
  return "schtasks.exe";
}

export function resolveHelperTask(mode) {
  const resolved = resolvePowerMode(mode);
  const task = HELPER_TASKS[resolved.id];
  if (!task) {
    throw new GpuPowerError("No helper task for mode.", { code: "invalid-mode", status: 400 });
  }
  return task;
}

export function expectedTaskArguments(watts) {
  return `-i 0 -pl ${watts}`;
}

function extractTag(xml, tag) {
  const matches = [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi"))];
  return matches.map(m => m[1]);
}

const TRIGGER_TAGS = Object.freeze([
  "BootTrigger",
  "LogonTrigger",
  "TimeTrigger",
  "CalendarTrigger",
  "EventTrigger",
  "RegistrationTrigger",
  "IdleTrigger",
  "SessionStateChangeTrigger"
]);

/**
 * Strictly validate one exported task XML definition against the fixed
 * expectation for `modeId`. Returns { valid: boolean, reason: string|null }.
 * Any ambiguity or unexpected shape is treated as invalid (fail closed).
 */
export function validateTaskXml(xml, modeId) {
  const task = HELPER_TASKS[modeId];
  if (!task) return { valid: false, reason: "unknown-mode" };
  const text = String(xml || "").replace(/^\uFEFF/, "").trim();
  if (!text || !/<Task[\s>]/i.test(text)) return { valid: false, reason: "malformed-xml" };

  const actionsBlocks = extractTag(text, "Actions");
  if (actionsBlocks.length !== 1) return { valid: false, reason: "actions-shape" };
  const execBlocks = extractTag(actionsBlocks[0], "Exec");
  if (execBlocks.length !== 1) return { valid: false, reason: "exec-count" };
  if (/<ComHandler|<SendEmail|<ShowMessage/i.test(actionsBlocks[0])) {
    return { valid: false, reason: "non-exec-action" };
  }

  const commands = extractTag(execBlocks[0], "Command");
  if (commands.length !== 1) return { valid: false, reason: "command-count" };
  const command = commands[0].trim().replace(/^"(.*)"$/, "$1").trim();
  if (!command || command.includes("%")) return { valid: false, reason: "command-indirect" };
  const basename = command.split(/[\\/]/).pop().toLowerCase();
  if (basename !== "nvidia-smi.exe") return { valid: false, reason: "command-not-nvidia-smi" };

  const argumentBlocks = extractTag(execBlocks[0], "Arguments");
  if (argumentBlocks.length !== 1) return { valid: false, reason: "arguments-count" };
  const args = argumentBlocks[0].trim().replace(/\s+/g, " ");
  if (args !== expectedTaskArguments(task.watts)) return { valid: false, reason: "arguments-mismatch" };

  const runLevels = extractTag(text, "RunLevel");
  if (runLevels.length !== 1 || runLevels[0].trim() !== "HighestAvailable") {
    return { valid: false, reason: "runlevel" };
  }

  const logonTypes = extractTag(text, "LogonType");
  if (logonTypes.length !== 1 || logonTypes[0].trim() !== "InteractiveToken") {
    return { valid: false, reason: "logon-type" };
  }

  const triggerBlocks = extractTag(text, "Triggers");
  const triggerContent = triggerBlocks.join("");
  for (const trigger of TRIGGER_TAGS) {
    if (new RegExp(`<${trigger}[\\s/>]`, "i").test(triggerContent)) {
      return { valid: false, reason: "unexpected-trigger" };
    }
  }

  return { valid: true, reason: null };
}

function isMissingTaskError(error) {
  const blob = `${error?.stderr || ""}\n${error?.stdout || ""}\n${error?.message || ""}`.toLowerCase();
  return (
    blob.includes("cannot find the file") ||
    blob.includes("does not exist") ||
    blob.includes("impossibile trovare il file") ||
    blob.includes("non esiste")
  );
}

async function queryTaskXml(taskName, { execFileImpl }) {
  try {
    const { stdout } = await execFileImpl(
      schtasksExecutable(),
      ["/Query", "/TN", taskName, "/XML"],
      { timeout: HELPER_EXEC_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    return { found: true, xml: String(stdout || "") };
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new GpuPowerError("schtasks.exe is not available.", {
        code: "gpu-helper-unsupported",
        status: 409
      });
    }
    if (isMissingTaskError(error)) return { found: false, xml: null };
    // Unknown query failure: fail closed as missing rather than guessing.
    return { found: false, xml: null };
  }
}

/**
 * Inspect the three fixed tasks and classify the helper state.
 * Never runs anything; read-only `schtasks /Query`.
 */
export async function readGpuHelperState({
  execFileImpl = execFileAsync,
  platform = process.platform
} = {}) {
  if (platform !== "win32") {
    return { type: HELPER_TYPE, state: HELPER_STATES.UNSUPPORTED, tasks: null };
  }
  const tasks = {};
  let missing = 0;
  let invalid = 0;
  try {
    for (const modeId of HELPER_TASK_MODE_IDS) {
      const { taskName } = HELPER_TASKS[modeId];
      const result = await queryTaskXml(taskName, { execFileImpl });
      if (!result.found) {
        tasks[modeId] = "missing";
        missing += 1;
        continue;
      }
      const check = validateTaskXml(result.xml, modeId);
      tasks[modeId] = check.valid ? "valid" : `invalid:${check.reason}`;
      if (!check.valid) invalid += 1;
    }
  } catch (error) {
    if (error instanceof GpuPowerError && error.code === "gpu-helper-unsupported") {
      return { type: HELPER_TYPE, state: HELPER_STATES.UNSUPPORTED, tasks: null };
    }
    throw error;
  }
  let state;
  if (invalid > 0) state = HELPER_STATES.INVALID;
  else if (missing === HELPER_TASK_MODE_IDS.length) state = HELPER_STATES.NOT_INSTALLED;
  else if (missing > 0) state = HELPER_STATES.PARTIAL;
  else state = HELPER_STATES.READY;
  return { type: HELPER_TYPE, state, tasks };
}

/** Safe, minimal payload for the browser. No paths, users, or system details. */
export function gpuHelperPublicPayload(helper) {
  const state = helper?.state || HELPER_STATES.UNSUPPORTED;
  return {
    type: HELPER_TYPE,
    available: state === HELPER_STATES.READY,
    state
  };
}

function helperNotReadyError(state) {
  if (state === HELPER_STATES.NOT_INSTALLED) {
    return new GpuPowerError(
      "GPU helper tasks are not installed. Run scripts/install_gpu_power_tasks.ps1 once as Administrator.",
      { code: "gpu-helper-not-installed", status: 409 }
    );
  }
  if (state === HELPER_STATES.PARTIAL) {
    return new GpuPowerError(
      "GPU helper task installation is incomplete. Re-run the installer as Administrator.",
      { code: "gpu-helper-partial", status: 409 }
    );
  }
  if (state === HELPER_STATES.UNSUPPORTED) {
    return new GpuPowerError("GPU helper is not supported on this system.", {
      code: "gpu-helper-unsupported",
      status: 409
    });
  }
  return new GpuPowerError("GPU helper task definition is invalid. Nothing was executed.", {
    code: "gpu-helper-invalid",
    status: 409
  });
}

async function runHelperTaskOnce(taskName, { execFileImpl }) {
  try {
    await execFileImpl(schtasksExecutable(), ["/Run", "/TN", taskName], {
      timeout: HELPER_EXEC_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.stdout || error?.message || "schtasks /Run failed").trim();
    throw new GpuPowerError(`Helper task launch failed: ${detail.slice(0, 300)}`, {
      code: "helper-run-failed",
      status: 502
    });
  }
}

/**
 * Set the GPU power mode through the pre-installed Scheduled Task helper.
 * Exactly one `schtasks /Run` per call; the actual limit change is confirmed
 * only by nvidia-smi read-back within a bounded polling window.
 */
export async function setGpuPowerModeViaHelper(mode, {
  execFileImpl = execFileAsync,
  readStatusImpl = readGpuPowerStatus,
  sleepImpl = delay,
  pollIntervalMs = VERIFY_POLL_INTERVAL_MS,
  verifyTimeoutMs = VERIFY_TIMEOUT_MS,
  platform = process.platform,
  nowImpl = Date.now
} = {}) {
  const task = resolveHelperTask(mode);
  const helper = await readGpuHelperState({ execFileImpl, platform });
  if (helper.state !== HELPER_STATES.READY) {
    throw helperNotReadyError(helper.state);
  }

  await runHelperTaskOnce(task.taskName, { execFileImpl });

  const deadline = nowImpl() + verifyTimeoutMs;
  let lastStatus = null;
  for (;;) {
    lastStatus = await readStatusImpl({ execFileImpl });
    if (
      lastStatus?.available &&
      Number.isFinite(lastStatus.currentLimitW) &&
      Math.abs(lastStatus.currentLimitW - task.watts) <= MODE_TOLERANCE_W
    ) {
      return {
        ok: true,
        requested: { ...resolvePowerMode(mode) },
        status: lastStatus,
        helper: gpuHelperPublicPayload(helper)
      };
    }
    if (nowImpl() >= deadline) break;
    await sleepImpl(pollIntervalMs);
  }

  throw new GpuPowerError(
    `Helper task started but the GPU limit did not reach ${task.watts} W within ${verifyTimeoutMs} ms (observed ${lastStatus?.currentLimitW ?? "n/a"}).`,
    { code: "helper-verify-timeout", status: 504 }
  );
}

/**
 * Platform dispatch used by the HTTP API:
 * - Windows: only the verified Scheduled Task helper. Never the direct setter,
 *   never elevation, never UAC. Fails closed with 409 when the helper is not ready.
 * - Non-Windows: the existing direct nvidia-smi setter (unchanged v0.7.4 path).
 */
export async function applyGpuPowerMode(mode, {
  platform = process.platform,
  execFileImpl,
  readStatusImpl,
  sleepImpl,
  pollIntervalMs,
  verifyTimeoutMs,
  nowImpl
} = {}) {
  if (platform === "win32") {
    return setGpuPowerModeViaHelper(mode, {
      ...(execFileImpl ? { execFileImpl } : {}),
      ...(readStatusImpl ? { readStatusImpl } : {}),
      ...(sleepImpl ? { sleepImpl } : {}),
      ...(pollIntervalMs ? { pollIntervalMs } : {}),
      ...(verifyTimeoutMs ? { verifyTimeoutMs } : {}),
      ...(nowImpl ? { nowImpl } : {}),
      platform
    });
  }
  return setGpuPowerMode(mode, execFileImpl ? { execFileImpl } : {});
}
