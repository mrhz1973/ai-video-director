/**
 * ComfyUI input identity helpers (filename + optional subfolder).
 * Workflow role bindings remain filename-only; this key is only for view/status.
 */

export function normalizeInputSubfolder(subfolder) {
  const raw = String(subfolder || "").replaceAll("\\", "/").trim();
  if (!raw) return "";
  const parts = raw.split("/").filter(part => part && part !== ".");
  if (!parts.length) return "";
  if (parts.some(part => part === ".." || part.includes(":"))) return null;
  return parts.join("/");
}

/**
 * Map key for availability results.
 * Root/legacy: filename only.
 * Nested: "<subfolder>/<filename>" (filenames cannot contain "/", so this is unambiguous).
 */
export function assetStatusKey({ filename, subfolder = "" } = {}) {
  const name = String(filename || "");
  if (!name) return "";
  const folder = normalizeInputSubfolder(subfolder);
  if (folder == null) return "";
  return folder ? `${folder}/${name}` : name;
}

export function parseAssetStatusDescriptors(searchParams) {
  const filenames = [
    ...searchParams.getAll("filename"),
    ...(String(searchParams.get("filenames") || "").split(",").map(s => s.trim()).filter(Boolean))
  ];
  const subfolders = searchParams.getAll("subfolder");
  return filenames.filter(Boolean).map((filename, index) => ({
    filename: String(filename),
    subfolder: subfolders[index] != null ? String(subfolders[index]) : "",
    type: "input"
  }));
}

export function uniqueAssetDescriptors(descriptors = []) {
  const seen = new Set();
  const out = [];
  for (const item of descriptors) {
    const filename = String(item?.filename || "");
    if (!filename) continue;
    const folder = normalizeInputSubfolder(item.subfolder);
    if (folder == null) continue;
    const key = assetStatusKey({ filename, subfolder: folder });
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ filename, subfolder: folder, type: item.type || "input" });
  }
  return out;
}

export function lookupAvailability(availability = {}, { filename, subfolder = "" } = {}) {
  if (!filename) return "unknown";
  const key = assetStatusKey({ filename, subfolder });
  if (key && availability[key] != null) return availability[key];
  const folder = normalizeInputSubfolder(subfolder);
  // Filename-only maps remain valid for root/legacy assets.
  // Non-empty subfolders must not inherit a root-filename status.
  if (!folder && availability[filename] != null) return availability[filename];
  return "unknown";
}

export function encodeQueryPairs(pairs) {
  return pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}
