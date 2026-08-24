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

function $(id) {
  return document.getElementById(id);
}

function activeProfiles() {
  return listH3LoraProfiles();
}

function profileById(id) {
  return activeProfiles().find(profile => profile.id === id) || null;
}

function setHint(text) {
  const hint = $("loraHint");
  if (hint) hint.textContent = text || "";
}

function setStrengthDisabled(disabled) {
  const field = $("loraStrength");
  if (!field) return;
  field.disabled = disabled;
  field.classList.toggle("inactive", disabled);
}

function optionLabel(profile) {
  if (profile.id === H3_LORA_OFF) return profile.label;
  const state = availability[profile.id];
  if (state && state.available === false) return `${profile.label} (non disponibile)`;
  return profile.label;
}

function rebuildSelectOptions() {
  const select = $("loraId");
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

export function setH3LoraAvailability(next = {}) {
  availability = { ...next };
  rebuildSelectOptions();
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
    setStrengthDisabled(true);
    setHint("");
    lastAppliedProfileId = H3_LORA_OFF;
    return;
  }
  const profile = profileById(loraId);
  strength.value = String(
    settings.loraStrength != null && settings.loraStrength !== ""
      ? settings.loraStrength
      : defaultStrengthForProfile(profile)
  );
  setStrengthDisabled(false);
  setHint(profile?.hint || "");
  lastAppliedProfileId = loraId;
}

function isKnownSelectValue(id) {
  return activeProfiles().some(profile => profile.id === id);
}

export function applyH3LoraPresetCapability(preset) {
  const supported = presetSupportsH3Lora(preset);
  const select = $("loraId");
  const strength = $("loraStrength");
  if (!select || !strength) return;

  select.disabled = !supported;
  if (!supported) {
    select.value = H3_LORA_OFF;
    setStrengthDisabled(true);
    setHint("LoRA non disponibile per questo workflow.");
    return;
  }

  if (select.value === H3_LORA_OFF) {
    setStrengthDisabled(true);
    setHint("");
  } else {
    setStrengthDisabled(false);
    setHint(profileById(select.value)?.hint || "");
  }
}

export function initH3LoraControls({ onChange } = {}) {
  const select = $("loraId");
  const strength = $("loraStrength");
  if (!select || !strength) return;

  strength.min = String(H3_LORA_STRENGTH_MIN);
  strength.max = String(H3_LORA_STRENGTH_MAX);
  strength.step = String(H3_LORA_STRENGTH_STEP);

  rebuildSelectOptions();
  select.value = H3_LORA_OFF;
  setStrengthDisabled(true);
  setHint("");

  select.addEventListener("change", () => {
    const loraId = normalizeLoraId(select.value);
    if (loraId === H3_LORA_OFF) {
      setStrengthDisabled(true);
      setHint("");
      lastAppliedProfileId = H3_LORA_OFF;
      strengthUserEdited = false;
      onChange?.();
      return;
    }
    setStrengthDisabled(false);
    const profile = profileById(loraId);
    setHint(profile?.hint || "");
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
