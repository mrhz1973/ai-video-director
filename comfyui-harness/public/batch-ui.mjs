import { classifyHistoryState, historyFailureLabel, promptIdPrefix } from "./recovery.mjs";
import {
  MAX_BATCH_JOBS,
  MIN_BATCH_JOBS,
  BATCH_ASPECT_OPTIONS,
  applyBatchWideSettings,
  clampBatchCount,
  createBatchItems,
  detectBatchWideFieldState,
  duplicateBatchItem,
  formatBatchJobSummary,
  isTerminalBatchState,
  moveBatchItem,
  removeBatchItem,
  resolveBatchItemFiles,
  submitBatchSequentially,
  summarizeBatchJobs,
  formatBatchRuntimeSummary,
  validateBatchDraft,
  validateBatchWideSettings
} from "./batch-core.mjs";
import { normalizeBatchDraft, normalizeItemFiles, serializeBatchDraft } from "../lib/batch-draft.mjs";
import { normalizeDurationSeconds } from "../lib/duration.mjs";
import { memberSelectOption, membersCompatibleWithRole, roleAcceptKind } from "../lib/projects.mjs";
import { archivePrompt } from "./prompt-history.mjs";
import { batchJobOutputRows } from "./completion.mjs";
import {
  buildSessionOutputRecords,
  notifySessionOutputsChanged,
  upsertSessionOutputs
} from "./session-outputs.mjs";
import {
  getSharedCoordinator,
  resolveBatchQueueAction
} from "./queue-coordinator.mjs";
import {
  EXECUTION_LANE_KIND,
  executionLaneSubmitHeaders,
  getPageSessionId,
  releaseExecutionLane,
  reserveExecutionLane,
  startExecutionLaneHeartbeat,
  stopExecutionLaneHeartbeat,
  transferExecutionLaneKind
} from "./execution-lane-client.mjs";
import { BATCH_OPTIONAL_HEADING } from "./single-render.mjs";
import { applyOperatorHelp, applyStaticControlHelp, CONTROL_HELP } from "./control-help.mjs";
import { setControlHelp } from "./tooltip.mjs";
import {
  applyBatchStopResult,
  batchCurrentInterruptActionable,
  batchCurrentInterruptConfirmMessage,
  batchHasActiveWork,
  batchStopActionable,
  batchStopConfirmMessage,
  findActiveBatchJob
} from "./runtime-interrupt-ui.mjs";
import {
  addCurrentBatchToQueue,
  isBatchQueueArmed
} from "./batch-queue-ui.mjs";
import {
  appendBatchFirstFrameSummary,
  resolveEffectiveFirstFrame
} from "./first-frame-view.mjs";
import {
  applyBatchH3LoraCapability,
  getH3LoraAvailability,
  initBatchH3LoraControls,
  readBatchH3LoraFromDom,
  syncBatchH3LoraFromSettings
} from "./h3-lora-ui.mjs";
import {
  freezeBatchLoraFields,
  queuePayloadLoraFields,
  validateBatchOwnedLora
} from "../lib/batch-lora-snapshot.mjs";
import { H3_LORA_OFF } from "../lib/h3-lora-catalog.mjs";
import {
  buildBatchProgressView,
  enrichProgressWithNodeContext
} from "./batch-queue-progress.mjs";

const $ = id => document.getElementById(id);
const DRAFT_PREFIX = "h3BatchDraft:v1:";
const RUNTIME_KEY = "h3BatchRuntime:v1";
const POLL_MS = 5000;

let config = null;
let items = [];
let source = null;
let submitting = false;
let submitted = false;
let runtime = null;
let pollTimer = null;
let batchOwnershipControllable = false;
let batchInterruptPending = false;
let batchStopPending = false;
let persistenceHook = null;
let suppressLocalLoad = false;
let assetContextProvider = null;
/** UI-session only: index -> expanded. Not persisted to project JSON. */
const batchExpandState = new Map();
let liveBatchRenderProgress = null;
const batchNodeDisplayById = new Map();
let batchRunStartedAt = null;

function clearBatchExpandState() {
  batchExpandState.clear();
}

function setAllBatchJobsExpanded(open) {
  if (!items.length) return;
  for (let index = 0; index < items.length; index += 1) {
    batchExpandState.set(index, Boolean(open));
  }
  renderBatch();
}

function batchPresetForSource(prepared = source) {
  const workflowId = prepared?.workflowId;
  if (!workflowId || !config?.presets) return null;
  return config.presets.find(preset => preset.id === workflowId) || null;
}

function syncBatchLoraControls() {
  const hasBatch = Boolean(items.length && source);
  const preset = batchPresetForSource(source);
  if (hasBatch) {
    syncBatchH3LoraFromSettings(source);
  } else {
    syncBatchH3LoraFromSettings({ loraId: "off" });
  }
  applyBatchH3LoraCapability({ enabled: hasBatch, preset });
}

/**
 * Persist Batch-owned LoRA from DOM without coerce-to-default.
 * Invalid explicit strength is kept so validateBatchOwnedLora can fail closed.
 * Empty strength on a legitimate profile remains omitted (profile default at validate).
 */
function commitBatchLoraFromDom() {
  if (!source || !items.length) return;
  const next = readBatchH3LoraFromDom();
  const loraId =
    next.loraId == null || next.loraId === ""
      ? H3_LORA_OFF
      : String(next.loraId);
  const updated = { ...source, loraId };
  if (loraId === H3_LORA_OFF) {
    delete updated.loraStrength;
  } else if (next.loraStrength != null && next.loraStrength !== "") {
    updated.loraStrength = next.loraStrength;
  } else {
    delete updated.loraStrength;
  }
  source = updated;
  markEdited();
}

/** Authoritative Batch LoRA gate for CODA snapshot + immediate/deferred queue. */
function validatePreparedBatchLora(loraSource = source) {
  return validateBatchOwnedLora({
    loraId: loraSource?.loraId,
    loraStrength: loraSource?.loraStrength,
    preset: batchPresetForSource(loraSource) || batchPresetForSource(source),
    availability: config?.h3Lora?.availability ?? getH3LoraAvailability()
  });
}

function syncBatchGlobalControls() {
  const mpField = $("batchGlobalMp");
  const aspectField = $("batchGlobalAspect");
  const stepsField = $("batchGlobalSteps");
  const applyBtn = $("batchGlobalApply");
  const hasBatch = items.length > 0;
  if (applyBtn) applyBtn.disabled = !hasBatch;
  syncBatchLoraControls();
  if (!hasBatch) {
    if (mpField) { mpField.value = ""; mpField.placeholder = "—"; }
    if (aspectField) aspectField.value = "";
    if (stepsField) { stepsField.value = ""; stepsField.placeholder = "—"; }
    return;
  }
  const mpState = detectBatchWideFieldState(items, "megapixels");
  const aspectState = detectBatchWideFieldState(items, "aspect");
  const stepsState = detectBatchWideFieldState(items, "steps");
  if (mpField) {
    if (mpState.mode === "uniform") {
      mpField.value = mpState.value;
      mpField.placeholder = "";
    } else {
      mpField.value = "";
      mpField.placeholder = "Misti";
    }
  }
  if (aspectField) {
    aspectField.value = aspectState.mode === "uniform" ? aspectState.value : "";
  }
  if (stepsField) {
    if (stepsState.mode === "uniform") {
      stepsField.value = stepsState.value;
      stepsField.placeholder = "";
    } else {
      stepsField.value = "";
      stepsField.placeholder = "Misti";
    }
  }
  if (applyBtn) {
    applyBtn.textContent = `Applica a tutti gli ${items.length} job`;
  }
}

