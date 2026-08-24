/**
 * OUTPUT destination UI + server-side archive orchestration (v0.16.0).
 * Browser configures destination via Director APIs; Node performs copies.
 * Does not use FileSystemDirectoryHandle / showDirectoryPicker / createWritable.
 */

import {
  DEFAULT_OUTPUT_TEMPLATE,
  buildOutputFilename,
  buildOutputTokens,
  outputCounterStorageKey
} from "./output-naming.mjs";
import { createSessionClipCard } from "./session-gallery-dom.mjs";
import {
  SESSION_OUTPUTS_CHANGED,
  applySessionGalleryReconstruction,
  attachArchiveMetadata,
  clearSessionOutputs,
  markSessionOutputUnavailable,
  notifySessionOutputsChanged,
  readSessionOutputs,
  sessionGalleryClearSideEffects,
  subfolderFromOutputUrl
} from "./session-outputs.mjs";

const $ = id => document.getElementById(id);
const SETTINGS_PREFIX = "h3OutputSettings:v1:";
const SCOPE_PREF_PREFIX = "h3OutputScopePreference:v1:";
const PLAN_PREFIX = "h3OutputPlan:v1:";
const ARCHIVED_PREFIX = "h3OutputArchived:v1:";
const originalFetch = window.fetch.bind(window);
let archiveChain = Promise.resolve();
let activeSettings = null;
let activeFolderKey = "global";
let archiveDestination = {
  configured: false,
  absolutePath: null,
  folderLabel: null
};

function projectId() {
  return $("project")?.value || "";
}

function projectLabel() {
  return $("projectLabel")?.value?.trim() || $("project")?.selectedOptions?.[0]?.textContent?.trim() || "project";
}

function scopePreferenceKey() {
  return `${SCOPE_PREF_PREFIX}${projectId() || "none"}`;
}

function selectedScope() {
  const requested = $("outputScope")?.value || "global";
  return requested === "project" && projectId() ? "project" : "global";
}

function folderKeyForScope(scope = selectedScope()) {
  return scope === "project" && projectId() ? `project:${projectId()}` : "global";
}

function settingsKey(folderKey = folderKeyForScope()) {
  return `${SETTINGS_PREFIX}${folderKey}`;
}

function defaultSettings() {
  return {
    autoArchive: true,
    scene: "shot",
    variant: "",
    template: DEFAULT_OUTPUT_TEMPLATE,
    counterScope: "project"
  };
}

function readStoredSettings(folderKey = folderKeyForScope()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(settingsKey(folderKey)) || "null");
    return { ...defaultSettings(), ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return defaultSettings();
  }
}

function currentSettings() {
  return {
    autoArchive: Boolean($("outputAuto")?.checked),
    scene: $("outputScene")?.value?.trim() || "shot",
    variant: $("outputVariant")?.value?.trim() || "",
    template: $("outputTemplate")?.value?.trim() || DEFAULT_OUTPUT_TEMPLATE,
    counterScope: $("outputCounterScope")?.value || "project"
  };
}

function saveSettings() {
  activeSettings = currentSettings();
  try {
    localStorage.setItem(settingsKey(activeFolderKey), JSON.stringify(activeSettings));
  } catch { /* local persistence is best-effort */ }
  renderPreview();
}

function setStatus(message, kind = "neutral") {
  const node = $("outputStatus");
  if (!node) return;
  node.textContent = message;
  node.dataset.kind = kind;
}

