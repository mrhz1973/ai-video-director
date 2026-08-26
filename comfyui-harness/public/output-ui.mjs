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
  attachCloudMirrorMetadata,
  clearSessionOutputs,
  markSessionOutputUnavailable,
  notifySessionOutputsChanged,
  readSessionOutputs,
  sessionGalleryClearSideEffects,
  subfolderFromOutputUrl
} from "./session-outputs.mjs";
import {
  resolvePostCompletionCopyPlan,
  shouldCloudFallbackAfterArchiveFailure
} from "./output-copy-orchestration.mjs";
import { CONTROL_HELP, syncOperatorHelpState } from "./control-help.mjs";
import {
  collectWorkflowFilterOptions,
  persistOutputViewPrefs,
  prepareSessionClipsView,
  readOutputViewPrefs
} from "./output-view.mjs";

const $ = id => document.getElementById(id);
const SETTINGS_PREFIX = "h3OutputSettings:v1:";
const SCOPE_PREF_PREFIX = "h3OutputScopePreference:v1:";
const PLAN_PREFIX = "h3OutputPlan:v1:";
const ARCHIVED_PREFIX = "h3OutputArchived:v1:";
const originalFetch = window.fetch.bind(window);

/** Keep tooltip disabled-help wrapping in sync when Output toggles folder buttons. */
function syncFolderOpenHelp(btn, kind) {
  if (!btn) return;
  if (kind === "cloud") {
    syncOperatorHelpState(btn, {
      enabledHelp: CONTROL_HELP.cloudMirrorOpenFolder,
      disabledReason: CONTROL_HELP.cloudMirrorOpenFolderDisabled
    });
  } else {
    syncOperatorHelpState(btn, {
      enabledHelp: CONTROL_HELP.outputOpenFolder,
      disabledReason: CONTROL_HELP.outputOpenFolderDisabled
    });
  }
}
let archiveChain = Promise.resolve();
let activeSettings = null;
let activeFolderKey = "global";
let archiveDestination = {
  configured: false,
  absolutePath: null,
  folderLabel: null
};
let cloudMirrorState = {
  enabled: false,
  enabledInherited: false,
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

function setCloudMirrorStatus(message, kind = "neutral") {
  const node = $("cloudMirrorStatus");
  if (!node) return;
  node.textContent = message;
  node.dataset.kind = kind;
}

async function refreshCloudMirrorConfig() {
  const label = $("cloudMirrorFolderName");
  const openBtn = $("cloudMirrorOpenFolder");
  const auto = $("cloudMirrorAuto");
  try {
    const response = await originalFetch(`/api/cloud-mirror/config?folderKey=${encodeURIComponent(activeFolderKey)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Cloud mirror config failed");
    cloudMirrorState = {
      enabled: Boolean(data.enabled),
      enabledInherited: Boolean(data.enabledInherited),
      configured: Boolean(data.configured),
      absolutePath: data.absolutePath || null,
      folderLabel: data.folderLabel || null
    };
    if (auto) auto.checked = cloudMirrorState.enabled;
    if (label) {
      label.textContent = cloudMirrorState.configured
        ? (cloudMirrorState.absolutePath || cloudMirrorState.folderLabel || "Cartella configurata")
        : "Nessuna cartella scelta";
    }
    if (openBtn) {
      openBtn.disabled = !cloudMirrorState.configured;
      syncFolderOpenHelp(openBtn, "cloud");
    }
    if (!cloudMirrorState.enabled) {
      setCloudMirrorStatus("Disattivato. Nessuna copia automatica nella cartella cloud.", "neutral");
    } else if (!cloudMirrorState.configured) {
      setCloudMirrorStatus(
        cloudMirrorState.enabledInherited
          ? "Attivo (ereditato dalla configurazione globale) ma senza cartella: scegli una cartella Google Drive / sync."
          : "Attivo ma senza cartella: scegli una cartella Google Drive / sync.",
        "warn"
      );
    } else if (cloudMirrorState.enabledInherited) {
      setCloudMirrorStatus("Attivo (ereditato dalla configurazione globale). Copia secondaria nella cartella sync.", "ok");
    } else {
      setCloudMirrorStatus("Pronto. Copia secondaria nella cartella sync (non conferma upload remoto).", "ok");
    }
  } catch {
    cloudMirrorState = {
      enabled: false,
      enabledInherited: false,
      configured: false,
      absolutePath: null,
      folderLabel: null
    };
    if (label) label.textContent = "Cartella non disponibile";
    if (openBtn) {
      openBtn.disabled = true;
      syncFolderOpenHelp(openBtn, "cloud");
    }
    setCloudMirrorStatus("Impossibile leggere la configurazione cloud mirror.", "warn");
  }
}

async function chooseCloudMirrorFolder() {
  setCloudMirrorStatus("Apertura selettore cartella…");
  try {
    const response = await originalFetch("/api/cloud-mirror/pick-folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderKey: activeFolderKey })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409 && (data.code === "archive-pick-cancelled" || data.code === "cloud-pick-cancelled")) {
      setCloudMirrorStatus("Scelta cartella annullata.");
      return;
    }
    if (!response.ok) {
      setCloudMirrorStatus(data.error || "Errore scelta cartella", "error");
      return;
    }
    await refreshCloudMirrorConfig();
    setCloudMirrorStatus("Cartella cloud configurata sul Director.", "ok");
  } catch (error) {
    setCloudMirrorStatus(`Errore cartella: ${error?.message || error}`, "error");
  }
}

async function openCloudMirrorFolder() {
  try {
    const response = await originalFetch("/api/cloud-mirror/open-folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderKey: activeFolderKey })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setCloudMirrorStatus(data.error || "Impossibile aprire la cartella cloud.", "error");
    }
  } catch (error) {
    setCloudMirrorStatus(`Errore apertura cartella: ${error?.message || error}`, "error");
  }
}

async function persistCloudMirrorEnabled() {
  const enabled = Boolean($("cloudMirrorAuto")?.checked);
  try {
    const response = await originalFetch("/api/cloud-mirror/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderKey: activeFolderKey, enabled })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setCloudMirrorStatus(data.error || "Salvataggio impostazioni fallito", "error");
      return;
    }
    await refreshCloudMirrorConfig();
  } catch (error) {
    setCloudMirrorStatus(`Errore impostazioni: ${error?.message || error}`, "error");
  }
}

function cloudStatusLabel(status) {
  switch (status) {
    case "copied": return "Cloud: copiato nella cartella";
    case "already-copied": return "Cloud: già copiato";
    case "failed": return "Cloud: errore";
    case "disabled": return "Cloud: disattivato";
    case "not-configured": return "Cloud: non configurato";
    case "pending": return "Cloud: in attesa";
    case "copying": return "Cloud: copia…";
    default: return status ? `Cloud: ${status}` : "Cloud: —";
  }
}

async function mirrorOneOutput(promptId, item, { auto = true } = {}) {
  const plan = readPromptPlan(promptId) || {};
  const response = await originalFetch("/api/cloud-mirror/copy-output", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      auto,
      promptId,
      filename: item.filename,
      subfolder: item.subfolder || subfolderFromOutputUrl(item.url) || "",
      type: "output",
      folderKey: plan.folderKey || activeFolderKey,
      archiveFolderKey: plan.folderKey || activeFolderKey,
      projectId: plan.projectId || projectId(),
      projectLabel: plan.projectLabel || projectLabel()
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && !auto) {
    return { ok: false, status: "failed", error: data.error || response.status, code: data.code };
  }
  return data;
}

async function mirrorOutputs(promptId, items = [], { auto = true } = {}) {
  if (!Array.isArray(items) || !items.length) return;
  for (const item of items) {
    if (!item?.filename) continue;
    const data = await mirrorOneOutput(promptId, item, { auto });
    if (data?.skipped) continue;
    if (data?.destinationFilename || data?.alreadyCopied || data?.status === "copied" || data?.status === "already-copied") {
      attachCloudMirrorMetadata(sessionStorage, {
        promptId,
        filename: item.filename,
        subfolder: item.subfolder || subfolderFromOutputUrl(item.url),
        cloudMirror: {
          status: data.alreadyCopied ? "already-copied" : (data.status || "copied"),
          filename: data.destinationFilename || null,
          folderLabel: data.folderLabel || cloudMirrorState.folderLabel || "Cartella cloud",
          copiedAt: Date.now(),
          bytes: data.bytes
        }
      });
      notifySessionOutputsChanged();
      if (!auto) {
        setCloudMirrorStatus(
          data.alreadyCopied
            ? `Già copiato nella cartella cloud: ${data.destinationFilename}`
            : `Copiato nella cartella cloud: ${data.destinationFilename}`,
          "ok"
        );
      }
    } else if (data?.status === "failed" || data?.ok === false) {
      attachCloudMirrorMetadata(sessionStorage, {
        promptId,
        filename: item.filename,
        subfolder: item.subfolder || subfolderFromOutputUrl(item.url),
        cloudMirror: {
          status: "failed",
          error: data.error || data.code || "failed",
          copiedAt: Date.now()
        }
      });
      notifySessionOutputsChanged();
      if (!auto) {
        setCloudMirrorStatus(data.error || "Cloud non disponibile", "error");
      }
    }
  }
}

function schedulePostCompletionCopies(promptId, items) {
  archiveChain = archiveChain
    .then(async () => {
      const plan = readPromptPlan(promptId);
      const policy = resolvePostCompletionCopyPlan(plan);
      if (policy.runArchive) {
        const archiveResult = await archiveOutputs(promptId, items);
        if (shouldCloudFallbackAfterArchiveFailure(archiveResult)) {
          await mirrorOutputs(promptId, items, { auto: true });
        }
        return;
      }
      if (policy.runIndependentCloudAuto) {
        await mirrorOutputs(promptId, items, { auto: true });
      }
    })
    .catch(error => {
      console.error("H3 output archive/cloud orchestration failed", error);
      setStatus(
        `Archiviazione/copia non riuscita: ${error?.message || error}. L'output originale ComfyUI resta intatto.`,
        "error"
      );
    });
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
    if (openBtn) {
      openBtn.disabled = !archiveDestination.configured;
      syncFolderOpenHelp(openBtn, "archive");
    }
    if (archiveDestination.configured) {
      setStatus("Archivio locale Director pronto. I render completati verranno copiati qui.", "ok");
    } else {
      setStatus("Scegli una cartella: ComfyUI continuerà comunque a conservare l'output originale.");
    }
  } catch {
    archiveDestination = { configured: false, absolutePath: null, folderLabel: null };
    if (label) label.textContent = "Cartella non disponibile";
    if (openBtn) {
      openBtn.disabled = true;
      syncFolderOpenHelp(openBtn, "archive");
    }
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
    if ($("outputOpenFolder")) {
      $("outputOpenFolder").disabled = !archiveDestination.configured;
      syncFolderOpenHelp($("outputOpenFolder"), "archive");
    }
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
  await refreshCloudMirrorConfig();
}