function applyBatchGlobalSettings() {
  if (!items.length) return { ok: false, error: "Nessun batch preparato." };
  const megapixels = $("batchGlobalMp")?.value ?? "";
  const aspect = $("batchGlobalAspect")?.value ?? "";
  const steps = $("batchGlobalSteps")?.value ?? "";
  const limits = {
    megapixelsMin: Number(source?.megapixelsMin ?? 0.1),
    megapixelsMax: Number(source?.megapixelsMax ?? 16)
  };
  const validation = validateBatchWideSettings({
    items,
    megapixels,
    aspect,
    steps,
    ...limits
  });
  if (!validation.valid) {
    return { ok: false, error: validation.errors.join(" ") };
  }
  items = applyBatchWideSettings(items, { megapixels, aspect, steps });
  markEdited();
  renderBatch();
  return { ok: true };
}

function projectKey() {
  return $("project")?.value || "none";
}

function draftKey() {
  return `${DRAFT_PREFIX}${projectKey()}`;
}

function safeParse(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function draftPayload() {
  if (!items.length || !source) return null;
  return {
    version: 1,
    source,
    items: batchItemsForExport()
  };
}

function persistDraft({ notify = true } = {}) {
  const payload = draftPayload();
  try {
    if (payload) localStorage.setItem(draftKey(), JSON.stringify(payload));
    else localStorage.removeItem(draftKey());
  } catch { /* browser-local cache only */ }
  if (notify && persistenceHook) persistenceHook();
}

function loadDraftFromLocalStorage() {
  if (suppressLocalLoad) return { restored: false, count: 0, source: "local" };
  const saved = safeParse(localStorage.getItem(draftKey()) || "null");
  const normalized = normalizeBatchDraft(saved);
  if (!normalized) {
    items = [];
    source = null;
    submitted = false;
    clearBatchExpandState();
    renderBatch();
    return { restored: false, count: 0, source: "local" };
  }
  items = normalized.items.map(item => cloneBatchItemSnapshot(item));
  source = normalized.source;
  submitted = false;
  renderBatch();
  return { restored: true, count: items.length, source: "local" };
}

export function setBatchPersistenceHook(fn) {
  persistenceHook = typeof fn === "function" ? fn : null;
}

export function setBatchLocalLoadSuppressed(value) {
  suppressLocalLoad = Boolean(value);
}

/** Provides project library + unavailable Comfy filenames for Batch input selectors. */
export function setBatchAssetContextProvider(fn) {
  assetContextProvider = typeof fn === "function" ? fn : null;
}

/** Re-render compact cards (e.g. after availability / library refresh). */
export function refreshBatchPresentation() {
  if (typeof document !== "undefined" && document.getElementById?.("batchList")) {
    renderBatch();
  }
}

function getBatchAssetContext() {
  const ctx = assetContextProvider?.() || {};
  const unavailable = ctx.unavailableFilenames instanceof Set
    ? ctx.unavailableFilenames
    : new Set(Array.isArray(ctx.unavailableFilenames) ? ctx.unavailableFilenames : []);
  return {
    library: ctx.library || { groups: [] },
    unavailableFilenames: unavailable,
    availability: ctx.availability && typeof ctx.availability === "object" ? ctx.availability : {}
  };
}

function batchItemsForExport() {
  return items.map(item => {
    const files = normalizeItemFiles(item.files);
    const out = {
      ...item,
      duration: String(normalizeDurationSeconds(item.duration))
    };
    if (files) out.files = { ...files };
    else delete out.files;
    return out;
  });
}

/** Semantic editor snapshot: excludes volatile persistence metadata such as updatedAt. */
export function exportBatchDraftForProject() {
  if (!items.length || !source) return null;
  return serializeBatchDraft({
    source,
    items: batchItemsForExport(),
    includeUpdatedAt: false
  });
}

/** Server persistence payload: stamps updatedAt only on real save/autosave. */
export function exportBatchDraftForPersistence() {
  if (!items.length || !source) return null;
  return serializeBatchDraft({
    source,
    items: batchItemsForExport(),
    updatedAt: new Date().toISOString(),
    includeUpdatedAt: true
  });
}

export function importBatchDraftFromProject(draft, { writeLocalCache = true, notify = false } = {}) {
  const normalized = normalizeBatchDraft(draft);
  if (!normalized) {
    items = [];
    source = null;
    submitted = false;
    clearBatchExpandState();
    renderBatch();
    if (writeLocalCache) persistDraft({ notify });
    return { restored: false, count: 0 };
  }
  items = normalized.items.map(item => cloneBatchItemSnapshot(item));
  source = normalized.source;
  submitted = false;
  clearBatchExpandState();
  renderBatch();
  if (writeLocalCache) persistDraft({ notify });
  return { restored: true, count: items.length };
}

export function clearBatchEditor({ writeLocalCache = true, notify = true } = {}) {
  items = [];
  source = null;
  submitted = false;
  clearBatchExpandState();
  renderBatch();
  if (writeLocalCache) persistDraft({ notify });
  return { cleared: true };
}

export function getBatchEditorSummary() {
  return {
    count: items.length,
    hasDraft: Boolean(items.length && source),
    submitted
  };
}

/** Validates and returns the current prepared Batch as an independent queue snapshot. */
export function getCurrentBatchSnapshotForQueue() {
  const snapshot = collectSourceSnapshot();
  if (snapshot.error) return { ok: false, error: snapshot.error };
  const validation = validateCurrentBatch(snapshot);
  if (!validation.valid) return { ok: false, error: validation.errors.join(" ") };
  if (!source) return { ok: false, error: "Nessun batch preparato." };
  const loraCheck = validatePreparedBatchLora(source);
  if (!loraCheck.ok) return { ok: false, error: loraCheck.error };
  return {
    ok: true,
    draft: {
      version: 1,
      source,
      items: batchItemsForExport()
    }
  };
}

export function bindBatchProjectKey(projectId = "") {
  // Keep localStorage cache aligned when project id changes after first save.
  const payload = draftPayload();
  if (!payload) return;
  try {
    localStorage.setItem(`${DRAFT_PREFIX}${projectId || "none"}`, JSON.stringify(payload));
  } catch { /* ignore */ }
}

function persistRuntime() {
  try {
    if (runtime) localStorage.setItem(RUNTIME_KEY, JSON.stringify(runtime));
    else localStorage.removeItem(RUNTIME_KEY);
  } catch { /* ignore */ }
}

function loadRuntime() {
  const saved = safeParse(localStorage.getItem(RUNTIME_KEY) || "null");
  if (saved?.version === 1 && Array.isArray(saved.jobs) && saved.jobs.length) {
    runtime = saved;
    batchRunStartedAt = saved.startedAt || saved.createdAt || null;
  }
  renderRuntime();
  if (runtime?.jobs?.some(job => !isTerminalBatchState(job.state))) startPolling();
}

function currentPreset() {
  const workflowId = $("workflow")?.value || "";
  return config?.presets?.find(item => item.id === workflowId) || null;
}

function roleKind(field = {}) {
  const accept = String(field.accept || "image/*").toLowerCase();
  if (accept.includes("video")) return "video";
  if (accept.includes("audio")) return "audio";
  return "image";
}

function collectSourceSnapshot() {
  const preset = currentPreset();
  if (!preset) return { error: "Workflow non disponibile." };
  const attachments = preset.attachments || [];
  const rows = [...document.querySelectorAll("#roleFields .role-row")];
  const files = {};
  const requiredKeys = [];
  const attachmentRoles = [];
  const unsupportedVideoRoles = [];
  let rowIndex = 0;

  for (const field of attachments) {
    if (!field?.key) continue;
    if (roleKind(field) === "video") {
      unsupportedVideoRoles.push(field.label || field.key);
      continue;
    }
    requiredKeys.push(field.key);
    attachmentRoles.push({
      key: field.key,
      label: field.label || field.key,
      accept: field.accept || "image/*"
    });
    const row = rows[rowIndex++];
    const select = row?.querySelector("select");
    if (select?.value && !row?.classList.contains("stale")) files[field.key] = select.value;
  }

  const mpField = $("megapixels");
  const durationField = $("duration");
  return {
    workflowId: preset.id,
    workflowLabel: preset.label || preset.id,
    model: $("model")?.value || "",
    files,
    requiredKeys,
    attachmentRoles,
    unsupportedVideoRoles,
    safeFitStatus: preset.safeFit?.status || "not-applicable",
    megapixelsMin: Number(mpField?.min || preset.options?.megapixels?.min || 0.1),
    megapixelsMax: Number(mpField?.max || preset.options?.megapixels?.max || 16),
    durationMin: Number(durationField?.min || 4),
    durationMax: Number(durationField?.max || 15),
    base: {
      prompt: $("prompt")?.value || "",
      seed: $("seed")?.value || "1",
      duration: String(normalizeDurationSeconds($("duration")?.value || 5)),
      steps: $("steps")?.value || "20",
      megapixels: $("megapixels")?.value || "0.3",
      aspect: $("aspect")?.value || "16:9"
    },
    loraId: $("loraId")?.value || "off",
    ...( $("loraId")?.value && $("loraId").value !== "off"
      ? { loraStrength: $("loraStrength")?.value }
      : {})
  };
}

function sourceIdentity(value = source) {
  if (!value) return "";
  // Workflow + model only. Shared Input changes must not force re-prepare
  // (which would wipe explicit per-job item.files overrides).
  return JSON.stringify({ workflowId: value.workflowId, model: value.model });
}

function cloneBatchItemSnapshot(item = {}) {
  const files = normalizeItemFiles(item.files);
  const out = {
    ...item,
    duration: String(normalizeDurationSeconds(item.duration))
  };
  if (files) out.files = { ...files };
  else delete out.files;
  return out;
}

function freezeSubmissionSnapshot(preparedSource = source, live = null) {
  const base = preparedSource && typeof preparedSource === "object" ? preparedSource : {};
  const liveMeta = live && typeof live === "object" ? live : {};
  const roleLabels = {};
  const attachmentRoles = Array.isArray(base.attachmentRoles) && base.attachmentRoles.length
    ? base.attachmentRoles.map(role => ({ ...role }))
    : (Array.isArray(liveMeta.attachmentRoles) ? liveMeta.attachmentRoles.map(role => ({ ...role })) : []);
  for (const role of attachmentRoles) {
    if (role?.key) roleLabels[role.key] = role.label || role.key;
  }
  const lora = freezeBatchLoraFields(base);
  return {
    workflowId: base.workflowId,
    workflowLabel: base.workflowLabel || base.workflowId,
    model: base.model,
    files: { ...(base.files || {}) },
    requiredKeys: Array.isArray(base.requiredKeys) ? [...base.requiredKeys] : [],
    attachmentRoles,
    roleLabels,
    unsupportedVideoRoles: Array.isArray(liveMeta.unsupportedVideoRoles) && liveMeta.unsupportedVideoRoles.length
      ? [...liveMeta.unsupportedVideoRoles]
      : (Array.isArray(base.unsupportedVideoRoles) ? [...base.unsupportedVideoRoles] : []),
    safeFitStatus: liveMeta.safeFitStatus || base.safeFitStatus || "not-applicable",
    megapixelsMin: Number(liveMeta.megapixelsMin ?? base.megapixelsMin ?? 0.1),
    megapixelsMax: Number(liveMeta.megapixelsMax ?? base.megapixelsMax ?? 16),
    durationMin: Number(liveMeta.durationMin ?? base.durationMin ?? 4),
    durationMax: Number(liveMeta.durationMax ?? base.durationMax ?? 15),
    base: base.base ? { ...base.base } : (liveMeta.base ? { ...liveMeta.base } : {}),
    ...lora
  };
}

function setItemFileOverride(item, roleKey, value) {
  const next = { ...(normalizeItemFiles(item.files) || {}) };
  const trimmed = String(value || "").trim();
  if (!trimmed) delete next[roleKey];
  else next[roleKey] = trimmed;
  const normalized = normalizeItemFiles(next);
  if (normalized) item.files = normalized;
  else delete item.files;
}

function batchAttachmentRoles() {
  if (Array.isArray(source?.attachmentRoles) && source.attachmentRoles.length) {
    return source.attachmentRoles.filter(role => role?.key && roleAcceptKind(role.accept) !== "video");
  }
  return (source?.requiredKeys || []).map(key => ({ key, label: key, accept: "image/*" }));
}

function appendBatchJobInputSection(body, item) {
  const roles = batchAttachmentRoles();
  if (!roles.length) return;
  const { library } = getBatchAssetContext();
  const section = document.createElement("div");
  section.className = "batch-job-inputs";
  const heading = document.createElement("div");
  heading.className = "batch-job-inputs-label";
  heading.textContent = "Input";
  section.append(heading);

  for (const role of roles) {
    const sharedName = source?.files?.[role.key] || "";
    const overrides = normalizeItemFiles(item.files) || {};
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, role.key);
    const selected = hasOverride ? overrides[role.key] : "";

    const label = document.createElement("label");
    label.className = "batch-job-input-role";
    label.dataset.roleKey = role.key;
    const title = document.createElement("span");
    title.textContent = role.label || role.key;
    const select = document.createElement("select");
    select.dataset.field = "file";
    select.dataset.roleKey = role.key;
    const inheritLabel = sharedName
      ? `Eredita: ${sharedName}`
      : "Eredita (nessun asset comune)";
    select.append(new Option(inheritLabel, "", !hasOverride, !hasOverride));

    const compatible = membersCompatibleWithRole(library, role.accept || "image/*");
    for (const member of compatible) {
      const option = memberSelectOption(member);
      const isSelected = hasOverride && member.filename === selected;
      const opt = new Option(option.label, option.value, isSelected, isSelected);
      opt.title = option.title;
      select.append(opt);
    }
    if (hasOverride && selected && !compatible.some(m => m.filename === selected)) {
      const orphan = new Option(`(non disponibile) ${selected}`, selected, true, true);
      orphan.title = selected;
      select.append(orphan);
    }
    select.addEventListener("change", () => {
      setItemFileOverride(item, role.key, select.value);
      markEdited();
      if (role.key === "firstImage") renderBatch();
    });
    label.append(title, select);
    section.append(label);
  }
  body.append(section);
}

