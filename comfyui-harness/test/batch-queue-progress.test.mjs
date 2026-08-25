import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { QUEUE_ENTRY_STATE } from "../lib/batch-queue-plan-core.mjs";
import { mergeRuntimePublicView } from "../lib/batch-queue-runtime.mjs";
import {
  buildBatchProgressView,
  buildCodaProgressView,
  collectActivePromptIds,
  entryStatusLabel,
  estimateCodaEtaMs,
  formatEtaMs,
  normalizeRenderProgress,
  progressForActivePrompt,
  resolveCurrentJobPointer,
  summarizeCodaJobProgress
} from "../public/batch-queue-progress.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const queueUi = readFileSync(path.join(root, "../public/batch-queue-ui.mjs"), "utf8");
const appJs = readFileSync(path.join(root, "../public/app.js"), "utf8");

function entry(name, state, jobs, id = name) {
  return {
    queueEntryId: id,
    name,
    state,
    snapshot: {
      items: jobs.map((job, index) => ({
        prompt: job.prompt || `p${index}`,
        seed: String(job.seed || index + 1),
        duration: "6",
        steps: "22",
        megapixels: "0.5",
        aspect: "3:4",
        queueJobId: `${id}:job:${index}`
      }))
    }
  };
}

test("CODA overall progress 0 / N", () => {
  const entries = [
    entry("A", QUEUE_ENTRY_STATE.QUEUED, [{}]),
    entry("B", QUEUE_ENTRY_STATE.QUEUED, [{}, {}])
  ];
  const summary = summarizeCodaJobProgress({ entries, runtimeView: null });
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 0);
  assert.equal(summary.pending, 3);
  assert.equal(summary.percent, 0);
});

test("CODA overall progress partial and N / N", () => {
  const entries = [
    entry("A", QUEUE_ENTRY_STATE.COMPLETED, [{}], "a"),
    entry("B", QUEUE_ENTRY_STATE.RUNNING, [{}, {}], "b"),
    entry("C", QUEUE_ENTRY_STATE.QUEUED, [{}], "c")
  ];
  const runtimeView = {
    currentEntryId: "b",
    entryJobs: [
      { state: "completed", promptId: "p1" },
      { state: "running", promptId: "p2" }
    ]
  };
  const partial = summarizeCodaJobProgress({ entries, runtimeView });
  assert.equal(partial.total, 4);
  assert.equal(partial.completed, 2); // A + first job of B
  assert.equal(partial.running, 1);
  assert.equal(partial.pending, 1); // C
  assert.equal(partial.percent, 50);

  const done = summarizeCodaJobProgress({
    entries: entries.map(e => ({ ...e, state: QUEUE_ENTRY_STATE.COMPLETED })),
    runtimeView: null
  });
  assert.equal(done.completed, 4);
  assert.equal(done.percent, 100);
});

test("one-job entry current pointer", () => {
  const entries = [entry("T09", QUEUE_ENTRY_STATE.RUNNING, [{}], "e9")];
  const pointer = resolveCurrentJobPointer({
    entries,
    runtimeView: { currentEntryId: "e9", currentEntryName: "T09", currentJobIndex: 0 }
  });
  assert.equal(pointer.entryName, "T09");
  assert.equal(pointer.jobIndex, 1);
  assert.equal(pointer.jobTotal, 1);
  assert.equal(pointer.label, "Job 1 / 1");
});

test("multi-job entry current pointer job 3 / 8", () => {
  const entries = [entry("BatchXYZ", QUEUE_ENTRY_STATE.RUNNING, Array.from({ length: 8 }, () => ({})), "multi")];
  const pointer = resolveCurrentJobPointer({
    entries,
    runtimeView: { currentEntryId: "multi", currentEntryName: "BatchXYZ", currentJobIndex: 2 }
  });
  assert.equal(pointer.label, "Job 3 / 8");
});

test("running progress with value/max yields percent", () => {
  const progress = normalizeRenderProgress({ kind: "numeric", value: 15, max: 22, promptId: "abc" });
  assert.equal(progress.kind, "numeric");
  assert.equal(progress.percent, 68);
  const matched = progressForActivePrompt({
    progress,
    activePromptIds: ["abc"]
  });
  assert.equal(matched.percent, 68);
});

test("no authoritative numeric progress stays indeterminate (no fake %)", () => {
  const progress = normalizeRenderProgress({ kind: "indeterminate", promptId: "abc" });
  assert.equal(progress.kind, "indeterminate");
  assert.equal(progress.percent, null);
  const unmatched = progressForActivePrompt({
    progress: { kind: "numeric", value: 5, max: 10, promptId: "other" },
    activePromptIds: ["abc"]
  });
  assert.equal(unmatched.kind, "idle");
  assert.equal(unmatched.percent, null);
});

test("completed / failed / interrupted entry status labels", () => {
  assert.equal(entryStatusLabel(QUEUE_ENTRY_STATE.COMPLETED), "COMPLETATO");
  assert.equal(entryStatusLabel(QUEUE_ENTRY_STATE.FAILED), "FALLITO");
  assert.equal(entryStatusLabel(QUEUE_ENTRY_STATE.RECOVERY_REQUIRED), "RECUPERO RICHIESTO");
  assert.equal(entryStatusLabel(QUEUE_ENTRY_STATE.QUEUED), "IN CODA");
});

