/**
 * Issue #59 second-pass: future queued job input-role editing until claim.
 * Pure helpers + update-entry path; no live /api/queue or /prompt.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QUEUE_ENTRY_STATE,
  appendQueueEntry,
  canEditQueueEntry,
  createQueueEntryFromDraft,
  updateQueueEntry
} from "../lib/batch-queue-plan.mjs";
import { serializeBatchDraft } from "../lib/batch-draft.mjs";
import { createBatchQueueRuntimeService } from "../lib/batch-queue-service.mjs";
import { resolveEffectiveFirstFrame } from "../public/first-frame-view.mjs";
import {
  appendQueueJobInputSection,
  buildSavedQueueJobItem,
  cloneQueueJobDraft,
  resolveQueueJobEffectiveRoleFilename,
  setQueueItemFileOverride
} from "../public/batch-queue-job-input.mjs";

const batchQueueUi = readFileSync(new URL("../public/batch-queue-ui.mjs", import.meta.url), "utf8");
const queueInput = readFileSync(new URL("../public/batch-queue-job-input.mjs", import.meta.url), "utf8");

const sampleSource = {
  workflowId: "minimax-h3-i2v",
  workflowLabel: "I2V",
  model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
  files: { firstImage: "S01.png" },
  requiredKeys: ["firstImage"],
  attachmentRoles: [{ key: "firstImage", label: "First frame", accept: "image/*" }],
  base: { prompt: "base", seed: "1", duration: "10", steps: "20", megapixels: "0.7", aspect: "16:9" }
};

function sampleDraft(jobCount = 8) {
  return serializeBatchDraft({
    source: sampleSource,
    items: Array.from({ length: jobCount }, (_, i) => ({
      prompt: `PROMPT ${i + 1}`,
      seed: String(i + 1),
      duration: "10",
      steps: "20",
      megapixels: "0.7",
      aspect: "16:9"
    }))
  });
}

function effectiveFirstImage(snapshot, jobIndex) {
  const item = snapshot.items[jobIndex];
  return resolveEffectiveFirstFrame({
    itemFiles: item.files,
    sharedFiles: snapshot.source.files
  }).filename;
}

test("queued job 1 starts with effective firstImage S01 from shared binding", () => {
  const entry = createQueueEntryFromDraft(sampleDraft(8), { queueEntryId: "e1", order: 1 });
  const plan = appendQueueEntry(null, entry).plan;
  const snapshot = plan.entries[0].snapshot;
  assert.equal(snapshot.items[0].files, undefined);
  assert.equal(effectiveFirstImage(snapshot, 0), "S01.png");
});

test("human override S01→S02 persists in queued snapshot via update-entry", () => {
  const entry = createQueueEntryFromDraft(sampleDraft(8), { queueEntryId: "e1", order: 1 });
  let plan = appendQueueEntry(null, entry).plan;
  const job0 = plan.entries[0].snapshot.items[0];
  const draftItem = cloneQueueJobDraft(job0);
  draftItem.files = setQueueItemFileOverride(draftItem.files, "firstImage", "S02.png");
  const saved = buildSavedQueueJobItem(job0, draftItem);
  const items = plan.entries[0].snapshot.items.map((item, index) => (
    index === 0 ? saved : item
  ));
  const updated = updateQueueEntry(plan, "e1", {
    snapshot: { ...plan.entries[0].snapshot, items }
  });
  assert.equal(updated.ok, true);
  const snap = updated.plan.entries[0].snapshot;
  assert.equal(snap.items[0].files.firstImage, "S02.png");
  assert.equal(effectiveFirstImage(snap, 0), "S02.png");
});

test("returning to shared binding removes item override and resolves source.files", () => {
  const entry = createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e1", order: 1 });
  let plan = appendQueueEntry(null, entry).plan;
  let job = plan.entries[0].snapshot.items[0];
  let draft = cloneQueueJobDraft(job);
  draft.files = setQueueItemFileOverride(draft.files, "firstImage", "S02.png");
  job = buildSavedQueueJobItem(job, draft);
  plan = updateQueueEntry(plan, "e1", {
    snapshot: { ...plan.entries[0].snapshot, items: [job] }
  }).plan;

  draft = cloneQueueJobDraft(plan.entries[0].snapshot.items[0]);
  draft.files = setQueueItemFileOverride(draft.files, "firstImage", "");
  job = buildSavedQueueJobItem(plan.entries[0].snapshot.items[0], draft);
  const result = updateQueueEntry(plan, "e1", {
    snapshot: { ...plan.entries[0].snapshot, items: [job] }
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.entries[0].snapshot.items[0].files, undefined);
  assert.equal(effectiveFirstImage(result.plan.entries[0].snapshot, 0), "S01.png");
});

test("eight queued jobs can hold eight distinct effective first frames", () => {
  const entry = createQueueEntryFromDraft(sampleDraft(8), { queueEntryId: "e1", order: 1 });
  let plan = appendQueueEntry(null, entry).plan;
  const items = plan.entries[0].snapshot.items.map((item, index) => {
    const name = `S${String(index + 1).padStart(2, "0")}.png`;
    if (index === 0) return item;
    return buildSavedQueueJobItem(item, {
      ...item,
      files: setQueueItemFileOverride(null, "firstImage", name)
    });
  });
  plan = updateQueueEntry(plan, "e1", {
    snapshot: { ...plan.entries[0].snapshot, items }
  }).plan;
  const names = items.map((_, index) => effectiveFirstImage(plan.entries[0].snapshot, index));
  assert.deepEqual(names, [
    "S01.png", "S02.png", "S03.png", "S04.png",
    "S05.png", "S06.png", "S07.png", "S08.png"
  ]);
});

test("queue job input editor uses selectors and save preserves draft files", () => {
  assert.match(batchQueueUi, /appendQueueJobInputSection/);
  assert.match(batchQueueUi, /buildSavedQueueJobItem/);
  assert.doesNotMatch(batchQueueUi, /solo lettura/);
  assert.match(queueInput, /Usa input condiviso:/);
  const saveSlice = batchQueueUi.slice(
    batchQueueUi.indexOf("saveBtn.addEventListener"),
    batchQueueUi.indexOf("saveBtn.addEventListener") + 320
  );
  assert.doesNotMatch(saveSlice, /files:\s*item\.files/);
});

test("save/update-entry path does not call /api/queue or Comfy /prompt", () => {
  const editorSlice = batchQueueUi.slice(
    batchQueueUi.indexOf("function appendJobEditor"),
    batchQueueUi.indexOf("function getQueueAssetContext")
  );
  assert.doesNotMatch(editorSlice, /\/api\/queue/);
  assert.doesNotMatch(editorSlice, /\/prompt/);
  const updateSlice = batchQueueUi.slice(
    batchQueueUi.indexOf("async function updateEntry"),
    batchQueueUi.indexOf("async function cancelEntry")
  );
  assert.match(updateSlice, /\/api\/batch-queue\/update-entry/);
  assert.doesNotMatch(updateSlice, /\/api\/queue/);
  assert.doesNotMatch(updateSlice, /\/prompt/);
});

test("RUNNING/claimed entry is immutable for firstImage edits", async () => {
  const service = createBatchQueueRuntimeService({
    submitJob: async (_input, meta) => ({ prompt_id: `pid-${meta.queueJobId}` }),
    fetchQueueCounts: async () => ({ running: 0, pending: 0 }),
    fetchHistoryState: async () => "running",
    fetchActivePromptId: async () => null,
    registerOwnership: () => {},
    persistDescriptivePlan: async () => {}
  });
  let plan = appendQueueEntry(null, createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e1", order: 1 })).plan;
  plan = appendQueueEntry(plan, createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e2", order: 2 })).plan;
  await service.arm({ projectId: "p1", plan });
  await service.tickProject("p1");
  const live = service.getRuntime("p1");
  const running = live.entries[0];
  assert.equal(running.state, QUEUE_ENTRY_STATE.RUNNING);
  assert.equal(canEditQueueEntry(running), false);

  const editRunning = service.updateEntry({
    projectId: "p1",
    queueEntryId: running.queueEntryId,
    expectedRevision: live.revision,
    patch: {
      snapshot: {
        ...running.snapshot,
        items: running.snapshot.items.map(item => ({
          ...item,
          files: { firstImage: "HACK.png" }
        }))
      }
    }
  });
  assert.equal(editRunning.ok, false);
  assert.equal(editRunning.code, "immutable");
  assert.doesNotMatch(batchQueueUi, /appendJobEditor\(editorWrap, entry, jobIndex\)[\s\S]{0,200}RUNNING/);
});

test("normal CODA UI has no raw item.files / source.files JSON editor", () => {
  assert.doesNotMatch(batchQueueUi, /First-frame \/ ruoli \(solo lettura\)/);
  assert.match(batchQueueUi, /Dettagli tecnici/);
  assert.match(batchQueueUi, /batch-queue-tech-details/);
  const bodySlice = batchQueueUi.slice(
    batchQueueUi.indexOf("function appendJobEditor"),
    batchQueueUi.indexOf("function getQueueAssetContext")
  );
  assert.doesNotMatch(bodySlice, /textarea[\s\S]{0,120}item\.files/);
  assert.doesNotMatch(bodySlice, /input[\s\S]{0,80}source\.files/);
});

test("role selector DOM updates draft and shows effective filename", () => {
  const doc = {
    createElement(tag) {
      const el = {
        tagName: tag,
        className: "",
        textContent: "",
        dataset: {},
        children: [],
        append(...nodes) { this.children.push(...nodes); },
        addEventListener(type, fn) {
          if (type === "change") el._onChange = fn;
        },
        _onChange: null
      };
      if (tag === "select") {
        el.value = "";
        el.append = function(...nodes) {
          this.children.push(...nodes);
          this.options = this.children.filter(node => node.tagName === "OPTION");
        };
      }
      return el;
    }
  };
  globalThis.Option = class Option {
    constructor(label, value, defaultSelected, selected) {
      this.label = label;
      this.value = value;
      this.textContent = label;
      this.tagName = "OPTION";
      this.selected = selected;
      this.defaultSelected = defaultSelected;
    }
  };

  const body = { children: [], append(node) { this.children.push(node); } };
  const draftItem = cloneQueueJobDraft({ prompt: "P1", seed: "1", duration: "10", steps: "20", megapixels: "0.7", aspect: "16:9" });
  appendQueueJobInputSection(doc, body, {
    source: sampleSource,
    item: draftItem,
    library: { groups: [] },
    draftItem
  });
  const section = body.children[0];
  const roleLabel = section.children.find(node => node.className === "batch-queue-job-input-role");
  const select = roleLabel.children.find(node => node.tagName === "select");
  select.value = "S02.png";
  select._onChange();
  assert.equal(draftItem.files.firstImage, "S02.png");
  assert.equal(
    resolveQueueJobEffectiveRoleFilename({ source: sampleSource, item: draftItem, roleKey: "firstImage" }),
    "S02.png"
  );
  select.value = "";
  select._onChange();
  assert.equal(draftItem.files, undefined);
  assert.equal(
    resolveQueueJobEffectiveRoleFilename({ source: sampleSource, item: draftItem, roleKey: "firstImage" }),
    "S01.png"
  );
});

test("stale revision on input binding edit remains rejected at runtime", async () => {
  const service = createBatchQueueRuntimeService({
    submitJob: async () => ({ prompt_id: "pid-x" }),
    fetchQueueCounts: async () => ({ running: 0, pending: 0 }),
    fetchHistoryState: async () => "completed",
    fetchActivePromptId: async () => null,
    registerOwnership: () => {},
    persistDescriptivePlan: async () => {}
  });
  const plan = appendQueueEntry(
    null,
    createQueueEntryFromDraft(sampleDraft(1), { queueEntryId: "e1", order: 1 })
  ).plan;
  await service.syncPlan({ projectId: "p1", plan });
  const live = service.getRuntime("p1");
  const stale = service.updateEntry({
    projectId: "p1",
    queueEntryId: "e1",
    expectedRevision: live.revision - 1,
    patch: {
      snapshot: {
        ...live.entries[0].snapshot,
        items: [{
          ...live.entries[0].snapshot.items[0],
          files: { firstImage: "S02.png" }
        }]
      }
    }
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "stale-revision");
  const fresh = service.updateEntry({
    projectId: "p1",
    queueEntryId: "e1",
    expectedRevision: live.revision,
    patch: {
      snapshot: {
        ...live.entries[0].snapshot,
        items: [{
          ...live.entries[0].snapshot.items[0],
          files: { firstImage: "S02.png" }
        }]
      }
    }
  });
  assert.equal(fresh.ok, true);
  const after = service.getRuntime("p1");
  assert.equal(
    after.entries[0].snapshot.items[0].files.firstImage,
    "S02.png"
  );
});
