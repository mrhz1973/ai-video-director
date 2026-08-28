/**
 * Deterministic project-store authority resolution.
 * Production Windows launcher passes H3_PROJECT_DIRECTORY; dev/test may use config.projectDirectory.
 */

import path from "node:path";

export function defaultAppDataDir(env = process.env) {
  const local = String(env.LOCALAPPDATA || "").trim();
  if (local) return path.join(local, "AI Video Director");
  const home = String(env.USERPROFILE || env.HOME || "").trim();
  if (home) return path.join(home, ".ai-video-director");
  return "";
}

/** Preferred Windows persistent operator project store (outside git checkout). */
export function defaultPersistentProjectDirectory(env = process.env) {
  const appData = defaultAppDataDir(env);
  if (!appData) return "";
  return path.join(appData, "projects");
}

export class ProjectDirectoryError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "ProjectDirectoryError";
    this.code = code || "invalid-project-directory";
  }
}

function resolveConfiguredPath(baseRoot, value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(baseRoot, raw);
}

/**
 * Resolve which directory holds *.local.json project files.
 *
 * Precedence:
 * 1) H3_PROJECT_DIRECTORY — explicit env authority; invalid/non-empty values fail closed
 * 2) config.projectDirectory — dev/test harness config (relative to harness root)
 * 3) default persistent %LOCALAPPDATA%\\AI Video Director\\projects when available
 * 4) ./projects relative to harness root (non-Windows dev fallback)
 *
 * @returns {{ directory: string, source: string }}
 */
export function resolveProjectDirectory({
  root,
  config = {},
  env = process.env
} = {}) {
  const harnessRoot = path.resolve(String(root || process.cwd()));

  const envKey = "H3_PROJECT_DIRECTORY";
  if (Object.prototype.hasOwnProperty.call(env || {}, envKey)) {
    const envRaw = String(env[envKey] ?? "").trim();
    if (!envRaw) {
      throw new ProjectDirectoryError(
        `${envKey} is set but empty; remove it or provide a valid directory`,
        { code: "empty-env-authority" }
      );
    }
    const resolved = resolveConfiguredPath(harnessRoot, envRaw);
    if (!resolved) {
      throw new ProjectDirectoryError(
        `${envKey} could not be resolved to a directory path`,
        { code: "invalid-env-authority" }
      );
    }
    return { directory: resolved, source: envKey };
  }

  const configRaw = String(config.projectDirectory || "").trim();
  if (configRaw) {
    const resolved = resolveConfiguredPath(harnessRoot, configRaw);
    return { directory: resolved, source: "config.projectDirectory" };
  }

  const persistent = defaultPersistentProjectDirectory(env);
  if (persistent) {
    return { directory: path.resolve(persistent), source: "default-persistent" };
  }

  return {
    directory: path.resolve(harnessRoot, "./projects"),
    source: "default-checkout"
  };
}

/** Read-only /api/config view — proves authority without project file contents. */
export function publicProjectStoreAuthorityView({ directory, source } = {}) {
  const src = String(source || "unknown");
  return {
    source: src,
    directory: String(directory || ""),
    persistent: src === "H3_PROJECT_DIRECTORY" || src === "default-persistent"
  };
}
