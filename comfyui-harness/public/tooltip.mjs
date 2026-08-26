/**
 * Issue #88 — reusable accessible tooltip system.
 * Use data-help (or setControlHelp) — not ad-hoc title-only strings.
 */
export const HELP_ATTR = "data-help";
export const HELP_DISABLED_ATTR = "data-help-disabled";
export const TOOLTIP_ID = "h3OperatorTooltip";
export const SHOW_DELAY_MS = 320;
export const HIDE_DELAY_MS = 80;

export function setControlHelp(el, text, { whenDisabled = "" } = {}) {
  if (!el) return el;
  const help = String(text || "").trim();
  if (!help) {
    el.removeAttribute?.(HELP_ATTR);
  } else {
    el.setAttribute?.(HELP_ATTR, help);
  }
  const disabledHelp = String(whenDisabled || "").trim();
  if (disabledHelp) el.setAttribute?.(HELP_DISABLED_ATTR, disabledHelp);
  else el.removeAttribute?.(HELP_DISABLED_ATTR);
  return el;
}

export function readControlHelp(el) {
  if (!el) return "";
  const disabled = el.disabled === true || el.getAttribute?.("aria-disabled") === "true";
  if (disabled) {
    const reason = String(el.getAttribute?.(HELP_DISABLED_ATTR) || "").trim();
    if (reason) return reason;
  }
  return String(el.getAttribute?.(HELP_ATTR) || "").trim();
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

export function positionTooltip(tip, anchor, viewport = { width: 1280, height: 720 }) {
  if (!tip || !anchor) return { top: 0, left: 0, placement: "below" };
  const rect = typeof anchor.getBoundingClientRect === "function"
    ? anchor.getBoundingClientRect()
    : { top: 0, left: 0, right: 40, bottom: 24, width: 40, height: 24 };
  const tipWidth = tip.offsetWidth || 220;
  const tipHeight = tip.offsetHeight || 48;
  const gap = 8;
  const vw = Number(viewport.width) || 1280;
  const vh = Number(viewport.height) || 720;
  let placement = "below";
  let top = rect.bottom + gap;
  if (top + tipHeight > vh - 8 && rect.top - tipHeight - gap > 8) {
    placement = "above";
    top = rect.top - tipHeight - gap;
  }
  let left = rect.left + (rect.width / 2) - (tipWidth / 2);
  left = Math.max(8, Math.min(left, vw - tipWidth - 8));
  top = Math.max(8, Math.min(top, vh - tipHeight - 8));
  return { top: Math.round(top), left: Math.round(left), placement };
}

/**
 * @param {{ documentRef?: Document, windowRef?: Window }} [options]
 */
export function createTooltipController({
  documentRef = typeof document !== "undefined" ? document : null,
  windowRef = typeof window !== "undefined" ? window : null
} = {}) {
  if (!documentRef?.createElement || !documentRef?.body) {
    throw new Error("createTooltipController requires a document with body");
  }

  let tip = null;
  let showTimer = null;
  let hideTimer = null;
  let activeEl = null;
  let describedBackup = null;

  function ensureTip() {
    if (tip) return tip;
    tip = documentRef.getElementById?.(TOOLTIP_ID) || null;
    if (!tip) {
      tip = documentRef.createElement("div");
      tip.id = TOOLTIP_ID;
      tip.setAttribute("role", "tooltip");
      tip.hidden = true;
      ensureClassList(tip).add("h3-tooltip");
      documentRef.body.append(tip);
    }
    return tip;
  }

  function clearTimers() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function hide() {
    clearTimers();
    const node = ensureTip();
    node.hidden = true;
    ensureClassList(node).remove("is-visible");
    if (activeEl && describedBackup !== undefined) {
      if (describedBackup == null) activeEl.removeAttribute?.("aria-describedby");
      else activeEl.setAttribute?.("aria-describedby", describedBackup);
    }
    activeEl = null;
    describedBackup = null;
  }

  function show(el) {
    const text = readControlHelp(el);
    if (!text) {
      hide();
      return;
    }
    clearTimers();
    const node = ensureTip();
    node.textContent = text;
    node.hidden = false;
    ensureClassList(node).add("is-visible");
    const viewport = {
      width: windowRef?.innerWidth || documentRef.documentElement?.clientWidth || 1280,
      height: windowRef?.innerHeight || documentRef.documentElement?.clientHeight || 720
    };
    const pos = positionTooltip(node, el, viewport);
    node.style.top = `${pos.top}px`;
    node.style.left = `${pos.left}px`;
    node.dataset.placement = pos.placement;
    if (activeEl && activeEl !== el && describedBackup !== undefined) {
      if (describedBackup == null) activeEl.removeAttribute?.("aria-describedby");
      else activeEl.setAttribute?.("aria-describedby", describedBackup);
    }
    activeEl = el;
    describedBackup = el.getAttribute?.("aria-describedby");
    const ids = new Set(String(describedBackup || "").split(/\s+/).filter(Boolean));
    ids.add(TOOLTIP_ID);
    el.setAttribute?.("aria-describedby", [...ids].join(" "));
  }

  function scheduleShow(el) {
    clearTimers();
    showTimer = setTimeout(() => show(el), SHOW_DELAY_MS);
  }

  function scheduleHide() {
    clearTimers();
    hideTimer = setTimeout(() => hide(), HIDE_DELAY_MS);
  }

  function findHelpTarget(from) {
    let node = from;
    while (node && node !== documentRef.body) {
      if (node.getAttribute?.(HELP_ATTR) || node.getAttribute?.(HELP_DISABLED_ATTR)) return node;
      // Disabled buttons may sit inside a wrapper with help.
      if (node.getAttribute?.("data-help-wrap") === "1") return node;
      node = node.parentElement || node.parentNode;
    }
    return null;
  }

  function onPointerOver(event) {
    const target = findHelpTarget(event.target);
    if (!target) return;
    scheduleShow(target);
  }

  function onPointerOut(event) {
    const target = findHelpTarget(event.target);
    if (!target) return;
    const related = event.relatedTarget;
    if (related && (target.contains?.(related) || tip?.contains?.(related))) return;
    scheduleHide();
  }

  function onFocusIn(event) {
    const target = findHelpTarget(event.target);
    if (!target) return;
    scheduleShow(target);
  }

  function onFocusOut() {
    scheduleHide();
  }

  function onKeyDown(event) {
    if (event.key === "Escape" || event.key === "Esc") hide();
  }

  function bind() {
    ensureTip();
    documentRef.addEventListener?.("pointerover", onPointerOver, true);
    documentRef.addEventListener?.("pointerout", onPointerOut, true);
    documentRef.addEventListener?.("focusin", onFocusIn, true);
    documentRef.addEventListener?.("focusout", onFocusOut, true);
    documentRef.addEventListener?.("keydown", onKeyDown, true);
    tip?.addEventListener?.("pointerenter", () => clearTimers());
    tip?.addEventListener?.("pointerleave", () => scheduleHide());
  }

  function wrapDisabledHelp(control, helpText) {
    return wrapDisabledHelpForControl(documentRef, control, helpText);
  }

  bind();
  return {
    show,
    hide,
    scheduleShow,
    setControlHelp,
    readControlHelp,
    wrapDisabledHelp,
    getTip: () => tip,
    findHelpTarget
  };
}

/**
 * Idempotent disabled-help wrapper: reuse existing [data-help-wrap="1"] parent
 * instead of nesting another focusable stop.
 */
export function wrapDisabledHelpForControl(documentRef, control, helpText) {
  if (!control || !helpText) return control;
  const help = String(helpText || "").trim();
  if (!help) return control;

  const parent = control.parentNode;
  if (parent?.getAttribute?.("data-help-wrap") === "1") {
    setControlHelp(parent, help);
    if (parent.tabIndex == null || Number(parent.tabIndex) < 0) parent.tabIndex = 0;
    setControlHelp(control, help, { whenDisabled: help });
    return parent;
  }

  const ancestor = typeof control.closest === "function"
    ? control.closest("[data-help-wrap='1']")
    : null;
  if (ancestor) {
    setControlHelp(ancestor, help);
    if (ancestor.tabIndex == null || Number(ancestor.tabIndex) < 0) ancestor.tabIndex = 0;
    setControlHelp(control, help, { whenDisabled: help });
    return ancestor;
  }

  if (!parent) {
    setControlHelp(control, help, { whenDisabled: help });
    return control;
  }

  if (!documentRef?.createElement) {
    setControlHelp(control, help, { whenDisabled: help });
    return control;
  }

  if (typeof parent.insertBefore !== "function") {
    setControlHelp(control, help, { whenDisabled: help });
    return control;
  }

  const wrap = documentRef.createElement("span");
  wrap.className = "h3-help-wrap";
  wrap.setAttribute("data-help-wrap", "1");
  setControlHelp(wrap, help);
  wrap.tabIndex = 0;
  parent.insertBefore(wrap, control);
  if (typeof wrap.append === "function") wrap.append(control);
  else if (typeof wrap.appendChild === "function") wrap.appendChild(control);
  setControlHelp(control, help, { whenDisabled: help });
  return wrap;
}

let shared = null;

export function getSharedTooltipController(options = {}) {
  if (!shared) shared = createTooltipController(options);
  return shared;
}

export function resetSharedTooltipControllerForTests() {
  shared = null;
}

export function initTooltipSystem(options = {}) {
  return getSharedTooltipController(options);
}
