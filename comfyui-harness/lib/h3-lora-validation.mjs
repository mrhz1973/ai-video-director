import {
  H3_LORA_OFF,
  H3_LORA_STRENGTH_MIN,
  H3_LORA_STRENGTH_MAX,
  getH3LoraProfile,
  isKnownH3LoraId,
  isActiveH3LoraId,
  presetSupportsH3Lora
} from "./h3-lora-catalog.mjs";

const FORBIDDEN_INPUT_KEYS = ["lora_name", "loraName", "loraPath", "loraFilename"];

export function normalizeLoraId(raw) {
  if (raw == null || raw === "") return H3_LORA_OFF;
  const id = String(raw).trim().toLowerCase();
  if (id === H3_LORA_OFF) return H3_LORA_OFF;
  return id;
}

export function defaultStrengthForProfile(profile) {
  if (!profile || profile.id === H3_LORA_OFF) return null;
  return Number(profile.defaultStrength);
}

export function normalizeLoraStrength(raw, { loraId } = {}) {
  if (!isActiveH3LoraId(loraId)) return null;
  const profile = getH3LoraProfile(loraId);
  if (raw == null || raw === "") return defaultStrengthForProfile(profile);
  const value = Number(raw);
  if (!Number.isFinite(value)) return NaN;
  return value;
}

export function isValidLoraStrength(value) {
  return Number.isFinite(value) && value >= H3_LORA_STRENGTH_MIN && value <= H3_LORA_STRENGTH_MAX;
}

export function assertNoForbiddenLoraFields(input = {}) {
  for (const key of FORBIDDEN_INPUT_KEYS) {
    if (input[key] != null && input[key] !== "") {
      return { ok: false, error: `Campo LoRA non consentito: ${key}` };
    }
  }
  return { ok: true };
}

export function validateLoraSelection(input = {}) {
  const forbidden = assertNoForbiddenLoraFields(input);
  if (!forbidden.ok) return forbidden;

  const rawLoraId = input.loraId;
  const rawStrength = input.loraStrength;
  const preset = input.preset || {};
  const availableComfyPaths = input.availableComfyPaths ?? null;

  const loraId = normalizeLoraId(rawLoraId);
  if (!isKnownH3LoraId(loraId)) {
    return { ok: false, error: `LoRA sconosciuto: ${rawLoraId}` };
  }

  if (!isActiveH3LoraId(loraId)) {
    return { ok: true, selection: { loraId: H3_LORA_OFF, loraStrength: null } };
  }

  if (!presetSupportsH3Lora(preset)) {
    return { ok: false, error: "LoRA non supportato per questo workflow." };
  }

  const profile = getH3LoraProfile(loraId);
  const loraStrength = normalizeLoraStrength(rawStrength, { loraId });
  if (!isValidLoraStrength(loraStrength)) {
    return {
      ok: false,
      error: `Forza LoRA non valida: usa un numero tra ${H3_LORA_STRENGTH_MIN} e ${H3_LORA_STRENGTH_MAX}.`
    };
  }

  if (Array.isArray(availableComfyPaths)) {
    if (!availableComfyPaths.includes(profile.comfyPath)) {
      return {
        ok: false,
        error: `LoRA non disponibile in ComfyUI: ${profile.label}`,
        code: "lora-unavailable"
      };
    }
  }

  return {
    ok: true,
    selection: { loraId, loraStrength, comfyPath: profile.comfyPath }
  };
}

/**
 * Normalize persisted project/batch settings with backward compatibility.
 *
 * Genuinely missing strength on an active profile is omitted (profile default
 * applies only at validation/submit). An explicitly present invalid strength
 * (non-numeric or out-of-range numeric) is preserved so Batch/UI gates can
 * fail closed instead of silently substituting the profile default.
 */
export function normalizePersistedLoraSettings(settings = {}) {
  const loraId = normalizeLoraId(settings.loraId);
  const out = { loraId };
  if (!isActiveH3LoraId(loraId)) return out;

  const raw = settings.loraStrength;
  if (raw == null || raw === "") return out;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    out.loraStrength = numeric;
    return out;
  }
  // Keep non-numeric explicit value distinguishable from absent strength.
  out.loraStrength = typeof raw === "string" ? raw : String(raw);
  return out;
}