function markEdited() {
  submitted = false;
  persistDraft({ notify: true });
  updateQueueButton();
}

function setFeedback(message, kind = "neutral") {
  const node = $("batchFeedback");
  if (!node) return;
  node.textContent = message;
  node.dataset.kind = kind;
}

function createUi() {
  if ($("batchSection")) return;
  const mount = $("batchMount") || $("generationGrid")?.parentNode;
  if (!mount) return;

  const section = document.createElement("section");
  section.className = "batch-section";
  section.id = "batchSection";
  section.innerHTML = `
    <details id="batchDetails" open>
      <summary><span id="batchCurrentHeading">${BATCH_OPTIONAL_HEADING}</span><span id="batchBadge" class="batch-badge">Batch attuale · 0 job</span></summary>
      <p class="batch-help">Prepara più render dalla Scena. <strong>Genera singolo</strong> crea sempre una sola clip e non modifica questi job.</p>
      <div class="batch-prepare-row">
        <label>Job da creare<input id="batchCount" type="number" min="${MIN_BATCH_JOBS}" max="${MAX_BATCH_JOBS}" value="4"></label>
        <button type="button" class="secondary" id="batchPrepare" data-help="Crea i job del Batch a partire da prompt, Input e impostazioni della Scena corrente. Non avvia generazione.">Crea job dalla scena corrente</button>
      </div>
      <div class="batch-global-settings" id="batchGlobalSettings" data-help="Workflow, modello e LoRA restano impostazioni comuni del Batch; prompt, input/asset, seed, durata, steps, MP e aspect possono essere modificati per job.">
        <div class="batch-global-head">
          <strong>Impostazioni globali batch</strong>
          <div class="batch-expand-tools">
            <button type="button" class="secondary" id="batchExpandAll" data-help="Espande tutti i job preparati per modificarli.">Espandi tutti</button>
            <button type="button" class="secondary" id="batchCollapseAll" data-help="Comprime tutti i job preparati per ridurre l'ingombro.">Comprimi tutti</button>
          </div>
        </div>
        <div class="batch-global-grid">
          <label>Megapixel<input id="batchGlobalMp" type="number" min="0.1" max="16" step="0.1" disabled></label>
          <label>Aspect<select id="batchGlobalAspect" disabled>
            <option value="">— Misti —</option>
            ${BATCH_ASPECT_OPTIONS.map(opt => `<option>${opt}</option>`).join("")}
          </select></label>
          <label>Steps<input id="batchGlobalSteps" type="number" min="1" disabled></label>
        </div>
        <div class="batch-global-lora">
          <label>LoRA<select id="batchLoraId" disabled></select><small id="batchLoraHint" class="hint"></small></label>
          <label>Forza LoRA<input id="batchLoraStrength" type="number" min="0" max="1.5" step="0.05" value="0.7" disabled></label>
        </div>
        <button type="button" class="secondary" id="batchGlobalApply" disabled data-help="Copia Megapixel, Aspect e Steps globali su ogni job preparato. Non avvia render.">Applica a tutti</button>
      </div>
      <div id="batchList" class="batch-list"></div>
      <div class="batch-actions">
        <button type="button" class="secondary" id="batchAdd" data-help="Aggiunge un nuovo job al Batch preparato (duplica l'ultimo se già esistono job).">+ Job</button>
        <button type="button" class="secondary" id="batchReset" data-help="Svuota il Batch preparato. Non cancella render già completati.">Reset</button>
        <button type="button" id="batchAddToQueue" data-help="Copia il Batch preparato nella Coda. Non avvia ancora la generazione.">+ AGGIUNGI ALLA CODA</button>
        <details class="batch-advanced-actions">
          <summary>⋯ Avanzate</summary>
          <button type="button" class="secondary" id="batchQueue" data-help="Avvia subito questo Batch senza passare dalla Coda multi-batch.">⋯ Avvia questo Batch immediatamente</button>
        </details>
      </div>
      <p id="batchFeedback" class="batch-feedback">Crea i job, poi aggiungili alla Coda. Nessuna di queste azioni avvia una generazione.</p>
      <details id="batchRuntimeDetails" class="batch-runtime-details-wrap">
        <summary id="batchRuntimeSummary" class="batch-runtime-summary">ULTIMA ESECUZIONE</summary>
        <div id="batchRuntimeList" class="batch-runtime-list"></div>
      </details>
    </details>`;
  if (mount.id === "batchMount") mount.appendChild(section);
  else mount.insertBefore(section, $("monitorShell") || $("renderMonitor") || null);

  const monitor = $("renderMonitor");
  if (monitor && !$("batchMonitorSummary")) {
    const block = document.createElement("div");
    block.id = "batchMonitorSummary";
    block.className = "batch-monitor";
    block.hidden = true;
    const controls = document.createElement("div");
    controls.id = "batchInterruptControls";
    controls.className = "batch-interrupt-controls";
    controls.hidden = true;
    const btnCurrent = document.createElement("button");
    btnCurrent.type = "button";
    btnCurrent.id = "batchInterruptCurrent";
    btnCurrent.className = "secondary";
    btnCurrent.textContent = "Interrompi job corrente";
    const btnStop = document.createElement("button");
    btnStop.type = "button";
    btnStop.id = "batchInterruptAll";
    btnStop.className = "danger";
    btnStop.textContent = "INTERROMPI BATCH";
    controls.append(btnCurrent, btnStop);
    const firstDetails = monitor.querySelector(".monitor-details");
    monitor.insertBefore(controls, firstDetails || null);
    monitor.insertBefore(block, controls);
    btnCurrent.onclick = () => { void interruptCurrentBatchJob(); };
    btnStop.onclick = () => { void stopEntireBatch(); };
  }

  applyStaticControlHelp(document);
  $("batchPrepare").onclick = prepareFromDraft;
  $("batchExpandAll")?.addEventListener("click", () => setAllBatchJobsExpanded(true));
  $("batchCollapseAll")?.addEventListener("click", () => setAllBatchJobsExpanded(false));
  $("batchGlobalApply")?.addEventListener("click", () => {
    const result = applyBatchGlobalSettings();
    if (!result.ok) setFeedback(result.error, "error");
    else setFeedback(`Impostazioni globali applicate a ${items.length} job.`, "ok");
  });
  initBatchH3LoraControls({ onChange: () => commitBatchLoraFromDom() });
  $("batchAdd").onclick = () => {
    if (!items.length) return prepareFromDraft();
    if (items.length >= MAX_BATCH_JOBS) return;
    items = duplicateBatchItem(items, items.length - 1);
    markEdited();
    renderBatch();
  };
  $("batchReset").onclick = () => {
    items = [];
    source = null;
    submitted = false;
    clearBatchExpandState();
    persistDraft();
    renderBatch();
    setFeedback("Batch svuotato. Nessuna generazione avviata.");
  };
  $("batchAddToQueue")?.addEventListener("click", async () => {
    const prepared = getCurrentBatchSnapshotForQueue();
    if (!prepared.ok) return setFeedback(prepared.error, "error");
    const result = await addCurrentBatchToQueue(prepared.draft);
    if (!result.ok) setFeedback(result.error || "Impossibile aggiungere alla coda.", "error");
  });
  $("batchQueue").onclick = queueBatch;
}