async function refreshFolderLabel() {
  const label = $("outputFolderName");
  const openBtn = $("outputOpenFolder");
  try {
    const response = await originalFetch(`/api/archive/config?folderKey=${encodeURIComponent(activeFolderKey)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Archive config failed");
    archiveDestination = {
      configured: Boolean(data.configured),
      absolutePath: data.absolutePath || null,
      folderLabel: data.folderLabel || null
    };
    if (label) {
      label.textContent = archiveDestination.configured
        ? (archiveDestination.absolutePath || archiveDestination.folderLabel || "Cartella configurata")
        : "Nessuna cartella scelta";
    }
    if (openBtn) openBtn.disabled = !archiveDestination.configured;
    if (archiveDestination.configured) {
      setStatus("Archivio locale Director pronto. I render completati verranno copiati qui.", "ok");
    } else {
      setStatus("Scegli una cartella: ComfyUI continuerà comunque a conservare l'output originale.");
    }
  } catch {
    archiveDestination = { configured: false, absolutePath: null, folderLabel: null };
    if (label) label.textContent = "Cartella non disponibile";
    if (openBtn) openBtn.disabled = true;
    setStatus("Impossibile leggere la configurazione archivio Director.", "warn");
  }
}

async function chooseFolder() {
  setStatus("Apertura selettore cartella…");
  try {
    const response = await originalFetch("/api/archive/pick-folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderKey: activeFolderKey })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409 && data.code === "archive-pick-cancelled") {
      setStatus("Scelta cartella annullata.");
      return;
    }
    if (!response.ok) {
      setStatus(data.error || "Errore scelta cartella", "error");
      return;
    }
    archiveDestination = {
      configured: Boolean(data.configured),
      absolutePath: data.absolutePath || null,
      folderLabel: data.folderLabel || null
    };
    if ($("outputFolderName")) {
      $("outputFolderName").textContent = archiveDestination.absolutePath
        || archiveDestination.folderLabel
        || "Cartella configurata";
    }
    if ($("outputOpenFolder")) $("outputOpenFolder").disabled = !archiveDestination.configured;
    setStatus("Cartella archivio configurata sul Director. Nessun permesso browser richiesto.", "ok");
  } catch (error) {
    setStatus(`Errore cartella: ${error?.message || error}`, "error");
  }
}

async function openConfiguredFolder() {
  try {
    const response = await originalFetch("/api/archive/open-folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderKey: activeFolderKey })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(data.error || "Impossibile aprire la cartella archivio.", "error");
    }
  } catch (error) {
    setStatus(`Errore apertura cartella: ${error?.message || error}`, "error");
  }
}

function workflowMeta() {
  const select = $("workflow");
  return {
    id: select?.value || "H3",
    label: select?.selectedOptions?.[0]?.textContent?.trim() || "H3"
  };
}

function generationFromDom() {
  const workflow = workflowMeta();
  return {
    workflow: workflow.id,
    workflowLabel: workflow.label,
    model: $("model")?.value || "model",
    megapixels: $("megapixels")?.value || "NA",
    duration: $("duration")?.value || "NA",
    steps: $("steps")?.value || "NA",
    seed: $("seed")?.value || "NA",
    aspect: $("aspect")?.value || "NA"
  };
}

function nextCounterPreview(settings = currentSettings()) {
  const key = outputCounterStorageKey({
    scope: settings.counterScope,
    projectId: projectId(),
    scene: settings.scene
  });
  const value = Number(localStorage.getItem(key) || "1");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function renderPreview() {
  const node = $("outputPreview");
  if (!node) return;
  const settings = currentSettings();
  const generation = generationFromDom();
  const tokens = buildOutputTokens({
    project: projectLabel(),
    scene: settings.scene,
    variant: settings.variant,
    ...generation
  });
  node.textContent = buildOutputFilename({
    template: settings.template,
    tokens,
    counter: nextCounterPreview(settings),
    sourceFilename: "render.mp4"
  });
}

function applySettingsToUi(settings) {
  activeSettings = { ...defaultSettings(), ...(settings || {}) };
  if ($("outputAuto")) $("outputAuto").checked = Boolean(activeSettings.autoArchive);
  if ($("outputScene")) $("outputScene").value = activeSettings.scene || "shot";
  if ($("outputVariant")) $("outputVariant").value = activeSettings.variant || "";
  if ($("outputTemplate")) $("outputTemplate").value = activeSettings.template || DEFAULT_OUTPUT_TEMPLATE;
  if ($("outputCounterScope")) $("outputCounterScope").value = activeSettings.counterScope || "project";
  renderPreview();
}

async function loadScope() {
  const project = projectId();
  const projectOption = $("outputScope")?.querySelector('option[value="project"]');
  if (projectOption) projectOption.disabled = !project;
  let preference = "global";
  try { preference = localStorage.getItem(scopePreferenceKey()) || "global"; } catch { /* ignore */ }
  if (preference === "project" && !project) preference = "global";
  if ($("outputScope")) $("outputScope").value = preference;
  activeFolderKey = folderKeyForScope(preference);
  applySettingsToUi(readStoredSettings(activeFolderKey));
  await refreshFolderLabel();
}

async function changeScope() {
  const scope = selectedScope();
  try { localStorage.setItem(scopePreferenceKey(), scope); } catch { /* ignore */ }
  activeFolderKey = folderKeyForScope(scope);
  applySettingsToUi(readStoredSettings(activeFolderKey));
  await refreshFolderLabel();
}

async function requestBodyJson(input, init) {
  try {
    if (typeof init?.body === "string") return JSON.parse(init.body);
    if (input instanceof Request) {
      const text = await input.clone().text();
      return text ? JSON.parse(text) : null;
    }
  } catch { /* ignore malformed/unrelated bodies */ }
  return null;
}

function planFromQueuePayload(payload = {}) {
  const settings = currentSettings();
  const workflow = workflowMeta();
  return {
    version: 1,
    enabled: Boolean(settings.autoArchive),
    folderKey: activeFolderKey,
    projectId: projectId(),
    projectLabel: projectLabel(),
    scene: settings.scene,
    variant: settings.variant,
    template: settings.template,
    counterScope: settings.counterScope,
    generation: {
      workflow: payload.workflowId || workflow.id,
      workflowLabel: workflow.label,
      model: payload.model ?? $("model")?.value,
      megapixels: payload.megapixels ?? payload.quality ?? $("megapixels")?.value,
      duration: payload.duration ?? $("duration")?.value,
      steps: payload.steps ?? $("steps")?.value,
      seed: payload.seed ?? $("seed")?.value,
      aspect: payload.aspect ?? $("aspect")?.value
    }
  };
}

function savePromptPlan(promptId, plan) {
  if (!promptId || !plan) return;
  try { localStorage.setItem(`${PLAN_PREFIX}${promptId}`, JSON.stringify(plan)); } catch { /* best effort */ }
}

function readPromptPlan(promptId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${PLAN_PREFIX}${promptId}`) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function archivedKey(promptId, item) {
  return `${ARCHIVED_PREFIX}${promptId}:${item?.subfolder || ""}:${item?.filename || "output"}`;
}

async function archiveOutputs(promptId, items = []) {
  const plan = readPromptPlan(promptId);
  if (!plan?.enabled || !Array.isArray(items) || !items.length) return;

  let copied = 0;
  for (const item of items) {
    if (!item?.filename) continue;
    const key = archivedKey(promptId, item);
    if (localStorage.getItem(key)) continue;
    const response = await originalFetch("/api/archive-output", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        promptId,
        filename: item.filename,
        subfolder: item.subfolder || subfolderFromOutputUrl(item.url) || "",
        type: "output",
        folderKey: plan.folderKey || activeFolderKey,
        plan
      })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409 && data.code === "archive-unconfigured") {
      setStatus("Render completato ma nessuna cartella archivio è configurata sul Director.", "warn");
      return;
    }
    if (response.status === 409 && data.code === "archive-unavailable") {
      setStatus("Render completato; cartella archivio non disponibile. L'originale ComfyUI resta intatto.", "warn");
      return;
    }
    if (!response.ok) {
      setStatus(
        `Archiviazione non riuscita: ${data.error || response.status}. L'output originale ComfyUI resta intatto.`,
        "error"
      );
      return;
    }
    if (data.skipped) continue;
    if (data.archivedFilename) {
      localStorage.setItem(key, JSON.stringify({
        filename: data.archivedFilename,
        bytes: data.bytes,
        archivedAt: Date.now()
      }));
      const counterKey = outputCounterStorageKey({
        scope: plan.counterScope,
        projectId: plan.projectId,
        scene: plan.scene
      });
      try {
        const current = Number(localStorage.getItem(counterKey) || "1");
        if (Number.isFinite(current) && current >= 1) {
          localStorage.setItem(counterKey, String(Math.floor(current) + 1));
        }
      } catch { /* preview counter best-effort */ }
      attachArchiveMetadata(sessionStorage, {
        promptId,
        filename: item.filename,
        subfolder: item.subfolder || subfolderFromOutputUrl(item.url),
        archive: {
          filename: data.archivedFilename,
          folderLabel: data.folderLabel || archiveDestination.folderLabel || "Archivio locale",
          archivedAt: Date.now(),
          bytes: data.bytes
        }
      });
      notifySessionOutputsChanged();
      copied += 1;
      setStatus(
        data.alreadyArchived
          ? `Già archiviato: ${data.archivedFilename}`
          : `Archiviato: ${data.archivedFilename}`,
        "ok"
      );
    }
  }
  if (copied) renderPreview();
}

