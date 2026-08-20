import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, mkdir, rm, readFile, access, constants } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  canWriteResponse,
  endStartedResponse,
  sendBufferedUpstream,
  sendJson
} from "../lib/http-response.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageConfigPath = path.join(packageRoot, "config.json");

function mockRes(overrides = {}) {
  const state = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    writeHeadCalls: 0,
    endCalls: 0,
    statusCode: null,
    body: null,
    ...overrides
  };
  return {
    get headersSent() { return state.headersSent; },
    set headersSent(v) { state.headersSent = v; },
    get writableEnded() { return state.writableEnded; },
    set writableEnded(v) { state.writableEnded = v; },
    get destroyed() { return state.destroyed; },
    set destroyed(v) { state.destroyed = v; },
    writeHead(status) {
      if (state.headersSent || state.writableEnded || state.destroyed) {
        throw new Error("ERR_HTTP_HEADERS_SENT");
      }
      state.writeHeadCalls += 1;
      state.statusCode = status;
      state.headersSent = true;
    },
    end(payload) {
      state.endCalls += 1;
      state.body = payload;
      state.writableEnded = true;
    },
    _state: state
  };
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function freePort() {
  const probe = http.createServer();
  const port = await listen(probe);
  probe.close();
  await once(probe, "close");
  return port;
}

async function writeTempHarnessConfig({ comfyPort, harnessPort, projectsDir }) {
  const configPath = path.join(path.dirname(projectsDir), "harness.config.json");
  await writeFile(configPath, `${JSON.stringify({
    comfyUrl: `http://127.0.0.1:${comfyPort}`,
    listenHost: "127.0.0.1",
    listenPort: harnessPort,
    workflowDirectory: "./workflows",
    projectDirectory: projectsDir
  }, null, 2)}\n`, "utf8");
  return configPath;
}

async function spawnHarness(configPath) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      H3_CONFIG_PATH: configPath
    }
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`harness start timeout\n${stderr}`)), 8000);
    child.stdout.on("data", chunk => {
      if (String(chunk).includes("H3 harness:")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", code => {
      clearTimeout(timer);
      reject(new Error(`harness exited early: ${code}\n${stderr}`));
    });
  });
  return { child, stderr: () => stderr };
}

async function stopHarness(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
}

test("sendJson refuses headersSent / writableEnded / destroyed", () => {
  for (const flags of [
    { headersSent: true },
    { writableEnded: true },
    { destroyed: true }
  ]) {
    const res = mockRes(flags);
    assert.equal(sendJson(res, 500, { error: "x" }), false);
    assert.equal(res._state.writeHeadCalls, 0);
  }
});

test("sendJson writes when response is still writable", () => {
  const res = mockRes();
  assert.equal(sendJson(res, 200, { ok: true }), true);
  assert.equal(res._state.writeHeadCalls, 1);
  assert.equal(res._state.statusCode, 200);
  assert.equal(JSON.parse(res._state.body).ok, true);
});

test("late error after response started must not call writeHead again", () => {
  const res = mockRes();
  assert.equal(sendJson(res, 200, { phase: "started" }), true);
  assert.equal(canWriteResponse(res), false);
  assert.equal(sendJson(res, 500, { error: "late" }), false);
  assert.equal(res._state.writeHeadCalls, 1);
  assert.equal(endStartedResponse(res), false);
});

test("sendBufferedUpstream buffers before writing headers", async () => {
  const res = mockRes();
  let bodyRead = false;
  const upstream = {
    status: 200,
    headers: { get: () => "image/png" },
    arrayBuffer: async () => {
      bodyRead = true;
      return new Uint8Array([1, 2, 3]).buffer;
    }
  };
  assert.equal(await sendBufferedUpstream(res, upstream), true);
  assert.equal(bodyRead, true);
  assert.equal(res._state.writeHeadCalls, 1);
  assert.equal(Buffer.compare(res._state.body, Buffer.from([1, 2, 3])), 0);
});

test("sendBufferedUpstream body failure leaves headers unsent", async () => {
  const res = mockRes();
  const upstream = {
    status: 200,
    headers: { get: () => "image/png" },
    arrayBuffer: async () => { throw new Error("body boom"); }
  };
  await assert.rejects(() => sendBufferedUpstream(res, upstream), /body boom/);
  assert.equal(res._state.writeHeadCalls, 0);
  assert.equal(canWriteResponse(res), true);
  assert.equal(sendJson(res, 502, { error: "View fetch failed" }), true);
});

test("integration: broken /view upstream does not crash harness; /api/config still works", async () => {
  const fakeComfy = http.createServer((req, res) => {
    if (req.url?.startsWith("/queue")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ queue_running: [], queue_pending: [] }));
      return;
    }
    if (req.url?.startsWith("/view")) {
      res.writeHead(200, { "content-type": "video/mp4", "content-length": "1000000" });
      res.write(Buffer.alloc(16));
      res.destroy();
      return;
    }
    if (req.url?.startsWith("/upload/image")) {
      res.writeHead(200, { "content-type": "application/json", "content-length": "1000" });
      res.write("{");
      res.destroy();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const comfyPort = await listen(fakeComfy);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "h3-http-safe-"));
  const projects = path.join(tmp, "projects");
  await mkdir(projects, { recursive: true });
  const harnessPort = await freePort();
  const configPath = await writeTempHarnessConfig({ comfyPort, harnessPort, projectsDir: projects });
  let child;
  try {
    const spawned = await spawnHarness(configPath);
    child = spawned.child;
    const pid = child.pid;
    const view = await fetch(`http://127.0.0.1:${harnessPort}/api/view?filename=out.mp4`);
    assert.equal(view.status, 502);
    const viewBody = await view.json();
    assert.match(viewBody.error || "", /View fetch failed|failed/i);

    assert.equal(child.exitCode, null);
    const cfg = await fetch(`http://127.0.0.1:${harnessPort}/api/config`);
    assert.equal(cfg.status, 200);
    const data = await cfg.json();
    assert.ok(data.version);
    assert.equal(child.pid, pid);
    assert.ok(!spawned.stderr().includes("ERR_HTTP_HEADERS_SENT"));

    const upload = await fetch(`http://127.0.0.1:${harnessPort}/api/upload`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: "--x--\r\n"
    });
    assert.equal(upload.status, 502);
    assert.equal(child.exitCode, null);
    const cfg2 = await fetch(`http://127.0.0.1:${harnessPort}/api/config`);
    assert.equal(cfg2.status, 200);
  } finally {
    await stopHarness(child);
    fakeComfy.close();
    await rm(tmp, { recursive: true, force: true });
  }
});

