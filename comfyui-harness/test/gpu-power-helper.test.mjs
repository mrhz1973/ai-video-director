import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GpuPowerError, readGpuPowerStatus } from "../lib/gpu-power.mjs";
import {
  HELPER_STATES,
  HELPER_TASKS,
  HELPER_TASK_MODE_IDS,
  HELPER_TYPE,
  applyGpuPowerMode,
  expectedTaskArguments,
  gpuHelperPublicPayload,
  readGpuHelperState,
  resolveHelperTask,
  schtasksExecutable,
  setGpuPowerModeViaHelper,
  validateTaskXml
} from "../lib/gpu-power-helper.mjs";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(harnessRoot, "..");

const NVSMI = "C:\\Windows\\System32\\nvidia-smi.exe";

function taskXml({
  command = NVSMI,
  args = "-i 0 -pl 100",
  runLevel = "HighestAvailable",
  logonType = "InteractiveToken",
  triggers = "",
  actions = null
} = {}) {
  const actionsXml = actions ?? `<Exec>
      <Command>${command}</Command>
      <Arguments>${args}</Arguments>
    </Exec>`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Author>installer</Author></RegistrationInfo>
  <Triggers>${triggers}</Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-21-0-0-0-1001</UserId>
      <LogonType>${logonType}</LogonType>
      <RunLevel>${runLevel}</RunLevel>
    </Principal>
  </Principals>
  <Settings><Enabled>true</Enabled></Settings>
  <Actions Context="Author">
    ${actionsXml}
  </Actions>
</Task>`;
}

function validXmlFor(modeId) {
  return taskXml({ args: expectedTaskArguments(HELPER_TASKS[modeId].watts) });
}

/**
 * Build an execFile mock that serves schtasks /Query, schtasks /Run and
 * nvidia-smi reads. Records every call. Never touches the real system.
 */
function makeExecMock({
  installed = { eco: true, balanced: true, normal: true },
  xmlOverrides = {},
  runError = null,
  limitW = 170,
  limitAfterRun = null,
  schtasksMissing = false
} = {}) {
  const calls = [];
  let ranTask = false;
  const impl = async (exe, args) => {
    calls.push({ exe, args: [...args] });
    if (/schtasks/i.test(exe)) {
      if (schtasksMissing) {
        const err = new Error("not found");
        err.code = "ENOENT";
        throw err;
      }
      if (args[0] === "/Query") {
        const name = args[2];
        const modeId = HELPER_TASK_MODE_IDS.find(id => HELPER_TASKS[id].taskName === name);
        if (!modeId || !installed[modeId]) {
          const err = new Error("query failed");
          err.stderr = "ERROR: The system cannot find the file specified.";
          err.code = 1;
          throw err;
        }
        return { stdout: xmlOverrides[modeId] ?? validXmlFor(modeId), stderr: "" };
      }
      if (args[0] === "/Run") {
        if (runError) throw runError;
        ranTask = true;
        return { stdout: "SUCCESS: Attempted to run the scheduled task.", stderr: "" };
      }
      throw new Error(`unexpected schtasks args: ${args.join(" ")}`);
    }
    if (/nvidia-smi/i.test(exe)) {
      const current = ranTask && limitAfterRun != null ? limitAfterRun : limitW;
      return {
        stdout: `0, NVIDIA GeForce RTX 3060, 21.5, ${current}.00, 170.00, 100.00, 187.00\n`,
        stderr: ""
      };
    }
    throw new Error(`unexpected executable: ${exe}`);
  };
  impl.calls = calls;
  impl.runCalls = () => calls.filter(c => /schtasks/i.test(c.exe) && c.args[0] === "/Run");
  impl.pl = () => calls.filter(c => /nvidia-smi/i.test(c.exe) && c.args.includes("-pl"));
  return impl;
}

// ---------------------------------------------------------------- A / B

test("A: exactly the three fixed internal task names", () => {
  assert.deepEqual([...HELPER_TASK_MODE_IDS], ["eco", "balanced", "normal"]);
  assert.equal(HELPER_TASKS.eco.taskName, "\\AI Video Director\\GPU Power\\ECO");
  assert.equal(HELPER_TASKS.balanced.taskName, "\\AI Video Director\\GPU Power\\BALANCED");
  assert.equal(HELPER_TASKS.normal.taskName, "\\AI Video Director\\GPU Power\\NORMAL");
  assert.ok(Object.isFrozen(HELPER_TASKS));
  assert.ok(Object.isFrozen(HELPER_TASKS.eco));
});

test("B: mode-to-task mapping is fixed", () => {
  assert.equal(resolveHelperTask("eco").taskName, HELPER_TASKS.eco.taskName);
  assert.equal(resolveHelperTask("eco").watts, 100);
  assert.equal(resolveHelperTask("balanced").taskName, HELPER_TASKS.balanced.taskName);
  assert.equal(resolveHelperTask("balanced").watts, 130);
  assert.equal(resolveHelperTask("normal").taskName, HELPER_TASKS.normal.taskName);
  assert.equal(resolveHelperTask("normal").watts, 170);
});

// ---------------------------------------------------------------- C / D

test("C: browser-supplied task name is rejected before any execFile", async () => {
  const impl = makeExecMock();
  await assert.rejects(
    () => setGpuPowerModeViaHelper("\\Microsoft\\Windows\\Evil", { execFileImpl: impl, platform: "win32" }),
    err => err instanceof GpuPowerError && err.code === "invalid-mode" && err.status === 400
  );
  assert.equal(impl.calls.length, 0);
});

test("D: browser-supplied watts are rejected before any execFile", async () => {
  const impl = makeExecMock();
  for (const bad of ["187", "100", 100, { mode: "eco", watts: 187 }, null]) {
    await assert.rejects(
      () => setGpuPowerModeViaHelper(bad, { execFileImpl: impl, platform: "win32" }),
      err => err instanceof GpuPowerError && err.status === 400
    );
  }
  assert.equal(impl.calls.length, 0);
});

// ---------------------------------------------------------------- E / F

test("E: schtasks /Run argv is exact and fixed", async () => {
  const impl = makeExecMock({ limitAfterRun: 100 });
  await setGpuPowerModeViaHelper("eco", { execFileImpl: impl, platform: "win32", sleepImpl: async () => {} });
  const runs = impl.runCalls();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].exe, "schtasks.exe");
  assert.deepEqual(runs[0].args, ["/Run", "/TN", "\\AI Video Director\\GPU Power\\ECO"]);
  assert.equal(schtasksExecutable(), "schtasks.exe");
});

test("F: helper module has no shell usage", async () => {
  const source = await readFile(path.join(harnessRoot, "lib", "gpu-power-helper.mjs"), "utf8");
  assert.equal(/shell\s*:\s*true/.test(source), false);
  assert.equal(/\bexec\s*\(/.test(source), false);
  assert.equal(/\bspawn\s*\(/.test(source), false);
  assert.equal(/cmd\.exe/i.test(source), false);
  assert.match(source, /execFile/);
});

// ---------------------------------------------------------------- G–R: XML validation

test("G/H/I: valid ECO, BALANCED, NORMAL definitions accepted", () => {
  for (const modeId of HELPER_TASK_MODE_IDS) {
    const result = validateTaskXml(validXmlFor(modeId), modeId);
    assert.equal(result.valid, true, `${modeId}: ${result.reason}`);
  }
});

test("J: wrong action command rejected", () => {
  const xml = taskXml({ command: "C:\\Tools\\other-tool.exe" });
  assert.equal(validateTaskXml(xml, "eco").valid, false);
});

test("K: cmd.exe action rejected", () => {
  const xml = taskXml({ command: "C:\\Windows\\System32\\cmd.exe", args: "/c nvidia-smi -i 0 -pl 100" });
  assert.equal(validateTaskXml(xml, "eco").valid, false);
});

test("L: powershell.exe action rejected", () => {
  const xml = taskXml({ command: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" });
  assert.equal(validateTaskXml(xml, "eco").valid, false);
});

test("M: node.exe action rejected", () => {
  const xml = taskXml({ command: "C:\\Program Files\\nodejs\\node.exe" });
  assert.equal(validateTaskXml(xml, "eco").valid, false);
});

test("N: wrong wattage rejected", () => {
  const xml = taskXml({ args: "-i 0 -pl 187" });
  assert.equal(validateTaskXml(xml, "eco").valid, false);
  assert.equal(validateTaskXml(taskXml({ args: "-i 0 -pl 130" }), "eco").valid, false);
});

test("O: wrong GPU index rejected", () => {
  const xml = taskXml({ args: "-i 1 -pl 100" });
  assert.equal(validateTaskXml(xml, "eco").valid, false);
});

test("P: extra arguments rejected", () => {
  const xml = taskXml({ args: "-i 0 -pl 100 --force" });
  assert.equal(validateTaskXml(xml, "eco").valid, false);
  const multi = taskXml({
    actions: `<Exec><Command>${NVSMI}</Command><Arguments>-i 0 -pl 100</Arguments></Exec>
      <Exec><Command>${NVSMI}</Command><Arguments>-i 0 -pl 187</Arguments></Exec>`
  });
  assert.equal(validateTaskXml(multi, "eco").valid, false);
});

test("Q: mismatched task/action pairing rejected", () => {
  // A definition valid for BALANCED must not validate as the ECO task.
  assert.equal(validateTaskXml(validXmlFor("balanced"), "eco").valid, false);
  assert.equal(validateTaskXml(validXmlFor("eco"), "normal").valid, false);
});

test("R: RunLevel not Highest rejected", () => {
  const xml = taskXml({ runLevel: "LeastPrivilege" });
  assert.equal(validateTaskXml(xml, "eco").valid, false);
});

test("non-interactive LogonType rejected", () => {
  assert.equal(validateTaskXml(taskXml({ logonType: "Password" }), "eco").valid, false);
});

test("scheduled triggers rejected (on-demand only)", () => {
  const xml = taskXml({ triggers: "<TimeTrigger><Enabled>true</Enabled></TimeTrigger>" });
  assert.equal(validateTaskXml(xml, "eco").valid, false);
});

// ---------------------------------------------------------------- S / T / U / V

test("S: all tasks missing -> not-installed", async () => {
  const impl = makeExecMock({ installed: { eco: false, balanced: false, normal: false } });
  const helper = await readGpuHelperState({ execFileImpl: impl, platform: "win32" });
  assert.equal(helper.state, HELPER_STATES.NOT_INSTALLED);
  assert.equal(gpuHelperPublicPayload(helper).available, false);
});

test("T: one of three missing -> partial", async () => {
  const impl = makeExecMock({ installed: { eco: true, balanced: false, normal: true } });
  const helper = await readGpuHelperState({ execFileImpl: impl, platform: "win32" });
  assert.equal(helper.state, HELPER_STATES.PARTIAL);
});

test("U: malformed XML -> invalid, fail closed", async () => {
  const impl = makeExecMock({ xmlOverrides: { eco: "<not-a-task>" } });
  const helper = await readGpuHelperState({ execFileImpl: impl, platform: "win32" });
  assert.equal(helper.state, HELPER_STATES.INVALID);
  await assert.rejects(
    () => setGpuPowerModeViaHelper("eco", { execFileImpl: impl, platform: "win32" }),
    err => err instanceof GpuPowerError && err.code === "gpu-helper-invalid" && err.status === 409
  );
  assert.equal(impl.runCalls().length, 0);
});

test("V: non-Windows -> unsupported", async () => {
  const impl = makeExecMock();
  const helper = await readGpuHelperState({ execFileImpl: impl, platform: "linux" });
  assert.equal(helper.state, HELPER_STATES.UNSUPPORTED);
  assert.equal(impl.calls.length, 0);
  assert.deepEqual(gpuHelperPublicPayload(helper), {
    type: HELPER_TYPE,
    available: false,
    state: "unsupported"
  });
});

test("missing schtasks binary -> unsupported", async () => {
  const impl = makeExecMock({ schtasksMissing: true });
  const helper = await readGpuHelperState({ execFileImpl: impl, platform: "win32" });
  assert.equal(helper.state, HELPER_STATES.UNSUPPORTED);
});

// ---------------------------------------------------------------- W / X / Y / Z / AA

test("W: schtasks launch failure reported truthfully", async () => {
  const runError = new Error("launch refused");
  runError.stderr = "ERROR: Access is denied.";
  const impl = makeExecMock({ runError });
  await assert.rejects(
    () => setGpuPowerModeViaHelper("eco", { execFileImpl: impl, platform: "win32" }),
    err => err instanceof GpuPowerError && err.code === "helper-run-failed" && err.status === 502
  );
});

test("X/Y: one mode click -> exactly one /Run, verified by read-back", async () => {
  const impl = makeExecMock({ limitAfterRun: 130 });
  const result = await setGpuPowerModeViaHelper("balanced", {
    execFileImpl: impl,
    platform: "win32",
    sleepImpl: async () => {}
  });
  assert.equal(result.ok, true);
  assert.equal(result.requested.watts, 130);
  assert.equal(result.status.currentLimitW, 130);
  assert.equal(result.status.mode, "balanced");
  assert.equal(impl.runCalls().length, 1);
  assert.equal(impl.pl().length, 0, "no direct nvidia-smi -pl call");
});

test("Z: verification timeout returns helper-verify-timeout without a second /Run", async () => {
  const impl = makeExecMock({ limitAfterRun: 170 }); // limit never reaches 100
  let clock = 0;
  await assert.rejects(
    () => setGpuPowerModeViaHelper("eco", {
      execFileImpl: impl,
      platform: "win32",
      sleepImpl: async () => {},
      verifyTimeoutMs: 5000,
      nowImpl: () => { clock += 3000; return clock; }
    }),
    err => err instanceof GpuPowerError && err.code === "helper-verify-timeout"
  );
  assert.equal(impl.runCalls().length, 1);
  assert.equal(impl.pl().length, 0);
});

test("AA: current limit read-back stays nvidia-smi authority", async () => {
  const impl = makeExecMock({ limitAfterRun: 100 });
  const result = await setGpuPowerModeViaHelper("eco", {
    execFileImpl: impl,
    platform: "win32",
    readStatusImpl: opts => readGpuPowerStatus(opts),
    sleepImpl: async () => {}
  });
  const reads = impl.calls.filter(c => /nvidia-smi/i.test(c.exe));
  assert.ok(reads.length >= 1);
  assert.ok(reads.every(c => c.args.some(a => String(a).includes("query-gpu"))));
  assert.equal(result.status.currentLimitW, 100);
  assert.equal(result.status.name, "NVIDIA GeForce RTX 3060");
});

// ------------------------------------------------- fail-closed API dispatch

test("helper not installed -> 409 gpu-helper-not-installed, nothing executed", async () => {
  const impl = makeExecMock({ installed: { eco: false, balanced: false, normal: false } });
  await assert.rejects(
    () => applyGpuPowerMode("eco", { execFileImpl: impl, platform: "win32" }),
    err => err instanceof GpuPowerError && err.code === "gpu-helper-not-installed" && err.status === 409
  );
  assert.equal(impl.runCalls().length, 0);
  assert.equal(impl.pl().length, 0, "no direct nvidia-smi -pl fallback");
});

test("helper partial -> 409 fail closed", async () => {
  const impl = makeExecMock({ installed: { eco: true, balanced: true, normal: false } });
  await assert.rejects(
    () => applyGpuPowerMode("eco", { execFileImpl: impl, platform: "win32" }),
    err => err instanceof GpuPowerError && err.status === 409 && err.code === "gpu-helper-partial"
  );
  assert.equal(impl.runCalls().length, 0);
});

test("non-Windows apply uses the direct setter, never schtasks", async () => {
  const calls = [];
  const impl = async (exe, args) => {
    calls.push({ exe, args: [...args] });
    assert.match(exe, /nvidia-smi/);
    if (args.includes("-pl")) return { stdout: "", stderr: "" };
    return { stdout: "0, NVIDIA GeForce RTX 3060, 20.0, 100.00, 170.00, 100.00, 187.00\n", stderr: "" };
  };
  const result = await applyGpuPowerMode("eco", { execFileImpl: impl, platform: "linux" });
  assert.equal(result.ok, true);
  assert.ok(calls.every(c => !/schtasks/i.test(c.exe)));
});

// ------------------------------------------------- AB–AE: PowerShell contracts

test("AB: installer contains only the 100/130/170 mappings", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "install_gpu_power_tasks.ps1"), "utf8");
  const watts = [...source.matchAll(/Watts\s*=\s*(\d+)/g)].map(m => Number(m[1]));
  assert.deepEqual(watts.sort((a, b) => a - b), [100, 130, 170]);
  const plValues = [...source.matchAll(/-pl\s+(\d+)/g)].map(m => Number(m[1]));
  for (const v of plValues) assert.ok([100, 130, 170].includes(v));
  assert.match(source, /RunLevel Highest/);
  assert.match(source, /LogonType Interactive/);
  assert.equal(/param\s*\(/i.test(source), false, "installer accepts no parameters");
});

test("AC: installer has no credential or password handling", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "install_gpu_power_tasks.ps1"), "utf8");
  assert.equal(/-Password\b/i.test(source), false);
  assert.equal(/PSCredential/i.test(source), false);
  assert.equal(/ConvertTo-SecureString/i.test(source), false);
  assert.equal(/Get-Credential/i.test(source), false);
  assert.equal(/Read-Host/i.test(source), false);
  assert.equal(/EncodedCommand/i.test(source), false);
});

test("AD: installer task action invokes nvidia-smi directly, no wrapper", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "install_gpu_power_tasks.ps1"), "utf8");
  assert.match(source, /New-ScheduledTaskAction\s+-Execute\s+\$nvidiaSmi/);
  assert.equal(/-Execute\s+["']?(cmd|powershell|pwsh|wscript|cscript|node)/i.test(source), false);
  assert.match(source, /nvidia-smi\.exe/);
  assert.equal(/\.bat\b|\.cmd\b|\.ps1["']?\s*-Argument/i.test(source), false);
  // trusted resolution locations only
  assert.match(source, /SystemRoot.*System32.*nvidia-smi\.exe/s);
  assert.equal(/\$args\b|\$env:GPU|\$env:WATT|\$env:TASK/i.test(source), false);
});

test("AE: uninstaller references only the exact three task names", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "uninstall_gpu_power_tasks.ps1"), "utf8");
  assert.match(source, /"\\AI Video Director\\GPU Power\\"/);
  assert.match(source, /@\("ECO",\s*"BALANCED",\s*"NORMAL"\)/);
  assert.equal(/\*\s*"?\s*(-|\))/.test(source), false, "no wildcards in task selection");
  assert.match(source, /Unregister-ScheduledTask\s+-TaskPath\s+\$taskPath\s+-TaskName\s+\$name/);
  assert.equal(/Get-ScheduledTask\s*\|/.test(source), false, "no bulk task enumeration piping");
});

// ------------------------------------------------- AF / AG: UI contracts

test("AF: UI never auto-installs or auto-elevates", async () => {
  const ui = await readFile(path.join(harnessRoot, "public", "gpu-power-ui.mjs"), "utf8");
  const html = await readFile(path.join(harnessRoot, "public", "index.html"), "utf8");
  assert.equal(/runas|ShellExecute|elevat/i.test(ui), false);
  assert.equal(/install_gpu_power_tasks/.test(ui), false, "UI does not reference the installer endpointly");
  const fetches = [...ui.matchAll(/fetch\(\s*["']([^"']+)["']/g)].map(m => m[1]);
  assert.ok(fetches.length > 0);
  assert.ok(fetches.every(u => u === "/api/gpu-power"), `unexpected fetch targets: ${fetches}`);
  // instructions are static text, not an action
  assert.match(html, /gpuPowerHelperInstructions/);
  assert.match(html, /PowerShell come Amministratore/);
});

test("AG: helper UI keeps project/localStorage isolation", async () => {
  const ui = await readFile(path.join(harnessRoot, "public", "gpu-power-ui.mjs"), "utf8");
  assert.equal(/localStorage/.test(ui), false);
  assert.equal(/sessionStorage/.test(ui), false);
  assert.equal(/projectDirty/.test(ui), false);
  assert.equal(/\/api\/projects/.test(ui), false);
});

// ------------------------------------------------- payload shape

test("helper public payload exposes only type/available/state", () => {
  const payload = gpuHelperPublicPayload({
    type: HELPER_TYPE,
    state: "ready",
    tasks: { eco: "valid", balanced: "valid", normal: "valid" }
  });
  assert.deepEqual(payload, { type: "windows-scheduled-tasks", available: true, state: "ready" });
  assert.deepEqual(Object.keys(payload).sort(), ["available", "state", "type"]);
});
