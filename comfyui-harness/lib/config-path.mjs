import path from "node:path";
import { existsSync as defaultExistsSync } from "node:fs";

/**
 * Resolve which JSON config file the harness should load.
 *
 * @param {{
 *   root: string,
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   existsSync?: (path: string) => boolean
 * }} options
 * @returns {string} absolute path to the config file
 */
export function resolveConfigPath({
  root,
  env = process.env,
  existsSync = defaultExistsSync
}) {
  const override = env?.H3_CONFIG_PATH;
  if (override && String(override).trim()) {
    return path.resolve(String(override).trim());
  }
  const local = path.join(root, "config.json");
  return existsSync(local) ? local : path.join(root, "config.example.json");
}
