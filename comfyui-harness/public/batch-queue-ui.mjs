/**
 * CODA BATCH UI + client plan sync (Issue #47).
 */

import {
  BATCH_QUEUE_FAILURE_POLICY,
  QUEUE_ENTRY_STATE,
  appendQueueEntry,
  cancelQueueEntry,
  createQueueEntryFromDraft,
  defaultQueueEntryName,
  isActiveQueueEntryState,
  normalizeBatchQueuePlan,
  serializeBatchQueuePlan,
  summarizeQueuePlan,
  validateQueueCapacity
} from "../lib/batch-queue-plan.mjs";
import { QUEUE_OVERALL_STATE } from "../lib/batch-queue-plan.mjs";

const $ = id => document.getElementById(id);
const POLL_MS = 4000;

let plan = null;
let runtimeView = null;
let pollTimer = null;
let projectIdProvider = () => "";
let onDirty = null;
let feedbackNode = null;

const ENTRY_STATE_LABELS = {
  [QUEUE_ENTRY_STATE.QUEUED]: "IN CODA",
  [QUEUE_ENTRY_STATE.SUBMITTING]: "IN ESECUZIONE",
  [QUEUE_ENTRY_STATE.RUNNING]: "IN ESECUZIONE",
  [QUEUE_ENTRY_STATE.COMPLETED]: "COMPLETATO",
  [QUEUE_ENTRY_STATE.FAILED]: "FALLITO",
  [QUEUE_ENTRY_STATE.CANCELLED]: "ANNULLATO",
  [QUEUE_ENTRY_STATE.RECOVERY_REQUIRED]: "RECUPERO RICHIESTO"
};

function currentProjectId() {
  return String(projectIdProvider() || "").trim();
}

function notifyDirty() {
  onDirty?.();
  window.dispatchEvent(new CustomEvent("h3-batch-queue-changed"));
}

function setFeedback(message, kind = "neutral") {
  if (!feedbackNode) feedbackNode = $("batchQueueFeedback");
  if (!feedbackNode) return;
  feedbackNode.textContent = message;
  feedbackNode.dataset.kind = kind;
}

export function exportBatchQueueForProject() {
  return serializeBatchQueuePlan(plan);
}

export function exportBatchQueueForPersistence() {
  return serializeBatchQueuePlan(plan);
}

export function importBatchQueueFromProject(raw = null) {
  plan = normalizeBatchQueuePlan(raw);
  renderQueueUi();
  return { restored: Boolean(plan), count: plan?.entries?.length || 0 };
}

export function isBatchQueueArmed() {
  return Boolean(runtimeView?.armed && runtimeView?.authorityPresent);
}

export function isBatchQueueBlocking() {
  if (!runtimeView) return false;
  const state = runtimeView.overallState;
  return Boolean(runtimeView.armed && state !== QUEUE_OVERALL_STATE.IDLE
    && state !== QUEUE_OVERALL_STATE.COMPLETED
    && state !== QUEUE_OVERALL_STATE.RECOVERY_REQUIRED);
}

export function getBatchQueueRuntimeView() {
  return runtimeView;
}

export async function syncBatchQueuePlanToServer() {
  const projectId = currentProjectId();
  if (!projectId) return;
  try {
    const response = await fetch("/api/batch-queue/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, plan: exportBatchQueueForProject() })
    });
    if (response.ok) runtimeView = await response.json();
  } catch { /* reconnect on poll */ }
}

async function fetchRuntime() {
  const projectId = currentProjectId();
  if (!projectId) {
    runtimeView = null;
    return;
  }
  try {
    const response = await fetch(`/api/batch-queue/runtime?projectId=${encodeURIComponent(projectId)}`);
    if (response.ok) runtimeView = await response.json();
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("h3-batch-queue-runtime", { detail: runtimeView }));
  renderQueueUi();
}

