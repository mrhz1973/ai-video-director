import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  canWriteResponse,
  endStartedResponse,
  sendBufferedUpstream,
  sendJson
} from "../lib/http-response.mjs";

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
  // Simulate outer catch after headers already sent (old crash path).
  assert.equal(canWriteResponse(res), false);
  assert.equal(sendJson(res, 500, { error: "late" }), false);
  assert.equal(res._state.writeHeadCalls, 1);
  assert.equal(endStartedResponse(res), false); // already ended by sendJson
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

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

test("integration: broken /view upstream does not crash harness; /api/config still works", async () => {
  const fakeComfy = http.createServer((req, res) => {
    if (req.url?.startsWith("/queue")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ queue_running: [], queue_pending: [] }));
      return;
    }
    if (req.url?.startsWith("/view")) {
      // Headers ok from Comfy perspective, but body stream fails mid-way for fetch consumers
      // by destroying the socket after partial headers — force arrayBuffer failure path via abort.
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

  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "h3-http-safe-"));
  const projects = path.join(tmp, "projects");
  await mkdir(projects, { recursive: true });
  const configPath = path.join(packageRoot, "config.json");
  const probe = http.createServer();
  const harnessPort = await listen(probe);
  probe.close();
  await once(probe, "close");
  const config = {
    comfyUrl: `http://127.0.0.1:${comfyPort}`,
    listenHost: "127.0.0.1",
    listenPort: harnessPort,
    workflowDirectory: "./workflows",
    projectDirectory: projects
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env }
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  try {
    // wait for listen
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

    const pid = child.pid;
    const view = await fetch(`http://127.0.0.1:${harnessPort}/api/view?filename=out.mp4`);
    assert.equal(view.status, 502);
    const viewBody = await view.json();
    assert.match(viewBody.error || "", /View fetch failed|failed/i);

    // Same PID must still serve /api/config
    assert.equal(child.exitCode, null);
    const cfg = await fetch(`http://127.0.0.1:${harnessPort}/api/config`);
    assert.equal(cfg.status, 200);
    const data = await cfg.json();
    assert.ok(data.version);
    assert.equal(child.pid, pid);
    assert.ok(!stderr.includes("ERR_HTTP_HEADERS_SENT"));

    // upload broken body path
    const upload = await fetch(`http://127.0.0.1:${harnessPort}/api/upload`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: "--x--\r\n"
    });
    assert.equal(upload.status, 502);
    assert.equal(child.exitCode, null);
    const cfg2 = await fetch(`http://127.0.0.1:${harnessPort}/api/config`);
    assert.equal(cfg2.status, 200);

    // normal view through a healthy comfy endpoint: flip fake to good
    fakeComfy.close();
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise(resolve => setTimeout(resolve, 2000))
    ]);
    fakeComfy.close();
    try { await rm(configPath, { force: true }); } catch { /* ignore */ }
    try { await rm(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
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
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "h3-http-view-"));
  const projects = path.join(tmp, "projects");
  await mkdir(projects, { recursive: true });
  const probe = http.createServer();
  const harnessPort = await listen(probe);
  probe.close();
  await once(probe, "close");
  const configPath = path.join(packageRoot, "config.json");
  await writeFile(configPath, JSON.stringify({
    comfyUrl: `http://127.0.0.1:${comfyPort}`,
    listenHost: "127.0.0.1",
    listenPort: harnessPort,
    workflowDirectory: "./workflows",
    projectDirectory: projects
  }, null, 2));

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("start timeout")), 8000);
      child.stdout.on("data", chunk => {
        if (String(chunk).includes("H3 harness:")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("exit", code => {
        clearTimeout(timer);
        reject(new Error(`exit ${code}`));
      });
    });
    const response = await fetch(`http://127.0.0.1:${harnessPort}/api/view?filename=x.png`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /image\/png/);
    const buf = Buffer.from(await response.arrayBuffer());
    assert.equal(Buffer.compare(buf, payload), 0);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(r => setTimeout(r, 2000))]);
    fakeComfy.close();
    await rm(configPath, { force: true });
    await rm(tmp, { recursive: true, force: true });
  }
});