function prepareFromDraft() {
  const snapshot = collectSourceSnapshot();
  if (snapshot.error) return setFeedback(snapshot.error, "error");
  source = snapshot;
  const count = clampBatchCount($("batchCount")?.value || 4);
  if ($("batchCount")) $("batchCount").value = String(count);
  items = createBatchItems(snapshot.base, count);
  submitted = false;
  clearBatchExpandState();
  persistDraft();
  renderBatch();
  const inputNote = snapshot.unsupportedVideoRoles.length
    ? ` Attenzione: ${snapshot.unsupportedVideoRoles.join(", ")} non è ancora supportato dal Batch v1.`
    : "";
  setFeedback(`Preparati ${items.length} job dal draft corrente.${inputNote}`, snapshot.unsupportedVideoRoles.length ? "warn" : "ok");
}

function renderBatch() {
  const host = $("batchList");
  if (!host) return;
  host.replaceChildren();
  $("batchBadge").textContent = items.length
    ? `Batch attuale · ${items.length} job`
    : "Batch attuale · 0 job";
  syncBatchGlobalControls();
  const mpField = $("batchGlobalMp");
  const aspectField = $("batchGlobalAspect");
  const stepsField = $("batchGlobalSteps");
  const globalEnabled = items.length > 0;
  if (mpField) mpField.disabled = !globalEnabled;
  if (aspectField) aspectField.disabled = !globalEnabled;
  if (stepsField) stepsField.disabled = !globalEnabled;
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "batch-empty";
    empty.textContent = "Nessun batch preparato.";
    host.append(empty);
    updateQueueButton();
    return;
  }

  const { library, availability } = getBatchAssetContext();
  items.forEach((item, index) => {
    const card = document.createElement("details");
    card.className = "batch-job";
    card.open = batchExpandState.has(index) ? batchExpandState.get(index) : index === 0;
    card.addEventListener("toggle", () => {
      batchExpandState.set(index, card.open);
    });
    const summary = document.createElement("summary");
    setControlHelp(summary, CONTROL_HELP.batchJobDisclosure);
    const jobTitle = document.createElement("strong");
    jobTitle.textContent = `Job ${index + 1}`;
    const summaryText = document.createElement("span");
    summaryText.className = "batch-job-summary-text";
    summaryText.textContent = formatBatchJobSummary(item);
    summary.append(jobTitle, summaryText);
    appendBatchFirstFrameSummary(
      document,
      summary,
      resolveEffectiveFirstFrame({
        itemFiles: item.files || null,
        sharedFiles: source?.files || null,
        library,
        availability
      })
    );

    const controls = document.createElement("div");
    controls.className = "batch-job-controls";
    controls.innerHTML = `
      <button type="button" data-action="up">↑</button>
      <button type="button" data-action="down">↓</button>
      <button type="button" data-action="copy">Copia</button>
      <button type="button" data-action="remove">×</button>`;
    const upBtn = controls.querySelector('[data-action="up"]');
    const downBtn = controls.querySelector('[data-action="down"]');
    const copyBtn = controls.querySelector('[data-action="copy"]');
    const removeBtn = controls.querySelector('[data-action="remove"]');
    upBtn.disabled = index === 0;
    downBtn.disabled = index === items.length - 1;
    copyBtn.disabled = items.length >= MAX_BATCH_JOBS;
    removeBtn.disabled = items.length <= MIN_BATCH_JOBS;
    applyOperatorHelp(upBtn, CONTROL_HELP.moveUp, { disabledReason: CONTROL_HELP.batchMoveUpDisabled });
    applyOperatorHelp(downBtn, CONTROL_HELP.moveDown, { disabledReason: CONTROL_HELP.batchMoveDownDisabled });
    applyOperatorHelp(copyBtn, CONTROL_HELP.duplicate, { disabledReason: CONTROL_HELP.batchCopyDisabled });
    applyOperatorHelp(removeBtn, CONTROL_HELP.remove, { disabledReason: CONTROL_HELP.batchRemoveDisabled });
    controls.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const action = event.target?.dataset?.action;
      if (action === "up") items = moveBatchItem(items, index, index - 1);
      if (action === "down") items = moveBatchItem(items, index, index + 1);
      if (action === "copy") items = duplicateBatchItem(items, index);
      if (action === "remove") items = removeBatchItem(items, index);
      if (action) {
        markEdited();
        renderBatch();
      }
    });
    summary.append(controls);

    const body = document.createElement("div");
    body.className = "batch-job-body";
    body.innerHTML = `
      <label class="wide">Prompt<textarea data-field="prompt"></textarea></label>
      <div class="batch-job-grid">
        <label>Seed<input data-field="seed" type="number"></label>
        <label>Durata (s)<input data-field="duration" type="number" min="4" max="15" step="1"></label>
        <label>Steps<input data-field="steps" type="number" min="1"></label>
        <label>Megapixel<input data-field="megapixels" type="number" min="0.1" max="16" step="0.1"></label>
        <label>Aspect<select data-field="aspect"><option>16:9</option><option>9:16</option><option>1:1</option><option>4:3</option><option>3:4</option><option>21:9</option></select></label>
      </div>`;
    for (const field of ["prompt", "seed", "duration", "steps", "megapixels", "aspect"]) {
      const input = body.querySelector(`[data-field="${field}"]`);
      input.value = item[field] ?? "";
      const update = () => {
        item[field] = field === "duration" ? String(normalizeDurationSeconds(input.value)) : input.value;
        if (field === "duration") input.value = item[field];
        summaryText.textContent = formatBatchJobSummary(item);
        markEdited();
      };
      input.addEventListener("input", update);
      input.addEventListener("change", update);
    }
    appendBatchJobInputSection(body, item);
    card.append(summary, body);
    host.append(card);
  });
  updateQueueButton();
}

