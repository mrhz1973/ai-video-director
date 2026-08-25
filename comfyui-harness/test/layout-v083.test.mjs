import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/workspace-v083.css", import.meta.url), "utf8");

test("project load and batch restore status elements exist", () => {
  assert.match(html, /id="projectLoadStatus"/);
  assert.match(html, /id="batchRestoreStatus"/);
  assert.match(html, /id="batchLegacyRecover"/);
  assert.match(html, /workspace-v083\.css/);
});

test("app wires explicit project load feedback and batch persistence", () => {
  assert.match(app, /setProjectLoadStatus/);
  assert.match(app, /LOAD_STATUS\.LOADING/);
  assert.match(app, /shouldCommitLoadGeneration/);
  assert.match(app, /exportBatchDraftForProject/);
  assert.match(app, /exportBatchDraftForPersistence/);
  assert.match(app, /importBatchDraftFromProject/);
  assert.match(app, /batchDraft:/);
  assert.match(app, /setBatchPersistenceHook/);
  assert.doesNotMatch(app, /script type="module" src="batch-ui\.mjs"/);
});

test("project load never auto-submits queue or gpu writes", () => {
  const loadFn = app.slice(app.indexOf("async function loadProjectById"), app.indexOf("function resetDraft"));
  assert.doesNotMatch(loadFn, /\/api\/queue/);
  assert.doesNotMatch(loadFn, /\/api\/gpu-power/);
  assert.doesNotMatch(loadFn, /\/prompt/);
});

test("v083 stylesheet styles load states", () => {
  assert.match(css, /project-load-status/);
  assert.match(css, /data-state="loading"/);
  assert.match(css, /data-state="success"/);
  assert.match(css, /data-state="warning"/);
  assert.match(css, /data-state="error"/);
});

test("package version is 0.8.6", () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  assert.match(pkg.version, /^0\.1[34567]\./);
});