function startPolling() {
  stopPolling();
  void fetchRuntime();
  pollTimer = setInterval(() => { void fetchRuntime(); }, POLL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function mergeRuntimeEntries() {
  if (!plan?.entries?.length) return [];
  const live = runtimeView?.entries || [];
  return plan.entries.map(entry => {
    const match = live.find(item => item.queueEntryId === entry.queueEntryId);
    return match ? { ...entry, ...match, snapshot: entry.snapshot } : entry;
  });
}

function renderSummary(entries) {
  const summary = summarizeQueuePlan(entries);
  const node = $("batchQueueSummary");
  if (!node) return;
  const completed = entries.filter(e => e.state === QUEUE_ENTRY_STATE.COMPLETED).length;
  node.textContent = `${completed} / ${entries.length} batch completati · ${summary.remainingJobs} job rimanenti`;
}

function renderQueueControls(entries) {
  const armBtn = $("batchQueueArm");
  const resumeBtn = $("batchQueueResume");
  const policySelect = $("batchQueueFailurePolicy");
  if (!armBtn || !resumeBtn) return;

  const overall = runtimeView?.overallState || QUEUE_OVERALL_STATE.IDLE;
  const hasQueued = entries.some(e => e.state === QUEUE_ENTRY_STATE.QUEUED);
  const recovery = overall === QUEUE_OVERALL_STATE.RECOVERY_REQUIRED
    || entries.some(e => e.state === QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);
  const armed = Boolean(runtimeView?.armed && runtimeView?.authorityPresent);
  const paused = overall === QUEUE_OVERALL_STATE.PAUSED
    || overall === QUEUE_OVERALL_STATE.PAUSED_FAILURE;

  armBtn.hidden = armed || recovery || paused;
  armBtn.disabled = !hasQueued;
  resumeBtn.hidden = !recovery && !paused;
  resumeBtn.disabled = !hasQueued && !recovery;

  if (policySelect && plan) {
    policySelect.value = plan.failurePolicy || BATCH_QUEUE_FAILURE_POLICY.STOP;
    policySelect.disabled = armed;
  }

  const banner = $("batchQueueRecoveryBanner");
  if (banner) {
    banner.hidden = !recovery;
    banner.textContent = recovery
      ? "CODA IN PAUSA — DIRECTOR RIAVVIATO. Il piano della coda è stato ripristinato, ma l'esecuzione automatica deve essere riattivata."
      : "";
  }
}

function renderEntryCard(entry, index, entries) {
  const card = document.createElement("div");
  card.className = "batch-queue-card";
  card.dataset.entryId = entry.queueEntryId;
  const jobs = entry.snapshot?.items || [];
  const editable = entry.state === QUEUE_ENTRY_STATE.QUEUED && !isBatchQueueArmed();
  const isCurrent = runtimeView?.currentEntryId === entry.queueEntryId;
  const jobProgress = isCurrent && runtimeView?.currentJobIndex != null
    ? `Job ${Number(runtimeView.currentJobIndex) + 1} / ${jobs.length}`
    : `${jobs.length} job`;
  const workflow = entry.snapshot?.source?.workflowLabel || entry.snapshot?.source?.workflowId || "—";

  card.innerHTML = `
    <div class="batch-queue-card-head">
      <strong>${index + 1}. ${entry.name}</strong>
      <span class="batch-queue-state">${ENTRY_STATE_LABELS[entry.state] || entry.state}</span>
    </div>
    <div class="batch-queue-card-meta">${jobProgress} · ${workflow}</div>`;

  if (editable) {
    const tools = document.createElement("div");
    tools.className = "batch-queue-card-tools";
    const up = document.createElement("button");
    up.type = "button";
    up.className = "secondary";
    up.textContent = "↑";
    up.disabled = index === 0 || entries[index - 1]?.state !== QUEUE_ENTRY_STATE.QUEUED;
    up.onclick = () => { void reorderEntry(index, index - 1); };
    const down = document.createElement("button");
    down.type = "button";
    down.className = "secondary";
    down.textContent = "↓";
    down.disabled = index >= entries.length - 1 || entries[index + 1]?.state !== QUEUE_ENTRY_STATE.QUEUED;
    down.onclick = () => { void reorderEntry(index, index + 1); };
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "secondary";
    rename.textContent = "Rinomina";
    rename.onclick = () => {
      const next = prompt("Nome batch:", entry.name);
      if (next?.trim()) void updateEntry(entry.queueEntryId, { name: next.trim() });
    };
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Rimuovi";
    remove.onclick = () => { void cancelEntry(entry.queueEntryId); };
    tools.append(up, down, rename, remove);
    card.append(tools);
  }
  return card;
}

function renderQueueUi() {
  const list = $("batchQueueList");
  const section = $("batchQueueSection");
  if (!list || !section) return;
  const entries = mergeRuntimeEntries();
  list.replaceChildren();
  if (!entries.length) {
    section.hidden = false;
    const empty = document.createElement("p");
    empty.className = "batch-queue-empty";
    empty.textContent = "Nessun batch in coda. Usa “Aggiungi alla coda” dal batch preparato.";
    list.append(empty);
    renderSummary([]);
    renderQueueControls([]);
    return;
  }
  section.hidden = false;
  entries.forEach((entry, index) => list.append(renderEntryCard(entry, index, entries)));
  renderSummary(entries);
  renderQueueControls(entries);
}

async function reorderEntry(fromIndex, toIndex) {
  const projectId = currentProjectId();
  if (!projectId || !plan) return;
  const response = await fetch("/api/batch-queue/reorder", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, fromIndex, toIndex, expectedRevision: plan.revision })
  });
  const data = await response.json();
  if (!response.ok) return setFeedback(data.error || "Riordino rifiutato.", "error");
  runtimeView = data;
  if (data.entries) plan = { ...plan, revision: data.revision, entries: data.entries };
  notifyDirty();
  renderQueueUi();
}

