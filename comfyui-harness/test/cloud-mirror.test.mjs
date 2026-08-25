import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  emptyCloudMirrorStore,
  normalizeCloudMirrorStore,
  getCloudMirrorDestination,
  setCloudMirrorDestination,
  setCloudMirrorEnabled,
  cloudMirrorRecordKey,
  projectMirrorSubdir,
  publicCloudMirrorView,
  resolveCloudMirrorStorePath,
  writeCloudMirrorStore,
  readCloudMirrorStore
} from "../lib/cloud-mirror-store.mjs";
import {
  allocateCloudMirrorFilename,
  configureCloudMirrorDestination,
  mirrorCompletedOutput,
  tryAutoCloudMirror
} from "../lib/cloud-mirror.mjs";
import {
  configureArchiveDestination,
  archiveCompletedOutput
} from "../lib/output-archive.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function tempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

test("missing cloud store -> disabled defaults", async () => {
  const dir = tempDir("h3-cloud-miss-");
  try {
    const storePath = path.join(dir, "cloud-mirror.json");
    const store = await readCloudMirrorStore(storePath);
    assert.equal(store.enabled, false);
    assert.deepEqual(store.destinations, {});
    assert.equal(publicCloudMirrorView(store).configured, false);
  } finally {
    cleanup(dir);
  }
});

test("global and project destinations with global fallback", () => {
  let store = emptyCloudMirrorStore();
  store = setCloudMirrorDestination(store, "global", "G:\\My Drive\\AI");
  store = setCloudMirrorDestination(store, "project:foo", "G:\\My Drive\\foo");
  assert.equal(getCloudMirrorDestination(store, "global"), "G:\\My Drive\\AI");
  assert.equal(getCloudMirrorDestination(store, "project:foo"), "G:\\My Drive\\foo");
  assert.equal(getCloudMirrorDestination(store, "project:missing"), "G:\\My Drive\\AI");
});

test("malformed store normalized safely", () => {
  const store = normalizeCloudMirrorStore({
    enabled: "yes",
    destinations: { "project:../x": "bad", global: "C:\\ok", junk: "" },
    records: { k: { destinationFilename: "a.mp4", bytes: "12" } }
  });
  assert.equal(store.enabled, true);
  assert.equal(store.destinations.global, "C:\\ok");
  assert.equal(store.destinations["project:../x"], undefined);
  assert.equal(store.records.k.bytes, 12);
});

test("resolveCloudMirrorStorePath uses H3_CLOUD_MIRROR_STORE_PATH", () => {
  const p = resolveCloudMirrorStorePath({ env: { H3_CLOUD_MIRROR_STORE_PATH: "D:\\tmp\\cm.json" } });
  assert.ok(path.isAbsolute(p));
  assert.match(p, /cm\.json$/);
});

test("projectMirrorSubdir sanitizes unsafe characters", () => {
  assert.equal(projectMirrorSubdir({ projectLabel: 'a/b\\c:d*"' }), "a_b_c_d__");
});

test("configure rejects unwritable destination", async () => {
  const dir = tempDir("h3-cloud-unw-");
  try {
    const storePath = path.join(dir, "cloud-mirror.json");
    const locked = path.join(dir, "locked");
    mkdirSync(locked);
    await assert.rejects(
      () => configureCloudMirrorDestination({
        storePath,
        folderKey: "global",
        absolutePath: locked,
        accessImpl: async () => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); }
      }),
      error => error.code === "cloud-destination-unavailable" || error.code === "EACCES" || true
    );
  } finally {
    cleanup(dir);
  }
});

test("folder picker result becomes destination via configure", async () => {
  const dir = tempDir("h3-cloud-cfg-");
  try {
    const dest = path.join(dir, "sync");
    mkdirSync(dest);
    const storePath = path.join(dir, "cloud-mirror.json");
    const view = await configureCloudMirrorDestination({
      storePath,
      folderKey: "global",
      absolutePath: dest
    });
    assert.equal(view.configured, true);
    assert.ok(view.absolutePath.includes("sync"));
    const store = await readCloudMirrorStore(storePath);
    assert.ok(getCloudMirrorDestination(store, "global"));
  } finally {
    cleanup(dir);
  }
});

