/**
 * Issue #95 — model select with friendly labels + truthful availability hints.
 */
import { friendlyModelLabel, resolveModelSelection, MODEL_STATUS } from "../lib/h3-model-registry.mjs";
import { setControlHelp } from "./tooltip.mjs";

function createSelectOption() {
  if (typeof document !== "undefined" && document.createElement) {
    return document.createElement("option");
  }
  const attrs = {};
  return {
    value: "",
    textContent: "",
    disabled: false,
    setAttribute(name, value) { attrs[name] = value; },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    removeAttribute(name) { delete attrs[name]; }
  };
}

/**
 * @param {HTMLSelectElement|null} select
 * @param {{ entries?: object[], discoveryOk?: boolean, selectableFilenames?: string[] }} registry
 * @param {{ selected?: string }} [opts]
 */
export function populateModelSelect(select, registry, { selected = "" } = {}) {
  if (!select) return { selected: "", options: [] };
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  const byFile = new Map(entries.map(e => [e.filename, e]));
  const filenames = entries.map(e => e.filename);

  select.replaceChildren();
  const options = [];
  for (const filename of filenames) {
    const entry = byFile.get(filename) || { filename, friendlyLabel: friendlyModelLabel(filename) };
    const opt = createSelectOption();
    opt.value = filename;
    const missing = registry?.discoveryOk && entry.status === MODEL_STATUS.MISSING;
    opt.textContent = missing
      ? `${entry.friendlyLabel} — non installato`
      : entry.friendlyLabel;
    opt.disabled = Boolean(missing);
    if (entry.help) setControlHelp(opt, entry.help);
    else setControlHelp(opt, `Checkpoint: ${filename}`);
    select.append(opt);
    options.push({ filename, label: opt.textContent, disabled: opt.disabled });
  }

  const resolved = resolveModelSelection(registry, {
    savedModel: selected,
    presetDefault: registry?.selectableFilenames?.[0]
      || entries.find(e => e.status !== MODEL_STATUS.MISSING)?.filename
      || filenames[0]
  });
  if (resolved.model && [...select.options].some(o => o.value === resolved.model && !o.disabled)) {
    select.value = resolved.model;
  } else if (select.options.length) {
    const firstEnabled = [...select.options].find(o => !o.disabled);
    select.value = firstEnabled?.value || select.options[0].value;
  }
  return { selected: select.value, options, warning: resolved.warning };
}

/**
 * Update #modelHint helper line next to model select.
 * @param {HTMLElement|null} hint
 * @param {{ entries?: object[], discoveryOk?: boolean }} registry
 * @param {string} selectedFilename
 */
export function refreshModelHint(hint, registry, selectedFilename) {
  if (!hint) return;
  const entry = (registry?.entries || []).find(e => e.filename === selectedFilename);
  if (!entry) {
    hint.textContent = selectedFilename ? `File: ${selectedFilename}` : "";
    hint.hidden = !selectedFilename;
    return;
  }
  const parts = [entry.friendlyLabel];
  if (entry.quantization) parts.push(entry.quantization);
  parts.push(`(${entry.filename})`);
  if (registry?.discoveryOk && entry.status === MODEL_STATUS.MISSING) {
    parts.unshift("Non installato in ComfyUI —");
  }
  hint.textContent = parts.join(" · ");
  hint.hidden = false;
  hint.classList.toggle("h3-state-unavailable", registry?.discoveryOk && entry.status === MODEL_STATUS.MISSING);
  hint.classList.toggle("h3-state-success", registry?.discoveryOk && entry.status === MODEL_STATUS.AVAILABLE);
}
