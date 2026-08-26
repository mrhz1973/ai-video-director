import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(harnessRoot, "scripts", "windows", "launcher-cli.mjs");
const serverPath = path.join(harnessRoot, "server.mjs");

test("Director health endpoint is lightweight and precedes full config route", async () => {
  const source = await readFile(serverPath, "utf8");
  const healthStart = source.indexOf('url.pathname === "/api/health"');
  const configStart = source.indexOf('url.pathname === "/api/config"');
  assert.ok(healthStart >= 0, "missing /api/health route");
  assert.ok(configStart > healthStart, "/api/health must be evaluated before /api/config");

  const healthBlock = source.slice(healthStart, configStart);
  assert.match(healthBlock, /service:\s*packageInfo\.name/);
  assert.match(healthBlock, /version:\s*packageInfo\.version/);
  assert.doesNotMatch(healthBlock, /readComfyLoraAvailability|presets\(|projects\(|readArchiveStore|readCloudMirrorStore|fetch\s*\(/);
});

test("launcher CLI avoids immediate process.exit on error paths", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.doesNotMatch(source, /process\.exit\s*\(/);
  assert.match(source, /process\.exitCode\s*=\s*2/);
  assert.match(source, /process\.exitCode\s*=\s*1/);
});

test("launcher CLI invalid command exits cleanly with code 2", async () => {
  let failure = null;
  try {
    await execFileAsync(process.execPath, [cliPath, "invalid-command"], {
      cwd: harnessRoot,
      windowsHide: true,
      timeout: 10000
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, "invalid command must return non-zero");
  assert.equal(failure.code, 2);
  assert.match(String(failure.stderr || ""), /Usage: launcher-cli\.mjs/);
  assert.doesNotMatch(`${failure.stdout || ""}\n${failure.stderr || ""}`, /Assertion failed:|UV_HANDLE_CLOSING/i);
});

test("launcher CLI missing config exits cleanly with code 1", async () => {
  const missingConfig = path.join(harnessRoot, `missing-launcher-config-${process.pid}.json`);
  let failure = null;
  try {
    await execFileAsync(process.execPath, [cliPath, "start", "--config", missingConfig], {
      cwd: harnessRoot,
      windowsHide: true,
      timeout: 10000
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, "missing config must return non-zero");
  assert.equal(failure.code, 1);
  assert.match(String(failure.stderr || ""), /Launcher config not found/);
  assert.doesNotMatch(`${failure.stdout || ""}\n${failure.stderr || ""}`, /Assertion failed:|UV_HANDLE_CLOSING/i);
});