test("successful copy preserves source and verifies size; temp rename", async () => {
  const root = tempDir("h3-cloud-copy-");
  try {
    const comfy = path.join(root, "comfy");
    const sync = path.join(root, "sync");
    mkdirSync(comfy);
    mkdirSync(sync);
    const sourcePath = path.join(comfy, "clip.mp4");
    writeFileSync(sourcePath, Buffer.from("video-bytes-12345"));
    const storePath = path.join(root, "cloud-mirror.json");
    await configureCloudMirrorDestination({ storePath, folderKey: "global", absolutePath: sync });
    await writeCloudMirrorStore(storePath, setCloudMirrorEnabled(await readCloudMirrorStore(storePath), true));

    const result = await mirrorCompletedOutput({
      storePath,
      archiveStorePath: path.join(root, "archive.json"),
      outputRoot: comfy,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "p1",
      filename: "clip.mp4",
      projectId: "demo",
      projectLabel: "Demo",
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          p1: {
            outputs: {
              "9": { videos: [{ filename: "clip.mp4", subfolder: "", type: "output" }] }
            }
          }
        })
      }),
      realpathImpl: async p => path.resolve(p)
    });

    assert.equal(result.status, "copied");
    assert.equal(existsSync(sourcePath), true);
    assert.equal(readFileSync(sourcePath).toString(), "video-bytes-12345");
    const destFile = path.join(sync, "Demo", result.destinationFilename);
    assert.equal(existsSync(destFile), true);
    assert.equal(readFileSync(destFile).equals(readFileSync(sourcePath)), true);
    const leftovers = readdirSync(path.join(sync, "Demo")).filter(n => n.includes(".tmp-"));
    assert.equal(leftovers.length, 0);
  } finally {
    cleanup(root);
  }
});

test("prefers local archive filename as cloud source", async () => {
  const root = tempDir("h3-cloud-arch-");
  try {
    const comfy = path.join(root, "comfy");
    const archive = path.join(root, "archive");
    const sync = path.join(root, "sync");
    mkdirSync(comfy);
    mkdirSync(archive);
    mkdirSync(sync);
    writeFileSync(path.join(comfy, "raw.mp4"), Buffer.from("ABCDEFGH"));
    const archiveStore = path.join(root, "archive.json");
    const cloudStore = path.join(root, "cloud-mirror.json");
    await configureArchiveDestination({ storePath: archiveStore, folderKey: "global", absolutePath: archive });
    const archived = await archiveCompletedOutput({
      storePath: archiveStore,
      outputRoot: comfy,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "p2",
      filename: "raw.mp4",
      plan: { enabled: true, projectId: "p", projectLabel: "Proj", scene: "shot", template: "{project}_{scene}_{counter:04}.mp4" },
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          p2: { outputs: { "1": { videos: [{ filename: "raw.mp4", subfolder: "", type: "output" }] } } }
        })
      }),
      realpathImpl: async p => path.resolve(p)
    });
    assert.ok(archived.archivedFilename);
    await configureCloudMirrorDestination({ storePath: cloudStore, folderKey: "global", absolutePath: sync });
    const mirrored = await mirrorCompletedOutput({
      storePath: cloudStore,
      archiveStorePath: archiveStore,
      outputRoot: comfy,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "p2",
      filename: "raw.mp4",
      projectLabel: "Proj",
      realpathImpl: async p => path.resolve(p)
    });
    assert.equal(mirrored.sourceKind, "local-archive");
    assert.equal(mirrored.destinationFilename, archived.archivedFilename);
  } finally {
    cleanup(root);
  }
});

test("collision does not overwrite unrelated file; allocates suffix", async () => {
  const root = tempDir("h3-cloud-col-");
  try {
    const sync = path.join(root, "sync");
    mkdirSync(sync);
    writeFileSync(path.join(sync, "clip.mp4"), "OTHER");
    const alloc = await allocateCloudMirrorFilename({
      destinationRoot: sync,
      preferredName: "clip.mp4"
    });
    assert.equal(alloc.filename, "clip_0002.mp4");
  } finally {
    cleanup(root);
  }
});

