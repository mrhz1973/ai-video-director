/**
 * Issue #92 Wave 2 — filters, output view, inspector context, batch chips, help inventory.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODA_FILTERS,
  CODA_FILTER_STORAGE_KEY,
  codaFilterEmptyMessage,
  codaFilterHidesUrgentRecovery,
  ensureCodaFilterShowsRecovery,
  entryMatchesCodaFilter,
  filterCodaEntries,
  filterCodaEntriesForDisplay,
  isCompactCodaEntry,
  normalizeCodaFilter,
  persistCodaFilter,
  readStoredCodaFilter
} from "../public/coda-filters.mjs";
import {
  clipTime,
  collectWorkflowFilterOptions,
  defaultOutputViewPrefs,
  filterSessionClips,
  normalizeOutputViewPrefs,
  prepareSessionClipsView,
  persistOutputViewPrefs,
  readOutputViewPrefs,
  sortSessionClips
} from "../public/output-view.mjs";
import {
  resolveInspectorContext,
  normalizeInspectorContext
} from "../public/inspector-context.mjs";
import {
  applyInspectorContextUi,
  setInspectorForceAssets,
  updateInspectorCodaContext,
  updateInspectorOutputContext
} from "../public/inspector-ui.mjs";
import { normalizeSessionOutput } from "../public/session-outputs.mjs";
import { applyWorkflowView } from "../public/workflow-nav.mjs";
import {
  buildBatchJobSummaryChips,
  jobHasInputOverrides
} from "../public/batch-core.mjs";
import {
  CONTROL_HELP,
  applyStaticControlHelp,
  assertActionControlsHaveHelp
} from "../public/control-help.mjs";
import { createSessionClipCard } from "../public/session-gallery-dom.mjs";
import {
  createTooltipController,
  getSharedTooltipController,
  resetSharedTooltipControllerForTests
} from "../public/tooltip.mjs";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const html = readFileSync(path.join(PUBLIC, "index.html"), "utf8");

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    raw: data
  };
}

function makeDom() {
  const byId = new Map();
  const childrenOf = new WeakMap();
  function kids(el) {
    if (!childrenOf.has(el)) childrenOf.set(el, []);
    return childrenOf.get(el);
  }
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
    const attrs = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
      className: "",
      textContent: "",
      hidden: false,
      disabled: false,
      tabIndex: -1,
      href: "",
      parentNode: null,
      style: {},
      dataset: {},
      get children() { return kids(el); },
      get id() { return attrs.get("id") || ""; },
      set id(v) { attrs.set("id", String(v)); byId.set(String(v), el); },
      append(...nodes) {
        for (const n of nodes) {
          n.parentNode = el;
          kids(el).push(n);
        }
      },
      replaceChildren(...nodes) {
        const current = kids(el);
        current.length = 0;
        for (const n of nodes) {
          n.parentNode = el;
          current.push(n);
        }
      },
      get childNodes() { return kids(el); },
      querySelector(sel) { return queryAll(el, sel)[0] || null; },
      querySelectorAll(sel) { return queryAll(el, sel); },
      closest() { return null; },
      contains(other) { return kids(el).includes(other); },
      setAttribute(name, value) {
        attrs.set(name, String(value));
        if (name === "id") byId.set(String(value), el);
        if (name === "class") el.className = String(value);
        ensureClassList(el);
      },
      getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
      removeAttribute(name) { attrs.delete(name); },
      addEventListener() {},
      removeEventListener() {},
      classList: null,
      getBoundingClientRect() {
        return { top: 10, left: 10, right: 80, bottom: 40, width: 70, height: 30 };
      }
    };
    ensureClassList(el);
    return el;
  }
  function match(el, sel) {
    if (sel === "button") return el.tagName === "BUTTON";
    if (sel === "summary") return el.tagName === "SUMMARY";
    if (sel === "a[href]") return el.tagName === "A" && Boolean(el.href || el.getAttribute?.("href"));
    if (sel.startsWith("#")) return el.id === sel.slice(1);
    if (sel.startsWith(".")) return String(el.className || "").split(/\s+/).includes(sel.slice(1));
    if (sel.includes("data-coda-filter")) return Boolean(el.getAttribute?.("data-coda-filter"));
    if (sel.includes("data-output-view-mode")) return Boolean(el.getAttribute?.("data-output-view-mode"));
    if (sel.includes("data-inspector-tab")) return Boolean(el.getAttribute?.("data-inspector-tab"));
    if (sel.includes("data-inspector-panel")) return Boolean(el.getAttribute?.("data-inspector-panel"));
    if (sel.includes("inspector-open-assets")) return String(el.className || "").includes("inspector-open-assets");
    if (sel.includes(">")) {
      return false;
    }
    return false;
  }
  function queryAll(root, sel) {
    if (sel.includes(">")) {
      const [left, right] = sel.split(">").map(s => s.trim());
      const parents = left.startsWith("#")
        ? [byId.get(left.slice(1))].filter(Boolean)
        : queryAll(root, left);
      const found = [];
      for (const parent of parents) {
        for (const child of kids(parent)) {
          if (match(child, right) || (right === "summary" && child.tagName === "SUMMARY")) found.push(child);
        }
      }
      return found;
    }
    const parts = sel.split(",").map(s => s.trim());
    const out = [];
    const walk = node => {
      for (const child of kids(node)) {
        if (parts.some(p => match(child, p))) out.push(child);
        walk(child);
      }
    };
    walk(root);
    return out;
  }
  const body = createElement("body");
  const documentElement = createElement("html");
  const listeners = [];
  const documentRef = {
    body,
    createElement,
    createTextNode(text) { return { nodeType: 3, textContent: String(text), parentNode: null }; },
    documentElement,
    getElementById(id) { return byId.get(String(id)) || null; },
    querySelector(sel) {
      if (sel.startsWith("#") && !sel.includes(" ") && !sel.includes(">") && !sel.includes(".")) {
        return byId.get(sel.slice(1)) || null;
      }
      return queryAll(body, sel)[0] || null;
    },
    querySelectorAll(sel) { return queryAll(body, sel); },
    addEventListener(type, fn) { listeners.push({ type, fn }); },
    removeEventListener() {},
    dispatchEvent(event) {
      for (const { type, fn } of listeners) {
        if (type === event.type) fn(event);
      }
      return true;
    }
  };
  return { documentRef, createElement, byId, body, listeners };
}

test("coda filters normalize and match states", () => {
  assert.deepEqual([...CODA_FILTERS], ["tutti", "in-coda", "in-corso", "completati", "problemi"]);
  assert.equal(normalizeCodaFilter("In-Corso"), "in-corso");
  assert.equal(normalizeCodaFilter("nope"), "tutti");
  assert.equal(entryMatchesCodaFilter({ state: "queued" }, "in-coda"), true);
  assert.equal(entryMatchesCodaFilter({ state: "running" }, "in-corso"), true);
  assert.equal(entryMatchesCodaFilter({ state: "completed" }, "completati"), true);
  assert.equal(entryMatchesCodaFilter({ state: "failed" }, "problemi"), true);
  assert.equal(isCompactCodaEntry({ state: "completed" }), true);
  assert.equal(isCompactCodaEntry({ state: "running" }), false);
});

test("coda filter is display-only and preserves empty messages", () => {
  const entries = [
    { queueEntryId: "a", state: "queued" },
    { queueEntryId: "b", state: "completed" },
    { queueEntryId: "c", state: "failed" }
  ];
  const filtered = filterCodaEntries(entries, "completati");
  assert.equal(filtered.length, 1);
  assert.equal(entries.length, 3);
  assert.match(codaFilterEmptyMessage("problemi"), /problemi/i);
  const storage = memoryStorage();
  persistCodaFilter("in-coda", storage);
  assert.equal(readStoredCodaFilter(storage), "in-coda");
});

test("output-view prepareSessionClipsView filters groups and orders", () => {
  const clips = [
    { id: "1", completedAt: "2026-08-26T10:00:00Z", workflowId: "wf-a", workflowLabel: "A", source: "single", jobLabel: "z" },
    { id: "2", completedAt: "2026-08-26T12:00:00Z", workflowId: "wf-b", workflowLabel: "B", source: "batch", jobLabel: "a" },
    { id: "3", completedAt: "2026-08-26T11:00:00Z", workflowId: "wf-a", workflowLabel: "A", source: "batch", jobLabel: "m" }
  ];
  const view = prepareSessionClipsView(clips, {
    mode: "list",
    groupBy: "workflow",
    orderBy: "newest",
    workflowFilter: "wf-a",
    sourceFilter: ""
  });
  assert.equal(view.prefs.mode, "list");
  assert.equal(view.filtered.length, 2);
  assert.equal(view.filtered[0].id, "3");
  assert.equal(view.groups.length, 1);
  assert.equal(view.groups[0].key, "wf-a");
  assert.equal(collectWorkflowFilterOptions(clips).length, 2);
  assert.equal(sortSessionClips(clips, "label")[0].jobLabel, "a");
  assert.equal(filterSessionClips(clips, { sourceFilter: "batch" }).length, 2);
});

test("output view prefs persist in browser-local storage only", () => {
  const storage = memoryStorage();
  const next = persistOutputViewPrefs({ mode: "list", groupBy: "source", orderBy: "oldest" }, storage);
  assert.equal(next.mode, "list");
  assert.equal(readOutputViewPrefs(storage).groupBy, "source");
  assert.deepEqual(normalizeOutputViewPrefs({ mode: "nope" }).mode, defaultOutputViewPrefs().mode);
});

test("inspector context resolves per workflow view", () => {
  assert.equal(normalizeInspectorContext("CODA"), "coda");
  assert.equal(resolveInspectorContext("scena").showAssetInput, true);
  assert.equal(resolveInspectorContext("batch").showBatchContext, true);
  assert.equal(resolveInspectorContext("coda").showAssetInput, false);
  assert.equal(resolveInspectorContext("output").showOutputContext, true);
});

test("workflow view dispatches h3-workflow-view and inspector applies context", () => {
  const { documentRef, createElement, body, byId } = makeDom();
  for (const name of ["scena", "batch", "coda", "output"]) {
    const panel = createElement("div");
    panel.id = `view-${name}`;
    body.append(panel);
  }
  const inspector = createElement("aside");
  inspector.id = "inspector";
  body.append(inspector);
  for (const id of ["panel-inspector-batch", "panel-inspector-coda", "panel-inspector-output"]) {
    const panel = createElement("div");
    panel.id = id;
    panel.hidden = true;
    body.append(panel);
  }
  const tabs = createElement("div");
  tabs.id = "inspectorTabs";
  body.append(tabs);
  const panelsHost = createElement("div");
  panelsHost.className = "inspector-panels";
  inspector.append(panelsHost);

  const seen = [];
  documentRef.addEventListener("h3-workflow-view", event => {
    seen.push(event.detail.view);
    applyInspectorContextUi(event.detail.view, { documentRef, aside: inspector });
  });

  applyWorkflowView("coda", { documentRef, storage: memoryStorage() });
  assert.deepEqual(seen, ["coda"]);
  assert.equal(documentRef.documentElement.getAttribute("data-inspector-context"), "coda");
  assert.equal(byId.get("panel-inspector-coda").hidden, false);
  assert.equal(byId.get("inspectorTabs").hidden, true);

  setInspectorForceAssets(true, { documentRef });
  assert.equal(inspector.getAttribute("data-inspector-force-assets"), "1");
  assert.equal(byId.get("inspectorTabs").hidden, false);
});

test("buildBatchJobSummaryChips and jobHasInputOverrides", () => {
  const item = {
    duration: "5",
    megapixels: "0.7",
    aspect: "16:9",
    steps: "20",
    seed: "42",
    files: { firstImage: "override.png" }
  };
  const source = {
    workflowLabel: "I2V",
    model: "model.gguf",
    files: { firstImage: "shared.png" }
  };
  assert.equal(jobHasInputOverrides(item), true);
  assert.equal(jobHasInputOverrides({ files: {} }), false);
  const chips = buildBatchJobSummaryChips(item, source);
  assert.ok(chips.some(c => c.key === "duration" && c.value.includes("5")));
  assert.ok(chips.some(c => c.key === "inputs" && c.overridden));
  assert.ok(chips.some(c => c.key === "workflow"));
});

test("session clip list mode omits video preview", () => {
  const { documentRef, createElement } = makeDom();
  const item = {
    id: "c1",
    filename: "clip.mp4",
    url: "/media/clip.mp4",
    available: true,
    source: "single"
  };
  const gallery = createSessionClipCard(documentRef, item, { viewMode: "gallery" });
  const list = createSessionClipCard(documentRef, item, { viewMode: "list" });
  assert.match(gallery.className, /session-clip/);
  assert.doesNotMatch(gallery.className, /session-clip-list/);
  assert.match(list.className, /session-clip-list/);
  const galleryHasVideo = [...gallery.children].some(n => n.tagName === "VIDEO");
  const listHasVideo = [...list.children].some(n => n.tagName === "VIDEO");
  assert.equal(galleryHasVideo, true);
  assert.equal(listHasVideo, false);
  // silence unused
  assert.equal(createElement("div").tagName, "DIV");
});

test("index.html includes Wave 2 control IDs", () => {
  for (const id of [
    "codaFilterBar",
    "codaFilterTutti",
    "codaFilterInCoda",
    "codaFilterInCorso",
    "codaFilterCompletati",
    "codaFilterProblemi",
    "outputViewModeGallery",
    "outputViewModeList",
    "outputGroupBy",
    "outputOrderBy",
    "outputWorkflowFilter",
    "outputSourceFilter",
    "projectMore",
    "panel-inspector-batch",
    "panel-inspector-coda",
    "panel-inspector-output",
    "inspectorBatchContext",
    "inspectorCodaContext",
    "inspectorOutputContext",
    "inspectorOpenAssetsCoda",
    "inspectorOpenAssetsOutput"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /wave2\.css/);
  assert.match(html, /project-more/);
});

test("Wave 2 controls have CONTROL_HELP and inventory coverage", () => {
  resetSharedTooltipControllerForTests();
  const { documentRef, createElement, body } = makeDom();
  getSharedTooltipController({ documentRef, windowRef: { innerWidth: 1280, innerHeight: 720 } });
  createTooltipController({ documentRef, windowRef: { innerWidth: 1280, innerHeight: 720 } });

  for (const id of [
    "codaFilterTutti", "codaFilterInCoda", "codaFilterInCorso", "codaFilterCompletati", "codaFilterProblemi",
    "outputViewModeGallery", "outputViewModeList",
    "outputGroupBy", "outputOrderBy", "outputWorkflowFilter", "outputSourceFilter",
    "inspectorOpenAssetsCoda", "inspectorOpenAssetsOutput"
  ]) {
    const tag = id.startsWith("output") && !id.includes("ViewMode") ? "select" : "button";
    const el = createElement(tag);
    el.id = id;
    if (id.startsWith("codaFilter")) el.setAttribute("data-coda-filter", "tutti");
    if (id.includes("ViewMode")) el.setAttribute("data-output-view-mode", id.includes("List") ? "list" : "gallery");
    if (id.startsWith("inspectorOpen")) el.className = "inspector-open-assets";
    body.append(el);
  }
  const projectMore = createElement("details");
  projectMore.id = "projectMore";
  const summary = createElement("summary");
  summary.textContent = "Altro";
  projectMore.append(summary);
  body.append(projectMore);

  applyStaticControlHelp(documentRef);
  const missing = assertActionControlsHaveHelp(body);
  assert.equal(missing.length, 0, missing.map(el => el.id || el.textContent).join(", "));

  for (const key of [
    "codaFilterTutti", "codaFilterInCoda", "codaFilterInCorso", "codaFilterCompletati", "codaFilterProblemi",
    "outputViewModeGallery", "outputViewModeList", "outputGroupBy", "outputOrderBy",
    "outputWorkflowFilter", "outputSourceFilter", "projectMore", "inspectorOpenAssets"
  ]) {
    assert.ok(CONTROL_HELP[key], `missing CONTROL_HELP.${key}`);
    assert.match(CONTROL_HELP[key], /\S/);
  }
});

test("OUTPUT newest/oldest ordering uses numeric completedAt epochs", () => {
  const older = normalizeSessionOutput({
    filename: "a.mp4",
    url: "/media/a.mp4",
    completedAt: 1_700_000_000_000,
    workflowId: "wf",
    source: "single"
  });
  const newer = normalizeSessionOutput({
    filename: "b.mp4",
    url: "/media/b.mp4",
    completedAt: 1_700_000_100_000,
    workflowId: "wf",
    source: "batch"
  });
  assert.ok(older && newer);
  assert.equal(typeof older.completedAt, "number");
  assert.equal(typeof newer.completedAt, "number");
  assert.ok(clipTime(newer) > clipTime(older));
  assert.equal(sortSessionClips([older, newer], "newest")[0].filename, "b.mp4");
  assert.equal(sortSessionClips([older, newer], "oldest")[0].filename, "a.mp4");
  // Date.parse on a number collapses; clipTime must keep real epochs.
  assert.notEqual(clipTime(older), 0);
  assert.notEqual(clipTime(newer), 0);
});

test("restored Completati filter never hides recovery-required resolve cards", () => {
  const entries = [
    { queueEntryId: "ok", state: "completed" },
    { queueEntryId: "need", state: "recovery-required" }
  ];
  const storage = memoryStorage({ [CODA_FILTER_STORAGE_KEY]: "completati" });
  const restored = readStoredCodaFilter(storage);
  assert.equal(restored, "completati");
  assert.equal(codaFilterHidesUrgentRecovery(entries, restored), true);
  assert.equal(ensureCodaFilterShowsRecovery(entries, restored), "problemi");
  const display = filterCodaEntriesForDisplay(entries, "completati");
  assert.equal(display.some(e => e.queueEntryId === "need"), true);
  assert.equal(filterCodaEntries(entries, "completati").some(e => e.state === "recovery-required"), false);
});

test("live CODA and OUTPUT inspector context refresh from display state", () => {
  const { documentRef, createElement, body } = makeDom();
  const codaHost = createElement("div");
  codaHost.id = "inspectorCodaContext";
  body.append(codaHost);
  const outputHost = createElement("div");
  outputHost.id = "inspectorOutputContext";
  body.append(outputHost);

  updateInspectorCodaContext({
    entries: [{ queueEntryId: "a", state: "queued" }],
    filter: "in-coda",
    overallState: "idle",
    visibleCount: 1
  }, { documentRef });
  const codaText1 = [...(codaHost.childNodes || [])].map(n => n.textContent).join(" | ") || codaHost.textContent;
  assert.match(codaText1, /In coda/i);

  updateInspectorCodaContext({
    entries: [
      { queueEntryId: "a", state: "completed" },
      { queueEntryId: "b", state: "recovery-required" }
    ],
    filter: "problemi",
    overallState: "recovery-required",
    visibleCount: 1,
    recoveryCount: 1,
    armed: true,
    currentEntryName: "Batch X"
  }, { documentRef });
  const codaText2 = [...(codaHost.childNodes || [])].map(n => n.textContent).join(" | ") || codaHost.textContent;
  assert.match(codaText2, /Recupero|recovery-required/i);
  assert.match(codaText2, /Batch X/);
  assert.notEqual(codaText1, codaText2);

  updateInspectorOutputContext({
    prefs: { mode: "gallery", groupBy: "none", orderBy: "newest" },
    totalCount: 2,
    visibleCount: 2,
    archiveConfigured: false,
    cloudEnabled: false
  }, { documentRef });
  const out1 = [...(outputHost.childNodes || [])].map(n => n.textContent).join(" | ") || outputHost.textContent;
  assert.match(out1, /gallery/i);

  updateInspectorOutputContext({
    prefs: { mode: "list", groupBy: "workflow", orderBy: "oldest", sourceFilter: "batch" },
    totalCount: 5,
    visibleCount: 1,
    selectedLabel: "clip-final.mp4",
    archiveConfigured: true,
    cloudConfigured: true,
    cloudEnabled: true
  }, { documentRef });
  const out2 = [...(outputHost.childNodes || [])].map(n => n.textContent).join(" | ") || outputHost.textContent;
  assert.match(out2, /list/i);
  assert.match(out2, /clip-final\.mp4/);
  assert.match(out2, /Archivio locale: configurato/);
  assert.notEqual(out1, out2);
});

test("BATCH input override change refreshes UI for every role key", () => {
  const src = readFileSync(path.join(PUBLIC, "batch-ui.mjs"), "utf8");
  assert.doesNotMatch(
    src,
    /if\s*\(\s*role\.key\s*===\s*["']firstImage["']\s*\)\s*renderBatch\s*\(\s*\)/
  );
  assert.match(
    src,
    /setItemFileOverride\([\s\S]*?renderBatch\s*\(\s*\)/
  );
});
