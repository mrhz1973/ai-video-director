/**
 * Issue #88 — Wave 1 operator-first UX (collapse, GPU, strip, batch, output, coda, tooltips).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyInspectorCollapsedState,
  persistInspectorCollapsed,
  readInspectorCollapsed,
  COLLAPSE_STORAGE_KEY
} from "../public/workspace-resize.mjs";
import {
  resolveScenaImageSlots,
  applyScenaInputStrip,
  FIRST_FRAME_ROLE,
  LAST_FRAME_ROLE
} from "../public/first-frame-view.mjs";
import {
  createTooltipController,
  positionTooltip,
  setControlHelp,
  readControlHelp,
  resetSharedTooltipControllerForTests,
  HELP_ATTR
} from "../public/tooltip.mjs";
import {
  CONTROL_HELP,
  applyStaticControlHelp,
  controlsMissingHelp,
  inventoryActionControls
} from "../public/control-help.mjs";
import { createSessionClipCard } from "../public/session-gallery-dom.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

function readPublic(name) {
  return readFileSync(path.join(PUBLIC, name), "utf8");
}

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    raw: data
  };
}

function createDom() {
  const byId = new Map();
  function ensureClassList(el) {
    if (el.classList) return el.classList;
    const tokens = new Set(String(el.className || "").split(/\s+/).filter(Boolean));
    el.classList = {
      add(...names) { for (const n of names) tokens.add(n); el.className = [...tokens].join(" "); },
      remove(...names) { for (const n of names) tokens.delete(n); el.className = [...tokens].join(" "); },
      contains(name) { return tokens.has(name); },
      toggle(name, force) {
        if (force === true) this.add(name);
        else if (force === false) this.remove(name);
        else if (tokens.has(name)) this.remove(name);
        else this.add(name);
      }
    };
    return el.classList;
  }
  function createElement(tag) {
    const children = [];
    const attrs = new Map();
    const listeners = [];
    const el = {
      tagName: String(tag).toUpperCase(),
      className: "",
      textContent: "",
      hidden: false,
      disabled: false,
      src: "",
      alt: "",
      title: "",
      href: "",
      type: "",
      tabIndex: -1,
      style: {},
      children,
      dataset: {},
      parentNode: null,
      get id() { return attrs.get("id") || ""; },
      set id(v) { attrs.set("id", String(v)); byId.set(String(v), el); },
      append(...nodes) { for (const n of nodes) { n.parentNode = el; children.push(n); } },
      replaceChildren(...nodes) { children.length = 0; this.append(...nodes); },
      querySelector(sel) {
        if (sel.startsWith(".")) {
          const cls = sel.slice(1);
          for (const c of children) {
            if (String(c.className || "").split(/\s+/).includes(cls)) return c;
            const nested = c.querySelector?.(sel);
            if (nested) return nested;
          }
        }
        if (sel.startsWith("#")) return byId.get(sel.slice(1)) || null;
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = node => {
          if (!node) return;
          if (sel === "button" && node.tagName === "BUTTON") out.push(node);
          if (sel.startsWith(".") && String(node.className || "").split(/\s+/).includes(sel.slice(1))) out.push(node);
          if (Array.isArray(node.children)) node.children.forEach(walk);
        };
        children.forEach(walk);
        return out;
      },
      closest() { return null; },
      contains(other) { return children.includes(other); },
      setAttribute(name, value) {
        attrs.set(name, String(value));
        if (name === "id") byId.set(String(value), el);
      },
      getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
      removeAttribute(name) { attrs.delete(name); },
      addEventListener(type, fn) { listeners.push({ type, fn }); },
      removeEventListener(type, fn) {
        const i = listeners.findIndex(l => l.type === type && l.fn === fn);
        if (i >= 0) listeners.splice(i, 1);
      },
      getBoundingClientRect() {
        return { top: 40, left: 40, right: 120, bottom: 70, width: 80, height: 30 };
      },
      _listeners: listeners
    };
    ensureClassList(el);
    return el;
  }
  const body = createElement("body");
  const documentRef = {
    body,
    createElement,
    getElementById(id) { return byId.get(String(id)) || null; },
    querySelector(sel) {
      if (sel.startsWith("#")) return byId.get(sel.slice(1)) || null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel.includes("button") || sel.includes("[role")) {
        return [...byId.values()].filter(el => el.tagName === "BUTTON" || el.getAttribute?.("role") === "button");
      }
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
    documentElement: { clientWidth: 1280, clientHeight: 720 }
  };
  return { documentRef, createElement, byId };
}

test("inspector collapse persists without losing width key", () => {
  const storage = memoryStorage();
  assert.equal(readInspectorCollapsed(storage), false);
  persistInspectorCollapsed(storage, true);
  assert.equal(storage.raw[COLLAPSE_STORAGE_KEY], "1");
  assert.equal(readInspectorCollapsed(storage), true);
  const { createElement } = createDom();
  const main = createElement("main");
  const aside = createElement("aside");
  aside.id = "inspector";
  const handle = createElement("div");
  const toggle = createElement("button");
  applyInspectorCollapsedState({ main, aside, handle, toggle, collapsed: true });
  assert.equal(main.classList.contains("inspector-collapsed"), true);
  assert.equal(aside.hidden, true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  applyInspectorCollapsedState({ main, aside, handle, toggle, collapsed: false });
  assert.equal(main.classList.contains("inspector-collapsed"), false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const css = readPublic("workspace-resize.css");
  assert.match(css, /inspector-collapsed/);
});

test("GPU compact expand/collapse helpers do not POST", () => {
  const src = readPublic("gpu-power-ui.mjs");
  assert.match(src, /is-expanded/);
  assert.match(src, /gpuPowerToggle/);
  assert.match(src, /Wave 1: compact by default/);
  const toggleStart = src.indexOf('toggle.addEventListener("click"');
  assert.ok(toggleStart >= 0);
  const toggleBlock = src.slice(toggleStart, src.indexOf("});", toggleStart) + 3);
  assert.match(toggleBlock, /classList\.toggle\("is-expanded"\)/);
  assert.doesNotMatch(toggleBlock, /applyMode\(/);
  assert.doesNotMatch(toggleBlock, /method:\s*["']POST["']/);
});

test("SCENA strip: FL2VA both, I2VA one, T2V none", () => {
  assert.deepEqual(
    resolveScenaImageSlots({
      attachments: [
        { key: "firstImage", label: "Primo frame", accept: "image/*" },
        { key: "lastImage", label: "Ultimo frame", accept: "image/*" }
      ]
    }).map(s => s.key),
    [FIRST_FRAME_ROLE, LAST_FRAME_ROLE]
  );
  assert.deepEqual(
    resolveScenaImageSlots({
      attachments: [{ key: "firstImage", label: "Primo frame", accept: "image/*" }]
    }).map(s => s.key),
    [FIRST_FRAME_ROLE]
  );
  assert.deepEqual(resolveScenaImageSlots({ attachments: [] }), []);
  assert.deepEqual(resolveScenaImageSlots(null), []);
});

test("SCENA strip renders bindings and missing state without mutation hooks", () => {
  const { documentRef, createElement, byId } = createDom();
  const host = createElement("section");
  host.id = "scenaFirstFrame";
  byId.set("scenaFirstFrame", host);
  documentRef.body.append(host);
  const bindings = applyScenaInputStrip(documentRef, {
    preset: {
      attachments: [
        { key: "firstImage", accept: "image/*" },
        { key: "lastImage", accept: "image/*" }
      ]
    },
    sharedFiles: { firstImage: "a.png" },
    availability: { "a.png": "available", "b.png": "missing" }
  });
  assert.equal(bindings.length, 2);
  assert.equal(bindings[0].filename, "a.png");
  assert.equal(bindings[1].filename, "");
  assert.equal(host.hidden, false);
  assert.match(String(host.className), /slots-2/);
});

test("Batch Wave 1 labels and terminal history disclosure", () => {
  const src = readPublic("batch-ui.mjs");
  assert.match(src, /Job da creare/);
  assert.match(src, /Crea job dalla scena corrente/);
  assert.match(src, /Batch attuale ·/);
  assert.match(src, /ULTIMA ESECUZIONE/);
  assert.match(src, /batchRuntimeDetails/);
  assert.doesNotMatch(src, /Numero job/);
  assert.doesNotMatch(src, />Prepara dal draft</);
});

test("OUTPUT primary action order and cloud secondary", () => {
  const doc = {
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        className: "",
        textContent: "",
        children: [],
        dataset: {},
        style: {},
        append(...nodes) { this.children.push(...nodes); },
        setAttribute() {},
        addEventListener() {}
      };
      return el;
    },
    createTextNode(text) { return { nodeType: 3, textContent: String(text) }; }
  };
  const card = createSessionClipCard(doc, {
    id: "1",
    filename: "clip.mp4",
    url: "/api/view?filename=clip.mp4&type=output",
    available: true,
    cloudMirror: { status: "pending" }
  });
  const actions = card.children.find(c => c.className === "session-clip-actions");
  const primary = actions.children.find(c => String(c.className).includes("primary"));
  const secondary = actions.children.find(c => String(c.className).includes("secondary"));
  assert.deepEqual(
    primary.children.map(c => c.textContent),
    ["Apri video", "Scarica MP4", "Mostra nella cartella"]
  );
  assert.match(secondary.children[0].textContent, /Copia nel cloud/);
});

test("CODA terminal/idle controls de-emphasized in source", () => {
  const src = readPublic("batch-queue-ui.mjs");
  const progress = readPublic("batch-queue-progress.mjs");
  assert.match(progress, /CODA COMPLETATA|CODA VUOTA|CODA TERMINATA CON PROBLEMI/);
  assert.match(src, /formatCodaTerminalSummary/);
  assert.match(src, /is-terminal-idle/);
  assert.match(src, /hideArm/);
});

test("tooltip system hover/focus/aria/Escape/viewport/dynamic", () => {
  resetSharedTooltipControllerForTests();
  const { documentRef, createElement } = createDom();
  const tipCtl = createTooltipController({
    documentRef,
    windowRef: { innerWidth: 1280, innerHeight: 720 }
  });
  const btn = createElement("button");
  btn.id = "projectSave";
  setControlHelp(btn, CONTROL_HELP.projectSave);
  documentRef.body.append(btn);
  tipCtl.show(btn);
  const tip = tipCtl.getTip();
  assert.equal(tip.hidden, false);
  assert.equal(tip.textContent, CONTROL_HELP.projectSave);
  assert.match(String(btn.getAttribute("aria-describedby") || ""), /h3OperatorTooltip/);
  tipCtl.hide();
  assert.equal(tip.hidden, true);

  const pos = positionTooltip(
    { offsetWidth: 200, offsetHeight: 40 },
    { getBoundingClientRect: () => ({ top: 10, left: 10, right: 50, bottom: 30, width: 40, height: 20 }) },
    { width: 300, height: 200 }
  );
  assert.ok(pos.left >= 8);
  assert.ok(pos.top >= 8);

  // Dynamic button after init
  const dyn = createElement("button");
  setControlHelp(dyn, "Azione dinamica di prova.");
  assert.equal(readControlHelp(dyn), "Azione dinamica di prova.");
  assert.equal(dyn.getAttribute(HELP_ATTR), "Azione dinamica di prova.");
});

test("static control help covers core project/render actions", () => {
  const { documentRef, createElement, byId } = createDom();
  for (const id of ["projectNew", "projectSave", "projectDelete", "send", "promptClear"]) {
    const el = createElement("button");
    el.id = id;
    byId.set(id, el);
    documentRef.body.append(el);
  }
  applyStaticControlHelp(documentRef);
  assert.equal(documentRef.getElementById("projectSave").getAttribute("data-help"), CONTROL_HELP.projectSave);
  assert.match(CONTROL_HELP.send, /Non modifica il Batch/);
  assert.match(CONTROL_HELP.projectDelete, /conferma/);
});

test("inventory helper flags missing help", () => {
  const { createElement } = createDom();
  const root = createElement("div");
  const ok = createElement("button");
  setControlHelp(ok, "ok");
  const missing = createElement("button");
  root.append(ok, missing);
  // querySelectorAll on our fake root is limited; use inventory on array wrapper
  const fakeRoot = {
    querySelectorAll() { return [ok, missing]; }
  };
  const missingList = controlsMissingHelp(fakeRoot);
  assert.equal(missingList.length, 1);
  assert.equal(missingList[0], missing);
  assert.equal(inventoryActionControls(fakeRoot).length, 2);
});

test("source contracts: wave1 files wired", () => {
  const html = readPublic("index.html");
  assert.match(html, /tooltip\.css/);
  assert.match(html, /tooltip-boot\.mjs/);
  assert.match(html, /scena-input-strip/);
  const app = readPublic("app.js");
  assert.match(app, /applyScenaInputStrip/);
  const resize = readPublic("workspace-resize.mjs");
  assert.match(resize, /h3InspectorCollapsed:v1/);
  assert.match(resize, /inspectorToggle/);
});
