import test from "node:test";
import assert from "node:assert/strict";
import {
  clampBatchCount,
  collectUnavailableExplicitBatchOverrides,
  createBatchItems,
  duplicateBatchItem,
  isExplicitBatchFileOverrideAvailable,
  moveBatchItem,
  removeBatchItem,
  resolveBatchItemFiles,
  submitBatchSequentially,
  summarizeBatchJobs,
  validateBatchDraft
} from "../public/batch-core.mjs";
import { createGroup, createMember } from "../lib/projects.mjs";

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
  assert.match(result.errors.join(" "), /Job 1: input firstImage mancante/);

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

test("resolveBatchItemFiles merges sparse overrides over shared fallback", () => {
  const shared = { firstImage: "frame-shared.png", audio: "bed.wav" };
  assert.deepEqual(resolveBatchItemFiles({}, shared), shared);
  assert.deepEqual(
    resolveBatchItemFiles({ files: { firstImage: "frame-b.png" } }, shared),
    { firstImage: "frame-b.png", audio: "bed.wav" }
  );
  assert.deepEqual(
    resolveBatchItemFiles({ files: { firstImage: "frame-a.png" } }, shared),
    { firstImage: "frame-a.png", audio: "bed.wav" }
  );
});

test("Job A and Job B can resolve different firstImage filenames", () => {
  const shared = { firstImage: "frame-shared.png" };
  const jobA = { prompt: "a", seed: "1", duration: "10", steps: "20", megapixels: "0.3", aspect: "16:9", files: { firstImage: "frame-a.png" } };
  const jobB = { prompt: "b", seed: "2", duration: "10", steps: "20", megapixels: "0.3", aspect: "16:9", files: { firstImage: "frame-b.png" } };
  assert.equal(resolveBatchItemFiles(jobA, shared).firstImage, "frame-a.png");
  assert.equal(resolveBatchItemFiles(jobB, shared).firstImage, "frame-b.png");
  const result = validateBatchDraft({
    items: [jobA, jobB],
    sharedFiles: shared,
    requiredKeys: ["firstImage"],
    roleLabels: { firstImage: "First Frame" }
  });
  assert.equal(result.valid, true);
});

test("duplicate copies file overrides without shared object references", () => {
  const items = createBatchItems({ prompt: "p", seed: 1 }, 2);
  items[0].files = { firstImage: "frame-a.png" };
  const duplicated = duplicateBatchItem(items, 0);
  assert.deepEqual(duplicated[1].files, { firstImage: "frame-a.png" });
  assert.notEqual(duplicated[1].files, duplicated[0].files);
  duplicated[1].files.firstImage = "frame-b.png";
  assert.equal(duplicated[0].files.firstImage, "frame-a.png");
});

test("move preserves per-job file bindings", () => {
  const items = createBatchItems({ prompt: "p", seed: 1 }, 3);
  items[0].files = { firstImage: "frame-a.png" };
  items[2].files = { firstImage: "frame-c.png" };
  const moved = moveBatchItem(items, 2, 0);
  assert.equal(moved[0].files.firstImage, "frame-c.png");
  assert.equal(moved[1].files.firstImage, "frame-a.png");
  assert.equal(moved[2].files, undefined);
});

