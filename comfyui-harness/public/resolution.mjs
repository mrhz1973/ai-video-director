// Pure helpers shared by the browser UI and the Node backend. Must stay DOM-free.

// Verified from ComfyUI /object_info -> ResolutionSelector.megapixels (FLOAT).
export const MEGAPIXELS_LIMITS = { min: 0.1, max: 16, step: 0.1 };

// Harness operational default; the ComfyUI node default (1.0) is not used here.
export const DEFAULT_MEGAPIXELS = 0.3;

// Accepted only for backward compatibility with old clients and projects.
export const LEGACY_QUALITY_MEGAPIXELS = { Preview: 0.3, Final: 0.4 };

// ResolutionSelector `multiple` widget value used by node 115 in every active H3 workflow.
export const DISPLAY_MULTIPLE = 32;

// ResolutionSelector computes total pixels as megapixels * 1024 * 1024.
const PIXELS_PER_MEGAPIXEL = 1024 * 1024;

const ASPECTS = {
  "1:1": { w: 1, h: 1, comfy: "1:1 (Square)", shape: "Square" },
  "3:4": { w: 3, h: 4, comfy: "3:4 (Portrait Standard)", shape: "Portrait Standard" },
  "4:3": { w: 4, h: 3, comfy: "4:3 (Standard)", shape: "Standard" },
  "9:16": { w: 9, h: 16, comfy: "9:16 (Portrait Widescreen)", shape: "Portrait" },
  "16:9": { w: 16, h: 9, comfy: "16:9 (Widescreen)", shape: "Widescreen", ladder: true },
  "21:9": { w: 21, h: 9, comfy: "21:9 (Ultrawide)", shape: "Ultrawide", ladder: true, suffix: "Ultrawide" }
};

// QHD is never called "2K"; true DCI 2K is 2048x1080 and is not part of this ladder.
const STANDARD_HEIGHTS = [
  { height: 360, label: "~360p", short: "~360p" },
  { height: 480, label: "~480p", short: "~480p" },
  { height: 720, label: "~720p HD", short: "~720p" },
  { height: 1080, label: "~1080p Full HD", short: "~1080p" },
  { height: 1440, label: "~1440p QHD", short: "~1440p" },
  { height: 2160, label: "~2160p 4K UHD", short: "~2160p" },
  { height: 4320, label: "~4320p 8K UHD", short: "~4320p" }
];

// Beyond this relative distance no familiar class is claimed.
const LADDER_TOLERANCE = 0.25;

export function parseAspect(aspect) {
  return ASPECTS[aspect] || ASPECTS["16:9"];
}

export function comfyAspectRatio(aspect) {
  return parseAspect(aspect).comfy;
}

export function isValidMegapixels(value) {
  if (typeof value !== "number" && typeof value !== "string") return false;
  if (typeof value === "string" && value.trim() === "") return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= MEGAPIXELS_LIMITS.min && parsed <= MEGAPIXELS_LIMITS.max;
}

export function validateMegapixels(value) {
  if (!isValidMegapixels(value)) {
    throw new Error(`megapixels must be a finite number between ${MEGAPIXELS_LIMITS.min} and ${MEGAPIXELS_LIMITS.max}`);
  }
  return Number(value);
}

export function selectMegapixels(input = {}) {
  if (input.megapixels !== undefined) return validateMegapixels(input.megapixels);
  const legacy = LEGACY_QUALITY_MEGAPIXELS[input.quality];
  return legacy !== undefined ? legacy : DEFAULT_MEGAPIXELS;
}

export function megapixelsFromSettings(settings = {}) {
  if (settings.megapixels !== undefined && isValidMegapixels(settings.megapixels)) return Number(settings.megapixels);
  return LEGACY_QUALITY_MEGAPIXELS[settings.quality];
}

// Display only: mirrors the ResolutionSelector arithmetic so the hint matches the real node.
export function estimateDimensions(megapixels, aspect, multiple = DISPLAY_MULTIPLE) {
  const { w, h } = parseAspect(aspect);
  const scale = Math.sqrt(validateMegapixels(megapixels) * PIXELS_PER_MEGAPIXEL / (w * h));
  return {
    width: Math.round(w * scale / multiple) * multiple,
    height: Math.round(h * scale / multiple) * multiple
  };
}

export function classifyResolution(width, height, aspect) {
  const definition = parseAspect(aspect);
  if (!definition.ladder) return definition.shape;
  const nearest = STANDARD_HEIGHTS
    .map(entry => ({ ...entry, distance: Math.abs(height - entry.height) / entry.height }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearest.distance > LADDER_TOLERANCE) return definition.shape;
  return definition.suffix ? `${nearest.short} ${definition.suffix}` : nearest.label;
}

export function approximateResolution(megapixels, aspect, multiple = DISPLAY_MULTIPLE) {
  const { width, height } = estimateDimensions(megapixels, aspect, multiple);
  return { width, height, label: classifyResolution(width, height, aspect) };
}

export function formatResolutionHint(megapixels, aspect, multiple = DISPLAY_MULTIPLE) {
  if (!isValidMegapixels(megapixels)) return `valore non valido (${MEGAPIXELS_LIMITS.min}–${MEGAPIXELS_LIMITS.max})`;
  const { width, height, label } = approximateResolution(megapixels, aspect, multiple);
  return `≈ ${width}×${height} · ${label}`;
}
