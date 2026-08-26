/**
 * CODA BATCH UI + client plan sync (Issue #47).
 */

import {
  BATCH_QUEUE_FAILURE_POLICY,
  QUEUE_ENTRY_STATE,
  QUEUE_OVERALL_STATE,
  appendQueueEntry,
  createQueueEntryFromDraft,
  defaultQueueEntryName,
  normalizeBatchQueuePlan,
  serializeBatchQueuePlan,
  setBatchQueuePlanRandomIdFactory,
  validateQueueCapacity
} from "../lib/batch-queue-plan-core.mjs";

setBatchQueuePlanRandomIdFactory(() => globalThis.crypto.randomUUID());
import {
  buildQueueSessionOutputRecordsFromOutputs,
  selectCompletedQueueJobsForSession
} from "../lib/batch-queue-session.mjs";
import {
  batchCurrentInterruptActionable,
  batchCurrentInterruptConfirmMessage,
  batchStopActionable,
  batchStopConfirmMessage,
  findActiveBatchJob
} from "./runtime-interrupt-ui.mjs";
import { buildSessionOutputRecords, upsertSessionOutputs, notifySessionOutputsChanged } from "./session-outputs.mjs";
import { canArmMultiBatchQueue, getSharedCoordinator } from "./queue-coordinator.mjs";
import { formatQueueBatchStopFeedback } from "./execution-lane-client.mjs";
import {
  appendQueueJobInputSection,
  buildSavedQueueJobItem,
  cloneQueueJobDraft
} from "./batch-queue-job-input.mjs";
import {
  buildCodaProgressView,
  collectActivePromptIds,
  enrichProgressWithNodeContext,
  entryStatusLabel,
  formatRenderProgressLabel,
  progressForActivePrompt
} from "./batch-queue-progress.mjs";

const $ = id => document.getElementById(id);
const POLL_MS = 4000;

let plan = null;
let runtimeView = null;
let pollTimer = null;
let projectIdProvider = () => "";
let onDirty = null;
let feedbackNode = null;
let queueOwnershipControllable = false;
let queueInterruptPending = false;
let queueStopPending = false;
let assetContextProvider = null;
const reconstructedPromptIds = new Set();
/** UI-only: per-entry technical details disclosure across polling (not project authority). */
const techDetailsOpen = new Set();
/** UI-only: queueEntryId:job:N / queueEntryId:jobtech:N */
const jobDisclosureOpen = new Set();
/** Latest Comfy progress event matched to active CODA promptIds (display-only). */
let liveRenderProgress = null;
/** nodeId → displayNode from executing events (sampler-step identification). */
const nodeDisplayById = new Map();

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

function applyRuntimeView(view) {
  runtimeView = view;
  try {
    getSharedCoordinator()?.setBatchQueueArmed?.(Boolean(runtimeView?.armed && runtimeView?.authorityPresent));
  } catch { /* ignore */ }
  if (!view?.entries?.length || !plan) return;
  plan = {
    ...plan,
    revision: view.revision ?? plan.revision,
    failurePolicy: view.failurePolicy || plan.failurePolicy,
    entries: plan.entries.map(local => {
      const live = view.entries.find(entry => entry.queueEntryId === local.queueEntryId);
      if (!live) return local;
      return { ...local, ...live, snapshot: local.snapshot || live.snapshot };
    })
  };
}

export function exportBatchQueueForProject() {
  return serializeBatchQueuePlan(plan);
}

export function exportBatchQueueForPersistence() {
  return serializeBatchQueuePlan(plan);
}

export function importBatchQueueFromProject(raw = null) {
  plan = normalizeBatchQueuePlan(raw);
  reconstructedPromptIds.clear();
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
      body: JSON.stringify({
        projectId,
        plan: exportBatchQueueForProject(),
        expectedRevision: plan?.revision ?? null
      })
    });
    const data = await response.json();
    if (response.ok) applyRuntimeView(data);
    else if (data.code === "stale-revision") {
      setFeedback(data.error || "Revisione coda non aggiornata.", "error");
    }
  } catch { /* reconnect on poll */ }
}

