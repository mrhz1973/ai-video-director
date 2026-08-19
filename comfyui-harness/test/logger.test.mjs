import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLogger, formatLogLine, sanitizeLogValue } from "../lib/logger.mjs";

test("sanitizeLogValue redacts private paths and truncates long values", () => {
  assert.equal(sanitizeLogValue("C:\\Users\\secret\\file.png"), "[path]");
  assert.equal(sanitizeLogValue("a".repeat(200)).endsWith("…"), true);
  assert.equal(sanitizeLogValue("minimax-h3-i2v"), "minimax-h3-i2v");
});

test("formatLogLine emits compact timestamped events", () => {
  const line = formatLogLine("info", "queue_submit", { workflow: "minimax-h3-i2v" });
  assert.match(line, /^\d{4}-\d{2}-\d{2}T.* INFO queue_submit workflow=minimax-h3-i2v\n$/);
});

test("createLogger appends lines without throwing on invalid path", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "h3-log-"));
  const logPath = path.join(dir, "nested", "harness.log");
  const logger = createLogger(logPath);
  logger.info("harness_start", { version: "0.4.0" });
  logger.error("history_fetch", { status: 500 });
  await new Promise(resolve => setTimeout(resolve, 25));
  const contents = await readFile(logPath, "utf8");
  assert.match(contents, /INFO harness_start version=0\.4\.0/);
  assert.match(contents, /ERROR history_fetch status=500/);
});