test("buildCodaProgressView is display-only and does not invent authority", () => {
  const entries = [
    entry("A", QUEUE_ENTRY_STATE.COMPLETED, [{}], "a"),
    entry("B", QUEUE_ENTRY_STATE.RUNNING, [{}], "b")
  ];
  const runtimeView = {
    armed: true,
    authorityPresent: true,
    startedAt: Date.now() - 120_000,
    currentEntryId: "b",
    currentEntryName: "B",
    currentJobIndex: 0,
    entryJobs: [{ state: "running", promptId: "p-run" }]
  };
  const view = buildCodaProgressView({
    entries,
    runtimeView,
    renderProgress: { kind: "numeric", value: 11, max: 22, promptId: "p-run" },
    now: runtimeView.startedAt + 120_000
  });
  assert.equal(view.authority, "display-only");
  assert.equal(view.jobs.completed, 1);
  assert.equal(view.jobs.running, 1);
  assert.equal(view.render.percent, 50);
  assert.match(view.elapsed.text, /\d{2}:\d{2}:\d{2}/);
  assert.ok(view.etaText == null || typeof view.etaText === "string");
});

test("ETA requires completed jobs; otherwise estimating or null", () => {
  assert.equal(estimateCodaEtaMs({ startedAt: Date.now() - 1000, completed: 0, total: 10 }), null);
  const eta = estimateCodaEtaMs({
    startedAt: Date.now() - 600_000,
    completed: 2,
    total: 10,
    running: 1,
    renderProgress: { kind: "numeric", value: 50, max: 100, percent: 50 }
  });
  assert.ok(Number.isFinite(eta) && eta > 0);
  assert.match(formatEtaMs(eta), /^~/);
});

test("BATCH progress helper reports job X / Y", () => {
  const view = buildBatchProgressView({
    jobs: [
      { state: "completed", label: "Job 1", promptId: "a" },
      { state: "completed", label: "Job 2", promptId: "b" },
      { state: "running", label: "Job 3", promptId: "c" },
      { state: "pending", label: "Job 4" }
    ],
    renderProgress: { kind: "numeric", value: 3, max: 10, promptId: "c" },
    startedAt: Date.now() - 30_000
  });
  assert.equal(view.label, "Job 3 / 4");
  assert.equal(view.completed, 2);
  assert.equal(view.render.percent, 30);
  assert.equal(view.authority, "display-only");
});

test("collectActivePromptIds maps entryJobs / acceptedJobs", () => {
  const ids = collectActivePromptIds({
    runtimeView: {
      entryJobs: [{ promptId: "p1", state: "running" }],
      acceptedJobs: [{ promptId: "p2", state: "running" }]
    }
  });
  assert.deepEqual(ids, ["p1", "p2"]);
});

test("mergeRuntimePublicView exposes startedAt for elapsed/ETA display", () => {
  const view = mergeRuntimePublicView({
    plan: { revision: 1, failurePolicy: "stop", entries: [] },
    runtime: { queueRunId: "qr", armed: true, startedAt: 123456, projectId: "p" }
  });
  assert.equal(view.startedAt, 123456);
  assert.equal(view.authorityPresent, true);
});

test("technical details disclosure state is keyed by immutable queueEntryId", () => {
  assert.match(queueUi, /const techDetailsOpen = new Set\(\)/);
  assert.match(queueUi, /techDetailsOpen\.has\(entry\.queueEntryId\)/);
  assert.match(queueUi, /techDetailsOpen\.add\(entry\.queueEntryId\)/);
  assert.match(queueUi, /techDetailsOpen\.delete\(entry\.queueEntryId\)/);
  assert.match(queueUi, /jobDisclosureOpen/);
  assert.doesNotMatch(queueUi, /localStorage\.setItem\([^\)]*techDetails/);
});

test("progress refresh path does not call queue arm or /api/queue", () => {
  const progressHandler = queueUi.slice(
    queueUi.indexOf('window.addEventListener("h3-comfy-progress"'),
    queueUi.indexOf("export function bindBatchQueueProject")
  );
  assert.match(progressHandler, /liveRenderProgress/);
  assert.match(progressHandler, /renderSummary/);
  assert.doesNotMatch(progressHandler, /\/api\/queue/);
  assert.doesNotMatch(progressHandler, /batch-queue\/arm/);
});

test("app.js broadcasts Comfy progress before single-prompt filter", () => {
  assert.match(appJs, /h3-comfy-progress/);
  assert.match(appJs, /progressFromMessage/);
  const handleStart = appJs.indexOf("async function handleMessage");
  const filterIdx = appJs.indexOf("message.data.prompt_id !== currentPrompt", handleStart);
  const broadcastIdx = appJs.indexOf("h3-comfy-progress", handleStart);
  assert.ok(broadcastIdx > handleStart && broadcastIdx < filterIdx);
});

test("CODA progress panel markup is mounted", () => {
  assert.match(queueUi, /id="batchQueueProgress"/);
  assert.match(queueUi, /renderCodaProgressPanel/);
  assert.match(queueUi, /buildCodaProgressView/);
});
