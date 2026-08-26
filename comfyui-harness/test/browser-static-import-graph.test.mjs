/**
 * Issue #95 — browser/static import-graph regression.
 * Ensures served lib modules never depend on ../public/* (404 under Harness routing).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const LIB = path.join(ROOT, "lib");

const IMPORT_RE = /import\s+(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']/g;
const EXPORT_FROM_RE = /export\s+(?:[\s\S]*?\sfrom\s*)["']([^"']+)["']/g;

function read(relFromHarness) {
  return readFileSync(path.join(ROOT, relFromHarness), "utf8");
}

function collectImportSpecifiers(source) {
  const specs = [];
  for (const re of [IMPORT_RE, EXPORT_FROM_RE]) {
    re.lastIndex = 0;
    for (const match of source.matchAll(re)) specs.push(match[1]);
  }
  return specs;
}

/** Mirror server.mjs static URL → filesystem path (GET only). */
function harnessUrlToFsPath(urlPath) {
  const normalized = urlPath.startsWith("/") ? urlPath : `/${urlPath}`;
  if (normalized === "/") return path.join(PUBLIC, "index.html");
  if (normalized.startsWith("/lib/")) {
    const target = path.resolve(ROOT, normalized.slice(1));
    if (!target.startsWith(LIB) || !target.endsWith(".mjs")) return null;
    return target;
  }
  const target = path.resolve(PUBLIC, normalized.slice(1));
  if (!target.startsWith(PUBLIC)) return null;
  return target;
}

/** Resolve browser URL from module file + import specifier. */
function resolveBrowserUrl(moduleFsPath, specifier) {
  if (specifier.startsWith("/")) return specifier;
  const moduleDirUrl = moduleFsPath.startsWith(LIB)
    ? `/lib/${path.relative(LIB, moduleFsPath).replace(/\\/g, "/")}`
    : `/${path.relative(PUBLIC, moduleFsPath).replace(/\\/g, "/")}`;
  const baseDir = path.posix.dirname(moduleDirUrl);
  const joined = path.posix.normalize(path.posix.join(baseDir, specifier));
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function moduleKind(fsPath) {
  if (fsPath.startsWith(LIB)) return "lib";
  if (fsPath.startsWith(PUBLIC)) return "public";
  return "other";
}

function walkBrowserGraph(entryFsPaths) {
  const queue = [...entryFsPaths];
  const visited = new Set();
  const edges = [];
  const libPublicViolations = [];

  while (queue.length) {
    const fsPath = queue.shift();
    if (!fsPath || visited.has(fsPath)) continue;
    visited.add(fsPath);

    if (!existsSync(fsPath)) {
      edges.push({ fsPath, error: "missing file" });
      continue;
    }

    const source = readFileSync(fsPath, "utf8");
    for (const spec of collectImportSpecifiers(source)) {
      if (!spec.endsWith(".mjs") && !spec.endsWith(".js")) continue;

      const browserUrl = resolveBrowserUrl(fsPath, spec);
      edges.push({ from: fsPath, spec, browserUrl });

      if (browserUrl.startsWith("/public/")) {
        libPublicViolations.push({ from: fsPath, spec, browserUrl });
      }

      if (moduleKind(fsPath) === "lib" && spec.includes("/public/")) {
        libPublicViolations.push({ from: fsPath, spec, browserUrl, kind: "lib-imports-public" });
      }

      const targetFs = harnessUrlToFsPath(browserUrl);
      if (!targetFs || !existsSync(targetFs)) {
        edges.push({ from: fsPath, spec, browserUrl, error: "unserved or missing target" });
        continue;
      }
      queue.push(targetFs);
    }
  }

  return { visited, edges, libPublicViolations };
}

function indexModuleEntries() {
  const html = read("public/index.html");
  return [...html.matchAll(/<script\s+type="module"\s+src="([^"]+)"/g)].map(m => {
    const rel = m[1];
    return path.resolve(PUBLIC, rel);
  });
}

test("index.html module entries resolve under Harness public static routes", () => {
  for (const entry of indexModuleEntries()) {
    const url = `/${path.relative(PUBLIC, entry).replace(/\\/g, "/")}`;
    assert.equal(url.startsWith("/public/"), false, url);
    assert.ok(existsSync(entry), entry);
    assert.ok(harnessUrlToFsPath(url), url);
  }
});

test("browser import graph reaches h3-model-registry without /public/* URLs", () => {
  const entries = indexModuleEntries();
  const { visited, libPublicViolations } = walkBrowserGraph(entries);

  const registryPath = path.join(LIB, "h3-model-registry.mjs");
  assert.ok(visited.has(registryPath), "h3-model-registry.mjs must be reachable from browser entries");

  const modelNamePath = path.join(LIB, "model-name.mjs");
  assert.ok(visited.has(modelNamePath), "model-name.mjs must be reachable via h3-model-registry");

  assert.deepEqual(
    libPublicViolations,
    [],
    `lib→public browser boundary violations: ${JSON.stringify(libPublicViolations, null, 2)}`
  );

  for (const fsPath of visited) {
    if (moduleKind(fsPath) !== "lib") continue;
    const source = readFileSync(fsPath, "utf8");
    assert.doesNotMatch(
      source,
      /from\s+["']\.\.\/public\//,
      `${path.relative(ROOT, fsPath)} must not import ../public/*`
    );
  }
});

test("h3-model-registry dependency resolves to /lib/model-name.mjs not /public/output-naming.mjs", () => {
  const registryPath = path.join(LIB, "h3-model-registry.mjs");
  const url = resolveBrowserUrl(registryPath, "./model-name.mjs");
  assert.equal(url, "/lib/model-name.mjs");
  assert.notEqual(url, "/public/output-naming.mjs");

  const target = harnessUrlToFsPath(url);
  assert.ok(target && existsSync(target));
  assert.equal(path.basename(target), "model-name.mjs");
});

test("would fail old head: ../public/output-naming.mjs resolves to forbidden browser URL", () => {
  const registryPath = path.join(LIB, "h3-model-registry.mjs");
  const staleUrl = resolveBrowserUrl(registryPath, "../public/output-naming.mjs");
  assert.equal(staleUrl, "/public/output-naming.mjs");
  assert.ok(staleUrl.startsWith("/public/"), "stale browser URL uses forbidden /public/ prefix");
  const wrongTarget = harnessUrlToFsPath(staleUrl);
  const canonicalTarget = path.join(PUBLIC, "output-naming.mjs");
  assert.notEqual(wrongTarget, canonicalTarget);
  assert.equal(existsSync(canonicalTarget), true);
  assert.equal(existsSync(wrongTarget), false);
});
