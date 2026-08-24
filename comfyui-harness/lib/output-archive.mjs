/**
 * Server-side archive copy: authoritative Comfy source → configured archive root.
 * COPY only — never deletes or moves Comfy originals.
 */

import { copyFile, mkdir, access, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { realpath as fsRealpath } from "node:fs/promises";
import {
  ComfyOutputPathError,
  assertSafeOutputBasename
} from "./comfy-output-path.mjs";
import { resolveAuthoritativeComfyOutput } from "./comfy-output-authority.mjs";
import {
  DEFAULT_OUTPUT_TEMPLATE,
  buildOutputFilename,
  buildOutputTokens,
  extensionFromFilename,
  outputCounterStorageKey
} from "../public/output-naming.mjs";
import {
  archivedRecordKey,
  assertDirectoryWritable,
  getDestination,
  normalizeFolderKey,
  readArchiveStore,
  writeArchiveStore,
  setDestination,
  publicArchiveDestinationView
} from "./archive-store.mjs";

export function appendCollisionSuffix(filename, counter) {
  const ext = extensionFromFilename(filename);
  const base = filename.slice(0, -ext.length);
  return `${base}_${String(counter).padStart(4, "0")}${ext}`;
}

export function counterKeyFromPlan(plan = {}) {
  return outputCounterStorageKey({
    scope: plan.counterScope || "project",
    projectId: plan.projectId || "",
    scene: plan.scene || "shot"
  });
}

async function fileExists(absolutePath, { accessImpl = access } = {}) {
  try {
    await accessImpl(absolutePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function allocateArchiveFilename({
  destinationRoot,
  plan = {},
  sourceFilename,
  counters = {},
  accessImpl = access
} = {}) {
  const counterKey = counterKeyFromPlan(plan);
  let counter = Number(counters[counterKey] || 1);
  if (!Number.isFinite(counter) || counter < 1) counter = 1;
  counter = Math.floor(counter);

  const tokens = buildOutputTokens({
    project: plan.projectLabel || plan.projectId || "project",
    scene: plan.scene || "shot",
    variant: plan.variant || "",
    ...(plan.generation || {})
  });
  const template = plan.template || DEFAULT_OUTPUT_TEMPLATE;
  const templateHasCounter = /\{counter(?::0?\d+)?\}/.test(template);
  const root = path.resolve(destinationRoot);

  for (let attempts = 0; attempts < 10000; attempts += 1, counter += 1) {
    let filename = buildOutputFilename({
      template,
      tokens,
      counter,
      sourceFilename
    });
    if (!templateHasCounter && counter > 1) filename = appendCollisionSuffix(filename, counter);
    assertSafeOutputBasename(filename);
    const absolutePath = path.resolve(root, filename);
    const rel = path.relative(root, absolutePath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new ComfyOutputPathError("Archive filename escapes destination root.", {
        code: "archive-root-escape",
        status: 400
      });
    }
    if (!(await fileExists(absolutePath, { accessImpl }))) {
      return { filename, absolutePath, counter, counterKey };
    }
  }
  throw new ComfyOutputPathError("Unable to allocate a collision-free archive filename.", {
    code: "archive-name-exhausted",
    status: 500
  });
}

async function assertDestinationContained(destinationRoot, absoluteFile, {
  realpathImpl = fsRealpath
} = {}) {
  let realRoot;
  let realFile;
  try {
    realRoot = await realpathImpl(destinationRoot);
  } catch {
    throw new ComfyOutputPathError("Cartella archivio non accessibile.", {
      code: "archive-unavailable",
      status: 409
    });
  }
  try {
    realFile = await realpathImpl(absoluteFile);
  } catch {
    // File may not exist yet — contain lexical parent.
    realFile = path.resolve(absoluteFile);
    const parent = path.dirname(realFile);
    let realParent;
    try {
      realParent = await realpathImpl(parent);
    } catch {
      throw new ComfyOutputPathError("Cartella archivio non accessibile.", {
        code: "archive-unavailable",
        status: 409
      });
    }
    const relParent = path.relative(realRoot, realParent);
    if (relParent.startsWith("..") || path.isAbsolute(relParent)) {
      throw new ComfyOutputPathError("Archive path escapes destination root.", {
        code: "archive-root-escape",
        status: 400
      });
    }
    return { realRoot, realFile };
  }
  const rel = path.relative(realRoot, realFile);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ComfyOutputPathError("Archive path escapes destination root.", {
      code: "archive-root-escape",
      status: 400
    });
  }
  return { realRoot, realFile };
}

/**
 * Copy one completed Comfy output into the configured archive destination.
 */
export async function archiveCompletedOutput({
  storePath,
  outputRoot,
  comfyUrl,
  promptId,
  filename,
  subfolder = "",
  type = "output",
  plan = {},
  folderKey = "global",
  fetchFn = fetch,
  realpathImpl = fsRealpath,
  copyFileImpl = copyFile,
  mkdirImpl = mkdir,
  accessImpl = access,
  statImpl = stat,
  readStore = readArchiveStore,
  writeStore = writeArchiveStore
} = {}) {
  if (plan && plan.enabled === false) {
    return { ok: true, skipped: true, reason: "auto-archive-off" };
  }

  const key = normalizeFolderKey(folderKey || plan.folderKey || "global");
  let store = await readStore(storePath);
  const destinationRoot = getDestination(store, key);
  if (!destinationRoot) {
    throw new ComfyOutputPathError("Cartella archivio non configurata.", {
      code: "archive-unconfigured",
      status: 409
    });
  }

  try {
    await assertDirectoryWritable(destinationRoot, { accessImpl });
  } catch {
    throw new ComfyOutputPathError("Cartella archivio non disponibile o non scrivibile.", {
      code: "archive-unavailable",
      status: 409
    });
  }

  const recordKey = archivedRecordKey(promptId, filename, subfolder);
  const existing = store.archived?.[recordKey];
  if (existing?.archivedFilename) {
    return {
      ok: true,
      alreadyArchived: true,
      archivedFilename: existing.archivedFilename,
      bytes: existing.bytes,
      folderKey: key,
      folderLabel: path.basename(destinationRoot)
    };
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

  const allocation = await allocateArchiveFilename({
    destinationRoot,
    plan,
    sourceFilename: resolved.filename,
    counters: store.counters,
    accessImpl
  });

  await assertDestinationContained(destinationRoot, allocation.absolutePath, { realpathImpl });
  await mkdirImpl(path.dirname(allocation.absolutePath), { recursive: true });

  await copyFileImpl(resolved.absolutePath, allocation.absolutePath);

  const srcStat = await statImpl(resolved.absolutePath);
  const dstStat = await statImpl(allocation.absolutePath);
  if (srcStat.size !== dstStat.size) {
    throw new ComfyOutputPathError("Archive copy size mismatch.", {
      code: "archive-size-mismatch",
      status: 500
    });
  }

  // Source must still exist (copy, not move).
  await accessImpl(resolved.absolutePath, fsConstants.F_OK);

  store = await readStore(storePath);
  store.counters = { ...(store.counters || {}) };
  store.counters[allocation.counterKey] = allocation.counter + 1;
  store.archived = { ...(store.archived || {}) };
  store.archived[recordKey] = {
    archivedFilename: allocation.filename,
    bytes: dstStat.size,
    archivedAt: new Date().toISOString(),
    folderKey: key
  };
  await writeStore(storePath, store);

  return {
    ok: true,
    archivedFilename: allocation.filename,
    bytes: dstStat.size,
    folderKey: key,
    folderLabel: path.basename(destinationRoot),
    absolutePath: allocation.absolutePath,
    sourceFilename: resolved.filename
  };
}

export async function configureArchiveDestination({
  storePath,
  folderKey = "global",
  absolutePath,
  accessImpl = access,
  realpathImpl = fsRealpath,
  readStore = readArchiveStore,
  writeStore = writeArchiveStore
} = {}) {
  const key = normalizeFolderKey(folderKey);
  const resolved = await assertDirectoryWritable(absolutePath, { accessImpl });
  let real;
  try {
    real = await realpathImpl(resolved);
  } catch {
    throw new ComfyOutputPathError("Cartella archivio non accessibile.", {
      code: "archive-unavailable",
      status: 409
    });
  }
  // Reject client-supplied destination escape tricks: path must be absolute and exist.
  if (!path.isAbsolute(real)) {
    throw new ComfyOutputPathError("Archive destination must be absolute.", {
      code: "archive-path-invalid",
      status: 400
    });
  }
  let store = await readStore(storePath);
  store = setDestination(store, key, real);
  await writeStore(storePath, store);
  return publicArchiveDestinationView(store, key);
}

export {
  getDestination,
  publicArchiveDestinationView,
  readArchiveStore,
  writeArchiveStore,
  normalizeFolderKey,
  archivedRecordKey
};
