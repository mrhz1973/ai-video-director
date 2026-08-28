/**
 * Issue #100 — GPU expand/collapse in SCENA/BATCH/CODA/OUTPUT contexts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInspectorContext, INSPECTOR_CONTEXTS } from "../public/inspector-context.mjs";
import { syncGpuExpandUi, isGpuExpanded } from "../public/gpu-power-ui.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

function readPublic(name) {
  return readFileSync(path.join(PUBLIC, name), "utf8");
}

function createGpuDom({ compact = false, expanded = false } = {}) {
  const byId = new Map();
  function ensureClassList(el) {
    if (el.classList) return el.classList;
    const tokens = new Set(String(el.className || "").split(/\s+/).filter(Boolean));
    el.classList = {
      add(...names) { for (const n of names) tokens.add(n); el.className = [...tokens].join(" "); },
      remove(...names) { for (const n of names) tokens.delete(n); el.className = [...tokens].join(" "); },
      toggle(name, force) {
        const has = tokens.has(name);
        const next = typeof force === "boolean" ? force : !has;
        if (next) tokens.add(name); else tokens.delete(name);
        el.className = [...tokens].join(" ");
        return next;
      },
      contains(name) { return tokens.has(name); }
    };
    return el.classList;
  }
  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: "",
      hidden: false,
      textContent: "",
      attributes: new Map(),
      children: [],
      style: {},
      addEventListener() {},
      querySelectorAll() { return []; },
      closest() { return null; }
    };
    ensureClassList(el);
    return el;
  }
  const section = createElement("section");
  section.id = "gpuPowerSection";
  section.className = "gpu-power-section";
  if (compact) section.classList.add("gpu-power-context-compact");
  if (expanded) section.classList.add("is-expanded");

  const controls = createElement("div");
  controls.id = "gpuPowerControls";
  controls.hidden = true;

  const toggle = createElement("button");
  toggle.id = "gpuPowerToggle";
  toggle.setAttribute = (k, v) => toggle.attributes.set(k, v);
  toggle.getAttribute = k => toggle.attributes.get(k);

  const unavailable = createElement("div");
  unavailable.id = "gpuPowerUnavailable";
  unavailable.hidden = true;

  for (const el of [section, controls, toggle, unavailable]) {
    byId.set(el.id, el);
  }

  globalThis.document = {
    getElementById(id) { return byId.get(id) || null; },
    querySelectorAll() { return []; }
  };

  return { section, controls, toggle };
}

test("compact CSS hides controls only when not expanded", () => {
  const css = readPublic("design-system.css");
  assert.match(
    css,
    /\.gpu-power-section\.gpu-power-context-compact:not\(\.is-expanded\) \.gpu-power-controls/
  );
  assert.doesNotMatch(
    css,
    /\.gpu-power-section\.gpu-power-context-compact \.gpu-power-controls,\s*\n\.gpu-power-section\.gpu-power-context-compact #gpuPowerHelperInstructions/
  );
});

test("inspector contexts: SCENA not compact; BATCH/CODA/OUTPUT compact", () => {
  assert.equal(resolveInspectorContext("scena").gpuCompactOnly, false);
  for (const view of ["batch", "coda", "output"]) {
    assert.equal(resolveInspectorContext(view).gpuCompactOnly, true, view);
  }
  for (const view of INSPECTOR_CONTEXTS) {
    assert.ok(resolveInspectorContext(view).context);
  }
});

test("GPU expand state toggles controls visibility in compact contexts", () => {
  for (const compact of [false, true]) {
    const { section, controls, toggle } = createGpuDom({ compact, expanded: false });
    syncGpuExpandUi();
    assert.equal(isGpuExpanded(), false);
    assert.equal(controls.hidden, true);

    section.classList.add("is-expanded");
    syncGpuExpandUi();
    assert.equal(isGpuExpanded(), true);
    assert.equal(controls.hidden, false);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(toggle.textContent, "Comprimi");

    section.classList.remove("is-expanded");
    syncGpuExpandUi();
    assert.equal(controls.hidden, true);
    assert.equal(toggle.textContent, "Espandi");
  }
});

test("GPU compact expand/collapse toggle does not POST", () => {
  const src = readPublic("gpu-power-ui.mjs");
  const toggleStart = src.indexOf('toggle.addEventListener("click"');
  assert.ok(toggleStart >= 0);
  const toggleBlock = src.slice(toggleStart, src.indexOf("});", toggleStart) + 3);
  assert.match(toggleBlock, /classList\.toggle\("is-expanded"\)/);
  assert.doesNotMatch(toggleBlock, /applyMode\(/);
  assert.doesNotMatch(toggleBlock, /method:\s*["']POST["']/);
  assert.doesNotMatch(toggleBlock, /\/api\/gpu-power/);
});
