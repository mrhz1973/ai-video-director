import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  emptyArchiveStore,
  normalizeFolderKey,
  publicArchiveDestinationView,
  readArchiveStore,
  resolveArchiveStorePath,
  writeArchiveStore,
  setDestination,
  archivedRecordKey
} from "../lib/archive-store.mjs";
import {
  allocateArchiveFilename,
  archiveCompletedOutput,
  appendCollisionSuffix,
  configureArchiveDestination,
  counterKeyFromPlan
} from "../lib/output-archive.mjs";
import { ComfyOutputPathError } from "../lib/comfy-output-path.mjs";
import { normalizeProject } from "../lib/projects.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function tempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test("archive disabled / no destination rejects archive", async () => {
  const dir = tempDir("h3-archive-none-");
  const storePath = path.join(dir, "archive.json");
  await writeArchiveStore(storePath, emptyArchiveStore());
  await assert.rejects(
    () => archiveCompletedOutput({
      storePath,
      outputRoot: dir,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "p1",
      filename: "a.mp4",
      plan: { enabled: true },
      fetchFn: async () => ({ ok: true, json: async () => ({}) })
    }),
    error => error instanceof ComfyOutputPathError && error.code === "archive-unconfigured"
  );
});

test("configured destination persists through archive store abstraction", async () => {
  const dir = tempDir("h3-archive-persist-");
  const storePath = path.join(dir, "archive.json");
  const dest = path.join(dir, "dest");
  mkdirSync(dest);
  let store = emptyArchiveStore();
  store = setDestination(store, "global", dest);
  await writeArchiveStore(storePath, store);
  const loaded = await readArchiveStore(storePath);
  const view = publicArchiveDestinationView(loaded, "global");
  assert.equal(view.configured, true);
  assert.equal(view.absolutePath, path.resolve(dest));
  assert.equal(resolveArchiveStorePath({ explicitPath: storePath }), path.resolve(storePath));
});

test("valid completed output copies successfully and keeps original", async () => {
  const root = tempDir("h3-archive-copy-");
  const comfyOut = path.join(root, "comfy");
  const archive = path.join(root, "archive");
  mkdirSync(comfyOut);
  mkdirSync(archive);
  const sourceName = "MiniMax_H3_00001_.mp4";
  const sourcePath = path.join(comfyOut, sourceName);
  writeFileSync(sourcePath, Buffer.from("video-bytes-abcdef"));
  const storePath = path.join(root, "archive.json");
  await configureArchiveDestination({ storePath, folderKey: "global", absolutePath: archive });

  const result = await archiveCompletedOutput({
    storePath,
    outputRoot: comfyOut,
    comfyUrl: "http://127.0.0.1:9",
    promptId: "prompt-1",
    filename: sourceName,
    plan: {
      enabled: true,
      projectId: "demo",
      projectLabel: "Demo",
      scene: "shot",
      template: "{project}_{scene}_{counter:04}",
      counterScope: "project",
      generation: { workflow: "minimax-h3-i2v", model: "Q8_CR", megapixels: 0.4, duration: 6, steps: 20, seed: 19 }
    },
    fetchFn: async () => ({
      ok: true,
      json: async () => ({
        "prompt-1": {
          outputs: {
            "92": {
              videos: [{ filename: sourceName, subfolder: "", type: "output" }]
            }
          }
        }
      })
    })
  });

  assert.equal(result.ok, true);
  assert.ok(result.archivedFilename);
  assert.equal(existsSync(sourcePath), true);
  assert.equal(existsSync(path.join(archive, result.archivedFilename)), true);
  assert.equal(
    readFileSync(path.join(archive, result.archivedFilename)).equals(readFileSync(sourcePath)),
    true
  );
});

test("filename collision behavior is deterministic", async () => {
  const root = tempDir("h3-archive-collision-");
  const dest = path.join(root, "dest");
  mkdirSync(dest);
  writeFileSync(path.join(dest, "Demo_shot_0001.mp4"), "a");
  const allocation = await allocateArchiveFilename({
    destinationRoot: dest,
    plan: {
      projectLabel: "Demo",
      scene: "shot",
      template: "{project}_{scene}_{counter:04}",
      counterScope: "global"
    },
    sourceFilename: "x.mp4",
    counters: { "h3OutputCounter:global": 1 }
  });
  assert.equal(allocation.filename, "Demo_shot_0002.mp4");
  assert.equal(allocation.counter, 2);
});

test("appendCollisionSuffix formats expected suffix", () => {
  assert.equal(appendCollisionSuffix("clip.mp4", 3), "clip_0003.mp4");
});

test("traversal and absolute client destination are rejected by configure helpers", async () => {
  assert.equal(normalizeFolderKey("project:../evil"), "global");
  const dir = tempDir("h3-archive-cfg-");
  const storePath = path.join(dir, "archive.json");
  await assert.rejects(
    () => configureArchiveDestination({
      storePath,
      folderKey: "global",
      absolutePath: path.join(dir, "missing-dest")
    }),
    /ENOENT|non disponibile|non accessibile|no such file/i
  );
});

