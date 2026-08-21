const STORAGE_KEY = "h3WorkspaceHeight:v1";
const DEFAULT_HEIGHT_RATIO = 0.72;
const MIN_HEIGHT = 440;
const VIEWPORT_MARGIN = 16;

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

function readStoredHeight() {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function persistHeight(value) {
  try { localStorage.setItem(STORAGE_KEY, String(Math.round(value))); } catch { /* browser-local preference only */ }
}

function applyHeight(workspace, value) {
  const height = clampWorkspaceHeight(value, window.innerHeight);
  workspace.style.setProperty("--workspace-height", `${height}px`);
  return height;
}

function initWorkspaceResize() {
  const workspace = document.querySelector(".workspace");
  const handle = document.getElementById("workspaceResizeHandle");
  if (!workspace || !handle) return;

  const compact = window.matchMedia("(max-width: 800px)");

  const applyPreference = () => {
    if (compact.matches) {
      workspace.style.removeProperty("--workspace-height");
      return;
    }
    const stored = readStoredHeight();
    applyHeight(workspace, stored ?? defaultWorkspaceHeight(window.innerHeight));
  };

  let dragging = false;

  handle.addEventListener("pointerdown", event => {
    if (compact.matches) return;
    dragging = true;
    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add("workspace-resizing");
    event.preventDefault();
  });

  handle.addEventListener("pointermove", event => {
    if (!dragging || compact.matches) return;
    const top = workspace.getBoundingClientRect().top;
    applyHeight(workspace, event.clientY - top);
  });

  const finish = event => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
    document.body.classList.remove("workspace-resizing");
    persistHeight(workspace.getBoundingClientRect().height);
  };

  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);

  handle.addEventListener("dblclick", () => {
    if (compact.matches) return;
    const height = applyHeight(workspace, defaultWorkspaceHeight(window.innerHeight));
    persistHeight(height);
  });

  window.addEventListener("resize", () => {
    if (compact.matches) return;
    const height = applyHeight(workspace, workspace.getBoundingClientRect().height);
    persistHeight(height);
  });

  compact.addEventListener?.("change", applyPreference);
  applyPreference();
}

if (typeof window !== "undefined") initWorkspaceResize();
