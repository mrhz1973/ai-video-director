/**
 * Effective input bindings for SCENA / BATCH presentation.
 * item.files override wins; otherwise shared source/editor files.
 * Uses library metadata for subfolder + /api/view URL — no folder guessing.
 * Issue #88: multi-slot START/END strip from preset attachments.
 */
import { resolveBatchItemFiles } from "../lib/batch-draft.mjs";
import { findMemberByFilename } from "../lib/projects.mjs";
import { buildInputViewUrl } from "./asset-url.mjs";
import { getSharedAssetLightbox } from "./asset-lightbox.mjs";

export const FIRST_FRAME_ROLE = "firstImage";
export const LAST_FRAME_ROLE = "lastImage";

const SLOT_LABELS = {
  firstImage: "FRAME INIZIO",
  lastImage: "FRAME FINE"
};

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

/** Image attachments from the active preset — never invent T2V slots. */
export function resolveScenaImageSlots(preset = null) {
  const attachments = Array.isArray(preset?.attachments) ? preset.attachments : [];
  return attachments.filter(item => {
    const accept = String(item?.accept || "image/*");
    return accept.includes("image");
  }).map(item => ({
    key: String(item.key || ""),
    label: SLOT_LABELS[item.key] || String(item.label || item.key || "INPUT"),
    accept: String(item.accept || "image/*")
  })).filter(item => item.key);
}

function fillSlot(documentRef, slotEl, binding, slotMeta) {
  if (!slotEl) return;
  const thumbHost = slotEl.querySelector?.(".scena-input-slot-thumb");
  const nameEl = slotEl.querySelector?.(".scena-input-slot-name");
  const titleEl = slotEl.querySelector?.(".scena-input-slot-title");
  if (titleEl) titleEl.textContent = slotMeta.label;
  const filename = String(binding?.filename || "").trim();
  if (!filename) {
    if (nameEl) nameEl.textContent = "Nessuna immagine assegnata — usa Input nell'inspector.";
    if (thumbHost) {
      thumbHost.hidden = true;
      thumbHost.replaceChildren?.();
      thumbHost.textContent = "";
    }
    return;
  }
  if (nameEl) nameEl.textContent = filename;
  if (!thumbHost) return;
  thumbHost.hidden = false;
  thumbHost.replaceChildren?.();
  thumbHost.textContent = "";
  if (binding.url && binding.available !== false) {
    const img = documentRef.createElement("img");
    img.src = binding.url;
    img.alt = filename;
    img.title = binding.label || filename;
    img.decoding = "async";
    img.className = "scena-first-frame-img scena-input-slot-img";
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

/**
 * Render authoritative START/END (or single) image strip for SCENA.
 * Display-only — never mutates assignments.
 */
export function applyScenaInputStrip(documentRef, {
  preset = null,
  sharedFiles = null,
  library = null,
  availability = null
} = {}) {
  const host = documentRef?.getElementById?.("scenaFirstFrame");
  if (!host) return [];

  const slots = resolveScenaImageSlots(preset);
  host.replaceChildren?.();
  host.textContent = "";
  if (!slots.length) {
    host.hidden = true;
    host.setAttribute?.("aria-label", "Nessun input immagine per questo workflow");
    return [];
  }
  host.hidden = false;
  host.className = `scena-first-frame scena-input-strip slots-${slots.length}`;
  host.setAttribute?.("aria-label", "Input immagine Scena");

  const bindings = [];
  slots.forEach((slotMeta, index) => {
    if (index > 0) {
      const arrow = documentRef.createElement("div");
      arrow.className = "scena-input-strip-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "→";
      host.append(arrow);
    }
    const slotEl = documentRef.createElement("div");
    slotEl.className = "scena-input-slot";
    slotEl.dataset.roleKey = slotMeta.key;
    const title = documentRef.createElement("strong");
    title.className = "scena-input-slot-title";
    const thumb = documentRef.createElement("div");
    thumb.className = "scena-input-slot-thumb scena-first-frame-thumb";
    thumb.hidden = true;
    const name = documentRef.createElement("code");
    name.className = "scena-input-slot-name";
    slotEl.append(title, thumb, name);
    host.append(slotEl);
    const binding = resolveEffectiveFirstFrame({
      sharedFiles,
      library,
      availability,
      roleKey: slotMeta.key
    });
    bindings.push({ ...binding, key: slotMeta.key, slotLabel: slotMeta.label });
    fillSlot(documentRef, slotEl, binding, slotMeta);
  });
  return bindings;
}

/** @deprecated Prefer applyScenaInputStrip; kept for older tests that only pass first binding. */
export function applyScenaFirstFrameView(documentRef, binding = {}) {
  // Prefer legacy name/thumb nodes when present (unit mocks + old markup).
  const nameEl = documentRef?.getElementById?.("scenaFirstFrameName");
  const thumbHost = documentRef?.getElementById?.("scenaFirstFrameThumb");
  if (nameEl || thumbHost) {
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
        } catch { /* ignore */ }
        thumbHost.append(img);
      } else {
        thumbHost.textContent = binding.available === false ? "!" : "?";
      }
    }
    return binding;
  }
  applyScenaInputStrip(documentRef, {
    preset: { attachments: [{ key: FIRST_FRAME_ROLE, label: "Primo frame", accept: "image/*" }] },
    sharedFiles: binding.filename ? { [FIRST_FRAME_ROLE]: binding.filename } : {},
    library: null,
    availability: binding.available === false
      ? { [binding.filename]: "missing" }
      : binding.available === true
        ? { [binding.filename]: "available" }
        : null
  });
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
