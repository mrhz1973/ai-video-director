export const DEFAULT_OUTPUT_TEMPLATE = "{project}_{scene}_{workflow}_{model}_{mp}MP_{duration}s_{steps}st_seed{seed}_{counter:04}";

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeOutputSegment(value, { fallback = "untitled", maxLength = 80 } = {}) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(INVALID_FILENAME_CHARS, "-")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/-+/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, maxLength);
  return cleaned || fallback;
}

export function shortModelName(value) {
  const raw = String(value || "");
  const lower = raw.toLowerCase();
  if (lower.includes("q8_cr")) return "Q8CR";
  if (lower.includes("q8")) return "Q8";
  if (lower.includes("q4_0")) return "Q4";
  if (lower.includes("q4")) return "Q4";
  if (lower.includes("bf16")) return "BF16";
  if (lower.includes("fp8")) return "FP8";
  return sanitizeOutputSegment(raw.replace(/\.(gguf|safetensors)$/i, ""), { fallback: "model", maxLength: 32 });
}

export function shortWorkflowName(value, label = "") {
  const probe = `${value || ""} ${label || ""}`.toUpperCase();
  if (probe.includes("REF2VA") || probe.includes("REFERENCE")) return "REF2VA";
  if (probe.includes("FL2VA") || probe.includes("FIRST") && probe.includes("LAST")) return "FL2VA";
  if (probe.includes("I2VA") || probe.includes("IMAGE TO VIDEO")) return "I2VA";
  if (probe.includes("T2VA") || probe.includes("TEXT TO VIDEO")) return "T2VA";
  return sanitizeOutputSegment(value || label, { fallback: "H3", maxLength: 24 }).toUpperCase();
}

export function formatMegapixels(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "NA";
  return number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function buildOutputTokens({
  project = "",
  scene = "",
  workflow = "",
  workflowLabel = "",
  model = "",
  megapixels = "",
  duration = "",
  steps = "",
  seed = "",
  aspect = "",
  variant = ""
} = {}) {
  return {
    project: sanitizeOutputSegment(project, { fallback: "project" }),
    scene: sanitizeOutputSegment(scene, { fallback: "shot" }),
    workflow: shortWorkflowName(workflow, workflowLabel),
    model: shortModelName(model),
    mp: sanitizeOutputSegment(formatMegapixels(megapixels), { fallback: "NA" }),
    duration: sanitizeOutputSegment(duration, { fallback: "NA" }),
    steps: sanitizeOutputSegment(steps, { fallback: "NA" }),
    seed: sanitizeOutputSegment(seed, { fallback: "NA", maxLength: 32 }),
    aspect: sanitizeOutputSegment(aspect, { fallback: "NA", maxLength: 16 }).replace(/:/g, "x"),
    variant: sanitizeOutputSegment(variant, { fallback: "v", maxLength: 32 })
  };
}

function renderCounterToken(template, counter, defaultDigits) {
  return String(template).replace(/\{counter(?::0?(\d+))?\}/g, (_, digitsRaw) => {
    const digits = digitsRaw ? Number(digitsRaw) : Number(defaultDigits || 4);
    const width = Number.isFinite(digits) ? Math.max(1, Math.min(12, digits)) : 4;
    return String(Math.max(0, Number(counter) || 0)).padStart(width, "0");
  });
}

export function resolveOutputBaseName(template, tokens = {}, { counter = 1, counterDigits = 4 } = {}) {
  const source = String(template || DEFAULT_OUTPUT_TEMPLATE);
  let rendered = renderCounterToken(source, counter, counterDigits);
  rendered = rendered.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : key;
    return sanitizeOutputSegment(value, { fallback: key });
  });
  rendered = rendered
    .replace(/_{2,}/g, "_")
    .replace(/-{2,}/g, "-")
    .replace(/^[_ .-]+|[_ .-]+$/g, "");
  return sanitizeOutputSegment(rendered, { fallback: "render", maxLength: 180 });
}

export function extensionFromFilename(filename, fallback = ".mp4") {
  const match = String(filename || "").match(/(\.[a-zA-Z0-9]{1,8})$/);
  return match ? match[1].toLowerCase() : fallback;
}

export function buildOutputFilename({
  template = DEFAULT_OUTPUT_TEMPLATE,
  tokens = {},
  counter = 1,
  counterDigits = 4,
  sourceFilename = "render.mp4"
} = {}) {
  const base = resolveOutputBaseName(template, tokens, { counter, counterDigits });
  return `${base}${extensionFromFilename(sourceFilename)}`;
}

export function outputCounterStorageKey({ scope = "project", projectId = "", scene = "" } = {}) {
  if (scope === "global") return "h3OutputCounter:global";
  if (scope === "scene") {
    return `h3OutputCounter:scene:${sanitizeOutputSegment(projectId || "none")}:${sanitizeOutputSegment(scene || "shot")}`;
  }
  return `h3OutputCounter:project:${sanitizeOutputSegment(projectId || "none")}`;
}