function lastKnownQueue() {
  const text = $("monitorQueue")?.textContent || "";
  const match = text.match(/(\d+)\s+running\s+·\s+(\d+)\s+pending/);
  return {
    running: match ? Number(match[1]) : 0,
    pending: match ? Number(match[2]) : 0
  };
}

function updateQueueButton() {
  const button = $("batchQueue");
  if (!button) return;
  const coord = getSharedCoordinator();
  const queue = lastKnownQueue();
  const action = resolveBatchQueueAction({
    submitting,
    submitted,
    preparedCount: items.length,
    running: queue.running,
    pending: queue.pending,
    queuedNext: coord?.getQueuedNext?.() || null,
    deferredBatch: coord?.getDeferredBatch?.() || null,
    batchActive: Boolean(coord?.snapshot?.().batchActive),
    batchQueueArmed: isBatchQueueArmed()
  });
  button.disabled = action.disabled;
  button.textContent = action.label;
  button.dataset.action = action.action;
}

function validateCurrentBatch(snapshot) {
  const { library, unavailableFilenames } = getBatchAssetContext();
  const roleLabels = { ...(snapshot.roleLabels || {}) };
  const attachmentRoles = Array.isArray(snapshot.attachmentRoles) ? snapshot.attachmentRoles : [];
  for (const role of attachmentRoles) {
    if (role?.key && !roleLabels[role.key]) roleLabels[role.key] = role.label || role.key;
  }
  return validateBatchDraft({
    items,
    safeFitStatus: snapshot.safeFitStatus,
    sharedFiles: snapshot.files,
    requiredKeys: snapshot.requiredKeys,
    roleLabels,
    attachmentRoles,
    library,
    unavailableFiles: unavailableFilenames,
    unsupportedVideoRoles: snapshot.unsupportedVideoRoles,
    megapixelsMin: snapshot.megapixelsMin,
    megapixelsMax: snapshot.megapixelsMax,
    durationMin: snapshot.durationMin,
    durationMax: snapshot.durationMax
  });
}

