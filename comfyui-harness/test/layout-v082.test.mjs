import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MONITOR_HEIGHT_KEY,
  PROMPT_HEIGHT_KEY,
  clampPanelHeight,
  isCustomPromptResizeEnabled
} from "../public/panel-resize.mjs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/workspace-v082.css", import.meta.url), "utf8");
const v081 = readFileSync(new URL("../public/workspace-v081.css", import.meta.url), "utf8");

test("project name sits above actions and Save As is gone", () => {
  const labelIdx = html.indexOf(">Nome progetto<");
  const actionsIdx = html.indexOf('class="project-actions"');
  const saveIdx = html.indexOf('id="projectSave"');
  assert.ok(labelIdx > 0 && actionsIdx > labelIdx, "Nome progetto must be above action buttons");
  assert.ok(saveIdx > actionsIdx);
  assert.doesNotMatch(html, /id="projectSaveAs"/);
  assert.doesNotMatch(html, /Salva come/);
  assert.match(html, /id="projectNew"/);
  assert.match(html, /id="projectDelete"/);
});

test("new project Salva POSTs create; existing project PUTs update; typing name does not create", () => {
  const saveFn = app.slice(app.indexOf("async function saveProject"), app.indexOf("async function ingestFiles"));
  assert.match(saveFn, /method:\s*"POST"/);
  assert.match(saveFn, /method:\s*"PUT"/);
  assert.match(saveFn, /draft\.saved && draft\.id/);
  assert.doesNotMatch(app, /\$\("projectLabel"\)\.oninput[\s\S]{0,200}\/api\/projects/);
  assert.match(app, /AUTOSAVE_DEBOUNCE_MS/);
});

test("asset group header distinguishes group from member/filename", () => {
  assert.match(app, /GRUPPO ASSET/);
  assert.match(app, /Nome gruppo/);
  assert.match(app, /member-label-input/);
  assert.match(app, /member-filename/);
  assert.doesNotMatch(app, /Group · Elements #1/);
  assert.match(app, /rinomina gruppo \(non rinomina i file\)/i);
});

test("prompt resizes from a visible bottom handle, persisted independently of monitor", () => {
  assert.match(html, /id="promptResizeHandle"/);
  assert.match(html, /prompt-resize-handle/);
  assert.match(css, /cursor:\s*ns-resize/);
  assert.match(v081, /#prompt\s*\{[\s\S]*?resize:\s*none;/);
  assert.equal(PROMPT_HEIGHT_KEY, "h3PromptHeight:v1");
  assert.notEqual(PROMPT_HEIGHT_KEY, MONITOR_HEIGHT_KEY);
  assert.equal(clampPanelHeight(80, { min: 140, maxVh: 0.55, viewportHeight: 1000, fallback: 260 }), 140);
  assert.equal(clampPanelHeight(900, { min: 140, maxVh: 0.55, viewportHeight: 1000, fallback: 260 }), 550);
  assert.equal(isCustomPromptResizeEnabled(800), false);
  assert.equal(isCustomPromptResizeEnabled(1200), true);
  assert.match(css, /max-width:\s*800px/);
});

test("package is 0.8.3 and v082 stylesheet is loaded", () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  assert.equal(pkg.version, "0.8.3");
  assert.match(html, /workspace-v082\.css/);
});
