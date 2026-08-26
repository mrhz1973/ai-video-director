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

export function entryIsUrgentRecovery(entry) {
  return String(entry?.state || "").trim().toLowerCase() === "recovery-required";
}

/** True when a restored/selected filter would hide recovery-required cards. */
export function codaFilterHidesUrgentRecovery(entries, filter) {
  const list = Array.isArray(entries) ? entries : [];
  const f = normalizeCodaFilter(filter);
  return list.some(entry => entryIsUrgentRecovery(entry) && !entryMatchesCodaFilter(entry, f));
}

/**
 * Display-only: never leave recovery stranded behind Completati/In coda/etc.
 * Returns `problemi` when the current filter would hide recovery-required entries.
 */
export function ensureCodaFilterShowsRecovery(entries, filter) {
  if (codaFilterHidesUrgentRecovery(entries, filter)) return "problemi";
  return normalizeCodaFilter(filter);
}

/**
 * Prefer normal filter; always pin recovery-required entries so resolve controls stay reachable.
 */
export function filterCodaEntriesForDisplay(entries, filter) {
  const list = Array.isArray(entries) ? entries : [];
  const f = normalizeCodaFilter(filter);
  const matched = new Set();
  const out = [];
  for (const entry of list) {
    if (entryMatchesCodaFilter(entry, f) || entryIsUrgentRecovery(entry)) {
      const id = entry?.queueEntryId;
      const key = id != null ? String(id) : out.length;
      if (matched.has(key)) continue;
      matched.add(key);
      out.push(entry);
    }
  }
  return out;
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