function scheduleArchive(promptId, items) {
  archiveChain = archiveChain
    .then(() => archiveOutputs(promptId, items))
    .catch(error => {
      console.error("H3 output archive failed", error);
      setStatus(`Archiviazione non riuscita: ${error?.message || error}. L'output originale ComfyUI resta intatto.`, "error");
    });
}

window.fetch = async (input, init = undefined) => {
  let url;
  let method;
  let queuePlan = null;
  try {
    const rawUrl = typeof input === "string" ? input : input?.url;
    url = new URL(rawUrl, window.location.href);
    method = String(init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
    if (method === "POST" && url.pathname === "/api/queue") {
      const payload = await requestBodyJson(input, init);
      queuePlan = planFromQueuePayload(payload || {});
    }
  } catch { /* output manager must never block the real request */ }

  const response = await originalFetch(input, init);

  try {
    if (queuePlan && response.ok) {
      response.clone().json().then(data => {
        if (data?.prompt_id) savePromptPlan(data.prompt_id, queuePlan);
      }).catch(() => {});
    }
    if (method === "GET" && url?.pathname === "/api/outputs" && response.ok) {
      const promptId = url.searchParams.get("promptId") || "";
      response.clone().json().then(items => scheduleArchive(promptId, items)).catch(() => {});
    }
  } catch { /* archival bookkeeping is non-blocking */ }

  return response;
};

function renderSessionGallery() {
  const list = $("sessionGalleryList");
  const empty = $("sessionGalleryEmpty");
  const title = $("sessionGalleryTitle");
  if (!list || !empty || !title) return;
  const items = readSessionOutputs(sessionStorage);
  title.textContent = `CLIP SESSIONE · ${items.length}`;
  list.replaceChildren();
  empty.hidden = items.length > 0;
  for (const item of items) {
    list.append(createSessionClipCard(document, item, {
      onPreviewError: clip => {
        markSessionOutputUnavailable(sessionStorage, clip.id);
        notifySessionOutputsChanged();
      },
      onShowInFolder: clip => {
        void fetch("/api/show-in-folder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            promptId: clip.promptId || "",
            filename: clip.filename,
            subfolder: clip.subfolder || "",
            type: "output"
          })
        }).then(async response => {
          if (response.ok) {
            setStatus("Cartella ComfyUI aperta con il file selezionato.", "ok");
            return;
          }
          const data = await response.json().catch(() => ({}));
          setStatus(data.error || "Impossibile aprire la cartella ComfyUI.", "error");
        }).catch(error => {
          setStatus(`Impossibile aprire la cartella ComfyUI: ${error?.message || error}`, "error");
        });
      }
    }));
  }
}