async function updateEntry(queueEntryId, patch) {
  const projectId = currentProjectId();
  if (!projectId || !plan) return;
  const response = await fetch("/api/batch-queue/update-entry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, queueEntryId, patch, expectedRevision: plan.revision })
  });
  const data = await response.json();
  if (!response.ok) return setFeedback(data.error || "Modifica rifiutata.", "error");
  runtimeView = data;
  const match = data.entries?.find(e => e.queueEntryId === queueEntryId);
  if (match && plan) {
    plan = {
      ...plan,
      revision: data.revision,
      entries: plan.entries.map(e => e.queueEntryId === queueEntryId ? { ...e, ...match, snapshot: e.snapshot } : e)
    };
  }
  notifyDirty();
  renderQueueUi();
}

async function cancelEntry(queueEntryId) {
  const projectId = currentProjectId();
  if (!projectId || !plan) return;
  const response = await fetch("/api/batch-queue/cancel-entry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, queueEntryId, expectedRevision: plan.revision })
  });
  const data = await response.json();
  if (!response.ok) return setFeedback(data.error || "Annullamento rifiutato.", "error");
  runtimeView = data;
  if (data.entries) plan = { ...plan, revision: data.revision, entries: data.entries };
  notifyDirty();
  renderQueueUi();
}

export async function addCurrentBatchToQueue(draft) {
  if (!draft) return { ok: false, error: "Batch non valido." };
  const capacity = validateQueueCapacity(plan?.entries || [], { adding: 1 });
  if (!capacity.ok) return capacity;
  const order = (plan?.entries?.length || 0) + 1;
  const entry = createQueueEntryFromDraft(draft, { name: defaultQueueEntryName(order), order });
  const result = appendQueueEntry(plan, entry);
  if (!result.ok) return result;
  plan = result.plan;
  notifyDirty();
  await syncBatchQueuePlanToServer();
  renderQueueUi();
  setFeedback(`“${entry.name}” aggiunto alla coda.`, "ok");
  return { ok: true, entry };
}

