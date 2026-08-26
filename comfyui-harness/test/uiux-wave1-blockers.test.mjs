/**
 * Issue #88 continuation — orchestrator blockers:
 * 1) real-surface tooltip inventory
 * 2) mixed terminal CODA semantics
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  QUEUE_ENTRY_STATE,
  QUEUE_OVERALL_STATE
} from "../lib/batch-queue-plan-core.mjs";
import { formatCodaTerminalSummary } from "../public/batch-queue-progress.mjs";
import {
  CONTROL_HELP,
  applyStaticControlHelp,
  applyOperatorHelp,
  controlsMissingHelp,
  inventoryActionControls
} from "../public/control-help.mjs";
import {
  createTooltipController,
  getSharedTooltipController,
  resetSharedTooltipControllerForTests,
  setControlHelp
} from "../public/tooltip.mjs";
import { createSessionClipCard } from "../public/session-gallery-dom.mjs";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

function entry(name, state, jobCount, id = name) {
  return {
    queueEntryId: id,
    name,
    state,
    snapshot: { items: Array.from({ length: jobCount }, (_, i) => ({ seed: String(i) })) }
  };
}

function makeDom() {
  const byId = new Map();
  const childrenOf = new WeakMap();
  function kids(el) {
    if (!childrenOf.has(el)) childrenOf.set(el, []);
    return childrenOf.get(el);
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
      insertBefore(node, ref) {
        const list = kids(el);
        const idx = ref ? list.indexOf(ref) : -1;
        node.parentNode = el;
        if (idx >= 0) list.splice(idx, 0, node);
        else list.push(node);
        return node;
      },
      querySelector(sel) { return queryAll(el, sel)[0] || null; },
      querySelectorAll(sel) { return queryAll(el, sel); },
      closest(sel) {
        let node = el;
        while (node) {
          if (sel === "[data-help-wrap='1']" && node.getAttribute?.("data-help-wrap") === "1") return node;
          node = node.parentNode;
        }
        return null;
      },
      contains(other) { return kids(el).includes(other); },
      setAttribute(name, value) {
        attrs.set(name, String(value));
        if (name === "id") byId.set(String(value), el);
      },
      getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
      removeAttribute(name) { attrs.delete(name); },
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect() {
        return { top: 10, left: 10, right: 80, bottom: 40, width: 70, height: 30 };
      }
    };
    return el;
  }
  function match(el, sel) {
    if (sel === "button") return el.tagName === "BUTTON";
    if (sel === "summary") return el.tagName === "SUMMARY";
    if (sel === "a[href]") return el.tagName === "A" && Boolean(el.href || el.getAttribute?.("href"));
    if (sel === "[role='button']") return el.getAttribute?.("role") === "button";
    if (sel.startsWith("#")) return el.id === sel.slice(1);
    if (sel.startsWith(".")) return String(el.className || "").split(/\s+/).includes(sel.slice(1));
    if (sel.includes("data-category")) return Boolean(el.getAttribute?.("data-category"));
    if (sel.includes("data-gpu-power-mode")) return Boolean(el.getAttribute?.("data-gpu-power-mode"));
    if (sel.includes("data-workflow-view")) return Boolean(el.getAttribute?.("data-workflow-view"));
    if (sel.includes("activity-drawer")) return String(el.className || "").includes("activity-drawer") || el.tagName === "SUMMARY";
    if (sel.includes("asset-library-details")) return String(el.className || "").includes("asset-library-details") || el.tagName === "SUMMARY";
    if (sel.includes("batch-advanced-actions")) return String(el.className || "").includes("batch-advanced-actions") || el.tagName === "SUMMARY";
    if (sel.includes("outputSettingsDetails")) return el.id === "outputSettingsDetails" || el.tagName === "SUMMARY";
    return false;
  }
  function queryAll(root, sel) {
    const parts = sel.split(",").map(s => s.trim());
    const out = [];
    const walk = node => {
      for (const child of kids(node)) {
        if (parts.some(p => match(child, p))) out.push(child);
        walk(child);
      }
    };
    walk(root);
    // Also support direct child selectors like "#outputSettingsDetails > summary"
    if (sel.includes(">")) {
      const [left, right] = sel.split(">").map(s => s.trim());
      const parents = left.startsWith("#")
        ? [byId.get(left.slice(1))].filter(Boolean)
        : queryAll(root, left);
      const found = [];
      for (const parent of parents) {
        for (const child of kids(parent)) {
          if (match(child, right)) found.push(child);
        }
      }
      return found;
    }
    return out;
  }
  const body = createElement("body");
  const documentRef = {
    body,
    createElement,
    getElementById(id) { return byId.get(String(id)) || null; },
    querySelector(sel) {
      if (sel.includes(">")) return queryAll(body, sel)[0] || null;
      if (sel.startsWith("#") && !sel.includes(" ") && !sel.includes(".")) {
        return byId.get(sel.slice(1)) || null;
      }
      return queryAll(body, sel)[0] || null;
    },
    querySelectorAll(sel) { return queryAll(body, sel); },
    addEventListener() {},
    removeEventListener() {},
    documentElement: { clientWidth: 1280, clientHeight: 720 }
  };
  return { documentRef, createElement, byId, body };
}

test("CODA terminal: all completed", () => {
  const result = formatCodaTerminalSummary({
    entries: [entry("A", QUEUE_ENTRY_STATE.COMPLETED, 3), entry("B", QUEUE_ENTRY_STATE.COMPLETED, 2)],
    overallState: QUEUE_OVERALL_STATE.COMPLETED
  });
  assert.equal(result.heading, "✓ CODA COMPLETATA");
  assert.equal(result.text, "5 job completati");
  assert.equal(result.state, "completed");
  assert.equal(result.terminal, true);
});

test("CODA terminal: completed + failed", () => {
  const result = formatCodaTerminalSummary({
    entries: [entry("A", QUEUE_ENTRY_STATE.COMPLETED, 2), entry("B", QUEUE_ENTRY_STATE.FAILED, 3)],
    overallState: QUEUE_OVERALL_STATE.COMPLETED
  });
  assert.equal(result.heading, "CODA TERMINATA CON PROBLEMI");
  assert.match(result.text, /2 completati/);
  assert.match(result.text, /3 falliti/);
  assert.doesNotMatch(result.heading, /COMPLETATA/);
  assert.equal(result.terminal, true);
});

test("CODA terminal: completed + cancelled", () => {
  const result = formatCodaTerminalSummary({
    entries: [entry("A", QUEUE_ENTRY_STATE.COMPLETED, 4), entry("B", QUEUE_ENTRY_STATE.CANCELLED, 1)],
    overallState: QUEUE_OVERALL_STATE.COMPLETED
  });
  assert.equal(result.heading, "CODA TERMINATA");
  assert.match(result.text, /4 completati/);
  assert.match(result.text, /1 annullati/);
  assert.doesNotMatch(result.heading, /COMPLETATA/);
});

test("CODA terminal: completed + failed + cancelled", () => {
  const result = formatCodaTerminalSummary({
    entries: [
      entry("A", QUEUE_ENTRY_STATE.COMPLETED, 2),
      entry("B", QUEUE_ENTRY_STATE.FAILED, 1),
      entry("C", QUEUE_ENTRY_STATE.CANCELLED, 3)
    ],
    overallState: QUEUE_OVERALL_STATE.COMPLETED
  });
  assert.equal(result.heading, "CODA TERMINATA CON PROBLEMI");
  assert.match(result.text, /2 completati/);
  assert.match(result.text, /1 falliti/);
  assert.match(result.text, /3 annullati/);
});

test("CODA terminal: recovery-required stays non-terminal success copy", () => {
  const result = formatCodaTerminalSummary({
    entries: [entry("A", QUEUE_ENTRY_STATE.RECOVERY_REQUIRED, 2)],
    overallState: QUEUE_OVERALL_STATE.RECOVERY_REQUIRED
  });
  assert.equal(result.terminal, false);
  assert.equal(result.state, "recovery-required");
  assert.doesNotMatch(result.heading, /COMPLETATA/);
});

test("CODA terminal: queued stays active", () => {
  const result = formatCodaTerminalSummary({
    entries: [
      entry("A", QUEUE_ENTRY_STATE.COMPLETED, 1),
      entry("B", QUEUE_ENTRY_STATE.QUEUED, 2)
    ],
    overallState: QUEUE_OVERALL_STATE.WAITING
  });
  assert.equal(result.terminal, false);
  assert.equal(result.state, "active");
});

test("CODA terminal: empty/idle", () => {
  const result = formatCodaTerminalSummary({
    entries: [],
    overallState: QUEUE_OVERALL_STATE.IDLE
  });
  assert.equal(result.heading, "CODA VUOTA");
  assert.equal(result.text, "Nessun lavoro da eseguire");
  assert.equal(result.terminal, true);
});

test("real surface inventory: static index + dynamic asset/coda/output controls require help", () => {
  resetSharedTooltipControllerForTests();
  const { documentRef, createElement, body } = makeDom();
  getSharedTooltipController({ documentRef, windowRef: { innerWidth: 1280, innerHeight: 720 } });

  // Static-ish Project / Workflow / SCENA / GPU / OUTPUT / Inspector tabs
  for (const id of [
    "projectNew", "projectSave", "projectSaveAs", "projectDelete",
    "promptClear", "send", "inspectorToggle", "tab-asset", "tab-input",
    "groupCreate", "gpuPowerToggle",
    "outputChooseFolder", "outputOpenFolder",
    "cloudMirrorChooseFolder", "cloudMirrorOpenFolder", "cloudMirrorAuto",
    "sessionGalleryClear", "batchQueueArm", "batchQueueResume",
    "codaFilterTutti", "codaFilterInCoda", "codaFilterInCorso", "codaFilterCompletati", "codaFilterProblemi",
    "outputViewModeGallery", "outputViewModeList",
    "inspectorOpenAssetsCoda", "inspectorOpenAssetsOutput"
  ]) {
    const isSelect = id === "cloudMirrorAuto";
    const btn = createElement(isSelect ? "input" : "button");
    btn.type = isSelect ? "checkbox" : "button";
    btn.id = id;
    if (id === "outputOpenFolder" || id === "cloudMirrorOpenFolder") btn.disabled = true;
    if (id.startsWith("codaFilter")) btn.setAttribute("data-coda-filter", "tutti");
    if (id.startsWith("outputViewMode")) btn.setAttribute("data-output-view-mode", "gallery");
    if (id.startsWith("inspectorOpen")) btn.className = "inspector-open-assets";
    body.append(btn);
  }
  const projectMore = createElement("details");
  projectMore.id = "projectMore";
  const projectMoreSummary = createElement("summary");
  projectMoreSummary.textContent = "Altro";
  projectMore.append(projectMoreSummary);
  body.append(projectMore);
  for (const id of ["outputGroupBy", "outputOrderBy", "outputWorkflowFilter", "outputSourceFilter"]) {
    const sel = createElement("select");
    sel.id = id;
    body.append(sel);
  }
  for (const [cat, label] of [
    ["elements", "Elements"],
    ["locations", "Locations"],
    ["objects", "Objects"],
    ["audio", "Audio"]
  ]) {
    const tab = createElement("button");
    tab.className = "cat-tab";
    tab.setAttribute("data-category", cat);
    tab.textContent = label;
    body.append(tab);
  }
  for (const view of ["scena", "batch", "coda", "output"]) {
    const nav = createElement("button");
    nav.setAttribute("data-workflow-view", view);
    body.append(nav);
  }
  for (const mode of ["eco", "balanced", "normal"]) {
    const gpu = createElement("button");
    gpu.setAttribute("data-gpu-power-mode", mode);
    body.append(gpu);
  }

  const outputDetails = createElement("details");
  outputDetails.id = "outputSettingsDetails";
  const outputSummary = createElement("summary");
  outputSummary.textContent = "Destinazione e nomi (Archivio locale)";
  outputDetails.append(outputSummary);
  body.append(outputDetails);

  const assetDetails = createElement("details");
  assetDetails.className = "asset-library-details";
  const assetSummary = createElement("summary");
  assetSummary.textContent = "Libreria asset";
  assetDetails.append(assetSummary);
  body.append(assetDetails);

  const advanced = createElement("details");
  advanced.className = "batch-advanced-actions";
  const advSummary = createElement("summary");
  advSummary.textContent = "⋯ Avanzate";
  advanced.append(advSummary);
  body.append(advanced);

  const runtime = createElement("summary");
  runtime.id = "batchRuntimeSummary";
  runtime.textContent = "ULTIMA ESECUZIONE";
  body.append(runtime);

  // Dynamic Asset group/member actions
  const addFile = createElement("button");
  addFile.textContent = "+ file";
  applyOperatorHelp(addFile, CONTROL_HELP.addFile, { documentRef });
  const delGroup = createElement("button");
  delGroup.textContent = "Elimina";
  applyOperatorHelp(delGroup, CONTROL_HELP.groupDelete, { documentRef });
  const up = createElement("button");
  up.textContent = "↑";
  up.disabled = true;
  applyOperatorHelp(up, CONTROL_HELP.moveUp, {
    disabledReason: CONTROL_HELP.memberMoveUpDisabled,
    documentRef
  });
  const removeMember = createElement("button");
  removeMember.textContent = "Rimuovi";
  applyOperatorHelp(removeMember, CONTROL_HELP.memberRemove, { documentRef });
  body.append(addFile, delGroup, up, removeMember);

  // Dynamic CODA actions
  const saveJob = createElement("button");
  saveJob.textContent = "Salva job";
  applyOperatorHelp(saveJob, CONTROL_HELP.queueSaveJob, { documentRef });
  const markDone = createElement("button");
  markDone.textContent = "Marca come completato";
  applyOperatorHelp(markDone, CONTROL_HELP.queueMarkCompleted, { documentRef });
  const markCancel = createElement("button");
  markCancel.textContent = "Marca come annullato";
  applyOperatorHelp(markCancel, CONTROL_HELP.queueMarkCancelled, { documentRef });
  const rename = createElement("button");
  rename.textContent = "Rinomina";
  applyOperatorHelp(rename, CONTROL_HELP.queueRename, { documentRef });
  const removeQ = createElement("button");
  removeQ.textContent = "Rimuovi";
  applyOperatorHelp(removeQ, CONTROL_HELP.queueRemove, { documentRef });
  const jobSum = createElement("summary");
  jobSum.textContent = "Job 1";
  setControlHelp(jobSum, CONTROL_HELP.queueJobDisclosure);
  const techSum = createElement("summary");
  techSum.textContent = "Dettagli tecnici";
  setControlHelp(techSum, CONTROL_HELP.queueTechDisclosure);
  body.append(saveJob, markDone, markCancel, rename, removeQ, jobSum, techSum);

  // OUTPUT gallery actions via real card builder
  const card = createSessionClipCard({
    createElement,
    createTextNode(text) { return { nodeType: 3, textContent: String(text) }; }
  }, {
    id: "1",
    filename: "clip.mp4",
    url: "/api/view?filename=clip.mp4",
    available: true,
    cloudMirror: { status: "pending" }
  });
  body.append(card);

  applyStaticControlHelp(documentRef);

  const missing = controlsMissingHelp(body);
  assert.equal(
    missing.length,
    0,
    `missing help on: ${missing.map(el => el.id || el.textContent || el.tagName).join(", ")}`
  );
  assert.ok(inventoryActionControls(body).length >= 20);

  // Newly added actionable control without help must fail inventory
  const orphan = createElement("button");
  orphan.textContent = "Nuovo controllo senza help";
  body.append(orphan);
  assert.ok(controlsMissingHelp(body).includes(orphan));
});

test("disabled keyboard help uses wrapper without enabling control", () => {
  resetSharedTooltipControllerForTests();
  const { documentRef, createElement, body } = makeDom();
  const tip = getSharedTooltipController({
    documentRef,
    windowRef: { innerWidth: 1280, innerHeight: 720 }
  });
  const btn = createElement("button");
  btn.disabled = true;
  btn.textContent = "Apri cartella";
  body.append(btn);
  applyOperatorHelp(btn, CONTROL_HELP.outputOpenFolder, {
    disabledReason: CONTROL_HELP.outputOpenFolderDisabled,
    documentRef
  });
  assert.equal(btn.disabled, true);
  const wrap = btn.parentNode;
  assert.equal(wrap.getAttribute("data-help-wrap"), "1");
  assert.equal(wrap.tabIndex, 0);
  assert.match(wrap.getAttribute("data-help"), /Nessuna cartella archivio/);
  tip.show(wrap);
  assert.equal(tip.getTip().hidden, false);
  assert.match(tip.getTip().textContent, /Nessuna cartella archivio/);
});

test("source wiring still includes Wave 1 contracts", () => {
  const queueUi = readFileSync(path.join(PUBLIC, "batch-queue-ui.mjs"), "utf8");
  assert.match(queueUi, /formatCodaTerminalSummary/);
  assert.match(queueUi, /queueSaveJob|Marca come completato/);
  assert.match(queueUi, /applyOperatorHelp/);
  const app = readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  assert.match(app, /CONTROL_HELP\.addFile|applyOperatorHelp\(addBtn/);
  assert.match(app, /CONTROL_HELP\.groupDelete|applyOperatorHelp\(delBtn/);
  const help = readFileSync(path.join(PUBLIC, "control-help.mjs"), "utf8");
  assert.match(help, /catElements/);
  assert.match(help, /outputSettingsDisclosure/);
  assert.match(help, /queueMarkCancelled/);
});
