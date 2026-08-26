/**
 * Issue #95 Wave 3 — design system, version 0.19.3, tooltip/model UI contracts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTROL_HELP,
  applyStaticControlHelp,
  assertActionControlsHaveHelp
} from "../public/control-help.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const html = read("public/index.html");
const designSystem = read("public/design-system.css");
const wave3 = read("public/wave3.css");
const appJs = read("public/app.js");

test("index.html links Wave 3 design-system and wave3 stylesheets", () => {
  assert.match(html, /href="design-system\.css"/);
  assert.match(html, /href="wave3\.css"/);
});

test("design-system.css defines shared tokens and action/state language", () => {
  assert.match(designSystem, /--h3-accent:/);
  assert.match(designSystem, /--h3-control-height:/);
  assert.match(designSystem, /\.h3-action-destructive|button\.danger/);
  assert.match(designSystem, /\.h3-action-interrupt|#interruptSingleRender/);
  assert.match(designSystem, /button:focus-visible/);
  assert.match(designSystem, /button:disabled/);
  assert.match(designSystem, /\.gpu-power-context-compact/);
});

test("wave3.css styles version header without inline styles", () => {
  assert.match(wave3, /#version/);
  assert.doesNotMatch(html, /id="version"[^>]*style=/);
});

test("model hint element exists for secondary filename detail", () => {
  assert.match(html, /id="modelHint"/);
  assert.match(appJs, /refreshModelHint/);
  assert.match(appJs, /populateModelSelect/);
  assert.match(appJs, /registryForPreset/);
});

test("model select static help is defined in Italian", () => {
  assert.match(CONTROL_HELP.modelSelect, /checkpoint/i);
  assert.match(CONTROL_HELP.modelSelect, /ComfyUI/);
});

test("package and version surfaces target 0.19.3", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.version, "0.19.3");
  assert.match(appJs, /\$\("version"\)\.textContent\s*=\s*`v\$\{config\.version\}`/);
});

test("legacy critical destructive and interrupt selectors remain represented", () => {
  const style = read("public/style.css");
  assert.match(style, /button\.danger|\.danger/);
  assert.match(designSystem, /h3-action-destructive|button\.danger/);
  assert.match(designSystem, /h3-action-interrupt|interruptSingleRender/);
});

test("static control help includes model select id mapping", () => {
  const helpSource = read("public/control-help.mjs");
  assert.match(helpSource, /model:\s*CONTROL_HELP\.modelSelect/);
});

test("SYSTEM panel decision evidence file exists", () => {
  const doc = read("../docs/runtime/WAVE3_SYSTEM_PANEL_DECISION.md");
  assert.match(doc, /NOT_IMPLEMENTED_BY_DESIGN/);
});

test("legacy reconciliation evidence file exists", () => {
  const doc = read("../docs/runtime/WAVE3_LEGACY_RECONCILIATION.md");
  for (const issue of ["#46", "#15", "#7", "#6", "#4"]) {
    assert.match(doc, new RegExp(issue.replace("#", "#")));
  }
});

test("Wave 1 tooltip inventory still passes on index.html actionable controls", () => {
  const byId = new Map();
  const documentRef = {
    getElementById(id) {
      return byId.get(id) || null;
    },
    querySelectorAll() {
      return [];
    }
  };
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    const id = match[1];
    byId.set(id, {
      id,
      hidden: false,
      getAttribute(name) {
        if (name === "data-help") return this._help || "";
        if (name === "aria-hidden") return null;
        if (name === "data-help-skip") return null;
        return null;
      },
      setAttribute(name, value) {
        if (name === "data-help") this._help = value;
      },
      closest() { return null; }
    });
  }
  applyStaticControlHelp(documentRef);
  const model = documentRef.getElementById("model");
  if (model) model.setAttribute("data-help", CONTROL_HELP.modelSelect);
  const missing = assertActionControlsHaveHelp(documentRef);
  assert.deepEqual(
    missing.map(el => el.id).filter(Boolean),
    [],
    `Missing help on: ${missing.map(el => el.id || el.tagName).join(", ")}`
  );
});
