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

/**
 * Build one gallery card using only createElement / textContent / append.
 * Trusted output URLs may be assigned to href/src; labels are never parsed as HTML.
 */
export function createSessionClipCard(doc, item, {
  onPreviewError = null
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
  }

  const actions = doc.createElement("div");
  actions.className = "session-clip-actions";
  if (item.available === false) {
    const flag = doc.createElement("span");
    flag.className = "session-clip-unavailable-flag";
    flag.textContent = "Non disponibile";
    actions.append(flag);
  } else if (item.url) {
    const link = doc.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Apri video";
    actions.append(link);
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
    if (typeof onPreviewError === "function") {
      video.addEventListener?.("error", () => onPreviewError(item));
    }
    nodes.push(video);
  }
  nodes.push(paths, actions);
  card.append(...nodes);
  return card;
}
