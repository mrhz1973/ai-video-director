/**
 * Module dependency contract: used helpers must be imported and resolve on the live module.
 */

/**
 * Collect named imports from a given module specifier in source text.
 * @returns {Set<string>}
 */
export function collectNamedImportsFromModule(source, moduleSpecifier) {
  const out = new Set();
  const text = String(source || "");
  const escaped = moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escaped}["']`,
    "g"
  );
  let match;
  while ((match = re.exec(text))) {
    const body = match[1];
    for (const part of body.split(",")) {
      const cleaned = part.trim();
      if (!cleaned) continue;
      const [imported] = cleaned.split(/\s+as\s+/);
      const name = imported.trim();
      if (name) out.add(name);
    }
  }
  return out;
}

/**
 * Every requiredUsed helper must be present in the import set,
 * and every imported helper must resolve to a defined export on the live module.
 */
export function assertModuleDependencyContract({
  source,
  moduleSpecifier,
  requiredUsed = [],
  liveExports = null
} = {}) {
  const imported = collectNamedImportsFromModule(source, moduleSpecifier);
  const missing = [];
  for (const name of requiredUsed) {
    if (!imported.has(name)) missing.push(name);
  }
  if (missing.length) {
    return {
      ok: false,
      code: "missing-import",
      error: `Missing import(s) from ${moduleSpecifier}: ${missing.join(", ")}`,
      imported: [...imported],
      missing
    };
  }
  if (liveExports && typeof liveExports === "object") {
    const undefinedExports = [];
    for (const name of requiredUsed) {
      if (typeof liveExports[name] === "undefined") undefinedExports.push(name);
    }
    if (undefinedExports.length) {
      return {
        ok: false,
        code: "undefined-export",
        error: `Export(s) undefined on live module: ${undefinedExports.join(", ")}`,
        undefinedExports
      };
    }
  }
  return { ok: true, imported: [...imported] };
}
