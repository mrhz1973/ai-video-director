import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_MODE_IDS,
  GPU_POWER_MODES,
  GpuPowerError,
  buildPowerLimitArgs,
  classifyMode,
  gpuPowerPublicPayload,
  isPermissionDeniedMessage,
  listGpuPowerModes,
  nvidiaSmiExecutable,
  parseGpuQueryCsv,
  readGpuPowerStatus,
  resolvePowerMode,
  setGpuPowerMode
} from "../lib/gpu-power.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("CSV parser normal values: 18.63 / 170 / 170 / 100 / 187", () => {
  const parsed = parseGpuQueryCsv("0, NVIDIA GeForce RTX 3060, 18.63, 170.00, 170.00, 100.00, 187.00");
  assert.equal(parsed.gpuIndex, 0);
  assert.match(parsed.name, /RTX 3060/);
  assert.equal(parsed.drawW, 18.63);
  assert.equal(parsed.currentLimitW, 170);
  assert.equal(parsed.defaultLimitW, 170);
  assert.equal(parsed.minLimitW, 100);
  assert.equal(parsed.maxLimitW, 187);
});

test("100 W classified ECO", () => {
  assert.equal(classifyMode(100), "eco");
  assert.equal(classifyMode(100.4), "eco");
});

test("130 W classified BALANCED", () => {
  assert.equal(classifyMode(130), "balanced");
});

test("170 W classified NORMAL", () => {
  assert.equal(classifyMode(170), "normal");
});

test("another value classified CUSTOM", () => {
  assert.equal(classifyMode(187), "custom");
  assert.equal(classifyMode(120), "custom");
});

test("strict mode allowlist", () => {
  assert.deepEqual([...ALLOWED_MODE_IDS], ["eco", "balanced", "normal"]);
  assert.equal(GPU_POWER_MODES.eco.watts, 100);
  assert.equal(GPU_POWER_MODES.balanced.watts, 130);
  assert.equal(GPU_POWER_MODES.normal.watts, 170);
  assert.throws(() => resolvePowerMode("turbo"), err => err instanceof GpuPowerError && err.status === 400);
  assert.throws(() => resolvePowerMode("100"), err => err instanceof GpuPowerError && err.code === "invalid-mode");
  assert.throws(() => resolvePowerMode("eco && calc"), err => err instanceof GpuPowerError);
  assert.deepEqual(listGpuPowerModes().map(m => m.id), ["eco", "balanced", "normal"]);
});

test("eco builds exactly -i 0 -pl 100", () => {
  assert.deepEqual(buildPowerLimitArgs(resolvePowerMode("eco").watts), ["-i", "0", "-pl", "100"]);
});

test("balanced builds 130", () => {
  assert.deepEqual(buildPowerLimitArgs(resolvePowerMode("balanced").watts), ["-i", "0", "-pl", "130"]);
});

test("normal builds 170", () => {
  assert.deepEqual(buildPowerLimitArgs(resolvePowerMode("normal").watts), ["-i", "0", "-pl", "170"]);
});

test("injection mode is rejected before execFile", async () => {
  let called = false;
  await assert.rejects(
    () => setGpuPowerMode("eco && calc", {
      execFileImpl: async () => {
        called = true;
        return { stdout: "", stderr: "" };
      }
    }),
    err => err instanceof GpuPowerError && err.code === "invalid-mode"
  );
  assert.equal(called, false);
});

test("numeric arbitrary wattage rejected", async () => {
  let called = false;
  await assert.rejects(
    () => setGpuPowerMode("187", {
      execFileImpl: async () => {
        called = true;
        return { stdout: "", stderr: "" };
      }
    }),
    err => err instanceof GpuPowerError && err.status === 400
  );
  assert.equal(called, false);
});

test("unavailable nvidia-smi handled gracefully", async () => {
  const status = await readGpuPowerStatus({
    execFileImpl: async () => {
      const error = new Error("not found");
      error.code = "ENOENT";
      throw error;
    }
  });
  assert.equal(status.available, false);
  assert.equal(status.mode, null);
});

test("permission-denied error classified truthfully", async () => {
  assert.equal(isPermissionDeniedMessage("Insufficient Permissions", ""), true);
  await assert.rejects(
    () => setGpuPowerMode("eco", {
      execFileImpl: async () => {
        const error = new Error("denied");
        error.stderr = "Insufficient Permissions";
        error.code = 4;
        throw error;
      }
    }),
    err => err instanceof GpuPowerError && err.code === "permission-denied" && err.status === 403
  );
});

test("post-set status verification", async () => {
  let calls = 0;
  const result = await setGpuPowerMode("balanced", {
    execFileImpl: async (exe, args) => {
      calls += 1;
      assert.match(exe, /nvidia-smi/);
      if (calls === 1) {
        assert.deepEqual(args, ["-i", "0", "-pl", "130"]);
        return { stdout: "", stderr: "" };
      }
      assert.ok(args.some(a => String(a).includes("query-gpu")));
      return {
        stdout: "0, NVIDIA GeForce RTX 3060, 22.1, 130.00, 170.00, 100.00, 187.00\n",
        stderr: ""
      };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.requested.watts, 130);
  assert.equal(result.status.mode, "balanced");
  assert.equal(result.status.currentLimitW, 130);
  assert.equal(calls, 2);
});

test("no shell=true anywhere in GPU power module", async () => {
  const source = await readFile(path.join(root, "lib", "gpu-power.mjs"), "utf8");
  assert.equal(/shell\s*:\s*true/.test(source), false);
  assert.equal(/\bexec\s*\(/.test(source), false);
  assert.equal(/spawn\s*\(/.test(source), false);
  assert.equal(/cmd\.exe/i.test(source), false);
  assert.equal(/powershell/i.test(source), false);
  assert.match(source, /execFile/);
  assert.equal(nvidiaSmiExecutable("win32"), "nvidia-smi.exe");
  assert.equal(nvidiaSmiExecutable("linux"), "nvidia-smi");
});

test("UI source contains exactly the three intended preset IDs", async () => {
  const ui = await readFile(path.join(root, "public", "gpu-power-ui.mjs"), "utf8");
  const html = await readFile(path.join(root, "public", "index.html"), "utf8");
  for (const id of ["eco", "balanced", "normal"]) {
    assert.match(html, new RegExp(`data-gpu-power-mode="${id}"`));
  }
  assert.equal((html.match(/data-gpu-power-mode="/g) || []).length, 3);
  assert.match(ui, /\/api\/gpu-power/);
  assert.match(ui, /JSON\.stringify\(\{\s*mode\s*\}/);
});

test("GPU Power UI does not write project/localStorage state", async () => {
  const ui = await readFile(path.join(root, "public", "gpu-power-ui.mjs"), "utf8");
  assert.equal(/localStorage/.test(ui), false);
  assert.equal(/sessionStorage/.test(ui), false);
  assert.equal(/projectDirty/.test(ui), false);
  assert.equal(/\/api\/projects/.test(ui), false);
});

test("gpuPowerPublicPayload includes modes list", () => {
  const payload = gpuPowerPublicPayload({
    available: true,
    gpuIndex: 0,
    name: "NVIDIA GeForce RTX 3060",
    drawW: 18.6,
    currentLimitW: 170,
    defaultLimitW: 170,
    minLimitW: 100,
    maxLimitW: 187,
    mode: "normal"
  });
  assert.equal(payload.mode, "normal");
  assert.deepEqual(payload.modes.map(m => m.watts), [100, 130, 170]);
});
