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
  getCloudMirrorEnabled,
  setCloudMirrorEnabled,
  hasCloudMirrorEnabledOverride,
  normalizePersistedCloudFolderKey,
  assertCloudDirectoryWritable,
  isAbsoluteCloudDestinationPath,
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
  cloudMirrorReservedFinalPathCount,
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
import { copyFile } from "node:fs/promises";
import { ComfyOutputPathError } from "../lib/comfy-output-path.mjs";

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
    assert.deepEqual(store.enabled, { global: false });
    assert.equal(getCloudMirrorEnabled(store, "global"), false);
    assert.deepEqual(store.destinations, {});
    assert.equal(publicCloudMirrorView(store).configured, false);
    assert.equal(publicCloudMirrorView(store).enabled, false);
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

test("scoped enabled: inherit / override / views", () => {
  let store = emptyCloudMirrorStore();
  store = setCloudMirrorEnabled(store, "global", true);
  assert.equal(getCloudMirrorEnabled(store, "global"), true);
  assert.equal(getCloudMirrorEnabled(store, "project:martino"), true);
  assert.equal(hasCloudMirrorEnabledOverride(store, "project:martino"), false);
  assert.equal(publicCloudMirrorView(store, "global").enabled, true);
  assert.equal(publicCloudMirrorView(store, "project:martino").enabled, true);
  assert.equal(publicCloudMirrorView(store, "project:martino").enabledInherited, true);

  store = setCloudMirrorEnabled(store, "project:martino", false);
  assert.equal(getCloudMirrorEnabled(store, "global"), true);
  assert.equal(getCloudMirrorEnabled(store, "project:martino"), false);
  assert.equal(publicCloudMirrorView(store, "project:martino").enabled, false);
  assert.equal(publicCloudMirrorView(store, "project:martino").enabledInherited, false);

  store = setCloudMirrorEnabled(emptyCloudMirrorStore(), "global", false);
  store = setCloudMirrorEnabled(store, "project:b", true);
  assert.equal(getCloudMirrorEnabled(store, "global"), false);
  assert.equal(getCloudMirrorEnabled(store, "project:b"), true);
  assert.equal(publicCloudMirrorView(store, "project:b").enabled, true);
});

test("project toggle leaves global unchanged; global toggle leaves project override", () => {
  let store = setCloudMirrorEnabled(emptyCloudMirrorStore(), "global", true);
  store = setCloudMirrorEnabled(store, "project:a", true);
  assert.equal(store.enabled.global, true);
  store = setCloudMirrorEnabled(store, "project:a", false);
  assert.equal(store.enabled.global, true);
  assert.equal(store.enabled["project:a"], false);

  store = setCloudMirrorEnabled(store, "project:a", true);
  assert.equal(store.enabled.global, true);
  store = setCloudMirrorEnabled(store, "global", false);
  assert.equal(store.enabled.global, false);
  assert.equal(store.enabled["project:a"], true);
  assert.equal(getCloudMirrorEnabled(store, "project:a"), true);
});

test("malformed store enabled fail-closed + legacy scalar migration", () => {
  assert.deepEqual(normalizeCloudMirrorStore({ enabled: "false" }).enabled, { global: false });
  assert.deepEqual(normalizeCloudMirrorStore({ enabled: "yes" }).enabled, { global: false });
  assert.deepEqual(normalizeCloudMirrorStore({ enabled: 1 }).enabled, { global: false });
  assert.deepEqual(normalizeCloudMirrorStore({ enabled: true }).enabled, { global: true });
  assert.deepEqual(normalizeCloudMirrorStore({ enabled: false }).enabled, { global: false });
  assert.equal(getCloudMirrorEnabled(normalizeCloudMirrorStore({ enabled: true }), "global"), true);
  assert.equal(getCloudMirrorEnabled(normalizeCloudMirrorStore({ enabled: false }), "global"), false);
  const store = normalizeCloudMirrorStore({
    enabled: "yes",
    destinations: { "project:../x": "bad", global: "C:\\ok", junk: "" },
    records: { k: { destinationFilename: "a.mp4", bytes: "12" } }
  });
  assert.deepEqual(store.enabled, { global: false });
  assert.equal(store.destinations.global, "C:\\ok");
  assert.equal(store.destinations["project:../x"], undefined);
  assert.equal(store.records.k.bytes, 12);
  assert.equal(getCloudMirrorEnabled(setCloudMirrorEnabled(emptyCloudMirrorStore(), "global", "yes"), "global"), false);
  assert.equal(getCloudMirrorEnabled(setCloudMirrorEnabled(emptyCloudMirrorStore(), "global", true), "global"), true);
});