function payloadFor(item, snapshot) {
  const clientId = sessionStorage.getItem("h3ClientId") || crypto.randomUUID();
  sessionStorage.setItem("h3ClientId", clientId);
  return {
    clientId,
    workflowId: snapshot.workflowId,
    prompt: String(item.prompt || "").trim(),
    megapixels: Number(item.megapixels),
    model: snapshot.model,
    steps: Number(item.steps),
    duration: normalizeDurationSeconds(item.duration),
    aspect: item.aspect,
    seed: Number(item.seed),
    ...queuePayloadLoraFields(snapshot),
    files: resolveBatchItemFiles(item, snapshot.files || {})
  };
}

async function runSequentialBatch(snapshot) {
  const coord = getSharedCoordinator();
  const clientId = sessionStorage.getItem("h3ClientId") || crypto.randomUUID();
  let lane = coord?.getLaneReservation?.();

  // Deferred → active MUST complete before the first /api/queue.
  if (lane?.kind === EXECUTION_LANE_KIND.DEFERRED_BATCH) {
    const transferred = await transferExecutionLaneKind({
      ownerId: lane.ownerId,
      kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
      leaseToken: lane.leaseToken
    });
    if (!transferred.ok) {
      throw new Error(transferred.error || "Impossibile attivare la lane batch.");
    }
    lane = {
      ownerId: lane.ownerId,
      kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
      leaseToken: transferred.leaseToken || lane.leaseToken,
      pageSessionId: getPageSessionId()
    };
    coord?.setLaneReservation?.(lane);
  } else if (!lane || lane.kind !== EXECUTION_LANE_KIND.ACTIVE_BATCH) {
    const ownerId = `active-batch:${clientId}`;
    const reserved = await reserveExecutionLane({
      kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
      ownerId,
      projectId: null
    });
    if (!reserved.ok) throw new Error(reserved.error || "Lane di esecuzione già riservata.");
    lane = {
      ownerId,
      kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
      leaseToken: reserved.leaseToken,
      pageSessionId: getPageSessionId()
    };
    coord?.setLaneReservation?.(lane);
  }

  const claimed = coord?.beginActiveBatch?.();
  if (claimed && !claimed.ok && claimed.reason === "locked") {
    const held = coord?.getLaneReservation?.();
    if (held?.kind === EXECUTION_LANE_KIND.ACTIVE_BATCH) {
      await releaseExecutionLane(held);
      coord?.clearLaneReservation?.();
    }
    throw new Error("Un altro invio è già in corso.");
  }
  submitting = true;
  updateQueueButton();
  try {
    setFeedback(`Preflight OK. Invio sequenziale di ${items.length} job…`, "ok");
    const batchId = crypto.randomUUID();
    const snapshotItems = items.map(item => cloneBatchItemSnapshot(item));
    const laneHeaders = () => executionLaneSubmitHeaders(coord?.getLaneReservation?.());

    const result = await submitBatchSequentially(snapshotItems, async (item, index) => {
      const response = await fetch("/api/queue", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-h3-batch-id": batchId,
          "x-h3-batch-index": String(index),
          ...laneHeaders()
        },
        body: JSON.stringify(payloadFor(item, snapshot))
      });
      const data = await response.json();
      if (!response.ok || !data.prompt_id) {
        throw new Error(data.error || JSON.stringify(data.node_errors || {}) || `Invio Job ${index + 1} fallito`);
      }
      return data;
    });

    const acceptedByIndex = new Map(result.accepted.map(entry => [entry.index, entry.prompt_id]));
    runtime = {
      version: 1,
      batchId,
      createdAt: Date.now(),
      startedAt: Date.now(),
      workflowId: snapshot.workflowId,
      workflowLabel: snapshot.workflowLabel,
      model: snapshot.model,
      jobs: snapshotItems.map((item, index) => ({
        index,
        label: `Job ${index + 1}`,
        promptId: acceptedByIndex.get(index) || null,
        state: acceptedByIndex.has(index) ? "pending" : "not-submitted",
        error: result.failure?.index === index ? result.failure.error : null,
        item,
        outputs: [],
        outputsFetched: false
      }))
    };
    batchRunStartedAt = runtime.startedAt;
    persistRuntime();
    submitted = result.accepted.length > 0;
    renderRuntime();

    if (result.complete) {
      setFeedback(`Batch inviato: ${result.accepted.length}/${snapshotItems.length} job accettati da ComfyUI in ordine.`, "ok");
    } else {
      const failedAt = result.failure ? `Job ${result.failure.index + 1}: ${result.failure.error}` : "errore sconosciuto";
      setFeedback(`Invio parziale: ${result.accepted.length}/${snapshotItems.length} accettati. ${failedAt}. Nessun retry automatico; i job successivi non sono stati inviati.`, "error");
    }
    if (result.accepted.length) startPolling();
    return result;
  } finally {
    submitting = false;
    coord?.endActiveBatch?.();
    stopExecutionLaneHeartbeat();
    const held = coord?.getLaneReservation?.();
    if (held?.kind === EXECUTION_LANE_KIND.ACTIVE_BATCH) {
      await releaseExecutionLane(held);
      coord?.clearLaneReservation?.();
    }
    updateQueueButton();
  }
}

