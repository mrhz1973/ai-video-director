/**
 * Project-bound Batch draft schema (v0.8.3).
 * Pure helpers: normalize, serialize, legacy migration, execution-safety checks.
 */

import { normalizeDurationSeconds } from "./duration.mjs";

export const BATCH_DRAFT_VERSION = 1;
export const LEGACY_DRAFT_PREFIX = "h3BatchDraft:v1:";

/** Fields that must never be persisted with project data. */
export const FORBIDDEN_PERSISTENCE_KEYS = Object.freeze([
  "queuedNext",
  "deferredBatch",
  "submitAll",
  "batchActive",
  "armed",
  "runtime",
  "prompt_id",
  "promptId",
  "submitted",
  "submitting"
]);

function stripForbidden(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripForbidden);
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PERSISTENCE_KEYS.includes(key)) continue;
    out[key] = stripForbidden(child);
  }
  return out;
}

function normalizeItem(raw = {}, index = 0) {
  const item = raw && typeof raw === "object" ? raw : {};
  return {
    prompt: String(item.prompt || ""),
    seed: String(item.seed ?? String(index + 1)),
    duration: String(normalizeDurationSeconds(item.duration ?? 5)),
    steps: String(item.steps ?? "20"),
    megapixels: String(item.megapixels ?? "0.3"),
    aspect: String(item.aspect || "16:9")
  };
}

function normalizeSource(raw = null) {
  if (!raw || typeof raw !== "object") return null;
  const source = stripForbidden(raw);
  const base = source.base && typeof source.base === "object" ? source.base : {};
  return {
    workflowId: String(source.workflowId || ""),
    workflowLabel: String(source.workflowLabel || source.workflowId || ""),
    model: String(source.model || ""),
    files: source.files && typeof source.files === "object" ? { ...source.files } : {},
    requiredKeys: Array.isArray(source.requiredKeys) ? [...source.requiredKeys] : [],
    unsupportedVideoRoles: Array.isArray(source.unsupportedVideoRoles) ? [...source.unsupportedVideoRoles] : [],
    safeFitStatus: String(source.safeFitStatus || "not-applicable"),
    megapixelsMin: Number(source.megapixelsMin ?? 0.1),
    megapixelsMax: Number(source.megapixelsMax ?? 16),
    durationMin: Number(source.durationMin ?? 4),
    durationMax: Number(source.durationMax ?? 15),
    base: {
      prompt: String(base.prompt || ""),
      seed: String(base.seed ?? "1"),
      duration: String(normalizeDurationSeconds(base.duration ?? 5)),
      steps: String(base.steps ?? "20"),
      megapixels: String(base.megapixels ?? "0.3"),
      aspect: String(base.aspect || "16:9")
    }
  };
}

/**
 * Normalize a persisted or legacy browser draft.
 * Returns null when no meaningful batch exists.
 */
export function normalizeBatchDraft(raw = null) {
  if (raw == null) return null;
  const source = raw && typeof raw === "object" ? raw : {};
  const itemsRaw = Array.isArray(source.items) ? source.items : [];
  if (!itemsRaw.length) return null;
  const items = itemsRaw.slice(0, 8).map((item, index) => normalizeItem(item, index));
  const normalizedSource = normalizeSource(source.source);
  if (!normalizedSource?.workflowId) return null;
  return {
    version: BATCH_DRAFT_VERSION,
    source: normalizedSource,
    items,
    updatedAt: source.updatedAt || new Date().toISOString()
  };
}

export function serializeBatchDraft({ source, items, updatedAt } = {}) {
  const normalized = normalizeBatchDraft({ version: BATCH_DRAFT_VERSION, source, items, updatedAt });
  if (!normalized) return null;
  return {
    version: normalized.version,
    source: normalized.source,
    items: normalized.items,
    updatedAt: updatedAt || normalized.updatedAt || new Date().toISOString()
  };
}

export function batchDraftIdentity(draft = null) {
  const normalized = normalizeBatchDraft(draft);
  if (!normalized) return "";
  return JSON.stringify({
    workflowId: normalized.source.workflowId,
    model: normalized.source.model,
    files: normalized.source.files || {}
  });
}

export function sourceIdentityFromDraft(draft = null) {
  return batchDraftIdentity(draft);
}

export function isEmptyBatchDraft(raw = null) {
  return normalizeBatchDraft(raw) == null;
}

