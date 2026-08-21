import test from "node:test";
import assert from "node:assert/strict";
import {
  clampBatchCount,
  createBatchItems,
  duplicateBatchItem,
  moveBatchItem,
  removeBatchItem,
  submitBatchSequentially,
  summarizeBatchJobs,
  validateBatchDraft
} from "../public/batch-core.mjs";

test("batch count clamps to 2–8 and four-item draft increments seed", () => {
  assert.equal(clampBatchCount(1), 2);
  assert.equal(clampBatchCount(9), 8);
  const items = createBatchItems({ prompt: "x", seed: 100, duration: 15, steps: 20, megapixels: 0.3, aspect: "16:9" }, 4);
  assert.equal(items.length, 4);
  assert.deepEqual(items.map(item => item.seed), ["100", "101", "102", "103"]);
  assert.ok(items.every(item => item.prompt === "x" && item.duration === "15"));
});

test("duplicate, move and remove preserve deterministic order and limits", () => {
  const base = createBatchItems({ prompt: "p", seed: 10 }, 3);
  const duplicated = duplicateBatchItem(base, 1);
  assert.equal(duplicated.length, 4);
  assert.equal(duplicated[2].seed, "12");
  const moved = moveBatchItem(duplicated, 2, 0);
  assert.equal(moved[0].seed, "12");
  const removed = removeBatchItem(moved, 0);
  assert.equal(removed.length, 3);
  const minimum = createBatchItems({ prompt: "p" }, 2);
  assert.equal(removeBatchItem(minimum, 0).length, 2);
});

test("batch preflight blocks safe-fit, missing inputs, video roles and invalid job fields", () => {
  const items = createBatchItems({ prompt: "ok", seed: 1, duration: 15, steps: 20, megapixels: 0.3, aspect: "16:9" }, 4);
  let result = validateBatchDraft({ items, safeFitStatus: "needs-apply", requiredFiles: { firstImage: "a.png" }, requiredKeys: ["firstImage"] });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /image-fit/);

  result = validateBatchDraft({ items, requiredFiles: {}, requiredKeys: ["firstImage"] });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /firstImage/);

  result = validateBatchDraft({ items, requiredFiles: { firstImage: "a.png" }, requiredKeys: ["firstImage"], unsupportedVideoRoles: ["Motion video"] });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Motion video/);

  const broken = items.map(item => ({ ...item }));
  broken[2].prompt = "";
  broken[3].megapixels = "99";
  result = validateBatchDraft({ broken, items: broken, requiredFiles: { firstImage: "a.png" }, requiredKeys: ["firstImage"] });
  assert.equal(result.valid, false);
  assert.equal(result.perItem.length, 2);
});

test("valid four-job I2VA-style batch passes preflight", () => {
  const items = createBatchItems({ prompt: "variant", seed: 628211386369716, duration: 15, steps: 20, megapixels: 0.3, aspect: "16:9" }, 4);
  const result = validateBatchDraft({
    items,
    safeFitStatus: "safe",
    requiredFiles: { firstImage: "source.png" },
    requiredKeys: ["firstImage"]
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("sequential submit sends exactly once per item in deterministic order", async () => {
  const items = createBatchItems({ prompt: "p", seed: 10 }, 4);
  const calls = [];
  const result = await submitBatchSequentially(items, async (item, index) => {
    calls.push({ index, seed: item.seed });
    return { prompt_id: `prompt-${index}` };
  });
  assert.equal(result.complete, true);
  assert.deepEqual(calls.map(call => call.index), [0, 1, 2, 3]);
  assert.equal(calls.length, 4);
  assert.deepEqual(result.accepted.map(item => item.prompt_id), ["prompt-0", "prompt-1", "prompt-2", "prompt-3"]);
  assert.deepEqual(result.notSubmitted, []);
});

test("partial submit stops immediately, never retries, and reports remaining jobs", async () => {
  const items = createBatchItems({ prompt: "p", seed: 20 }, 4);
  const calls = [];
  const result = await submitBatchSequentially(items, async (_item, index) => {
    calls.push(index);
    if (index === 2) throw new Error("injected submit failure");
    return { prompt_id: `prompt-${index}` };
  });
  assert.equal(result.complete, false);
  assert.deepEqual(calls, [0, 1, 2]);
  assert.deepEqual(result.accepted.map(item => item.index), [0, 1]);
  assert.deepEqual(result.failure, { index: 2, error: "injected submit failure" });
  assert.deepEqual(result.notSubmitted, [2, 3]);
});

test("batch summary keeps terminal and pending states distinct", () => {
  assert.deepEqual(summarizeBatchJobs([
    { state: "completed" },
    { state: "running" },
    { state: "pending" },
    { state: "error" },
    { state: "interrupted" },
    { state: "not-submitted" }
  ]), {
    total: 6,
    completed: 1,
    running: 1,
    pending: 1,
    failed: 1,
    interrupted: 1,
    notSubmitted: 1
  });
});
