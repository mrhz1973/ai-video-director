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
  describeRenderProgress,
  enrichProgressWithNodeContext,
  entryStatusLabel,
  estimateCodaEtaMs,
  formatEtaMs,
  formatRenderProgressLabel,
  isSamplerStepProgress,
  normalizeRenderProgress,
  progressForActivePrompt,
  resolveCurrentJobPointer,
  summarizeCodaJobProgress
} from "../public/batch-queue-progress.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const queueUi = readFileSync(path.join(root, "../public/batch-queue-ui.mjs"), "utf8");
const batchUi = readFileSync(path.join(root, "../public/batch-ui.mjs"), "utf8");
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
  assert.equal(summary.percentSemantics, "successful-completion");
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

test("generic numeric Comfy node progress is NOT labeled sampler Step", () => {
  const vae = normalizeRenderProgress({
    kind: "numeric",
    value: 3,
    max: 10,
    promptId: "p1",
    nodeId: "73",
    displayNode: "VAEDecode",
    source: "progress_state"
  });
  assert.equal(isSamplerStepProgress(vae), false);
  assert.equal(vae.labelKind, "node");
  assert.match(vae.label, /Progresso nodo 3 \/ 10/);
  assert.doesNotMatch(vae.label, /^Step /);

  const scheduler = normalizeRenderProgress({
    kind: "numeric",
    value: 15,
    max: 22,
    promptId: "p1",
    displayNode: "BasicScheduler"
  });
  assert.equal(isSamplerStepProgress(scheduler), false);
  assert.doesNotMatch(scheduler.label, /^Step /);

  const anonymous = normalizeRenderProgress({
    kind: "numeric",
    value: 5,
    max: 10,
    promptId: "p1"
  });
  assert.equal(anonymous.labelKind, "percent");
  assert.equal(anonymous.label, "Render 50%");
  assert.doesNotMatch(anonymous.label, /Step/);
});

test("known sampler progress may display Step X / Y", () => {
  for (const name of ["SamplerCustomAdvanced", "SamplerCustom", "KSampler", "KSamplerAdvanced"]) {
    const progress = normalizeRenderProgress({
      kind: "numeric",
      value: 15,
      max: 22,
      promptId: "p1",
      displayNode: name,
      source: "progress"
    });
    assert.equal(isSamplerStepProgress(progress), true);
    assert.equal(progress.labelKind, "sampler-step");
    assert.equal(progress.label, "Step 15 / 22 · 68%");
  }
});

test("enrichProgressWithNodeContext restores displayNode for sampler identification", () => {
  const map = new Map([["131", "SamplerCustomAdvanced"]]);
  const enriched = enrichProgressWithNodeContext(
    { kind: "numeric", value: 4, max: 20, nodeId: "131", promptId: "p1", source: "progress" },
    map
  );
  const normalized = normalizeRenderProgress(enriched);
  assert.equal(normalized.displayNode, "SamplerCustomAdvanced");
  assert.equal(normalized.labelKind, "sampler-step");
});

test("mismatched old prompt progress is idle for active CODA card", () => {
  const view = buildCodaProgressView({
    entries: [entry("Cur", QUEUE_ENTRY_STATE.RUNNING, [{}], "cur")],
    runtimeView: {
      armed: true,
      authorityPresent: true,
      currentEntryId: "cur",
      entryJobs: [{ state: "running", promptId: "current-prompt" }]
    },
    renderProgress: {
      kind: "numeric",
      value: 9,
      max: 10,
      percent: 90,
      promptId: "stale-old-prompt",
      displayNode: "SamplerCustomAdvanced"
    }
  });
  assert.equal(view.render.kind, "idle");
  assert.equal(view.render.percent, null);
  assert.doesNotMatch(view.render.label || "", /Step|90%/);
});

test("terminal mixed entry preserves actual job counts (5+1+2)", () => {
  const entries = [entry("Mixed", QUEUE_ENTRY_STATE.FAILED, Array.from({ length: 8 }, () => ({})), "mixed")];
  const runtimeView = {
    currentEntryId: null,
    entryJobs: [],
    acceptedJobs: [
      { queueEntryId: "mixed", state: "completed", promptId: "a" },
      { queueEntryId: "mixed", state: "completed", promptId: "b" },
      { queueEntryId: "mixed", state: "completed", promptId: "c" },
      { queueEntryId: "mixed", state: "completed", promptId: "d" },
      { queueEntryId: "mixed", state: "completed", promptId: "e" },
      { queueEntryId: "mixed", state: "error", promptId: "f" }
      // jobs 7–8 absent → padded as not-submitted/cancelled
    ]
  };
  const summary = summarizeCodaJobProgress({ entries, runtimeView });
  assert.equal(summary.total, 8);
  assert.equal(summary.completed, 5);
  assert.equal(summary.failed, 1);
  assert.equal(summary.cancelled, 2);
  assert.equal(summary.running, 0);
  assert.equal(summary.pending, 0);
  // Must NOT call all 8 failed
  assert.notEqual(summary.failed, 8);
  // percent = successful completion only
  assert.equal(summary.percent, Math.round((5 / 8) * 100));
  assert.equal(summary.percentSemantics, "successful-completion");
});

