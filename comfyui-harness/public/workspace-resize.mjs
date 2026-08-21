const STORAGE_KEY = "h3WorkspaceHeight:v1";
const DEFAULT_HEIGHT_RATIO = 0.72;
const MIN_HEIGHT = 440;
const VIEWPORT_MARGIN = 16;

const SIDEBAR_STORAGE_KEY = "h3SidebarWidth:v1";
const DEFAULT_SIDEBAR_WIDTH = 520;
const MIN_SIDEBAR_WIDTH = 360;
const MAX_SIDEBAR_WIDTH = 760;
const MIN_WORKSPACE_WIDTH = 420;
const SIDEBAR_HANDLE_WIDTH = 8;

export function clampWorkspaceHeight(value, viewportHeight, {
  minHeight = MIN_HEIGHT,
  margin = VIEWPORT_MARGIN
} = {}) {
  const viewport = Number(viewportHeight);
  const requested = Number(value);
  const maxHeight = Number.isFinite(viewport) && viewport > 0
    ? Math.max(minHeight, viewport - margin)
    : minHeight;
  if (!Number.isFinite(requested)) return Math.min(maxHeight, minHeight);
  return Math.max(minHeight, Math.min(maxHeight, Math.round(requested)));
}

export function defaultWorkspaceHeight(viewportHeight, {
  ratio = DEFAULT_HEIGHT_RATIO,
  minHeight = MIN_HEIGHT,
  margin = VIEWPORT_MARGIN
} = {}) {
  const viewport = Number(viewportHeight);
  const candidate = Number.isFinite(viewport) && viewport > 0
    ? viewport * ratio
    : minHeight;
  return clampWorkspaceHeight(candidate, viewport, { minHeight, margin });
}

export function storedWorkspaceHeight(value, viewportHeight) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return defaultWorkspaceHeight(viewportHeight);
  return clampWorkspaceHeight(numeric, viewportHeight);
}

export function borderBoxHeightFromResizeEntry(entry, fallbackHeight) {
  const borderBox = entry?.borderBoxSize;
  const box = Array.isArray(borderBox) ? borderBox[0] : borderBox;
  const blockSize = Number(box?.blockSize);
  if (Number.isFinite(blockSize) && blockSize > 0) return blockSize;
  const fallback = Number(fallbackHeight);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

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

function readStoredHeight() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function persistHeight(value) {
  try { localStorage.setItem(STORAGE_KEY, String(Math.round(value))); } catch { /* browser-local preference only */ }
}

function readStoredSidebarWidth() {
  try { return localStorage.getItem(SIDEBAR_STORAGE_KEY); } catch { return null; }
}

function persistSidebarWidth(value) {
  try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(Math.round(value))); } catch { /* browser-local preference only */ }
}

function applyHeight(workspace, value) {
  const height = clampWorkspaceHeight(value, window.innerHeight);
  workspace.style.height = `${height}px`;
  return height;
}

function applySidebarWidth(main, value) {
  const width = clampSidebarWidth(value, window.innerWidth);
  main.style.setProperty("--sidebar-width", `${width}px`);
  return width;
}

function initWorkspaceResize() {
  const workspace = document.querySelector(".workspace");
  if (!workspace) return;

  const compact = window.matchMedia("(max-width: 800px)");
  let applying = false;

  const applyPreference = () => {
    if (compact.matches) {
      workspace.style.removeProperty("height");
      return;
    }
    applying = true;
    applyHeight(workspace, storedWorkspaceHeight(readStoredHeight(), window.innerHeight));
    requestAnimationFrame(() => { applying = false; });
  };

  const observer = new ResizeObserver(entries => {
    if (applying || compact.matches) return;
    const entry = entries[0];
    const height = borderBoxHeightFromResizeEntry(entry, workspace.getBoundingClientRect().height);
    if (!Number.isFinite(height) || height <= 0) return;
    persistHeight(clampWorkspaceHeight(height, window.innerHeight));
  });
  observer.observe(workspace, { box: "border-box" });

  window.addEventListener("resize", () => {
    if (compact.matches) return;
    applying = true;
    const height = applyHeight(workspace, workspace.getBoundingClientRect().height);
    persistHeight(height);
    requestAnimationFrame(() => { applying = false; });
  });

  compact.addEventListener?.("change", applyPreference);
  applyPreference();
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
  handle.setAttribute("aria-label", "Ridimensiona il pannello Generazione");
  handle.tabIndex = 0;
  main.insertBefore(handle, aside);

  const updateAria = width => {
    const max = clampSidebarWidth(Number.POSITIVE_INFINITY, window.innerWidth);
    handle.setAttribute("aria-valuemin", String(MIN_SIDEBAR_WIDTH));
    handle.setAttribute("aria-valuemax", String(max));
    handle.setAttribute("aria-valuenow", String(Math.round(width)));
  };

  const applyPreference = () => {
    if (compact.matches) {
      main.style.removeProperty("--sidebar-width");
      return;
    }
    const width = applySidebarWidth(main, storedSidebarWidth(readStoredSidebarWidth(), window.innerWidth));
    updateAria(width);
  };

  let dragging = false;

  handle.addEventListener("pointerdown", event => {
    if (compact.matches) return;
    dragging = true;
    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add("sidebar-width-resizing");
    event.preventDefault();
  });

  handle.addEventListener("pointermove", event => {
    if (!dragging || compact.matches) return;
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
    if (compact.matches) return;
    const width = applySidebarWidth(main, DEFAULT_SIDEBAR_WIDTH);
    persistSidebarWidth(width);
    updateAria(width);
  });

  handle.addEventListener("keydown", event => {
    if (compact.matches || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const current = parseFloat(getComputedStyle(main).getPropertyValue("--sidebar-width")) || DEFAULT_SIDEBAR_WIDTH;
    const delta = event.key === "ArrowLeft" ? 20 : -20;
    const width = applySidebarWidth(main, current + delta);
    persistSidebarWidth(width);
    updateAria(width);
  });

  window.addEventListener("resize", () => {
    if (compact.matches) return;
    const width = applySidebarWidth(main, storedSidebarWidth(readStoredSidebarWidth(), window.innerWidth));
    persistSidebarWidth(width);
    updateAria(width);
  });

  compact.addEventListener?.("change", applyPreference);
  applyPreference();
}

if (typeof window !== "undefined") {
  if (typeof ResizeObserver !== "undefined") initWorkspaceResize();
  initSidebarResize();
}
