/**
 * Machine-local secondary cloud-mirror store (sync-folder destination).
 * Lives under %LOCALAPPDATA%\AI Video Director\cloud-mirror.json — never in the repo.
 * No Google API / OAuth — filesystem destination only.
 */

import { mkdir, readFile, writeFile, access, stat, rename } from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { randomBytes } from "node:crypto";
import { normalizeFolderKey } from "./archive-store.mjs";
import { ComfyOutputPathError } from "./comfy-output-path.mjs";

export const CLOUD_MIRROR_STORE_VERSION = 1;
export const CLOUD_MIRROR_STORE_FILENAME = "cloud-mirror.json";

/** Per-storePath Promise chain — serializes read-modify-write commits. */
const storeLocks = new Map();

export function defaultCloudMirrorAppDataDir(env = process.env) {
  const local = String(env.LOCALAPPDATA || "").trim();
  if (local) return path.join(local, "AI Video Director");
  const home = String(env.USERPROFILE || env.HOME || "").trim();
  if (home) return path.join(home, ".ai-video-director");
  return path.join(process.cwd(), ".ai-video-director-local");
}

export function resolveCloudMirrorStorePath({
  env = process.env,
  explicitPath = null
} = {}) {
  const fromEnv = String(env.H3_CLOUD_MIRROR_STORE_PATH || "").trim();
  if (explicitPath) return path.resolve(String(explicitPath));
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(defaultCloudMirrorAppDataDir(env), CLOUD_MIRROR_STORE_FILENAME);
}

export function emptyCloudMirrorStore() {
  return {
    version: CLOUD_MIRROR_STORE_VERSION,
    enabled: { global: false },
    destinations: {},
    records: {}
  };
}

/**
 * Normalize scoped auto-copy enable map.
 * Legacy scalar `enabled: true|false` migrates to `enabled.global` only when
 * the value is a strict boolean. Malformed scalars fail closed to global false.
 */
export function normalizeCloudMirrorEnabledMap(sourceEnabled) {
  const map = { global: false };
  if (sourceEnabled === true) {
    map.global = true;
    return map;
  }
  if (sourceEnabled === false || sourceEnabled == null) {
    return map;
  }
  if (typeof sourceEnabled !== "object" || Array.isArray(sourceEnabled)) {
    // "true" / "false" / "yes" / 1 / etc. → fail closed
    return map;
  }
  for (const [rawKey, value] of Object.entries(sourceEnabled)) {
    const folderKey = normalizeFolderKey(rawKey);
    if (value === true) map[folderKey] = true;
    else if (value === false) map[folderKey] = false;
    // Non-boolean values for a key are omitted (project inherits; global stays false).
  }
  if (map.global !== true) map.global = false;
  return map;
}

/**
 * Effective auto-copy enable for a scope: project override if present, else global.
 */
export function getCloudMirrorEnabled(store, folderKey = "global") {
  const map = normalizeCloudMirrorEnabledMap(store?.enabled);
  const key = normalizeFolderKey(folderKey);
  if (key !== "global" && Object.prototype.hasOwnProperty.call(map, key)) {
    return map[key] === true;
  }
  return map.global === true;
}

/** True when folderKey has an explicit override (project scopes only). */
export function hasCloudMirrorEnabledOverride(store, folderKey = "global") {
  const key = normalizeFolderKey(folderKey);
  if (key === "global") return true;
  const map = normalizeCloudMirrorEnabledMap(store?.enabled);
  return Object.prototype.hasOwnProperty.call(map, key);
}

export function normalizeCloudMirrorStore(raw = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const destinations = {};
  for (const [key, value] of Object.entries(source.destinations || {})) {
    const folderKey = normalizeFolderKey(key);
    const dest = String(value || "").trim();
    if (dest) destinations[folderKey] = dest;
  }
  const records = {};
  for (const [key, value] of Object.entries(source.records || {})) {
    if (!key || !value || typeof value !== "object") continue;
    records[String(key)] = {
      destinationFilename: String(value.destinationFilename || ""),
      relativePath: String(value.relativePath || value.destinationFilename || ""),
      bytes: Number.isFinite(Number(value.bytes)) ? Number(value.bytes) : null,
      copiedAt: value.copiedAt || null,
      folderKey: value.folderKey || null,
      sourceKind: value.sourceKind === "comfy-output" ? "comfy-output" : "local-archive",
      projectId: value.projectId ? String(value.projectId) : null
    };
  }
  return {
    version: CLOUD_MIRROR_STORE_VERSION,
    enabled: normalizeCloudMirrorEnabledMap(source.enabled),
    destinations,
    records
  };
}

export async function readCloudMirrorStore(storePath) {
  try {
    const text = await readFile(storePath, "utf8");
    return normalizeCloudMirrorStore(JSON.parse(text));
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return emptyCloudMirrorStore();
    }
    throw error;
  }
}

