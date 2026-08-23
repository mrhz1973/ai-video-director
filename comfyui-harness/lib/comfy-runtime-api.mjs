/**
 * ComfyUI runtime control adapter (Issue #51).
 * Audited against ComfyUI v0.32.0 (c2bcbec) server.py:
 * - POST /interrupt  body: { "prompt_id": "<uuid>" }  — interrupts only if that id is running
 * - POST /queue      body: { "delete": ["<uuid>", ...] } — removes pending items only; never use clear:true
 */

export async function fetchComfyQueue(comfyUrl, fetchFn = fetch) {
  const response = await fetchFn(`${comfyUrl}/queue`);
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return { ok: response.ok, status: response.status, data };
}

export async function comfyInterruptPrompt(comfyUrl, promptId, fetchFn = fetch) {
  const id = String(promptId || "").trim();
  if (!id) throw new Error("prompt_id required for interrupt");
  const response = await fetchFn(`${comfyUrl}/interrupt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt_id: id })
  });
  return { ok: response.ok, status: response.status, promptId: id };
}

export async function comfyDeletePendingPrompts(comfyUrl, promptIds = [], fetchFn = fetch) {
  const ids = [...new Set((promptIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return { ok: true, status: 200, deleted: [] };
  const response = await fetchFn(`${comfyUrl}/queue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ delete: ids })
  });
  return { ok: response.ok, status: response.status, deleted: ids };
}
