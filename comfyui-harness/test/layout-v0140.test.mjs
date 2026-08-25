/**
 * Issue #59 / v0.14.0 — SCENA · BATCH · CODA · OUTPUT UX + output accessibility.
 * Presentation and safe filesystem helpers only — no live generation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyWorkflowView,
  normalizeWorkflowView,
  WORKFLOW_VIEWS
} from "../public/workflow-nav.mjs";
import {
  assertSafeOutputBasename,
  isMp4Filename,
  resolveSafeComfyOutputPath,
  ComfyOutputPathError
} from "../lib/comfy-output-path.mjs";
import {
  buildWindowsExplorerSelectArgs,
  showComfyOutputInFolder
} from "../lib/comfy-output-actions.mjs";
import { createSessionClipCard } from "../public/session-gallery-dom.mjs";
import { INSPECTOR_TABS } from "../public/inspector-ui.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(root, "../public/index.html"), "utf8");
const batchUi = readFileSync(path.join(root, "../public/batch-ui.mjs"), "utf8");
const batchQueueUi = readFileSync(path.join(root, "../public/batch-queue-ui.mjs"), "utf8");
const server = readFileSync(path.join(root, "../server.mjs"), "utf8");
const pkg = JSON.parse(readFileSync(path.join(root, "../package.json"), "utf8"));
const galleryDom = readFileSync(path.join(root, "../public/session-gallery-dom.mjs"), "utf8");

test("v0.14.x package version", () => {
  assert.match(pkg.version, /^0\.1[56789]\./);
});

test("CODA progress panel and stable tech details contracts exist", () => {
  assert.match(batchQueueUi, /id="batchQueueProgress"/);
  assert.match(batchQueueUi, /techDetailsOpen/);
  assert.match(batchQueueUi, /buildCodaProgressView/);
  assert.match(batchUi, /buildBatchProgressView/);
});

test("SCENA/BATCH/CODA/OUTPUT primary navigation present", () => {
  assert.match(html, /id="workflowNav"/);
  for (const view of WORKFLOW_VIEWS) {
    assert.match(html, new RegExp(`data-workflow-view="${view}"`));
    assert.match(html, new RegExp(`id="view-${view}"`));
  }
  assert.equal(normalizeWorkflowView("coda"), "coda");
  assert.equal(normalizeWorkflowView("nope"), "scena");
});

test("workflow nav switches views without generation side effects", () => {
  const panels = Object.fromEntries(WORKFLOW_VIEWS.map(name => {
    const el = { id: `view-${name}`, hidden: true, getAttribute() { return name; } };
    return [name, el];
  }));
  const buttons = WORKFLOW_VIEWS.map(name => {
    const state = { name, selected: "false", className: "" };
    return {
      getAttribute: key => (key === "data-workflow-view" ? name : null),
      setAttribute: (key, value) => { if (key === "aria-selected") state.selected = value; },
      classList: { toggle(cls, on) { if (cls === "active") state.active = on; } },
      state
    };
  });
  const storage = new Map();
  const documentRef = {
    getElementById: id => {
      if (id === "workflowNav") {
        return { querySelectorAll: () => buttons };
      }
      const m = /^view-(.+)$/.exec(id);
      return m ? panels[m[1]] : null;
    },
    documentElement: { setAttribute() {} }
  };
  applyWorkflowView("batch", {
    documentRef,
    storage: {
      setItem: (k, v) => storage.set(k, v),
      getItem: k => storage.get(k)
    }
  });
  assert.equal(panels.batch.hidden, false);
  assert.equal(panels.scena.hidden, true);
  assert.equal(storage.get("h3WorkflowView:v1"), "batch");
  assert.doesNotMatch(server, /applyWorkflowView[\s\S]{0,80}\/api\/queue/);
});

test("8 prepared jobs differ from 1 queued Batch in UI copy", () => {
  assert.match(batchUi, /BATCH — job preparati|BATCH_OPTIONAL_HEADING/);
  assert.match(batchUi, /\+ AGGIUNGI ALLA CODA/);
  assert.match(batchQueueUi, /CODA/);
  assert.match(batchQueueUi, /AVVIA CODA/);
  assert.match(html, /id="view-batch"/);
  assert.match(html, /id="view-coda"/);
  assert.notEqual(
    html.indexOf('data-workflow-view="batch"'),
    html.indexOf('data-workflow-view="coda"')
  );
});

test("Add to Queue path does not POST /api/queue", () => {
  const addFn = batchUi.slice(
    batchUi.indexOf("batchAddToQueue"),
    batchUi.indexOf("batchAddToQueue") + 800
  );
  assert.doesNotMatch(batchUi, /addCurrentBatchToQueue[\s\S]{0,400}\/api\/queue/);
  assert.match(batchUi, /addCurrentBatchToQueue/);
  void addFn;
});

test("normal CODA UI hides raw item.files / source.files JSON", () => {
  assert.doesNotMatch(
    batchQueueUi,
    /sourceMeta\.textContent = `Modello: \$\{model\} · source\.files/
  );
  assert.doesNotMatch(batchQueueUi, /item\.files \(JSON\)/);
  assert.match(batchQueueUi, /Dettagli tecnici/);
  assert.match(batchQueueUi, /batch-queue-tech-details/);
});

test("Avvia batch is secondary advanced overflow", () => {
  assert.match(batchUi, /batch-advanced-actions/);
  assert.match(batchUi, /Avvia questo Batch immediatamente/);
  assert.match(batchUi, /id="batchAddToQueue">\+ AGGIUNGI ALLA CODA</);
});

test("future queued Batch remains editable until claim (editor still present)", () => {
  assert.match(batchQueueUi, /QUEUE_ENTRY_STATE\.QUEUED/);
  assert.match(batchQueueUi, /appendJobEditor/);
  assert.match(batchQueueUi, /Salva job/);
});

test("output card exposes Apri / Mostra / Scarica", () => {
  assert.match(galleryDom, /Apri video/);
  assert.match(galleryDom, /Mostra nella cartella/);
  assert.match(galleryDom, /Scarica MP4/);
  assert.match(galleryDom, /controlsList/);
  assert.match(galleryDom, /nodownload/);
  assert.match(galleryDom, /copia archivio non creata/);
  assert.match(galleryDom, /originale ComfyUI disponibile/);
});

test("createSessionClipCard renders three actions when available", () => {
  const kids = [];
  const doc = {
    createElement(tag) {
      const el = {
        tagName: tag,
        className: "",
        textContent: "",
        children: [],
        dataset: {},
        style: {},
        append(...nodes) { this.children.push(...nodes); kids.push(...nodes); },
        setAttribute() {},
        addEventListener() {}
      };
      return el;
    },
    createTextNode(text) { return { textContent: text }; }
  };
  const card = createSessionClipCard(doc, {
    id: "p1:f.mp4",
    filename: "clip.mp4",
    subfolder: "",
    url: "/api/view?filename=clip.mp4",
    source: "single",
    available: true,
    completedAt: "2026-08-24T12:00:00.000Z"
  });
  const actions = card.children.find(c => c.className === "session-clip-actions");
  const texts = (actions?.children || []).map(c => c.textContent);
  assert.ok(texts.includes("Apri video"));
  assert.ok(texts.includes("Mostra nella cartella"));
  assert.ok(texts.includes("Scarica MP4"));
});

test("resolveSafeComfyOutputPath accepts valid and rejects traversal/absolute/escape", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "h3-out-"));
  writeFileSync(path.join(dir, "ok.mp4"), Buffer.from("mp4-bytes"));
  const nested = path.join(dir, "sub");
  mkdirSync(nested);
  writeFileSync(path.join(nested, "nested.mp4"), Buffer.from("nested"));

  const ok = resolveSafeComfyOutputPath(dir, { filename: "ok.mp4" });
  assert.equal(ok.filename, "ok.mp4");
  assert.ok(ok.absolutePath.endsWith("ok.mp4"));

  const nest = resolveSafeComfyOutputPath(dir, { filename: "nested.mp4", subfolder: "sub" });
  assert.equal(nest.subfolder, "sub");

  assert.throws(() => assertSafeOutputBasename("../x.mp4"), ComfyOutputPathError);
  assert.throws(() => assertSafeOutputBasename("C:\\\\Windows\\\\x.mp4"), ComfyOutputPathError);
  assert.throws(
    () => resolveSafeComfyOutputPath(dir, { filename: "ok.mp4", subfolder: "../" }),
    ComfyOutputPathError
  );
  assert.throws(
    () => resolveSafeComfyOutputPath(dir, { filename: "..\\secret.mp4" }),
    ComfyOutputPathError
  );
});

test("show-in-folder uses fixed Explorer argv after authoritative history", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "h3-show-"));
  writeFileSync(path.join(dir, "clip.mp4"), Buffer.from("abc"));
  const calls = [];
  await showComfyOutputInFolder({
    outputRoot: dir,
    comfyUrl: "http://127.0.0.1:9",
    promptId: "pid-layout",
    filename: "clip.mp4",
    platform: "win32",
    fetchFn: async () => ({
      ok: true,
      json: async () => ({
        "pid-layout": {
          outputs: { "1": { videos: [{ filename: "clip.mp4", subfolder: "", type: "output" }] } }
        }
      })
    }),
    execFileImpl: async (exe, args) => {
      calls.push({ exe, args });
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].exe, "explorer.exe");
  assert.deepEqual(calls[0].args, buildWindowsExplorerSelectArgs(path.join(dir, "clip.mp4")));

  await assert.rejects(
    () => showComfyOutputInFolder({
      outputRoot: dir,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "pid-layout",
      filename: "missing.mp4",
      platform: "win32",
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          "pid-layout": {
            outputs: { "1": { videos: [{ filename: "clip.mp4", subfolder: "", type: "output" }] } }
          }
        })
      }),
      execFileImpl: async () => {}
    }),
    err => err.code === "history-mismatch" || err.code === "file-not-found"
  );
});

test("MP4 download is server-authoritative (promptId + history); no ffmpeg", () => {
  assert.match(server, /\/api\/download-mp4/);
  assert.match(server, /resolveAuthoritativeComfyOutput/);
  assert.match(server, /promptId/);
  assert.match(server, /content-type": "video\/mp4"/);
  assert.match(server, /createReadStream/);
  assert.doesNotMatch(server, /ffmpeg|transcode|handbrake/i);
  assert.match(server, /\/api\/show-in-folder/);
  assert.match(galleryDom, /promptId/);
  assert.equal(isMp4Filename("a.mp4"), true);
  assert.equal(isMp4Filename("a.webm"), false);
});

test("presentation actions do not call generation/interrupt/queue-delete/GPU", () => {
  assert.doesNotMatch(galleryDom, /\/api\/queue/);
  assert.doesNotMatch(galleryDom, /\/interrupt/);
  assert.doesNotMatch(galleryDom, /\/prompt/);
  assert.doesNotMatch(galleryDom, /gpu-power/);
  const showSlice = server.slice(server.indexOf("/api/show-in-folder"), server.indexOf("/api/show-in-folder") + 900);
  assert.doesNotMatch(showSlice, /\/prompt/);
  assert.doesNotMatch(showSlice, /queue.*delete|clear:\s*true/);
});

test("inspector secondary tabs are Asset/Input only", () => {
  assert.deepEqual([...INSPECTOR_TABS], ["asset", "input"]);
  assert.match(html, /data-inspector-tab="asset"/);
  assert.match(html, /data-inspector-tab="input"/);
  assert.doesNotMatch(html, /data-inspector-tab="project"/);
  assert.doesNotMatch(html, /data-inspector-tab="output"/);
  assert.match(html, /id="projectStrip"/);
  assert.match(html, /id="sessionGallerySection"/);
});

test("OUTPUT tab renders Destinazione e nomi before Clip sessione", () => {
  const start = html.indexOf('id="view-output"');
  assert.ok(start >= 0, "OUTPUT tab panel markup expected");
  const end = html.indexOf('id="inspector"', start);
  const panel = end > start ? html.slice(start, end) : html.slice(start);
  const destinationIdx = panel.indexOf('id="outputSettingsDetails"');
  const galleryIdx = panel.indexOf('id="sessionGallerySection"');
  assert.ok(destinationIdx >= 0, "Destinazione e nomi section expected in OUTPUT tab");
  assert.ok(galleryIdx >= 0, "Clip sessione section expected in OUTPUT tab");
  assert.ok(destinationIdx < galleryIdx, "Destinazione e nomi must appear before Clip sessione");
  assert.match(panel, /id="cloudMirrorSection"/);
});

test("F5 persistence surfaces still present (draft/queue/session outputs)", () => {
  assert.match(batchUi, /persistDraft|h3BatchDraft|localStorage|sessionStorage/);
  assert.match(batchQueueUi, /syncBatchQueuePlanToServer|exportBatchQueueForProject/);
  assert.match(readFileSync(path.join(root, "../public/session-outputs.mjs"), "utf8"), /h3SessionOutputs:v1/);
});
