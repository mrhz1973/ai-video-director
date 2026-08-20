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
  summarizeMonitor
} from "./monitor.mjs";

const $ = id => document.getElementById(id);
let clientId = sessionStorage.getItem("h3ClientId") || crypto.randomUUID();
let config, events, selectedProject;
let currentPrompt = sessionStorage.getItem("h3CurrentPrompt") || undefined;
let pollTimer;
let queueTimer;
let logTimer;
let elapsedTimer;
let completing = false;
let jobCreatedAt = Number(sessionStorage.getItem("h3JobCreatedAt") || "") || null;
let jobFirstSeenAt = Number(sessionStorage.getItem("h3JobFirstSeenAt") || "") || null;
let monitorState = initialMonitorState();
let logsAvailable = null;

const add = (text, kind = "system") => {
  const el = document.createElement("div");
  el.className = `message ${kind}`;
  el.textContent = text;
  $("log").append(el);
  el.scrollIntoView();
};

const setBusy = busy => {
  $("send").disabled = busy;
  $("send").textContent = busy ? "Generazione…" : "Genera";
  $("send").style.opacity = busy ? ".5" : "1";
  $("send").style.cursor = busy ? "not-allowed" : "pointer";
};

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

const stopPolling = () => {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = undefined;
};

const startPolling = () => {
  stopPolling();
  if (!currentPrompt) return;
  pollTimer = setInterval(() => { pollHistory(); }, POLL_INTERVAL_MS);
};

const stopQueuePolling = () => {
  if (!queueTimer) return;
  clearInterval(queueTimer);
  queueTimer = undefined;
};

const startQueuePolling = () => {
  stopQueuePolling();
  refreshQueueCounts();
  queueTimer = setInterval(() => { refreshQueueCounts(); }, QUEUE_POLL_MS);
};

const stopElapsedClock = () => {
  if (!elapsedTimer) return;
  clearInterval(elapsedTimer);
  elapsedTimer = undefined;
};

const startElapsedClock = () => {
  stopElapsedClock();
  updateElapsed();
  elapsedTimer = setInterval(updateElapsed, 1000);
};

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
  $("monitorElapsed").textContent = formatElapsed(resolved.elapsedMs, { approximate: resolved.approximate || resolved.source === "local" });
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
  $("monitorConnection").textContent = summary.connection;
  const running = summary.queueRunning ?? 0;
  const pending = summary.queuePending ?? 0;
  $("monitorQueue").textContent = `${running} running · ${pending} pending`;
  const events = monitorState.events || [];
  $("monitorEvents").textContent = events.length
    ? events.map(item => `[${item.t}] ${item.m}`).join("\n")
    : "Nessun evento.";
  $("progress").textContent = compactProgressText(summary);
  updateElapsed();
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
    monitorState = {
      ...monitorState,
      queueRunning: Number(data.running || 0),
      queuePending: Number(data.pending || 0)
    };
    renderMonitor();
  } catch {
    // Ignore transient queue poll failures.
  }
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
  return (await response.json()).name;
}

async function outputs() {
  if (completing || !currentPrompt) return;
  completing = true;
  stopPolling();
  try {
    const response = await fetch(`/api/outputs?promptId=${encodeURIComponent(currentPrompt)}`);
    const items = await response.json();
    if (!response.ok) throw new Error(items.error || "Output non disponibile");
    monitorState = applyMonitorEvent(monitorState, { type: "executing", data: { node: null, prompt_id: currentPrompt } });
    monitorState = {
      ...monitorState,
      phase: "completed",
      events: [...monitorState.events, { t: new Date().toLocaleTimeString("it-IT", { hour12: false }), m: "Output disponibile", at: Date.now() }]
    };
    setBusy(false);
    rememberJob();
    renderMonitor();
    for (const item of items) {
      const link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.textContent = `Apri output: ${item.filename}`;
      const box = document.createElement("div");
      box.className = "message system";
      box.append(link);
      $("log").append(box);
    }
  } catch (error) {
    setBusy(false);
    monitorState = { ...monitorState, phase: "error" };
    renderMonitor();
    add(error.message);
    startPolling();
  } finally {
    completing = false;
  }
}

function handleHistoryFailure(history) {
  stopPolling();
  setBusy(false);
  const label = historyFailureLabel(history, currentPrompt);
  monitorState = applyMonitorEvent(monitorState, {
    type: label === "interrupted" ? "execution_interrupted" : "execution_error",
    data: { prompt_id: currentPrompt }
  });
  rememberJob();
  renderMonitor();
  add(label === "interrupted" ? "Generazione interrotta (history)." : "Generazione fallita (history).");
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
  } catch {
    // Read-only fallback; ignore transient polling errors.
  }
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
    rememberJob();
    add(JSON.stringify(message.data, null, 2));
  }
}