test("arbitrary source outside Comfy output rejected", async () => {
  const root = tempDir("h3-archive-escape-");
  const comfyOut = path.join(root, "comfy");
  const outside = path.join(root, "outside");
  const archive = path.join(root, "archive");
  mkdirSync(comfyOut);
  mkdirSync(outside);
  mkdirSync(archive);
  writeFileSync(path.join(outside, "evil.mp4"), "x");
  const storePath = path.join(root, "archive.json");
  await configureArchiveDestination({ storePath, folderKey: "global", absolutePath: archive });
  await assert.rejects(
    () => archiveCompletedOutput({
      storePath,
      outputRoot: comfyOut,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "p",
      filename: "evil.mp4",
      plan: { enabled: true, template: "clip_{counter:04}", projectLabel: "P" },
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          p: { outputs: { "1": { videos: [{ filename: "evil.mp4", subfolder: "", type: "output" }] } } }
        })
      })
    }),
    error => error instanceof ComfyOutputPathError
  );
});

test("missing source produces clear error", async () => {
  const root = tempDir("h3-archive-missing-");
  const comfyOut = path.join(root, "comfy");
  const archive = path.join(root, "archive");
  mkdirSync(comfyOut);
  mkdirSync(archive);
  const storePath = path.join(root, "archive.json");
  await configureArchiveDestination({ storePath, folderKey: "global", absolutePath: archive });
  await assert.rejects(
    () => archiveCompletedOutput({
      storePath,
      outputRoot: comfyOut,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "p",
      filename: "gone.mp4",
      plan: { enabled: true, template: "clip_{counter:04}", projectLabel: "P" },
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          p: { outputs: { "1": { videos: [{ filename: "gone.mp4", subfolder: "", type: "output" }] } } }
        })
      })
    }),
    error => error instanceof ComfyOutputPathError && (error.code === "file-not-found" || error.status === 404)
  );
});

test("auto-archive OFF does nothing", async () => {
  const root = tempDir("h3-archive-off-");
  const storePath = path.join(root, "archive.json");
  const result = await archiveCompletedOutput({
    storePath,
    outputRoot: root,
    comfyUrl: "http://127.0.0.1:9",
    promptId: "p",
    filename: "a.mp4",
    plan: { enabled: false }
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "auto-archive-off");
});

test("auto-archive ON archives exactly once / repeated event does not duplicate", async () => {
  const root = tempDir("h3-archive-once-");
  const comfyOut = path.join(root, "comfy");
  const archive = path.join(root, "archive");
  mkdirSync(comfyOut);
  mkdirSync(archive);
  const sourceName = "clip.mp4";
  writeFileSync(path.join(comfyOut, sourceName), "abc123");
  const storePath = path.join(root, "archive.json");
  await configureArchiveDestination({ storePath, folderKey: "global", absolutePath: archive });
  const plan = {
    enabled: true,
    projectLabel: "Once",
    scene: "s",
    template: "{project}_{counter:04}",
    counterScope: "global",
    generation: { workflow: "i2v", model: "Q8", megapixels: 0.4, duration: 5, steps: 20, seed: 1 }
  };
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      p1: { outputs: { "1": { videos: [{ filename: sourceName, subfolder: "", type: "output" }] } } }
    })
  });
  const first = await archiveCompletedOutput({
    storePath,
    outputRoot: comfyOut,
    comfyUrl: "http://127.0.0.1:9",
    promptId: "p1",
    filename: sourceName,
    plan,
    fetchFn
  });
  const second = await archiveCompletedOutput({
    storePath,
    outputRoot: comfyOut,
    comfyUrl: "http://127.0.0.1:9",
    promptId: "p1",
    filename: sourceName,
    plan,
    fetchFn
  });
  assert.equal(first.ok, true);
  assert.equal(second.alreadyArchived, true);
  assert.equal(first.archivedFilename, second.archivedFilename);
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(archive);
  assert.equal(names.filter(n => n.endsWith(".mp4")).length, 1);
});

test("existing projects remain compatible", () => {
  const project = normalizeProject({
    id: "legacy",
    label: "Legacy",
    settings: { model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf" }
  });
  assert.equal(project.id, "legacy");
  assert.equal(project.settings.loraId, "off");
});

test("browser output-ui no longer requires FileSystemDirectoryHandle for archive", () => {
  const source = readFileSync(path.join(ROOT, "public/output-ui.mjs"), "utf8");
  assert.equal(/\bshowDirectoryPicker\s*\(/.test(source), false);
  assert.equal(/\brequestPermission\s*\(/.test(source), false);
  assert.equal(/\bcreateWritable\s*\(/.test(source), false);
  assert.equal(/indexedDB\.open/.test(source), false);
  assert.match(source, /\/api\/archive-output/);
  assert.match(source, /\/api\/archive\/pick-folder/);
});

test("index labels Archivio locale and open-folder control", () => {
  const html = readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  assert.match(html, /Archivio locale/);
  assert.match(html, /id="outputOpenFolder"/);
  assert.match(html, /Auto-archivia nuovi output/);
  assert.equal(html.includes("archivio browser"), false);
});

test("counter key helper matches naming module", () => {
  assert.equal(
    counterKeyFromPlan({ counterScope: "project", projectId: "demo", scene: "shot" }),
    "h3OutputCounter:project:demo"
  );
});

test("archivedRecordKey is stable", () => {
  assert.equal(archivedRecordKey("p", "a.mp4", "video"), "p:video:a.mp4");
});
