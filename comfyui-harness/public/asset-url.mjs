/**
 * Build a harness /api/view URL for a ComfyUI input asset.
 * Uses encodeURIComponent (percent-encoding) so spaces never become "+" / "%2B".
 */
export function buildInputViewUrl({ filename, subfolder = "", type = "input" } = {}) {
  if (!filename) return "";
  const params = [
    ["filename", filename],
    ["type", type || "input"]
  ];
  if (subfolder != null && String(subfolder) !== "") {
    params.push(["subfolder", String(subfolder)]);
  } else {
    params.push(["subfolder", ""]);
  }
  const query = params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `/api/view?${query}`;
}

export function parseUploadResult(data = {}) {
  const filename = data.name || data.filename || "";
  return {
    filename,
    subfolder: data.subfolder == null ? "" : String(data.subfolder),
    type: data.type || "input"
  };
}