async function queueBatch() {
  if (submitting || submitted || items.length < MIN_BATCH_JOBS) return;
  const live = collectSourceSnapshot();
  if (live.error) return setFeedback(live.error, "error");
  if (!source || sourceIdentity(live) !== sourceIdentity(source)) {
    return setFeedback("Il contesto comune della Scena è cambiato (workflow o modello). Premi “Crea job dalla scena corrente” prima di inviare.", "warn");
  }
  const snapshot = freezeSubmissionSnapshot(source, live);
  const validation = validateCurrentBatch(snapshot);
  if (!validation.valid) return setFeedback(validation.errors.join(" "), "error");
  const loraCheck = validatePreparedBatchLora(snapshot);
  if (!loraCheck.ok) return setFeedback(loraCheck.error, "error");

  submitting = true;
  updateQueueButton();
  try {
    const coord = getSharedCoordinator();
    const activeResponse = await fetch("/api/active");
    const active = await activeResponse.json();
    if (!activeResponse.ok) throw new Error(active.error || "Impossibile controllare la queue ComfyUI.");
    const running = Number(active.running || 0);
    const pending = Number(active.pending || 0);
    coord?.markQueue?.({ running, pending });

    const action = resolveBatchQueueAction({
      submitting: false,
      submitted,
      preparedCount: items.length,
      running,
      pending,
      queuedNext: coord?.getQueuedNext?.() || null,
      deferredBatch: coord?.getDeferredBatch?.() || null,
      batchActive: Boolean(coord?.snapshot?.().batchActive)
    });

    if (action.action === "defer") {
      archivePrompt({
        prompt: snapshot.base?.prompt || "",
        projectLabel: $("projectLabel")?.value || "",
        workflowLabel: snapshot.workflowLabel || ""
      }, { storage: localStorage });
      const ownerId = `deferred-batch:${sessionStorage.getItem("h3ClientId") || crypto.randomUUID()}`;
      const reserved = await reserveExecutionLane({
        kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
        ownerId,
        projectId: null
      });
      if (!reserved.ok) throw new Error(reserved.error || "Lane di esecuzione già riservata.");
      const armed = coord.armDeferredBatch({
        items: items.map(item => cloneBatchItemSnapshot(item)),
        snapshot: {
          ...snapshot,
          files: { ...(snapshot.files || {}) }
        },
        submitAll: () => runSequentialBatch(snapshot)
      });
      if (!armed.ok) {
        await releaseExecutionLane({
          ownerId,
          kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
          leaseToken: reserved.leaseToken
        });
        throw new Error("Impossibile armare il batch in attesa.");
      }
      coord.setLaneReservation?.({
        ownerId,
        kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
        leaseToken: reserved.leaseToken,
        pageSessionId: getPageSessionId()
      });
      startExecutionLaneHeartbeat(ownerId, { leaseToken: reserved.leaseToken });
      setFeedback(`BATCH · ${items.length} job preparati. In attesa che il render corrente termini. Nessun job inviato.`, "ok");
      return;
    }

    if (action.action !== "queue") {
      throw new Error(action.reason || "Batch non inviabile in questo stato.");
    }

    archivePrompt({
      prompt: snapshot.base?.prompt || "",
      projectLabel: $("projectLabel")?.value || "",
      workflowLabel: snapshot.workflowLabel || ""
    }, { storage: localStorage });
    await runSequentialBatch(snapshot);
  } catch (error) {
    setFeedback(error?.message || String(error), "error");
  } finally {
    submitting = false;
    updateQueueButton();
  }
}

function stateLabel(state) {
  if (state === "completed") return "completato";
  if (state === "running") return "in esecuzione";
  if (state === "interrupting") return "interruzione…";
  if (state === "error") return "errore";
  if (state === "interrupted") return "interrotto";
  if (state === "cancelled") return "annullato";
  if (state === "not-submitted") return "non inviato";
  return "in coda";
}

async function refreshBatchOwnership() {
  if (!runtime?.batchId || !batchHasActiveWork(runtime.jobs)) {
    batchOwnershipControllable = false;
    return;
  }
  try {
    const response = await fetch(`/api/runtime/ownership?batchId=${encodeURIComponent(runtime.batchId)}`);
    const data = await response.json();
    batchOwnershipControllable = Boolean(data.controllable);
  } catch {
    batchOwnershipControllable = false;
  }
}

function renderBatchInterruptControls() {
  const controls = $("batchInterruptControls");
  const btnCurrent = $("batchInterruptCurrent");
  const btnStop = $("batchInterruptAll");
  if (!controls || !btnCurrent || !btnStop) return;
  const jobs = runtime?.jobs || [];
  const currentAction = batchCurrentInterruptActionable({
    jobs,
    ownershipControllable: batchOwnershipControllable,
    interruptPending: batchInterruptPending
  });
  const stopAction = batchStopActionable({
    jobs,
    ownershipControllable: batchOwnershipControllable,
    stopPending: batchStopPending
  });
  controls.hidden = !currentAction.visible && !stopAction.visible;
  btnCurrent.hidden = !currentAction.visible;
  btnCurrent.disabled = !currentAction.enabled;
  btnStop.hidden = !stopAction.visible;
  btnStop.disabled = !stopAction.enabled;
}

