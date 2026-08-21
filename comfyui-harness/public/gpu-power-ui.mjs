const POLL_MS = 8000;
const $ = id => document.getElementById(id);

let pollTimer = null;
let posting = false;
let lastStatus = null;

function setMessage(text, kind = "") {
  const el = $("gpuPowerMessage");
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || "";
  el.dataset.kind = kind || "";
}

function formatWatts(value, digits = 0) {
  if (!Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  return `${digits > 0 ? n.toFixed(digits) : Math.round(n)} W`;
}

function shortGpuName(name) {
  if (!name) return "GPU";
  return String(name)
    .replace(/^NVIDIA\s+GeForce\s+/i, "")
    .replace(/^NVIDIA\s+/i, "")
    .trim() || "GPU";
}

function setButtonsEnabled(enabled) {
  for (const btn of document.querySelectorAll("[data-gpu-power-mode]")) {
    btn.disabled = !enabled;
  }
}

const HELPER_LABELS = {
  ready: "Helper GPU: pronto",
  "not-installed": "Helper GPU: da installare",
  partial: "Helper GPU: installazione incompleta",
  invalid: "Helper GPU: configurazione non valida",
  unsupported: "Helper GPU: non supportato su questo sistema"
};

const HELPER_ERROR_MESSAGES = {
  "gpu-helper-not-installed": "Controllo GPU pronto, ma l'helper amministrativo non è ancora installato.",
  "gpu-helper-partial": "Installazione helper GPU incompleta. Nessun comando è stato eseguito.",
  "gpu-helper-invalid": "Configurazione helper GPU non valida. Nessun comando è stato eseguito.",
  "gpu-helper-unsupported": "Helper GPU non supportato su questo sistema.",
  "helper-verify-timeout": "Il task helper è partito ma il limite GPU non è stato confermato."
};

function renderHelper(helper) {
  const line = $("gpuPowerHelper");
  const help = $("gpuPowerHelperHelp");
  if (!line) return;
  const state = helper?.state || null;
  if (!state) {
    line.hidden = true;
    if (help) help.hidden = true;
    return;
  }
  line.hidden = false;
  line.dataset.state = state;
  line.textContent = HELPER_LABELS[state] || `Helper GPU: ${state}`;
  if (help) help.hidden = state === "ready" || state === "unsupported";
}

function renderStatus(status) {
  lastStatus = status;
  const panel = $("gpuPowerSection");
  const primary = $("gpuPowerPrimary");
  const secondary = $("gpuPowerSecondary");
  const unavailable = $("gpuPowerUnavailable");
  const controls = $("gpuPowerControls");
  if (!panel || !primary || !secondary || !unavailable || !controls) return;

  renderHelper(status?.helper);

  const modes = Array.isArray(status?.modes) ? status.modes : [];
  for (const btn of controls.querySelectorAll("[data-gpu-power-mode]")) {
    const id = btn.getAttribute("data-gpu-power-mode");
    const meta = modes.find(m => m.id === id);
    if (meta) {
      btn.querySelector(".gpu-power-btn-label").textContent = meta.label;
      btn.querySelector(".gpu-power-btn-watts").textContent = `${meta.watts} W`;
    }
    const active = status?.available && status?.mode === id;
    btn.classList.toggle("active", Boolean(active));
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }

  if (!status?.available) {
    unavailable.hidden = false;
    controls.hidden = true;
    primary.textContent = "Controllo GPU non disponibile";
    secondary.textContent = "nvidia-smi non raggiungibile su questa workstation.";
    return;
  }

  unavailable.hidden = true;
  controls.hidden = false;
  const modeLabel = status.mode === "custom"
    ? "CUSTOM"
    : (modes.find(m => m.id === status.mode)?.label || String(status.mode || "").toUpperCase());
  primary.textContent = `${shortGpuName(status.name)} · ${formatWatts(status.drawW, 1)} attuali · limite ${formatWatts(status.currentLimitW)} · ${modeLabel}`;
  secondary.textContent = `Range ${formatWatts(status.minLimitW)}–${formatWatts(status.maxLimitW)} · default ${formatWatts(status.defaultLimitW)}`;
}

async function fetchStatus() {
  const response = await fetch("/api/gpu-power", { method: "GET", cache: "no-store" });
  if (!response.ok) throw new Error(`GPU status HTTP ${response.status}`);
  return response.json();
}

async function refreshStatus({ quiet = false } = {}) {
  try {
    const status = await fetchStatus();
    renderStatus(status);
    if (!quiet && status?.available) setMessage("");
  } catch (error) {
    renderStatus({ available: false });
    if (!quiet) setMessage(String(error?.message || error), "error");
  }
}

async function applyMode(mode) {
  if (posting) return;
  posting = true;
  setButtonsEnabled(false);
  setMessage("Applicazione limite GPU…", "pending");
  try {
    const response = await fetch("/api/gpu-power", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode })
    });
    const data = await response.json().catch(() => ({}));
    if (HELPER_ERROR_MESSAGES[data.code]) {
      setMessage(HELPER_ERROR_MESSAGES[data.code], "error");
      await refreshStatus({ quiet: true });
      return;
    }
    if (response.status === 403 || data.code === "permission-denied") {
      setMessage("Permessi amministratore necessari per cambiare il limite.", "error");
      await refreshStatus({ quiet: true });
      return;
    }
    if (!response.ok) {
      setMessage(data.error || `Errore GPU power (${response.status})`, "error");
      await refreshStatus({ quiet: true });
      return;
    }
    renderStatus(data);
    setMessage(`Limite impostato: ${data.requested?.label || mode} ${data.requested?.watts ?? ""} W`.trim(), "ok");
  } catch (error) {
    setMessage(String(error?.message || error), "error");
    await refreshStatus({ quiet: true });
  } finally {
    posting = false;
    setButtonsEnabled(true);
  }
}

function initGpuPowerUi() {
  const section = $("gpuPowerSection");
  if (!section) return;
  section.addEventListener("click", event => {
    const helpBtn = event.target.closest("#gpuPowerHelperHelp");
    if (helpBtn) {
      const instructions = $("gpuPowerHelperInstructions");
      if (instructions) instructions.hidden = !instructions.hidden;
      return;
    }
    const btn = event.target.closest("[data-gpu-power-mode]");
    if (!btn || btn.disabled) return;
    const mode = btn.getAttribute("data-gpu-power-mode");
    if (!mode) return;
    applyMode(mode);
  });
  refreshStatus();
  pollTimer = window.setInterval(() => {
    if (!posting) refreshStatus({ quiet: true });
  }, POLL_MS);
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGpuPowerUi, { once: true });
  } else {
    initGpuPowerUi();
  }
}

export {
  applyMode,
  formatWatts,
  initGpuPowerUi,
  renderStatus,
  shortGpuName
};
