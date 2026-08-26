/**
 * Display-only CODA entry filters (Issue #92).
 * Never mutate queue plan / entry state.
 */

export const CODA_FILTERS = Object.freeze([
  "tutti",
  "in-coda",
  "in-corso",
  "completati",
  "problemi"
]);

export const CODA_FILTER_STORAGE_KEY = "h3CodaFilter:v1";

export function normalizeCodaFilter(value) {
  const next = String(value || "").trim().toLowerCase();
  return CODA_FILTERS.includes(next) ? next : "tutti";
}

export function entryMatchesCodaFilter(entry, filter) {
  const state = String(entry?.state || "").trim().toLowerCase();
  const f = normalizeCodaFilter(filter);
  if (f === "tutti") return true;
  if (f === "in-coda") return state === "queued";
  if (f === "in-corso") return state === "submitting" || state === "running";
  if (f === "completati") return state === "completed";
  if (f === "problemi") {
    return state === "failed" || state === "cancelled" || state === "recovery-required";
  }
  return true;
}

export function filterCodaEntries(entries, filter) {
  const list = Array.isArray(entries) ? entries : [];
  return list.filter(entry => entryMatchesCodaFilter(entry, filter));
}

/** Completed terminal entries get compact chrome; active/problem stay prominent. */
export function isCompactCodaEntry(entry) {
  return String(entry?.state || "").trim().toLowerCase() === "completed";
}

export function codaFilterEmptyMessage(filter) {
  const f = normalizeCodaFilter(filter);
  if (f === "tutti") return "Nessun batch in coda.";
  if (f === "in-coda") return "Nessun batch in attesa con questo filtro.";
  if (f === "in-corso") return "Nessun batch in esecuzione con questo filtro.";
  if (f === "completati") return "Nessun batch completato con questo filtro.";
  if (f === "problemi") return "Nessun batch con problemi con questo filtro.";
  return "Nessun risultato per questo filtro.";
}

export function readStoredCodaFilter(storage = globalThis.localStorage) {
  try {
    return normalizeCodaFilter(storage?.getItem?.(CODA_FILTER_STORAGE_KEY));
  } catch {
    return "tutti";
  }
}

export function persistCodaFilter(filter, storage = globalThis.localStorage) {
  const next = normalizeCodaFilter(filter);
  try { storage?.setItem?.(CODA_FILTER_STORAGE_KEY, next); } catch { /* browser-local */ }
  return next;
}