test("fully completed terminal entry reports N completed", () => {
  const entries = [entry("Done", QUEUE_ENTRY_STATE.COMPLETED, [{}, {}, {}], "done")];
  const withEvidence = summarizeCodaJobProgress({
    entries,
    runtimeView: {
      acceptedJobs: [
        { queueEntryId: "done", state: "completed", promptId: "1" },
        { queueEntryId: "done", state: "completed", promptId: "2" },
        { queueEntryId: "done", state: "completed", promptId: "3" }
      ]
    }
  });
  assert.equal(withEvidence.completed, 3);
  assert.equal(withEvidence.failed, 0);

  const fallback = summarizeCodaJobProgress({ entries, runtimeView: null });
  assert.equal(fallback.completed, 3);
});

test("historical acceptedJobs across multiple terminal entries", () => {
  const entries = [
    entry("A", QUEUE_ENTRY_STATE.COMPLETED, [{}, {}], "a"),
    entry("B", QUEUE_ENTRY_STATE.FAILED, [{}, {}, {}], "b"),
    entry("C", QUEUE_ENTRY_STATE.QUEUED, [{}], "c")
  ];
  const runtimeView = {
    acceptedJobs: [
      { queueEntryId: "a", state: "completed", promptId: "a1" },
      { queueEntryId: "a", state: "completed", promptId: "a2" },
      { queueEntryId: "b", state: "completed", promptId: "b1" },
      { queueEntryId: "b", state: "error", promptId: "b2" }
      // b's third job missing → cancelled pad
    ]
  };
  const summary = summarizeCodaJobProgress({ entries, runtimeView });
  assert.equal(summary.total, 6);
  assert.equal(summary.completed, 3);
  assert.equal(summary.failed, 1);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.pending, 1); // C queued, no evidence → entry fallback
});

test("current entryJobs + acceptedJobs does not double-count current entry", () => {
  const entries = [
    entry("Prev", QUEUE_ENTRY_STATE.COMPLETED, [{}], "prev"),
    entry("Cur", QUEUE_ENTRY_STATE.RUNNING, [{}, {}], "cur")
  ];
  const runtimeView = {
    currentEntryId: "cur",
    entryJobs: [
      { state: "completed", promptId: "c1" },
      { state: "running", promptId: "c2" }
    ],
    acceptedJobs: [
      { queueEntryId: "prev", state: "completed", promptId: "p1" },
      // Duplicate mirror of current entry — must be ignored while entryJobs win
      { queueEntryId: "cur", state: "completed", promptId: "c1" },
      { queueEntryId: "cur", state: "running", promptId: "c2" },
      { queueEntryId: "cur", state: "completed", promptId: "ghost-extra" }
    ]
  };
  const summary = summarizeCodaJobProgress({ entries, runtimeView });
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 2); // prev + cur job1
  assert.equal(summary.running, 1);
  assert.notEqual(summary.completed, 3); // ghost-extra must not count
});

test("interrupted and cancelled accounting", () => {
  const entries = [
    entry("I", QUEUE_ENTRY_STATE.RECOVERY_REQUIRED, [{}, {}], "i"),
    entry("X", QUEUE_ENTRY_STATE.CANCELLED, [{}], "x")
  ];
  const withEvidence = summarizeCodaJobProgress({
    entries,
    runtimeView: {
      acceptedJobs: [
        { queueEntryId: "i", state: "completed", promptId: "i1" },
        { queueEntryId: "i", state: "interrupted", promptId: "i2" },
        { queueEntryId: "x", state: "cancelled", promptId: "x1" }
      ]
    }
  });
  assert.equal(withEvidence.completed, 1);
  assert.equal(withEvidence.interrupted, 1);
  assert.equal(withEvidence.cancelled, 1);

  const fallback = summarizeCodaJobProgress({ entries, runtimeView: null });
  assert.equal(fallback.interrupted, 2);
  assert.equal(fallback.cancelled, 1);
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
    renderProgress: {
      kind: "numeric",
      value: 11,
      max: 22,
      promptId: "p-run",
      displayNode: "SamplerCustomAdvanced"
    },
    now: runtimeView.startedAt + 120_000
  });
  assert.equal(view.authority, "display-only");
  assert.equal(view.jobs.completed, 1);
  assert.equal(view.jobs.running, 1);
  assert.equal(view.render.percent, 50);
  assert.equal(view.render.labelKind, "sampler-step");
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
    renderProgress: {
      kind: "numeric",
      value: 3,
      max: 10,
      promptId: "c",
      displayNode: "VAEDecode"
    },
    startedAt: Date.now() - 30_000
  });
  assert.equal(view.label, "Job 3 / 4");
  assert.equal(view.completed, 2);
  assert.equal(view.render.percent, 30);
  assert.equal(view.render.labelKind, "node");
  assert.doesNotMatch(view.render.label, /^Step /);
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

test("CODA card live progress uses prompt-matched helper not raw liveRenderProgress", () => {
  assert.match(queueUi, /progressForActivePrompt/);
  assert.match(queueUi, /collectActivePromptIds/);
  assert.doesNotMatch(queueUi, /Render step \$\{liveRenderProgress/);
  assert.doesNotMatch(queueUi, /`Step \$\{view\.render\.value\}/);
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

test("BATCH UI uses shared render label not hard-coded Step", () => {
  assert.match(batchUi, /progress\.render\.label/);
  assert.doesNotMatch(batchUi, /Step \$\{progress\.render\.value\}/);
});

test("describeRenderProgress / formatRenderProgressLabel stay consistent", () => {
  const described = describeRenderProgress({
    kind: "numeric",
    value: 1,
    max: 4,
    percent: 25,
    displayNode: "VAEDecode"
  });
  assert.equal(described.labelKind, "node");
  assert.equal(
    formatRenderProgressLabel({
      kind: "numeric",
      value: 1,
      max: 4,
      displayNode: "VAEDecode"
    }),
    described.label
  );
});