async function refreshQueueOwnership() {
  const batchId = runtimeView?.currentBatchId;
  if (!batchId || !runtimeView?.currentEntryId) {
    queueOwnershipControllable = false;
    return;
  }
  try {
    const response = await fetch(`/api/runtime/ownership?batchId=${encodeURIComponent(batchId)}`);
    const data = await response.json();
    queueOwnershipControllable = Boolean(data.controllable);
  } catch {
    queueOwnershipControllable = false;
  }
}

function queueRuntimeJobs() {
  return (runtimeView?.entryJobs || []).map(job => ({
    index: job.index,
    label: job.label || `Job ${job.index + 1}`,
    promptId: job.promptId,
    state: job.state
  }));
}

function renderQueueInterruptControls() {
  const controls = $("batchQueueInterruptControls");
  const btnCurrent = $("batchQueueInterruptCurrent");
  const btnStop = $("batchQueueInterruptAll");
  if (!controls || !btnCurrent || !btnStop) return;
  const jobs = queueRuntimeJobs();
  const currentAction = batchCurrentInterruptActionable({
    jobs,
    ownershipControllable: queueOwnershipControllable,
    interruptPending: queueInterruptPending
  });
  const stopAction = batchStopActionable({
    jobs,
    ownershipControllable: queueOwnershipControllable,
    stopPending: queueStopPending
  });
  const visible = Boolean(runtimeView?.currentEntryId && runtimeView?.currentBatchId);
  controls.hidden = !visible || (!currentAction.visible && !stopAction.visible);
  btnCurrent.hidden = !currentAction.visible;
  btnCurrent.disabled = !currentAction.enabled;
  btnStop.hidden = !stopAction.visible;
  btnStop.disabled = !stopAction.enabled;
}