test("persisted invalid folder keys never become global (enabled + destinations)", () => {
  assert.equal(normalizePersistedCloudFolderKey("junk"), null);
  assert.equal(normalizePersistedCloudFolderKey("project:../x"), null);
  assert.equal(normalizePersistedCloudFolderKey("project:a/b"), null);
  assert.equal(normalizePersistedCloudFolderKey("project:a\\b"), null);
  assert.equal(normalizePersistedCloudFolderKey("global"), "global");
  assert.equal(normalizePersistedCloudFolderKey("project:good"), "project:good");

  // 1–2: junk / invalid project enabled ignored
  assert.deepEqual(normalizeCloudMirrorStore({ enabled: { junk: true } }).enabled, { global: false });
  assert.deepEqual(
    normalizeCloudMirrorStore({ enabled: { "project:../x": true } }).enabled,
    { global: false }
  );

  // 3–4: property-order independence with global false
  assert.deepEqual(
    normalizeCloudMirrorStore({
      enabled: { global: false, "project:../x": true }
    }).enabled,
    { global: false }
  );
  assert.deepEqual(
    normalizeCloudMirrorStore({
      enabled: { "project:../x": true, global: false }
    }).enabled,
    { global: false }
  );

  // 5: valid project preserved
  const good = normalizeCloudMirrorStore({ enabled: { "project:good": true } });
  assert.equal(good.enabled.global, false);
  assert.equal(good.enabled["project:good"], true);
  assert.equal(getCloudMirrorEnabled(good, "project:good"), true);

  // 6: invalid project must not clear / overwrite global true
  assert.deepEqual(
    normalizeCloudMirrorStore({
      enabled: { global: true, "project:../x": false }
    }).enabled,
    { global: true }
  );
  assert.deepEqual(
    normalizeCloudMirrorStore({
      enabled: { "project:../x": false, global: true }
    }).enabled,
    { global: true }
  );

  // 7–8: invalid destination cannot overwrite global (order-independent)
  const destA = normalizeCloudMirrorStore({
    destinations: { global: "G:\\Good", "project:../x": "D:\\Bad" }
  });
  const destB = normalizeCloudMirrorStore({
    destinations: { "project:../x": "D:\\Bad", global: "G:\\Good" }
  });
  assert.equal(destA.destinations.global, "G:\\Good");
  assert.equal(destB.destinations.global, "G:\\Good");
  assert.equal(destA.destinations["project:../x"], undefined);
  assert.equal(destB.destinations["project:../x"], undefined);

  // 9: junk destination creates no global
  const junkDest = normalizeCloudMirrorStore({ destinations: { junk: "D:\\Bad" } });
  assert.deepEqual(junkDest.destinations, {});
  assert.equal(getCloudMirrorDestination(junkDest, "global"), null);

  // 10: valid project destination remains
  const projDest = normalizeCloudMirrorStore({
    destinations: { "project:martino": "G:\\Martino", global: "G:\\Good" }
  });
  assert.equal(projDest.destinations.global, "G:\\Good");
  assert.equal(projDest.destinations["project:martino"], "G:\\Martino");
  assert.equal(getCloudMirrorDestination(projDest, "project:martino"), "G:\\Martino");
});