async function interruptCurrentBatchJob() {
  if (!runtime?.batchId || batchInterruptPending) return;
  const active = findActiveBatchJob(runtime.jobs);
  if (!active?.promptId) return;
  const currentAction = batchCurrentInterruptActionable({
    jobs: runtime.jobs,
    ownershipControllable: batchOwnershipControllable,
    interruptPending: batchInterruptPending
  });
  if (!currentAction.enabled) return;
  if (!confirm(batchCurrentInterruptConfirmMessage(active.label))) return;
  batchInterruptPending = true;
  active.state = "interrupting";
  renderRuntime();
  try {
    const response = await fetch("/api/runtime/interrupt-batch-current", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batchId: runtime.batchId, expectedPromptId: active.promptId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Interruzione non disponibile.");
    setFeedback(`Interruzione richiesta per ${active.label}. I job successivi in coda continueranno.`, "ok");
  } catch (error) {
    batchInterruptPending = false;
    active.state = "running";
    setFeedback(error.message, "error");
    renderRuntime();
  }
}

async function stopEntireBatch() {
  if (!runtime?.batchId || batchStopPending) return;
  const stopAction = batchStopActionable({
    jobs: runtime.jobs,
    ownershipControllable: batchOwnershipControllable,
    stopPending: batchStopPending
  });
  if (!stopAction.enabled) return;
  if (!confirm(batchStopConfirmMessage())) return;
  batchStopPending = true;
  const active = findActiveBatchJob(runtime.jobs);
  renderRuntime();
  try {
    const response = await fetch("/api/runtime/stop-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        batchId: runtime.batchId,
        expectedRunningPromptId: active?.promptId || null
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Interruzione batch non disponibile.");
    runtime.jobs = applyBatchStopResult(runtime.jobs, data);
    persistRuntime();
    const summary = formatBatchRuntimeSummary(runtime.jobs);
    setFeedback(`Batch interrotto · ${summary}`, "warn");
  } catch (error) {
    setFeedback(error.message, "error");
  } finally {
    batchStopPending = false;
    batchInterruptPending = false;
    renderRuntime();
  }
}

function renderRuntime() {
  const host = $("batchRuntimeList");
  const monitor = $("batchMonitorSummary");
  const wrap = $("batchRuntimeDetails");
  const summaryEl = $("batchRuntimeSummary");
  if (!host || !monitor) return;
  host.replaceChildren();
  if (!runtime?.jobs?.length) {
    monitor.hidden = true;
    if (wrap) wrap.hidden = true;
    return;
  }
  const summary = summarizeBatchJobs(runtime.jobs);
  monitor.hidden = false;
  if (wrap) wrap.hidden = false;
  const progress = buildBatchProgressView({
    jobs: runtime.jobs,
    renderProgress: liveBatchRenderProgress,
    startedAt: batchRunStartedAt || runtime.startedAt || null
  });
  const runtimeSummary = formatBatchRuntimeSummary(runtime.jobs);
  const renderBits = progress.render.kind === "numeric"
    ? ` · ${progress.render.label}`
    : progress.running
      ? ` · ${progress.render.label && progress.render.kind === "indeterminate" ? progress.render.label : "Rendering…"}`
      : "";
  const etaBits = progress.etaText ? ` · ETA ${progress.etaText}` : "";
  monitor.innerHTML = `<strong>BATCH ${progress.completed}/${progress.total}</strong><span>${progress.label}${renderBits} · ${runtimeSummary} · ${summary.running} running · ${summary.pending} pending · Tempo ${progress.elapsed.text}${etaBits}</span>`;
  renderBatchInterruptControls();

  const allTerminal = runtime.jobs.every(job => isTerminalBatchState(job.state) || job.state === "cancelled");
  const needsAttention = runtime.jobs.some(job =>
    job.state === "failed" || job.state === "error" || job.state === "recovery-required"
  );
  if (summaryEl) {
    summaryEl.textContent = allTerminal
      ? `ULTIMA ESECUZIONE · ${progress.completed}/${progress.total} COMPLETATI`
      : `ESECUZIONE IN CORSO · ${progress.completed}/${progress.total}`;
  }
  if (wrap) {
    // Keep open when active or recovery/error; collapse terminal history by default.
    if (!allTerminal || needsAttention) wrap.open = true;
    else if (!wrap.dataset.userToggled) wrap.open = false;
    wrap.addEventListener("toggle", () => {
      wrap.dataset.userToggled = "1";
    }, { once: true });
  }

  const title = document.createElement("div");
  title.className = "batch-runtime-head";
  title.textContent = `Ultimo batch · ${runtime.workflowLabel || runtime.workflowId} · ${runtime.model || ""}`;
  host.append(title);

  runtime.jobs.forEach(job => {
    const row = document.createElement("details");
    row.className = `batch-runtime-job state-${job.state}`;
    const summaryRow = document.createElement("summary");
    const id = job.promptId ? promptIdPrefix(job.promptId) : "—";
    summaryRow.innerHTML = `<strong>${job.label}</strong><span>${stateLabel(job.state)} · ${id}</span>`;
    setControlHelp(summaryRow, CONTROL_HELP.batchRuntimeJobDisclosure);
    const details = document.createElement("div");
    details.className = "batch-runtime-details";
    details.innerHTML = `<div>prompt_id: <code>${job.promptId || "non inviato"}</code></div><div>${formatBatchJobSummary(job.item || {})} · ${job.item?.steps || "—"} steps</div>${job.error ? `<div class="batch-error">${job.error}</div>` : ""}`;
    const outputRows = batchJobOutputRows(runtime.jobs);
    const outputRow = outputRows[job.index] || outputRows.find(item => item.label === job.label);
    if (outputRow?.url) {
      const outWrap = document.createElement("div");
      outWrap.className = "batch-job-output";
      if (outputRow.latest) {
        const flag = document.createElement("span");
        flag.className = "latest-output-flag";
        flag.textContent = "ULTIMO OUTPUT";
        outWrap.append(flag);
      }
      const link = document.createElement("a");
      link.href = outputRow.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Apri video";
      applyOperatorHelp(link, CONTROL_HELP.sessionOpenVideo);
      outWrap.append(link);
      details.append(outWrap);
    }
    row.append(summaryRow, details);
    host.append(row);
  });
}

async function pollRuntime() {
  if (!runtime?.jobs?.length) return;
  let active = null;
  try {
    const response = await fetch("/api/active");
    if (response.ok) active = await response.json();
  } catch { /* status remains conservative */ }
  await refreshBatchOwnership();

  for (const job of runtime.jobs) {
    if (!job.promptId || isTerminalBatchState(job.state)) continue;
    if (job.state === "cancelled") continue;
    try {
      const response = await fetch(`/api/history?promptId=${encodeURIComponent(job.promptId)}`);
      const history = await response.json();
      if (response.ok) {
        const state = classifyHistoryState(history, job.promptId);
        if (state === "completed") {
          job.state = "completed";
          batchInterruptPending = false;
          if (!job.outputsFetched) {
            const outResponse = await fetch(`/api/outputs?promptId=${encodeURIComponent(job.promptId)}`);
            const out = await outResponse.json();
            if (outResponse.ok && Array.isArray(out)) {
              job.outputs = out;
              job.outputsFetched = true;
              upsertSessionOutputs(sessionStorage, buildSessionOutputRecords(out, {
                promptId: job.promptId,
                source: "batch",
                jobLabel: job.label || `Job ${(job.index ?? 0) + 1}`,
                jobIndex: job.index ?? null,
                batchTotal: runtime.jobs.length,
                workflowId: runtime.workflowId || "",
                workflowLabel: runtime.workflowLabel || "",
                model: runtime.model || "",
                seed: job.item?.seed ?? "",
                duration: job.item?.duration ?? null,
                megapixels: job.item?.megapixels ?? "",
                aspect: job.item?.aspect ?? "",
                steps: job.item?.steps ?? "",
                completedAt: Date.now()
              }));
              notifySessionOutputsChanged();
            }
          }
          continue;
        }
        if (state === "failed") {
          const label = historyFailureLabel(history, job.promptId);
          job.state = label === "interrupted" ? "interrupted" : "error";
          if (label === "interrupted") batchInterruptPending = false;
          continue;
        }
      }
    } catch { /* keep pending/running */ }
    if (job.state === "interrupting") {
      if (active?.active && active.promptId === job.promptId) continue;
      continue;
    }
    job.state = active?.active && active.promptId === job.promptId ? "running" : "pending";
  }

  persistRuntime();
  renderRuntime();
  if (runtime.jobs.every(job => isTerminalBatchState(job.state))) {
    batchInterruptPending = false;
    batchStopPending = false;
    stopPolling();
  }
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function startPolling() {
  stopPolling();
  pollRuntime();
  pollTimer = setInterval(pollRuntime, POLL_MS);
}

async function init() {
  createUi();
  try {
    const response = await fetch("/api/config");
    config = await response.json();
  } catch {
    setFeedback("Batch non disponibile: impossibile leggere la configurazione.", "error");
    return;
  }

  loadDraftFromLocalStorage();
  loadRuntime();
  window.addEventListener("h3-queue-sample", () => updateQueueButton());
  window.addEventListener("h3-batch-queue-armed", () => updateQueueButton());
  window.addEventListener("h3-batch-queue-changed", () => updateQueueButton());
  window.addEventListener("h3-batch-queue-runtime", () => updateQueueButton());
  window.addEventListener("h3-comfy-progress", event => {
    const raw = event?.detail?.progress || null;
    if (raw?.nodeId && raw?.displayNode) {
      batchNodeDisplayById.set(String(raw.nodeId), String(raw.displayNode));
    }
    liveBatchRenderProgress = enrichProgressWithNodeContext(raw, batchNodeDisplayById);
    if (runtime?.jobs?.length) renderRuntime();
  });
  window.addEventListener("h3-deferred-batch-cancel", () => {
    setFeedback("Attesa batch annullata. Nessun job inviato.", "warn");
    updateQueueButton();
  });
  window.addEventListener("h3-project-batch-restore", event => {
    const draft = event?.detail?.batchDraft || null;
    const result = importBatchDraftFromProject(draft, {
      writeLocalCache: true,
      notify: Boolean(event?.detail?.notifyPersistence)
    });
    if (result.restored) {
      setFeedback(`Batch ripristinato · ${result.count} job`, "ok");
    }
  });
  $("workflow")?.addEventListener("change", () => {
    if (items.length) setFeedback("Workflow cambiato. Premi “Crea job dalla scena corrente” per aggiornare il batch prima dell'invio.", "warn");
  });
  $("model")?.addEventListener("change", () => {
    if (items.length) setFeedback("Modello cambiato. Premi “Crea job dalla scena corrente” per aggiornare il batch prima dell'invio.", "warn");
  });
}

if (document.readyState === "complete") init();
else window.addEventListener("load", init, { once: true });
