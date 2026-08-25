/**
 * Batch-owned global LoRA freeze / queue payload helpers (v0.17.0).
 * LoRA lives on Batch source / frozen snapshot only — never per-job.
 */

import { H3_LORA_OFF, isActiveH3LoraId } from "./h3-lora-catalog.mjs";
import {
  normalizeLoraId,
  normalizePersistedLoraSettings
} from "./h3-lora-validation.mjs";

/** Normalize Batch source / frozen snapshot LoRA fields for persistence. */
export function freezeBatchLoraFields(source = {}) {
  return normalizePersistedLoraSettings(source || {});
}

/**
 * Fields to include on /api/queue payloads for immediate/deferred Batch
 * and shared with multi-Batch CODA semantics.
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
