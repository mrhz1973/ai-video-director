/**
 * Two-layer editor persistence (v0.8.1+):
 * 1) browser recovery draft for unsaved work
 * 2) debounced single-flight server autosave for saved projects
 *
 * Never submits Generate / Batch / GPU actions.
 */

export const RECOVERY_DRAFT_KEY = "h3RecoveryDraft:v1";
export const AUTOSAVE_DEBOUNCE_MS = 700;

/** Existing browser keys that must not be reused. */
export const RESERVED_BROWSER_KEYS = Object.freeze([
  "h3WorkspaceHeight:v1",
  "h3SidebarWidth:v1",
  "h3InspectorTab:v1",
  "h3PromptHeight:v1",
  "h3MonitorHeight:v1",
  "h3ActivityHeight:v1",
  "h3BatchDraft:v1:",
  "h3BatchRuntime:v1",
  "h3ClientId",
  "h3CurrentPrompt",
  "h3JobCreatedAt",
  "h3JobFirstSeenAt",
  "h3PromptHistory:v1",
  "h3LatestOutput:v1"
]);

export const SAVE_STATUS = Object.freeze({
  SAVED: "saved",
  DIRTY: "dirty",
  SAVING: "saving",
  ERROR: "error",
  LOCAL_DRAFT: "local-draft",
  RECOVERED: "recovered"
});

export function assertAutosaveKeysIsolated(key = RECOVERY_DRAFT_KEY) {
  if (RESERVED_BROWSER_KEYS.includes(key)) {
    throw new Error(`autosave key collides with reserved browser key: ${key}`);
  }
  if (String(key).startsWith("h3BatchDraft:v1")) {
    throw new Error(`autosave key collides with batch draft prefix: ${key}`);
  }
  return true;
}

export function buildRecoverySnapshot({
  label = "",
  workflowId = "",
  prompt = "",
  model = "",
  megapixels = "",
  aspect = "",
  steps = "",
  duration = "",
  seed = "",
  library = null,
  files = null,
  saved = false,
  id = ""
} = {}) {
  return {
    version: 1,
    savedAt: Date.now(),
    project: {
      id: id || "",
      label: String(label || ""),
      saved: Boolean(saved),
      workflowId: String(workflowId || ""),
      prompt: String(prompt || ""),
      settings: {
        model: String(model || ""),
        megapixels,
        aspect: String(aspect || ""),
        steps,
        duration,
        seed
      },
      library: library && typeof library === "object" ? library : { elements: [], locations: [], objects: [], audio: [] },
      files: files && typeof files === "object" ? { ...files } : {}
    }
  };
}

export function isMeaningfulRecoverySnapshot(snapshot) {
  const project = snapshot?.project;
  if (!project || typeof project !== "object") return false;
  if (project.saved && project.id) return false;
  const prompt = String(project.prompt || "").trim();
  const label = String(project.label || "").trim();
  const files = Object.values(project.files || {}).filter(Boolean);
  const library = project.library || {};
  const memberCount = ["elements", "locations", "objects", "audio"]
    .flatMap(cat => library[cat] || [])
    .reduce((sum, group) => sum + ((group.members || []).length), 0);
  return Boolean(prompt || label || files.length || memberCount);
}

export function writeRecoveryDraft(snapshot, storage = globalThis.localStorage) {
  assertAutosaveKeysIsolated(RECOVERY_DRAFT_KEY);
  if (!isMeaningfulRecoverySnapshot(snapshot)) {
    clearRecoveryDraft(storage);
    return null;
  }
  try {
    storage?.setItem?.(RECOVERY_DRAFT_KEY, JSON.stringify(snapshot));
  } catch { /* browser-local best effort */ }
  return snapshot;
}

export function readRecoveryDraft(storage = globalThis.localStorage) {
  assertAutosaveKeysIsolated(RECOVERY_DRAFT_KEY);
  try {
    const raw = storage?.getItem?.(RECOVERY_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isMeaningfulRecoverySnapshot(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearRecoveryDraft(storage = globalThis.localStorage) {
  try { storage?.removeItem?.(RECOVERY_DRAFT_KEY); } catch { /* ignore */ }
}

/**
 * Single-flight autosave controller for PUT /api/projects/<id>.
 * Pure coordination: the caller supplies saveFn(payload) and latestPayload().
 */
export function createAutosaveController({
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
  saveFn,
  latestPayload,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  if (typeof saveFn !== "function") throw new Error("saveFn required");
  if (typeof latestPayload !== "function") throw new Error("latestPayload required");

  let timer = null;
  let inFlight = false;
  let pendingAfter = false;
  let generation = 0;
  let lastError = null;
  let status = SAVE_STATUS.SAVED;

  const listeners = new Set();
  const emit = () => {
    for (const listener of listeners) listener({ status, lastError, inFlight, pendingAfter });
  };

  const run = async () => {
    if (inFlight) {
      pendingAfter = true;
      return;
    }
    inFlight = true;
    pendingAfter = false;
    status = SAVE_STATUS.SAVING;
    const myGen = ++generation;
    const payload = latestPayload();
    emit();
    try {
      await saveFn(payload);
      if (myGen === generation) {
        lastError = null;
        status = SAVE_STATUS.SAVED;
      }
    } catch (error) {
      if (myGen === generation) {
        lastError = error;
        status = SAVE_STATUS.ERROR;
      }
    } finally {
      inFlight = false;
      emit();
      if (pendingAfter) {
        pendingAfter = false;
        status = SAVE_STATUS.DIRTY;
        emit();
        await run();
      }
    }
  };

  return {
    getStatus: () => status,
    getLastError: () => lastError,
    isInFlight: () => inFlight,
    hasPending: () => pendingAfter,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markDirty() {
      status = SAVE_STATUS.DIRTY;
      emit();
      if (timer) clearTimeoutFn(timer);
      timer = setTimeoutFn(() => {
        timer = null;
        run();
      }, debounceMs);
    },
    async flush() {
      if (timer) {
        clearTimeoutFn(timer);
        timer = null;
      }
      await run();
    },
    reset(nextStatus = SAVE_STATUS.SAVED) {
      if (timer) {
        clearTimeoutFn(timer);
        timer = null;
      }
      pendingAfter = false;
      lastError = null;
      status = nextStatus;
      emit();
    }
  };
}

export function formatSaveStatusLabel(status, { clockLabel = "" } = {}) {
  switch (status) {
    case SAVE_STATUS.SAVING:
      return "Salvataggio…";
    case SAVE_STATUS.DIRTY:
      return "Modificato";
    case SAVE_STATUS.ERROR:
      return "Errore salvataggio";
    case SAVE_STATUS.LOCAL_DRAFT:
      return "Bozza locale";
    case SAVE_STATUS.RECOVERED:
      return "Bozza recuperata";
    case SAVE_STATUS.SAVED:
    default:
      return clockLabel ? `✓ Salvato ${clockLabel}` : "✓ Salvato";
  }
}
