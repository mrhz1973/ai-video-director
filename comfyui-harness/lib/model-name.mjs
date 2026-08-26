/**
 * Isomorphic model filename helpers (browser + Node).
 * Shared by output naming and H3 model registry friendly labels.
 */

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
