import {
  H3_LORA_OFF,
  H3_LORA_STRENGTH_MIN,
  H3_LORA_STRENGTH_MAX,
  H3_LORA_STRENGTH_STEP,
  listH3LoraProfiles,
  presetSupportsH3Lora
} from "../lib/h3-lora-catalog.mjs";
import { defaultStrengthForProfile, normalizeLoraId } from "../lib/h3-lora-validation.mjs";

let availability = {};
let strengthUserEdited = false;
let lastAppliedProfileId = H3_LORA_OFF;
let batchStrengthUserEdited = false;
let batchLastAppliedProfileId = H3_LORA_OFF;

function $(id) {
  return document.getElementById(id);
}

function activeProfiles() {
  return listH3LoraProfiles();
}

function profileById(id) {
  return activeProfiles().find(profile => profile.id === id) || null;
}

function isKnownSelectValue(id) {
  return activeProfiles().some(profile => profile.id === id);
}

function optionLabel(profile) {
  if (profile.id === H3_LORA_OFF) return profile.label;
  const state = availability[profile.id];
  if (state && state.available === false) return `${profile.label} (non disponibile)`;
  return profile.label;
}

function rebuildSelectOptions(select) {
  if (!select) return;
  const current = normalizeLoraId(select.value);
  select.replaceChildren(
    ...activeProfiles().map(profile => {
      const option = new Option(optionLabel(profile), profile.id);
      if (availability[profile.id]?.available === false && profile.id !== H3_LORA_OFF) {
        option.disabled = true;
      }
      return option;
    })
  );
  if ([...select.options].some(option => option.value === current)) {
    select.value = current;
  } else {
    select.value = H3_LORA_OFF;
  }
}

function setHint(el, text) {
  if (el) el.textContent = text || "";
}

function setStrengthDisabled(field, disabled) {
  if (!field) return;
  field.disabled = disabled;
  field.classList.toggle("inactive", disabled);
}

function rebuildAllSelects() {
  rebuildSelectOptions($("loraId"));
  rebuildSelectOptions($("batchLoraId"));
}

export function setH3LoraAvailability(next = {}) {
  availability = { ...next };
  rebuildAllSelects();
}

export function syncH3LoraFromSettings(settings = {}) {
  const select = $("loraId");
  const strength = $("loraStrength");
  if (!select || !strength) return;

  const loraId = normalizeLoraId(settings.loraId);
  select.value = isKnownSelectValue(loraId) ? loraId : H3_LORA_OFF;
  strengthUserEdited = settings.loraStrength != null && settings.loraStrength !== "";
  if (loraId === H3_LORA_OFF) {
    strength.value = String(defaultStrengthForProfile(profileById("realism-people")) ?? 0.7);
    setStrengthDisabled(strength, true);
    setHint($("loraHint"), "");
    lastAppliedProfileId = H3_LORA_OFF;
    return;
  }
  const profile = profileById(loraId);
  strength.value = String(
    settings.loraStrength != null && settings.loraStrength !== ""
      ? settings.loraStrength
      : defaultStrengthForProfile(profile)
  );
  setStrengthDisabled(strength, false);
  setHint($("loraHint"), profile?.hint || "");
  lastAppliedProfileId = loraId;
}

export function applyH3LoraPresetCapability(preset) {
  const supported = presetSupportsH3Lora(preset);
  const select = $("loraId");
  const strength = $("loraStrength");
  if (!select || !strength) return;

  select.disabled = !supported;
  if (!supported) {
    select.value = H3_LORA_OFF;
    setStrengthDisabled(strength, true);
    setHint($("loraHint"), "LoRA non disponibile per questo workflow.");
    return;
  }

  if (select.value === H3_LORA_OFF) {
    setStrengthDisabled(strength, true);
    setHint($("loraHint"), "");
  } else {
    setStrengthDisabled(strength, false);
    setHint($("loraHint"), profileById(select.value)?.hint || "");
  }
}

export function initH3LoraControls({ onChange } = {}) {
  const select = $("loraId");
  const strength = $("loraStrength");
  if (!select || !strength) return;

  strength.min = String(H3_LORA_STRENGTH_MIN);
  strength.max = String(H3_LORA_STRENGTH_MAX);
  strength.step = String(H3_LORA_STRENGTH_STEP);

  rebuildSelectOptions(select);
  select.value = H3_LORA_OFF;
  setStrengthDisabled(strength, true);
  setHint($("loraHint"), "");

  select.addEventListener("change", () => {
    const loraId = normalizeLoraId(select.value);
    if (loraId === H3_LORA_OFF) {
      setStrengthDisabled(strength, true);
      setHint($("loraHint"), "");
      lastAppliedProfileId = H3_LORA_OFF;
      strengthUserEdited = false;
      onChange?.();
      return;
    }
    setStrengthDisabled(strength, false);
    const profile = profileById(loraId);
    setHint($("loraHint"), profile?.hint || "");
    if (!strengthUserEdited || lastAppliedProfileId !== loraId) {
      strength.value = String(defaultStrengthForProfile(profile));
      strengthUserEdited = false;
    }
    lastAppliedProfileId = loraId;
    onChange?.();
  });

  strength.addEventListener("input", () => {
    strengthUserEdited = true;
    onChange?.();
  });
}

