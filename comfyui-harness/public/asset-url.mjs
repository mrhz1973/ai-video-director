import { encodeQueryPairs, uniqueAssetDescriptors } from "../lib/asset-ref.mjs";

/**
 * Shared ComfyUI /view query for harness proxy and asset-status probes.
 * Percent-encodes so spaces never become "+" / "%2B".
 */
export function buildInputViewQuery({ filename, subfolder = "", type = "input" } = {}) {
  if (!filename) return "";
  return encodeQueryPairs([
    ["filename", filename],
    ["type", type || "input"],
    ["subfolder", subfolder == null ? "" : String(subfolder)]
  ]);
}

export function buildInputViewUrl({ filename, subfolder = "", type = "input" } = {}) {
  const query = buildInputViewQuery({ filename, subfolder, type });
  return query ? `/api/view?${query}` : "";
}

export function buildAssetStatusUrl(descriptors = []) {
  const unique = uniqueAssetDescriptors(descriptors);
  if (!unique.length) return "";
  const pairs = [];
  for (const item of unique) {
    pairs.push(["filename", item.filename]);
    pairs.push(["subfolder", item.subfolder || ""]);
  }
  return `/api/asset-status?${encodeQueryPairs(pairs)}`;
}

export function parseUploadResult(data = {}) {
  const filename = data.name || data.filename || "";
  return {
    filename,
    subfolder: data.subfolder == null ? "" : String(data.subfolder),
    type: data.type || "input"
  };
}