function bindSessionGallery() {
  if (!$("sessionGallerySection")) return;
  applySessionGalleryReconstruction(sessionStorage, localStorage);
  renderSessionGallery();
  window.addEventListener(SESSION_OUTPUTS_CHANGED, renderSessionGallery);
  $("sessionGalleryClear")?.addEventListener("click", () => {
    const count = readSessionOutputs(sessionStorage).length;
    if (!count) return;
    const ok = window.confirm("Svuotare l'elenco clip di questa sessione?\nI file ComfyUI e le copie archivio non verranno cancellati.");
    if (!ok) return;
    clearSessionOutputs(sessionStorage);
    notifySessionOutputsChanged();
    void sessionGalleryClearSideEffects();
  });
}

function bindUi() {
  if (!$("outputSection") && !$("sessionGallerySection")) return;

  $("outputChooseFolder")?.addEventListener("click", () => { void chooseFolder(); });
  $("outputOpenFolder")?.addEventListener("click", () => { void openConfiguredFolder(); });
  $("outputScope")?.addEventListener("change", () => { void changeScope(); });
  for (const id of ["outputAuto", "outputScene", "outputVariant", "outputTemplate", "outputCounterScope"]) {
    $(id)?.addEventListener("input", saveSettings);
    $(id)?.addEventListener("change", saveSettings);
  }
  for (const id of ["workflow", "model", "megapixels", "duration", "steps", "seed", "aspect", "projectLabel"]) {
    $(id)?.addEventListener("input", renderPreview);
    $(id)?.addEventListener("change", renderPreview);
  }
  $("project")?.addEventListener("change", () => { setTimeout(() => { void loadScope(); }, 0); });

  const observer = new MutationObserver(renderPreview);
  if ($("workflow")) observer.observe($("workflow"), { childList: true, subtree: true });
  if ($("model")) observer.observe($("model"), { childList: true, subtree: true });

  void loadScope();
  setTimeout(() => { void loadScope(); }, 500);
  bindSessionGallery();
}

bindUi();
