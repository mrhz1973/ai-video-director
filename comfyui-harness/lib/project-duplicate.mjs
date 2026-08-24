/**
 * Pure helpers for Salva come / duplicate project (Issue #50).
 * Clones editable project data only — never runtime execution authority.
 */

import {
  assertNoExecutionAuthority,
  normalizeBatchDraft,
  normalizeItemFiles,
  serializeBatchDraft
} from "./batch-draft.mjs";
import { normalizeSettings } from "./projects.mjs";
import {
  assertNoQueuePlanAuthority,
  normalizeBatchQueuePlan,
  serializeBatchQueuePlan
} from "./batch-queue-plan.mjs";

function cloneBatchDraftForDuplicate(batchDraft = null) {
  const normalized = normalizeBatchDraft(batchDraft);
  if (!normalized) return null;
  const source = JSON.parse(JSON.stringify(normalized.source));
  const items = normalized.items.map((item, index) => {
    const files = normalizeItemFiles(item.files);
    const out = {
      prompt: String(item.prompt || ""),
      seed: String(item.seed ?? String(index + 1)),
      duration: String(item.duration ?? "5"),
      steps: String(item.steps ?? "20"),
      megapixels: String(item.megapixels ?? "0.3"),
      aspect: String(item.aspect || "16:9")
    };
    if (files) out.files = { ...files };
    return out;
  });
  const serialized = serializeBatchDraft({
    source,
    items,
    includeUpdatedAt: true,
    updatedAt: new Date().toISOString()
  });
  if (serialized) assertNoExecutionAuthority(serialized);
  return serialized;
}

export function defaultDuplicateProjectLabel(currentLabel = "") {
  const base = String(currentLabel || "").trim() || "Progetto";
  return `${base} — copia`;
}

/**
 * Build POST body for a new project duplicated from the current editor snapshot.
 * Omits id and strips forbidden runtime keys from batchDraft.
 */
export function buildDuplicateProjectPayload(editorState = {}, { newLabel } = {}) {
  const label = String(newLabel || "").trim();
  if (!label) throw new Error("Nome progetto richiesto");

  const library = JSON.parse(JSON.stringify(editorState.library || {
    elements: [],
    locations: [],
    objects: [],
    audio: []
  }));

  const payload = {
    label,
    workflowId: String(editorState.workflowId || ""),
    prompt: String(editorState.prompt || ""),
    settings: normalizeSettings(editorState.settings || {}),
    library,
    files: { ...(editorState.files || {}) }
  };

  const batchDraft = cloneBatchDraftForDuplicate(editorState.batchDraft);
  if (batchDraft) payload.batchDraft = batchDraft;
  const batchQueue = cloneBatchQueueForDuplicate(editorState.batchQueue);
  if (batchQueue) payload.batchQueue = batchQueue;
  return payload;
}

function cloneBatchQueueForDuplicate(batchQueue = null) {
  const normalized = normalizeBatchQueuePlan(batchQueue);
  if (!normalized) return null;
  const serialized = serializeBatchQueuePlan(normalized);
  if (serialized) assertNoQueuePlanAuthority(serialized);
  return serialized;
}
