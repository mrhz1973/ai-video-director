/**
 * Issue #74 — reusable non-mutating asset image lightbox.
 * Uses the authoritative /api/view (or other) URL already on the thumbnail.
 * Opening/closing must not change selection, assignment, dirty state, or submit renders.
 */

export const ASSET_LIGHTBOX_ROOT_ID = "assetLightbox";

export function canOpenAssetLightbox({ src = "", available = true } = {}) {
  const url = String(src || "").trim();
  if (!url) return { ok: false, reason: "missing-src" };
  if (available === false) return { ok: false, reason: "unavailable" };
  return { ok: true, src: url };
}

export function assetLightboxSideEffects() {
  return {
    changesSelection: false,
    changesRoleAssignment: false,
    marksProjectDirty: false,
    uploads: false,
    postsPrompt: false,
    postsQueue: false,
    mutatesQueue: false,
    startsGeneration: false
  };
}

function ensureClassList(el) {
  if (el.classList) return el.classList;
  const tokens = new Set(String(el.className || "").split(/\s+/).filter(Boolean));
  el.classList = {
    add(...names) {
      for (const n of names) tokens.add(n);
      el.className = [...tokens].join(" ");
    },
    remove(...names) {
      for (const n of names) tokens.delete(n);
      el.className = [...tokens].join(" ");
    },
    contains(name) {
      return tokens.has(name);
    },
    toggle(name, force) {
      if (force === true) this.add(name);
      else if (force === false) this.remove(name);
      else if (tokens.has(name)) this.remove(name);
      else this.add(name);
    }
  };
  return el.classList;
}

/**
 * @param {{ documentRef?: Document, onFeedback?: (message: string) => void }} [options]
 */
export function createAssetLightboxController({
  documentRef = typeof document !== "undefined" ? document : null,
  onFeedback = null
} = {}) {
  if (!documentRef?.createElement || !documentRef?.body) {
    throw new Error("createAssetLightboxController requires a document with body");
  }

  let root = null;
  let img = null;
  let caption = null;
  let statusEl = null;
  let closeBtn = null;
  let previousFocus = null;
  let openState = false;
  const keyHandler = event => {
    if (!openState) return;
    if (event.key === "Escape" || event.key === "Esc") {
      event.preventDefault?.();
      event.stopPropagation?.();
      close();
    }
  };

  function ensureDom() {
    if (root) return root;
    root = documentRef.getElementById?.(ASSET_LIGHTBOX_ROOT_ID) || null;
    if (!root) {
      root = documentRef.createElement("div");
      root.id = ASSET_LIGHTBOX_ROOT_ID;
      ensureClassList(root).add("asset-lightbox");
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      root.setAttribute("aria-label", "Anteprima asset");
      root.hidden = true;

      const backdrop = documentRef.createElement("button");
      backdrop.type = "button";
      ensureClassList(backdrop).add("asset-lightbox-backdrop");
      backdrop.setAttribute("aria-label", "Chiudi anteprima");
      backdrop.addEventListener("click", () => close());

      const panel = documentRef.createElement("div");
      ensureClassList(panel).add("asset-lightbox-panel");
      panel.addEventListener("click", event => event.stopPropagation?.());

      closeBtn = documentRef.createElement("button");
      closeBtn.type = "button";
      ensureClassList(closeBtn).add("asset-lightbox-close");
      closeBtn.textContent = "Chiudi";
      closeBtn.setAttribute("aria-label", "Chiudi anteprima");
      closeBtn.addEventListener("click", () => close());

      img = documentRef.createElement("img");
      ensureClassList(img).add("asset-lightbox-image");
      img.alt = "";
      img.decoding = "async";
      img.addEventListener("error", () => {
        if (statusEl) statusEl.textContent = "Anteprima non disponibile";
        if (typeof onFeedback === "function") onFeedback("Anteprima non disponibile");
      });
      img.addEventListener("load", () => {
        if (statusEl) statusEl.textContent = "";
      });

      caption = documentRef.createElement("div");
      ensureClassList(caption).add("asset-lightbox-caption");

      statusEl = documentRef.createElement("div");
      ensureClassList(statusEl).add("asset-lightbox-status");
      statusEl.setAttribute("role", "status");

      panel.append(closeBtn, img, caption, statusEl);
      root.append(backdrop, panel);
      documentRef.body.append(root);
    } else {
      img = root.querySelector?.(".asset-lightbox-image") || img;
      caption = root.querySelector?.(".asset-lightbox-caption") || caption;
      statusEl = root.querySelector?.(".asset-lightbox-status") || statusEl;
      closeBtn = root.querySelector?.(".asset-lightbox-close") || closeBtn;
    }
    return root;
  }

  function open({ src = "", alt = "", label = "", available = true } = {}) {
    const gate = canOpenAssetLightbox({ src, available });
    if (!gate.ok) {
      if (typeof onFeedback === "function") {
        onFeedback(gate.reason === "unavailable" ? "Asset non disponibile" : "Anteprima non disponibile");
      }
      return { ok: false, reason: gate.reason, sideEffects: assetLightboxSideEffects() };
    }
    ensureDom();
    previousFocus = documentRef.activeElement || null;
    img.src = gate.src;
    img.alt = alt || label || "Anteprima asset";
    if (caption) caption.textContent = label || alt || "";
    if (statusEl) statusEl.textContent = "";
    root.hidden = false;
    ensureClassList(root).add("is-open");
    openState = true;
    documentRef.addEventListener?.("keydown", keyHandler, true);
    try { closeBtn?.focus?.(); } catch { /* ignore */ }
    return { ok: true, src: gate.src, sideEffects: assetLightboxSideEffects() };
  }

  function close() {
    if (!root || !openState) {
      return { ok: true, closed: false, sideEffects: assetLightboxSideEffects() };
    }
    openState = false;
    root.hidden = true;
    ensureClassList(root).remove("is-open");
    documentRef.removeEventListener?.("keydown", keyHandler, true);
    if (img) {
      img.removeAttribute?.("src");
      img.src = "";
    }
    const focusTarget = previousFocus;
    previousFocus = null;
    try { focusTarget?.focus?.(); } catch { /* ignore */ }
    return { ok: true, closed: true, sideEffects: assetLightboxSideEffects() };
  }

  function isOpen() {
    return openState;
  }

  function bindTrigger(imgEl, options = {}) {
    if (!imgEl) return null;
    ensureClassList(imgEl).add("asset-lightbox-trigger");
    if (imgEl.tabIndex == null || imgEl.tabIndex < 0) imgEl.tabIndex = 0;
    imgEl.setAttribute?.("role", "button");
    imgEl.setAttribute?.("aria-haspopup", "dialog");
    if (imgEl.style && typeof imgEl.style === "object") {
      imgEl.style.cursor = "zoom-in";
    }

    const activate = event => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const src = options.src || imgEl.currentSrc || imgEl.src || "";
      return open({
        src,
        alt: options.alt || imgEl.alt || "",
        label: options.label || imgEl.title || "",
        available: options.available
      });
    };

    imgEl.addEventListener("click", activate);
    imgEl.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        activate(event);
      }
    });
    return { activate, open, close };
  }

  return {
    open,
    close,
    isOpen,
    bindTrigger,
    getRoot: () => root,
    sideEffects: assetLightboxSideEffects
  };
}

let sharedController = null;

export function getSharedAssetLightbox(options = {}) {
  if (!sharedController) {
    sharedController = createAssetLightboxController(options);
  }
  return sharedController;
}

export function resetSharedAssetLightboxForTests() {
  sharedController = null;
}
