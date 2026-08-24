/**
 * DOM helpers for CLIP SESSIONE cards.
 * User/file-derived strings are always written via textContent / createTextNode.
 */

import { formatSessionClipSettingsLine } from "./session-outputs.mjs";

function formatClipTime(completedAt) {
  if (!completedAt) return "";
  try {
    return new Date(completedAt).toLocaleTimeString("it-IT", { hour12: false });
  } catch {
    return "";
  }
}

function appendSep(doc, parent) {
  const sep = doc.createElement("span");
  sep.className = "session-clip-sep";
  sep.textContent = "·";
  parent.append(sep);
}

function appendCodeLine(doc, parent, label, codeText) {
  const line = doc.createElement("div");
  line.append(doc.createTextNode(`${label}:`));
  line.append(doc.createElement("br"));
  const code = doc.createElement("code");
  code.textContent = codeText;
  line.append(code);
  parent.append(line);
}

function sourceAttributionLabel(item) {
  if (item.queueEntryId || item.queueBatchName) {
    const name = item.queueBatchName ? ` · ${item.queueBatchName}` : "";
    return `Queue Batch${name}`;
  }
  if (item.source === "batch") return "Batch";
  return "Single";
}

function buildDownloadUrl(item) {
  const params = new URLSearchParams();
  params.set("filename", String(item.filename || ""));
  if (item.subfolder) params.set("subfolder", String(item.subfolder));
  params.set("type", "output");
  return `/api/download-mp4?${params.toString()}`;
}

/**
 * Build one gallery card using only createElement / textContent / append.
 * Trusted output URLs may be assigned to href/src; labels are never parsed as HTML.
 */
export function createSessionClipCard(doc, item, {
  onPreviewError = null,
  onShowInFolder = null
} = {}) {
  const card = doc.createElement("article");
  card.className = `session-clip${item.available === false ? " unavailable" : ""}`;
  if (card.dataset) card.dataset.outputId = item.id;

  const meta = doc.createElement("div");
  meta.className = "session-clip-meta";
  const label = item.jobLabel
    || (item.source === "batch" && item.jobIndex != null ? `Job ${item.jobIndex + 1}` : "Render");
  const strong = doc.createElement("strong");
  strong.textContent = label;
  meta.append(strong);

  appendSep(doc, meta);
  meta.append(doc.createTextNode(sourceAttributionLabel(item)));

  const settings = formatSessionClipSettingsLine(item);
  if (settings) {
    appendSep(doc, meta);
    meta.append(doc.createTextNode(settings));
  }

  const workflow = item.workflowLabel || item.workflowId;
  if (workflow) {
    appendSep(doc, meta);
    meta.append(doc.createTextNode(workflow));
  }
  const when = formatClipTime(item.completedAt);
  if (when) {
    appendSep(doc, meta);
    meta.append(doc.createTextNode(when));
  }

  const paths = doc.createElement("div");
  paths.className = "session-clip-paths";
  const originalCode = item.subfolder
    ? `${item.subfolder} / ${item.filename}`
    : String(item.filename || "");
  appendCodeLine(doc, paths, "Originale ComfyUI", originalCode);
  if (item.archive?.filename) {
    const folder = item.archive.folderLabel ? `${item.archive.folderLabel} / ` : "";
    appendCodeLine(doc, paths, "Copia archivio", `${folder}${item.archive.filename}`);
  } else {
    const archiveStatus = doc.createElement("div");
    archiveStatus.className = "session-clip-archive-status";
    archiveStatus.textContent = "copia archivio non creata · originale ComfyUI disponibile";
    paths.append(archiveStatus);
  }

  const actions = doc.createElement("div");
  actions.className = "session-clip-actions";
  if (item.available === false) {
    const flag = doc.createElement("span");
    flag.className = "session-clip-unavailable-flag";
    flag.textContent = "Non disponibile";
    actions.append(flag);
  } else {
    if (item.url) {
      const open = doc.createElement("a");
      open.href = item.url;
      open.target = "_blank";
      open.rel = "noopener";
      open.textContent = "Apri video";
      actions.append(open);
    }
    const show = doc.createElement("button");
    show.type = "button";
    show.className = "secondary session-clip-show-folder";
    show.textContent = "Mostra nella cartella";
    show.addEventListener("click", () => {
      if (typeof onShowInFolder === "function") onShowInFolder(item);
    });
    actions.append(show);

    const isMp4 = /\.mp4$/i.test(String(item.filename || ""));
    if (isMp4) {
      const download = doc.createElement("a");
      download.href = buildDownloadUrl(item);
      download.textContent = "Scarica MP4";
      download.download = String(item.filename || "clip.mp4");
      download.className = "session-clip-download";
      actions.append(download);
    }
  }

  const nodes = [meta];
  if (item.url && item.available !== false && /\.(mp4|webm|mov)(\?|$)/i.test(item.filename || item.url)) {
    const video = doc.createElement("video");
    video.className = "session-clip-preview";
    video.src = item.url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.controls = true;
    try { video.setAttribute("controlsList", "nodownload"); } catch { /* mock DOM */ }
    video.controlsList = "nodownload";
    if (typeof onPreviewError === "function") {
      video.addEventListener?.("error", () => onPreviewError(item));
    }
    nodes.push(video);
  }
  nodes.push(paths, actions);
  card.append(...nodes);
  return card;
}
