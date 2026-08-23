import { classifyHistoryState, historyFailureLabel, promptIdPrefix } from "./recovery.mjs";
import {
  MAX_BATCH_JOBS,
  MIN_BATCH_JOBS,
  clampBatchCount,
  createBatchItems,
  duplicateBatchItem,
  formatBatchJobSummary,
  isTerminalBatchState,
  moveBatchItem,
  removeBatchItem,
  resolveBatchItemFiles,
  submitBatchSequentially,
  summarizeBatchJobs,
  validateBatchDraft
} from "./batch-core.mjs";
import { normalizeBatchDraft, normalizeItemFiles, serializeBatchDraft } from "../lib/batch-draft.mjs";
import { normalizeDurationSeconds } from "../lib/duration.mjs";
import { memberSelectOption, membersCompatibleWithRole, roleAcceptKind } from "../lib/projects.mjs";
import { archivePrompt } from "./prompt-history.mjs";
import { batchJobOutputRows } from "./completion.mjs";
import {
  getSharedCoordinator,
  resolveBatchQueueAction
} from "./queue-coordinator.mjs";

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
let persistenceHook = null;
let suppressLocalLoad = false;
let assetContextProvider = null;

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

function getBatchAssetContext() {
  const ctx = assetContextProvider?.() || {};
  const unavailable = ctx.unavailableFilenames instanceof Set
    ? ctx.unavailableFilenames
    : new Set(Array.isArray(ctx.unavailableFilenames) ? ctx.unavailableFilenames : []);
  return {
    library: ctx.library || { groups: [] },
    unavailableFilenames: unavailable
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
    renderBatch();
    if (writeLocalCache) persistDraft({ notify });
    return { restored: false, count: 0 };
  }
  items = normalized.items.map(item => cloneBatchItemSnapshot(item));
  source = normalized.source;
  submitted = false;
  renderBatch();
  if (writeLocalCache) persistDraft({ notify });
  return { restored: true, count: items.length };
}

