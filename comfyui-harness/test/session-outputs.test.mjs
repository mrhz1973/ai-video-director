import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LATEST_OUTPUT_KEY, persistLatestOutput, readLatestOutput } from "../public/completion.mjs";
import { createSessionClipCard } from "../public/session-gallery-dom.mjs";
import {
  BATCH_RUNTIME_STORAGE_KEY,
  SESSION_OUTPUTS_KEY,
  SESSION_OUTPUTS_RECONSTRUCTED_KEY,
  applySessionGalleryReconstruction,
  attachArchiveMetadata,
  buildSessionOutputRecords,
  buildSingleJobCompletionAttribution,
  clearSessionOutputs,
  formatSessionClipSettingsLine,
  markSessionOutputUnavailable,
  normalizeSessionOutput,
  readSessionOutputs,
  reconstructSessionOutputRecords,
  reconstructionSideEffects,
  recordsFromBatchRuntime,
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

/** Minimal DOM that forbids innerHTML on elements. */
function fakeDocument() {
  function createElement(tag) {
    const children = [];
    const listeners = [];
    const el = {
      tagName: String(tag).toUpperCase(),
      className: "",
      textContent: "",
      href: "",
      src: "",
      target: "",
      rel: "",
      muted: false,
      playsInline: false,
      preload: "",
      controls: false,
      dataset: {},
      children,
      append(...nodes) {
        for (const node of nodes) children.push(node);
      },
      setAttribute() {},
      addEventListener(type, fn) { listeners.push({ type, fn }); }
    };
    Object.defineProperty(el, "innerHTML", {
      get() { throw new Error("innerHTML get forbidden"); },
      set() { throw new Error("innerHTML set forbidden"); }
    });
    return el;
  }
  return {
    createElement,
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    }
  };
}

function collectText(node, out = []) {
  if (!node) return out;
  if (node.nodeType === 3 || (node.textContent != null && !node.children)) {
    if (node.nodeType === 3) out.push(node.textContent);
    else if (!node.children?.length && node.textContent) out.push(node.textContent);
  }
  if (Array.isArray(node.children)) {
    if (node.textContent && !node.children.length) out.push(node.textContent);
    for (const child of node.children) collectText(child, out);
    // elements with textContent set before children (strong)
    if (node.tagName === "STRONG" || node.tagName === "CODE" || node.tagName === "SPAN" || node.tagName === "A") {
      if (node.textContent) out.push(node.textContent);
    }
  }
  return out;
}

test("completed single job retains promptId after active runtime would be cleared", () => {
  const completedPromptId = "prompt-keep-me";
  // Simulate rememberJob() clearing active prompt before attribution runs.
  let activePrompt = completedPromptId;
  activePrompt = undefined;
  void activePrompt;

  const items = [{
    filename: "solo.mp4",
    subfolder: "video",
    url: "/api/view?filename=solo.mp4&subfolder=video&type=output"
  }];
  const { galleryRecords, completion } = buildSingleJobCompletionAttribution(completedPromptId, items, {
    seed: "11",
    duration: "5",
    megapixels: "0.3",
    aspect: "16:9",
    steps: "20",
    completedAt: 42
  });

  assert.equal(galleryRecords.length, 1);
  assert.equal(galleryRecords[0].promptId, "prompt-keep-me");
  assert.equal(
    galleryRecords[0].id,
    sessionOutputId({ promptId: "prompt-keep-me", subfolder: "video", filename: "solo.mp4" })
  );
  assert.equal(completion.promptId, "prompt-keep-me");

  const session = memoryStorage();
  upsertSessionOutputs(session, galleryRecords);
  persistLatestOutput(completion, session);

  const latest = readLatestOutput(session);
  assert.equal(latest.promptId, "prompt-keep-me");

  attachArchiveMetadata(session, {
    promptId: "prompt-keep-me",
    filename: "solo.mp4",
    subfolder: "video",
    archive: { filename: "copy.mp4", folderLabel: "Proj", archivedAt: 99, bytes: 8 }
  });
  assert.equal(readSessionOutputs(session)[0].archive.filename, "copy.mp4");

  const again = buildSingleJobCompletionAttribution(completedPromptId, items, {
    seed: "11",
    completedAt: 100
  });
  upsertSessionOutputs(session, again.galleryRecords);
  assert.equal(readSessionOutputs(session).length, 1);

  const reconstructed = reconstructSessionOutputRecords({
    latestOutput: readLatestOutput(session)
  });
  assert.equal(reconstructed.length, 1);
  assert.equal(reconstructed[0].promptId, "prompt-keep-me");
  assert.equal(reconstructed[0].id, galleryRecords[0].id);

  assert.deepEqual(reconstructionSideEffects(), {
    scansOutputFolder: false,
    guessesFromFilenames: false,
    queuePosts: 0,
    promptPosts: 0,
    gpuWrites: 0
  });
});

