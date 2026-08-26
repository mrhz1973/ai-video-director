/**
 * v0.14.1 — launcher opens Director + ComfyUI browser pages after health gates.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  ACTION,
  DIRECTOR_HEALTH_IDENTITY,
  buildLauncherBrowserUrls,
  buildLauncherConfigPayload,
  normalizeConfig,
  openLauncherBrowserPages,
  readDirectorPackageVersion,
  serviceBaseUrl,
  SERVICE
} from "../lib/windows-launcher.mjs";
import { runStart } from "../scripts/windows/launcher-cli.mjs";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedDirectorVersion = await readDirectorPackageVersion(harnessRoot);

function absentPort() {
  return { listening: false, inspectionOk: true, processInfo: null };
}

function listeningPort(pid, extra = {}) {
  return { listening: true, inspectionOk: true, processInfo: { pid, ...extra } };
}

function comfyStats() {
  return new Response(JSON.stringify({ system: { os: "win" }, devices: [] }), { status: 200 });
}

function directorHealth(version = expectedDirectorVersion, service = DIRECTOR_HEALTH_IDENTITY) {
  return new Response(JSON.stringify({ service, version }), { status: 200 });
}

async function makeTempConfig(comfyRoot, overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-launcher-config-"));
  const configPath = path.join(dir, "launcher.json");
  const payload = buildLauncherConfigPayload({
    comfyRoot,
    runtimeRoot: overrides.runtimeRoot ?? path.dirname(harnessRoot),
    ...overrides
  });
  await writeFile(configPath, JSON.stringify(payload), "utf8");
  return { dir, configPath, config: normalizeConfig(payload) };
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

test("buildLauncherBrowserUrls normalizes trailing slashes", () => {
  assert.deepEqual(
    buildLauncherBrowserUrls("http://127.0.0.1:8787", "http://127.0.0.1:8188"),
    {
      directorUrl: "http://127.0.0.1:8787/",
      comfyUrl: "http://127.0.0.1:8188/"
    }
  );
});

test("openLauncherBrowserPages opens Director first then ComfyUI once each", () => {
  const opened = [];
  const urls = openLauncherBrowserPages({
    directorBaseUrl: "http://127.0.0.1:8787",
    comfyBaseUrl: "http://127.0.0.1:8188",
    openBrowserFn: url => opened.push(url)
  });
  assert.deepEqual(opened, [
    "http://127.0.0.1:8787/",
    "http://127.0.0.1:8188/"
  ]);
  assert.equal(urls.directorUrl, opened[0]);
  assert.equal(urls.comfyUrl, opened[1]);
});

test("healthy already-running ComfyUI is reused and browser URL requested once", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, config } = await makeTempConfig(comfyRoot);
  const spawns = [];
  const browsers = [];
  const result = await runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/health")) return directorHealth();
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async () => listeningPort(1),
      spawnFn: cmd => spawns.push(cmd),
      openBrowserFn: url => browsers.push(url)
    }
  });
  assert.equal(result.comfy.action, ACTION.REUSE);
  assert.equal(spawns.length, 0);
  const comfyUrl = `${serviceBaseUrl(config, SERVICE.COMFY)}/`;
  assert.equal(browsers.filter(url => url === comfyUrl).length, 1);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("healthy Director browser URL requested once on successful start", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, config } = await makeTempConfig(comfyRoot);
  const browsers = [];
  const result = await runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/health")) return directorHealth();
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async () => listeningPort(1),
      spawnFn: () => {},
      openBrowserFn: url => browsers.push(url)
    }
  });
  assert.equal(result.director.action, ACTION.REUSE);
  const directorUrl = `${serviceBaseUrl(config, SERVICE.DIRECTOR)}/`;
  assert.equal(browsers.filter(url => url === directorUrl).length, 1);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("openBrowser=true requests both Director and ComfyUI URLs exactly once", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath, config } = await makeTempConfig(comfyRoot, { openBrowser: true });
  const browsers = [];
  const result = await runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/health")) return directorHealth();
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async () => listeningPort(1),
      spawnFn: () => {},
      openBrowserFn: url => browsers.push(url)
    }
  });
  const directorUrl = `${serviceBaseUrl(config, SERVICE.DIRECTOR)}/`;
  const comfyUrl = `${serviceBaseUrl(config, SERVICE.COMFY)}/`;
  assert.equal(result.browserOpened, true);
  assert.deepEqual(result.browserUrls, { directorUrl, comfyUrl });
  assert.deepEqual(browsers, [directorUrl, comfyUrl]);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("openBrowser=false requests neither URL", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot, { openBrowser: false });
  const browsers = [];
  const result = await runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/health")) return directorHealth();
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async () => listeningPort(1),
      spawnFn: () => {},
      openBrowserFn: url => browsers.push(url)
    }
  });
  assert.equal(result.browserOpened, false);
  assert.equal(result.browserUrls, null);
  assert.equal(browsers.length, 0);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("failed ComfyUI health gate opens no browser pages", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot, { comfyTimeoutSeconds: 0.05 });
  const spawns = [];
  const browsers = [];
  await assert.rejects(() => runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async () => new Response("down", { status: 503 }),
      inspectPortFn: async () => absentPort(),
      spawnFn: cmd => spawns.push(cmd),
      openBrowserFn: url => browsers.push(url),
      sleepFn: async () => {}
    }
  }), /ComfyUI did not become healthy/i);
  assert.equal(browsers.length, 0);
  assert.equal(spawns.length, 1);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("failed Director health gate opens no browser pages", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot, { directorTimeoutSeconds: 0.05 });
  const spawns = [];
  const browsers = [];
  await assert.rejects(() => runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        return new Response("down", { status: 503 });
      },
      inspectPortFn: async port => (port === 8188 ? listeningPort(8188) : absentPort()),
      spawnFn: cmd => spawns.push(cmd),
      openBrowserFn: url => browsers.push(url),
      sleepFn: async () => {}
    }
  }), /Director did not become healthy/i);
  assert.equal(browsers.length, 0);
  assert.equal(spawns.length, 1);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("browser opening adds zero additional spawns when both services already healthy", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  const spawns = [];
  const browsers = [];
  await runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        if (String(url).includes("/api/health")) return directorHealth();
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async () => listeningPort(1),
      spawnFn: cmd => spawns.push(cmd),
      openBrowserFn: url => browsers.push(url)
    }
  });
  assert.equal(spawns.length, 0);
  assert.equal(browsers.length, 2);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});

test("unexpected process on 8787 remains fail-closed with no browser open", async () => {
  const comfyRoot = await makeFakeComfyRoot();
  const { configPath } = await makeTempConfig(comfyRoot);
  const browsers = [];
  await assert.rejects(() => runStart({
    harnessRoot,
    configPath,
    deps: {
      fetchFn: async url => {
        if (String(url).includes("/system_stats")) return comfyStats();
        return new Response("{}", { status: 404 });
      },
      inspectPortFn: async port => {
        if (port === 8188) return listeningPort(8188);
        return listeningPort(8787, { executable: "other.exe", commandLine: "other.exe --listen" });
      },
      spawnFn: () => {},
      openBrowserFn: url => browsers.push(url)
    }
  }), /unexpected process/i);
  assert.equal(browsers.length, 0);
  await rm(path.dirname(configPath), { recursive: true, force: true });
  await rm(comfyRoot, { recursive: true, force: true });
});