async function armQueue() {
  const projectId = currentProjectId();
  if (!projectId || !plan?.entries?.length) {
    return setFeedback("Nessun batch in coda.", "error");
  }
  await syncBatchQueuePlanToServer();
  const response = await fetch("/api/batch-queue/arm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId,
      plan: exportBatchQueueForProject(),
      failurePolicy: plan.failurePolicy
    })
  });
  const data = await response.json();
  if (!response.ok) return setFeedback(data.error || "Avvio coda rifiutato.", "error");
  runtimeView = data;
  setFeedback("Coda Batch armata. Esecuzione sequenziale avviata.", "ok");
  renderQueueUi();
  window.dispatchEvent(new CustomEvent("h3-batch-queue-armed"));
}

async function resumeQueue() {
  const projectId = currentProjectId();
  if (!projectId) return;
  const response = await fetch("/api/batch-queue/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, plan: exportBatchQueueForProject() })
  });
  const data = await response.json();
  if (!response.ok) return setFeedback(data.error || "Ripresa rifiutata.", "error");
  runtimeView = data;
  if (data.entries) plan = { ...plan, entries: data.entries, revision: data.revision };
  setFeedback("Coda ripresa.", "ok");
  renderQueueUi();
  window.dispatchEvent(new CustomEvent("h3-batch-queue-armed"));
}

function createUi() {
  if ($("batchQueueSection")) return;
  const mount = $("batchMount");
  if (!mount) return;
  const section = document.createElement("section");
  section.id = "batchQueueSection";
  section.className = "batch-queue-section";
  section.innerHTML = `
    <h3 class="batch-queue-heading">CODA BATCH</h3>
    <p id="batchQueueSummary" class="batch-queue-summary">0 / 0 batch completati · 0 job rimanenti</p>
    <p id="batchQueueRecoveryBanner" class="batch-queue-recovery" hidden></p>
    <div class="batch-queue-controls">
      <label>Policy errori:
        <select id="batchQueueFailurePolicy">
          <option value="stop">Ferma coda</option>
          <option value="continue">Continua con il batch successivo</option>
        </select>
      </label>
      <button type="button" id="batchQueueArm">AVVIA CODA</button>
      <button type="button" id="batchQueueResume" hidden>RIPRENDI CODA</button>
    </div>
    <div id="batchQueueList" class="batch-queue-list"></div>
    <p id="batchQueueFeedback" class="batch-queue-feedback"></p>`;
  mount.append(section);
  $("batchQueueFailurePolicy")?.addEventListener("change", event => {
    if (!plan) plan = { version: 1, failurePolicy: BATCH_QUEUE_FAILURE_POLICY.STOP, revision: 0, entries: [] };
    plan.failurePolicy = event.target.value === BATCH_QUEUE_FAILURE_POLICY.CONTINUE
      ? BATCH_QUEUE_FAILURE_POLICY.CONTINUE
      : BATCH_QUEUE_FAILURE_POLICY.STOP;
    notifyDirty();
  });
  $("batchQueueArm")?.addEventListener("click", () => { void armQueue(); });
  $("batchQueueResume")?.addEventListener("click", () => { void resumeQueue(); });
}

export function initBatchQueueUi({ getProjectId, onPlanDirty } = {}) {
  projectIdProvider = typeof getProjectId === "function" ? getProjectId : () => "";
  onDirty = typeof onPlanDirty === "function" ? onPlanDirty : null;
  createUi();
  renderQueueUi();
  startPolling();
  window.addEventListener("h3-project-changed", () => {
    void syncBatchQueuePlanToServer();
    void fetchRuntime();
  });
}

export function bindBatchQueueProject(projectId = "") {
  void projectId;
  void fetchRuntime();
}