test("session output record creation and identity", () => {
  const records = buildSessionOutputRecords([
    { filename: "clip-a.mp4", url: "/api/view?filename=clip-a.mp4&subfolder=video&type=output", kind: "videos" }
  ], {
    promptId: "p1",
    source: "single",
    seed: "19",
    duration: "6",
    megapixels: "0.3",
    aspect: "16:9",
    steps: "20",
    workflowLabel: "I2V",
    completedAt: 1000
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, sessionOutputId({ promptId: "p1", subfolder: "video", filename: "clip-a.mp4" }));
  assert.equal(records[0].filename, "clip-a.mp4");
  assert.equal(records[0].subfolder, "video");
  assert.equal(records[0].seed, "19");
  assert.equal(records[0].megapixels, "0.3");
  assert.equal(records[0].aspect, "16:9");
  assert.equal(records[0].steps, "20");
});

test("settings survive build -> normalize -> sessionStorage -> read -> render contract", () => {
  const built = buildSessionOutputRecords([
    { filename: "attrib.mp4", url: "/api/view?filename=attrib.mp4" }
  ], {
    promptId: "attr1",
    source: "single",
    seed: "22",
    duration: "5",
    megapixels: "0.3",
    aspect: "16:9",
    steps: "20",
    workflowLabel: "I2VA",
    completedAt: 50
  });
  const storage = memoryStorage();
  upsertSessionOutputs(storage, built);
  const roundTrip = memoryStorage({ [SESSION_OUTPUTS_KEY]: storage.getItem(SESSION_OUTPUTS_KEY) });
  const item = readSessionOutputs(roundTrip)[0];
  assert.equal(item.megapixels, "0.3");
  assert.equal(item.aspect, "16:9");
  assert.equal(item.steps, "20");
  assert.equal(formatSessionClipSettingsLine(item), "seed 22 · 5s · 0.3 MP · 16:9 · 20 steps");
  assert.equal(normalizeSessionOutput(item).workflowLabel, "I2VA");
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
  ], {
    promptId: "s1",
    source: "single",
    seed: "7",
    megapixels: "0.4",
    aspect: "9:16",
    steps: "24",
    completedAt: 1
  }));
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
      megapixels: "0.3",
      aspect: "16:9",
      steps: String(20 + index),
      completedAt: 100 + index
    }));
  }
  const items = readSessionOutputs(storage);
  assert.equal(items.length, 9);
  const batch = items.filter(item => item.source === "batch");
  assert.equal(batch.length, 8);
  const job4 = batch.find(item => item.jobIndex === 3);
  assert.equal(job4.jobLabel, "Job 4");
  assert.equal(job4.seed, "22");
  assert.equal(job4.steps, "23");
  assert.equal(job4.megapixels, "0.3");
  assert.equal(job4.aspect, "16:9");
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

test("authoritative previous Batch metadata reconstructs expected clip records", () => {
  const runtime = {
    version: 1,
    createdAt: 2000,
    workflowId: "i2va",
    workflowLabel: "I2VA",
    model: "model-a",
    jobs: [
      {
        index: 0,
        label: "Job 1",
        promptId: "prompt-job-1",
        state: "completed",
        item: { seed: "19", duration: "5", megapixels: "0.3", aspect: "16:9", steps: "20" },
        outputs: [{ filename: "j1.mp4", url: "/api/view?filename=j1.mp4", subfolder: "video" }]
      },
      {
        index: 1,
        label: "Job 2",
        promptId: "prompt-job-2",
        state: "completed",
        item: { seed: "20", duration: "6", megapixels: "0.4", aspect: "9:16", steps: "22" },
        outputs: [{ filename: "j2.mp4", url: "/api/view?filename=j2.mp4" }]
      }
    ]
  };
  const records = recordsFromBatchRuntime(runtime);
  assert.equal(records.length, 2);
  assert.equal(records[0].jobLabel, "Job 1");
  assert.equal(records[0].seed, "19");
  assert.equal(records[0].megapixels, "0.3");
  assert.equal(records[1].jobLabel, "Job 2");
  assert.equal(records[1].aspect, "9:16");
  assert.equal(records[1].steps, "22");
});

