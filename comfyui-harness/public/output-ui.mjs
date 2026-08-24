import {
  DEFAULT_OUTPUT_TEMPLATE,
  buildOutputFilename,
  buildOutputTokens,
  extensionFromFilename,
  outputCounterStorageKey,
  sanitizeOutputSegment
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
const DB_NAME = "h3-output-directories";
const DB_STORE = "handles";
const DB_VERSION = 1;
const originalFetch = window.fetch.bind(window);
let archiveChain = Promise.resolve();
let activeSettings = null;
let activeFolderKey = "global";

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

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB unavailable"));
  });
}

async function dbGet(key) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const request = tx.objectStore(DB_STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Directory handle read failed"));
    });
  } finally {
    db.close();
  }
}

async function dbSet(key, value) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Directory handle write failed"));
      tx.onabort = () => reject(tx.error || new Error("Directory handle write aborted"));
    });
  } finally {
    db.close();
  }
}

async function permissionState(handle, { request = false } = {}) {
  if (!handle) return "missing";
  try {
    if (typeof handle.queryPermission !== "function") return "granted";
    let state = await handle.queryPermission({ mode: "readwrite" });
    if (state !== "granted" && request && typeof handle.requestPermission === "function") {
      state = await handle.requestPermission({ mode: "readwrite" });
    }
    return state;
  } catch {
    return "denied";
  }
}

async function refreshFolderLabel() {
  const label = $("outputFolderName");
  if (!label) return;
  try {
    const handle = await dbGet(activeFolderKey);
    if (!handle) {
      label.textContent = "Nessuna cartella scelta";
      setStatus("Scegli una cartella: ComfyUI continuerà comunque a conservare l'output originale.");
      return;
    }
    const permission = await permissionState(handle);
    label.textContent = handle.name || "Cartella selezionata";
    if (permission === "granted") setStatus("Cartella pronta per l'archiviazione automatica.", "ok");
    else setStatus("Cartella ricordata; Edge potrebbe richiedere di riattivare il permesso.", "warn");
  } catch {
    label.textContent = "Cartella non disponibile";
    setStatus("Impossibile leggere la cartella salvata nel browser.", "warn");
  }
}

