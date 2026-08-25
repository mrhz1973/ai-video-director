import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  statSync
} from "node:fs";
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
  readCloudMirrorStore,
  updateCloudMirrorStore
} from "../lib/cloud-mirror-store.mjs";
import {
  allocateCloudMirrorFilename,
  configureCloudMirrorDestination,
  ensureCloudProjectDirectory,
  mirrorCompletedOutput,
  tryAutoCloudMirror,
  updateCloudMirrorSettings
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

function historyFetch(promptId, filename) {
  return async () => ({
    ok: true,
    json: async () => ({
      [promptId]: {
        outputs: {
          "1": { videos: [{ filename, subfolder: "", type: "output" }] }
        }
      }
    })
  });
}

function listMp4(dir) {
  const out = [];
  function walk(d) {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.name.endsWith(".mp4")) out.push(full);
    }
  }
  walk(dir);
  return out;
}

function listTmpArtifacts(dir) {
  const out = [];
  function walk(d) {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.name.includes(".tmp") || name.name.endsWith(".tmp")) out.push(full);
    }
  }
  walk(dir);
  return out;
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

test("configure rejects unwritable destination with stable code", async () => {
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
        accessImpl: async () => {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        }
      }),
      error => error?.code === "cloud-destination-unavailable"
    );
    assert.equal(existsSync(storePath), false);
  } finally {
    cleanup(dir);
  }
});