test("relative cloud destinations fail closed (runtime + persisted)", async () => {
  const dir = tempDir("h3-cloud-relpath-");
  try {
    await assert.rejects(
      () => assertCloudDirectoryWritable("."),
      error => error instanceof ComfyOutputPathError && error.code === "cloud-path-invalid"
    );
    await assert.rejects(
      () => assertCloudDirectoryWritable("relative-folder"),
      error => error instanceof ComfyOutputPathError && error.code === "cloud-path-invalid"
    );
    await assert.rejects(
      () => assertCloudDirectoryWritable("..\\sync"),
      error => error instanceof ComfyOutputPathError && error.code === "cloud-path-invalid"
    );
    assert.equal(isAbsoluteCloudDestinationPath("."), false);
    assert.equal(isAbsoluteCloudDestinationPath("cloud"), false);
    assert.equal(isAbsoluteCloudDestinationPath("..\\sync"), false);
    assert.equal(isAbsoluteCloudDestinationPath("G:\\Good"), true);
    assert.equal(isAbsoluteCloudDestinationPath("C:/ok"), true);

    const abs = path.join(dir, "sync");
    mkdirSync(abs);
    const resolved = await assertCloudDirectoryWritable(abs);
    assert.equal(path.isAbsolute(resolved), true);
    assert.equal(resolved, path.resolve(abs));

    const cwd = process.cwd();
    const ignoredDot = normalizeCloudMirrorStore({ destinations: { global: "." } });
    assert.deepEqual(ignoredDot.destinations, {});
    assert.equal(publicCloudMirrorView(ignoredDot, "global").configured, false);
    assert.equal(process.cwd(), cwd);

    const ignoredRelProj = normalizeCloudMirrorStore({
      destinations: { "project:martino": "cloud", global: abs }
    });
    assert.equal(ignoredRelProj.destinations["project:martino"], undefined);
    assert.equal(ignoredRelProj.destinations.global, abs);

    const keptAbs = normalizeCloudMirrorStore({
      destinations: { global: abs, "project:ok": path.join(dir, "proj") }
    });
    assert.equal(keptAbs.destinations.global, abs);
    assert.equal(keptAbs.destinations["project:ok"], path.join(dir, "proj"));
  } finally {
    cleanup(dir);
  }
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
    await updateCloudMirrorStore(storePath, s => setCloudMirrorEnabled(s, "global", true));

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

    const seenFinalsDuringCopy = [];
    const trackingCopy = async (src, dest) => {
      const finals = [path.join(sync, "clip.mp4"), path.join(sync, "clip_0002.mp4")];
      seenFinalsDuringCopy.push(finals.map(p => existsSync(p)));
      await copyFile(src, dest);
    };

    const [a, b] = await Promise.all([
      mirrorCompletedOutput({
        storePath,
        archiveStorePath: path.join(root, "archive.json"),
        outputRoot: comfy,
        comfyUrl: "http://x",
        promptId: "pa",
        filename: "clip.mp4",
        subfolder: "a",
        fetchFn: fetchA,
        copyFileImpl: trackingCopy
      }),
      mirrorCompletedOutput({
        storePath,
        archiveStorePath: path.join(root, "archive.json"),
        outputRoot: comfy,
        comfyUrl: "http://x",
        promptId: "pb",
        filename: "clip.mp4",
        subfolder: "b",
        fetchFn: fetchB,
        copyFileImpl: trackingCopy
      })
    ]);

    assert.equal(a.status, "copied");
    assert.equal(b.status, "copied");
    const names = [a.destinationFilename, b.destinationFilename].sort();
    assert.deepEqual(names, ["clip.mp4", "clip_0002.mp4"]);
    assert.equal(listMp4(sync).length, 2);
    const bytes = listMp4(sync).map(p => readFileSync(p).toString()).sort();
    assert.deepEqual(bytes, ["AAAA1111", "BBBB2222"]);
    // During each temp copy, neither final preferred name must already be present
    // as a completed rename of the *other* colliding allocation race — at least
    // one snapshot must show both finals absent (pre-rename window).
    assert.ok(seenFinalsDuringCopy.length >= 2);
    assert.ok(
      seenFinalsDuringCopy.some(([clip, clip2]) => clip === false && clip2 === false),
      "expected a pre-rename window with no final placeholders"
    );
    const store = await readCloudMirrorStore(storePath);
    assert.equal(Object.keys(store.records).length, 2);
    assert.equal(listTmpArtifacts(root).length, 0);
    assert.equal(cloudMirrorReservedFinalPathCount(), 0);
  } finally {
    cleanup(root);
  }
});