async function changeScope() {
  const scope = selectedScope();
  try { localStorage.setItem(scopePreferenceKey(), scope); } catch { /* ignore */ }
  activeFolderKey = folderKeyForScope(scope);
  applySettingsToUi(readStoredSettings(activeFolderKey));
  await refreshFolderLabel();
  await refreshCloudMirrorConfig();
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
  if (!plan?.enabled || !Array.isArray(items) || !items.length) {
    return { archiveRan: false, archiveOk: false, reason: "archive-off" };
  }

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
      return { archiveRan: true, archiveOk: false, reason: "archive-unconfigured", copied };
    }
    if (response.status === 409 && data.code === "archive-unavailable") {
      setStatus("Render completato; cartella archivio non disponibile. L'originale ComfyUI resta intatto.", "warn");
      return { archiveRan: true, archiveOk: false, reason: "archive-unavailable", copied };
    }
    if (!response.ok) {
      setStatus(
        `Archiviazione non riuscita: ${data.error || response.status}. L'output originale ComfyUI resta intatto.`,
        "error"
      );
      return { archiveRan: true, archiveOk: false, reason: "archive-failed", copied };
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
      if (data.cloudMirror) {
        const cm = data.cloudMirror;
        if (cm.status === "copied" || cm.status === "already-copied" || cm.destinationFilename) {
          attachCloudMirrorMetadata(sessionStorage, {
            promptId,
            filename: item.filename,
            subfolder: item.subfolder || subfolderFromOutputUrl(item.url),
            cloudMirror: {
              status: cm.alreadyCopied ? "already-copied" : (cm.status || "copied"),
              filename: cm.destinationFilename || null,
              folderLabel: cm.folderLabel || cloudMirrorState.folderLabel || "Cartella cloud",
              copiedAt: Date.now(),
              bytes: cm.bytes
            }
          });
          notifySessionOutputsChanged();
        } else if (cm.status === "failed") {
          setCloudMirrorStatus(
            `Archivio ok; copia cloud non riuscita: ${cm.error || cm.code || "errore"}.`,
            "warn"
          );
        }
      }
    }
  }
  if (copied) renderPreview();
  return { archiveRan: true, archiveOk: true, copied };
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
      response.clone().json().then(items => {
        schedulePostCompletionCopies(promptId, items);
      }).catch(() => {});
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
  let prefs = readOutputViewPrefs(localStorage);
  syncOutputViewControls(prefs, items);
  prefs = readOutputViewPrefs(localStorage);
  const view = prepareSessionClipsView(items, prefs);
  title.textContent = `CLIP SESSIONE · ${items.length}`;
  list.replaceChildren();
  list.dataset.viewMode = view.prefs.mode;
  list.classList.toggle("session-gallery-list-mode", view.prefs.mode === "list");
  empty.hidden = items.length > 0 && !view.empty;
  if (items.length && view.empty) {
    empty.hidden = false;
    empty.textContent = "Nessuna clip corrisponde ai filtri selezionati.";
  } else if (!items.length) {
    empty.textContent = "Nessuna clip generata in questa sessione.";
  }

  const cardOpts = {
    viewMode: view.prefs.mode,
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
    },
    onCloudMirrorCopy: clip => {
      void mirrorOutputs(clip.promptId, [{
        filename: clip.filename,
        subfolder: clip.subfolder,
        url: clip.url
      }], { auto: false });
    }
  };

  for (const group of view.groups) {
    if (view.prefs.groupBy !== "none" && group.items.length) {
      const heading = document.createElement("h4");
      heading.className = "session-gallery-group-heading";
      heading.textContent = `${group.label} · ${group.items.length}`;
      list.append(heading);
    }
    for (const item of group.items) {
      list.append(createSessionClipCard(document, item, cardOpts));
    }
  }
}

