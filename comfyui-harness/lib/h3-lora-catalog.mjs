/**
 * MiniMax H3 production LoRA catalog (v0.15.0).
 * Stable IDs map to allowlisted ComfyUI-relative paths only.
 */

export const H3_LORA_OFF = "off";

export const H3_LORA_LOADER_CLASS = "LoraLoaderModelOnly";

export const H3_LORA_INJECT_NODE_ID = "900001";

export const H3_LORA_STRENGTH_MIN = 0;
export const H3_LORA_STRENGTH_MAX = 1.5;
export const H3_LORA_STRENGTH_STEP = 0.05;

/** Application default when upstream provides no recommendation. */
export const H3_LORA_ACTION_DEFAULT_STRENGTH = 0.5;

const PROFILES = Object.freeze([
  Object.freeze({
    id: H3_LORA_OFF,
    label: "OFF",
    comfyPath: null,
    defaultStrength: null,
    hint: "",
    sha256: null
  }),
  Object.freeze({
    id: "realism-people",
    label: "Realism People",
    comfyPath: "minimax_h3\\production\\h3-realism-people-t2v-i2v-r2v.safetensors",
    defaultStrength: 0.7,
    hint: "Volti, pelle, micro-espressioni · trigger suggerito: r34l1sm",
    sha256: "acc529601d2da117fb81179e76c56e488a3beab1171659d305f04fa3655b787e"
  }),
  Object.freeze({
    id: "spatial-physics",
    label: "Spatial Physics",
    comfyPath: "minimax_h3\\production\\wushu_spatial_physics_clean_3000_pruned.safetensors",
    defaultStrength: 0.3,
    hint: "Collisioni, inerzia, movimento fisico",
    sha256: "7d14f3701560068e7004159c8b2a7278bd2dbfc9e5e3b60d0bc9aef6c049919d"
  }),
  Object.freeze({
    id: "camera-motion",
    label: "Camera Motion",
    comfyPath: "minimax_h3\\production\\camera_motion_h3_lora_v1_3000_pruned.safetensors",
    defaultStrength: 0.8,
    hint: "Movimenti camera",
    sha256: "9d7d98d7377f56efed3aa7d507f767936112d208906f49908ec9a8ae912be88b"
  }),
  Object.freeze({
    id: "action",
    label: "Action",
    comfyPath: "minimax_h3\\production\\wushu_action_h3_lora_v5_3000_pruned.safetensors",
    defaultStrength: H3_LORA_ACTION_DEFAULT_STRENGTH,
    defaultStrengthNote: "application default",
    hint: "Movimento corporeo / azione",
    sha256: "136c16924f7413f0edb1c439f29c1e4c9da13d2cf07117c4e46556691193aa16"
  })
]);

const PROFILE_BY_ID = new Map(PROFILES.map(profile => [profile.id, profile]));

export const H3_LORA_PROFILE_IDS = PROFILES.map(profile => profile.id);

export function listH3LoraProfiles() {
  return PROFILES;
}

export function getH3LoraProfile(loraId) {
  return PROFILE_BY_ID.get(loraId) || null;
}

export function isKnownH3LoraId(loraId) {
  return PROFILE_BY_ID.has(loraId);
}

export function isActiveH3LoraId(loraId) {
  return loraId && loraId !== H3_LORA_OFF;
}

/** Public catalog for /api/config and browser UI (no secret paths beyond ComfyUI-relative names). */
export function publicH3LoraCatalog() {
  return PROFILES.map(profile => ({
    id: profile.id,
    label: profile.label,
    defaultStrength: profile.defaultStrength,
    ...(profile.defaultStrengthNote ? { defaultStrengthNote: profile.defaultStrengthNote } : {}),
    hint: profile.hint,
    sha256: profile.sha256,
    comfyPath: profile.comfyPath
  }));
}

export function presetSupportsH3Lora(preset = {}) {
  return Boolean(preset?.lora?.enabled);
}