test("final cloud path absent until verified rename (delayed copy)", async () => {
  const root = tempDir("h3-cloud-delayed-");
  try {
    const comfy = path.join(root, "comfy");
    const sync = path.join(root, "sync");
    mkdirSync(comfy);
    mkdirSync(sync);
    const payload = Buffer.from("DELAYED-COPY-BYTES-OK");
    writeFileSync(path.join(comfy, "clip.mp4"), payload);
    const storePath = path.join(root, "cloud-mirror.json");
    await configureCloudMirrorDestination({ storePath, folderKey: "global", absolutePath: sync });

    const finalPath = path.join(sync, "Demo", "clip.mp4");
    let releaseCopy;
    const copyGate = new Promise(resolve => {
      releaseCopy = resolve;
    });
    let paused = false;
    const delayedCopy = async (src, dest) => {
      paused = true;
      assert.equal(existsSync(finalPath), false);
      await copyGate;
      assert.equal(existsSync(finalPath), false);
      await copyFile(src, dest);
    };

    const pending = mirrorCompletedOutput({
      storePath,
      archiveStorePath: path.join(root, "archive.json"),
      outputRoot: comfy,
      comfyUrl: "http://x",
      promptId: "delay1",
      filename: "clip.mp4",
      projectLabel: "Demo",
      fetchFn: historyFetch("delay1", "clip.mp4"),
      copyFileImpl: delayedCopy
    });

    while (!paused) {
      await new Promise(r => setTimeout(r, 5));
    }
    assert.equal(existsSync(finalPath), false);
    assert.ok(cloudMirrorReservedFinalPathCount() >= 1);
    // No zero-byte final placeholder; temps may appear only after copy resumes.
    assert.equal(existsSync(finalPath), false);
    releaseCopy();
    const result = await pending;
    assert.equal(result.status, "copied");
    assert.equal(existsSync(finalPath), true);
    assert.equal(statSync(finalPath).size, payload.length);
    assert.equal(readFileSync(finalPath).equals(payload), true);
    assert.equal(listTmpArtifacts(root).length, 0);
    assert.equal(cloudMirrorReservedFinalPathCount(), 0);
  } finally {
    cleanup(root);
  }
});

