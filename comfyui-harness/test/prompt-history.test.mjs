import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROMPT_HISTORY_KEY,
  PROMPT_HISTORY_MAX,
  archivePrompt,
  assertPromptHistoryKeyIsolated,
  clearPromptHistory,
  confirmClearPrompt,
  deletePromptHistoryItem,
  listPromptHistory,
  restorePrompt
} from "../public/prompt-history.mjs";
import { RECOVERY_DRAFT_KEY } from "../public/autosave.mjs";
import { PROMPT_HEIGHT_KEY, MONITOR_HEIGHT_KEY } from "../public/panel-resize.mjs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; }
  };
}

test("clear button exists and empty/cancel/confirm paths work", () => {
  assert.match(html, /id="promptClear"/);
  assert.match(html, /Cancella prompt/);
  assert.equal(confirmClearPrompt({ prompt: "   " }).reason, "empty");
  assert.equal(confirmClearPrompt({ prompt: "keep", confirmFn: () => false }).reason, "cancelled");
  assert.equal(confirmClearPrompt({ prompt: "keep", confirmFn: () => true }).cleared, true);
});

test("confirmed archive persists, dedupes, and respects max bound", () => {
  const storage = memoryStorage();
  archivePrompt({ prompt: "A" }, { storage, now: () => 1 });
  archivePrompt({ prompt: "B" }, { storage, now: () => 2 });
  archivePrompt({ prompt: "A" }, { storage, now: () => 3 });
  const items = listPromptHistory(storage);
  assert.equal(items[0].prompt, "A");
  assert.equal(items.length, 2);
  for (let i = 0; i < 40; i += 1) archivePrompt({ prompt: `p${i}` }, { storage, now: () => 10 + i });
  assert.equal(listPromptHistory(storage).length, PROMPT_HISTORY_MAX);
  assert.equal(PROMPT_HISTORY_KEY, "h3PromptHistory:v1");
});

test("restore does not generate, queue, or arm batch", () => {
  const storage = memoryStorage();
  archivePrompt({ prompt: "OLD" }, { storage, now: () => 1 });
  const id = listPromptHistory(storage)[0].id;
  const restored = restorePrompt(id, storage);
  assert.equal(restored.prompt, "OLD");
  assert.equal(restored.generate, false);
  assert.equal(restored.queue, false);
  assert.equal(restored.armBatch, false);
  assert.equal(restored.armQueuedNext, false);
  const restoreHandler = app.slice(app.indexOf("Ripristina"), app.indexOf("Ripristina") + 500);
  assert.doesNotMatch(restoreHandler, /\/api\/queue/);
  assert.doesNotMatch(restoreHandler, /armQueuedNext|armDeferredBatch|tryImmediateGenerate/);
});

test("delete item and clear history", () => {
  const storage = memoryStorage();
  archivePrompt({ prompt: "A" }, { storage, now: () => 1 });
  archivePrompt({ prompt: "B" }, { storage, now: () => 2 });
  deletePromptHistoryItem(listPromptHistory(storage)[0].id, storage);
  assert.equal(listPromptHistory(storage).length, 1);
  assert.equal(clearPromptHistory(storage, { confirm: false }).length, 1);
  assert.equal(clearPromptHistory(storage, { confirm: true }).length, 0);
});

test("history key does not collide with recovery or resize keys", () => {
  assert.equal(assertPromptHistoryKeyIsolated(), true);
  assert.notEqual(PROMPT_HISTORY_KEY, RECOVERY_DRAFT_KEY);
  assert.notEqual(PROMPT_HISTORY_KEY, PROMPT_HEIGHT_KEY);
  assert.notEqual(PROMPT_HISTORY_KEY, MONITOR_HEIGHT_KEY);
});
