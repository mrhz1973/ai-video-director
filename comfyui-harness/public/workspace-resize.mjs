const SIDEBAR_STORAGE_KEY = "h3SidebarWidth:v1";
const COLLAPSE_STORAGE_KEY = "h3InspectorCollapsed:v1";
const DEFAULT_SIDEBAR_WIDTH = 460;
const MIN_SIDEBAR_WIDTH = 360;
const MAX_SIDEBAR_WIDTH = 760;
const MIN_WORKSPACE_WIDTH = 420;
const SIDEBAR_HANDLE_WIDTH = 8;

export { SIDEBAR_STORAGE_KEY, COLLAPSE_STORAGE_KEY };

export function clampSidebarWidth(value, viewportWidth, {
  minWidth = MIN_SIDEBAR_WIDTH,
  maxWidth = MAX_SIDEBAR_WIDTH,
  minWorkspaceWidth = MIN_WORKSPACE_WIDTH,
  handleWidth = SIDEBAR_HANDLE_WIDTH
} = {}) {
  const viewport = Number(viewportWidth);
  const requested = Number(value);
  const viewportMax = Number.isFinite(viewport) && viewport > 0
    ? viewport - minWorkspaceWidth - handleWidth
    : maxWidth;
  const effectiveMax = Math.max(minWidth, Math.min(maxWidth, viewportMax));
  const fallback = Math.min(DEFAULT_SIDEBAR_WIDTH, effectiveMax);
  if (!Number.isFinite(requested)) return fallback;
  return Math.max(minWidth, Math.min(effectiveMax, Math.round(requested)));
}

export function storedSidebarWidth(value, viewportWidth) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, viewportWidth);
  return clampSidebarWidth(numeric, viewportWidth);
}

export function readInspectorCollapsed(storage) {
  try {
    return String(storage?.getItem?.(COLLAPSE_STORAGE_KEY) || "") === "1";
  } catch {
    return false;
  }
}

export function persistInspectorCollapsed(storage, collapsed) {
  try {
    storage?.setItem?.(COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
  } catch { /* browser-local preference only */ }
}

function readStoredSidebarWidth() {
  try { return localStorage.getItem(SIDEBAR_STORAGE_KEY); } catch { return null; }
}

function persistSidebarWidth(value) {
  try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(Math.round(value))); } catch { /* browser-local preference only */ }
}

function applySidebarWidth(main, value) {
  const width = clampSidebarWidth(value, window.innerWidth);
  main.style.setProperty("--sidebar-width", `${width}px`);
  return width;
}

export function applyInspectorCollapsedState({
  main,
  aside,
  handle,
  toggle,
  collapsed
} = {}) {
  if (!main) return Boolean(collapsed);
  const next = Boolean(collapsed);
  main.classList.toggle("inspector-collapsed", next);
  if (aside) {
    aside.hidden = next;
    aside.setAttribute("aria-hidden", next ? "true" : "false");
  }
  if (handle) {
    handle.hidden = next;
    handle.setAttribute("aria-hidden", next ? "true" : "false");
  }
  if (toggle) {
    toggle.setAttribute("aria-expanded", next ? "false" : "true");
    toggle.textContent = next ? "Mostra Inspector" : "Nascondi Inspector";
  }
  return next;
}

function initSidebarResize() {
  const main = document.querySelector("main");
  const aside = main?.querySelector(":scope > aside");
  if (!main || !aside) return;

  const compact = window.matchMedia("(max-width: 800px)");
  const handle = document.createElement("div");
  handle.id = "sidebarResizeHandle";
  handle.className = "sidebar-resize-handle";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Ridimensiona il pannello Inspector");
  handle.tabIndex = 0;
  main.insertBefore(handle, aside);

  let toggle = document.getElementById("inspectorToggle");
  if (!toggle) {
    const workspace = document.getElementById("workspace");
    const nav = document.getElementById("workflowNav");
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "inspectorToggle";
    toggle.className = "secondary inspector-toggle";
    toggle.setAttribute("aria-controls", "inspector");
    if (workspace && nav) workspace.insertBefore(toggle, nav);
    else document.body.prepend(toggle);
  }

  const updateAria = width => {
    const max = clampSidebarWidth(MAX_SIDEBAR_WIDTH, window.innerWidth);
    handle.setAttribute("aria-valuemin", String(MIN_SIDEBAR_WIDTH));
    handle.setAttribute("aria-valuemax", String(max));
    handle.setAttribute("aria-valuenow", String(Math.round(width)));
  };

  let collapsed = readInspectorCollapsed(window.localStorage);

  const applyPreference = () => {
    collapsed = applyInspectorCollapsedState({
      main,
      aside,
      handle,
      toggle,
      collapsed: compact.matches ? false : collapsed
    });
    if (compact.matches || collapsed) {
      main.style.removeProperty("--sidebar-width");
      return;
    }
    const width = applySidebarWidth(main, storedSidebarWidth(readStoredSidebarWidth(), window.innerWidth));
    updateAria(width);
  };

  toggle.addEventListener("click", () => {
    if (compact.matches) return;
    collapsed = !collapsed;
    persistInspectorCollapsed(window.localStorage, collapsed);
    applyPreference();
  });

  let dragging = false;

  handle.addEventListener("pointerdown", event => {
    if (compact.matches || collapsed) return;
    dragging = true;
    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add("sidebar-width-resizing");
    event.preventDefault();
  });

  handle.addEventListener("pointermove", event => {
    if (!dragging || compact.matches || collapsed) return;
    const bounds = main.getBoundingClientRect();
    const requested = bounds.right - event.clientX - (SIDEBAR_HANDLE_WIDTH / 2);
    const width = applySidebarWidth(main, requested);
    updateAria(width);
  });

  const finish = event => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
    document.body.classList.remove("sidebar-width-resizing");
    const width = parseFloat(getComputedStyle(main).getPropertyValue("--sidebar-width"));
    if (Number.isFinite(width)) persistSidebarWidth(width);
  };

  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);

  handle.addEventListener("dblclick", () => {
    if (compact.matches || collapsed) return;
    const width = applySidebarWidth(main, DEFAULT_SIDEBAR_WIDTH);
    persistSidebarWidth(width);
    updateAria(width);
  });

  handle.addEventListener("keydown", event => {
    if (compact.matches || collapsed || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const current = parseFloat(getComputedStyle(main).getPropertyValue("--sidebar-width")) || DEFAULT_SIDEBAR_WIDTH;
    const delta = event.key === "ArrowLeft" ? 20 : -20;
    const width = applySidebarWidth(main, current + delta);
    persistSidebarWidth(width);
    updateAria(width);
  });

  window.addEventListener("resize", () => {
    applyPreference();
    if (compact.matches || collapsed) return;
    const width = applySidebarWidth(main, storedSidebarWidth(readStoredSidebarWidth(), window.innerWidth));
    persistSidebarWidth(width);
    updateAria(width);
  });

  compact.addEventListener?.("change", applyPreference);
  applyPreference();
}

if (typeof window !== "undefined") {
  initSidebarResize();
}