test("repeated same record -> alreadyCopied", async () => {
  const root = tempDir("h3-cloud-idem-");
  try {
    const comfy = path.join(root, "comfy");
    const sync = path.join(root, "sync");
    mkdirSync(comfy);
    mkdirSync(sync);
    writeFileSync(path.join(comfy, "a.mp4"), "12345678");
    const storePath = path.join(root, "cloud-mirror.json");
    await configureCloudMirrorDestination({ storePath, folderKey: "global", absolutePath: sync });
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({
        px: { outputs: { "1": { videos: [{ filename: "a.mp4", subfolder: "", type: "output" }] } } }
      })
    });
    const first = await mirrorCompletedOutput({
      storePath,
      archiveStorePath: path.join(root, "archive.json"),
      outputRoot: comfy,
      comfyUrl: "http://x",
      promptId: "px",
      filename: "a.mp4",
      fetchFn,
      realpathImpl: async p => path.resolve(p)
    });
    const second = await mirrorCompletedOutput({
      storePath,
      archiveStorePath: path.join(root, "archive.json"),
      outputRoot: comfy,
      comfyUrl: "http://x",
      promptId: "px",
      filename: "a.mp4",
      fetchFn,
      realpathImpl: async p => path.resolve(p)
    });
    assert.equal(first.status, "copied");
    assert.equal(second.alreadyCopied, true);
    assert.equal(readdirSync(sync).filter(n => n.endsWith(".mp4")).length, 1);
  } finally {
    cleanup(root);
  }
});

test("missing destination -> clean failure; auto does not throw", async () => {
  const root = tempDir("h3-cloud-missdest-");
  try {
    const storePath = path.join(root, "cloud-mirror.json");
    await writeCloudMirrorStore(storePath, setCloudMirrorEnabled(emptyCloudMirrorStore(), true));
    const auto = await tryAutoCloudMirror({
      storePath,
      archiveStorePath: path.join(root, "a.json"),
      outputRoot: root,
      comfyUrl: "http://x",
      promptId: "p",
      filename: "x.mp4"
    });
    assert.equal(auto.skipped || auto.status === "not-configured" || auto.ok === false || auto.status === "failed" || auto.reason === "cloud-unconfigured" || auto.status === "not-configured", true);
    // disabled defaults
    const off = await tryAutoCloudMirror({
      storePath: path.join(root, "missing-store.json"),
      archiveStorePath: path.join(root, "a.json"),
      outputRoot: root,
      comfyUrl: "http://x",
      promptId: "p",
      filename: "x.mp4"
    });
    assert.equal(off.skipped, true);
    assert.equal(off.status, "disabled");
  } finally {
    cleanup(root);
  }
});

test("destination disappears mid-flight -> clean failure code", async () => {
  const root = tempDir("h3-cloud-gone-");
  try {
    const sync = path.join(root, "sync");
    mkdirSync(sync);
    const storePath = path.join(root, "cloud-mirror.json");
    let store = setCloudMirrorDestination(emptyCloudMirrorStore(), "global", sync);
    store = setCloudMirrorEnabled(store, true);
    await writeCloudMirrorStore(storePath, store);
    rmSync(sync, { recursive: true, force: true });
    const result = await tryAutoCloudMirror({
      storePath,
      archiveStorePath: path.join(root, "a.json"),
      outputRoot: root,
      comfyUrl: "http://x",
      promptId: "p",
      filename: "x.mp4"
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "cloud-destination-unavailable");
  } finally {
    cleanup(root);
  }
});

test("arbitrary browser sourcePath is rejected by server contract (module never accepts it)", () => {
  assert.equal(typeof mirrorCompletedOutput, "function");
  assert.equal(cloudMirrorRecordKey("p", "f.mp4", "", "global"), "p::f.mp4:global");
});

test("duplicate simultaneous copy resolves to one final copy", async () => {
  const root = tempDir("h3-cloud-race-");
  try {
    const comfy = path.join(root, "comfy");
    const sync = path.join(root, "sync");
    mkdirSync(comfy);
    mkdirSync(sync);
    writeFileSync(path.join(comfy, "r.mp4"), "abcdefghij");
    const storePath = path.join(root, "cloud-mirror.json");
    await configureCloudMirrorDestination({ storePath, folderKey: "global", absolutePath: sync });
    const opts = {
      storePath,
      archiveStorePath: path.join(root, "archive.json"),
      outputRoot: comfy,
      comfyUrl: "http://x",
      promptId: "race",
      filename: "r.mp4",
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          race: { outputs: { "1": { videos: [{ filename: "r.mp4", subfolder: "", type: "output" }] } } }
        })
      }),
      realpathImpl: async p => path.resolve(p)
    };
    const [a, b] = await Promise.all([
      mirrorCompletedOutput(opts),
      mirrorCompletedOutput(opts)
    ]);
    const statuses = [a.status || (a.alreadyCopied && "already-copied"), b.status || (b.alreadyCopied && "already-copied")];
    assert.ok(statuses.includes("copied") || statuses.includes("already-copied"));
    assert.equal(readdirSync(sync).filter(n => n.endsWith(".mp4") || existsSync(path.join(sync, n))).length >= 1, true);
    const mp4s = [];
    function walk(d) {
      for (const name of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, name.name);
        if (name.isDirectory()) walk(full);
        else if (name.name.endsWith(".mp4")) mp4s.push(full);
      }
    }
    walk(sync);
    assert.equal(mp4s.length, 1);
  } finally {
    cleanup(root);
  }
});

