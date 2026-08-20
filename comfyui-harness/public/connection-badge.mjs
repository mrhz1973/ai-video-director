/**
 * Semantic ComfyUI connection badge. Color reinforces text; text is required.
 *
 * @param {string} state SSE/WS or UI label
 * @returns {{ state: "open" | "connecting" | "reconnecting" | "closed", text: string, className: string }}
 */
export function connectionBadge(state) {
  const raw = String(state || "").trim();
  const lower = raw.toLowerCase();

  if (
    lower === "closed" ||
    lower === "error" ||
    lower === "disconnected" ||
    lower.includes("scollegato")
  ) {
    return { state: "closed", text: "ComfyUI scollegato", className: "status-bad" };
  }

  if (
    lower === "open" ||
    lower === "connected" ||
    (lower.includes("collegato") && !lower.includes("scollegato"))
  ) {
    return { state: "open", text: "ComfyUI collegato", className: "status-ok" };
  }

  if (
    lower === "reconnect" ||
    lower === "reconnecting" ||
    lower.includes("riconness")
  ) {
    return { state: "reconnecting", text: "Riconnessione…", className: "status-wait" };
  }

  return { state: "connecting", text: "Connessione…", className: "status-wait" };
}