test("missing destination -> clean failure; auto does not throw", async () => {
  const root = tempDir("h3-cloud-missdest-");
  try {
    const storePath = path.join(root, "cloud-mirror.json");
    await writeCloudMirrorStore(storePath, setCloudMirrorEnabled(emptyCloudMirrorStore(), "global", true));
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
    store = setCloudMirrorEnabled(store, "global", true);
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

/**
 * Deterministic race proof:
 * When archive+cloud are both enabled, the coordinated path is
 * archiveCompletedOutput → tryAutoCloudMirror (as POST /api/archive-output).
 * Independent cloud-first would lock comfy-output; coordinated path must win
 * with local-archive + Director filename.
 */
test("archive+cloud coordinated path: sourceKind local-archive + Director filename", async () => {
  const root = tempDir("h3-cloud-race-coord-");
  try {
    const comfy = path.join(root, "comfy");
    const archive = path.join(root, "archive");
    const sync = path.join(root, "sync");
    mkdirSync(comfy);
    mkdirSync(archive);
    mkdirSync(sync);
    writeFileSync(path.join(comfy, "MiniMax_H3_00123_.mp4"), Buffer.from("COMFYBYTES"));
    const archiveStore = path.join(root, "archive.json");
    const cloudStore = path.join(root, "cloud-mirror.json");
    await configureArchiveDestination({ storePath: archiveStore, folderKey: "global", absolutePath: archive });
    await configureCloudMirrorDestination({ storePath: cloudStore, folderKey: "global", absolutePath: sync });
    await updateCloudMirrorSettings({ storePath: cloudStore, enabled: true });

    const plan = {
      enabled: true,
      projectId: "martino",
      projectLabel: "Martino",
      scene: "S01",
      template: "Martino_S01_I2V_Q8_{counter:04}"
    };

    // Cloud would otherwise be able to run first; coordinated path archives first.
    const archived = await archiveCompletedOutput({
      storePath: archiveStore,
      outputRoot: comfy,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "race1",
      filename: "MiniMax_H3_00123_.mp4",
      plan,
      fetchFn: historyFetch("race1", "MiniMax_H3_00123_.mp4")
    });
    assert.equal(archived.ok, true);
    assert.match(archived.archivedFilename, /^Martino_S01_I2V_Q8_\d{4}\.mp4$/);

    const mirrored = await tryAutoCloudMirror({
      storePath: cloudStore,
      archiveStorePath: archiveStore,
      outputRoot: comfy,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "race1",
      filename: "MiniMax_H3_00123_.mp4",
      projectLabel: "Martino",
      fetchFn: historyFetch("race1", "MiniMax_H3_00123_.mp4")
    });

    assert.equal(mirrored.ok, true);
    assert.equal(mirrored.sourceKind, "local-archive");
    assert.equal(mirrored.destinationFilename, archived.archivedFilename);
    assert.notEqual(mirrored.destinationFilename, "MiniMax_H3_00123_.mp4");
    const dest = path.join(sync, "Martino", mirrored.destinationFilename);
    assert.equal(existsSync(dest), true);
    assert.equal(readFileSync(dest).equals(Buffer.from("COMFYBYTES")), true);
  } finally {
    cleanup(root);
  }
});

test("archive+cloud race hazard: cloud-first locks comfy-output (why UI must not race)", async () => {
  const root = tempDir("h3-cloud-race-hazard-");
  try {
    const comfy = path.join(root, "comfy");
    const archive = path.join(root, "archive");
    const sync = path.join(root, "sync");
    mkdirSync(comfy);
    mkdirSync(archive);
    mkdirSync(sync);
    writeFileSync(path.join(comfy, "MiniMax_H3_00123_.mp4"), Buffer.from("COMFYBYTES"));
    const archiveStore = path.join(root, "archive.json");
    const cloudStore = path.join(root, "cloud-mirror.json");
    await configureArchiveDestination({ storePath: archiveStore, folderKey: "global", absolutePath: archive });
    await configureCloudMirrorDestination({ storePath: cloudStore, folderKey: "global", absolutePath: sync });
    await updateCloudMirrorSettings({ storePath: cloudStore, enabled: true });

    // Independent cloud wins first (the old buggy browser race).
    const early = await mirrorCompletedOutput({
      storePath: cloudStore,
      archiveStorePath: archiveStore,
      outputRoot: comfy,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "race2",
      filename: "MiniMax_H3_00123_.mp4",
      projectLabel: "Martino",
      fetchFn: historyFetch("race2", "MiniMax_H3_00123_.mp4")
    });
    assert.equal(early.sourceKind, "comfy-output");
    assert.equal(early.destinationFilename, "MiniMax_H3_00123_.mp4");

    const archived = await archiveCompletedOutput({
      storePath: archiveStore,
      outputRoot: comfy,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "race2",
      filename: "MiniMax_H3_00123_.mp4",
      plan: {
        enabled: true,
        projectLabel: "Martino",
        scene: "S01",
        template: "Martino_S01_I2V_Q8_{counter:04}"
      },
      fetchFn: historyFetch("race2", "MiniMax_H3_00123_.mp4")
    });
    assert.ok(archived.archivedFilename);
    assert.notEqual(archived.archivedFilename, "MiniMax_H3_00123_.mp4");

    // Later cloud via archive endpoint cannot upgrade: idempotence sees existing record.
    const late = await tryAutoCloudMirror({
      storePath: cloudStore,
      archiveStorePath: archiveStore,
      outputRoot: comfy,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "race2",
      filename: "MiniMax_H3_00123_.mp4",
      projectLabel: "Martino",
      fetchFn: historyFetch("race2", "MiniMax_H3_00123_.mp4")
    });
    assert.equal(late.alreadyCopied, true);
    assert.equal(late.sourceKind, "comfy-output");
    assert.equal(late.destinationFilename, "MiniMax_H3_00123_.mp4");
  } finally {
    cleanup(root);
  }
});

test("archive disabled: cloud copies from authoritative comfy-output", async () => {
  const root = tempDir("h3-cloud-arch-off-");
  try {
    const comfy = path.join(root, "comfy");
    const sync = path.join(root, "sync");
    mkdirSync(comfy);
    mkdirSync(sync);
    writeFileSync(path.join(comfy, "MiniMax_H3_00999_.mp4"), Buffer.from("DIRECTCOM"));
    const cloudStore = path.join(root, "cloud-mirror.json");
    await configureCloudMirrorDestination({ storePath: cloudStore, folderKey: "global", absolutePath: sync });
    await updateCloudMirrorSettings({ storePath: cloudStore, enabled: true });

    const mirrored = await tryAutoCloudMirror({
      storePath: cloudStore,
      archiveStorePath: path.join(root, "archive-missing.json"),
      outputRoot: comfy,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "off1",
      filename: "MiniMax_H3_00999_.mp4",
      projectLabel: "Demo",
      fetchFn: historyFetch("off1", "MiniMax_H3_00999_.mp4")
    });
    assert.equal(mirrored.ok, true);
    assert.equal(mirrored.sourceKind, "comfy-output");
    assert.equal(mirrored.destinationFilename, "MiniMax_H3_00999_.mp4");
  } finally {
    cleanup(root);
  }
});

test("archive unavailable/failure: cloud fallback from comfy allowed; archive failure isolated", async () => {
  const root = tempDir("h3-cloud-arch-fail-");
  try {
    const comfy = path.join(root, "comfy");
    const sync = path.join(root, "sync");
    mkdirSync(comfy);
    mkdirSync(sync);
    writeFileSync(path.join(comfy, "fallback.mp4"), Buffer.from("FALLBACK1"));
    const cloudStore = path.join(root, "cloud-mirror.json");
    await configureCloudMirrorDestination({ storePath: cloudStore, folderKey: "global", absolutePath: sync });
    await updateCloudMirrorSettings({ storePath: cloudStore, enabled: true });

    // Archive intentionally unconfigured — mirror must still succeed from Comfy.
    const mirrored = await tryAutoCloudMirror({
      storePath: cloudStore,
      archiveStorePath: path.join(root, "no-archive.json"),
      outputRoot: comfy,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "fb1",
      filename: "fallback.mp4",
      projectLabel: "Demo",
      fetchFn: historyFetch("fb1", "fallback.mp4")
    });
    assert.equal(mirrored.ok, true);
    assert.equal(mirrored.sourceKind, "comfy-output");
    assert.equal(existsSync(path.join(sync, "Demo", "fallback.mp4")), true);

    // Archive failure must not throw into cloud path / wipe comfy source.
    await assert.rejects(
      () => archiveCompletedOutput({
        storePath: path.join(root, "no-archive.json"),
        outputRoot: comfy,
        comfyUrl: "http://127.0.0.1:9",
        promptId: "fb1",
        filename: "fallback.mp4",
        plan: { enabled: true, projectLabel: "Demo", scene: "s", template: "{project}_{counter:02}.mp4" },
        fetchFn: historyFetch("fb1", "fallback.mp4")
      }),
      error => error?.code === "archive-unconfigured" || error?.status === 409
    );
    assert.equal(existsSync(path.join(comfy, "fallback.mp4")), true);
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
    const view = await updateCloudMirrorSettings({ storePath, folderKey: "global", enabled: false });
    assert.equal(view.enabled, false);
    const store = await readCloudMirrorStore(storePath);
    assert.equal(store.enabled.global, false);
  } finally {
    cleanup(dir);
  }
});

test("settings persist against requested folderKey; project does not mutate global", async () => {
  const dir = tempDir("h3-cloud-settings-scope-");
  try {
    const storePath = path.join(dir, "cloud-mirror.json");
    await writeCloudMirrorStore(storePath, emptyCloudMirrorStore());
    await updateCloudMirrorSettings({ storePath, folderKey: "global", enabled: true });
    const proj = await updateCloudMirrorSettings({
      storePath,
      folderKey: "project:martino",
      enabled: false
    });
    assert.equal(proj.enabled, false);
    const store = await readCloudMirrorStore(storePath);
    assert.equal(store.enabled.global, true);
    assert.equal(store.enabled["project:martino"], false);
    assert.equal(getCloudMirrorEnabled(store, "project:martino"), false);
    assert.equal(publicCloudMirrorView(store, "global").enabled, true);
  } finally {
    cleanup(dir);
  }
});

test("auto-copy uses effective project enabled value", async () => {
  const root = tempDir("h3-cloud-scope-auto-");
  try {
    const comfy = path.join(root, "comfy");
    const sync = path.join(root, "sync");
    mkdirSync(comfy);
    mkdirSync(sync);
    writeFileSync(path.join(comfy, "scope.mp4"), Buffer.from("SCOPEAUTO"));
    const storePath = path.join(root, "cloud-mirror.json");
    await configureCloudMirrorDestination({ storePath, folderKey: "global", absolutePath: sync });

    // project false + global true => skipped for project
    await updateCloudMirrorSettings({ storePath, folderKey: "global", enabled: true });
    await updateCloudMirrorSettings({ storePath, folderKey: "project:off", enabled: false });
    const skipped = await tryAutoCloudMirror({
      storePath,
      archiveStorePath: path.join(root, "a.json"),
      outputRoot: comfy,
      comfyUrl: "http://x",
      promptId: "s1",
      filename: "scope.mp4",
      folderKey: "project:off",
      projectLabel: "Off",
      fetchFn: historyFetch("s1", "scope.mp4")
    });
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.status, "disabled");

    // project true + global false => allowed for project
    await updateCloudMirrorSettings({ storePath, folderKey: "global", enabled: false });
    await updateCloudMirrorSettings({ storePath, folderKey: "project:on", enabled: true });
    const copied = await tryAutoCloudMirror({
      storePath,
      archiveStorePath: path.join(root, "a.json"),
      outputRoot: comfy,
      comfyUrl: "http://x",
      promptId: "s2",
      filename: "scope.mp4",
      folderKey: "project:on",
      projectLabel: "On",
      fetchFn: historyFetch("s2", "scope.mp4")
    });
    assert.equal(copied.ok, true);
    assert.equal(copied.status, "copied");
    assert.equal(existsSync(path.join(sync, "On", "scope.mp4")), true);
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
  assert.match(ui, /schedulePostCompletionCopies/);
  assert.match(ui, /resolvePostCompletionCopyPlan/);
  assert.doesNotMatch(ui, /scheduleCloudMirror\s*\(/);
  assert.doesNotMatch(ui, /scheduleArchive\s*\(/);
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
