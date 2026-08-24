/**
 * Authoritative Comfy output reveal/download — behavioral (mocked Comfy + temp files).
 * No live generation, /api/queue, /prompt, interrupt, or GPU.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, mkdir, rm, readFile, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  ComfyOutputPathError,
  findAuthoritativeHistoryOutput,
  resolveAuthoritativeComfyOutput,
  resolveContainedComfyOutputPath
} from "../lib/comfy-output-authority.mjs";
import { showComfyOutputInFolder, buildWindowsExplorerSelectArgs } from "../lib/comfy-output-actions.mjs";
import {
  applyScenaFirstFrameView,
  appendBatchFirstFrameSummary,
  resolveEffectiveFirstFrame
} from "../public/first-frame-view.mjs";
import { deriveComfyOutputDirectoryFromComfyRoot, buildDirectorCommand } from "../lib/windows-launcher.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MP4_BYTES = Buffer.from("ftypisomfake-mp4-payload-v0140");

function historyEntry(filename, { subfolder = "", type = "output" } = {}) {
  return {
    outputs: {
      "9": {
        videos: [{ filename, subfolder, type }]
      }
    },
    status: { messages: [["execution_success", {}]] }
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

async function writeTempHarnessConfig({
  comfyPort,
  harnessPort,
  projectsDir,
  outputDir
}) {
  const configPath = path.join(path.dirname(projectsDir), "harness.config.json");
  await writeFile(configPath, `${JSON.stringify({
    comfyUrl: `http://127.0.0.1:${comfyPort}`,
    listenHost: "127.0.0.1",
    listenPort: harnessPort,
    workflowDirectory: "./workflows",
    projectDirectory: projectsDir,
    comfyOutputDirectory: outputDir
  }, null, 2)}\n`, "utf8");
  return configPath;
}

async function spawnHarness(configPath, extraEnv = {}) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      H3_CONFIG_PATH: configPath,
      ...extraEnv
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

function mockDocument() {
  const nodes = new Map();
  return {
    getElementById(id) {
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          textContent: "",
          hidden: false,
          children: [],
          replaceChildren() { this.children = []; this.textContent = ""; },
          append(...els) { this.children.push(...els); }
        });
      }
      return nodes.get(id);
    },
    createElement(tag) {
      return {
        tagName: tag,
        className: "",
        textContent: "",
        src: "",
        alt: "",
        title: "",
        decoding: "",
        onerror: null,
        children: [],
        append(...els) { this.children.push(...els); }
      };
    }
  };
}

test("resolveEffectiveFirstFrame: item.files override then shared files", () => {
  const shared = { firstImage: "SHARED.png" };
  const override = resolveEffectiveFirstFrame({
    itemFiles: { firstImage: "S03.png" },
    sharedFiles: shared
  });
  assert.equal(override.filename, "S03.png");
  const inherited = resolveEffectiveFirstFrame({
    itemFiles: null,
    sharedFiles: shared
  });
  assert.equal(inherited.filename, "SHARED.png");
  const empty = resolveEffectiveFirstFrame({ itemFiles: {}, sharedFiles: {} });
  assert.equal(empty.filename, "");
});

test("8 batch jobs S01–S08 resolve distinct effective first frames", () => {
  const shared = { firstImage: "SHARED.png" };
  const names = [];
  for (let i = 1; i <= 8; i += 1) {
    const name = `S${String(i).padStart(2, "0")}.png`;
    const binding = resolveEffectiveFirstFrame({
      itemFiles: { firstImage: name },
      sharedFiles: shared
    });
    names.push(binding.filename);
  }
  assert.deepEqual(names, [
    "S01.png", "S02.png", "S03.png", "S04.png",
    "S05.png", "S06.png", "S07.png", "S08.png"
  ]);
  assert.equal(new Set(names).size, 8);
});

test("SCENA first-frame DOM shows exact filename + thumb URL", () => {
  const doc = mockDocument();
  applyScenaFirstFrameView(doc, {
    filename: "martino.png",
    url: "/api/view?filename=martino.png&type=input",
    available: true
  });
  assert.equal(doc.getElementById("scenaFirstFrameName").textContent, "martino.png");
  const thumb = doc.getElementById("scenaFirstFrameThumb");
  assert.equal(thumb.hidden, false);
  assert.equal(thumb.children[0].src, "/api/view?filename=martino.png&type=input");
  applyScenaFirstFrameView(doc, { filename: "" });
  assert.match(doc.getElementById("scenaFirstFrameName").textContent, /Nessun first frame/);
});

test("BATCH compact card appends thumb + exact filename", () => {
  const doc = mockDocument();
  const parent = { children: [], append(...els) { this.children.push(...els); } };
  appendBatchFirstFrameSummary(doc, parent, {
    filename: "S02.png",
    url: "/api/view?filename=S02.png&type=input",
    available: true
  });
  const wrap = parent.children[0];
  assert.equal(wrap.className, "batch-job-first-frame");
  assert.equal(wrap.children[0].src.includes("S02.png"), true);
  assert.equal(wrap.children[1].textContent, "S02.png");
});

test("launcher derives <comfyRoot>/ComfyUI/output without manual config", () => {
  const derived = deriveComfyOutputDirectoryFromComfyRoot("C:/FakeComfy");
  assert.match(derived.replace(/\\/g, "/"), /FakeComfy\/ComfyUI\/output$/);
  const cmd = buildDirectorCommand(packageRoot, "node", {
    comfyRoot: "C:/FakeComfy",
    env: { PATH: "x" }
  });
  assert.match(cmd.env.H3_COMFY_OUTPUT_DIRECTORY.replace(/\\/g, "/"), /FakeComfy\/ComfyUI\/output$/);
  const overridden = buildDirectorCommand(packageRoot, "node", {
    comfyRoot: "C:/FakeComfy",
    env: { H3_COMFY_OUTPUT_DIRECTORY: "D:/ExplicitOut" }
  });
  assert.equal(overridden.env.H3_COMFY_OUTPUT_DIRECTORY, "D:/ExplicitOut");
});

test("history mismatch / missing promptId fail closed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-auth-"));
  await writeFile(path.join(dir, "clip.mp4"), MP4_BYTES);
  await assert.rejects(
    () => resolveAuthoritativeComfyOutput({
      outputRoot: dir,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "",
      filename: "clip.mp4",
      fetchFn: async () => ({ ok: true, json: async () => ({}) })
    }),
    err => err.code === "prompt-id-required"
  );
  await assert.rejects(
    () => resolveAuthoritativeComfyOutput({
      outputRoot: dir,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "pid-1",
      filename: "clip.mp4",
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ "pid-1": historyEntry("other.mp4") })
      })
    }),
    err => err.code === "history-mismatch"
  );
  await assert.rejects(
    () => resolveAuthoritativeComfyOutput({
      outputRoot: dir,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "pid-1",
      filename: "clip.mp4",
      fetchFn: async () => { throw new Error("ECONNREFUSED"); }
    }),
    err => err.code === "history-unavailable"
  );
  await rm(dir, { recursive: true, force: true });
});

test("realpath containment rejects junction/symlink escape", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "h3-out-"));
  await writeFile(path.join(outside, "secret.mp4"), MP4_BYTES);
  const linkPath = path.join(root, "escape-link");
  let linked = false;
  try {
    await symlink(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
    linked = true;
  } catch {
    // Some CI images disallow junctions; mock realpath instead.
  }
  if (linked) {
    await assert.rejects(
      () => resolveContainedComfyOutputPath(root, {
        filename: "secret.mp4",
        subfolder: "escape-link"
      }),
      err => err.code === "root-escape" || err.code === "file-not-found"
    );
  }
  await assert.rejects(
    () => resolveContainedComfyOutputPath(root, { filename: "secret.mp4" }, {
      realpathImpl: async p => {
        const resolved = path.resolve(p);
        if (resolved === path.resolve(root)) return resolved;
        return path.join(outside, "secret.mp4");
      }
    }),
    err => err.code === "root-escape"
  );
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

test("show-in-folder requires authoritative history then Explorer argv", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-show-"));
  await writeFile(path.join(dir, "clip.mp4"), MP4_BYTES);
  const calls = [];
  await showComfyOutputInFolder({
    outputRoot: dir,
    comfyUrl: "http://127.0.0.1:9",
    promptId: "pid-show",
    filename: "clip.mp4",
    platform: "win32",
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ "pid-show": historyEntry("clip.mp4") })
    }),
    execFileImpl: async (exe, args) => { calls.push({ exe, args }); }
  });
  assert.equal(calls[0].exe, "explorer.exe");
  assert.deepEqual(calls[0].args, buildWindowsExplorerSelectArgs(path.join(dir, "clip.mp4")));
  await rm(dir, { recursive: true, force: true });
});

test("HTTP download-mp4: 200 video/mp4 attachment byte-identical; rejects bad cases", async () => {
  const projectsDir = await mkdtemp(path.join(os.tmpdir(), "h3-proj-"));
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "h3-comfy-out-"));
  const nested = path.join(outputDir, "sceneA");
  await mkdir(nested);
  await writeFile(path.join(outputDir, "good.mp4"), MP4_BYTES);
  await writeFile(path.join(nested, "nested.mp4"), Buffer.from("nested-bytes"));
  await writeFile(path.join(outputDir, "note.txt"), Buffer.from("not-video"));

  const history = {
    "pid-good": historyEntry("good.mp4"),
    "pid-nested": historyEntry("nested.mp4", { subfolder: "sceneA" }),
    "pid-txt": historyEntry("note.txt"),
    "pid-other": historyEntry("other.mp4")
  };

  const fakeComfy = http.createServer((req, res) => {
    const m = /^\/history\/([^/?]+)/.exec(req.url || "");
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (!history[id]) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ [id]: history[id] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const comfyPort = await listen(fakeComfy);
  const harnessPort = await freePort();
  const configPath = await writeTempHarnessConfig({
    comfyPort,
    harnessPort,
    projectsDir,
    outputDir
  });
  const { child } = await spawnHarness(configPath);
  const base = `http://127.0.0.1:${harnessPort}`;

  try {
    const cfg = await fetch(`${base}/api/config`).then(r => r.json());
    assert.equal(cfg.comfyOutputConfigured, true);

    const ok = await fetch(
      `${base}/api/download-mp4?promptId=pid-good&filename=good.mp4&type=output`
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "video/mp4");
    assert.match(ok.headers.get("content-disposition") || "", /attachment; filename="good\.mp4"/);
    const body = Buffer.from(await ok.arrayBuffer());
    assert.equal(Buffer.compare(body, MP4_BYTES), 0);

    const nestedRes = await fetch(
      `${base}/api/download-mp4?promptId=pid-nested&filename=nested.mp4&subfolder=sceneA&type=output`
    );
    assert.equal(nestedRes.status, 200);
    assert.equal(Buffer.compare(Buffer.from(await nestedRes.arrayBuffer()), Buffer.from("nested-bytes")), 0);

    const notMp4 = await fetch(
      `${base}/api/download-mp4?promptId=pid-txt&filename=note.txt&type=output`
    );
    assert.equal(notMp4.status, 400);

    const missing = await fetch(
      `${base}/api/download-mp4?promptId=pid-good&filename=absent.mp4&type=output`
    );
    assert.ok([403, 404].includes(missing.status));

    const wrongPid = await fetch(
      `${base}/api/download-mp4?promptId=pid-missing&filename=good.mp4&type=output`
    );
    assert.ok([403, 404, 503].includes(wrongPid.status));

    const mismatch = await fetch(
      `${base}/api/download-mp4?promptId=pid-other&filename=good.mp4&type=output`
    );
    assert.equal(mismatch.status, 403);

    const trav = await fetch(
      `${base}/api/download-mp4?promptId=pid-good&filename=..%2Fgood.mp4&type=output`
    );
    assert.equal(trav.status, 400);

    const abs = await fetch(
      `${base}/api/download-mp4?promptId=pid-good&filename=C%3A%5CWindows%5Cgood.mp4&type=output`
    );
    assert.equal(abs.status, 400);

    // History unavailable fail-closed
    fakeComfy.close();
    await once(fakeComfy, "close");
    const down = await fetch(
      `${base}/api/download-mp4?promptId=pid-good&filename=good.mp4&type=output`
    );
    assert.equal(down.status, 503);
  } finally {
    await stopHarness(child);
    try { fakeComfy.close(); } catch { /* already closed */ }
    await rm(projectsDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("findAuthoritativeHistoryOutput matches exact tuple only", () => {
  const entry = historyEntry("a.mp4", { subfolder: "x" });
  assert.ok(findAuthoritativeHistoryOutput(entry, { filename: "a.mp4", subfolder: "x" }));
  assert.equal(findAuthoritativeHistoryOutput(entry, { filename: "a.mp4", subfolder: "" }), null);
  assert.equal(findAuthoritativeHistoryOutput(entry, { filename: "b.mp4", subfolder: "x" }), null);
});

test("authority helpers never scan folders / guess filenames", async () => {
  const src = await readFile(path.join(packageRoot, "lib/comfy-output-authority.mjs"), "utf8");
  assert.doesNotMatch(src, /readdir|opendir|glob|walk/i);
  assert.match(src, /promptId/);
  assert.match(src, /realpath/);
});
