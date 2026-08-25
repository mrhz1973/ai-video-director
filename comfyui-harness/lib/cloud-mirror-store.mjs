/**
 * Machine-local secondary cloud-mirror store (sync-folder destination).
 * Lives under %LOCALAPPDATA%\AI Video Director\cloud-mirror.json — never in the repo.
 * No Google API / OAuth — filesystem destination only.
 */

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { normalizeFolderKey } from "./archive-store.mjs";

export const CLOUD_MIRROR_STORE_VERSION = 1;
export const CLOUD_MIRROR_STORE_FILENAME = "cloud-mirror.json";

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
    enabled: false,
    destinations: {},
    records: {}
  };
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
    enabled: Boolean(source.enabled),
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

export async function writeCloudMirrorStore(storePath, store) {
  const normalized = normalizeCloudMirrorStore(store);
  await mkdir(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, storePath);
  return normalized;
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

export function setCloudMirrorEnabled(store, enabled) {
  const next = normalizeCloudMirrorStore(store);
  next.enabled = Boolean(enabled);
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
  return {
    folderKey: key,
    enabled: Boolean(store?.enabled),
    configured,
    absolutePath: configured ? absolutePath : null,
    folderLabel: configured ? (path.basename(absolutePath) || absolutePath) : null,
    // Wording contract: local sync-folder copy only — not confirmed remote upload.
    semantics: "local-sync-folder-copy"
  };
}

export async function assertCloudDirectoryWritable(absolutePath, { accessImpl = access } = {}) {
  const resolved = path.resolve(String(absolutePath || ""));
  await accessImpl(resolved, fsConstants.F_OK);
  await accessImpl(resolved, fsConstants.W_OK);
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