export function clearBatchEditor({ writeLocalCache = true, notify = true } = {}) {
  items = [];
  source = null;
  submitted = false;
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
  if (saved?.version === 1 && Array.isArray(saved.jobs) && saved.jobs.length) runtime = saved;
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
    }
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
    base: base.base ? { ...base.base } : (liveMeta.base ? { ...liveMeta.base } : {})
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
    <details id="batchDetails">
      <summary><span>Batch</span><span id="batchBadge" class="batch-badge">nessun job</span></summary>
      <p class="batch-help">2–8 render in coda con un solo click. Workflow e modello restano comuni; prompt, input/asset, seed, durata, steps, MP e aspect possono essere modificati per job.</p>
      <div class="batch-prepare-row">
        <label>Numero job<input id="batchCount" type="number" min="${MIN_BATCH_JOBS}" max="${MAX_BATCH_JOBS}" value="4"></label>
        <button type="button" class="secondary" id="batchPrepare">Prepara dal draft</button>
      </div>
      <div id="batchList" class="batch-list"></div>
      <div class="batch-actions">
        <button type="button" class="secondary" id="batchAdd">+ Job</button>
        <button type="button" class="secondary" id="batchReset">Reset</button>
        <button type="button" id="batchQueue">Queue batch</button>
      </div>
      <p id="batchFeedback" class="batch-feedback">Prepara il batch dal draft corrente. Nessuna modifica avvia una generazione.</p>
      <div id="batchRuntimeList" class="batch-runtime-list"></div>
    </details>`;
  if (mount.id === "batchMount") mount.appendChild(section);
  else mount.insertBefore(section, $("monitorShell") || $("renderMonitor") || null);

  const monitor = $("renderMonitor");
  if (monitor && !$("batchMonitorSummary")) {
    const block = document.createElement("div");
    block.id = "batchMonitorSummary";
    block.className = "batch-monitor";
    block.hidden = true;
    const firstDetails = monitor.querySelector(".monitor-details");
    monitor.insertBefore(block, firstDetails || null);
  }

  $("batchPrepare").onclick = prepareFromDraft;
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
    persistDraft();
    renderBatch();
    setFeedback("Batch svuotato. Nessuna generazione avviata.");
  };
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
  $("batchBadge").textContent = items.length ? `${items.length} job` : "nessun job";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "batch-empty";
    empty.textContent = "Nessun batch preparato.";
    host.append(empty);
    updateQueueButton();
    return;
  }

  items.forEach((item, index) => {
    const card = document.createElement("details");
    card.className = "batch-job";
    card.open = index === 0;
    const summary = document.createElement("summary");
    summary.innerHTML = `<strong>Job ${index + 1}</strong><span>${formatBatchJobSummary(item)}</span>`;

    const controls = document.createElement("div");
    controls.className = "batch-job-controls";
    controls.innerHTML = `
      <button type="button" data-action="up" title="Sposta su">↑</button>
      <button type="button" data-action="down" title="Sposta giù">↓</button>
      <button type="button" data-action="copy" title="Duplica">Copia</button>
      <button type="button" data-action="remove" title="Rimuovi">×</button>`;
    controls.querySelector('[data-action="up"]').disabled = index === 0;
    controls.querySelector('[data-action="down"]').disabled = index === items.length - 1;
    controls.querySelector('[data-action="copy"]').disabled = items.length >= MAX_BATCH_JOBS;
    controls.querySelector('[data-action="remove"]').disabled = items.length <= MIN_BATCH_JOBS;
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
        summary.querySelector("span").textContent = formatBatchJobSummary(item);
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
    batchActive: Boolean(coord?.snapshot?.().batchActive)
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
    files: resolveBatchItemFiles(item, snapshot.files || {})
  };
}

async function runSequentialBatch(snapshot) {
  const coord = getSharedCoordinator();
  const claimed = coord?.beginActiveBatch?.();
  if (claimed && !claimed.ok && claimed.reason === "locked") {
    throw new Error("Un altro invio è già in corso.");
  }
  submitting = true;
  updateQueueButton();
  try {
    setFeedback(`Preflight OK. Invio sequenziale di ${items.length} job…`, "ok");
    const batchId = crypto.randomUUID();
    const snapshotItems = items.map(item => cloneBatchItemSnapshot(item));

    const result = await submitBatchSequentially(snapshotItems, async (item, index) => {
      const response = await fetch("/api/queue", {
        method: "POST",
        headers: { "content-type": "application/json", "x-h3-batch-id": batchId, "x-h3-batch-index": String(index) },
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
    updateQueueButton();
  }
}

async function queueBatch() {
  if (submitting || submitted || items.length < MIN_BATCH_JOBS) return;
  const live = collectSourceSnapshot();
  if (live.error) return setFeedback(live.error, "error");
  if (!source || sourceIdentity(live) !== sourceIdentity(source)) {
    return setFeedback("Il draft comune è cambiato (workflow o modello). Premi “Prepara dal draft” prima di inviare.", "warn");
  }
  const snapshot = freezeSubmissionSnapshot(source, live);
  const validation = validateCurrentBatch(snapshot);
  if (!validation.valid) return setFeedback(validation.errors.join(" "), "error");

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
      const armed = coord.armDeferredBatch({
        items: items.map(item => cloneBatchItemSnapshot(item)),
        snapshot: {
          ...snapshot,
          files: { ...(snapshot.files || {}) }
        },
        submitAll: () => runSequentialBatch(snapshot)
      });
      if (!armed.ok) throw new Error("Impossibile armare il batch in attesa.");
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
  if (state === "error") return "errore";
  if (state === "interrupted") return "interrotto";
  if (state === "not-submitted") return "non inviato";
  return "in coda";
}

function renderRuntime() {
  const host = $("batchRuntimeList");
  const monitor = $("batchMonitorSummary");
  if (!host || !monitor) return;
  host.replaceChildren();
  if (!runtime?.jobs?.length) {
    monitor.hidden = true;
    return;
  }
  const summary = summarizeBatchJobs(runtime.jobs);
  monitor.hidden = false;
  monitor.innerHTML = `<strong>BATCH ${summary.completed}/${summary.total}</strong><span>${summary.running} running · ${summary.pending} pending · ${summary.failed + summary.interrupted} failed${summary.notSubmitted ? ` · ${summary.notSubmitted} non inviati` : ""}</span>`;

  const title = document.createElement("div");
  title.className = "batch-runtime-head";
  title.textContent = `Ultimo batch · ${runtime.workflowLabel || runtime.workflowId} · ${runtime.model || ""}`;
  host.append(title);

  runtime.jobs.forEach(job => {
    const row = document.createElement("details");
    row.className = `batch-runtime-job state-${job.state}`;
    const summaryEl = document.createElement("summary");
    const id = job.promptId ? promptIdPrefix(job.promptId) : "—";
    summaryEl.innerHTML = `<strong>${job.label}</strong><span>${stateLabel(job.state)} · ${id}</span>`;
    const details = document.createElement("div");
    details.className = "batch-runtime-details";
    const seed = job.item?.seed ?? "—";
    details.innerHTML = `<div>prompt_id: <code>${job.promptId || "non inviato"}</code></div><div>${formatBatchJobSummary(job.item || {})} · ${job.item?.steps || "—"} steps</div>${job.error ? `<div class="batch-error">${job.error}</div>` : ""}`;
    const outputRows = batchJobOutputRows(runtime.jobs);
    const outputRow = outputRows[job.index] || outputRows.find(item => item.label === job.label);
    if (outputRow?.url) {
      const wrap = document.createElement("div");
      wrap.className = "batch-job-output";
      if (outputRow.latest) {
        const flag = document.createElement("span");
        flag.className = "latest-output-flag";
        flag.textContent = "ULTIMO OUTPUT";
        wrap.append(flag);
      }
      const link = document.createElement("a");
      link.href = outputRow.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Apri video";
      wrap.append(link);
      details.append(wrap);
    }
    row.append(summaryEl, details);
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

  for (const job of runtime.jobs) {
    if (!job.promptId || isTerminalBatchState(job.state)) continue;
    try {
      const response = await fetch(`/api/history?promptId=${encodeURIComponent(job.promptId)}`);
      const history = await response.json();
      if (response.ok) {
        const state = classifyHistoryState(history, job.promptId);
        if (state === "completed") {
          job.state = "completed";
          if (!job.outputsFetched) {
            const outResponse = await fetch(`/api/outputs?promptId=${encodeURIComponent(job.promptId)}`);
            const out = await outResponse.json();
            if (outResponse.ok && Array.isArray(out)) {
              job.outputs = out;
              job.outputsFetched = true;
            }
          }
          continue;
        }
        if (state === "failed") {
          const label = historyFailureLabel(history, job.promptId);
          job.state = label === "interrupted" ? "interrupted" : "error";
          continue;
        }
      }
    } catch { /* keep pending/running */ }
    job.state = active?.active && active.promptId === job.promptId ? "running" : "pending";
  }

  persistRuntime();
  renderRuntime();
  if (runtime.jobs.every(job => isTerminalBatchState(job.state))) stopPolling();
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
    if (items.length) setFeedback("Workflow cambiato. Premi “Prepara dal draft” per aggiornare il batch prima dell'invio.", "warn");
  });
  $("model")?.addEventListener("change", () => {
    if (items.length) setFeedback("Modello cambiato. Premi “Prepara dal draft” per aggiornare il batch prima dell'invio.", "warn");
  });
}

if (document.readyState === "complete") init();
else window.addEventListener("load", init, { once: true });