test("prompt IDs preserve correct Job attribution on reconstruction", () => {
  const records = reconstructSessionOutputRecords({
    batchRuntime: {
      version: 1,
      jobs: [
        {
          index: 3,
          label: "Job 4",
          promptId: "pid-4",
          item: { seed: "22", megapixels: "0.3", aspect: "16:9", steps: "20", duration: "5" },
          outputs: [{ filename: "four.mp4", url: "/api/view?filename=four.mp4" }]
        }
      ]
    }
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].promptId, "pid-4");
  assert.equal(records[0].jobIndex, 3);
  assert.equal(records[0].jobLabel, "Job 4");
  assert.equal(records[0].source, "batch");
});

test("reconstructed records dedupe against already stored gallery records", () => {
  const storage = memoryStorage();
  const session = memoryStorage();
  const local = memoryStorage({
    [BATCH_RUNTIME_STORAGE_KEY]: JSON.stringify({
      version: 1,
      jobs: [{
        index: 0,
        label: "Job 1",
        promptId: "same",
        item: { seed: "1", megapixels: "0.3", aspect: "16:9", steps: "20" },
        outputs: [{ filename: "a.mp4", url: "/api/view?filename=a.mp4" }]
      }]
    })
  });
  upsertSessionOutputs(session, buildSessionOutputRecords([
    { filename: "a.mp4", url: "/api/view?filename=a.mp4" }
  ], { promptId: "same", source: "batch", jobLabel: "Job 1", jobIndex: 0, seed: "1", completedAt: 1 }));
  applySessionGalleryReconstruction(session, local);
  assert.equal(readSessionOutputs(session).length, 1);
  applySessionGalleryReconstruction(session, local);
  assert.equal(readSessionOutputs(session).length, 1);
  assert.equal(session.getItem(SESSION_OUTPUTS_RECONSTRUCTED_KEY), "1");
  void storage;
});

test("insufficient metadata produces zero guessed records", () => {
  assert.deepEqual(reconstructSessionOutputRecords({
    batchRuntime: {
      version: 1,
      jobs: [
        { index: 0, label: "Job 1", promptId: "", outputs: [{ filename: "x.mp4", url: "/x" }] },
        { index: 1, label: "Job 2", promptId: "has-id", outputs: [] },
        { index: 2, label: "Job 3", outputs: [{ filename: "y.mp4" }] }
      ]
    },
    latestOutput: { filename: "lonely.mp4", url: "/api/view?filename=lonely.mp4" }
  }), []);
});

