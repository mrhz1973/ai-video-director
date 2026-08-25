/**
 * Secondary cloud-mirror COPY into a local sync-folder destination.
 * Prefer successful local-archive file; otherwise authoritative Comfy output.
 * Never deletes/moves sources. Cloud failure never invalidates render/archive.
 */

import { copyFile, mkdir, access, stat, rename, unlink, realpath as fsRealpath } from "node:fs/promises";
import { constants as fsConst } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { ComfyOutputPathError, assertSafeOutputBasename } from "./comfy-output-path.mjs";
import { resolveAuthoritativeComfyOutput } from "./comfy-output-authority.mjs";
import {
  archivedRecordKey,
  getDestination as getArchiveDestination,
  readArchiveStore
} from "./archive-store.mjs";
import { appendCollisionSuffix } from "./output-archive.mjs";
import {
  assertCloudDirectoryWritable,
  cloudMirrorRecordKey,
  getCloudMirrorDestination,
  normalizeFolderKey,
  projectMirrorSubdir,
  publicCloudMirrorView,
  readCloudMirrorStore,
  setCloudMirrorDestination,
  setCloudMirrorEnabled,
  writeCloudMirrorStore
} from "./cloud-mirror-store.mjs";

/** In-process serialization for duplicate simultaneous copies of the same record. */
const inflightByRecord = new Map();

