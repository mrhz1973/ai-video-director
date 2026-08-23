/**
 * Compact non-blocking Harness notifications (replaces legacy #log activity feed).
 */

const HOST_ID = "appNotices";
const DEFAULT_INFO_TTL_MS = 4500;
const DEFAULT_ERROR_TTL_MS = 12000;

function ensureHost() {
  let host = document.getElementById(HOST_ID);
  if (host) return host;
  host = document.createElement("div");
  host.id = HOST_ID;
  host.className = "app-notices";
  host.setAttribute("aria-live", "polite");
  host.setAttribute("aria-relevant", "additions");
  document.body.append(host);
  return host;
}

/**
 * @param {string} message
 * @param {{ kind?: "info"|"warn"|"error"|"system", ttl?: number|null }} [options]
 */
export function showAppNotice(message, { kind = "info", ttl } = {}) {
  const text = String(message || "").trim();
  if (!text || typeof document === "undefined") return null;
  const host = ensureHost();
  const node = document.createElement("div");
  const tone = ["info", "warn", "error", "system"].includes(kind) ? kind : "info";
  node.className = `app-notice app-notice-${tone}`;
  node.setAttribute("role", tone === "error" ? "alert" : "status");
  node.textContent = text;
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "app-notice-dismiss";
  dismiss.setAttribute("aria-label", "Chiudi");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", () => node.remove());
  node.append(dismiss);
  host.prepend(node);

  const autoTtl = ttl === null
    ? null
    : Number.isFinite(ttl)
      ? ttl
      : (tone === "error" ? DEFAULT_ERROR_TTL_MS : DEFAULT_INFO_TTL_MS);
  if (autoTtl != null && autoTtl > 0) {
    window.setTimeout(() => {
      if (node.isConnected) node.remove();
    }, autoTtl);
  }
  return node;
}

export function clearAppNotices() {
  document.getElementById(HOST_ID)?.replaceChildren();
}