export function readH3LoraFromDom() {
  const loraId = normalizeLoraId($("loraId")?.value);
  if (loraId === H3_LORA_OFF) {
    return { loraId: H3_LORA_OFF };
  }
  return {
    loraId,
    loraStrength: $("loraStrength")?.value
  };
}

export function h3LoraSelectionBlockedReason() {
  const loraId = normalizeLoraId($("loraId")?.value);
  if (loraId === H3_LORA_OFF) return null;
  const state = availability[loraId];
  if (state?.available === false) {
    const profile = profileById(loraId);
    return `LoRA non disponibile in ComfyUI: ${profile?.label || loraId}`;
  }
  return null;
}

/** Sync Batch-owned LoRA controls from prepared Batch source settings. */
export function syncBatchH3LoraFromSettings(settings = {}) {
  const select = $("batchLoraId");
  const strength = $("batchLoraStrength");
  if (!select || !strength) return;

  const loraId = normalizeLoraId(settings.loraId);
  select.value = isKnownSelectValue(loraId) ? loraId : H3_LORA_OFF;
  batchStrengthUserEdited = settings.loraStrength != null && settings.loraStrength !== "";
  if (loraId === H3_LORA_OFF) {
    strength.value = String(defaultStrengthForProfile(profileById("realism-people")) ?? 0.7);
    setStrengthDisabled(strength, true);
    setHint($("batchLoraHint"), "");
    batchLastAppliedProfileId = H3_LORA_OFF;
    return;
  }
  const profile = profileById(loraId);
  strength.value = String(
    settings.loraStrength != null && settings.loraStrength !== ""
      ? settings.loraStrength
      : defaultStrengthForProfile(profile)
  );
  setStrengthDisabled(strength, false);
  setHint($("batchLoraHint"), profile?.hint || "");
  batchLastAppliedProfileId = loraId;
}

/**
 * Enable/disable Batch LoRA controls.
 * @param {{ enabled: boolean, preset?: object }} options
 */
export function applyBatchH3LoraCapability({ enabled, preset } = {}) {
  const select = $("batchLoraId");
  const strength = $("batchLoraStrength");
  if (!select || !strength) return;

  const supported = presetSupportsH3Lora(preset);
  const allow = Boolean(enabled) && supported;
  select.disabled = !allow;

  if (!enabled) {
    setStrengthDisabled(strength, true);
    setHint($("batchLoraHint"), "Prepara un Batch per scegliere LoRA.");
    return;
  }

  if (!supported) {
    select.value = H3_LORA_OFF;
    setStrengthDisabled(strength, true);
    setHint($("batchLoraHint"), "LoRA non disponibile per questo workflow.");
    return;
  }

  if (select.value === H3_LORA_OFF) {
    setStrengthDisabled(strength, true);
    setHint($("batchLoraHint"), "");
  } else {
    setStrengthDisabled(strength, false);
    setHint($("batchLoraHint"), profileById(select.value)?.hint || "");
  }
}

export function initBatchH3LoraControls({ onChange } = {}) {
  const select = $("batchLoraId");
  const strength = $("batchLoraStrength");
  if (!select || !strength) return;

  strength.min = String(H3_LORA_STRENGTH_MIN);
  strength.max = String(H3_LORA_STRENGTH_MAX);
  strength.step = String(H3_LORA_STRENGTH_STEP);

  rebuildSelectOptions(select);
  select.value = H3_LORA_OFF;
  setStrengthDisabled(strength, true);
  setHint($("batchLoraHint"), "Prepara un Batch per scegliere LoRA.");
  select.disabled = true;

  select.addEventListener("change", () => {
    const loraId = normalizeLoraId(select.value);
    if (loraId === H3_LORA_OFF) {
      setStrengthDisabled(strength, true);
      setHint($("batchLoraHint"), "");
      batchLastAppliedProfileId = H3_LORA_OFF;
      batchStrengthUserEdited = false;
      onChange?.();
      return;
    }
    setStrengthDisabled(strength, false);
    const profile = profileById(loraId);
    setHint($("batchLoraHint"), profile?.hint || "");
    if (!batchStrengthUserEdited || batchLastAppliedProfileId !== loraId) {
      strength.value = String(defaultStrengthForProfile(profile));
      batchStrengthUserEdited = false;
    }
    batchLastAppliedProfileId = loraId;
    onChange?.();
  });

  strength.addEventListener("input", () => {
    batchStrengthUserEdited = true;
    onChange?.();
  });
}

export function readBatchH3LoraFromDom() {
  const loraId = normalizeLoraId($("batchLoraId")?.value);
  if (loraId === H3_LORA_OFF) {
    return { loraId: H3_LORA_OFF };
  }
  return {
    loraId,
    loraStrength: $("batchLoraStrength")?.value
  };
}

export function batchH3LoraSelectionBlockedReason(settings = null) {
  const loraId = normalizeLoraId(
    settings && typeof settings === "object"
      ? settings.loraId
      : $("batchLoraId")?.value
  );
  if (loraId === H3_LORA_OFF) return null;
  const state = availability[loraId];
  if (state?.available === false) {
    const profile = profileById(loraId);
    return `LoRA non disponibile in ComfyUI: ${profile?.label || loraId}`;
  }
  return null;
}
