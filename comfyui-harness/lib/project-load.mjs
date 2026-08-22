/**
 * Project load feedback and restore audit (v0.8.3).
 * Pure helpers for UI status and warning summaries.
 */

export const LOAD_STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  SUCCESS: "success",
  WARNING: "warning",
  ERROR: "error"
});

export function formatProjectLoadLabel(status, { label = "", batchCount = 0, batchRestored = false } = {}) {
  const name = String(label || "").trim();
  switch (status) {
    case LOAD_STATUS.LOADING:
      return name ? `⟳ Caricamento ${name}…` : "⟳ Caricamento progetto…";
    case LOAD_STATUS.SUCCESS:
      if (name) return `✓ ${name} caricato`;
      return "✓ Progetto caricato";
    case LOAD_STATUS.WARNING:
      if (name) return `⚠ ${name} caricato con avvisi`;
      return "⚠ Progetto caricato con avvisi";
    case LOAD_STATUS.ERROR:
      return "✕ Errore caricamento progetto";
    default:
      return "";
  }
}

export function formatBatchRestoreLabel({ count = 0, restored = false } = {}) {
  if (!restored || !count) return "";
  return `✓ Batch ripristinato · ${count} job`;
}

export function formatLegacyBatchOfferLabel({ count = 0 } = {}) {
  if (!count) return "";
  return `Batch locale trovato · ${count} job · Recupera`;
}

/**
 * Audit restored project fields against available runtime options.
 */
export function auditProjectRestore({
  project = {},
  availableModels = [],
  presetExists = true,
  batchDraft = null,
  missingAssetCount = 0
} = {}) {
  const warnings = [];
  const savedModel = project.settings?.model;
  const models = (availableModels || []).map(String);
  if (savedModel && models.length && !models.includes(String(savedModel))) {
    warnings.push({
      code: "model-unavailable",
      message: "modello salvato non disponibile",
      detail: String(savedModel)
    });
  }
  if (project.workflowId && !presetExists) {
    warnings.push({
      code: "workflow-unavailable",
      message: "workflow salvato non disponibile",
      detail: String(project.workflowId)
    });
  }

  const files = project.files || {};
  if (Number(missingAssetCount) > 0) {
    warnings.push({
      code: "asset-unavailable",
      message: missingAssetCount === 1 ? "1 asset non disponibile" : `${missingAssetCount} asset non disponibili`,
      detail: String(missingAssetCount)
    });
  }

  const settings = project.settings || {};
  const fallbackNotes = [];
  if (settings.megapixels != null && String(settings.megapixels) !== String(settings.megapixels)) {
    fallbackNotes.push("megapixel");
  }

  const batchCount = Array.isArray(batchDraft?.items) ? batchDraft.items.length : 0;
  const status = warnings.length ? LOAD_STATUS.WARNING : LOAD_STATUS.SUCCESS;
  const summary = warnings.length
    ? `⚠ Progetto caricato · ${warnings.map(w => w.message).join(" · ")}`
    : formatProjectLoadLabel(LOAD_STATUS.SUCCESS, { label: project.label || project.id });

  return {
    status,
    warnings,
    summary,
    batchCount,
    batchRestored: batchCount > 0,
    fallbackNotes
  };
}

export function shouldCommitLoadGeneration(requestedGeneration, activeGeneration) {
  return Number(requestedGeneration) === Number(activeGeneration);
}

export function resolveLoadStatusFromError(error) {
  const message = error instanceof Error ? error.message : String(error || "Errore sconosciuto");
  return {
    status: LOAD_STATUS.ERROR,
    summary: "✕ Errore caricamento progetto",
    detail: message
  };
}