test("reconstruction performs no queue/prompt and does not scan output folders", () => {
  const src = readFileSync(new URL("../public/session-outputs.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\/api\/queue/);
  assert.doesNotMatch(src, /["'`]\/prompt["'`]/);
  assert.doesNotMatch(src, /readdir|opendir|scanOutputFolder|output directory scan/i);
  assert.deepEqual(reconstructionSideEffects(), {
    scansOutputFolder: false,
    guessesFromFilenames: false,
    queuePosts: 0,
    promptPosts: 0,
    gpuWrites: 0
  });
});

test("apply reconstruction uses latest output only when not a Batch prompt", () => {
  const session = memoryStorage({
    [LATEST_OUTPUT_KEY]: JSON.stringify({
      version: 1,
      card: {
        filename: "solo.mp4",
        url: "/api/view?filename=solo.mp4",
        promptId: "single-pid",
        seed: "9",
        duration: 5,
        completedAt: 10
      }
    })
  });
  const local = memoryStorage({
    [BATCH_RUNTIME_STORAGE_KEY]: JSON.stringify({
      version: 1,
      jobs: [{
        index: 0,
        label: "Job 1",
        promptId: "batch-pid",
        item: { seed: "1" },
        outputs: [{ filename: "b.mp4", url: "/api/view?filename=b.mp4" }]
      }]
    })
  });
  applySessionGalleryReconstruction(session, local);
  const items = readSessionOutputs(session);
  assert.equal(items.length, 2);
  assert.ok(items.some(item => item.promptId === "single-pid" && item.source === "single"));
  assert.ok(items.some(item => item.promptId === "batch-pid" && item.source === "batch"));
});

test("malicious-looking filename and jobLabel are literal text, never HTML", () => {
  const doc = fakeDocument();
  const item = normalizeSessionOutput({
    promptId: "evil",
    jobLabel: "<strong>fake</strong>",
    filename: "<video onerror=alert(1)>.mp4",
    subfolder: "a/<b>",
    url: "/api/view?filename=safe.mp4",
    seed: "1",
    megapixels: "0.3",
    aspect: "16:9",
    steps: "20",
    archive: {
      filename: "<img src=x onerror=alert(2)>.mp4",
      folderLabel: "<em>folder</em>"
    },
    completedAt: 1,
    available: true
  });
  const card = createSessionClipCard(doc, item);
  const texts = collectText(card);
  assert.ok(texts.some(t => t === "<strong>fake</strong>"));
  assert.ok(texts.some(t => t.includes("<video onerror=alert(1)>.mp4")));
  assert.ok(texts.some(t => t.includes("<img src=x onerror=alert(2)>.mp4")));
  assert.ok(texts.some(t => t.includes("<em>folder</em>")));
  assert.equal(card.children.find(c => c.className === "session-clip-meta")?.children?.[0]?.textContent, "<strong>fake</strong>");
  const codes = [];
  function walk(node) {
    if (!node) return;
    if (node.tagName === "CODE") codes.push(node.textContent);
    for (const child of node.children || []) walk(child);
  }
  walk(card);
  assert.ok(codes.some(c => c.includes("<video onerror=alert(1)>.mp4")));
  assert.ok(!codes.some(c => c.includes("<video") && c.includes("</video>")));
});

test("gallery DOM helper never uses innerHTML", () => {
  const domSrc = readFileSync(new URL("../public/session-gallery-dom.mjs", import.meta.url), "utf8");
  const outputUi = readFileSync(new URL("../public/output-ui.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(domSrc, /\.innerHTML\b/);
  assert.doesNotMatch(outputUi, /\.innerHTML\b/);
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

test("app.js captures completedPromptId before rememberJob clears runtime", () => {
  const region = app.slice(app.indexOf("async function outputs()"), app.indexOf("function handleHistoryFailure"));
  assert.match(region, /const completedPromptId = currentPrompt/);
  assert.match(region, /rememberJob\(\)/);
  assert.ok(region.indexOf("const completedPromptId = currentPrompt") < region.indexOf("rememberJob()"));
  assert.match(region, /buildSingleJobCompletionAttribution\(completedPromptId/);
  assert.doesNotMatch(region, /promptId:\s*currentPrompt/);
  assert.doesNotMatch(region, /\/api\/queue/);
  assert.doesNotMatch(region, /["'`]\/prompt["'`]/);
});

test("gallery never posts queue or prompt", () => {
  const gallery = readFileSync(new URL("../public/session-outputs.mjs", import.meta.url), "utf8");
  const notify = readFileSync(new URL("../public/notify.mjs", import.meta.url), "utf8");
  const galleryDom = readFileSync(new URL("../public/session-gallery-dom.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(gallery, /\/api\/queue/);
  assert.doesNotMatch(gallery, /["'`]\/prompt["'`]/);
  assert.doesNotMatch(notify, /\/api\/queue|["'`]\/prompt["'`]/);
  assert.match(batchUi, /buildSessionOutputRecords/);
  assert.match(batchUi, /job\.item\?\.megapixels/);
  assert.match(app, /buildSingleJobCompletionAttribution/);
  assert.match(app, /megapixels: \$\("megapixels"\)/);
  assert.match(outputUi, /sessionGalleryClearSideEffects/);
  assert.match(outputUi, /applySessionGalleryReconstruction/);
  assert.match(galleryDom, /Apri video/);
});
