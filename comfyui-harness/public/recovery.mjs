export const POLL_INTERVAL_MS = 4000;

export function historyMessageTypes(entry) {
  return (entry?.status?.messages || [])
    .filter(message => Array.isArray(message) && message[0])
    .map(message => message[0]);
}

export function isPromptComplete(history, promptId) {
  const entry = history?.[promptId];
  if (!entry?.outputs) return false;
  return Object.keys(entry.outputs).length > 0;
}

export function classifyHistoryState(history, promptId) {
  const entry = history?.[promptId];
  if (!entry) return "unknown";

  const messageTypes = historyMessageTypes(entry);
  if (messageTypes.includes("execution_error") || messageTypes.includes("execution_interrupted")) return "failed";
  if (entry.status?.status_str === "error") return "failed";
  if (isPromptComplete(history, promptId)) return "completed";
  return "unknown";
}

export function historyFailureLabel(history, promptId) {
  const messageTypes = historyMessageTypes(history?.[promptId]);
  return messageTypes.includes("execution_interrupted") ? "interrupted" : "failed";
}

export function promptIdPrefix(promptId) {
  return promptId ? String(promptId).slice(0, 8) : "";
}
