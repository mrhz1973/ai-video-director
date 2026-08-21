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

export function storedWorkspaceHeight(value, viewportHeight) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return defaultWorkspaceHeight(viewportHeight);
  return clampWorkspaceHeight(numeric, viewportHeight);
}

function readStoredHeight() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function persistHeight(value) {
  try { localStorage.setItem(STORAGE_KEY, String(Math.round(value))); } catch { /* browser-local preference only */ }
}

function applyHeight(workspace, value) {
  const height = clampWorkspaceHeight(value, window.innerHeight);
  workspace.style.height = `${height}px`;
  return height;
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
    const height = entry?.contentRect?.height;
    if (!Number.isFinite(height) || height <= 0) return;
    persistHeight(clampWorkspaceHeight(height, window.innerHeight));
  });
  observer.observe(workspace);

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

if (typeof window !== "undefined" && typeof ResizeObserver !== "undefined") initWorkspaceResize();
