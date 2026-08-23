import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SESSION_OUTPUTS_KEY,
  attachArchiveMetadata,
  buildSessionOutputRecords,
  clearSessionOutputs,
  markSessionOutputUnavailable,
  readSessionOutputs,
  sessionGalleryClearSideEffects,
  sessionOutputId,
  upsertSessionOutputs
} from "../public/session-outputs.mjs";

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    raw: data
  };
}

test("session output record creation and identity", () => {
  const records = buildSessionOutputRecords([
    { filename: "clip-a.mp4", url: "/api/view?filename=clip-a.mp4&subfolder=video&type=output", kind: "videos" }
  ], {
    promptId: "p1",
    source: "single",
    seed: "19",
    duration: "6",
    workflowLabel: "I2V",
    completedAt: 1000
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, sessionOutputId({ promptId: "p1", subfolder: "video", filename: "clip-a.mp4" }));
  assert.equal(records[0].filename, "clip-a.mp4");
  assert.equal(records[0].subfolder, "video");
  assert.equal(records[0].seed, "19");
});

test("dedupe by prompt/output identity", () => {
  const storage = memoryStorage();
  const first = buildSessionOutputRecords([
    { filename: "clip.mp4", url: "/api/view?filename=clip.mp4&subfolder=&type=output" }
  ], { promptId: "abc", source: "single", seed: "1", completedAt: 10 });
  upsertSessionOutputs(storage, first);
  upsertSessionOutputs(storage, buildSessionOutputRecords([
    { filename: "clip.mp4", url: "/api/view?filename=clip.mp4&subfolder=&type=output" }
  ], { promptId: "abc", source: "single", seed: "1", completedAt: 20 }));
  assert.equal(readSessionOutputs(storage).length, 1);
});

test("single job and Batch multiple-job collection with attribution", () => {
  const storage = memoryStorage();
  upsertSessionOutputs(storage, buildSessionOutputRecords([
    { filename: "solo.mp4", url: "/api/view?filename=solo.mp4" }
  ], { promptId: "s1", source: "single", seed: "7", completedAt: 1 }));
  for (let index = 0; index < 8; index += 1) {
    upsertSessionOutputs(storage, buildSessionOutputRecords([
      { filename: `job${index}.mp4`, url: `/api/view?filename=job${index}.mp4` }
    ], {
      promptId: `b${index}`,
      source: "batch",
      jobLabel: `Job ${index + 1}`,
      jobIndex: index,
      batchTotal: 8,
      seed: String(19 + index),
      completedAt: 100 + index
    }));
  }
  const items = readSessionOutputs(storage);
  assert.equal(items.length, 9);
  const batch = items.filter(item => item.source === "batch");
  assert.equal(batch.length, 8);
  assert.equal(batch.find(item => item.jobIndex === 3).jobLabel, "Job 4");
  assert.equal(batch.find(item => item.jobIndex === 3).seed, "22");
});

test("F5/sessionStorage round-trip", () => {
  const storage = memoryStorage();
  upsertSessionOutputs(storage, buildSessionOutputRecords([
    { filename: "keep.mp4", url: "/api/view?filename=keep.mp4" }
  ], { promptId: "p", source: "single", completedAt: 5 }));
  const raw = storage.getItem(SESSION_OUTPUTS_KEY);
  const restored = memoryStorage({ [SESSION_OUTPUTS_KEY]: raw });
  assert.equal(readSessionOutputs(restored)[0].filename, "keep.mp4");
});

test("clearing gallery removes metadata only", () => {
  const storage = memoryStorage();
  upsertSessionOutputs(storage, buildSessionOutputRecords([
    { filename: "x.mp4", url: "/api/view?filename=x.mp4" }
  ], { promptId: "p", completedAt: 1 }));
  clearSessionOutputs(storage);
  assert.deepEqual(readSessionOutputs(storage), []);
  assert.deepEqual(sessionGalleryClearSideEffects(), {
    deletesComfyOutputs: false,
    deletesArchives: false,
    modifiesProjects: false,
    queuePosts: 0,
    promptPosts: 0,
    gpuWrites: 0
  });
});

test("archive metadata attaches to the correct output", () => {
  const storage = memoryStorage();
  upsertSessionOutputs(storage, buildSessionOutputRecords([
    { filename: "orig.mp4", subfolder: "video", url: "/api/view?filename=orig.mp4&subfolder=video" }
  ], { promptId: "p9", completedAt: 1 }));
  attachArchiveMetadata(storage, {
    promptId: "p9",
    filename: "orig.mp4",
    subfolder: "video",
    archive: {
      filename: "archived_name.mp4",
      folderLabel: "Escape Sequence",
      archivedAt: 99,
      bytes: 12
    }
  });
  const item = readSessionOutputs(storage)[0];
  assert.equal(item.filename, "orig.mp4");
  assert.equal(item.archive.filename, "archived_name.mp4");
  assert.equal(item.archive.folderLabel, "Escape Sequence");
});

test("empty and unavailable states", () => {
  const storage = memoryStorage();
  assert.deepEqual(readSessionOutputs(storage), []);
  upsertSessionOutputs(storage, buildSessionOutputRecords([
    { filename: "gone.mp4", url: "/api/view?filename=gone.mp4" }
  ], { promptId: "p", completedAt: 1 }));
  const id = readSessionOutputs(storage)[0].id;
  markSessionOutputUnavailable(storage, id);
  assert.equal(readSessionOutputs(storage)[0].available, false);
});

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const outputUi = readFileSync(new URL("../public/output-ui.mjs", import.meta.url), "utf8");
const batchUi = readFileSync(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");

test("legacy activityDrawer and #log dependency are gone", () => {
  assert.doesNotMatch(html, /id="activityDrawer"/);
  assert.doesNotMatch(html, /id="log"/);
  assert.doesNotMatch(app, /\$\("log"\)/);
  assert.match(html, /id="monitorEvents"/);
  assert.match(html, /id="monitorTerminal"/);
  assert.match(html, /id="sessionGalleryList"/);
  assert.match(html, /Destinazione e nomi/);
});

test("important former add\\(\\) errors still have a visible notice path", () => {
  assert.match(app, /showAppNotice/);
  assert.match(app, /Errore salvataggio/);
  assert.match(app, /Generazione fallita/);
});

test("gallery never posts queue or prompt", () => {
  const gallery = readFileSync(new URL("../public/session-outputs.mjs", import.meta.url), "utf8");
  const notify = readFileSync(new URL("../public/notify.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(gallery, /\/api\/queue|\/prompt/);
  assert.doesNotMatch(notify, /\/api\/queue|\/prompt/);
  assert.match(batchUi, /buildSessionOutputRecords/);
  assert.match(app, /buildSessionOutputRecords/);
  assert.match(outputUi, /sessionGalleryClearSideEffects/);
  assert.match(outputUi, /Apri video/);
});