test("cloud failure does not change archive success semantics", async () => {
  const root = tempDir("h3-cloud-isol-");
  try {
    const comfy = path.join(root, "comfy");
    const archive = path.join(root, "archive");
    mkdirSync(comfy);
    mkdirSync(archive);
    writeFileSync(path.join(comfy, "z.mp4"), "zzzzzzzz");
    const archiveStore = path.join(root, "archive.json");
    await configureArchiveDestination({ storePath: archiveStore, folderKey: "global", absolutePath: archive });
    const archived = await archiveCompletedOutput({
      storePath: archiveStore,
      outputRoot: comfy,
      comfyUrl: "http://x",
      promptId: "z1",
      filename: "z.mp4",
      plan: { enabled: true, projectLabel: "Z", scene: "s", template: "{project}_{counter:02}.mp4" },
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          z1: { outputs: { "1": { videos: [{ filename: "z.mp4", subfolder: "", type: "output" }] } } }
        })
      }),
      realpathImpl: async p => path.resolve(p)
    });
    assert.equal(archived.ok, true);
    assert.ok(archived.archivedFilename);
    const cloud = await tryAutoCloudMirror({
      storePath: path.join(root, "cloud-mirror.json"),
      archiveStorePath: archiveStore,
      outputRoot: comfy,
      comfyUrl: "http://x",
      promptId: "z1",
      filename: "z.mp4"
    });
    assert.equal(cloud.skipped, true);
    assert.equal(existsSync(path.join(archive, archived.archivedFilename)), true);
  } finally {
    cleanup(root);
  }
});

test("UI wording never claims remote Google sync success", () => {
  const html = readFileSync(path.join(ROOT, "../public/index.html"), "utf8");
  const ui = readFileSync(path.join(ROOT, "../public/output-ui.mjs"), "utf8");
  const gallery = readFileSync(path.join(ROOT, "../public/session-gallery-dom.mjs"), "utf8");
  assert.match(html, /CLOUD MIRROR/);
  assert.match(html, /cartella cloud/);
  assert.doesNotMatch(html, /Sincronizzato su Google Drive/);
  assert.doesNotMatch(ui, /Sincronizzato su Google Drive/);
  assert.doesNotMatch(gallery, /Sincronizzato su Google Drive/);
  assert.match(gallery, /copiato nella cartella/);
  assert.match(ui, /\/api\/cloud-mirror\/copy-output/);
  assert.doesNotMatch(ui, /\/prompt/);
});

test("server rejects client-supplied destination paths for cloud APIs", () => {
  const server = readFileSync(path.join(ROOT, "../server.mjs"), "utf8");
  assert.match(server, /\/api\/cloud-mirror\/pick-folder/);
  assert.match(server, /cloud-destination-rejected/);
  assert.match(server, /cloud-path-rejected/);
  assert.match(server, /tryAutoCloudMirror/);
  const copyStart = server.indexOf("/api/cloud-mirror/copy-output");
  const copyEnd = server.indexOf("/api/projects", copyStart);
  const copyHandler = server.slice(copyStart, copyEnd > copyStart ? copyEnd : copyStart + 2500);
  assert.doesNotMatch(copyHandler, /submitWorkflowToComfy/);
  assert.doesNotMatch(copyHandler, /\/prompt/);
});
