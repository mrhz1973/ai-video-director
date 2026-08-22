/**
 * Shared whole-second duration helper for harness v0.8.2+.
 * Never submits generation or writes GPU state.
 */

export const DURATION_MIN = 4;
export const DURATION_MAX = 15;
export const DURATION_FALLBACK = 5;

export function durationBounds({ min = DURATION_MIN, max = DURATION_MAX, fallback = DURATION_FALLBACK } = {}) {
  const lo = Number.isFinite(Number(min)) ? Number(min) : DURATION_MIN;
  const hi = Number.isFinite(Number(max)) ? Number(max) : DURATION_MAX;
  const fb = Number.isFinite(Number(fallback)) ? Number(fallback) : DURATION_FALLBACK;
  return { min: Math.round(lo), max: Math.round(hi), fallback: Math.round(fb) };
}

/**
 * Normalize any numeric/legacy duration to a whole second clamped to min/max.
 * "5.0", 5.0, "5,5" → nearest valid integer. Non-finite → fallback.
 */
export function normalizeDurationSeconds(value, options = {}) {
  const { min, max, fallback } = durationBounds(options);
  if (value === undefined || value === null || value === "") return fallback;
  const raw = typeof value === "string" ? value.trim().replace(",", ".") : value;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.round(numeric);
  return Math.max(min, Math.min(max, rounded));
}

export function formatDurationCompact(value, options = {}) {
  return `${normalizeDurationSeconds(value, options)}s`;
}

export function formatDurationLabel(value, options = {}) {
  return `${normalizeDurationSeconds(value, options)} s`;
}

export function durationInputAttrs(options = {}) {
  const { min, max, fallback } = durationBounds(options);
  return { min, max, step: 1, value: fallback };
}

/** True when a UI string still shows a decimal duration (5.0s / 5,0 s). */
export function hasDecimalDurationDisplay(text) {
  return /\d+[.,]\d+\s*s\b/i.test(String(text || ""));
}
