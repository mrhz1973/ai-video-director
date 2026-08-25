/**
 * Secondary cloud-mirror COPY into a local sync-folder destination.
 * Prefer successful local-archive file; otherwise authoritative Comfy output.
 * Never deletes/moves sources. Cloud failure never invalidates render/archive.
 */

import {
  copyFile,
  mkdir,
  access,
  stat,
  rename,
  unlink,
  open,
  realpath as fsRealpath
} from "node:fs/promises";
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
  updateCloudMirrorStore,
  withCloudMirrorStoreLock,
  writeCloudMirrorStore
} from "./cloud-mirror-store.mjs";

/** In-process serialization for duplicate simultaneous copies of the same record. */
const inflightByRecord = new Map();
/** Serialize filename allocation / exclusive claims per destination root. */
const destinationAllocLocks = new Map();

async function withDestinationAllocLock(destinationRoot, fn) {
  const key = path.resolve(String(destinationRoot || ""));
  const previous = destinationAllocLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const queued = previous.then(() => gate, () => gate);
  destinationAllocLocks.set(key, queued);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (destinationAllocLocks.get(key) === queued) destinationAllocLocks.delete(key);
  }
}

async function fileExists(absolutePath, { accessImpl = access } = {}) {
  try {
    await accessImpl(absolutePath, fsConst.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create (if needed) and verify the project directory under an existing cloud root.
 * Order: realpath root → lexical contain → mkdir → realpath dir → contain again.
 */
export async function ensureCloudProjectDirectory({
  destinationRoot,
  projectSubdir = "",
  mkdirImpl = mkdir,
  realpathImpl = fsRealpath,
  statImpl = stat
} = {}) {
  const root = path.resolve(destinationRoot);
  let realRoot;
  try {
    realRoot = await realpathImpl(root);
  } catch {
    throw new ComfyOutputPathError("Cartella cloud non accessibile.", {
      code: "cloud-destination-unavailable",
      status: 409
    });
  }
  const rootStat = await statImpl(realRoot);
  if (!rootStat.isDirectory()) {
    throw new ComfyOutputPathError("La destinazione cloud deve essere una cartella, non un file.", {
      code: "cloud-path-invalid",
      status: 400
    });
  }

  const sub = String(projectSubdir || "").trim();
  if (sub.includes("..") || /[\\/]/.test(sub)) {
    throw new ComfyOutputPathError("Invalid cloud project subfolder.", {
      code: "cloud-path-invalid",
      status: 400
    });
  }

  const intendedDir = sub ? path.join(root, sub) : root;
  const lexicalRel = path.relative(root, path.resolve(intendedDir));
  if ((lexicalRel && lexicalRel.startsWith("..")) || path.isAbsolute(lexicalRel)) {
    throw new ComfyOutputPathError("Cloud path escapes destination root.", {
      code: "cloud-root-escape",
      status: 400
    });
  }

  if (sub) {
    await mkdirImpl(intendedDir, { recursive: true });
  }

  let realDir;
  try {
    realDir = await realpathImpl(intendedDir);
  } catch {
    throw new ComfyOutputPathError("Cartella cloud non accessibile.", {
      code: "cloud-destination-unavailable",
      status: 409
    });
  }
  const realRel = path.relative(realRoot, realDir);
  if ((realRel && realRel.startsWith("..")) || path.isAbsolute(realRel)) {
    throw new ComfyOutputPathError("Cloud path escapes destination root.", {
      code: "cloud-root-escape",
      status: 400
    });
  }
  return { realRoot, realDir, directory: intendedDir };
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

function alreadyCopiedResult({
  existing,
  destinationRoot,
  key,
  existingRel,
  bytes
}) {
  return {
    ok: true,
    alreadyCopied: true,
    status: "already-copied",
    destinationFilename: existing.destinationFilename || path.basename(existingRel),
    relativePath: existingRel,
    bytes,
    folderKey: key,
    folderLabel: path.basename(destinationRoot),
    sourceKind: existing.sourceKind || "local-archive",
    semantics: "local-sync-folder-copy"
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
    openImpl = open,
    readStore = readCloudMirrorStore,
    readArchive = readArchiveStore,
    randomBytesImpl = randomBytes
  } = opts;

  const key = normalizeFolderKey(folderKey);
  const recordKey = cloudMirrorRecordKey(promptId, filename, subfolder, key);

  if (inflightByRecord.has(recordKey)) {
    return inflightByRecord.get(recordKey);
  }

  const run = (async () => {
    const storePeek = await readStore(storePath);
    if (requireEnabled && !storePeek.enabled) {
      return { ok: true, skipped: true, status: "disabled", reason: "auto-cloud-off" };
    }

    const destinationRoot = getCloudMirrorDestination(storePeek, key);
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
      await assertCloudDirectoryWritable(destinationRoot, { accessImpl, statImpl });
    } catch (error) {
      if (error instanceof ComfyOutputPathError) throw error;
      throw new ComfyOutputPathError("Cartella cloud non disponibile o non scrivibile.", {
        code: "cloud-destination-unavailable",
        status: 409
      });
    }

    const existing = storePeek.records?.[recordKey];
    if (existing?.destinationFilename || existing?.relativePath) {
      const existingRel = existing.relativePath || existing.destinationFilename;
      const existingPath = path.resolve(destinationRoot, existingRel);
      if (await fileExists(existingPath, { accessImpl })) {
        try {
          const st = await statImpl(existingPath);
          if (existing.bytes == null || st.size === existing.bytes) {
            return alreadyCopiedResult({
              existing,
              destinationRoot,
              key,
              existingRel,
              bytes: existing.bytes ?? st.size
            });
          }
        } catch { /* fall through */ }
      }
    }

    // Source resolution happens outside store lock (may hit Comfy history).
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

    // Allocate + mkdir + exclusive claim under destination lock (not during large copy).
    const claim = await withDestinationAllocLock(destinationRoot, async () => {
      // Re-check idempotence after waiting for the alloc lock.
      const latest = await readStore(storePath);
      const again = latest.records?.[recordKey];
      if (again?.destinationFilename || again?.relativePath) {
        const existingRel = again.relativePath || again.destinationFilename;
        const existingPath = path.resolve(destinationRoot, existingRel);
        if (await fileExists(existingPath, { accessImpl })) {
          const st = await statImpl(existingPath);
          if (again.bytes == null || st.size === again.bytes) {
            return {
              already: alreadyCopiedResult({
                existing: again,
                destinationRoot,
                key,
                existingRel,
                bytes: again.bytes ?? st.size
              })
            };
          }
        }
      }

      await ensureCloudProjectDirectory({
        destinationRoot,
        projectSubdir: projectSub,
        mkdirImpl,
        realpathImpl,
        statImpl
      });

      const allocation = await allocateCloudMirrorFilename({
        destinationRoot,
        preferredName: source.preferredName,
        projectSubdir: projectSub,
        accessImpl
      });

      // Exclusive claim of the final path so concurrent allocators see it as taken.
      const claimHandle = await openImpl(allocation.absolutePath, "wx");
      await claimHandle.close();

      const tmpName = `${allocation.filename}.tmp-${randomBytesImpl(8).toString("hex")}`;
      const tmpPath = path.join(allocation.directory, tmpName);
      return { allocation, tmpPath, source };
    });

    if (claim.already) return claim.already;

    const { allocation, tmpPath } = claim;
    try {
      // Large copy outside store/alloc locks.
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

      await withDestinationAllocLock(destinationRoot, async () => {
        await renameImpl(tmpPath, allocation.absolutePath);
      });

      const dstStat = await statImpl(allocation.absolutePath);
      await updateCloudMirrorStore(storePath, store => {
        const next = {
          ...store,
          records: { ...(store.records || {}) }
        };
        next.records[recordKey] = {
          destinationFilename: allocation.filename,
          relativePath: allocation.relativePath,
          bytes: dstStat.size,
          copiedAt: new Date().toISOString(),
          folderKey: key,
          sourceKind: source.sourceKind,
          projectId: projectId || null
        };
        return next;
      });

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
    } catch (error) {
      try {
        if (await fileExists(tmpPath, { accessImpl })) await unlinkImpl(tmpPath);
      } catch { /* exact temp only */ }
      try {
        // Remove exclusive empty/partial claim if rename never completed.
        if (await fileExists(allocation.absolutePath, { accessImpl })) {
          const st = await statImpl(allocation.absolutePath);
          if (st.size === 0) await unlinkImpl(allocation.absolutePath);
        }
      } catch { /* exact claim only */ }
      if (error instanceof ComfyOutputPathError) throw error;
      throw new ComfyOutputPathError(error?.message || "Cloud copy failed.", {
        code: "cloud-destination-unavailable",
        status: 409
      });
    }
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
  statImpl = stat
} = {}) {
  const key = normalizeFolderKey(folderKey);
  const resolved = await assertCloudDirectoryWritable(absolutePath, { accessImpl, statImpl });
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
  // Re-validate after realpath (symlink targets must also be directories).
  await assertCloudDirectoryWritable(real, { accessImpl, statImpl });
  const store = await updateCloudMirrorStore(storePath, current => setCloudMirrorDestination(current, key, real));
  return publicCloudMirrorView(store, key);
}

export async function updateCloudMirrorSettings({
  storePath,
  enabled,
  folderKey = "global"
} = {}) {
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new ComfyOutputPathError("Il campo enabled deve essere boolean.", {
      code: "cloud-settings-invalid",
      status: 400
    });
  }
  const store = await updateCloudMirrorStore(storePath, current => {
    if (enabled === undefined) return current;
    return setCloudMirrorEnabled(current, enabled);
  });
  return publicCloudMirrorView(store, folderKey);
}

export {
  publicCloudMirrorView,
  readCloudMirrorStore,
  writeCloudMirrorStore,
  withCloudMirrorStoreLock,
  updateCloudMirrorStore,
  cloudMirrorRecordKey,
  getCloudMirrorDestination,
  normalizeFolderKey
};