/**
 * Atomic store write. Temp name uses pid + time + randomBytes so concurrent
 * writers in the same millisecond cannot collide.
 */
export async function writeCloudMirrorStore(storePath, store) {
  const normalized = normalizeCloudMirrorStore(store);
  await mkdir(path.dirname(storePath), { recursive: true });
  const uniq = randomBytes(8).toString("hex");
  const tmp = `${storePath}.${process.pid}.${Date.now()}.${uniq}.tmp`;
  await writeFile(tmp, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(tmp, storePath);
  return normalized;
}

/**
 * Serialize mutations for one storePath. Copy I/O should happen outside this lock.
 */
export async function withCloudMirrorStoreLock(storePath, fn) {
  const key = path.resolve(String(storePath || ""));
  const previous = storeLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const queued = previous.then(() => gate, () => gate);
  storeLocks.set(key, queued);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (storeLocks.get(key) === queued) storeLocks.delete(key);
  }
}

/** Read-modify-write under the store lock. */
export async function updateCloudMirrorStore(storePath, mutator) {
  return withCloudMirrorStoreLock(storePath, async () => {
    const current = await readCloudMirrorStore(storePath);
    const next = await mutator(current);
    if (next == null) return current;
    return writeCloudMirrorStore(storePath, next);
  });
}

export function getCloudMirrorDestination(store, folderKey = "global") {
  const key = normalizeFolderKey(folderKey);
  const dest = store?.destinations?.[key] || store?.destinations?.global || null;
  return dest ? String(dest) : null;
}

export function setCloudMirrorDestination(store, folderKey, absolutePath) {
  const next = normalizeCloudMirrorStore(store);
  const key = normalizeFolderKey(folderKey);
  const dest = String(absolutePath || "").trim();
  if (!dest) delete next.destinations[key];
  else next.destinations[key] = dest;
  return next;
}

/**
 * Persist auto-copy enable for one scope. Project toggles never mutate global.
 * Non-boolean `enabled` fail closed to false for that scope.
 */
export function setCloudMirrorEnabled(store, folderKey = "global", enabled) {
  const next = normalizeCloudMirrorStore(store);
  const key = normalizeFolderKey(folderKey);
  next.enabled = { ...normalizeCloudMirrorEnabledMap(next.enabled) };
  next.enabled[key] = enabled === true;
  return next;
}

/**
 * Stable idempotence key: prompt + Comfy identity + cloud folderKey.
 */
export function cloudMirrorRecordKey(promptId, filename, subfolder = "", folderKey = "global") {
  return [
    String(promptId || "").trim(),
    String(subfolder || "").trim(),
    String(filename || "").trim(),
    normalizeFolderKey(folderKey)
  ].join(":");
}

export function publicCloudMirrorView(store, folderKey = "global") {
  const key = normalizeFolderKey(folderKey);
  const absolutePath = getCloudMirrorDestination(store, key);
  const configured = Boolean(absolutePath);
  const enabled = getCloudMirrorEnabled(store, key);
  const inherited = key !== "global" && !hasCloudMirrorEnabledOverride(store, key);
  return {
    folderKey: key,
    enabled,
    enabledInherited: inherited,
    configured,
    absolutePath: configured ? absolutePath : null,
    folderLabel: configured ? (path.basename(absolutePath) || absolutePath) : null,
    semantics: "local-sync-folder-copy"
  };
}

/**
 * Destination must exist, be absolute, writable, and a directory (not a file).
 */
export async function assertCloudDirectoryWritable(absolutePath, {
  accessImpl = access,
  statImpl = stat
} = {}) {
  const resolved = path.resolve(String(absolutePath || ""));
  if (!path.isAbsolute(resolved)) {
    throw new ComfyOutputPathError("Cloud destination must be absolute.", {
      code: "cloud-path-invalid",
      status: 400
    });
  }
  try {
    await accessImpl(resolved, fsConstants.F_OK);
    await accessImpl(resolved, fsConstants.W_OK);
  } catch (error) {
    throw new ComfyOutputPathError("Cartella cloud non disponibile o non scrivibile.", {
      code: "cloud-destination-unavailable",
      status: 409,
      cause: error
    });
  }
  let st;
  try {
    st = await statImpl(resolved);
  } catch (error) {
    throw new ComfyOutputPathError("Cartella cloud non accessibile.", {
      code: "cloud-destination-unavailable",
      status: 409,
      cause: error
    });
  }
  if (!st.isDirectory()) {
    throw new ComfyOutputPathError("La destinazione cloud deve essere una cartella, non un file.", {
      code: "cloud-path-invalid",
      status: 400
    });
  }
  return resolved;
}

/** Filesystem-safe project subfolder under the cloud root. */
export function projectMirrorSubdir({ projectId = "", projectLabel = "" } = {}) {
  const raw = String(projectLabel || projectId || "").trim() || "project";
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "project";
}

export { normalizeFolderKey };