export function assertNoExecutionAuthority(raw = null) {
  const text = JSON.stringify(raw || {});
  for (const key of FORBIDDEN_PERSISTENCE_KEYS) {
    if (text.includes(`"${key}"`)) {
      throw new Error(`Execution authority field must not be persisted: ${key}`);
    }
  }
  return true;
}

export function legacyDraftKey(projectKey = "none") {
  return `${LEGACY_DRAFT_PREFIX}${projectKey || "none"}`;
}

export function parseLegacyDraft(rawText) {
  if (!rawText) return null;
  try {
    const parsed = JSON.parse(rawText);
    return normalizeBatchDraft(parsed);
  } catch {
    return null;
  }
}

/**
 * Score a legacy browser draft against a saved project for safe auto-migration.
 */
export function scoreLegacyDraftCandidate({
  projectId = "",
  projectWorkflowId = "",
  projectModel = "",
  projectFiles = {},
  legacyKey = "",
  legacyDraft = null
} = {}) {
  const draft = normalizeBatchDraft(legacyDraft);
  if (!draft) return { ok: false, reason: "empty", score: 0, jobCount: 0 };

  const exactKey = legacyDraftKey(projectId);
  const noneKey = legacyDraftKey("none");
  const key = String(legacyKey || "");
  let score = 0;

  if (key === exactKey) score += 100;
  else if (key === noneKey && projectId) score += 40;
  else return { ok: false, reason: "ambiguous-key", score: 0, jobCount: draft.items.length, key };

  if (draft.source.workflowId && projectWorkflowId && draft.source.workflowId === projectWorkflowId) score += 20;
  else if (draft.source.workflowId && projectWorkflowId) return { ok: false, reason: "workflow-mismatch", score, jobCount: draft.items.length, key };

  if (draft.source.model && projectModel && draft.source.model === projectModel) score += 10;
  else if (draft.source.model && projectModel) score -= 5;

  const savedFiles = projectFiles || {};
  const draftFiles = draft.source.files || {};
  const fileKeys = Object.keys(draftFiles);
  if (fileKeys.length) {
    const compatible = fileKeys.every(k => !draftFiles[k] || savedFiles[k] === draftFiles[k]);
    if (!compatible) return { ok: false, reason: "files-mismatch", score, jobCount: draft.items.length, key };
    score += 10;
  }

  return {
    ok: score >= 100,
    strong: score >= 120,
    score,
    jobCount: draft.items.length,
    key,
    draft
  };
}

export function findLegacyMigrationCandidate({
  projectId = "",
  projectWorkflowId = "",
  projectModel = "",
  projectFiles = {},
  storageEntries = []
} = {}) {
  const entries = Array.isArray(storageEntries) ? storageEntries : [];
  const exact = entries.find(entry => entry.key === legacyDraftKey(projectId));
  if (exact?.raw) {
    const scored = scoreLegacyDraftCandidate({
      projectId,
      projectWorkflowId,
      projectModel,
      projectFiles,
      legacyKey: exact.key,
      legacyDraft: parseLegacyDraft(exact.raw)
    });
    if (scored.ok) return { mode: "auto", ...scored };
  }

  const none = entries.find(entry => entry.key === legacyDraftKey("none"));
  if (none?.raw) {
    const scored = scoreLegacyDraftCandidate({
      projectId,
      projectWorkflowId,
      projectModel,
      projectFiles,
      legacyKey: none.key,
      legacyDraft: parseLegacyDraft(none.raw)
    });
    if (scored.ok && scored.strong) return { mode: "auto-none", ...scored };
    if (scored.jobCount) return { mode: "offer", ...scored };
  }

  const others = entries
    .filter(entry => entry.key.startsWith(LEGACY_DRAFT_PREFIX) && entry.key !== legacyDraftKey(projectId) && entry.key !== legacyDraftKey("none"))
    .map(entry => scoreLegacyDraftCandidate({
      projectId,
      projectWorkflowId,
      projectModel,
      projectFiles,
      legacyKey: entry.key,
      legacyDraft: parseLegacyDraft(entry.raw)
    }))
    .filter(item => item.jobCount > 0);

  if (others.length === 1 && others[0].ok) {
    return { mode: "offer", ...others[0] };
  }
  if (others.length > 1) {
    return { mode: "ambiguous", candidates: others };
  }
  return null;
}

export function batchesEqual(a = null, b = null) {
  const left = normalizeBatchDraft(a);
  const right = normalizeBatchDraft(b);
  if (!left && !right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left.items) === JSON.stringify(right.items)
    && batchDraftIdentity(left) === batchDraftIdentity(right);
}
