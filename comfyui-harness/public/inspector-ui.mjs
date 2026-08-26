/** Right inspector tab switching + contextual panels (v0.14.0 / Issue #92 Wave 2). */

import { resolveInspectorContext, normalizeInspectorContext } from "./inspector-context.mjs";

export const INSPECTOR_TAB_KEY = "h3InspectorTab:v1";
export const INSPECTOR_TABS = Object.freeze(["asset", "input"]);
export const INSPECTOR_FORCE_ASSETS_ATTR = "data-inspector-force-assets";

export function normalizeInspectorTab(value, fallback = "asset") {
  const key = String(value || "").trim().toLowerCase();
  // Legacy tabs (project/output) migrate to Asset — those surfaces live in SCENA/OUTPUT now.
  if (key === "project" || key === "output") return fallback;
  return INSPECTOR_TABS.includes(key) ? key : fallback;
}

export function readStoredInspectorTab(storage = globalThis.localStorage) {
  try {
    return normalizeInspectorTab(storage?.getItem?.(INSPECTOR_TAB_KEY));
  } catch {
    return "asset";
  }
}

export function persistInspectorTab(tab, storage = globalThis.localStorage) {
  const next = normalizeInspectorTab(tab);
  try { storage?.setItem?.(INSPECTOR_TAB_KEY, next); } catch { /* browser-local */ }
  return next;
}

export function applyInspectorTab(root, tab) {
  const next = normalizeInspectorTab(tab);
  const tabs = [...(root?.querySelectorAll?.("[data-inspector-tab]") || [])];
  const panels = [...(root?.querySelectorAll?.("[data-inspector-panel]") || [])];

  for (const button of tabs) {
    const active = button.getAttribute("data-inspector-tab") === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  }

  for (const panel of panels) {
    const active = panel.getAttribute("data-inspector-panel") === next;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  }

  return next;
}

function setHidden(el, hidden) {
  if (!el) return;
  el.hidden = Boolean(hidden);
}

/**
 * Apply contextual Inspector chrome for the active workflow view.
 * Collapse/width stay in workspace-resize; this only toggles content priority.
 */
export function applyInspectorContextUi(view, {
  documentRef = typeof document !== "undefined" ? document : null,
  aside = null
} = {}) {
  if (!documentRef) return resolveInspectorContext(view);
  const inspector = aside
    || documentRef.getElementById?.("inspector")
    || documentRef.querySelector?.("aside.inspector");
  const resolved = resolveInspectorContext(view);
  const forceAssets = inspector?.getAttribute?.(INSPECTOR_FORCE_ASSETS_ATTR) === "1";
  const showAssetInput = resolved.showAssetInput || forceAssets;

  documentRef.documentElement?.setAttribute?.("data-inspector-context", resolved.context);

  setHidden(documentRef.getElementById?.("panel-inspector-batch"), !resolved.showBatchContext);
  setHidden(documentRef.getElementById?.("panel-inspector-coda"), !resolved.showCodaContext);
  setHidden(documentRef.getElementById?.("panel-inspector-output"), !resolved.showOutputContext);

  const tabs = documentRef.getElementById?.("inspectorTabs");
  setHidden(tabs, !showAssetInput);

  const panelsHost = inspector?.querySelector?.(".inspector-panels");
  if (panelsHost) setHidden(panelsHost, !showAssetInput);

  if (showAssetInput && inspector) {
    applyInspectorTab(inspector, readStoredInspectorTab());
  } else if (inspector) {
    for (const panel of inspector.querySelectorAll?.("[data-inspector-panel]") || []) {
      panel.hidden = true;
      panel.classList.remove("active");
    }
  }

  const gpu = documentRef.getElementById?.("gpuPowerSection");
  if (gpu?.classList) {
    gpu.classList.toggle("gpu-power-context-compact", Boolean(resolved.gpuCompactOnly));
  }

  return { ...resolved, showAssetInput, forceAssets };
}

/**
 * Refresh BATCH inspector context from the prepared draft (display-only).
 * @param {{ items?: object[], source?: object, focusedIndex?: number }} detail
 */
