/**
 * Browser-local prompt history. Never generates, queues, or writes GPU.
 */

export const PROMPT_HISTORY_KEY = "h3PromptHistory:v1";
export const PROMPT_HISTORY_MAX = 30;

export const PROMPT_HISTORY_RESERVED = Object.freeze([
  "h3RecoveryDraft:v1",
  "h3PromptHeight:v1",
  "h3MonitorHeight:v1",
  "h3ActivityHeight:v1",
  "h3SidebarWidth:v1",
  "h3WorkspaceHeight:v1",
  "h3InspectorTab:v1",
  "h3BatchDraft:v1:",
  "h3BatchRuntime:v1",
  "h3LatestOutput:v1"
]);

export function assertPromptHistoryKeyIsolated(key = PROMPT_HISTORY_KEY) {
  if (PROMPT_HISTORY_RESERVED.includes(key)) {
    throw new Error(`prompt history key collides with reserved key: ${key}`);
  }
  if (String(key).startsWith("h3BatchDraft:v1")) {
    throw new Error(`prompt history key collides with batch draft prefix: ${key}`);
  }
  return true;
}

function readRaw(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(PROMPT_HISTORY_KEY) || "null");
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

function writeRaw(storage, items) {
  storage?.setItem?.(PROMPT_HISTORY_KEY, JSON.stringify({ version: 1, items }));
  return items;
}

export function listPromptHistory(storage) {
  return readRaw(storage).map(item => ({ ...item }));
}

export function archivePrompt(entry = {}, { storage, now = Date.now, max = PROMPT_HISTORY_MAX } = {}) {
  assertPromptHistoryKeyIsolated();
  const prompt = String(entry.prompt || "").trim();
  if (!prompt || !storage) return listPromptHistory(storage);
  const items = readRaw(storage);
  const existing = items.findIndex(item => item.prompt === prompt);
  const record = {
    id: existing >= 0 ? items[existing].id : `ph-${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    prompt,
    savedAt: now(),
    projectLabel: String(entry.projectLabel || ""),
    workflowLabel: String(entry.workflowLabel || "")
  };
  if (existing >= 0) items.splice(existing, 1);
  items.unshift(record);
  return writeRaw(storage, items.slice(0, max));
}

export function previewPrompt(text, { max = 96 } = {}) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function restorePrompt(id, storage) {
  const item = readRaw(storage).find(entry => entry.id === id);
  return item ? { ...item, generate: false, queue: false, armBatch: false, armQueuedNext: false } : null;
}

export function deletePromptHistoryItem(id, storage) {
  const items = readRaw(storage).filter(entry => entry.id !== id);
  return writeRaw(storage, items);
}

export function clearPromptHistory(storage, { confirm = true } = {}) {
  if (!confirm) return listPromptHistory(storage);
  writeRaw(storage, []);
  return [];
}

export function confirmClearPrompt({ prompt, confirmFn } = {}) {
  const text = String(prompt || "").trim();
  if (!text) return { cleared: false, reason: "empty" };
  if (typeof confirmFn === "function" && !confirmFn()) return { cleared: false, reason: "cancelled" };
  return { cleared: true, archived: text };
}