test("per-job missing required input fails preflight for that job", () => {
  const items = createBatchItems({ prompt: "ok", seed: 1, duration: 10, steps: 20, megapixels: 0.3, aspect: "16:9" }, 3);
  items[0].files = { firstImage: "frame-a.png" };
  items[2].files = { firstImage: "frame-c.png" };
  const result = validateBatchDraft({
    items,
    sharedFiles: {},
    requiredKeys: ["firstImage"],
    roleLabels: { firstImage: "First Frame" }
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Job 2: input First Frame mancante/);
  assert.ok(!result.errors.some(error => /Job 1:/.test(error)));
  assert.ok(!result.errors.some(error => /Job 3:/.test(error)));
});

test("stale explicit binding fails closed", () => {
  const items = createBatchItems({ prompt: "ok", seed: 1, duration: 10, steps: 20, megapixels: 0.3, aspect: "16:9" }, 2);
  items[0].files = { firstImage: "frame-gone.png" };
  const result = validateBatchDraft({
    items,
    sharedFiles: { firstImage: "frame-shared.png" },
    requiredKeys: ["firstImage"],
    roleLabels: { firstImage: "First Frame" },
    unavailableFiles: new Set(["frame-gone.png"])
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Job 1: input First Frame non disponibile/);
  assert.ok(!result.errors.some(error => /Job 2:/.test(error)));
});

test("orphan explicit override absent from library fails closed without shared fallback", () => {
  const library = {
    elements: [createGroup({
      label: "Frames",
      members: [createMember({ filename: "frame-a.png", originalName: "frame-a.png", type: "image" })]
    })],
    locations: [],
    objects: [],
    audio: []
  };
  const attachmentRoles = [{ key: "firstImage", label: "First Frame", accept: "image/*" }];
  const items = createBatchItems({ prompt: "ok", seed: 1, duration: 10, steps: 20, megapixels: 0.3, aspect: "16:9" }, 2);
  items[0].files = { firstImage: "frame-gone.png" };
  // Job 2 inherits shared frame-a.png which remains in the library.

  assert.equal(
    isExplicitBatchFileOverrideAvailable({
      filename: "frame-gone.png",
      roleKey: "firstImage",
      library,
      attachmentRoles
    }),
    false
  );
  assert.ok(collectUnavailableExplicitBatchOverrides({
    items,
    attachmentRoles,
    library
  }).has("frame-gone.png"));

  const result = validateBatchDraft({
    items,
    sharedFiles: { firstImage: "frame-a.png" },
    requiredKeys: ["firstImage"],
    roleLabels: { firstImage: "First Frame" },
    attachmentRoles,
    library,
    unavailableFiles: new Set()
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Job 1: input First Frame non disponibile/);
  assert.ok(!result.errors.some(error => /Job 2:/.test(error)));
  assert.equal(resolveBatchItemFiles(items[0], { firstImage: "frame-a.png" }).firstImage, "frame-gone.png");
});

test("explicit incompatible media kind for role fails closed", () => {
  const library = {
    elements: [createGroup({
      label: "Frames",
      members: [createMember({ filename: "frame-a.png", originalName: "frame-a.png", type: "image" })]
    })],
    locations: [],
    objects: [],
    audio: [createGroup({
      label: "Beds",
      members: [createMember({ filename: "bed.wav", originalName: "bed.wav", type: "audio" })]
    })]
  };
  const attachmentRoles = [{ key: "firstImage", label: "First Frame", accept: "image/*" }];
  const items = createBatchItems({ prompt: "ok", seed: 1, duration: 10, steps: 20, megapixels: 0.3, aspect: "16:9" }, 2);
  items[0].files = { firstImage: "bed.wav" };
  const result = validateBatchDraft({
    items,
    sharedFiles: { firstImage: "frame-a.png" },
    requiredKeys: ["firstImage"],
    roleLabels: { firstImage: "First Frame" },
    attachmentRoles,
    library
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Job 1: input First Frame non disponibile/);
  assert.ok(!result.errors.some(error => /Job 2:/.test(error)));
});

test("valid explicit library asset and inherited shared asset both pass", () => {
  const library = {
    elements: [createGroup({
      label: "Frames",
      members: [
        createMember({ filename: "frame-a.png", originalName: "frame-a.png", type: "image" }),
        createMember({ filename: "frame-b.png", originalName: "frame-b.png", type: "image" })
      ]
    })],
    locations: [],
    objects: [],
    audio: []
  };
  const attachmentRoles = [{ key: "firstImage", label: "First Frame", accept: "image/*" }];
  const items = createBatchItems({ prompt: "ok", seed: 1, duration: 10, steps: 20, megapixels: 0.3, aspect: "16:9" }, 2);
  items[0].files = { firstImage: "frame-b.png" };
  const result = validateBatchDraft({
    items,
    sharedFiles: { firstImage: "frame-a.png" },
    requiredKeys: ["firstImage"],
    roleLabels: { firstImage: "First Frame" },
    attachmentRoles,
    library
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
    cancelled: 0,
    interrupting: 0,
    notSubmitted: 1
  });
});