test("configure rejects regular file destination (must be directory)", async () => {
  const dir = tempDir("h3-cloud-filedest-");
  try {
    const storePath = path.join(dir, "cloud-mirror.json");
    const filePath = path.join(dir, "not-a-dir.txt");
    writeFileSync(filePath, "nope");
    await assert.rejects(
      () => configureCloudMirrorDestination({
        storePath,
        folderKey: "global",
        absolutePath: filePath
      }),
      error => error?.code === "cloud-path-invalid"
    );
    assert.equal(existsSync(storePath), false);
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

test("first project-subdir copy succeeds with REAL fs.realpath", async () => {
  const root = tempDir("h3-cloud-firstproj-");
  try {
    const comfy = path.join(root, "comfy");
    const sync = path.join(root, "sync");
    mkdirSync(comfy);
    mkdirSync(sync);
    const sourcePath = path.join(comfy, "clip.mp4");
    writeFileSync(sourcePath, Buffer.from("first-project-bytes"));
    const storePath = path.join(root, "cloud-mirror.json");
    await configureCloudMirrorDestination({ storePath, folderKey: "global", absolutePath: sync });

    const projectDir = path.join(sync, "FirstProj");
    assert.equal(existsSync(projectDir), false);

    // Intentionally use default realpathImpl (real filesystem).
    const result = await mirrorCompletedOutput({
      storePath,
      archiveStorePath: path.join(root, "archive.json"),
      outputRoot: comfy,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "p-first",
      filename: "clip.mp4",
      projectId: "first",
      projectLabel: "FirstProj",
      fetchFn: historyFetch("p-first", "clip.mp4")
    });

    assert.equal(result.status, "copied");
    assert.equal(existsSync(projectDir), true);
    assert.equal(statSync(projectDir).isDirectory(), true);
    const destFile = path.join(projectDir, result.destinationFilename);
    assert.equal(existsSync(destFile), true);
    assert.equal(existsSync(sourcePath), true);
    assert.equal(readFileSync(destFile).equals(readFileSync(sourcePath)), true);
    assert.equal(listTmpArtifacts(sync).length, 0);
  } finally {
    cleanup(root);
  }
});

test("ensureCloudProjectDirectory creates missing subdir under containment", async () => {
  const root = tempDir("h3-cloud-ensure-");
  try {
    const sync = path.join(root, "sync");
    mkdirSync(sync);
    const created = await ensureCloudProjectDirectory({
      destinationRoot: sync,
      projectSubdir: "BrandNew"
    });
    assert.equal(existsSync(path.join(sync, "BrandNew")), true);
    assert.ok(created.realDir.includes("BrandNew"));
  } finally {
    cleanup(root);
  }
});

test("successful copy preserves source and verifies size; no orphan temps", async () => {
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
    await updateCloudMirrorStore(storePath, s => setCloudMirrorEnabled(s, true));

    const result = await mirrorCompletedOutput({
      storePath,
      archiveStorePath: path.join(root, "archive.json"),
      outputRoot: comfy,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "p1",
      filename: "clip.mp4",
      projectId: "demo",
      projectLabel: "Demo",
      fetchFn: historyFetch("p1", "clip.mp4")
    });

    assert.equal(result.status, "copied");
    assert.equal(existsSync(sourcePath), true);
    const destFile = path.join(sync, "Demo", result.destinationFilename);
    assert.equal(existsSync(destFile), true);
    assert.equal(readFileSync(destFile).equals(readFileSync(sourcePath)), true);
    assert.equal(listTmpArtifacts(root).length, 0);
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
      plan: {
        enabled: true,
        projectId: "p",
        projectLabel: "Proj",
        scene: "shot",
        template: "{project}_{scene}_{counter:04}.mp4"
      },
      fetchFn: historyFetch("p2", "raw.mp4")
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
      projectLabel: "Proj"
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
    const opts = {
      storePath,
      archiveStorePath: path.join(root, "archive.json"),
      outputRoot: comfy,
      comfyUrl: "http://x",
      promptId: "px",
      filename: "a.mp4",
      fetchFn: historyFetch("px", "a.mp4")
    };
    const first = await mirrorCompletedOutput(opts);
    const second = await mirrorCompletedOutput(opts);
    assert.equal(first.status, "copied");
    assert.equal(second.alreadyCopied, true);
    assert.equal(listMp4(sync).length, 1);
  } finally {
    cleanup(root);
  }
});

test("two different records concurrent — both records survive", async () => {
  const root = tempDir("h3-cloud-race2-");
  try {
    const comfy = path.join(root, "comfy");
    const sync = path.join(root, "sync");
    mkdirSync(comfy);
    mkdirSync(sync);
    writeFileSync(path.join(comfy, "clipA.mp4"), "AAAAAAAA");
    writeFileSync(path.join(comfy, "clipB.mp4"), "BBBBBBBB");
    const storePath = path.join(root, "cloud-mirror.json");
    await configureCloudMirrorDestination({ storePath, folderKey: "global", absolutePath: sync });

    const [a, b] = await Promise.all([
      mirrorCompletedOutput({
        storePath,
        archiveStorePath: path.join(root, "archive.json"),
        outputRoot: comfy,
        comfyUrl: "http://x",
        promptId: "p1",
        filename: "clipA.mp4",
        projectLabel: "Race",
        fetchFn: historyFetch("p1", "clipA.mp4")
      }),
      mirrorCompletedOutput({
        storePath,
        archiveStorePath: path.join(root, "archive.json"),
        outputRoot: comfy,
        comfyUrl: "http://x",
        promptId: "p2",
        filename: "clipB.mp4",
        projectLabel: "Race",
        fetchFn: historyFetch("p2", "clipB.mp4")
      })
    ]);

    assert.equal(a.status, "copied");
    assert.equal(b.status, "copied");
    assert.equal(existsSync(path.join(comfy, "clipA.mp4")), true);
    assert.equal(existsSync(path.join(comfy, "clipB.mp4")), true);

    const store = await readCloudMirrorStore(storePath);
    const keyA = cloudMirrorRecordKey("p1", "clipA.mp4", "", "global");
    const keyB = cloudMirrorRecordKey("p2", "clipB.mp4", "", "global");
    assert.ok(store.records[keyA], "record A must survive");
    assert.ok(store.records[keyB], "record B must survive");
    assert.equal(listMp4(sync).length, 2);
    assert.equal(listTmpArtifacts(root).length, 0);
  } finally {
    cleanup(root);
  }
});

test("concurrent copies with SAME preferred filename never overwrite", async () => {
  const root = tempDir("h3-cloud-same-name-");
  try {
    const comfy = path.join(root, "comfy");
    const sync = path.join(root, "sync");
    mkdirSync(comfy);
    mkdirSync(sync);
    // Distinct Comfy source names that archive/mirror prefer as-is from source.preferredName.
    // Force same preferredName by using identical source filenames in different folders? 
    // Simpler: two prompts with same filename "clip.mp4" in same output root can't coexist;
    // instead write one file and use preferred via archive, OR place files with same name
    // using subfolders. Use subfolder identity.
    mkdirSync(path.join(comfy, "a"));
    mkdirSync(path.join(comfy, "b"));
    writeFileSync(path.join(comfy, "a", "clip.mp4"), "AAAA1111");
    writeFileSync(path.join(comfy, "b", "clip.mp4"), "BBBB2222");
    const storePath = path.join(root, "cloud-mirror.json");
    await configureCloudMirrorDestination({ storePath, folderKey: "global", absolutePath: sync });

    const fetchA = async () => ({
      ok: true,
      json: async () => ({
        pa: { outputs: { "1": { videos: [{ filename: "clip.mp4", subfolder: "a", type: "output" }] } } }
      })
    });
    const fetchB = async () => ({
      ok: true,
      json: async () => ({
        pb: { outputs: { "1": { videos: [{ filename: "clip.mp4", subfolder: "b", type: "output" }] } } }
      })
    });

    const [a, b] = await Promise.all([
      mirrorCompletedOutput({
        storePath,
        archiveStorePath: path.join(root, "archive.json"),
        outputRoot: comfy,
        comfyUrl: "http://x",
        promptId: "pa",
        filename: "clip.mp4",
        subfolder: "a",
        fetchFn: fetchA
      }),
      mirrorCompletedOutput({
        storePath,
        archiveStorePath: path.join(root, "archive.json"),
        outputRoot: comfy,
        comfyUrl: "http://x",
        promptId: "pb",
        filename: "clip.mp4",
        subfolder: "b",
        fetchFn: fetchB
      })
    ]);

    assert.equal(a.status, "copied");
    assert.equal(b.status, "copied");
    const names = [a.destinationFilename, b.destinationFilename].sort();
    assert.deepEqual(names, ["clip.mp4", "clip_0002.mp4"]);
    assert.equal(listMp4(sync).length, 2);
    const bytes = listMp4(sync).map(p => readFileSync(p).toString()).sort();
    assert.deepEqual(bytes, ["AAAA1111", "BBBB2222"]);
    const store = await readCloudMirrorStore(storePath);
    assert.equal(Object.keys(store.records).length, 2);
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
    assert.ok(auto.skipped || auto.status === "not-configured" || auto.status === "failed");
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
      fetchFn: historyFetch("z1", "z.mp4")
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

test("settings: non-boolean enabled rejected; boolean false accepted", async () => {
  const dir = tempDir("h3-cloud-settings-");
  try {
    const storePath = path.join(dir, "cloud-mirror.json");
    await writeCloudMirrorStore(storePath, emptyCloudMirrorStore());
    await assert.rejects(
      () => updateCloudMirrorSettings({ storePath, enabled: "false" }),
      error => error?.code === "cloud-settings-invalid"
    );
    const view = await updateCloudMirrorSettings({ storePath, enabled: false });
    assert.equal(view.enabled, false);
    const store = await readCloudMirrorStore(storePath);
    assert.equal(store.enabled, false);
  } finally {
    cleanup(dir);
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
  const settingsLib = readFileSync(path.join(ROOT, "../lib/cloud-mirror.mjs"), "utf8");
  assert.match(settingsLib, /cloud-settings-invalid/);
  const copyStart = server.indexOf("/api/cloud-mirror/copy-output");
  const copyEnd = server.indexOf("/api/projects", copyStart);
  const copyHandler = server.slice(copyStart, copyEnd > copyStart ? copyEnd : copyStart + 2500);
  assert.doesNotMatch(copyHandler, /submitWorkflowToComfy/);
  assert.doesNotMatch(copyHandler, /\/prompt/);
});