test("integration: normal /api/view returns body and content-type", async () => {
  const payload = Buffer.from("PNGDATA");
  const fakeComfy = http.createServer((req, res) => {
    if (req.url?.startsWith("/queue")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ queue_running: [], queue_pending: [] }));
      return;
    }
    if (req.url?.startsWith("/view")) {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(payload);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const comfyPort = await listen(fakeComfy);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "h3-http-view-"));
  const projects = path.join(tmp, "projects");
  await mkdir(projects, { recursive: true });
  const harnessPort = await freePort();
  const configPath = await writeTempHarnessConfig({ comfyPort, harnessPort, projectsDir: projects });
  let child;
  try {
    const spawned = await spawnHarness(configPath);
    child = spawned.child;
    const response = await fetch(`http://127.0.0.1:${harnessPort}/api/view?filename=x.png`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /image\/png/);
    const buf = Buffer.from(await response.arrayBuffer());
    assert.equal(Buffer.compare(buf, payload), 0);
  } finally {
    await stopHarness(child);
    fakeComfy.close();
    await rm(tmp, { recursive: true, force: true });
  }
});

test("integration tests never mutate package-root config.json", async () => {
  const sentinel = Buffer.from(
    `{"comfyUrl":"http://127.0.0.1:65530","listenHost":"127.0.0.1","listenPort":65531,"workflowDirectory":"./workflows","projectDirectory":"./projects","__sentinel":"PRIVATE_TEST_CONFIG_DO_NOT_COMMIT"}\n`,
    "utf8"
  );
  let existedBefore = false;
  let original;
  try {
    original = await readFile(packageConfigPath);
    existedBefore = true;
  } catch {
    existedBefore = false;
  }

  await writeFile(packageConfigPath, sentinel);

  const fakeComfy = http.createServer((req, res) => {
    if (req.url?.startsWith("/queue")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ queue_running: [], queue_pending: [] }));
      return;
    }
    if (req.url?.startsWith("/view")) {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from("ok"));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const comfyPort = await listen(fakeComfy);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "h3-http-cfg-"));
  const projects = path.join(tmp, "projects");
  await mkdir(projects, { recursive: true });
  const harnessPort = await freePort();
  const tempConfigPath = await writeTempHarnessConfig({ comfyPort, harnessPort, projectsDir: projects });
  let child;
  try {
    const before = await readFile(packageConfigPath);
    assert.equal(Buffer.compare(before, sentinel), 0);
    const spawned = await spawnHarness(tempConfigPath);
    child = spawned.child;
    const response = await fetch(`http://127.0.0.1:${harnessPort}/api/view?filename=x.png`);
    assert.equal(response.status, 200);
    const after = await readFile(packageConfigPath);
    assert.equal(Buffer.compare(after, sentinel), 0);
    assert.equal(Buffer.compare(after, before), 0);
    assert.notEqual(tempConfigPath, packageConfigPath);
  } finally {
    await stopHarness(child);
    fakeComfy.close();
    await rm(tmp, { recursive: true, force: true });
    if (existedBefore) {
      await writeFile(packageConfigPath, original);
    } else {
      await rm(packageConfigPath, { force: true });
    }
    // Prove final restore state matches pretest existence, without printing content.
    try {
      await access(packageConfigPath, constants.F_OK);
      assert.equal(existedBefore, true);
    } catch {
      assert.equal(existedBefore, false);
    }
  }
});
