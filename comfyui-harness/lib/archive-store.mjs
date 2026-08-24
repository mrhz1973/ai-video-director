/**
 * Machine-local archive destination store.
 * Lives under %LOCALAPPDATA%\AI Video Director\archive.json — never in the repo.
 */

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";

export const ARCHIVE_STORE_VERSION = 1;
export const ARCHIVE_STORE_FILENAME = "archive.json";

export function defaultArchiveAppDataDir(env = process.env) {
  const local = String(env.LOCALAPPDATA || "").trim();
  if (local) return path.join(local, "AI Video Director");
  const home = String(env.USERPROFILE || env.HOME || "").trim();
  if (home) return path.join(home, ".ai-video-director");
  return path.join(process.cwd(), ".ai-video-director-local");
}

export function resolveArchiveStorePath({
  env = process.env,
  explicitPath = null
} = {}) {
  const fromEnv = String(env.H3_ARCHIVE_STORE_PATH || "").trim();
  if (explicitPath) return path.resolve(String(explicitPath));
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(defaultArchiveAppDataDir(env), ARCHIVE_STORE_FILENAME);
}

export function emptyArchiveStore() {
  return {
    version: ARCHIVE_STORE_VERSION,
    destinations: {},
    counters: {},
    archived: {}
  };
}

export function normalizeFolderKey(raw = "global") {
  const key = String(raw || "global").trim();
  if (!key || key === "global") return "global";
  if (key.startsWith("project:")) {
    const id = key.slice("project:".length).trim();
    if (!id || id.includes("..") || /[\\/]/.test(id)) return "global";
    return `project:${id}`;
  }
  return "global";
}

export function normalizeArchiveStore(raw = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const destinations = {};
  for (const [key, value] of Object.entries(source.destinations || {})) {
    const folderKey = normalizeFolderKey(key);
    const dest = String(value || "").trim();
    if (dest) destinations[folderKey] = dest;
  }
  const counters = {};
  for (const [key, value] of Object.entries(source.counters || {})) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 1) counters[String(key)] = Math.floor(n);
  }
  const archived = {};
  for (const [key, value] of Object.entries(source.archived || {})) {
    if (!key || !value || typeof value !== "object") continue;
    archived[String(key)] = {
      archivedFilename: String(value.archivedFilename || ""),
      bytes: Number.isFinite(Number(value.bytes)) ? Number(value.bytes) : null,
      archivedAt: value.archivedAt || null,
      folderKey: value.folderKey || null
    };
  }
  return {
    version: ARCHIVE_STORE_VERSION,
    destinations,
    counters,
    archived
  };
}

export async function readArchiveStore(storePath) {
  try {
    const text = await readFile(storePath, "utf8");
    return normalizeArchiveStore(JSON.parse(text));
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return emptyArchiveStore();
    }
    throw error;
  }
}

export async function writeArchiveStore(storePath, store) {
  const normalized = normalizeArchiveStore(store);
  await mkdir(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, storePath);
  return normalized;
}

export function getDestination(store, folderKey = "global") {
  const key = normalizeFolderKey(folderKey);
  const dest = store?.destinations?.[key] || store?.destinations?.global || null;
  return dest ? String(dest) : null;
}

export function setDestination(store, folderKey, absolutePath) {
  const next = normalizeArchiveStore(store);
  const key = normalizeFolderKey(folderKey);
  const dest = String(absolutePath || "").trim();
  if (!dest) {
    delete next.destinations[key];
  } else {
    next.destinations[key] = dest;
  }
  return next;
}

export function archivedRecordKey(promptId, filename, subfolder = "") {
  return `${String(promptId || "").trim()}:${String(subfolder || "")}:${String(filename || "")}`;
}

export async function assertDirectoryWritable(absolutePath, { accessImpl = access } = {}) {
  const resolved = path.resolve(String(absolutePath || ""));
  await accessImpl(resolved, fsConstants.F_OK);
  await accessImpl(resolved, fsConstants.W_OK);
  return resolved;
}

export function publicArchiveDestinationView(store, folderKey = "global") {
  const key = normalizeFolderKey(folderKey);
  const absolutePath = getDestination(store, key);
  if (!absolutePath) {
    return {
      folderKey: key,
      configured: false,
      absolutePath: null,
      folderLabel: null
    };
  }
  return {
    folderKey: key,
    configured: true,
    absolutePath,
    folderLabel: path.basename(absolutePath) || absolutePath
  };
}