function connect() {
  events?.close();
  events = new EventSource(`/api/events?clientId=${encodeURIComponent(clientId)}`);
  events.addEventListener("connection", event => {
    const state = JSON.parse(event.data).state;
    const label = state === "open" ? "ComfyUI collegato" : "Connessione…";
    $("connection").textContent = label;
    monitorState = { ...monitorState, connection: label };
    renderMonitor();
  });
  events.onmessage = handleMessage;
  events.onerror = () => {
    $("connection").textContent = "Riconnessione…";
    monitorState = { ...monitorState, connection: "Riconnessione…" };
    renderMonitor();
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
      if (active.clientId) clientId = active.clientId;
      sessionStorage.setItem("h3ClientId", clientId);
      rememberJob(active.promptId, { createdAt: active.createdAt });
      monitorState = applyMonitorEvent(monitorState, {
        type: "executing",
        data: { node: "?", display_node: "Job recuperato", prompt_id: active.promptId }
      });
      monitorState = {
        ...monitorState,
        events: [...monitorState.events, {
          t: new Date().toLocaleTimeString("it-IT", { hour12: false }),
          m: `Job rilevato · ${promptIdPrefix(active.promptId)}`,
          at: Date.now()
        }]
      };
      setBusy(true);
      startPolling();
      renderMonitor();
      return;
    }
  } catch {
    $("connection").textContent = "Recupero connessione…";
    monitorState = { ...monitorState, connection: "Recupero connessione…" };
    renderMonitor();
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

function selectPreset() {
  const preset = currentPreset();
  applyMegapixelsContract();
  monitorState = { ...monitorState, title: workflowTitle() };
  renderMonitor();
  $("model").replaceChildren(...(preset?.options?.models || [""]).map(name => new Option(name, name)));
  const saved = selectedProject?.workflowId === preset?.id ? selectedProject.files || {} : {};
  $("attachmentFields").replaceChildren(...(preset?.attachments || []).map(field => {
    const label = document.createElement("label");
    label.className = `attachment-field${saved[field.key] ? " saved" : ""}`;
    label.dataset.key = field.key;
    label.append(document.createTextNode(field.label));
    const note = document.createElement("small");
    note.textContent = saved[field.key] ? "già caricato" : "scegli file";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = field.accept || "*/*";
    input.dataset.key = field.key;
    input.onchange = () => {
      label.classList.toggle("chosen", Boolean(input.files[0]));
      note.textContent = input.files[0]?.name || (saved[field.key] ? "già caricato" : "scegli file");
    };
    label.append(note, input);
    return label;
  }));
}

function selectProject() {
  selectedProject = config.projects.find(item => item.id === $("project").value);
  if (!selectedProject) return selectPreset();
  $("workflow").value = selectedProject.workflowId;
  $("prompt").value = selectedProject.prompt || "";
  for (const [key, value] of Object.entries(selectedProject.settings || {})) if ($(key)) $(key).value = value;
  const restored = megapixelsFromSettings(selectedProject.settings || {});
  if (restored !== undefined) $("megapixels").value = restored;
  selectPreset();
  add(`Progetto caricato: ${selectedProject.label}`);
}

config = await (await fetch("/api/config")).json();
$("version").textContent = `v${config.version}`;
$("workflow").replaceChildren(...(config.presets.length ? config.presets.map(item => new Option(item.label, item.id)) : [new Option("Nessun preset", "")]));
$("project").replaceChildren(new Option("Nessun progetto", ""), ...(config.projects || []).map(item => new Option(item.label, item.id)));
$("workflow").onchange = () => { selectedProject = undefined; $("project").value = ""; selectPreset(); };
$("project").onchange = selectProject;
$("megapixels").oninput = updateResolutionHint;
$("aspect").onchange = updateResolutionHint;
selectPreset();
renderMonitor();
await recoverActive();
sessionStorage.setItem("h3ClientId", clientId);
connect();
await refreshComfyLogs();
logTimer = setInterval(refreshComfyLogs, LOG_POLL_MS);
startQueuePolling();

$("send").onclick = async () => {
  try {
    setBusy(true);
    const prompt = $("prompt").value.trim();
    if (!prompt) throw new Error("Inserisci un prompt");
    const megapixels = $("megapixels").value;
    if (!isValidMegapixels(megapixels)) throw new Error(`Megapixel non valido: usa un numero tra ${MEGAPIXELS_LIMITS.min} e ${MEGAPIXELS_LIMITS.max}`);
    add(prompt, "user");
    $("progress").textContent = "Controllo allegati…";
    const preset = currentPreset();
    const files = selectedProject?.workflowId === preset?.id ? { ...(selectedProject.files || {}) } : {};
    for (const input of $("attachmentFields").querySelectorAll("input[type=file]")) {
      if (input.files[0]) {
        $("progress").textContent = `Caricamento · ${input.closest("label").firstChild.textContent.trim()}`;
        files[input.dataset.key] = await upload(input.files[0]);
      }
    }
    const missing = (preset?.attachments || []).filter(field => !files[field.key]).map(field => field.label);
    if (missing.length) throw new Error(`Mancano: ${missing.join(", ")}`);
    $("progress").textContent = "In coda…";
    const payload = {
      clientId,
      workflowId: $("workflow").value,
      prompt,
      megapixels: Number(megapixels),
      model: $("model").value,
      steps: $("steps").value,
      duration: $("duration").value,
      aspect: $("aspect").value,
      seed: $("seed").value,
      files
    };
    const response = await fetch("/api/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok || !data.prompt_id) throw new Error(data.error || JSON.stringify(data.node_errors) || "Invio fallito");
    jobFirstSeenAt = Date.now();
    sessionStorage.setItem("h3JobFirstSeenAt", String(jobFirstSeenAt));
    rememberJob(data.prompt_id);
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
  } catch (error) {
    stopPolling();
    setBusy(false);
    monitorState = { ...monitorState, phase: "error" };
    renderMonitor();
    add(error.message);
  }
};
