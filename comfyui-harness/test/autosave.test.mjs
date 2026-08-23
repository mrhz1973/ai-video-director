import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTOSAVE_DEBOUNCE_MS,
  RECOVERY_DRAFT_KEY,
  RESERVED_BROWSER_KEYS,
  SAVE_STATUS,
  assertAutosaveKeysIsolated,
  buildRecoverySnapshot,
  clearRecoveryDraft,
  createAutosaveController,
  formatSaveStatusLabel,
  isMeaningfulRecoverySnapshot,
  readRecoveryDraft,
  writeRecoveryDraft
} from "../public/autosave.mjs";

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    data,
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; }
  };
}

test("recovery draft key is isolated from existing browser persistence keys", () => {
  assert.equal(assertAutosaveKeysIsolated(), true);
  assert.equal(RECOVERY_DRAFT_KEY, "h3RecoveryDraft:v1");
  assert.ok(!RESERVED_BROWSER_KEYS.includes(RECOVERY_DRAFT_KEY));
  assert.ok(!RESERVED_BROWSER_KEYS.some(key => key === RECOVERY_DRAFT_KEY));
});

test("recovery snapshot round-trip restores prompt library labels and roles without binaries", () => {
  const storage = memoryStorage();
  const snapshot = buildRecoverySnapshot({
    label: "Acting Draft",
    workflowId: "minimax-h3-i2v",
    prompt: "quiet listening",
    model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
    megapixels: 0.3,
    aspect: "16:9",
    steps: 15,
    duration: 5,
    seed: "628211386369724",
    library: {
      elements: [{
        id: "g1",
        label: "Capanna Radio",
        members: [{
          id: "m1",
          filename: "Martino_CapannaRadio_FIRSTFRAME_16x9.png",
          originalName: "Martino_CapannaRadio_FIRSTFRAME_16x9.png",
          label: "Martino — First Frame 16:9",
          type: "image"
        }]
      }],
      locations: [],
      objects: [],
      audio: []
    },
    files: { firstImage: "Martino_CapannaRadio_FIRSTFRAME_16x9.png" }
  });
  assert.equal(isMeaningfulRecoverySnapshot(snapshot), true);
  writeRecoveryDraft(snapshot, storage);
  const restored = readRecoveryDraft(storage);
  assert.equal(restored.project.prompt, "quiet listening");
  assert.equal(restored.project.library.elements[0].members[0].label, "Martino — First Frame 16:9");
  assert.equal(restored.project.files.firstImage, "Martino_CapannaRadio_FIRSTFRAME_16x9.png");
  assert.equal(JSON.stringify(restored).includes("data:image"), false);
  clearRecoveryDraft(storage);
  assert.equal(readRecoveryDraft(storage), null);
});

test("reload restoration helpers never encode queue or gpu endpoints", async () => {
  const source = await import("node:fs").then(fs =>
    fs.readFileSync(new URL("../public/autosave.mjs", import.meta.url), "utf8")
  );
  assert.doesNotMatch(source, /\/api\/queue/);
  assert.doesNotMatch(source, /\/api\/gpu-power/);
  assert.doesNotMatch(source, /\/prompt/);
  assert.doesNotMatch(source, /nvidia-smi/);
});

test("saved project autosave debounce prevents write-per-keystroke", async () => {
  const calls = [];
  let nowPayload = { prompt: "a" };
  const timers = [];
  const controller = createAutosaveController({
    debounceMs: 50,
    latestPayload: () => ({ ...nowPayload }),
    saveFn: async payload => { calls.push(payload.prompt); },
    setTimeoutFn: (fn, ms) => {
      const id = { fn, ms };
      timers.push(id);
      return id;
    },
    clearTimeoutFn: id => {
      const index = timers.indexOf(id);
      if (index >= 0) timers.splice(index, 1);
    }
  });

  controller.markDirty();
  nowPayload = { prompt: "ab" };
  controller.markDirty();
  nowPayload = { prompt: "abc" };
  controller.markDirty();
  assert.equal(calls.length, 0);
  assert.equal(timers.length, 1);
  await timers[0].fn();
  assert.deepEqual(calls, ["abc"]);
});

test("autosave single-flight queues a latest-state follow-up save", async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let payload = { prompt: "one", n: 1 };
  const controller = createAutosaveController({
    debounceMs: 0,
    latestPayload: () => ({ ...payload }),
    saveFn: async body => {
      calls.push(body.n);
      if (body.n === 1) await gate;
    },
    setTimeoutFn: fn => { fn(); return 1; },
    clearTimeoutFn: () => {}
  });

  controller.markDirty();
  await Promise.resolve();
  assert.equal(controller.isInFlight(), true);
  payload = { prompt: "two", n: 2 };
  controller.markDirty();
  assert.equal(controller.hasPending(), true);
  release();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(calls, [1, 2]);
  assert.equal(controller.getStatus(), SAVE_STATUS.SAVED);
});

test("failed autosave keeps error status for dirty/recovery handling", async () => {
  const controller = createAutosaveController({
    debounceMs: 0,
    latestPayload: () => ({ prompt: "x" }),
    saveFn: async () => { throw new Error("boom"); },
    setTimeoutFn: fn => { fn(); return 1; },
    clearTimeoutFn: () => {}
  });
  controller.markDirty();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(controller.getStatus(), SAVE_STATUS.ERROR);
  assert.match(String(controller.getLastError()?.message || ""), /boom/);
});

test("save status labels cover the required UI states", () => {
  assert.equal(formatSaveStatusLabel(SAVE_STATUS.SAVED, { clockLabel: "23:31" }), "✓ Salvato 23:31");
  assert.equal(formatSaveStatusLabel(SAVE_STATUS.DIRTY), "Modificato");
  assert.equal(formatSaveStatusLabel(SAVE_STATUS.SAVING), "Salvataggio…");
  assert.equal(formatSaveStatusLabel(SAVE_STATUS.ERROR), "Errore salvataggio");
  assert.equal(formatSaveStatusLabel(SAVE_STATUS.LOCAL_DRAFT), "Bozza locale");
  assert.equal(formatSaveStatusLabel(SAVE_STATUS.RECOVERED), "Bozza recuperata");
  assert.equal(AUTOSAVE_DEBOUNCE_MS, 700);
});

test("app wiring keeps manual Save and never auto-queues from autosave/recovery", async () => {
  const fs = await import("node:fs");
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /projectSave/);
  assert.doesNotMatch(app, /projectSaveAs/);
  assert.match(app, /readRecoveryDraft/);
  assert.match(app, /createAutosaveController/);
  assert.match(app, /SAVE_STATUS\.RECOVERED/);
  assert.match(app, /\/api\/queue/);
  const saveFnRegion = app.slice(app.indexOf("createAutosaveController"), app.indexOf("createAutosaveController") + 900);
  assert.doesNotMatch(saveFnRegion, /\/api\/queue/);
  assert.doesNotMatch(saveFnRegion, /\/api\/gpu-power/);
  const recoveryBoot = app.slice(app.indexOf("readRecoveryDraft()"), app.indexOf("readRecoveryDraft()") + 500);
  assert.doesNotMatch(recoveryBoot, /\/api\/queue/);
  assert.doesNotMatch(recoveryBoot, /\/api\/gpu-power/);
});
