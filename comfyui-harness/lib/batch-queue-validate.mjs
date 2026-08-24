/**
 * Server-safe semantic validation for queued Batch snapshots.
 * Rejects invalid edits before revision bump; does not coerce values.
 */

import { normalizeBatchDraft } from "./batch-draft.mjs";

const ASPECT_RE = /^\d+:\d+$/;

export function validateQueueBatchSnapshot(snapshot) {
  const errors = [];
  const rawItems = Array.isArray(snapshot?.items) ? snapshot.items : [];
  for (let index = 0; index < rawItems.length; index += 1) {
    const files = rawItems[index]?.files;
    if (files != null && (typeof files !== "object" || Array.isArray(files))) {
      errors.push("Job " + (index + 1) + ": item.files non valido");
    }
  }
  if (errors.length) {
    return { ok: false, code: "invalid-snapshot", error: errors[0], errors };
  }
  const normalized = normalizeBatchDraft(snapshot);
  if (!normalized) {
    return {
      ok: false,
      code: "invalid-snapshot",
      error: "Snapshot Batch non valido.",
      errors: ["snapshot non valido"]
    };
  }

  const source = normalized.source || {};
  const megapixelsMin = Number(source.megapixelsMin ?? 0.1);
  const megapixelsMax = Number(source.megapixelsMax ?? 16);
  const durationMin = Number(source.durationMin ?? 1);
  const durationMax = Number(source.durationMax ?? 120);

  if (!String(source.workflowId || "").trim()) errors.push("workflow mancante");
  if (!String(source.model || "").trim()) errors.push("model mancante");

  const items = Array.isArray(normalized.items) ? normalized.items : [];
  if (!items.length) errors.push("almeno un job richiesto");

  const requiredKeys = Array.isArray(source.requiredKeys) ? source.requiredKeys : [];
  const sharedFiles = source.files && typeof source.files === "object" ? source.files : {};

  items.forEach((item, index) => {
    const label = `Job ${index + 1}`;
    if (!String(item.prompt || "").trim()) errors.push(`${label}: prompt vuoto`);

    const seed = Number(item.seed);
    if (!Number.isFinite(seed)) errors.push(`${label}: seed non valido`);

    const steps = Number(item.steps);
    if (!Number.isFinite(steps) || steps < 1 || !Number.isInteger(steps)) {
      errors.push(`${label}: steps non validi`);
    }

    const duration = Number(String(item.duration ?? "").replace(",", "."));
    if (!Number.isFinite(duration) || duration < durationMin || duration > durationMax) {
      errors.push(`${label}: duration non valida`);
    }

    const megapixels = Number(item.megapixels);
    if (!Number.isFinite(megapixels) || megapixels < megapixelsMin || megapixels > megapixelsMax) {
      errors.push(`${label}: megapixels fuori ${megapixelsMin}–${megapixelsMax}`);
    }

    const aspect = String(item.aspect || "").trim();
    if (!aspect || !ASPECT_RE.test(aspect)) {
      errors.push(`${label}: aspect non valido`);
    }

    if (item.files != null) {
      if (typeof item.files !== "object" || Array.isArray(item.files)) {
        errors.push(`${label}: item.files non valido`);
      } else {
        for (const [key, value] of Object.entries(item.files)) {
          if (value != null && typeof value !== "string") {
            errors.push(`${label}: item.files.${key} non valido`);
          }
        }
      }
    }

    const overrides = item.files && typeof item.files === "object" && !Array.isArray(item.files)
      ? item.files
      : {};
    for (const key of requiredKeys) {
      const hasOverride = Object.prototype.hasOwnProperty.call(overrides, key);
      const filename = hasOverride ? overrides[key] : sharedFiles[key];
      if (!String(filename || "").trim()) {
        errors.push(`${label}: input ${key} mancante`);
      }
    }
  });

  if (errors.length) {
    return { ok: false, code: "invalid-snapshot", error: errors[0], errors };
  }
  return { ok: true, snapshot: normalized };
}