export function updateInspectorBatchContext(detail = {}, {
  documentRef = typeof document !== "undefined" ? document : null
} = {}) {
  const host = documentRef?.getElementById?.("inspectorBatchContext");
  if (!host) return;
  const items = Array.isArray(detail.items) ? detail.items : [];
  const source = detail.source && typeof detail.source === "object" ? detail.source : {};
  if (!items.length) {
    host.textContent = "Nessun batch preparato. Crea job dalla Scena per vedere input comune e override.";
    return;
  }
  let index = Number(detail.focusedIndex);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    index = items.findIndex((_, i) => detail.openIndexes?.has?.(i));
    if (index < 0) index = 0;
  }
  const item = items[index] || {};
  const shared = Object.entries(source.files || {})
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `${k}: ${v}`);
  const overrides = Object.entries(item.files || {})
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `${k}: ${v}`);
  const lines = [
    `Job ${index + 1} / ${items.length}`,
    shared.length ? `Input comune: ${shared.join(" · ")}` : "Input comune: nessuno assegnato",
    overrides.length ? `Override di questo job: ${overrides.join(" · ")}` : "Override di questo job: nessuno"
  ];
  host.replaceChildren();
  const doc = documentRef;
  for (const line of lines) {
    if (typeof doc.createElement === "function") {
      const p = doc.createElement("p");
      p.className = "inspector-context-line";
      p.textContent = line;
      host.append(p);
    }
  }
  if (!host.childNodes?.length) host.textContent = lines.join(" · ");
}

export function setInspectorForceAssets(enabled, {
  documentRef = typeof document !== "undefined" ? document : null
} = {}) {
  const inspector = documentRef?.getElementById?.("inspector");
  if (!inspector) return;
  if (enabled) inspector.setAttribute(INSPECTOR_FORCE_ASSETS_ATTR, "1");
  else inspector.removeAttribute(INSPECTOR_FORCE_ASSETS_ATTR);
  const view = documentRef.documentElement?.getAttribute?.("data-workflow-view") || "scena";
  applyInspectorContextUi(view, { documentRef, aside: inspector });
}

export function initInspectorUi(root = document) {
  const aside = root.getElementById?.("inspector") || root.querySelector?.("aside.inspector") || root;
  if (!aside) return;

  let current = applyInspectorTab(aside, readStoredInspectorTab());

  const select = tab => {
    current = applyInspectorTab(aside, tab);
    persistInspectorTab(current);
  };

  for (const button of aside.querySelectorAll("[data-inspector-tab]")) {
    button.addEventListener("click", () => select(button.getAttribute("data-inspector-tab")));
  }

  const tablist = aside.querySelector("#inspectorTabs");
  tablist?.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...tablist.querySelectorAll("[data-inspector-tab]")];
    const index = buttons.findIndex(btn => btn.getAttribute("data-inspector-tab") === current);
    if (index < 0) return;
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + buttons.length) % buttons.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = buttons.length - 1;
    const next = buttons[nextIndex];
    select(next.getAttribute("data-inspector-tab"));
    next.focus();
  });

  const onWorkflowView = event => {
    const view = normalizeInspectorContext(event?.detail?.view
      || root.documentElement?.getAttribute?.("data-workflow-view")
      || "scena");
    // Leaving CODA/OUTPUT clears temporary Asset/Input reveal.
    if (view === "scena" || view === "batch") {
      aside.removeAttribute(INSPECTOR_FORCE_ASSETS_ATTR);
    }
    applyInspectorContextUi(view, { documentRef: root, aside });
  };

  root.addEventListener?.("h3-workflow-view", onWorkflowView);

  for (const btn of root.querySelectorAll?.(".inspector-open-assets") || []) {
    btn.addEventListener("click", () => {
      setInspectorForceAssets(true, { documentRef: root });
    });
  }

  const initial = normalizeInspectorContext(
    root.documentElement?.getAttribute?.("data-workflow-view") || "scena"
  );
  applyInspectorContextUi(initial, { documentRef: root, aside });
}

if (typeof window !== "undefined") {
  initInspectorUi(document);
}