async function interruptCurrentQueueBatchJob() {
  const batchId = runtimeView?.currentBatchId;
  const jobs = queueRuntimeJobs();
  const active = findActiveBatchJob(jobs);
  if (!batchId || !active?.promptId || queueInterruptPending) return;
  if (!confirm(batchCurrentInterruptConfirmMessage(active.label))) return;
  queueInterruptPending = true;
  renderQueueInterruptControls();
  try {
    const response = await fetch("/api/runtime/interrupt-batch-current", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batchId, expectedPromptId: active.promptId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Interruzione non disponibile.");
    setFeedback(`Interruzione richiesta per ${active.label}. I job successivi del batch continueranno.`, "ok");
  } catch (error) {
    setFeedback(error.message, "error");
  } finally {
    queueInterruptPending = false;
    renderQueueInterruptControls();
  }
}

async function stopCurrentQueueBatch() {
  const batchId = runtimeView?.currentBatchId;
  const projectId = currentProjectId();
  if (!batchId || queueStopPending) return;
  if (!confirm(batchStopConfirmMessage())) return;
  queueStopPending = true;
  renderQueueInterruptControls();
  try {
    const active = findActiveBatchJob(queueRuntimeJobs());
    const response = await fetch("/api/runtime/stop-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        batchId,
        projectId,
        expectedRunningPromptId: active?.promptId || null
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Interruzione batch non disponibile.");
    const feedback = formatQueueBatchStopFeedback(data);
    setFeedback(feedback.message, feedback.level);
    await fetchRuntime();
  } catch (error) {
    setFeedback(error.message, "error");
  } finally {
    queueStopPending = false;
    renderQueueInterruptControls();
  }
}

async function reconcileQueueSessionOutputs() {
  const accepted = runtimeView?.acceptedJobs || [];
  if (!accepted.length) return;
  const historyByPromptId = {};
  for (const job of accepted) {
    if (!job.promptId || reconstructedPromptIds.has(job.promptId)) continue;
    if (job.state === "completed" || job.historyState === "completed") {
      historyByPromptId[job.promptId] = "completed";
    }
  }
  const ready = selectCompletedQueueJobsForSession({
    acceptedJobs: accepted,
    historyByPromptId,
    existingPromptIds: reconstructedPromptIds
  });
  if (!ready.length) return;
  const allRecords = [];
  for (const job of ready) {
    try {
      const outResponse = await fetch(`/api/outputs?promptId=${encodeURIComponent(job.promptId)}`);
      const out = await outResponse.json();
      if (!outResponse.ok || !Array.isArray(out) || !out.length) continue;
      const records = buildQueueSessionOutputRecordsFromOutputs(out, job, buildSessionOutputRecords);
      if (!records.length) continue;
      allRecords.push(...records);
      reconstructedPromptIds.add(job.promptId);
    } catch {
      /* keep trying on next poll */
    }
  }
  if (!allRecords.length) return;
  upsertSessionOutputs(sessionStorage, allRecords);
  notifySessionOutputsChanged();
}

async function fetchRuntime() {
  const projectId = currentProjectId();
  if (!projectId) {
    runtimeView = null;
    return;
  }
  try {
    const response = await fetch(`/api/batch-queue/runtime?projectId=${encodeURIComponent(projectId)}`);
    if (response.ok) {
      applyRuntimeView(await response.json());
      await refreshQueueOwnership();
      await reconcileQueueSessionOutputs();
    }
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

function displayEntries() {
  if (runtimeView?.authorityPresent && runtimeView.entries?.length) {
    return runtimeView.entries.map(entry => {
      const local = plan?.entries?.find(item => item.queueEntryId === entry.queueEntryId);
      return { ...entry, snapshot: local?.snapshot || entry.snapshot };
    });
  }
  return plan?.entries || [];
}

function renderSummary(entries) {
  const node = $("batchQueueSummary");
  const heading = document.querySelector(".batch-queue-heading");
  if (!node) return;
  const view = buildCodaProgressView({
    entries,
    runtimeView,
    renderProgress: liveRenderProgress
  });
  const overall = runtimeView?.overallState || QUEUE_OVERALL_STATE.IDLE;
  const batchCount = entries.length;
  const jobCount = view.jobs.total;
  const hasQueued = entries.some(e => e.state === QUEUE_ENTRY_STATE.QUEUED);
  const completed = overall === QUEUE_OVERALL_STATE.COMPLETED
    || (batchCount > 0 && !hasQueued && entries.every(e =>
      e.state === QUEUE_ENTRY_STATE.COMPLETED
      || e.state === QUEUE_ENTRY_STATE.FAILED
      || e.state === QUEUE_ENTRY_STATE.CANCELLED
    ));

  if (!batchCount) {
    if (heading) heading.textContent = "CODA VUOTA";
    node.textContent = "Nessun lavoro da eseguire";
    node.dataset.state = "empty";
  } else if (completed && overall !== QUEUE_OVERALL_STATE.RECOVERY_REQUIRED) {
    if (heading) heading.textContent = "✓ CODA COMPLETATA";
    node.textContent = `${batchCount} Batch · ${jobCount} Job completati`;
    node.dataset.state = "completed";
  } else {
    if (heading) heading.textContent = "CODA";
    const parts = [`${batchCount} Batch · ${jobCount} Job`];
    if (view.armed && view.pointer.entryName) {
      const idx = entries.findIndex(e => e.queueEntryId === runtimeView?.currentEntryId);
      if (idx >= 0) parts.push(`Batch ${idx + 1} / ${batchCount}`);
      if (view.pointer.label) parts.push(view.pointer.label);
    } else if (view.jobs.pending != null) {
      parts.push(`${view.jobs.pending} job in attesa`);
    }
    node.textContent = parts.join(" · ");
    node.dataset.state = overall || "active";
  }
  renderCodaProgressPanel(view);
}

function renderCodaProgressPanel(view) {
  const panel = $("batchQueueProgress");
  if (!panel) return;
  if (!view?.armed || !view.jobs.total) {
    panel.hidden = true;
    panel.replaceChildren();
    return;
  }
  panel.hidden = false;
  panel.replaceChildren();

  const jobs = view.jobs;
  const overall = document.createElement("div");
  overall.className = "batch-queue-progress-row";
  const overallLabel = document.createElement("div");
  overallLabel.className = "batch-queue-progress-label";
  overallLabel.textContent = "CODA";
  const overallBar = document.createElement("progress");
  overallBar.max = Math.max(1, jobs.total);
  overallBar.value = Math.min(jobs.completed, jobs.total);
  overallBar.setAttribute("aria-label", `Progresso coda ${jobs.completed} su ${jobs.total}`);
  const overallMeta = document.createElement("div");
  overallMeta.className = "batch-queue-progress-meta";
  overallMeta.textContent = `${jobs.completed} / ${jobs.total}`;
  overall.append(overallLabel, overallBar, overallMeta);

  const counts = document.createElement("p");
  counts.className = "batch-queue-progress-counts";
  const bits = [
    `${jobs.completed} completati`,
    `${jobs.running} in corso`,
    `${jobs.pending} in attesa`
  ];
  if (jobs.failed) bits.push(`${jobs.failed} falliti`);
  if (jobs.interrupted) bits.push(`${jobs.interrupted} interrotti`);
  if (jobs.cancelled) bits.push(`${jobs.cancelled} annullati/non inviati`);
  counts.textContent = bits.join(" · ");

  const current = document.createElement("div");
  current.className = "batch-queue-progress-current";
  const currentName = document.createElement("div");
  currentName.innerHTML = `<span>Corrente</span><strong>${view.pointer.entryName || "—"}</strong>`;
  const currentJob = document.createElement("div");
  currentJob.innerHTML = `<span>Job</span><strong>${view.pointer.label || "—"}</strong>`;
  current.append(currentName, currentJob);

  const renderRow = document.createElement("div");
  renderRow.className = "batch-queue-progress-row";
  const renderLabel = document.createElement("div");
  renderLabel.className = "batch-queue-progress-label";
  renderLabel.textContent = "Render";
  const renderBar = document.createElement("progress");
  renderBar.setAttribute("aria-label", "Progresso render corrente");
  const renderMeta = document.createElement("div");
  renderMeta.className = "batch-queue-progress-meta";
  if (view.render.kind === "numeric") {
    renderBar.max = view.render.max;
    renderBar.value = view.render.value;
    renderMeta.textContent = view.render.label || formatRenderProgressLabel(view.render);
  } else if (view.render.kind === "complete") {
    renderBar.max = 1;
    renderBar.value = 1;
    renderMeta.textContent = "Completato";
  } else if (jobs.running > 0) {
    renderBar.removeAttribute("value");
    renderBar.max = 1;
    renderMeta.textContent = view.render.label || "Processing current node";
  } else {
    renderBar.max = 1;
    renderBar.value = 0;
    renderMeta.textContent = "In attesa";
  }
  renderRow.append(renderLabel, renderBar, renderMeta);

  const timeRow = document.createElement("div");
  timeRow.className = "batch-queue-progress-time";
  timeRow.innerHTML = `<span>Tempo</span><strong>${view.elapsed.text}</strong>`;
  if (view.etaText) {
    const eta = document.createElement("div");
    eta.innerHTML = `<span>ETA</span><strong>${view.etaText}</strong>`;
    timeRow.append(eta);
  }

  panel.append(overall, counts, current, renderRow, timeRow);
}

function uniformQualitySummary(entry) {
  const jobs = entry.snapshot?.items || [];
  if (!jobs.length) return "";
  const pick = key => {
    const values = [...new Set(jobs.map(j => String(j?.[key] ?? "")))];
    return values.length === 1 ? values[0] : null;
  };
  const bits = [];
  const mp = pick("megapixels");
  const steps = pick("steps");
  const aspect = pick("aspect");
  const duration = pick("duration");
  if (mp) bits.push(`${mp} MP`);
  if (steps) bits.push(`${steps} steps`);
  if (aspect) bits.push(aspect);
  if (duration) bits.push(`${duration}s`);
  return bits.length ? bits.join(" · ") : "Qualità mista";
}

function renderQueueControls(entries) {
  const armBtn = $("batchQueueArm");
  const resumeBtn = $("batchQueueResume");
  const policySelect = $("batchQueueFailurePolicy");
  const controls = document.querySelector(".batch-queue-controls");
  if (!armBtn || !resumeBtn) return;

  const overall = runtimeView?.overallState || QUEUE_OVERALL_STATE.IDLE;
  const hasQueued = entries.some(e => e.state === QUEUE_ENTRY_STATE.QUEUED);
  const recovery = overall === QUEUE_OVERALL_STATE.RECOVERY_REQUIRED
    || entries.some(e => e.state === QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);
  const armed = Boolean(runtimeView?.armed && runtimeView?.authorityPresent);
  const paused = overall === QUEUE_OVERALL_STATE.PAUSED
    || overall === QUEUE_OVERALL_STATE.PAUSED_FAILURE;
  const completedTerminal = !hasQueued && !armed && !recovery && !paused
    && (overall === QUEUE_OVERALL_STATE.COMPLETED || overall === QUEUE_OVERALL_STATE.IDLE);

  const queuedBatches = entries.filter(e => e.state === QUEUE_ENTRY_STATE.QUEUED).length;
  const queuedJobs = entries
    .filter(e => e.state === QUEUE_ENTRY_STATE.QUEUED)
    .reduce((n, e) => n + (e.snapshot?.items?.length || 0), 0);
  armBtn.textContent = queuedBatches
    ? `AVVIA CODA · ${queuedBatches} BATCH / ${queuedJobs} JOB`
    : "AVVIA CODA";

  // Hide start/policy when nothing actionable; never hide recovery/resume.
  const hideArm = armed || recovery || paused || completedTerminal || !hasQueued;
  armBtn.hidden = hideArm;
  armBtn.disabled = !hasQueued;
  resumeBtn.hidden = !recovery && !paused;
  resumeBtn.disabled = recovery && entries.some(e => e.state === QUEUE_ENTRY_STATE.RECOVERY_REQUIRED);

  if (policySelect) {
    policySelect.hidden = hideArm && !recovery && !paused;
    if (plan) {
      policySelect.value = plan.failurePolicy || BATCH_QUEUE_FAILURE_POLICY.STOP;
      policySelect.disabled = armed;
    }
  }
  if (controls) {
    controls.classList.toggle("is-terminal-idle", hideArm && !recovery && !paused);
  }

  const banner = $("batchQueueRecoveryBanner");
  if (banner) {
    banner.hidden = !recovery;
    banner.textContent = recovery
      ? "CODA IN PAUSA — DIRECTOR RIAVVIATO. Il piano della coda è stato ripristinato, ma l'esecuzione automatica deve essere riattivata dopo aver risolto i batch in RECUPERO RICHIESTO."
      : "";
  }
}

function appendJobEditor(container, entry, jobIndex) {
  const item = entry.snapshot?.items?.[jobIndex];
  if (!item) return;
  const details = document.createElement("details");
  details.className = "batch-queue-job-editor";
  const jobKey = `${entry.queueEntryId}:job:${jobIndex}`;
  details.open = jobDisclosureOpen.has(jobKey);
  details.addEventListener("toggle", () => {
    if (details.open) jobDisclosureOpen.add(jobKey);
    else jobDisclosureOpen.delete(jobKey);
  });
  const summary = document.createElement("summary");
  summary.textContent = `Job ${jobIndex + 1}`;
  details.append(summary);
  const body = document.createElement("div");
  body.className = "batch-queue-job-body";
  const fields = [
    ["prompt", "textarea"],
    ["seed", "number"],
    ["duration", "number"],
    ["steps", "number"],
    ["megapixels", "number"],
    ["aspect", "text"]
  ];
  const draftItem = cloneQueueJobDraft(item);
  for (const [field, type] of fields) {
    const label = document.createElement("label");
    label.textContent = field;
    const input = document.createElement(type === "textarea" ? "textarea" : "input");
    if (type !== "textarea") input.type = type;
    input.value = String(item[field] ?? "");
    input.addEventListener("change", () => {
      draftItem[field] = input.value;
    });
    label.append(input);
    body.append(label);
  }
  const { library, availability } = getQueueAssetContext();
  appendQueueJobInputSection(document, body, {
    source: entry.snapshot?.source,
    item,
    library,
    draftItem,
    availability
  });
  const tech = document.createElement("details");
  tech.className = "batch-queue-tech-details";
  const techKey = `${entry.queueEntryId}:jobtech:${jobIndex}`;
  tech.open = jobDisclosureOpen.has(techKey);
  tech.addEventListener("toggle", () => {
    if (tech.open) jobDisclosureOpen.add(techKey);
    else jobDisclosureOpen.delete(techKey);
  });
  const techSummary = document.createElement("summary");
  techSummary.textContent = "Dettagli tecnici";
  const techBody = document.createElement("pre");
  techBody.className = "batch-queue-tech-pre";
  techBody.textContent = [
    `queueEntryId: ${entry.queueEntryId || "—"}`,
    `queueJobId: ${item.queueJobId || item.id || "—"}`,
    `item.files: ${JSON.stringify(item.files || {})}`
  ].join("\n");
  tech.append(techSummary, techBody);
  body.append(tech);
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "secondary";
  saveBtn.textContent = "Salva job";
  saveBtn.addEventListener("click", () => {
    const items = entry.snapshot.items.map((jobItem, idx) => (
      idx === jobIndex ? buildSavedQueueJobItem(jobItem, draftItem) : jobItem
    ));
    void updateEntry(entry.queueEntryId, {
      snapshot: { ...entry.snapshot, items }
    });
  });
  body.append(saveBtn);
  details.append(body);
  container.append(details);
}

function getQueueAssetContext() {
  const ctx = assetContextProvider?.() || {};
  return {
    library: ctx.library || { groups: [] },
    availability: ctx.availability && typeof ctx.availability === "object" ? ctx.availability : {}
  };
}

export function setBatchQueueAssetContextProvider(fn) {
  assetContextProvider = typeof fn === "function" ? fn : null;
}

function renderEntryCard(entry, index, entries) {
  const card = document.createElement("div");
  card.className = "batch-queue-card";
  card.dataset.entryId = entry.queueEntryId;
  card.dataset.entryState = entry.state || "";
  const jobs = entry.snapshot?.items || [];
  const editable = entry.state === QUEUE_ENTRY_STATE.QUEUED;
  const isCurrent = runtimeView?.currentEntryId === entry.queueEntryId;
  const jobProgress = isCurrent && runtimeView?.currentJobIndex != null
    ? `Job ${Number(runtimeView.currentJobIndex) + 1} / ${jobs.length}`
    : entry.state === QUEUE_ENTRY_STATE.COMPLETED
      ? `${jobs.length}/${jobs.length} job`
      : `${jobs.length} job`;
  const workflow = entry.snapshot?.source?.workflowLabel || entry.snapshot?.source?.workflowId || "—";

  const head = document.createElement("div");
  head.className = "batch-queue-card-head";
  const title = document.createElement("strong");
  title.textContent = `${index + 1}. ${entry.name}`;
  const state = document.createElement("span");
  state.className = `batch-queue-state state-${entry.state || "unknown"}`;
  state.textContent = entryStatusLabel(entry.state);
  head.append(title, state);

  const meta = document.createElement("div");
  meta.className = "batch-queue-card-meta";
  meta.textContent = `${jobProgress} · ${workflow}`;

  const sourceMeta = document.createElement("div");
  sourceMeta.className = "batch-queue-card-source";
  const model = entry.snapshot?.source?.model || "—";
  const quality = uniformQualitySummary(entry);
  sourceMeta.textContent = quality
    ? `Modello: ${model} · ${quality}`
    : `Modello: ${model}`;

  card.append(head, meta, sourceMeta);

  if (isCurrent && runtimeView?.armed) {
    const live = document.createElement("div");
    live.className = "batch-queue-card-live";
    // Prompt-matched only — never show raw liveRenderProgress from another prompt.
    const matched = progressForActivePrompt({
      progress: liveRenderProgress,
      activePromptIds: collectActivePromptIds({ runtimeView })
    });
    if (matched.kind === "numeric") {
      live.textContent = matched.label || formatRenderProgressLabel(matched);
    } else if (entry.state === QUEUE_ENTRY_STATE.RUNNING || entry.state === QUEUE_ENTRY_STATE.SUBMITTING) {
      live.textContent = matched.label && matched.kind === "indeterminate"
        ? matched.label
        : "Rendering…";
    }
    if (live.textContent) card.append(live);
  }

  const tech = document.createElement("details");
  tech.className = "batch-queue-tech-details";
  tech.open = techDetailsOpen.has(entry.queueEntryId);
  tech.addEventListener("toggle", () => {
    if (tech.open) techDetailsOpen.add(entry.queueEntryId);
    else techDetailsOpen.delete(entry.queueEntryId);
  });
  const techSummary = document.createElement("summary");
  techSummary.textContent = "Dettagli tecnici";
  const techBody = document.createElement("pre");
  techBody.className = "batch-queue-tech-pre";
  techBody.textContent = [
    `queueEntryId: ${entry.queueEntryId || "—"}`,
    `queueRunId: ${runtimeView?.queueRunId || "—"}`,
    `source.files: ${JSON.stringify(entry.snapshot?.source?.files || {})}`
  ].join("\n");
  tech.append(techSummary, techBody);
  card.append(tech);

  if (entry.state === QUEUE_ENTRY_STATE.RECOVERY_REQUIRED) {
    const recoveryTools = document.createElement("div");
    recoveryTools.className = "batch-queue-recovery-tools";
    const completeBtn = document.createElement("button");
    completeBtn.type = "button";
    completeBtn.className = "secondary";
    completeBtn.textContent = "Marca come completato";
    completeBtn.addEventListener("click", () => { void resolveRecovery(entry.queueEntryId, "completed"); });
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Marca come annullato";
    cancelBtn.addEventListener("click", () => { void resolveRecovery(entry.queueEntryId, "cancelled"); });
    recoveryTools.append(completeBtn, cancelBtn);
    card.append(recoveryTools);
  }

  if (editable) {
    const tools = document.createElement("div");
    tools.className = "batch-queue-card-tools";
    const up = document.createElement("button");
    up.type = "button";
    up.className = "secondary";
    up.textContent = "↑";
    up.disabled = index === 0 || entries[index - 1]?.state !== QUEUE_ENTRY_STATE.QUEUED;
    up.addEventListener("click", () => { void reorderEntry(index, index - 1); });
    const down = document.createElement("button");
    down.type = "button";
    down.className = "secondary";
    down.textContent = "↓";
    down.disabled = index >= entries.length - 1 || entries[index + 1]?.state !== QUEUE_ENTRY_STATE.QUEUED;
    down.addEventListener("click", () => { void reorderEntry(index, index + 1); });
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "secondary";
    rename.textContent = "Rinomina";
    rename.addEventListener("click", () => {
      const next = prompt("Nome batch:", entry.name);
      if (next?.trim()) void updateEntry(entry.queueEntryId, { name: next.trim() });
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Rimuovi";
    remove.addEventListener("click", () => { void cancelEntry(entry.queueEntryId); });
    tools.append(up, down, rename, remove);
    card.append(tools);

    const editorWrap = document.createElement("div");
    editorWrap.className = "batch-queue-entry-editor";
    for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
      appendJobEditor(editorWrap, entry, jobIndex);
    }
    card.append(editorWrap);
  }
  return card;
}

function renderQueueUi() {
  const list = $("batchQueueList");
  const section = $("batchQueueSection");
  if (!list || !section) return;
  const entries = displayEntries();
  list.replaceChildren();
  if (!entries.length) {
    section.hidden = false;
    const empty = document.createElement("p");
    empty.className = "batch-queue-empty";
    empty.textContent = "Nessun batch in coda. Usa “Aggiungi alla coda” dal batch preparato.";
    list.append(empty);
    renderSummary([]);
    renderQueueControls([]);
    renderQueueInterruptControls();
    return;
  }
  section.hidden = false;
  entries.forEach((entry, index) => list.append(renderEntryCard(entry, index, entries)));
  renderSummary(entries);
  renderQueueControls(entries);
  renderQueueInterruptControls();
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
  applyRuntimeView(data);
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
  applyRuntimeView(data);
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
  applyRuntimeView(data);
  notifyDirty();
  renderQueueUi();
}

async function resolveRecovery(queueEntryId, resolution) {
  const projectId = currentProjectId();
  if (!projectId || !plan) return;
  const response = await fetch("/api/batch-queue/resolve-recovery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, queueEntryId, resolution, expectedRevision: plan.revision })
  });
  const data = await response.json();
  if (!response.ok) return setFeedback(data.error || "Risoluzione rifiutata.", "error");
  applyRuntimeView(data);
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
  const coord = getSharedCoordinator?.();
  const legacyGate = canArmMultiBatchQueue({
    queuedNext: coord?.getQueuedNext?.() || null,
    deferredBatch: coord?.getDeferredBatch?.() || null,
    batchActive: Boolean(coord?.snapshot?.()?.batchActive)
  });
  if (!legacyGate.ok) {
    return setFeedback(legacyGate.error, "error");
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
  applyRuntimeView(data);
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
    body: JSON.stringify({
      projectId,
      plan: exportBatchQueueForProject(),
      expectedRevision: plan?.revision
    })
  });
  const data = await response.json();
  if (!response.ok) return setFeedback(data.error || "Ripresa rifiutata.", "error");
  applyRuntimeView(data);
  setFeedback("Coda ripresa.", "ok");
  renderQueueUi();
  window.dispatchEvent(new CustomEvent("h3-batch-queue-armed"));
}

function createUi() {
  if ($("batchQueueSection")) return;
  const mount = $("codaMount") || $("batchMount");
  if (!mount) return;
  const section = document.createElement("section");
  section.id = "batchQueueSection";
  section.className = "batch-queue-section";
  section.innerHTML = `
    <h3 class="batch-queue-heading">CODA</h3>
    <p id="batchQueueSummary" class="batch-queue-summary">0 Batch · 0 Job</p>
    <div id="batchQueueProgress" class="batch-queue-progress" hidden></div>
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
    <div id="batchQueueInterruptControls" class="batch-queue-interrupt-controls" hidden>
      <button type="button" class="secondary" id="batchQueueInterruptCurrent">Interrompi job corrente</button>
      <button type="button" class="danger" id="batchQueueInterruptAll">INTERROMPI BATCH</button>
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
  $("batchQueueInterruptCurrent")?.addEventListener("click", () => { void interruptCurrentQueueBatchJob(); });
  $("batchQueueInterruptAll")?.addEventListener("click", () => { void stopCurrentQueueBatch(); });
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
  window.addEventListener("h3-comfy-progress", event => {
    const raw = event?.detail?.progress || null;
    if (raw?.nodeId && raw?.displayNode) {
      nodeDisplayById.set(String(raw.nodeId), String(raw.displayNode));
    }
    liveRenderProgress = enrichProgressWithNodeContext(raw, nodeDisplayById);
    // Refresh progress panel without waiting for the next poll.
    const entries = displayEntries();
    if (entries.length) renderSummary(entries);
  });
}

/** Test helpers: disclosure UI state (not project authority). */
export function __testGetTechDetailsOpen() {
  return new Set(techDetailsOpen);
}
export function __testSetTechDetailsOpen(ids = []) {
  techDetailsOpen.clear();
  for (const id of ids) techDetailsOpen.add(id);
}

export function bindBatchQueueProject(projectId = "") {
  void projectId;
  void fetchRuntime();
}

export { displayEntries as displayQueueEntriesForTests };
