import { classifyHistoryState, historyFailureLabel, promptIdPrefix, POLL_INTERVAL_MS } from "./recovery.mjs";
import { DISPLAY_MULTIPLE, MEGAPIXELS_LIMITS, formatResolutionHint, isValidMegapixels, megapixelsFromSettings } from "./resolution.mjs";
import {
  LOG_POLL_MS,
  QUEUE_POLL_MS,
  applyMonitorEvent,
  compactProgressText,
  formatElapsed,
  initialMonitorState,
  mergeTerminalEntries,
  resolveJobStartMs,
  resolveObserverClientId,
  summarizeMonitor
} from "./monitor.mjs";
import { singleInterruptActionable } from "./runtime-interrupt-ui.mjs";
import { connectionBadge } from "./connection-badge.mjs";
import { buildAssetStatusUrl, buildInputViewUrl, parseUploadResult } from "./asset-url.mjs";
import { assetStatusKey, lookupAvailability, uniqueAssetDescriptors } from "/lib/asset-ref.mjs";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  addGroup,
  addMembersToGroup,
  assignRole,
  buildSubmissionFiles,
  classifyDroppedFiles,
  clearRolesForFilenames,
  createGroup,
  createMember,
  describeGenerateBlockers,
  editorStateFromDomLike,
  emptyLibrary,
  filterFilesForActivePreset,
  findMemberByFilename,
  formatMemberOrdinalLabel,
  formatMemberPrimaryLabel,
  humanizeFilenameLabel,
  isProjectDirty,
  listAllMembers,
  memberSelectOption,
  membersCompatibleWithRole,
  normalizeProject,
  projectEditorSnapshot,
  removeGroup,
  removeMember,
  renameGroup,
  renameMemberLabel,
  reorderMembers,
  restoreModelSelection,
  roleAcceptKind
} from "/lib/projects.mjs";
import {
  AUTOSAVE_DEBOUNCE_MS,
  SAVE_STATUS,
  buildRecoverySnapshot,
  clearRecoveryDraft,
  createAutosaveController,
  formatSaveStatusLabel,
  readRecoveryDraft,
  writeRecoveryDraft
} from "./autosave.mjs";
import { normalizeDurationSeconds } from "/lib/duration.mjs";
import {
  createQueueCoordinator,
  getSharedCoordinator,
  resolveGenerateAction,
  setSharedCoordinator,
  shouldRestoreExecutionIntent,
  summarizeDeferredBatch,
  summarizeQueuedNext
} from "./queue-coordinator.mjs";
import {
  buildSingleRenderPayload,
  toSingleRenderQueueBody
} from "./single-render.mjs";
import {
  PROMPT_HISTORY_MAX,
  archivePrompt,
  clearPromptHistory,
  confirmClearPrompt,
  deletePromptHistoryItem,
  listPromptHistory,
  previewPrompt,
  restorePrompt
} from "./prompt-history.mjs";
import {
  batchJobOutputRows,
  clearLatestOutput,
  persistLatestOutput,
  readLatestOutput,
  reconstructCompletionFromOutputs
} from "./completion.mjs";
import {
  BATCH_RESTORE_ORIGIN,
  assertPersistedBatchMatches,
  findLegacyMigrationCandidate,
  resolvePostLoadBatchPersistence
} from "/lib/batch-draft.mjs";
import {
  buildDuplicateProjectPayload,
  defaultDuplicateProjectLabel
} from "/lib/project-duplicate.mjs";
import {
  LOAD_STATUS,
  auditProjectRestore,
  formatBatchRestoreLabel,
  formatLegacyBatchOfferLabel,
  formatProjectLoadLabel,
  resolveLoadStatusFromError,
  shouldCommitLoadGeneration
} from "/lib/project-load.mjs";
import {
  bindBatchProjectKey,
  clearBatchEditor,
  exportBatchDraftForProject,
  exportBatchDraftForPersistence,
  importBatchDraftFromProject,
  setBatchAssetContextProvider,
  setBatchLocalLoadSuppressed,
  setBatchPersistenceHook
} from "./batch-ui.mjs";
import {
  exportBatchQueueForPersistence,
  exportBatchQueueForProject,
  importBatchQueueFromProject,
  initBatchQueueUi,
  isBatchQueueArmed,
  syncBatchQueuePlanToServer,
  getBatchQueueRuntimeView
} from "./batch-queue-ui.mjs";
import { showAppNotice } from "./notify.mjs";
import {
  buildSingleJobCompletionAttribution,
  notifySessionOutputsChanged,
  upsertSessionOutputs
} from "./session-outputs.mjs";
const $ = id => document.getElementById(id);
let clientId = sessionStorage.getItem("h3ClientId") || crypto.randomUUID();
let config, events;
let currentPrompt = sessionStorage.getItem("h3CurrentPrompt") || undefined;
let pollTimer;
let queueTimer;
let logTimer;
let elapsedTimer;
let completing = false;
let busy = false;
let submitting = false;
let latestCompletion = null;
const coordinator = setSharedCoordinator(createQueueCoordinator({
  async submit(payload) {
    const response = await fetch("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data.prompt_id) throw new Error(data.error || JSON.stringify(data.node_errors) || "Invio fallito");
    return data;
  }
}));
void shouldRestoreExecutionIntent();
let jobCreatedAt = Number(sessionStorage.getItem("h3JobCreatedAt") || "") || null;
let jobFirstSeenAt = Number(sessionStorage.getItem("h3JobFirstSeenAt") || "") || null;
let monitorState = initialMonitorState();
let logsAvailable = null;
let singleInterruptPending = false;
let singleOwnershipControllable = false;

/** Draft project editor state (library ≠ workflow bindings). */
let draft = {
  id: "",
  label: "",
  saved: false,
  library: emptyLibrary(),
  files: {},
  availability: {},
  baseline: ""
};
let activeCategory = "elements";
let targetGroupId = null;
let saveUiState = SAVE_STATUS.LOCAL_DRAFT;
let autosaveController = null;
let applyingRecovery = false;
let persistenceReady = false;
let projectLoadGeneration = 0;
let pendingLegacyBatchCandidate = null;

const add = (text, kind = "system") => {
  const message = String(text || "");
  if (!message) return;
  const isError = kind === "error" || /^errore\b/i.test(message);
  showAppNotice(message, {
    kind: isError ? "error" : kind === "warn" ? "warn" : "info"
  });
};

function setProjectLoadStatus(state, text, { hidden = false } = {}) {
  const node = $("projectLoadStatus");
  if (!node) return;
  node.dataset.state = state;
  node.textContent = text;
  node.hidden = hidden;
}

function setBatchRestoreStatus(text, { hidden = true } = {}) {
  const node = $("batchRestoreStatus");
  if (!node) return;
  node.textContent = text;
  node.hidden = hidden;
}

function hideLegacyBatchRecover() {
  pendingLegacyBatchCandidate = null;
  const btn = $("batchLegacyRecover");
  if (btn) btn.hidden = true;
}

function editorSnapshotWithBatch() {
  return projectEditorSnapshot({
    ...currentEditorState(),
    batchDraft: exportBatchDraftForProject(),
    batchQueue: exportBatchQueueForProject()
  });
}

function collectLegacyBatchEntries() {
  const entries = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith("h3BatchDraft:v1:")) {
        entries.push({ key, raw: localStorage.getItem(key) });
      }
    }
  } catch { /* ignore */ }
  return entries;
}

async function restoreProjectBatch(normalized) {
  hideLegacyBatchRecover();
  setBatchRestoreStatus("", { hidden: true });

  if (normalized.batchDraft) {
    const result = importBatchDraftFromProject(normalized.batchDraft, { writeLocalCache: true, notify: false });
    if (result.restored) {
      setBatchRestoreStatus(formatBatchRestoreLabel({ count: result.count, restored: true }), { hidden: false });
    }
    return {
      restored: Boolean(result.restored),
      count: result.count || 0,
      origin: BATCH_RESTORE_ORIGIN.SERVER,
      needsPersistence: false
    };
  }

  const candidate = findLegacyMigrationCandidate({
    projectId: normalized.id,
    projectWorkflowId: normalized.workflowId,
    projectModel: normalized.settings?.model,
    projectFiles: normalized.files,
    storageEntries: collectLegacyBatchEntries()
  });

  if (candidate && (candidate.mode === "auto" || candidate.mode === "auto-none")) {
    const result = importBatchDraftFromProject(candidate.draft, { writeLocalCache: true, notify: false });
    if (result.restored) {
      setBatchRestoreStatus(formatBatchRestoreLabel({ count: result.count, restored: true }), { hidden: false });
    }
    return {
      restored: Boolean(result.restored),
      count: result.count || 0,
      origin: BATCH_RESTORE_ORIGIN.LEGACY_AUTO,
      needsPersistence: Boolean(result.restored)
    };
  }

  if (candidate?.mode === "offer") {
    pendingLegacyBatchCandidate = candidate;
    const btn = $("batchLegacyRecover");
    if (btn) {
      btn.hidden = false;
      btn.textContent = formatLegacyBatchOfferLabel({ count: candidate.jobCount });
    }
    clearBatchEditor({ writeLocalCache: false, notify: false });
    return {
      restored: false,
      count: 0,
      origin: BATCH_RESTORE_ORIGIN.LEGACY_OFFER,
      needsPersistence: false
    };
  }

  clearBatchEditor({ writeLocalCache: false, notify: false });
  return {
    restored: false,
    count: 0,
    origin: BATCH_RESTORE_ORIGIN.NONE,
    needsPersistence: false
  };
}

