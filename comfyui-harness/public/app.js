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
  editorStateFromDomLike,
  emptyLibrary,
  filterFilesForActivePreset,
  isProjectDirty,
  listAllMembers,
  membersCompatibleWithRole,
  normalizeProject,
  projectEditorSnapshot,
  removeGroup,
  removeMember,
  renameGroup,
  reorderMembers,
  restoreModelSelection,
  roleAcceptKind
} from "/lib/projects.mjs";

const $ = id => document.getElementById(id);
let clientId = sessionStorage.getItem("h3ClientId") || crypto.randomUUID();
let config, events;
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
  $("monitorConnection").textContent = summary.connection;
  $("monitorQueue").textContent = `${summary.queueRunning ?? 0} running · ${summary.queuePending ?? 0} pending`;
  const events = monitorState.events || [];
  $("monitorEvents").textContent = events.length ? events.map(item => `[${item.t}] ${item.m}`).join("\n") : "Nessun evento.";
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
  draft.baseline = projectEditorSnapshot(currentEditorState());
  updateDirtyFlag();
}

function updateDirtyFlag() {
  const dirty = isProjectDirty(draft.baseline, projectEditorSnapshot(currentEditorState()));
  $("projectDirty").hidden = !dirty;
  return dirty;
}

function viewUrl(filename) {
  return `/api/view?${new URLSearchParams({ filename, type: "input" })}`;
}

function statusLabel(status) {
  if (status === "available") return "Disponibile";
  if (status === "missing") return "Mancante";
  if (status === "error") return "Errore";
  if (status === "uploading") return "Caricamento…";
  return "Sconosciuto";
}

