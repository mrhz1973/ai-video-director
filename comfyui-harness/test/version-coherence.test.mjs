/**
 * Issue #92 — version coherence across package / health / config / UI header.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED = "0.19.6";

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

test("package.json version is 0.19.6", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.version, EXPECTED);
});

test("server health and config use packageInfo.version and expose projectStore authority", () => {
  const server = read("server.mjs");
  assert.match(server, /const packageInfo = JSON\.parse/);
  assert.match(server, /service:\s*packageInfo\.name/);
  assert.match(server, /version:\s*packageInfo\.version/);
  assert.match(server, /projectStore:\s*projectStoreAuthority/);
  assert.match(server, /resolveProjectDirectory/);
  // Both /api/health and /api/config must derive version from packageInfo
  const healthIdx = server.indexOf('url.pathname === "/api/health"');
  const configIdx = server.indexOf('url.pathname === "/api/config"');
  assert.ok(healthIdx > 0);
  assert.ok(configIdx > healthIdx);
  const healthBlock = server.slice(healthIdx, configIdx);
  assert.match(healthBlock, /version:\s*packageInfo\.version/);
  const configBlock = server.slice(configIdx, configIdx + 400);
  assert.match(configBlock, /version:\s*packageInfo\.version/);
});

test("app.js sets header version from config.version", () => {
  const app = read("public/app.js");
  assert.match(app, /\$\("version"\)\.textContent\s*=\s*`v\$\{config\.version\}`/);
});

test("no stale hard-coded 0.19.0 UI version strings in harness entry surfaces", () => {
  const surfaces = [
    read("package.json"),
    read("public/app.js"),
    read("server.mjs")
  ].join("\n");
  // package/UI/API must not advertise the previous Wave 2 release as current
  assert.doesNotMatch(surfaces, /"version"\s*:\s*"0\.19\.2"/);
  assert.doesNotMatch(read("package.json"), /0\.19\.2/);
  assert.equal(JSON.parse(read("package.json")).version, EXPECTED);
});