function markBaselineFromServerBatch(serverBatchDraft = null) {
  draft.baseline = projectEditorSnapshot({
    ...currentEditorState(),
    batchDraft: serverBatchDraft || null
  });
}

function clockLabel(date = new Date()) {
  return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function setSaveStatus(state, { clock = "" } = {}) {
  saveUiState = state;
  const node = $("projectSaveStatus");
  if (node) {
    node.dataset.state = state;
    node.textContent = formatSaveStatusLabel(state, { clockLabel: clock });
    node.hidden = false;
  }
  const legacy = $("projectDirty");
  if (legacy) legacy.hidden = true;
}

function captureRecoverySnapshot() {
  const state = currentEditorState();
  return buildRecoverySnapshot({
    id: draft.id,
    label: state.label,
    saved: draft.saved,
    workflowId: state.workflowId,
    prompt: state.prompt,
    model: state.settings?.model || $("model")?.value || "",
    megapixels: state.settings?.megapixels ?? $("megapixels")?.value,
    aspect: state.settings?.aspect || $("aspect")?.value || "",
    steps: state.settings?.steps ?? $("steps")?.value,
    duration: state.settings?.duration ?? $("duration")?.value,
    seed: state.settings?.seed ?? $("seed")?.value,
    library: state.library,
    files: state.files
  });
}

function persistRecoveryIfNeeded() {
  if (applyingRecovery || !persistenceReady) return;
  if (draft.saved && draft.id) {
    clearRecoveryDraft();
    return;
  }
  writeRecoveryDraft(captureRecoverySnapshot());
}

function ensureAutosaveController() {
  if (autosaveController) return autosaveController;
  autosaveController = createAutosaveController({
    debounceMs: AUTOSAVE_DEBOUNCE_MS,
    latestPayload: () => payloadFromEditor(),
    saveFn: async payload => {
      if (!(draft.saved && draft.id)) return;
      const response = await fetch(`/api/projects/${encodeURIComponent(draft.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, id: draft.id })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Autosave fallito");
      assertPersistedBatchMatches(payload.batchDraft, data.batchDraft);
      draft.label = data.label || draft.label;
      draft.library = normalizeProject(data).library;
      draft.files = { ...(data.files || {}) };
      markBaselineFromDraft();
      clearRecoveryDraft();
      refreshProjectSelect(draft.id);
    }
  });
  autosaveController.onChange(({ status, lastError }) => {
    if (!(draft.saved && draft.id)) return;
    if (status === SAVE_STATUS.SAVED) setSaveStatus(SAVE_STATUS.SAVED, { clock: clockLabel() });
    else if (status === SAVE_STATUS.SAVING) setSaveStatus(SAVE_STATUS.SAVING);
    else if (status === SAVE_STATUS.DIRTY) setSaveStatus(SAVE_STATUS.DIRTY);
    else if (status === SAVE_STATUS.ERROR) {
      setSaveStatus(SAVE_STATUS.ERROR);
      if (lastError?.message) add(`Errore salvataggio: ${lastError.message}`, "system");
      persistRecoveryIfNeeded();
    }
  });
  return autosaveController;
}

function noteEditorChange() {
  const dirty = isProjectDirty(draft.baseline, editorSnapshotWithBatch());
  const legacy = $("projectDirty");
  if (legacy) legacy.hidden = true;

  if (draft.saved && draft.id) {
    if (dirty) {
      setSaveStatus(SAVE_STATUS.DIRTY);
      if (persistenceReady) ensureAutosaveController().markDirty();
    } else if (saveUiState !== SAVE_STATUS.SAVING) {
      setSaveStatus(SAVE_STATUS.SAVED, { clock: clockLabel() });
    }
    if (persistenceReady) clearRecoveryDraft();
  } else {
    setSaveStatus(saveUiState === SAVE_STATUS.RECOVERED && !dirty ? SAVE_STATUS.RECOVERED : SAVE_STATUS.LOCAL_DRAFT);
    persistRecoveryIfNeeded();
  }
  updateGenerateButton();
  return dirty;
}

const setBusy = nextBusy => {
  busy = Boolean(nextBusy);
  updateGenerateButton();
};

function applyConnection(state) {
  const badge = connectionBadge(state);
  const top = $("connection");
  if (top) {
    top.textContent = badge.text;
    top.className = `status ${badge.className}`;
  }
  monitorState = { ...monitorState, connection: badge.text };
  renderMonitor();
}

const rememberJob = (promptId, meta = {}) => {
  currentPrompt = promptId;
  if (promptId) {
    sessionStorage.setItem("h3CurrentPrompt", promptId);
    if (!jobFirstSeenAt) {
      jobFirstSeenAt = Date.now();
      sessionStorage.setItem("h3JobFirstSeenAt", String(jobFirstSeenAt));
    }
    if (meta.createdAt) {
      jobCreatedAt = Number(meta.createdAt);
      sessionStorage.setItem("h3JobCreatedAt", String(jobCreatedAt));
    }
    monitorState = {
      ...monitorState,
      phase: monitorState.phase === "idle" ? "running" : monitorState.phase,
      promptId,
      title: workflowTitle()
    };
    startElapsedClock();
    startQueuePolling();
  } else {
    sessionStorage.removeItem("h3CurrentPrompt");
    sessionStorage.removeItem("h3JobCreatedAt");
    sessionStorage.removeItem("h3JobFirstSeenAt");
    jobCreatedAt = null;
    jobFirstSeenAt = null;
    stopPolling();
    stopQueuePolling();
    stopElapsedClock();
    const keep = ["completed", "error", "interrupted"].includes(monitorState.phase);
    monitorState = initialMonitorState({
      connection: monitorState.connection,
      terminal: monitorState.terminal,
      title: workflowTitle(),
      phase: keep ? monitorState.phase : "idle",
      progress: keep ? monitorState.progress : { kind: "idle", value: null, max: null, percent: null },
      promptId: keep ? monitorState.promptId : null,
      events: monitorState.events,
      queueRunning: monitorState.queueRunning,
      queuePending: monitorState.queuePending
    });
  }
  renderMonitor();
};

const stopPolling = () => { if (!pollTimer) return; clearInterval(pollTimer); pollTimer = undefined; };
const startPolling = () => { stopPolling(); if (!currentPrompt) return; pollTimer = setInterval(() => { pollHistory(); }, POLL_INTERVAL_MS); };
const stopQueuePolling = () => { if (!queueTimer) return; clearInterval(queueTimer); queueTimer = undefined; };
const startQueuePolling = () => { stopQueuePolling(); refreshQueueCounts(); queueTimer = setInterval(() => { refreshQueueCounts(); }, QUEUE_POLL_MS); };
const stopElapsedClock = () => { if (!elapsedTimer) return; clearInterval(elapsedTimer); elapsedTimer = undefined; };
const startElapsedClock = () => { stopElapsedClock(); updateElapsed(); elapsedTimer = setInterval(updateElapsed, 1000); };

function workflowTitle() {
  const preset = currentPreset();
  return preset?.label ? `RENDERING — ${preset.label}` : "RENDERING";
}

function updateElapsed() {
  if (!currentPrompt) {
    $("monitorElapsed").textContent = "non disponibile";
    return;
  }
  const resolved = resolveJobStartMs({
    createdAt: jobCreatedAt,
    storedStartedAt: Number(sessionStorage.getItem("h3JobFirstSeenAt") || "") || null,
    firstSeenAt: jobFirstSeenAt,
    now: Date.now()
  });
  $("monitorElapsed").textContent = formatElapsed(resolved.elapsedMs, { approximate: resolved.approximate });
}

function renderMonitor() {
  const summary = summarizeMonitor({ ...monitorState, title: monitorState.title || workflowTitle() });
  $("renderMonitor").classList.toggle("idle", summary.barMode === "idle");
  $("monitorTitle").textContent = summary.title;
  $("monitorPhase").textContent = summary.summary;
  $("monitorBarWrap").dataset.mode = summary.barMode;
  $("monitorBar").style.width = summary.barMode === "numeric" ? `${summary.percent}%` : "0%";
  $("monitorFraction").textContent = summary.barMode === "numeric" ? `${summary.value} / ${summary.max}` : "—";
  $("monitorPercent").textContent = summary.barMode === "numeric" ? `${summary.percent}%` : summary.barMode === "indeterminate" ? "Elaborazione…" : "—";
  $("monitorNode").textContent = summary.nodeLabel;
  $("monitorJob").textContent = summary.promptId ? promptIdPrefix(summary.promptId) : "—";
  const badge = connectionBadge(summary.connection);
  $("monitorConnection").textContent = badge.text;
  $("monitorConnection").className = badge.className;
  $("monitorQueue").textContent = `${summary.queueRunning ?? 0} running · ${summary.queuePending ?? 0} pending`;
  renderInterruptControl();
  renderQueueWaitCard();
  renderCompletionCard();
  const events = monitorState.events || [];
  $("monitorEvents").textContent = events.length ? events.map(item => `[${item.t}] ${item.m}`).join("\n") : "Nessun evento.";
  $("progress").textContent = compactProgressText(summary);
  updateElapsed();
}

function renderInterruptControl() {
  const btn = $("interruptSingleRender");
  if (!btn) return;
  const actionable = singleInterruptActionable({
    phase: monitorState.phase,
    promptId: currentPrompt,
    ownershipControllable: singleOwnershipControllable,
    interruptPending: singleInterruptPending
  });
  btn.hidden = !actionable.visible;
  btn.disabled = !actionable.enabled;
  btn.textContent = actionable.label;
}

async function refreshSingleOwnership() {
  if (!currentPrompt) {
    singleOwnershipControllable = false;
    return;
  }
  try {
    const response = await fetch(`/api/runtime/ownership?promptId=${encodeURIComponent(currentPrompt)}`);
    const data = await response.json();
    singleOwnershipControllable = Boolean(data.controllable);
  } catch {
    singleOwnershipControllable = false;
  }
}

async function interruptSingleRender() {
  const promptId = currentPrompt;
  if (!promptId || singleInterruptPending) return;
  const actionable = singleInterruptActionable({
    phase: monitorState.phase,
    promptId,
    ownershipControllable: singleOwnershipControllable,
    interruptPending: singleInterruptPending
  });
  if (!actionable.enabled) return;
  if (!confirm("Interrompere il render corrente?")) return;
  singleInterruptPending = true;
  monitorState = { ...monitorState, phase: "interrupting", userInterrupted: true };
  renderMonitor();
  try {
    const response = await fetch("/api/runtime/interrupt-single", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedPromptId: promptId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Interruzione non disponibile.");
    add("Interruzione richiesta.", "system");
  } catch (error) {
    singleInterruptPending = false;
    monitorState = { ...monitorState, phase: "running", userInterrupted: false };
    showAppNotice(error.message, { kind: "error" });
    renderMonitor();
  }
}

function renderQueueWaitCard() {
  const host = $("queueWaitCard");
  if (!host) return;
  host.replaceChildren();
  const next = summarizeQueuedNext(coordinator.getQueuedNext());
  const deferred = summarizeDeferredBatch(coordinator.getDeferredBatch());
  if (!next && !deferred) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  host.dataset.kind = next ? "next" : "batch";
  if (next) {
    const title = document.createElement("strong");
    title.textContent = `${next.title} · ${next.status}`;
    const detail = document.createElement("p");
    detail.textContent = next.detail;
    const preview = document.createElement("p");
    preview.textContent = next.preview || "";
    const actions = document.createElement("div");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = "Annulla";
    cancel.onclick = () => {
      coordinator.cancelQueuedNext();
      renderQueueWaitCard();
      updateGenerateButton();
    };
    const update = document.createElement("button");
    update.type = "button";
    update.className = "secondary";
    update.textContent = "Aggiorna dal draft";
    update.onclick = async () => {
      try {
        const intent = await prepareSingleRenderPayload();
        coordinator.updateQueuedNextFromDraft(toSingleRenderQueueBody(intent));
        renderQueueWaitCard();
      } catch (error) {
        add(error.message);
      }
    };
    actions.append(cancel, update);
    host.append(title, detail, preview, actions);
  } else if (deferred) {
    const title = document.createElement("strong");
    title.textContent = `${deferred.title} · ${deferred.status}`;
    const detail = document.createElement("p");
    detail.textContent = deferred.detail;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = "Annulla attesa";
    cancel.onclick = () => {
      coordinator.cancelDeferredBatch();
      window.dispatchEvent(new CustomEvent("h3-deferred-batch-cancel"));
      renderQueueWaitCard();
      updateGenerateButton();
    };
    host.append(title, detail, cancel);
  }
}

function renderCompletionCard() {
  const host = $("completionCard");
  if (!host) return;
  const card = latestCompletion;
  if (!card?.url && !card?.filename) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  host.hidden = false;
  host.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = card.title || "✓ LAVORO FINITO";
  const file = document.createElement("div");
  file.className = "completion-file";
  file.textContent = card.filename || "output";
  const meta = document.createElement("div");
  meta.className = "completion-meta";
  if (card.durationLabel) meta.append(Object.assign(document.createElement("span"), { textContent: card.durationLabel }));
  if (card.model) meta.append(Object.assign(document.createElement("span"), { textContent: card.model }));
  if (card.seed !== "" && card.seed != null) meta.append(Object.assign(document.createElement("span"), { textContent: `seed ${card.seed}` }));
  if (card.completedAt) meta.append(Object.assign(document.createElement("span"), { textContent: new Date(card.completedAt).toLocaleTimeString("it-IT", { hour12: false }) }));
  const open = document.createElement("a");
  open.className = "primary";
  open.href = card.url || "#";
  open.target = "_blank";
  open.rel = "noopener";
  open.textContent = "Apri video";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "secondary";
  dismiss.textContent = "Nascondi";
  dismiss.onclick = () => {
    latestCompletion = null;
    clearLatestOutput(sessionStorage);
    renderCompletionCard();
  };
  host.append(title, file, meta, open, dismiss);
}

function adoptSubmittedJob(data) {
  jobFirstSeenAt = Date.now();
  sessionStorage.setItem("h3JobFirstSeenAt", String(jobFirstSeenAt));
  rememberJob(data.prompt_id);
  latestCompletion = null;
  clearLatestOutput(sessionStorage);
  monitorState = {
    ...initialMonitorState({
      phase: "running",
      promptId: data.prompt_id,
      connection: monitorState.connection,
      terminal: monitorState.terminal,
      title: workflowTitle(),
      events: [{
        t: new Date().toLocaleTimeString("it-IT", { hour12: false }),
        m: `Job inviato · ${promptIdPrefix(data.prompt_id)}`,
        at: Date.now()
      }]
    })
  };
  startPolling();
  renderMonitor();
}

async function prepareSingleRenderPayload() {
  const prompt = $("prompt").value.trim();
  const megapixels = $("megapixels").value;
  if (!isValidMegapixels(megapixels)) throw new Error(`Megapixel non valido: usa un numero tra ${MEGAPIXELS_LIMITS.min} e ${MEGAPIXELS_LIMITS.max}`);
  const preset = currentPreset();
  await refreshAvailability();
  const activeKeys = (preset?.attachments || []).map(field => field.key);
  for (const input of $("attachmentFields").querySelectorAll("input[type=file]")) {
    if (input.files[0]) {
      const uploaded = await upload(input.files[0]);
      draft.files[input.dataset.key] = uploaded.filename;
    }
  }
  const built = buildSubmissionFiles({
    files: draft.files,
    library: draft.library,
    availability: draft.availability,
    activeKeys,
    requiredKeys: activeKeys
  });
  if (built.missingRequired.length) {
    const labels = built.missingRequired.map(key => (preset.attachments.find(f => f.key === key)?.label || key));
    throw new Error(`Mancano o non sono disponibili: ${labels.join(", ")}`);
  }
  return buildSingleRenderPayload({
    clientId,
    workflowId: $("workflow").value,
    prompt,
    megapixels: Number(megapixels),
    model: $("model").value,
    steps: $("steps").value,
    duration: normalizeDurationSeconds($("duration").value),
    aspect: $("aspect").value,
    seed: $("seed").value,
    files: filterFilesForActivePreset(built.files, activeKeys)
  });
}

async function submitSingleRender({ action }) {
  const intent = await prepareSingleRenderPayload();
  const queueBody = toSingleRenderQueueBody(intent);
  archiveCurrentPrompt(action);
  if (action === "queue-next") {
    return coordinator.armQueuedNext(queueBody);
  }
  return coordinator.tryImmediateGenerate(queueBody);
}

function renderPromptHistory() {
  const host = $("promptHistoryList");
  if (!host) return;
  host.replaceChildren();
  const items = listPromptHistory(localStorage);
  if (!items.length) {
    host.textContent = "Nessun prompt archiviato.";
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "prompt-history-item";
    const preview = document.createElement("p");
    preview.textContent = previewPrompt(item.prompt);
    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = [item.projectLabel, item.workflowLabel, item.savedAt ? new Date(item.savedAt).toLocaleString("it-IT") : ""].filter(Boolean).join(" · ");
    const actions = document.createElement("div");
    actions.className = "prompt-history-actions";
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Ripristina";
    restore.onclick = () => {
      const found = restorePrompt(item.id, localStorage);
      if (!found) return;
      $("prompt").value = found.prompt;
      updateDirtyFlag();
      updateGenerateButton();
      add("Prompt ripristinato dalla cronologia.");
    };
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "secondary";
    copy.textContent = "Copia";
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(item.prompt); } catch { /* ignore */ }
    };
    const del = document.createElement("button");
    del.type = "button";
    del.className = "secondary";
    del.textContent = "Elimina voce";
    del.onclick = () => {
      deletePromptHistoryItem(item.id, localStorage);
      renderPromptHistory();
    };
    actions.append(restore, copy, del);
    row.append(preview, meta, actions);
    host.append(row);
  }
}

function pushMonitorMessage(message) {
  monitorState = applyMonitorEvent(monitorState, message);
  if (message.type === "logs") renderTerminal();
  renderMonitor();
}

function renderTerminal() {
  const lines = monitorState.terminal || [];
  if (logsAvailable === false && !lines.length) {
    $("monitorTerminal").textContent = "Log terminale ComfyUI non disponibile tramite API in questa installazione.";
    return;
  }
  if (!lines.length) {
    $("monitorTerminal").textContent = logsAvailable ? "In attesa di log ComfyUI…" : "Controllo disponibilità log…";
    return;
  }
  $("monitorTerminal").textContent = lines.map(entry => {
    const time = entry.t ? String(entry.t).replace("T", " ").slice(0, 19) : "--";
    return `[${time}] ${entry.m}`.trimEnd();
  }).join("\n");
  $("monitorTerminal").scrollTop = $("monitorTerminal").scrollHeight;
}

async function refreshQueueCounts() {
  try {
    const response = await fetch("/api/active");
    if (!response.ok) return;
    const data = await response.json();
    const running = Number(data.running || 0);
    const pending = Number(data.pending || 0);
    monitorState = {
      ...monitorState,
      queueRunning: running,
      queuePending: pending
    };
    coordinator.markQueue({ running, pending });
    await refreshSingleOwnership();
    const transition = await coordinator.observeQueue({ running, pending });
    if (transition.submitted === "queued-next" && transition.result?.result?.prompt_id) {
      adoptSubmittedJob(transition.result.result);
    }
    renderMonitor();
    updateGenerateButton();
    window.dispatchEvent(new CustomEvent("h3-queue-sample", { detail: { running, pending } }));
  } catch { /* ignore */ }
}

async function refreshComfyLogs() {
  try {
    const response = await fetch("/api/comfy-logs");
    const data = await response.json();
    logsAvailable = Boolean(data.available);
    if (logsAvailable && Array.isArray(data.entries)) {
      monitorState = { ...monitorState, terminal: mergeTerminalEntries([], data.entries.slice(-200)) };
    }
    renderTerminal();
  } catch {
    logsAvailable = false;
    renderTerminal();
  }
}

async function upload(file) {
  if (!file) return undefined;
  const form = new FormData();
  form.append("image", file);
  form.append("type", "input");
  const response = await fetch("/api/upload", { method: "POST", body: form });
  if (!response.ok) throw new Error(`Upload fallito: ${response.status}`);
  const parsed = parseUploadResult(await response.json());
  if (!parsed.filename) throw new Error("Upload senza nome file");
  return parsed;
}

async function outputs() {
  if (completing || !currentPrompt) return;
  const completedPromptId = currentPrompt;
  completing = true;
  stopPolling();
  try {
    const response = await fetch(`/api/outputs?promptId=${encodeURIComponent(completedPromptId)}`);
    const items = await response.json();
    if (!response.ok) throw new Error(items.error || "Output non disponibile");
    monitorState = applyMonitorEvent(monitorState, { type: "executing", data: { node: null, prompt_id: completedPromptId } });
    monitorState = {
      ...monitorState,
      phase: "completed",
      events: [...monitorState.events, { t: new Date().toLocaleTimeString("it-IT", { hour12: false }), m: "Output disponibile", at: Date.now() }]
    };
    setBusy(false);
    rememberJob();
    renderMonitor();
    const { galleryRecords, completion } = buildSingleJobCompletionAttribution(completedPromptId, items, {
      workflowId: $("workflow")?.value || "",
      workflowLabel: currentPreset()?.label || $("workflow")?.value || "",
      model: $("model")?.value || "",
      seed: $("seed")?.value ?? "",
      duration: $("duration")?.value ?? null,
      megapixels: $("megapixels")?.value ?? "",
      aspect: $("aspect")?.value ?? "",
      steps: $("steps")?.value ?? "",
      completedAt: Date.now()
    });
    upsertSessionOutputs(sessionStorage, galleryRecords);
    notifySessionOutputsChanged();
    latestCompletion = completion;
    persistLatestOutput(latestCompletion, sessionStorage);
    renderCompletionCard();
  } catch (error) {
    setBusy(false);
    monitorState = { ...monitorState, phase: "error" };
    renderMonitor();
    showAppNotice(error.message, { kind: "error" });
    startPolling();
  } finally {
    completing = false;
  }
}

function handleHistoryFailure(history) {
  stopPolling();
  setBusy(false);
  singleInterruptPending = false;
  const label = historyFailureLabel(history, currentPrompt);
  const userInterrupted = Boolean(monitorState.userInterrupted);
  monitorState = applyMonitorEvent(monitorState, {
    type: label === "interrupted" ? "execution_interrupted" : "execution_error",
    data: { prompt_id: currentPrompt }
  });
  if (userInterrupted && label === "interrupted") {
    monitorState = { ...monitorState, userInterrupted: true };
  }
  rememberJob();
  renderMonitor();
  add(userInterrupted && label === "interrupted"
    ? "Interrotto dall'utente."
    : label === "interrupted" ? "Generazione interrotta (history)." : "Generazione fallita (history).",
  userInterrupted && label === "interrupted" ? "system" : "error");
}

async function pollHistory() {
  if (!currentPrompt || completing) return;
  try {
    const response = await fetch(`/api/history?promptId=${encodeURIComponent(currentPrompt)}`);
    const data = await response.json();
    if (!response.ok) return;
    const state = classifyHistoryState(data, currentPrompt);
    if (state === "completed") await outputs();
    else if (state === "failed") handleHistoryFailure(data);
  } catch { /* ignore */ }
}

async function handleMessage(event) {
  const message = JSON.parse(event.data);
  if (message.data?.prompt_id && currentPrompt && message.data.prompt_id !== currentPrompt) return;
  if (message.type === "logs") {
    pushMonitorMessage(message);
    return;
  }
  if (["progress", "progress_state", "executing", "executed", "execution_error", "execution_interrupted"].includes(message.type)) {
    pushMonitorMessage(message);
  }
  if (message.type === "executing" && message.data.node === null && currentPrompt) await outputs();
  if (["execution_error", "execution_interrupted"].includes(message.type)) {
    stopPolling();
    setBusy(false);
    singleInterruptPending = false;
    if (message.type === "execution_interrupted" && monitorState.userInterrupted) {
      monitorState = { ...monitorState, phase: "interrupted", userInterrupted: true };
    }
    rememberJob();
    console.warn("ComfyUI execution terminal event", message.data);
    showAppNotice(
      message.type === "execution_interrupted" ? "Generazione interrotta." : "Generazione fallita.",
      { kind: "error" }
    );
  }
}

function connect() {
  events?.close();
  events = new EventSource(`/api/events?clientId=${encodeURIComponent(clientId)}`);
  events.addEventListener("connection", event => {
    const state = JSON.parse(event.data).state;
    applyConnection(state);
  });
  events.onmessage = handleMessage;
  events.onerror = () => {
    applyConnection("reconnecting");
  };
}

async function recoverActive() {
  let active;
  try {
    const response = await fetch("/api/active");
    if (!response.ok) throw new Error(`active status ${response.status}`);
    active = await response.json();
    monitorState = {
      ...monitorState,
      queueRunning: Number(active.running || 0),
      queuePending: Number(active.pending || 0)
    };
    if (active.active) {
      const observer = resolveObserverClientId({ localClientId: clientId, activeClientId: active.clientId });
      clientId = observer.clientId;
      sessionStorage.setItem("h3ClientId", clientId);
      rememberJob(active.promptId, { createdAt: active.createdAt });
      monitorState = applyMonitorEvent(monitorState, {
        type: "executing",
        data: { node: "?", display_node: "Job recuperato", prompt_id: active.promptId }
      });
      const note = observer.ignoredActiveClientId && observer.ignoredActiveClientId !== clientId
        ? `Job rilevato · ${promptIdPrefix(active.promptId)} · osservazione indipendente`
        : `Job rilevato · ${promptIdPrefix(active.promptId)}`;
      monitorState = {
        ...monitorState,
        events: [...monitorState.events, {
          t: new Date().toLocaleTimeString("it-IT", { hour12: false }),
          m: note,
          at: Date.now()
        }]
      };
      setBusy(true);
      startPolling();
      renderMonitor();
      return;
    }
  } catch {
    applyConnection("connecting");
    if (!currentPrompt) {
      $("progress").textContent = "Connessione temporaneamente non disponibile";
      return;
    }
  }
  if (currentPrompt) {
    setBusy(true);
    rememberJob(currentPrompt);
    monitorState = {
      ...monitorState,
      phase: "running",
      events: [...monitorState.events, {
        t: new Date().toLocaleTimeString("it-IT", { hour12: false }),
        m: `Recupero locale · ${promptIdPrefix(currentPrompt)}`,
        at: Date.now()
      }]
    };
    startPolling();
    await pollHistory();
    renderMonitor();
  }
}

function currentPreset() {
  return config.presets.find(item => item.id === $("workflow").value);
}

function currentSafeFitStatus() {
  return currentPreset()?.safeFit?.status || "not-applicable";
}

function selectedAspectLabel() {
  return $("aspect")?.value || "16:9";
}

function queueSample() {
  const state = coordinator.snapshot();
  return {
    running: Number(monitorState.queueRunning || 0),
    pending: Number(monitorState.queuePending || 0),
    queuedNext: state.queuedNext,
    deferredBatch: state.deferredBatch,
    batchActive: state.batchActive,
    batchQueueArmed: isBatchQueueArmed(),
    lockOwner: state.lockOwner
  };
}

function archiveCurrentPrompt(reason) {
  const prompt = $("prompt")?.value || "";
  if (!String(prompt).trim()) return;
  archivePrompt({
    prompt,
    projectLabel: $("projectLabel")?.value || "",
    workflowLabel: currentPreset()?.label || currentPreset()?.id || ""
  }, { storage: localStorage, max: PROMPT_HISTORY_MAX });
  void reason;
}

function applyDurationField(value) {
  const field = $("duration");
  if (!field) return;
  field.min = 4;
  field.max = 15;
  field.step = "1";
  field.value = String(normalizeDurationSeconds(value ?? field.value));
}

function updateGenerateButton() {
  const send = $("send");
  const reasonEl = $("generateReason");
  if (!send) return;
  const gate = describeGenerateBlockers({
    prompt: $("prompt")?.value,
    attachments: currentPreset()?.attachments || [],
    files: draft.files,
    library: draft.library,
    availability: draft.availability,
    busy: false,
    submitting: false,
    safeFitStatus: currentSafeFitStatus()
  });
  const action = resolveGenerateAction({
    blocked: gate.blocked,
    reason: gate.reason,
    submitting,
    ...queueSample()
  });
  send.disabled = action.disabled;
  send.textContent = action.label;
  send.dataset.action = action.action;
  send.style.opacity = action.disabled ? ".55" : "1";
  send.style.cursor = action.disabled ? "not-allowed" : "pointer";
  if (reasonEl) {
    const show = Boolean(action.reason) && action.action === "blocked";
    reasonEl.hidden = !show;
    reasonEl.textContent = show ? (action.reason || "") : "";
  }
  const warn = $("safeFitWarning");
  if (warn) {
    const status = currentSafeFitStatus();
    if (status === "needs-apply") {
      warn.hidden = false;
      warn.textContent = "Workflow image-fit non aggiornato. Applica lo script pubblico apply_h3_safe_fit.mjs alle API workflow private (I2VA/FL2VA) prima di generare.";
    } else if (status === "unexpected") {
      warn.hidden = false;
      warn.textContent = "Workflow image-fit non valido. Controlla la topologia del grafo privato I2VA/FL2VA.";
    } else {
      warn.hidden = true;
      warn.textContent = "";
    }
  }
}

function updateResolutionHint() {
  const contract = currentPreset()?.options?.megapixels || {};
  $("resolutionHint").textContent = formatResolutionHint($("megapixels").value, $("aspect").value, contract.multiple || DISPLAY_MULTIPLE);
}

function applyMegapixelsContract() {
  const contract = currentPreset()?.options?.megapixels || {};
  const field = $("megapixels");
  field.min = contract.min ?? MEGAPIXELS_LIMITS.min;
  field.max = contract.max ?? MEGAPIXELS_LIMITS.max;
  field.step = contract.step ?? MEGAPIXELS_LIMITS.step;
  updateResolutionHint();
}

function currentEditorState() {
  return editorStateFromDomLike({
    label: $("projectLabel").value.trim(),
    workflowId: $("workflow").value,
    prompt: $("prompt").value,
    megapixels: $("megapixels").value,
    model: $("model").value,
    steps: $("steps").value,
    duration: $("duration").value,
    aspect: $("aspect").value,
    seed: $("seed").value,
    library: draft.library,
    files: draft.files
  });
}

function markBaselineFromDraft() {
  draft.baseline = editorSnapshotWithBatch();
  updateDirtyFlag();
}

function updateDirtyFlag() {
  return noteEditorChange();
}

function viewUrl(filename, subfolder = "") {
  const member = filename ? findMemberByFilename(draft.library, filename) : null;
  return buildInputViewUrl({
    filename,
    subfolder: subfolder || member?.member?.subfolder || ""
  });
}

function statusLabel(status) {
  if (status === "available") return "Disponibile";
  if (status === "missing") return "Mancante";
  if (status === "error") return "Errore";
  if (status === "uploading") return "Caricamento…";
  return "Sconosciuto";
}

function draftAssetDescriptors() {
  const descriptors = [];
  for (const member of listAllMembers(draft.library)) {
    descriptors.push({ filename: member.filename, subfolder: member.subfolder || "" });
  }
  for (const name of Object.values(draft.files || {})) {
    if (!name) continue;
    const found = findMemberByFilename(draft.library, name);
    descriptors.push({ filename: name, subfolder: found?.member?.subfolder || "" });
  }
  return uniqueAssetDescriptors(descriptors);
}

function availabilityOf(filename, subfolder = "") {
  return lookupAvailability(draft.availability, { filename, subfolder });
}

async function refreshAvailability() {
  const unique = draftAssetDescriptors();
  if (!unique.length) {
    draft.availability = {};
    return;
  }
  try {
    const response = await fetch(buildAssetStatusUrl(unique));
    const data = await response.json();
    draft.availability = data.statuses || {};
  } catch {
    draft.availability = Object.fromEntries(unique.map(item => [assetStatusKey(item), "error"]));
  }
  updateGenerateButton();
}

function setCategory(category) {
  activeCategory = category;
  for (const tab of document.querySelectorAll(".cat-tab")) {
    tab.classList.toggle("active", tab.dataset.category === category);
  }
  const isAudio = category === "audio";
  $("dropzoneTitle").textContent = isAudio ? "Trascina qui i file audio" : "Trascina qui le immagini";
  $("assetFileInput").accept = isAudio ? "audio/*" : "image/*";
  renderLibrary();
}

function showAssetFeedback(text) {
  const el = $("assetFeedback");
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function renderLibrary() {
  const host = $("libraryGroups");
  host.replaceChildren();
  const groups = draft.library[activeCategory] || [];
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "asset-feedback";
    empty.hidden = false;
    empty.textContent = `Nessun gruppo in ${CATEGORY_LABELS[activeCategory]}.`;
    host.append(empty);
    return;
  }
  for (const group of groups) {
    host.append(renderGroupCard(group));
  }
}

function renderGroupCard(group) {
  const card = document.createElement("div");
  card.className = "library-group";
  card.dataset.groupId = group.id;

  const head = document.createElement("div");
  head.className = "library-group-head";
  const nameField = document.createElement("label");
  nameField.className = "group-name-field";
  const kicker = document.createElement("p");
  kicker.className = "group-header-kicker";
  kicker.textContent = "GRUPPO ASSET";
  const nameCaption = document.createElement("span");
  nameCaption.textContent = "Nome gruppo";
  const name = document.createElement("input");
  name.type = "text";
  name.value = group.label;
  name.title = "Rinomina gruppo (non rinomina i file)";
  name.onchange = () => {
    draft.library = renameGroup(draft.library, activeCategory, group.id, name.value.trim() || group.label);
    updateDirtyFlag();
    renderLibrary();
    renderRoleFields();
  };
  nameField.append(kicker, nameCaption, name);
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.textContent = "+ file";
  addBtn.onclick = () => {
    targetGroupId = group.id;
    $("assetFileInput").click();
  };
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.textContent = "Elimina";
  delBtn.onclick = () => {
    if (!confirm(`Eliminare il gruppo "${group.label}" dal progetto? I file ComfyUI non verranno cancellati.`)) return;
    const result = removeGroup(draft.library, activeCategory, group.id);
    draft.library = result.library;
    draft.files = clearRolesForFilenames(draft.files, result.removedFilenames);
    updateDirtyFlag();
    renderLibrary();
    renderRoleFields();
  };
  head.append(nameField, addBtn, delBtn);

  const list = document.createElement("div");
  list.className = "member-list";
  (group.members || []).forEach((member, index) => {
    list.append(renderMemberCard(group, member, index));
  });

  const drop = document.createElement("div");
  drop.className = "group-drop";
  drop.textContent = "Trascina file in questo gruppo";
  wireDropTarget(drop, async files => {
    await ingestFiles(files, { groupId: group.id });
  });

  card.append(head, list, drop);
  return card;
}

function renderMemberCard(group, member, index) {
  const status = availabilityOf(member.filename, member.subfolder);
  const card = document.createElement("div");
  card.className = `member-card${member.type === "audio" || activeCategory === "audio" ? " audio-card" : ""}${status === "missing" || status === "error" ? " missing" : ""}`;

  const primary = formatMemberPrimaryLabel(member);
  const ordinal = formatMemberOrdinalLabel({ groupLabel: group.label, category: activeCategory, index });
  const filename = member.filename || member.originalName || "";

  if (activeCategory === "audio" || member.type === "audio") {
    const icon = document.createElement("div");
    icon.className = "audio-icon";
    icon.textContent = "AUDIO";
    card.append(icon);
  } else if (status === "available") {
    const img = document.createElement("img");
    img.alt = primary;
    img.title = `${filename} · ${ordinal}`;
    img.decoding = "async";
    img.src = viewUrl(member.filename, member.subfolder);
    img.onerror = () => {
      const ph = document.createElement("div");
      ph.className = "member-thumb";
      ph.textContent = "?";
      ph.title = filename;
      img.replaceWith(ph);
    };
    card.append(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "member-thumb";
    ph.textContent = status === "missing" ? "N/A" : "…";
    card.append(ph);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "member-label-input";
  labelInput.value = primary;
  labelInput.title = `Etichetta visuale · ${ordinal}`;
  labelInput.onchange = () => {
    const before = {
      filename: member.filename,
      originalName: member.originalName,
      subfolder: member.subfolder || "",
      id: member.id
    };
    draft.library = renameMemberLabel(draft.library, activeCategory, group.id, member.id, labelInput.value);
    const after = findMemberByFilename(draft.library, before.filename)?.member;
    if (!after
      || after.filename !== before.filename
      || after.originalName !== before.originalName
      || (after.subfolder || "") !== before.subfolder
      || after.id !== before.id) {
      add("Errore: rinomina etichetta ha alterato l'identità file.", "system");
    }
    updateDirtyFlag();
    renderLibrary();
    renderRoleFields();
  };
  const fileLine = document.createElement("span");
  fileLine.className = "member-filename";
  fileLine.textContent = filename;
  fileLine.title = ordinal;
  const statusLine = document.createElement("span");
  statusLine.className = `member-status status-${status || "unknown"}`;
  statusLine.textContent = `● ${statusLabel(status)}`;
  meta.append(labelInput, fileLine, statusLine);

  const actions = document.createElement("div");
  actions.className = "member-actions";
  const up = document.createElement("button");
  up.type = "button";
  up.textContent = "↑";
  up.disabled = index === 0;
  up.onclick = () => {
    draft.library = reorderMembers(draft.library, activeCategory, group.id, index, index - 1);
    updateDirtyFlag();
    renderLibrary();
    renderRoleFields();
  };
  const down = document.createElement("button");
  down.type = "button";
  down.textContent = "↓";
  down.disabled = index >= (group.members.length - 1);
  down.onclick = () => {
    draft.library = reorderMembers(draft.library, activeCategory, group.id, index, index + 1);
    updateDirtyFlag();
    renderLibrary();
    renderRoleFields();
  };
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Rimuovi";
  remove.onclick = () => {
    if (!confirm(`Rimuovere "${primary}" dal progetto? Il file ComfyUI non verrà cancellato.`)) return;
    const result = removeMember(draft.library, activeCategory, group.id, member.id);
    draft.library = result.library;
    if (result.removedFilename) draft.files = clearRolesForFilenames(draft.files, [result.removedFilename]);
    updateDirtyFlag();
    renderLibrary();
    renderRoleFields();
  };
  actions.append(up, down, remove);
  card.append(meta, actions);
  return card;
}

function renderRoleFields() {
  const preset = currentPreset();
  const host = $("roleFields");
  const legacyHost = $("attachmentFields");
  host.replaceChildren();
  legacyHost.replaceChildren();
  const attachments = preset?.attachments || [];
  const libraryRoles = attachments.filter(field => roleAcceptKind(field.accept) !== "video");
  const videoRoles = attachments.filter(field => roleAcceptKind(field.accept) === "video");

  for (const field of libraryRoles) {
    const row = document.createElement("div");
    const filename = draft.files[field.key];
    const foundForRole = filename ? findMemberByFilename(draft.library, filename) : null;
    const status = filename ? availabilityOf(filename, foundForRole?.member?.subfolder || "") : null;
    row.className = `role-row${status === "missing" || status === "error" ? " stale" : ""}`;
    row.dataset.roleKey = field.key;
    const label = document.createElement("label");
    label.textContent = field.label;
    const select = document.createElement("select");
    select.dataset.roleKey = field.key;
    select.append(new Option("— non assegnato —", ""));
    const compatible = membersCompatibleWithRole(draft.library, field.accept);
    for (const member of compatible) {
      const option = memberSelectOption(member);
      const opt = new Option(option.label, option.value, false, member.filename === filename);
      opt.title = option.title;
      select.append(opt);
    }
    if (filename && !compatible.some(m => m.filename === filename)) {
      const orphan = new Option(`(fuori libreria) ${filename}`, filename, true, true);
      orphan.title = filename;
      select.append(orphan);
    }
    select.onchange = () => {
      draft.files = assignRole(draft.files, field.key, select.value || undefined);
      updateDirtyFlag();
      renderRoleFields();
    };
    const preview = document.createElement("div");
    preview.className = "role-preview";
    const fitStatus = currentSafeFitStatus();
    const cropEligible = ["firstImage", "lastImage"].includes(field.key)
      && roleAcceptKind(field.accept) === "image";
    if (filename && roleAcceptKind(field.accept) === "image" && status === "available") {
      if (cropEligible && fitStatus === "safe") {
        const crop = document.createElement("div");
        crop.className = "crop-preview";
        crop.style.aspectRatio = selectedAspectLabel().replace(":", " / ");
        const img = document.createElement("img");
        img.src = viewUrl(filename, foundForRole?.member?.subfolder);
        img.alt = field.label;
        img.title = foundForRole?.member?.originalName || filename;
        img.decoding = "async";
        img.onerror = () => {
          const ph = document.createElement("div");
          ph.className = "member-thumb";
          ph.textContent = "?";
          crop.replaceWith(ph);
        };
        const cap = document.createElement("span");
        cap.className = "crop-preview-label";
        cap.textContent = `Crop ${selectedAspectLabel()} · centro`;
        crop.append(img);
        preview.append(crop, cap);
      } else {
        const img = document.createElement("img");
        img.src = viewUrl(filename, foundForRole?.member?.subfolder);
        img.alt = field.label;
        img.title = foundForRole?.member?.originalName || filename;
        img.decoding = "async";
        img.onerror = () => {
          const ph = document.createElement("div");
          ph.className = "member-thumb";
          ph.textContent = "?";
          img.replaceWith(ph);
        };
        preview.append(img);
      }
    }
    const note = document.createElement("span");
    if (cropEligible && (fitStatus === "needs-apply" || fitStatus === "unexpected")) {
      note.textContent = fitStatus === "needs-apply"
        ? "image-fit non aggiornato"
        : "image-fit non valido";
    } else {
      note.textContent = filename ? statusLabel(status || "unknown") : "nessuna assegnazione";
    }
    preview.append(note);
    label.append(select);
    row.append(label, preview);
    host.append(row);
  }

  for (const field of videoRoles) {
    const label = document.createElement("label");
    label.className = `attachment-field${draft.files[field.key] ? " saved" : ""}`;
    label.append(document.createTextNode(field.label));
    const note = document.createElement("small");
    note.textContent = draft.files[field.key] ? "già assegnato / scegli per sostituire" : "scegli file";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = field.accept || "video/*";
    input.dataset.key = field.key;
    input.onchange = async () => {
      if (!input.files[0]) return;
      try {
        showAssetFeedback(`Caricamento ${input.files[0].name}…`);
        const uploaded = await upload(input.files[0]);
        const name = uploaded.filename;
        draft.files = assignRole(draft.files, field.key, name);
        showAssetFeedback("");
        updateDirtyFlag();
        await refreshAvailability();
        renderRoleFields();
      } catch (error) {
        showAssetFeedback(error.message);
      }
    };
    label.append(note, input);
    legacyHost.append(label);
  }
}

function selectPreset({
  preserveLibrary = true,
  clearProjectSelection = false,
  preferredModel,
  trackDirty = true
} = {}) {
  const preset = currentPreset();
  applyMegapixelsContract();
  monitorState = { ...monitorState, title: workflowTitle() };
  renderMonitor();
  const models = preset?.options?.models || [""];
  const currentModel = preferredModel !== undefined ? preferredModel : $("model").value;
  $("model").replaceChildren(...models.map(name => new Option(name, name)));
  const restored = restoreModelSelection({
    availableModels: models,
    savedModel: currentModel,
    presetDefault: models[0]
  });
  $("model").value = restored.model;
  if (restored.warning) add(restored.warning);
  // Never destroy stored bindings when merely viewing another workflow.
  if (!preserveLibrary) draft.library = emptyLibrary();
  if (clearProjectSelection) {
    draft.id = "";
    draft.saved = false;
  }
  renderLibrary();
  renderRoleFields();
  updateGenerateButton();
  if (trackDirty) updateDirtyFlag();
}

async function loadProjectById(id) {
  const myGeneration = ++projectLoadGeneration;
  hideLegacyBatchRecover();
  setBatchRestoreStatus("", { hidden: true });

  if (!id) {
    setProjectLoadStatus(LOAD_STATUS.IDLE, "", { hidden: true });
    clearBatchEditor({ writeLocalCache: true, notify: false });
    return resetDraft({ keepForm: true });
  }

  const selectedLabel = $("project")?.selectedOptions?.[0]?.textContent?.trim()
    || $("projectLabel")?.value?.trim()
    || id;
  setProjectLoadStatus(
    LOAD_STATUS.LOADING,
    formatProjectLoadLabel(LOAD_STATUS.LOADING, { label: selectedLabel }),
    { hidden: false }
  );

  setBatchLocalLoadSuppressed(true);
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Progetto non trovato");
    const project = data;

    if (!shouldCommitLoadGeneration(myGeneration, projectLoadGeneration)) return;

    const normalized = normalizeProject(project);
    draft.id = normalized.id;
    draft.label = normalized.label;
    draft.saved = true;
    draft.library = normalized.library;
    draft.files = { ...(normalized.files || {}) };
    $("projectLabel").value = normalized.label;
    $("workflow").value = normalized.workflowId;
    $("prompt").value = normalized.prompt || "";
    const savedModel = normalized.settings?.model;
    for (const [key, value] of Object.entries(normalized.settings || {})) {
      if (key === "model") continue;
      if ($(key)) $(key).value = key === "duration" ? String(normalizeDurationSeconds(value)) : value;
    }
    const restoredMp = megapixelsFromSettings(normalized.settings || {});
    if (restoredMp !== undefined) $("megapixels").value = restoredMp;

    selectPreset({ preserveLibrary: true, preferredModel: savedModel, trackDirty: false });
    await refreshAvailability();

    if (!shouldCommitLoadGeneration(myGeneration, projectLoadGeneration)) return;

    const preset = currentPreset();
    const modelResult = restoreModelSelection({
      availableModels: preset?.options?.models || [],
      savedModel: normalized.settings?.model,
      presetDefault: preset?.options?.models?.[0]
    });
    if (modelResult.warning) add(modelResult.warning, "system");

    const batchResult = await restoreProjectBatch(normalized);
    importBatchQueueFromProject(normalized.batchQueue || null);
    void getBatchQueueRuntimeView();
    void syncBatchQueuePlanToServer();
    const missingAssetCount = Object.entries(normalized.files || {}).filter(([, filename]) => {
      if (!filename) return false;
      const member = findMemberByFilename(normalized.library, filename);
      const status = lookupAvailability(draft.availability, {
        filename,
        subfolder: member?.member?.subfolder || ""
      });
      return status === "missing" || status === "error";
    }).length;
    const audit = auditProjectRestore({
      project: normalized,
      availableModels: preset?.options?.models || [],
      presetExists: Boolean(preset),
      batchDraft: normalized.batchDraft || (batchResult.restored ? exportBatchDraftForProject() : null),
      missingAssetCount
    });

    // Server project.batchDraft is authoritative for the clean baseline.
    // A legacy/browser-local Batch must remain dirty until PUT confirms it.
    const persistence = resolvePostLoadBatchPersistence({
      serverBatchDraft: normalized.batchDraft,
      origin: batchResult.origin,
      restored: batchResult.restored
    });
    markBaselineFromServerBatch(persistence.baselineBatchDraft);
    clearRecoveryDraft();
    renderLibrary();
    renderRoleFields();

    if (persistence.needsPersistence) {
      setSaveStatus(SAVE_STATUS.DIRTY);
      ensureAutosaveController().markDirty();
    } else {
      ensureAutosaveController().reset(SAVE_STATUS.SAVED);
      setSaveStatus(SAVE_STATUS.SAVED, { clock: clockLabel() });
    }

    let statusText = formatProjectLoadLabel(audit.status, {
      label: normalized.label,
      batchCount: batchResult.count || audit.batchCount,
      batchRestored: batchResult.restored
    });
    if (audit.status === LOAD_STATUS.WARNING) statusText = audit.summary;
    setProjectLoadStatus(audit.status, statusText, { hidden: false });
    if (persistence.needsPersistence && batchResult.count) {
      add(`Batch locale ripristinato · ${batchResult.count} job — salvataggio sul progetto in corso…`, "system");
    }
  } catch (error) {
    if (!shouldCommitLoadGeneration(myGeneration, projectLoadGeneration)) return;
    const resolved = resolveLoadStatusFromError(error);
    setProjectLoadStatus(resolved.status, resolved.summary, { hidden: false });
    add(resolved.detail || resolved.summary || "Errore caricamento progetto", "error");
  } finally {
    setBatchLocalLoadSuppressed(false);
  }
}

function resetDraft({ keepForm = false, clearRecovery = true } = {}) {
  draft = {
    id: "",
    label: "",
    saved: false,
    library: emptyLibrary(),
    files: {},
    availability: {},
    baseline: ""
  };
  $("project").value = "";
  $("projectLabel").value = "";
  hideLegacyBatchRecover();
  setProjectLoadStatus(LOAD_STATUS.IDLE, "", { hidden: true });
  setBatchRestoreStatus("", { hidden: true });
  clearBatchEditor({ writeLocalCache: true, notify: false });
  if (!keepForm) {
    $("prompt").value = "";
  }
  selectPreset({ preserveLibrary: true, clearProjectSelection: true });
  markBaselineFromDraft();
  if (clearRecovery) clearRecoveryDraft();
  autosaveController?.reset(SAVE_STATUS.LOCAL_DRAFT);
  setSaveStatus(SAVE_STATUS.LOCAL_DRAFT);
}

function applyRecoverySnapshot(snapshot) {
  if (!snapshot?.project) return false;
  applyingRecovery = true;
  try {
    const normalized = normalizeProject(snapshot.project);
    draft.id = "";
    draft.label = normalized.label || "";
    draft.saved = false;
    draft.library = normalized.library;
    draft.files = { ...(normalized.files || {}) };
    $("project").value = "";
    $("projectLabel").value = draft.label;
    if (normalized.workflowId) $("workflow").value = normalized.workflowId;
    $("prompt").value = normalized.prompt || "";
    const savedModel = normalized.settings?.model;
    for (const [key, value] of Object.entries(normalized.settings || {})) {
      if (key === "model") continue;
      if ($(key)) $(key).value = key === "duration" ? String(normalizeDurationSeconds(value)) : value;
    }
    const restoredMp = megapixelsFromSettings(normalized.settings || {});
    if (restoredMp !== undefined) $("megapixels").value = restoredMp;
    selectPreset({ preserveLibrary: true, preferredModel: savedModel, trackDirty: false, clearProjectSelection: true });
    markBaselineFromDraft();
    setSaveStatus(SAVE_STATUS.RECOVERED);
    return true;
  } finally {
    applyingRecovery = false;
  }
}

function refreshProjectSelect(selectedId = "") {
  $("project").replaceChildren(
    new Option("Nessun progetto", ""),
    ...(config.projects || []).map(item => new Option(item.label, item.id))
  );
  $("project").value = selectedId || "";
}

function payloadFromEditor() {
  const state = currentEditorState();
  return {
    id: draft.id || undefined,
    label: state.label,
    workflowId: state.workflowId,
    prompt: state.prompt,
    settings: state.settings,
    library: state.library,
    files: state.files,
    batchDraft: exportBatchDraftForPersistence(),
    batchQueue: exportBatchQueueForPersistence()
  };
}

async function saveProject({ asNew = false } = {}) {
  let label = $("projectLabel").value.trim();
  if (!label) {
    label = prompt("Nome progetto:");
    if (!label) return;
    $("projectLabel").value = label;
  }
  const body = payloadFromEditor();
  body.label = label;
  let response;
  if (asNew) {
    const { id: _ignore, ...rest } = body;
    response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...rest, label })
    });
  } else if (draft.saved && draft.id) {
    response = await fetch(`/api/projects/${encodeURIComponent(draft.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } else {
    response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Salvataggio fallito");
  assertPersistedBatchMatches(body.batchDraft, data.batchDraft);
  await activatePersistedProject(data);
}

async function duplicateCurrentProject() {
  const currentLabel = $("projectLabel").value.trim() || draft.label || "";
  const suggested = defaultDuplicateProjectLabel(currentLabel);
  const newLabel = prompt("Nome del nuovo progetto:", suggested);
  if (!newLabel?.trim()) return;

  const state = currentEditorState();
  const body = buildDuplicateProjectPayload({
    label: state.label,
    workflowId: state.workflowId,
    prompt: state.prompt,
    settings: state.settings,
    library: state.library,
    files: state.files,
    batchDraft: exportBatchDraftForProject(),
    batchQueue: exportBatchQueueForProject()
  }, { newLabel: newLabel.trim() });

  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Duplicazione fallita");
  assertPersistedBatchMatches(body.batchDraft, data.batchDraft);
  await activatePersistedProject(data);
  add(`Progetto duplicato: ${data.label}`, "system");
}

async function activatePersistedProject(data) {
  config.projects = await (await fetch("/api/projects")).json();
  refreshProjectSelect(data.id);
  await loadProjectById(data.id);
}

async function ingestFiles(fileList, { groupId = null } = {}) {
  const files = [...fileList];
  const { accepted, rejected } = classifyDroppedFiles(activeCategory, files);
  if (rejected.length) {
    showAssetFeedback(`File non supportati per ${CATEGORY_LABELS[activeCategory]}: ${rejected.map(r => r.name).join(", ")}`);
  } else {
    showAssetFeedback("");
  }
  if (!accepted.length) return;
  showAssetFeedback(`Caricamento ${accepted.length} file…`);
  const members = [];
  for (const file of accepted) {
    const uploaded = await upload(file);
    members.push(createMember({
      filename: uploaded.filename,
      subfolder: uploaded.subfolder,
      originalName: file.name,
      type: activeCategory === "audio" ? "audio" : "image"
    }));
  }
  if (groupId) {
    draft.library = addMembersToGroup(draft.library, activeCategory, groupId, members);
  } else {
    const label = prompt("Nome del nuovo gruppo:", stripName(accepted[0].name)) || stripName(accepted[0].name);
    draft.library = addGroup(draft.library, activeCategory, createGroup({ label, members }));
  }
  // Never auto-assign workflow roles.
  showAssetFeedback("");
  await refreshAvailability();
  updateDirtyFlag();
  renderLibrary();
  renderRoleFields();
}

function stripName(name) {
  return humanizeFilenameLabel(name) || String(name || "Gruppo").replace(/\.[^.]+$/, "");
}

function wireDropTarget(el, onFiles) {
  const stop = event => { event.preventDefault(); event.stopPropagation(); };
  el.addEventListener("dragenter", event => { stop(event); el.classList.add("dragover"); });
  el.addEventListener("dragover", event => { stop(event); el.classList.add("dragover"); });
  el.addEventListener("dragleave", event => { stop(event); el.classList.remove("dragover"); });
  el.addEventListener("drop", async event => {
    stop(event);
    el.classList.remove("dragover");
    const files = event.dataTransfer?.files;
    if (files?.length) await onFiles(files);
  });
}

// --- boot ---
config = await (await fetch("/api/config")).json();
$("version").textContent = `v${config.version}`;
$("workflow").replaceChildren(...(config.presets.length ? config.presets.map(item => new Option(item.label, item.id)) : [new Option("Nessun preset", "")]));
refreshProjectSelect();

$("workflow").onchange = () => {
  // Preserve library and full binding map; only the active preset's roles are rendered/submitted.
  selectPreset({ preserveLibrary: true, clearProjectSelection: false });
  $("project").value = draft.id || "";
};
$("project").onchange = async () => {
  if (updateDirtyFlag() && !confirm("Ci sono modifiche non salvate. Continuare?")) {
    $("project").value = draft.id || "";
    return;
  }
  await loadProjectById($("project").value);
};
$("megapixels").oninput = () => { updateResolutionHint(); updateDirtyFlag(); };
$("aspect").onchange = () => {
  updateResolutionHint();
  updateDirtyFlag();
  renderRoleFields();
  updateGenerateButton();
};
for (const id of ["prompt", "projectLabel", "model", "steps", "duration", "seed"]) {
  $(id).addEventListener("input", updateDirtyFlag);
  $(id).addEventListener("change", updateDirtyFlag);
}

for (const tab of document.querySelectorAll(".cat-tab")) {
  tab.onclick = () => setCategory(tab.dataset.category);
}

$("groupCreate").onclick = () => {
  const label = prompt("Nome gruppo:", `Nuovo ${CATEGORY_LABELS[activeCategory]}`);
  if (!label) return;
  draft.library = addGroup(draft.library, activeCategory, createGroup({ label }));
  updateDirtyFlag();
  renderLibrary();
};

wireDropTarget($("assetDropzone"), async files => {
  await ingestFiles(files, { groupId: null });
});
$("assetDropzone").onclick = () => {
  targetGroupId = null;
  $("assetFileInput").click();
};
$("assetFileInput").onchange = async () => {
  if (!$("assetFileInput").files?.length) return;
  await ingestFiles($("assetFileInput").files, { groupId: targetGroupId });
  $("assetFileInput").value = "";
  targetGroupId = null;
};

$("projectNew").onclick = () => {
  if (updateDirtyFlag() && !confirm("Modifiche non salvate. Creare un nuovo progetto?")) return;
  resetDraft({ clearRecovery: true });
  add("Nuovo progetto (non salvato).");
};
$("projectSave").onclick = async () => {
  try {
    await saveProject({ asNew: false });
  } catch (error) {
    // Fail closed: saveProject only advances the baseline after persistence
    // verification, so here the editor is still dirty and the local Batch
    // cache/recovery copies remain intact.
    setSaveStatus(SAVE_STATUS.ERROR);
    add(`Errore salvataggio: ${error.message}`, "system");
    persistRecoveryIfNeeded();
  }
};
$("projectSaveAs").onclick = async () => {
  try {
    await duplicateCurrentProject();
  } catch (error) {
    setSaveStatus(SAVE_STATUS.ERROR);
    showAppNotice(`Errore duplicazione: ${error.message}`, { kind: "error" });
  }
};
$("projectDelete").onclick = async () => {
  if (!draft.id || !draft.saved) {
    resetDraft();
    return;
  }
  if (!confirm(`Eliminare il progetto locale "${draft.label || draft.id}"? I file in ComfyUI non verranno cancellati.`)) return;
  const response = await fetch(`/api/projects/${encodeURIComponent(draft.id)}`, { method: "DELETE" });
  const data = await response.json();
  if (!response.ok) return add(data.error || "Eliminazione fallita");
  config.projects = await (await fetch("/api/projects")).json();
  refreshProjectSelect();
  resetDraft({ clearRecovery: true });
  add("Progetto eliminato (solo definizione locale).");
};

selectPreset({ preserveLibrary: true, trackDirty: false });
setCategory("elements");
applyDurationField($("duration")?.value);
markBaselineFromDraft();
updateGenerateButton();
latestCompletion = readLatestOutput(sessionStorage);
renderMonitor();
coordinator.onChange(() => {
  renderQueueWaitCard();
  updateGenerateButton();
});

const recovery = readRecoveryDraft();
if (recovery && !$("project").value) {
  if (applyRecoverySnapshot(recovery)) {
    await refreshAvailability();
    renderLibrary();
    renderRoleFields();
    updateDirtyFlag();
    setSaveStatus(SAVE_STATUS.RECOVERED);
  }
} else {
  setSaveStatus(draft.saved ? SAVE_STATUS.SAVED : SAVE_STATUS.LOCAL_DRAFT);
}
persistenceReady = true;
setBatchPersistenceHook(() => {
  if (draft.saved && draft.id) noteEditorChange();
});
initBatchQueueUi({
  getProjectId: () => draft.id || $("project")?.value || "",
  onPlanDirty: () => {
    if (draft.saved && draft.id) noteEditorChange();
  }
});
setBatchAssetContextProvider(() => {
  const unavailable = new Set();
  for (const member of listAllMembers(draft.library)) {
    const status = availabilityOf(member.filename, member.subfolder || "");
    if (status === "missing" || status === "error") unavailable.add(member.filename);
  }
  for (const name of Object.values(draft.files || {})) {
    if (!name) continue;
    const found = findMemberByFilename(draft.library, name);
    const status = availabilityOf(name, found?.member?.subfolder || "");
    if (status === "missing" || status === "error") unavailable.add(name);
  }
  return {
    library: draft.library,
    unavailableFilenames: unavailable
  };
});
$("batchLegacyRecover")?.addEventListener("click", () => {
  if (!pendingLegacyBatchCandidate?.draft || !draft.saved || !draft.id) return;
  // Baseline stays as the server project (no Batch) so recovery is dirty until PUT.
  markBaselineFromServerBatch(null);
  const result = importBatchDraftFromProject(pendingLegacyBatchCandidate.draft, {
    writeLocalCache: true,
    notify: false
  });
  hideLegacyBatchRecover();
  if (result.restored) {
    setBatchRestoreStatus(formatBatchRestoreLabel({ count: result.count, restored: true }), { hidden: false });
    add(`Batch locale recuperato · ${result.count} job`, "system");
    setSaveStatus(SAVE_STATUS.DIRTY);
    if (persistenceReady) ensureAutosaveController().markDirty();
  }
});

await recoverActive();
if (!latestCompletion && currentPrompt) {
  try {
    const history = await (await fetch(`/api/history?promptId=${encodeURIComponent(currentPrompt)}`)).json();
    if (classifyHistoryState(history, currentPrompt) === "completed") {
      const out = await (await fetch(`/api/outputs?promptId=${encodeURIComponent(currentPrompt)}`)).json();
      if (Array.isArray(out) && out.length) {
        latestCompletion = reconstructCompletionFromOutputs(out, {
          duration: $("duration")?.value,
          model: $("model")?.value,
          seed: $("seed")?.value,
          promptId: currentPrompt,
          completedAt: Date.now()
        });
        persistLatestOutput(latestCompletion, sessionStorage);
        renderCompletionCard();
      }
    }
  } catch { /* no fake completion */ }
}
sessionStorage.setItem("h3ClientId", clientId);
connect();
await refreshComfyLogs();
logTimer = setInterval(refreshComfyLogs, LOG_POLL_MS);
startQueuePolling();
if (currentPrompt) void refreshSingleOwnership();
$("interruptSingleRender")?.addEventListener("click", () => { void interruptSingleRender(); });

$("send").onclick = async () => {
  const gate = describeGenerateBlockers({
    prompt: $("prompt").value,
    attachments: currentPreset()?.attachments || [],
    files: draft.files,
    library: draft.library,
    availability: draft.availability,
    busy: false,
    submitting: false,
    safeFitStatus: currentSafeFitStatus()
  });
  const action = resolveGenerateAction({
    blocked: gate.blocked,
    reason: gate.reason,
    submitting,
    ...queueSample()
  });
  if (action.disabled) {
    updateGenerateButton();
    return;
  }
  submitting = true;
  updateGenerateButton();
  try {
    $("progress").textContent = action.action === "queue-next" ? "Preparazione prossimo job…" : "Controllo allegati…";
    if (action.action === "queue-next") {
      const armed = await submitSingleRender({ action: action.action });
      if (!armed.ok) throw new Error(armed.reason === "already-armed" ? "Un prossimo job è già in coda." : "Impossibile mettere in coda il job.");
      renderQueueWaitCard();
      add("Prossimo job in attesa. Nessuna generazione inviata.");
      return;
    }
    setBusy(true);
    latestCompletion = null;
    clearLatestOutput(sessionStorage);
    $("progress").textContent = "In coda…";
    const result = await submitSingleRender({ action: action.action });
    if (!result.ok) throw new Error(result.reason === "locked" ? "Invio già in corso." : "Invio non disponibile.");
    adoptSubmittedJob(result.result);
  } catch (error) {
    stopPolling();
    setBusy(false);
    monitorState = { ...monitorState, phase: "error" };
    renderMonitor();
    add(error.message);
  } finally {
    submitting = false;
    updateGenerateButton();
  }
};

$("promptClear").onclick = () => {
  const decision = confirmClearPrompt({
    prompt: $("prompt").value,
    confirmFn: () => confirm("Cancellare il prompt corrente? Potrai ripristinarlo dalla cronologia.")
  });
  if (!decision.cleared) return;
  archiveCurrentPrompt("clear");
  $("prompt").value = "";
  updateDirtyFlag();
  updateGenerateButton();
  renderPromptHistory();
};

$("promptHistoryToggle").onclick = () => {
  const panel = $("promptHistoryPanel");
  const open = panel.hidden;
  panel.hidden = !open;
  $("promptHistoryToggle").setAttribute("aria-expanded", open ? "true" : "false");
  if (open) renderPromptHistory();
};

$("promptHistoryClear").onclick = () => {
  if (!confirm("Cancellare tutta la cronologia prompt locale?")) return;
  clearPromptHistory(localStorage, { confirm: true });
  renderPromptHistory();
};

$("duration").onchange = () => applyDurationField($("duration").value);