async function chooseFolder() {
  if (typeof window.showDirectoryPicker !== "function") {
    setStatus("Questo browser non supporta la scelta diretta della cartella. Usa Edge/Chromium aggiornato.", "error");
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({
      id: `h3-output-${sanitizeOutputSegment(activeFolderKey, { fallback: "global", maxLength: 40 })}`,
      mode: "readwrite"
    });
    const permission = await permissionState(handle, { request: true });
    if (permission !== "granted") {
      setStatus("Permesso di scrittura non concesso; nessun file verrà archiviato automaticamente.", "warn");
      return;
    }
    await dbSet(activeFolderKey, handle);
    $("outputFolderName").textContent = handle.name || "Cartella selezionata";
    setStatus("Cartella selezionata. I render completati verranno copiati qui con il nome scelto.", "ok");
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("Scelta cartella annullata.");
      return;
    }
    setStatus(`Errore cartella: ${error?.message || error}`, "error");
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

async function fileExists(directory, filename) {
  try {
    await directory.getFileHandle(filename, { create: false });
    return true;
  } catch (error) {
    if (error?.name === "NotFoundError") return false;
    throw error;
  }
}

function appendCollisionSuffix(filename, counter) {
  const ext = extensionFromFilename(filename);
  const base = filename.slice(0, -ext.length);
  return `${base}_${String(counter).padStart(4, "0")}${ext}`;
}

async function allocateFilename(directory, plan, item) {
  const counterKey = outputCounterStorageKey({
    scope: plan.counterScope,
    projectId: plan.projectId,
    scene: plan.scene
  });
  let counter = Number(localStorage.getItem(counterKey) || "1");
  if (!Number.isFinite(counter) || counter < 1) counter = 1;
  counter = Math.floor(counter);

  const tokens = buildOutputTokens({
    project: plan.projectLabel,
    scene: plan.scene,
    variant: plan.variant,
    ...(plan.generation || {})
  });
  const templateHasCounter = /\{counter(?::0?\d+)?\}/.test(plan.template || "");

  for (let attempts = 0; attempts < 10000; attempts += 1, counter += 1) {
    let filename = buildOutputFilename({
      template: plan.template,
      tokens,
      counter,
      sourceFilename: item.filename
    });
    if (!templateHasCounter && counter > 1) filename = appendCollisionSuffix(filename, counter);
    if (!(await fileExists(directory, filename))) {
      return { filename, counter, counterKey };
    }
  }
  throw new Error("Unable to allocate a collision-free output filename");
}

async function copyOutputToDirectory(directory, item, targetName) {
  const response = await originalFetch(item.url);
  if (!response.ok) throw new Error(`Output fetch failed: ${response.status}`);
  const blob = await response.blob();
  const fileHandle = await directory.getFileHandle(targetName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    try { await writable.abort(); } catch { /* ignore */ }
    throw error;
  }
  const saved = await fileHandle.getFile();
  if (saved.size !== blob.size) throw new Error(`Archived file size mismatch for ${targetName}`);
  return saved.size;
}

async function archiveOutputs(promptId, items = []) {
  const plan = readPromptPlan(promptId);
  if (!plan?.enabled || !Array.isArray(items) || !items.length) return;
  const directory = await dbGet(plan.folderKey);
  if (!directory) {
    setStatus("Render completato ma nessuna cartella archivio è associata a questo job.", "warn");
    return;
  }
  const permission = await permissionState(directory);
  if (permission !== "granted") {
    setStatus("Render completato; Edge richiede di riattivare il permesso della cartella prima della copia.", "warn");
    return;
  }

  let copied = 0;
  for (const item of items) {
    if (!item?.filename || !item?.url) continue;
    const key = archivedKey(promptId, item);
    if (localStorage.getItem(key)) continue;
    const allocation = await allocateFilename(directory, plan, item);
    const bytes = await copyOutputToDirectory(directory, item, allocation.filename);
    localStorage.setItem(allocation.counterKey, String(allocation.counter + 1));
    localStorage.setItem(key, JSON.stringify({ filename: allocation.filename, bytes, archivedAt: Date.now() }));
    attachArchiveMetadata(sessionStorage, {
      promptId,
      filename: item.filename,
      subfolder: item.subfolder || subfolderFromOutputUrl(item.url),
      archive: {
        filename: allocation.filename,
        folderLabel: directory.name || plan.projectLabel || plan.folderKey || "",
        archivedAt: Date.now(),
        bytes
      }
    });
    notifySessionOutputsChanged();
    copied += 1;
    setStatus(`Archiviato: ${allocation.filename}`, "ok");
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
            filename: clip.filename,
            subfolder: clip.subfolder || "",
            type: "output"
          })
        }).then(async response => {
          if (response.ok) return;
          const data = await response.json().catch(() => ({}));
          const status = $("outputStatus");
          if (status) {
            status.textContent = data.error || "Impossibile aprire la cartella ComfyUI.";
            status.dataset.state = "error";
          }
        }).catch(() => {});
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
  if ($("outputChooseFolder") && typeof window.showDirectoryPicker !== "function") {
    $("outputChooseFolder").disabled = true;
    setStatus("Scelta cartella non supportata dal browser. Edge/Chromium aggiornato è richiesto.", "warn");
  }

  $("outputChooseFolder")?.addEventListener("click", chooseFolder);
  $("outputScope")?.addEventListener("change", changeScope);
  for (const id of ["outputAuto", "outputScene", "outputVariant", "outputTemplate", "outputCounterScope"]) {
    $(id)?.addEventListener("input", saveSettings);
    $(id)?.addEventListener("change", saveSettings);
  }
  for (const id of ["workflow", "model", "megapixels", "duration", "steps", "seed", "aspect", "projectLabel"]) {
    $(id)?.addEventListener("input", renderPreview);
    $(id)?.addEventListener("change", renderPreview);
  }
  $("project")?.addEventListener("change", () => { setTimeout(loadScope, 0); });

  const observer = new MutationObserver(renderPreview);
  if ($("workflow")) observer.observe($("workflow"), { childList: true, subtree: true });
  if ($("model")) observer.observe($("model"), { childList: true, subtree: true });

  loadScope();
  setTimeout(loadScope, 500);
  bindSessionGallery();
}

bindUi();