async function refreshAvailability() {
  const filenames = listAllMembers(draft.library).map(m => m.filename);
  for (const name of Object.values(draft.files || {})) if (name) filenames.push(name);
  const unique = [...new Set(filenames.filter(Boolean))];
  if (!unique.length) {
    draft.availability = {};
    return;
  }
  const params = new URLSearchParams();
  for (const name of unique) params.append("filename", name);
  try {
    const response = await fetch(`/api/asset-status?${params}`);
    const data = await response.json();
    draft.availability = data.statuses || {};
  } catch {
    draft.availability = Object.fromEntries(unique.map(name => [name, "error"]));
  }
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
  const name = document.createElement("input");
  name.type = "text";
  name.value = group.label;
  name.title = "Rinomina gruppo";
  name.onchange = () => {
    draft.library = renameGroup(draft.library, activeCategory, group.id, name.value.trim() || group.label);
    updateDirtyFlag();
    renderLibrary();
    renderRoleFields();
  };
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
  head.append(name, addBtn, delBtn);

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
  const status = draft.availability[member.filename] || "unknown";
  const card = document.createElement("div");
  card.className = `member-card${member.type === "audio" || activeCategory === "audio" ? " audio-card" : ""}${status === "missing" || status === "error" ? " missing" : ""}`;

  if (activeCategory === "audio" || member.type === "audio") {
    const icon = document.createElement("div");
    icon.className = "audio-icon";
    icon.textContent = "AUDIO";
    card.append(icon);
  } else if (status === "available") {
    const img = document.createElement("img");
    img.alt = member.label;
    img.src = viewUrl(member.filename);
    img.onerror = () => { img.replaceWith(Object.assign(document.createElement("div"), { className: "member-thumb", textContent: "?" })); };
    card.append(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "member-thumb";
    ph.textContent = status === "missing" ? "N/A" : "…";
    card.append(ph);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  const title = document.createElement("strong");
  title.textContent = member.label || member.originalName;
  const sub = document.createElement("span");
  sub.textContent = `${statusLabel(status)} · ${member.originalName || member.filename}`;
  meta.append(title, sub);

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
  };
  const down = document.createElement("button");
  down.type = "button";
  down.textContent = "↓";
  down.disabled = index >= (group.members.length - 1);
  down.onclick = () => {
    draft.library = reorderMembers(draft.library, activeCategory, group.id, index, index + 1);
    updateDirtyFlag();
    renderLibrary();
  };
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Rimuovi";
  remove.onclick = () => {
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
    const status = filename ? (draft.availability[filename] || "unknown") : null;
    row.className = `role-row${status === "missing" || status === "error" ? " stale" : ""}`;
    const label = document.createElement("label");
    label.textContent = field.label;
    const select = document.createElement("select");
    select.append(new Option("— non assegnato —", ""));
    const compatible = membersCompatibleWithRole(draft.library, field.accept);
    for (const member of compatible) {
      const opt = new Option(
        `${member.groupLabel} / ${member.label}`,
        member.filename,
        false,
        member.filename === filename
      );
      select.append(opt);
    }
    if (filename && !compatible.some(m => m.filename === filename)) {
      select.append(new Option(`(fuori libreria) ${filename}`, filename, true, true));
    }
    select.onchange = () => {
      draft.files = assignRole(draft.files, field.key, select.value || undefined);
      updateDirtyFlag();
      renderRoleFields();
    };
    const preview = document.createElement("div");
    preview.className = "role-preview";
    if (filename && roleAcceptKind(field.accept) === "image" && status === "available") {
      const img = document.createElement("img");
      img.src = viewUrl(filename);
      img.alt = field.label;
      preview.append(img);
    }
    const note = document.createElement("span");
    note.textContent = filename ? statusLabel(status || "unknown") : "nessuna assegnazione";
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
        const name = await upload(input.files[0]);
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
  if (trackDirty) updateDirtyFlag();
}

async function loadProjectById(id) {
  if (!id) {
    return resetDraft({ keepForm: true });
  }
  const project = config.projects.find(item => item.id === id) || await (await fetch(`/api/projects/${encodeURIComponent(id)}`)).json();
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
    if ($(key)) $(key).value = value;
  }
  const restored = megapixelsFromSettings(normalized.settings || {});
  if (restored !== undefined) $("megapixels").value = restored;
  selectPreset({ preserveLibrary: true, preferredModel: savedModel, trackDirty: false });
  await refreshAvailability();
  markBaselineFromDraft();
  renderLibrary();
  renderRoleFields();
  add(`Progetto caricato: ${normalized.label}`);
}

function resetDraft({ keepForm = false } = {}) {
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
  if (!keepForm) {
    $("prompt").value = "";
  }
  selectPreset({ preserveLibrary: true, clearProjectSelection: true });
  markBaselineFromDraft();
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
    files: state.files
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
  config.projects = await (await fetch("/api/projects")).json();
  draft.id = data.id;
  draft.label = data.label;
  draft.saved = true;
  draft.library = normalizeProject(data).library;
  draft.files = { ...(data.files || {}) };
  refreshProjectSelect(data.id);
  $("projectLabel").value = data.label;
  markBaselineFromDraft();
  add(`Progetto salvato: ${data.label}`);
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
    const filename = await upload(file);
    members.push(createMember({
      filename,
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
  return String(name || "Gruppo").replace(/\.[^.]+$/, "");
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
$("aspect").onchange = () => { updateResolutionHint(); updateDirtyFlag(); };
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
  resetDraft();
  add("Nuovo progetto (non salvato).");
};
$("projectSave").onclick = async () => {
  try { await saveProject({ asNew: false }); }
  catch (error) { add(error.message); }
};
$("projectSaveAs").onclick = async () => {
  try {
    const label = prompt("Nome per la copia:");
    if (!label) return;
    $("projectLabel").value = label;
    if (draft.saved && draft.id) await saveProject({ asNew: true });
    else await saveProject({ asNew: false });
  } catch (error) { add(error.message); }
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
  resetDraft();
  add("Progetto eliminato (solo definizione locale).");
};

selectPreset({ preserveLibrary: true, trackDirty: false });
setCategory("elements");
markBaselineFromDraft();
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
    await refreshAvailability();
    const activeKeys = (preset?.attachments || []).map(field => field.key);
    const requiredKeys = activeKeys;
    // Merge any freshly chosen video file uploads already in draft.files.
    for (const input of $("attachmentFields").querySelectorAll("input[type=file]")) {
      if (input.files[0]) {
        $("progress").textContent = `Caricamento · ${input.closest("label").firstChild.textContent.trim()}`;
        draft.files[input.dataset.key] = await upload(input.files[0]);
      }
    }
    const built = buildSubmissionFiles({
      files: draft.files,
      library: draft.library,
      availability: draft.availability,
      activeKeys,
      requiredKeys
    });
    if (built.missingRequired.length) {
      const labels = built.missingRequired.map(key => (preset.attachments.find(f => f.key === key)?.label || key));
      throw new Error(`Mancano o non sono disponibili: ${labels.join(", ")}`);
    }
    // Defense in depth: never send inactive-workflow bindings.
    const files = filterFilesForActivePreset(built.files, activeKeys);
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