async function fileExists(absolutePath, { accessImpl = access } = {}) {
  try {
    await accessImpl(absolutePath, fsConst.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertDestinationContained(destinationRoot, absoluteFile, {
  realpathImpl = fsRealpath
} = {}) {
  let realRoot;
  try {
    realRoot = await realpathImpl(destinationRoot);
  } catch {
    throw new ComfyOutputPathError("Cartella cloud non accessibile.", {
      code: "cloud-destination-unavailable",
      status: 409
    });
  }
  const resolvedFile = path.resolve(absoluteFile);
  const parent = path.dirname(resolvedFile);
  let realParent;
  try {
    realParent = await realpathImpl(parent);
  } catch {
    throw new ComfyOutputPathError("Cartella cloud non accessibile.", {
      code: "cloud-destination-unavailable",
      status: 409
    });
  }
  const relParent = path.relative(realRoot, realParent);
  if (relParent.startsWith("..") || path.isAbsolute(relParent)) {
    throw new ComfyOutputPathError("Cloud path escapes destination root.", {
      code: "cloud-root-escape",
      status: 400
    });
  }
  return { realRoot };
}

/**
 * Allocate destination filename under optional project subdir.
 * Prefer exact preferredName; on collision use _0002 suffix (never overwrite unrelated).
 */
export async function allocateCloudMirrorFilename({
  destinationRoot,
  preferredName,
  projectSubdir = "",
  accessImpl = access
} = {}) {
  assertSafeOutputBasename(preferredName);
  const root = path.resolve(destinationRoot);
  const sub = String(projectSubdir || "").trim();
  if (sub.includes("..") || /[\\/]/.test(sub)) {
    throw new ComfyOutputPathError("Invalid cloud project subfolder.", {
      code: "cloud-path-invalid",
      status: 400
    });
  }
  const dir = sub ? path.join(root, sub) : root;

  for (let counter = 1; counter <= 10000; counter += 1) {
    const filename = counter === 1
      ? preferredName
      : appendCollisionSuffix(preferredName, counter);
    assertSafeOutputBasename(filename);
    const absolutePath = path.resolve(dir, filename);
    const rel = path.relative(root, absolutePath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new ComfyOutputPathError("Cloud filename escapes destination root.", {
        code: "cloud-root-escape",
        status: 400
      });
    }
    if (!(await fileExists(absolutePath, { accessImpl }))) {
      return {
        filename,
        relativePath: rel.split(path.sep).join("/"),
        absolutePath,
        directory: dir
      };
    }
  }
  throw new ComfyOutputPathError("Unable to allocate a collision-free cloud filename.", {
    code: "cloud-name-exhausted",
    status: 500
  });
}

async function resolveMirrorSource({
  archiveStorePath,
  outputRoot,
  comfyUrl,
  promptId,
  filename,
  subfolder,
  type,
  archiveFolderKey,
  fetchFn,
  realpathImpl,
  accessImpl,
  readArchive = readArchiveStore
}) {
  const archiveStore = await readArchive(archiveStorePath);
  const archiveKey = archivedRecordKey(promptId, filename, subfolder);
  const archived = archiveStore.archived?.[archiveKey];
  if (archived?.archivedFilename) {
    const archiveRoot = getArchiveDestination(archiveStore, archived.folderKey || archiveFolderKey || "global");
    if (archiveRoot) {
      const absolutePath = path.resolve(archiveRoot, archived.archivedFilename);
      if (await fileExists(absolutePath, { accessImpl })) {
        return {
          absolutePath,
          preferredName: archived.archivedFilename,
          sourceKind: "local-archive"
        };
      }
    }
  }

  const resolved = await resolveAuthoritativeComfyOutput({
    outputRoot,
    comfyUrl,
    promptId,
    filename,
    subfolder,
    type,
    fetchFn,
    realpathImpl
  });
  return {
    absolutePath: resolved.absolutePath,
    preferredName: resolved.filename,
    sourceKind: "comfy-output"
  };
}

/**
 * Copy one completed output into the configured cloud sync folder.
 * @param {{ requireEnabled?: boolean }} opts — when true (auto path), skip if disabled.
 */
export async function mirrorCompletedOutput(opts = {}) {
  const {
    storePath,
    archiveStorePath,
    outputRoot,
    comfyUrl,
    promptId,
    filename,
    subfolder = "",
    type = "output",
    folderKey = "global",
    archiveFolderKey = null,
    projectId = "",
    projectLabel = "",
    requireEnabled = false,
    fetchFn = fetch,
    realpathImpl = fsRealpath,
    copyFileImpl = copyFile,
    mkdirImpl = mkdir,
    accessImpl = access,
    statImpl = stat,
    renameImpl = rename,
    unlinkImpl = unlink,
    readStore = readCloudMirrorStore,
    writeStore = writeCloudMirrorStore,
    readArchive = readArchiveStore,
    randomBytesImpl = randomBytes
  } = opts;

  const key = normalizeFolderKey(folderKey);
  const recordKey = cloudMirrorRecordKey(promptId, filename, subfolder, key);

  if (inflightByRecord.has(recordKey)) {
    return inflightByRecord.get(recordKey);
  }

  const run = (async () => {
    let store = await readStore(storePath);
    if (requireEnabled && !store.enabled) {
      return { ok: true, skipped: true, status: "disabled", reason: "auto-cloud-off" };
    }

    const destinationRoot = getCloudMirrorDestination(store, key);
    if (!destinationRoot) {
      if (requireEnabled) {
        return { ok: true, skipped: true, status: "not-configured", reason: "cloud-unconfigured" };
      }
      throw new ComfyOutputPathError("Cartella cloud non configurata.", {
        code: "cloud-unconfigured",
        status: 409
      });
    }

    try {
      await assertCloudDirectoryWritable(destinationRoot, { accessImpl });
    } catch {
      throw new ComfyOutputPathError("Cartella cloud non disponibile o non scrivibile.", {
        code: "cloud-destination-unavailable",
        status: 409
      });
    }

    const existing = store.records?.[recordKey];
    if (existing?.destinationFilename || existing?.relativePath) {
      const existingRel = existing.relativePath || existing.destinationFilename;
      const existingPath = path.resolve(destinationRoot, existingRel);
      if (await fileExists(existingPath, { accessImpl })) {
        try {
          const st = await statImpl(existingPath);
          if (existing.bytes == null || st.size === existing.bytes) {
            return {
              ok: true,
              alreadyCopied: true,
              status: "already-copied",
              destinationFilename: existing.destinationFilename || path.basename(existingRel),
              relativePath: existingRel,
              bytes: existing.bytes ?? st.size,
              folderKey: key,
              folderLabel: path.basename(destinationRoot),
              sourceKind: existing.sourceKind || "local-archive",
              // Local sync-folder only — not confirmed remote Google upload.
              semantics: "local-sync-folder-copy"
            };
          }
        } catch { /* fall through to re-copy with collision if needed */ }
      }
    }

    const source = await resolveMirrorSource({
      archiveStorePath,
      outputRoot,
      comfyUrl,
      promptId,
      filename,
      subfolder,
      type,
      archiveFolderKey: archiveFolderKey || key,
      fetchFn,
      realpathImpl,
      accessImpl,
      readArchive
    });

    const projectSub = projectId || projectLabel
      ? projectMirrorSubdir({ projectId, projectLabel })
      : "";

    const allocation = await allocateCloudMirrorFilename({
      destinationRoot,
      preferredName: source.preferredName,
      projectSubdir: projectSub,
      accessImpl
    });

    await assertDestinationContained(destinationRoot, allocation.absolutePath, { realpathImpl });
    await mkdirImpl(allocation.directory, { recursive: true });

    const tmpName = `${allocation.filename}.tmp-${randomBytesImpl(8).toString("hex")}`;
    const tmpPath = path.join(allocation.directory, tmpName);
    try {
      await copyFileImpl(source.absolutePath, tmpPath);
      const srcStat = await statImpl(source.absolutePath);
      const tmpStat = await statImpl(tmpPath);
      if (srcStat.size !== tmpStat.size) {
        throw new ComfyOutputPathError("Cloud copy size mismatch.", {
          code: "cloud-size-mismatch",
          status: 500
        });
      }
      await accessImpl(source.absolutePath, fsConst.F_OK);
      await renameImpl(tmpPath, allocation.absolutePath);
    } catch (error) {
      try {
        if (await fileExists(tmpPath, { accessImpl })) await unlinkImpl(tmpPath);
      } catch { /* exact temp only */ }
      if (error instanceof ComfyOutputPathError) throw error;
      throw new ComfyOutputPathError(error?.message || "Cloud copy failed.", {
        code: "cloud-destination-unavailable",
        status: 409
      });
    }

    const dstStat = await statImpl(allocation.absolutePath);
    store = await readStore(storePath);
    store.records = { ...(store.records || {}) };
    store.records[recordKey] = {
      destinationFilename: allocation.filename,
      relativePath: allocation.relativePath,
      bytes: dstStat.size,
      copiedAt: new Date().toISOString(),
      folderKey: key,
      sourceKind: source.sourceKind,
      projectId: projectId || null
    };
    await writeStore(storePath, store);

    return {
      ok: true,
      status: "copied",
      destinationFilename: allocation.filename,
      relativePath: allocation.relativePath,
      bytes: dstStat.size,
      folderKey: key,
      folderLabel: path.basename(destinationRoot),
      sourceKind: source.sourceKind,
      semantics: "local-sync-folder-copy"
    };
  })();

  inflightByRecord.set(recordKey, run);
  try {
    return await run;
  } finally {
    inflightByRecord.delete(recordKey);
  }
}

/**
 * Auto path: never throws to caller for disable/unavailable — returns status object.
 * Still throws only for programming errors; callers should still wrap.
 */
export async function tryAutoCloudMirror(opts = {}) {
  try {
    return await mirrorCompletedOutput({ ...opts, requireEnabled: true });
  } catch (error) {
    const code = error?.code || "cloud-copy-failed";
    return {
      ok: false,
      status: "failed",
      code,
      error: error?.message || "Cloud mirror failed",
      semantics: "local-sync-folder-copy"
    };
  }
}

export async function configureCloudMirrorDestination({
  storePath,
  folderKey = "global",
  absolutePath,
  accessImpl = access,
  realpathImpl = fsRealpath,
  readStore = readCloudMirrorStore,
  writeStore = writeCloudMirrorStore
} = {}) {
  const key = normalizeFolderKey(folderKey);
  const resolved = await assertCloudDirectoryWritable(absolutePath, { accessImpl });
  let real;
  try {
    real = await realpathImpl(resolved);
  } catch {
    throw new ComfyOutputPathError("Cartella cloud non accessibile.", {
      code: "cloud-destination-unavailable",
      status: 409
    });
  }
  if (!path.isAbsolute(real)) {
    throw new ComfyOutputPathError("Cloud destination must be absolute.", {
      code: "cloud-path-invalid",
      status: 400
    });
  }
  let store = await readStore(storePath);
  store = setCloudMirrorDestination(store, key, real);
  await writeStore(storePath, store);
  return publicCloudMirrorView(store, key);
}

export async function updateCloudMirrorSettings({
  storePath,
  enabled,
  folderKey = "global",
  readStore = readCloudMirrorStore,
  writeStore = writeCloudMirrorStore
} = {}) {
  let store = await readStore(storePath);
  if (enabled !== undefined) store = setCloudMirrorEnabled(store, enabled);
  await writeStore(storePath, store);
  return publicCloudMirrorView(store, folderKey);
}

export {
  publicCloudMirrorView,
  readCloudMirrorStore,
  writeCloudMirrorStore,
  cloudMirrorRecordKey,
  getCloudMirrorDestination,
  normalizeFolderKey
};

