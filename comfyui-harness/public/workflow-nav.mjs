/**
 * Primary workflow navigation: SCENA · BATCH · CODA · OUTPUT (Issue #59 / v0.14.0).
 * Presentation-only — does not touch execution lane or generation.
 */
const STORAGE_KEY = "h3WorkflowView:v1";
export const WORKFLOW_VIEWS = Object.freeze(["scena", "batch", "coda", "output"]);

export function normalizeWorkflowView(value) {
  const next = String(value || "").trim().toLowerCase();
  return WORKFLOW_VIEWS.includes(next) ? next : "scena";
}

export function applyWorkflowView(view, {
  documentRef = document,
  storage = null
} = {}) {
  const next = normalizeWorkflowView(view);
  const root = documentRef;
  for (const name of WORKFLOW_VIEWS) {
    const panel = root.getElementById?.(`view-${name}`);
    if (panel) panel.hidden = name !== next;
  }
  const nav = root.getElementById?.("workflowNav");
  if (nav) {
    for (const btn of nav.querySelectorAll?.("[data-workflow-view]") || []) {
      const active = btn.getAttribute("data-workflow-view") === next;
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.classList.toggle("active", active);
    }
  }
  try {
    (storage || globalThis.sessionStorage)?.setItem?.(STORAGE_KEY, next);
  } catch { /* ignore */ }
  root.documentElement?.setAttribute?.("data-workflow-view", next);
  try {
    root.dispatchEvent?.(new CustomEvent("h3-workflow-view", { detail: { view: next } }));
  } catch { /* ignore */ }
  return next;
}

export function readStoredWorkflowView(storage = null) {
  try {
    return normalizeWorkflowView((storage || globalThis.sessionStorage)?.getItem?.(STORAGE_KEY));
  } catch {
    return "scena";
  }
}

export function initWorkflowNav({
  documentRef = document,
  storage = null,
  initialView = null
} = {}) {
  const nav = documentRef.getElementById?.("workflowNav");
  if (!nav) return readStoredWorkflowView(storage);
  const start = normalizeWorkflowView(initialView || readStoredWorkflowView(storage));
  applyWorkflowView(start, { documentRef, storage });
  nav.addEventListener("click", event => {
    const btn = event.target?.closest?.("[data-workflow-view]");
    if (!btn || !nav.contains(btn)) return;
    applyWorkflowView(btn.getAttribute("data-workflow-view"), { documentRef, storage });
  });
  return start;
}

if (typeof window !== "undefined") {
  initWorkflowNav({ documentRef: document });
}
