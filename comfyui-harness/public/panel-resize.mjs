/** Explicit vertical resize for prompt and monitor panels (v0.10.0). */

export const PROMPT_HEIGHT_KEY = "h3PromptHeight:v1";
export const MONITOR_HEIGHT_KEY = "h3MonitorHeight:v1";

export const PROMPT_DEFAULT = 260;
export const PROMPT_MIN = 140;
export const PROMPT_MAX_VH = 0.55;

export const MONITOR_DEFAULT = 260;
export const MONITOR_MIN = 180;
export const MONITOR_MAX_VH = 0.5;

/** Existing keys that must never be reused by panel resize. */
export const RESERVED_LAYOUT_KEYS = Object.freeze([
  "h3WorkspaceHeight:v1",
  "h3SidebarWidth:v1",
  "h3InspectorTab:v1"
]);

export function clampPanelHeight(value, {
  min,
  maxVh,
  viewportHeight = typeof window !== "undefined" ? window.innerHeight : 900,
  fallback
} = {}) {
  const viewport = Number(viewportHeight);
  const max = Number.isFinite(viewport) && viewport > 0
    ? Math.max(min, Math.round(viewport * maxVh))
    : Math.max(min, fallback);
  const requested = Number(value);
  if (!Number.isFinite(requested)) return Math.min(max, fallback);
  return Math.max(min, Math.min(max, Math.round(requested)));
}

export function storedPanelHeight(raw, options) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return clampPanelHeight(options.fallback, options);
  }
  return clampPanelHeight(numeric, options);
}

export function assertPanelKeysIsolated(keys = [
  PROMPT_HEIGHT_KEY,
  MONITOR_HEIGHT_KEY
]) {
  for (const key of keys) {
    if (RESERVED_LAYOUT_KEYS.includes(key)) {
      throw new Error(`panel resize key collides with reserved layout key: ${key}`);
    }
  }
  return true;
}

function readKey(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeKey(key, value) {
  try { localStorage.setItem(key, String(Math.round(value))); } catch { /* browser-local */ }
}

function bindVerticalResize({
  target,
  handle,
  storageKey,
  min,
  maxVh,
  fallback,
  apply
}) {
  if (!target || !handle) return;

  const options = () => ({
    min,
    maxVh,
    viewportHeight: window.innerHeight,
    fallback
  });

  const setHeight = value => {
    const height = clampPanelHeight(value, options());
    apply(height);
    writeKey(storageKey, height);
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute("aria-valuemax", String(Math.round(window.innerHeight * maxVh)));
    handle.setAttribute("aria-valuenow", String(height));
    return height;
  };

  setHeight(storedPanelHeight(readKey(storageKey), options()));

  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  handle.addEventListener("pointerdown", event => {
    dragging = true;
    startY = event.clientY;
    startHeight = target.getBoundingClientRect().height;
    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add("panel-height-resizing");
    event.preventDefault();
  });

  handle.addEventListener("pointermove", event => {
    if (!dragging) return;
    setHeight(startHeight + (event.clientY - startY));
  });

  const finish = event => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
    document.body.classList.remove("panel-height-resizing");
  };

  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);

  handle.addEventListener("dblclick", () => setHeight(fallback));

  handle.addEventListener("keydown", event => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const current = target.getBoundingClientRect().height;
    const delta = event.key === "ArrowUp" ? -16 : 16;
    setHeight(current + delta);
  });

  window.addEventListener("resize", () => {
    setHeight(target.getBoundingClientRect().height);
  });
}

export function isCustomPromptResizeEnabled(width = typeof window !== "undefined" ? window.innerWidth : 1200) {
  return Number(width) > 800;
}

export function initPanelResize() {
  assertPanelKeysIsolated();

  const prompt = document.getElementById("prompt");
  const promptHandle = document.getElementById("promptResizeHandle");
  if (isCustomPromptResizeEnabled()) {
    bindVerticalResize({
      target: prompt,
      handle: promptHandle,
      storageKey: PROMPT_HEIGHT_KEY,
      min: PROMPT_MIN,
      maxVh: PROMPT_MAX_VH,
      fallback: PROMPT_DEFAULT,
      apply: height => {
        if (prompt) prompt.style.height = `${height}px`;
      }
    });
  } else if (prompt) {
    prompt.style.height = "";
    prompt.style.minHeight = "160px";
    if (promptHandle) promptHandle.setAttribute("aria-disabled", "true");
  }

  const monitor = document.getElementById("renderMonitor");
  bindVerticalResize({
    target: monitor,
    handle: document.getElementById("monitorResizeHandle"),
    storageKey: MONITOR_HEIGHT_KEY,
    min: MONITOR_MIN,
    maxVh: MONITOR_MAX_VH,
    fallback: MONITOR_DEFAULT,
    apply: height => {
      if (monitor) {
        monitor.style.height = `${height}px`;
        monitor.style.minHeight = `${MONITOR_MIN}px`;
        monitor.style.maxHeight = "none";
        monitor.style.flex = "0 0 auto";
      }
    }
  });
}

if (typeof window !== "undefined") {
  initPanelResize();
}
