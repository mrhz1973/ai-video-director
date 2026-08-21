import { classifyHistoryState, historyFailureLabel, promptIdPrefix } from "./recovery.mjs";
import {
  MAX_BATCH_JOBS,
  MIN_BATCH_JOBS,
  clampBatchCount,
  createBatchItems,
  duplicateBatchItem,
  isTerminalBatchState,
  moveBatchItem,
  removeBatchItem,
  submitBatchSequentially,
  summarizeBatchJobs,
  validateBatchDraft
} from "./batch-core.mjs";

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

function projectKey() {
  return $("project")?.value || "none";
}

function draftKey() {
  return `${DRAFT_PREFIX}${projectKey()}`;
}

function safeParse(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function persistDraft() {
  try {
    localStorage.setItem(draftKey(), JSON.stringify({ version: 1, source, items }));
  } catch { /* browser-local best effort */ }
}

function loadDraft() {
  const saved = safeParse(localStorage.getItem(draftKey()) || "null");
  items = Array.isArray(saved?.items) ? saved.items.slice(0, MAX_BATCH_JOBS) : [];
  source = saved?.source && typeof saved.source === "object" ? saved.source : null;
  submitted = false;
  renderBatch();
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
  const unsupportedVideoRoles = [];
  let rowIndex = 0;

  for (const field of attachments) {
    if (!field?.key) continue;
    if (roleKind(field) === "video") {
      unsupportedVideoRoles.push(field.label || field.key);
      continue;
    }
    requiredKeys.push(field.key);
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
    unsupportedVideoRoles,
    safeFitStatus: preset.safeFit?.status || "not-applicable",
    megapixelsMin: Number(mpField?.min || preset.options?.megapixels?.min || 0.1),
    megapixelsMax: Number(mpField?.max || preset.options?.megapixels?.max || 16),
    durationMin: Number(durationField?.min || 4),
    durationMax: Number(durationField?.max || 15),
    base: {
      prompt: $("prompt")?.value || "",
      seed: $("seed")?.value || "1",
      duration: $("duration")?.value || "5",
      steps: $("steps")?.value || "20",
      megapixels: $("megapixels")?.value || "0.3",
      aspect: $("aspect")?.value || "16:9"
    }
  };
}

function sourceIdentity(value = source) {
  if (!value) return "";
  return JSON.stringify({ workflowId: value.workflowId, model: value.model, files: value.files || {} });
}

function markEdited() {
  submitted = false;
  persistDraft();
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
  const output = $("outputSection");
  if (!output?.parentNode) return;

  const section = document.createElement("section");
  section.className = "batch-section";
  section.id = "batchSection";
  section.innerHTML = `
    <details id="batchDetails">
      <summary><span>Batch</span><span id="batchBadge" class="batch-badge">nessun job</span></summary>
      <p class="batch-help">2–8 render in coda con un solo click. Workflow, modello e asset restano comuni; prompt, seed, durata, steps, MP e aspect sono modificabili per job.</p>
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
  output.parentNode.insertBefore(section, output);

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
    summary.innerHTML = `<strong>Job ${index + 1}</strong><span>seed ${item.seed} · ${item.duration}s · ${item.megapixels}MP</span>`;

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
        <label>Durata<input data-field="duration" type="number" min="4" max="15" step="0.1"></label>
        <label>Steps<input data-field="steps" type="number" min="1"></label>
        <label>Megapixel<input data-field="megapixels" type="number" min="0.1" max="16" step="0.1"></label>
        <label>Aspect<select data-field="aspect"><option>16:9</option><option>9:16</option><option>1:1</option><option>4:3</option><option>3:4</option><option>21:9</option></select></label>
      </div>`;
    for (const field of ["prompt", "seed", "duration", "steps", "megapixels", "aspect"]) {
      const input = body.querySelector(`[data-field="${field}"]`);
      input.value = item[field] ?? "";
      const update = () => {
        item[field] = input.value;
        summary.querySelector("span").textContent = `seed ${item.seed} · ${item.duration}s · ${item.megapixels}MP`;
        markEdited();
      };
      input.addEventListener("input", update);
      input.addEventListener("change", update);
    }
    card.append(summary, body);
    host.append(card);
  });
  updateQueueButton();
}

function updateQueueButton() {
  const button = $("batchQueue");
  if (!button) return;
  button.disabled = submitting || submitted || items.length < MIN_BATCH_JOBS;
  button.textContent = submitting ? "Invio batch…" : submitted ? "Batch inviato" : `Queue batch (${items.length || 0})`;
}

function validateCurrentBatch(snapshot) {
  return validateBatchDraft({
    items,
    safeFitStatus: snapshot.safeFitStatus,
    requiredFiles: snapshot.files,
    requiredKeys: snapshot.requiredKeys,
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
    duration: Number(item.duration),
    aspect: item.aspect,
    seed: Number(item.seed),
    files: { ...(snapshot.files || {}) }
  };
}

async function queueBatch() {
  if (submitting || submitted || items.length < MIN_BATCH_JOBS) return;
  const snapshot = collectSourceSnapshot();
  if (snapshot.error) return setFeedback(snapshot.error, "error");
  if (!source || sourceIdentity(snapshot) !== sourceIdentity(source)) {
    return setFeedback("Il draft comune è cambiato (workflow, modello o asset). Premi “Prepara dal draft” prima di inviare.", "warn");
  }
  const validation = validateCurrentBatch(snapshot);
  if (!validation.valid) return setFeedback(validation.errors.join(" "), "error");

  // Claim the submit lock before the first await. A second click cannot start a
  // concurrent queue preflight or duplicate the batch while this path is active.
  submitting = true;
  updateQueueButton();

  try {
    const activeResponse = await fetch("/api/active");
    const active = await activeResponse.json();
    if (!activeResponse.ok) throw new Error(active.error || "Impossibile controllare la queue ComfyUI.");
    if (Number(active.running || 0) || Number(active.pending || 0)) {
      setFeedback(`Queue non vuota: ${active.running || 0} running · ${active.pending || 0} pending. Il Batch v1 parte solo da queue vuota.`, "warn");
      return;
    }

    setFeedback(`Preflight OK. Invio sequenziale di ${items.length} job…`, "ok");
    const batchId = crypto.randomUUID();
    const snapshotItems = items.map(item => ({ ...item }));

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
    details.innerHTML = `<div>prompt_id: <code>${job.promptId || "non inviato"}</code></div><div>seed ${seed} · ${job.item?.duration || "—"}s · ${job.item?.megapixels || "—"}MP · ${job.item?.steps || "—"} steps</div>${job.error ? `<div class="batch-error">${job.error}</div>` : ""}`;
    for (const output of job.outputs || []) {
      if (!output?.url) continue;
      const link = document.createElement("a");
      link.href = output.url;
      link.target = "_blank";
      link.textContent = `Apri output: ${output.filename || "render"}`;
      details.append(link);
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

  loadDraft();
  loadRuntime();
  $("project")?.addEventListener("change", () => setTimeout(loadDraft, 0));
  $("workflow")?.addEventListener("change", () => {
    if (items.length) setFeedback("Workflow cambiato. Premi “Prepara dal draft” per aggiornare il batch prima dell'invio.", "warn");
  });
  $("model")?.addEventListener("change", () => {
    if (items.length) setFeedback("Modello cambiato. Premi “Prepara dal draft” per aggiornare il batch prima dell'invio.", "warn");
  });
}

if (document.readyState === "complete") init();
else window.addEventListener("load", init, { once: true });
