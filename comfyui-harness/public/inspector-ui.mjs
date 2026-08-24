/** Right inspector tab switching (v0.14.0). Project/Output moved to primary workflow views. */

export const INSPECTOR_TAB_KEY = "h3InspectorTab:v1";
export const INSPECTOR_TABS = Object.freeze(["asset", "input"]);

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
}

if (typeof window !== "undefined") {
  initInspectorUi(document);
}
