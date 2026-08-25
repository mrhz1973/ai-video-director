/**
 * Batch-owned global LoRA freeze / payload / client validation (v0.17.0).
 * LoRA lives on Batch source / frozen snapshot only — never per-job.
 *
 * normalizePersistedLoraSettings is for persistence compatibility only.
 * Submission gates must use validateBatchOwnedLora().
 */

import {
  H3_LORA_OFF,
  getH3LoraProfile,
  isActiveH3LoraId,
  isKnownH3LoraId
} from "./h3-lora-catalog.mjs";
import {
  normalizeLoraId,
  validateLoraSelection
} from "./h3-lora-validation.mjs";

/** Freeze Batch source LoRA without coercing invalid strength to profile default. */
export function freezeBatchLoraFields(source = {}) {
  const rawId = source?.loraId;
  if (rawId == null || rawId === "" || normalizeLoraId(rawId) === H3_LORA_OFF) {
    return { loraId: H3_LORA_OFF };
  }
  const loraId = normalizeLoraId(rawId);
  const out = { loraId };
  if (source.loraStrength != null && source.loraStrength !== "") {
    out.loraStrength = source.loraStrength;
  }
  return out;
}

/**
 * Fields to include on /api/queue payloads after successful validation.
 * OFF omits active strength.
 */
export function queuePayloadLoraFields(snapshot = {}) {
  const loraId = normalizeLoraId(snapshot?.loraId);
  if (!isActiveH3LoraId(loraId)) {
    return { loraId: H3_LORA_OFF };
  }
  const out = { loraId };
  if (snapshot.loraStrength != null && snapshot.loraStrength !== "") {
    const strength = Number(snapshot.loraStrength);
    if (Number.isFinite(strength)) out.loraStrength = strength;
  }
  return out;
}

/** Build allowlisted Comfy paths that are currently available (fail-closed). */
export function availableComfyPathsFromAvailability(availability) {
  if (availability == null || typeof availability !== "object") return null;
  const paths = [];
  for (const [id, state] of Object.entries(availability)) {
    if (id === H3_LORA_OFF) continue;
    if (state?.available === true) {
      const path = state.comfyPath || getH3LoraProfile(id)?.comfyPath;
      if (path) paths.push(path);
    }
  }
  return paths;
}

/**
 * Authoritative Batch client validation before CODA add / immediate / deferred queue.
 * Reuses validateLoraSelection(); does not silently coerce invalid strength to default
 * (empty strength still means "use profile default" for a legitimate active profile).
 */
export function validateBatchOwnedLora({
  loraId,
  loraStrength,
  preset = null,
  availability = null
} = {}) {
  const normalizedId = normalizeLoraId(loraId);
  if (!isKnownH3LoraId(normalizedId)) {
    return {
      ok: false,
      error: `LoRA sconosciuto: ${loraId == null || loraId === "" ? "(vuoto)" : loraId}`
    };
  }

  // Explicit invalid strength must fail before default coercion can hide it.
  if (isActiveH3LoraId(normalizedId) && loraStrength != null && loraStrength !== "") {
    const numeric = Number(loraStrength);
    if (!Number.isFinite(numeric)) {
      return {
        ok: false,
        error: "Forza LoRA non valida: usa un numero tra 0 e 1.5."
      };
    }
  }

  return validateLoraSelection({
    loraId: normalizedId,
    loraStrength,
    preset: preset || {},
    availableComfyPaths: availableComfyPathsFromAvailability(availability)
  });
}
