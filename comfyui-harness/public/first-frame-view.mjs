/**
 * Effective first-frame binding for SCENA / BATCH presentation (Issue #59).
 * item.files override wins; otherwise shared source/editor files.
 * Uses library metadata for subfolder + /api/view URL — no folder guessing.
 */
import { resolveBatchItemFiles } from "../lib/batch-draft.mjs";
import { findMemberByFilename } from "../lib/projects.mjs";
import { buildInputViewUrl } from "./asset-url.mjs";
import { getSharedAssetLightbox } from "./asset-lightbox.mjs";

export const FIRST_FRAME_ROLE = "firstImage";

/**
 * @returns {{
 *   filename: string,
 *   subfolder: string,
 *   url: string,
 *   label: string,
 *   available: boolean|null
 * }}
 */
export function resolveEffectiveFirstFrame({
  itemFiles = null,
  sharedFiles = null,
  library = null,
  availability = null,
  roleKey = FIRST_FRAME_ROLE
} = {}) {
  const files = resolveBatchItemFiles(
    itemFiles && typeof itemFiles === "object" ? { files: itemFiles } : {},
    sharedFiles && typeof sharedFiles === "object" ? sharedFiles : {}
  );
  const filename = String(files?.[roleKey] || "").trim();
  if (!filename) {
    return { filename: "", subfolder: "", url: "", label: "", available: null };
  }
  const found = library ? findMemberByFilename(library, filename) : null;
  const subfolder = found?.member?.subfolder ? String(found.member.subfolder) : "";
  const url = buildInputViewUrl({ filename, subfolder, type: "input" });
  let available = null;
  if (availability && typeof availability === "object") {
    const key = subfolder ? `${subfolder}/${filename}` : filename;
    const status = availability[key] ?? availability[filename];
    if (status === "available") available = true;
    else if (status === "missing" || status === "error") available = false;
  }
  return {
    filename,
    subfolder,
    url,
    label: found?.member?.originalName || filename,
    available
  };
}

/** Update SCENA first-frame preview nodes (pure DOM; safe textContent). */
export function applyScenaFirstFrameView(documentRef, binding = {}) {
  const nameEl = documentRef?.getElementById?.("scenaFirstFrameName");
  const thumbHost = documentRef?.getElementById?.("scenaFirstFrameThumb");
  if (!nameEl && !thumbHost) return binding;

  const filename = String(binding.filename || "").trim();
  if (!filename) {
    if (nameEl) nameEl.textContent = "Nessun first frame assegnato — usa Input nell'inspector.";
    if (thumbHost) {
      thumbHost.hidden = true;
      thumbHost.replaceChildren?.();
      thumbHost.textContent = "";
    }
    return binding;
  }

  if (nameEl) nameEl.textContent = filename;
  if (thumbHost) {
    thumbHost.hidden = false;
    thumbHost.replaceChildren?.();
    thumbHost.textContent = "";
    if (binding.url && binding.available !== false) {
      const img = documentRef.createElement("img");
      img.src = binding.url;
      img.alt = filename;
      img.title = binding.label || filename;
      img.decoding = "async";
      img.className = "scena-first-frame-img";
      img.onerror = () => {
        thumbHost.textContent = "?";
      };
      try {
        getSharedAssetLightbox({ documentRef }).bindTrigger(img, {
          src: binding.url,
          alt: filename,
          label: binding.label || filename,
          available: binding.available
        });
      } catch { /* document without body in unit tests */ }
      thumbHost.append(img);
    } else {
      thumbHost.textContent = binding.available === false ? "!" : "?";
    }
  }
  return binding;
}

/** Compact BATCH summary first-frame chip (thumbnail + filename). */
export function appendBatchFirstFrameSummary(documentRef, parent, binding = {}) {
  if (!documentRef || !parent) return null;
  const wrap = documentRef.createElement("span");
  wrap.className = "batch-job-first-frame";
  const filename = String(binding.filename || "").trim();
  if (!filename) {
    wrap.classList.add("empty");
    wrap.textContent = "no first frame";
    parent.append(wrap);
    return wrap;
  }
  if (binding.url && binding.available !== false) {
    const img = documentRef.createElement("img");
    img.className = "batch-job-first-frame-thumb";
    img.src = binding.url;
    img.alt = filename;
    img.title = binding.label || filename;
    img.decoding = "async";
    try {
      getSharedAssetLightbox({ documentRef }).bindTrigger(img, {
        src: binding.url,
        alt: filename,
        label: binding.label || filename,
        available: binding.available
      });
    } catch { /* document without body in unit tests */ }
    wrap.append(img);
  }
  const code = documentRef.createElement("code");
  code.className = "batch-job-first-frame-name";
  code.textContent = filename;
  wrap.append(code);
  parent.append(wrap);
  return wrap;
}