function syncOutputViewControls(prefs, items = []) {
  const mode = prefs?.mode || "gallery";
  for (const btn of document.querySelectorAll?.("[data-output-view-mode]") || []) {
    const active = btn.getAttribute("data-output-view-mode") === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
  const groupBy = $("outputGroupBy");
  const orderBy = $("outputOrderBy");
  const sourceFilter = $("outputSourceFilter");
  const workflowFilter = $("outputWorkflowFilter");
  if (groupBy && groupBy.value !== prefs.groupBy) groupBy.value = prefs.groupBy;
  if (orderBy && orderBy.value !== prefs.orderBy) orderBy.value = prefs.orderBy;
  if (sourceFilter && sourceFilter.value !== prefs.sourceFilter) sourceFilter.value = prefs.sourceFilter || "";
  if (workflowFilter) {
    const current = prefs.workflowFilter || "";
    const options = collectWorkflowFilterOptions(items);
    workflowFilter.replaceChildren(new Option("Tutti", ""));
    for (const opt of options) {
      workflowFilter.append(new Option(opt.label, opt.value));
    }
    const nextValue = options.some(o => o.value === current) ? current : "";
    workflowFilter.value = nextValue;
    if (nextValue !== current) {
      persistOutputViewPrefs({ ...prefs, workflowFilter: nextValue }, localStorage);
    }
  }
}

function readPrefsFromControls() {
  const current = readOutputViewPrefs(localStorage);
  return persistOutputViewPrefs({
    mode: document.querySelector?.("[data-output-view-mode].active")?.getAttribute("data-output-view-mode")
      || current.mode,
    groupBy: $("outputGroupBy")?.value || current.groupBy,
    orderBy: $("outputOrderBy")?.value || current.orderBy,
    workflowFilter: $("outputWorkflowFilter")?.value || "",
    sourceFilter: $("outputSourceFilter")?.value || ""
  }, localStorage);
}

function bindSessionGallery() {
  if (!$("sessionGallerySection")) return;
  applySessionGalleryReconstruction(sessionStorage, localStorage);
  syncOutputViewControls(readOutputViewPrefs(localStorage), readSessionOutputs(sessionStorage));
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

  const toolbar = $("sessionGalleryToolbar");
  if (toolbar && !toolbar.dataset.bound) {
    toolbar.dataset.bound = "1";
    toolbar.addEventListener("click", event => {
      const btn = event.target?.closest?.("[data-output-view-mode]");
      if (!btn || !toolbar.contains(btn)) return;
      persistOutputViewPrefs({
        ...readOutputViewPrefs(localStorage),
        mode: btn.getAttribute("data-output-view-mode")
      }, localStorage);
      renderSessionGallery();
    });
    for (const id of ["outputGroupBy", "outputOrderBy", "outputWorkflowFilter", "outputSourceFilter"]) {
      $(id)?.addEventListener("change", () => {
        readPrefsFromControls();
        renderSessionGallery();
      });
    }
  }
}

function bindUi() {
  if (!$("outputSection") && !$("sessionGallerySection")) return;

  $("outputChooseFolder")?.addEventListener("click", () => { void chooseFolder(); });
  $("outputOpenFolder")?.addEventListener("click", () => { void openConfiguredFolder(); });
  $("cloudMirrorChooseFolder")?.addEventListener("click", () => { void chooseCloudMirrorFolder(); });
  $("cloudMirrorOpenFolder")?.addEventListener("click", () => { void openCloudMirrorFolder(); });
  $("cloudMirrorAuto")?.addEventListener("change", () => { void persistCloudMirrorEnabled(); });
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
