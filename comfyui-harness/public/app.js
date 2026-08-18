const $ = id => document.getElementById(id);
let clientId = sessionStorage.getItem("h3ClientId") || crypto.randomUUID();
let config, events, selectedProject;
let currentPrompt = sessionStorage.getItem("h3CurrentPrompt") || undefined;

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

const rememberJob = promptId => {
  currentPrompt = promptId;
  if (promptId) sessionStorage.setItem("h3CurrentPrompt", promptId);
  else sessionStorage.removeItem("h3CurrentPrompt");
};

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
  const response = await fetch(`/api/outputs?promptId=${encodeURIComponent(currentPrompt)}`);
  const items = await response.json();
  if (!response.ok) throw new Error(items.error || "Output non disponibile");
  $("progress").textContent = "Completato";
  setBusy(false);
  rememberJob();
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
}

function showProgress(data) {
  const nodes = Object.values(data?.nodes || {});
  const active = nodes.filter(node => node.state === "running").at(-1);
  if (!active) return;
  const value = Number(active.value || 0), max = Number(active.max || 0);
  const percent = max ? Math.round(value / max * 100) : 0;
  $("progress").textContent = max ? `In esecuzione · ${value}/${max} · ${percent}%` : `In esecuzione · nodo ${active.display_node_id || active.node_id}`;
}

async function handleMessage(event) {
  const message = JSON.parse(event.data);
  if (message.data?.prompt_id && message.data.prompt_id !== currentPrompt) return;
  if (message.type === "progress") $("progress").textContent = `In esecuzione · ${message.data.value}/${message.data.max} · ${Math.round(message.data.value / message.data.max * 100)}%`;
  if (message.type === "progress_state") showProgress(message.data);
  if (message.type === "executing" && message.data.node !== null && currentPrompt && !String($("progress").textContent).includes("%")) $("progress").textContent = `In esecuzione · nodo ${message.data.display_node || message.data.node}`;
  if (message.type === "executing" && message.data.node === null && currentPrompt) await outputs();
  if (["execution_error", "execution_interrupted"].includes(message.type)) {
    $("progress").textContent = "Errore";
    setBusy(false);
    rememberJob();
    add(JSON.stringify(message.data, null, 2));
  }
}

function connect() {
  events?.close();
  events = new EventSource(`/api/events?clientId=${encodeURIComponent(clientId)}`);
  events.addEventListener("connection", event => {
    $("connection").textContent = JSON.parse(event.data).state === "open" ? "ComfyUI collegato" : "Connessione…";
  });
  events.onmessage = handleMessage;
  events.onerror = () => { $("connection").textContent = "Riconnessione…"; };
}

async function recoverActive() {
  const active = await (await fetch("/api/active")).json();
  if (!active.active) return;
  if (active.clientId) clientId = active.clientId;
  sessionStorage.setItem("h3ClientId", clientId);
  rememberJob(active.promptId);
  setBusy(true);
  $("progress").textContent = `In esecuzione · ${active.promptId.slice(0, 8)}`;
}

function currentPreset() {
  return config.presets.find(item => item.id === $("workflow").value);
}

function selectPreset() {
  const preset = currentPreset();
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
  selectPreset();
  add(`Progetto caricato: ${selectedProject.label}`);
}

config = await (await fetch("/api/config")).json();
$("version").textContent = `v${config.version}`;
$("workflow").replaceChildren(...(config.presets.length ? config.presets.map(item => new Option(item.label, item.id)) : [new Option("Nessun preset", "")]));
$("project").replaceChildren(new Option("Nessun progetto", ""), ...(config.projects || []).map(item => new Option(item.label, item.id)));
$("workflow").onchange = () => { selectedProject = undefined; $("project").value = ""; selectPreset(); };
$("project").onchange = selectProject;
selectPreset();
await recoverActive();
sessionStorage.setItem("h3ClientId", clientId);
connect();

$("send").onclick = async () => {
  try {
    setBusy(true);
    const prompt = $("prompt").value.trim();
    if (!prompt) throw new Error("Inserisci un prompt");
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
      quality: $("quality").value,
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
    rememberJob(data.prompt_id);
    $("progress").textContent = `In esecuzione · ${currentPrompt.slice(0, 8)}`;
  } catch (error) {
    setBusy(false);
    $("progress").textContent = "Errore";
    add(error.message);
  }
};
