/**
 * Contextual Inspector mode by primary workflow view (Issue #92).
 * One Inspector — content priority changes; collapse/width untouched.
 */

export const INSPECTOR_CONTEXTS = Object.freeze(["scena", "batch", "coda", "output"]);

export function normalizeInspectorContext(view) {
  const next = String(view || "").trim().toLowerCase();
  return INSPECTOR_CONTEXTS.includes(next) ? next : "scena";
}

/**
 * @returns {{
 *   context: string,
 *   showAssetInput: boolean,
 *   showBatchContext: boolean,
 *   showCodaContext: boolean,
 *   showOutputContext: boolean,
 *   gpuCompactOnly: boolean,
 *   primaryLabel: string
 * }}
 */
export function resolveInspectorContext(view) {
  const context = normalizeInspectorContext(view);
  if (context === "batch") {
    return {
      context,
      showAssetInput: true,
      showBatchContext: true,
      showCodaContext: false,
      showOutputContext: false,
      gpuCompactOnly: true,
      primaryLabel: "Contesto Batch"
    };
  }
  if (context === "coda") {
    return {
      context,
      showAssetInput: false,
      showBatchContext: false,
      showCodaContext: true,
      showOutputContext: false,
      gpuCompactOnly: true,
      primaryLabel: "Contesto Coda"
    };
  }
  if (context === "output") {
    return {
      context,
      showAssetInput: false,
      showBatchContext: false,
      showCodaContext: false,
      showOutputContext: true,
      gpuCompactOnly: true,
      primaryLabel: "Contesto Output"
    };
  }
  return {
    context: "scena",
    showAssetInput: true,
    showBatchContext: false,
    showCodaContext: false,
    showOutputContext: false,
    gpuCompactOnly: false,
    primaryLabel: "Asset / Input"
  };
}
