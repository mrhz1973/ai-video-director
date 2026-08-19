import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const MAX_FIELD_LEN = 120;

export function sanitizeLogValue(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/^[A-Za-z]:[\\/]/.test(text) || text.includes(":\\Users\\") || text.includes(":/Users/")) return "[path]";
  if (text.length > MAX_FIELD_LEN) return `${text.slice(0, 8)}…`;
  return text;
}

export function formatLogLine(level, event, fields = {}) {
  const ts = new Date().toISOString();
  const extras = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${sanitizeLogValue(value)}`)
    .join(" ");
  return `${ts} ${level.toUpperCase()} ${event}${extras ? ` ${extras}` : ""}\n`;
}

export function createLogger(logPath) {
  const queue = [];
  let writing = false;

  const drain = async () => {
    if (writing || !queue.length) return;
    writing = true;
    try {
      await mkdir(path.dirname(logPath), { recursive: true });
      const chunk = queue.splice(0, queue.length).join("");
      await appendFile(logPath, chunk, "utf8");
    } catch {
      // Logging must never interrupt generation or request handling.
    } finally {
      writing = false;
      if (queue.length) drain();
    }
  };

  const log = (level, event, fields) => {
    queue.push(formatLogLine(level, event, fields));
    drain();
  };

  return {
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
  };
}
