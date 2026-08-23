import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MONITOR_HEIGHT_KEY,
  PROMPT_HEIGHT_KEY,
  assertPanelKeysIsolated,
  clampPanelHeight,
  storedPanelHeight
} from "../public/panel-resize.mjs";
import {
  INSPECTOR_TAB_KEY,
  INSPECTOR_TABS,
  applyInspectorTab,
  normalizeInspectorTab,
  persistInspectorTab,
  readStoredInspectorTab
} from "../public/inspector-ui.mjs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const batchUi = readFileSync(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");
const style = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
const v081 = readFileSync(new URL("../public/workspace-v081.css", import.meta.url), "utf8");
const workspaceCss = readFileSync(new URL("../public/workspace-resize.css", import.meta.url), "utf8");

function countId(id) {
  const re = new RegExp(`id=["']${id}["']`, "g");
  return (html.match(re) || []).length;
}

test("exactly one prompt and one generation control set exist", () => {
  assert.equal(countId("prompt"), 1);
  assert.equal(countId("workflow"), 1);
  assert.equal(countId("model"), 1);
  assert.equal(countId("megapixels"), 1);
  assert.equal(countId("aspect"), 1);
  assert.equal(countId("steps"), 1);
  assert.equal(countId("duration"), 1);
  assert.equal(countId("seed"), 1);
  assert.equal(countId("generationGrid"), 1);
  assert.equal(countId("batchMount"), 1);
  assert.equal(countId("gpuPowerSection"), 1);
  assert.equal(countId("outputSection"), 1);
  assert.equal(countId("librarySection"), 1);
  assert.equal(countId("project"), 1);
  assert.equal(countId("roleFields"), 1);
});

test("generation controls and batch mount live in the left workspace", () => {
  const workspaceStart = html.indexOf('<section class="workspace"');
  const asideStart = html.indexOf('<aside id="inspector"');
  assert.ok(workspaceStart >= 0 && asideStart > workspaceStart);
  const left = html.slice(workspaceStart, asideStart);
  const right = html.slice(asideStart);
  assert.match(left, /id="generationGrid"/);
  assert.match(left, /id="workflow"/);
  assert.match(left, /id="batchMount"/);
  assert.match(left, /id="renderMonitor"/);
  assert.match(left, /id="monitorEvents"/);
  assert.match(left, /id="monitorTerminal"/);
  assert.doesNotMatch(left, /id="activityDrawer"/);
  assert.doesNotMatch(right, /id="generationGrid"/);
  assert.doesNotMatch(right, /id="batchMount"/);
  assert.doesNotMatch(right, /id="workflow"/);
});

test("inspector exposes project/asset/input/output tabs exactly once each", () => {
  for (const tab of INSPECTOR_TABS) {
    assert.equal((html.match(new RegExp(`data-inspector-tab="${tab}"`, "g")) || []).length, 1);
    assert.equal((html.match(new RegExp(`data-inspector-panel="${tab}"`, "g")) || []).length, 1);
  }
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="gpuPowerSection"/);
  const gpuIdx = html.indexOf('id="gpuPowerSection"');
  const tabsIdx = html.indexOf('id="inspectorTabs"');
  assert.ok(gpuIdx >= 0 && tabsIdx > gpuIdx, "GPU block must sit above inspector tabs");
});

test("generate path no longer duplicates the prompt into Activity/log", () => {
  assert.doesNotMatch(app, /add\(\s*prompt\s*,\s*["']user["']\s*\)/);
  const sendStart = app.indexOf('$("send").onclick');
  assert.ok(sendStart >= 0);
  const body = app.slice(sendStart, sendStart + 1200);
  assert.doesNotMatch(body, /add\(\s*prompt/);
});

test("textarea and whole workspace reject native vertical resize corners", () => {
  assert.match(v081, /#prompt\s*\{[\s\S]*?resize:\s*none;/);
  assert.match(workspaceCss, /\.workspace\s*\{[\s\S]*?resize:\s*none;/);
  assert.doesNotMatch(workspaceCss, /resize:\s*vertical/);
  assert.match(style, /resize:\s*none/);
});

test("batch UI mounts into the left batchMount", () => {
  assert.match(batchUi, /\$\("batchMount"\)/);
  assert.doesNotMatch(batchUi, /insertBefore\(section,\s*output\)/);
});

test("panel resize keys are isolated from sidebar, workspace-height, and inspector keys", () => {
  assert.equal(assertPanelKeysIsolated(), true);
  assert.equal(PROMPT_HEIGHT_KEY, "h3PromptHeight:v1");
  assert.equal(MONITOR_HEIGHT_KEY, "h3MonitorHeight:v1");
  assert.equal(INSPECTOR_TAB_KEY, "h3InspectorTab:v1");
  assert.notEqual(PROMPT_HEIGHT_KEY, "h3WorkspaceHeight:v1");
  assert.notEqual(MONITOR_HEIGHT_KEY, "h3SidebarWidth:v1");
});

test("panel height clamps and stored values restore safely", () => {
  assert.equal(clampPanelHeight(50, { min: 140, maxVh: 0.55, viewportHeight: 1000, fallback: 260 }), 140);
  assert.equal(clampPanelHeight(400, { min: 140, maxVh: 0.55, viewportHeight: 1000, fallback: 260 }), 400);
  assert.equal(clampPanelHeight(900, { min: 140, maxVh: 0.55, viewportHeight: 1000, fallback: 260 }), 550);
  assert.equal(storedPanelHeight("bogus", { min: 180, maxVh: 0.5, viewportHeight: 1000, fallback: 260 }), 260);
  assert.equal(storedPanelHeight("220", { min: 180, maxVh: 0.5, viewportHeight: 1000, fallback: 260 }), 220);
});

test("inspector tab helpers normalize and persist the active tab", () => {
  const store = {
    data: {},
    getItem(key) { return this.data[key] ?? null; },
    setItem(key, value) { this.data[key] = String(value); }
  };
  assert.equal(normalizeInspectorTab("ASSET"), "asset");
  assert.equal(normalizeInspectorTab("nope"), "project");
  assert.equal(persistInspectorTab("output", store), "output");
  assert.equal(readStoredInspectorTab(store), "output");

  const root = {
    querySelectorAll(sel) {
      if (sel === "[data-inspector-tab]") {
        return [
          { getAttribute: () => "project", classList: { toggle() {} }, setAttribute() {}, tabIndex: 0 },
          { getAttribute: () => "asset", classList: { toggle() {} }, setAttribute() {}, tabIndex: -1 }
        ];
      }
      if (sel === "[data-inspector-panel]") {
        return [
          { getAttribute: () => "project", hidden: false, classList: { toggle() {} } },
          { getAttribute: () => "asset", hidden: true, classList: { toggle() {} } }
        ];
      }
      return [];
    }
  };
  assert.equal(applyInspectorTab(root, "asset"), "asset");
});

test("legacy Attività drawer is removed; session gallery and diagnostics remain", () => {
  assert.doesNotMatch(html, /id="activityDrawer"/);
  assert.doesNotMatch(html, /id="log"/);
  assert.match(html, /id="sessionGalleryList"/);
  assert.match(html, /id="monitorEvents"/);
  assert.match(html, /id="monitorTerminal"/);
  assert.match(html, /id="promptResizeHandle"/);
  assert.match(html, /id="monitorResizeHandle"/);
});

test("index loads the v0.8.1 layout modules", () => {
  assert.match(html, /workspace-v081\.css/);
  assert.match(html, /panel-resize\.mjs/);
  assert.match(html, /inspector-ui\.mjs/);
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  assert.equal(pkg.version, "0.9.0");
});
