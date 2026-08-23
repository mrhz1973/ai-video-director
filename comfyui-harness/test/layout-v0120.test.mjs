import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const batch = readFileSync(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");

test("v0.12.0 package version", () => {
  assert.equal(pkg.version, "0.12.0");
});

test("single interrupt control is present in monitor", () => {
  assert.equal((html.match(/id="interruptSingleRender"/g) || []).length, 1);
  assert.match(html, />INTERROMPI RENDER</);
});

test("runtime interrupt endpoints wired in client", () => {
  assert.match(app, /\/api\/runtime\/ownership/);
  assert.match(app, /\/api\/runtime\/interrupt-single/);
  assert.match(batch, /\/api\/runtime\/interrupt-batch-current/);
  assert.match(batch, /\/api\/runtime\/stop-batch/);
});

test("Genera singolo and Avvia batch preserved", () => {
  assert.match(html, /id="send"[^>]*>Genera singolo</);
  assert.match(batch, /id="batchQueue">Avvia batch</);
});
