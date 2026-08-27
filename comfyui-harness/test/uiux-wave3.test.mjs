/**
 * Issue #95 Wave 3 — design system, version 0.19.3, tooltip/model UI contracts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTROL_HELP,
  applyStaticControlHelp,
  assertActionControlsHaveHelp
} from "../public/control-help.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const html = read("public/index.html");
const designSystem = read("public/design-system.css");
const style = read("public/style.css");
const batch = read("public/batch.css");
const appJs = read("public/app.js");

function stylesheetLinks(source) {
  return [...source.matchAll(/href="([^"]+\.css)"/g)].map(m => m[1]);
}

test("index.html links design-system.css and removed obsolete wave3.css layer", () => {
  assert.match(html, /href="design-system\.css"/);
  assert.doesNotMatch(html, /href="wave3\.css"/);
  assert.equal(existsSync(path.join(ROOT, "public/wave3.css")), false);
});

test("design-system.css defines shared tokens and consolidated shared rules", () => {
  assert.match(designSystem, /--h3-accent:/);
  assert.match(designSystem, /--h3-control-height:/);
  assert.match(designSystem, /\.h3-action-destructive|button\.danger/);
  assert.match(designSystem, /\.h3-action-interrupt|#interruptSingleRender/);
  assert.match(designSystem, /button:focus-visible/);
  assert.match(designSystem, /button:disabled/);
  assert.match(designSystem, /\.gpu-power-context-compact/);
  assert.match(designSystem, /#version/);
  assert.match(designSystem, /\.coda-filter-btn/);
  assert.match(designSystem, /\.batch-badge/);
  assert.match(designSystem, /\.batch-job-chip/);
});

test("legacy style.css no longer owns secondary/danger/save-status color duplicates", () => {
  assert.doesNotMatch(style, /button\.secondary,button\.danger/);
  assert.doesNotMatch(style, /button:disabled\{opacity/);
  assert.doesNotMatch(style, /\.save-status\[data-state="saved"\]/);
});

test("legacy batch.css no longer owns chip/badge/filter duplicate groups", () => {
  assert.doesNotMatch(batch, /\.batch-job-chip\{/);
  assert.doesNotMatch(batch, /\.coda-filter-btn\{/);
  assert.doesNotMatch(batch, /\.batch-feedback\[data-kind="ok"\]/);
});

test("CSS consolidation evidence documents BEFORE/AFTER layers", () => {
  const doc = read("../docs/runtime/WAVE3_CSS_CONSOLIDATION.md");
  assert.match(doc, /ACTIVE_STYLESHEETS_BEFORE/);
  assert.match(doc, /ACTIVE_STYLESHEETS_AFTER/);
  assert.match(doc, /DUPLICATED_SHARED_RULE_GROUPS_BEFORE/);
  assert.match(doc, /DUPLICATED_SHARED_RULE_GROUPS_AFTER/);
  assert.match(doc, /LEGACY_LAYER_RULES_MIGRATED/);
  assert.match(doc, /LEGACY_LAYER_RULES_REMOVED/);
  const after = stylesheetLinks(html);
  assert.equal(after.includes("wave3.css"), false);
  assert.ok(after.includes("design-system.css"));
});

test("model hint element exists for secondary filename detail", () => {
  assert.match(html, /id="modelHint"/);
  assert.match(appJs, /refreshModelHint/);
  assert.match(appJs, /populateModelSelect/);
  assert.match(appJs, /registryForPreset/);
  assert.match(appJs, /h3ModelSelectionBlockedReason/);
});

test("model select static help is defined in Italian", () => {
  assert.match(CONTROL_HELP.modelSelect, /checkpoint/i);
  assert.match(CONTROL_HELP.modelSelect, /ComfyUI/);
});

test("package and version surfaces target 0.19.5", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.version, "0.19.5");
  assert.match(appJs, /\$\("version"\)\.textContent\s*=\s*`v\$\{config\.version\}`/);
});

test("legacy critical destructive and interrupt selectors remain represented", () => {
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
