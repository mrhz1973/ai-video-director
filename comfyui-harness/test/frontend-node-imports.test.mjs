import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { EXECUTION_LANE_KIND, isFutureExecutionLaneKind } from "../lib/execution-lane-kinds.mjs";
import {
  BATCH_QUEUE_PLAN_VERSION,
  QUEUE_ENTRY_STATE,
  appendQueueEntry,
  createQueueEntryFromDraft,
  normalizeBatchQueuePlan,
  setBatchQueuePlanRandomIdFactory
} from "../lib/batch-queue-plan-core.mjs";
import { serializeBatchDraft } from "../lib/batch-draft.mjs";
import "./../lib/batch-queue-plan.mjs";

const sampleSource = {
  workflowId: "minimax-h3-i2v",
  workflowLabel: "I2V",
  model: "minimax_h3_fl2va_pruned_fp8_Q8_CR.gguf",
  files: { firstImage: "frame.png" },
  requiredKeys: ["firstImage"],
  base: {
    prompt: "base",
    seed: "1",
    duration: "10",
    steps: "20",
    megapixels: "0.7",
    aspect: "16:9"
  }
};

function sampleDraft(jobCount = 1) {
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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const LIB = path.join(ROOT, "lib");

const BROWSER_ENTRY_MODULES = [
  "public/app.js",
  "public/workspace-resize.mjs",
  "public/panel-resize.mjs",
  "public/workflow-nav.mjs",
  "public/inspector-ui.mjs",
  "public/output-ui.mjs",
  "public/gpu-power-ui.mjs"
];

const IMPORT_RE = /\bfrom\s+["']([^"']+)["']/g;
const NODE_IMPORT_RE = /\bfrom\s+["']node:[^"']+["']/;

function readText(relFromRoot) {
  return readFileSync(path.join(ROOT, relFromRoot), "utf8");
}

function resolveImport(fromFile, spec) {
  if (spec.startsWith("/lib/")) {
    return path.join(ROOT, spec.slice(1));
  }
  if (spec.startsWith("./") || spec.startsWith("../")) {
    return path.resolve(path.dirname(fromFile), spec);
  }
  return null;
}

function collectBrowserModuleGraph() {
  const visited = new Set();
  const queue = BROWSER_ENTRY_MODULES.map(rel => path.join(ROOT, rel));
  const graph = [];

  while (queue.length) {
    const abs = queue.pop();
    if (!abs || visited.has(abs)) continue;
    visited.add(abs);

    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    if (!rel.startsWith("public/") && !rel.startsWith("lib/")) continue;

    graph.push(rel);
    if (!existsSync(abs)) {
      throw new Error(`Missing browser module: ${rel}`);
    }

    const source = readFileSync(abs, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const target = resolveImport(abs, match[1]);
      if (!target) continue;
      const normalized = target.endsWith(".mjs") || target.endsWith(".js") ? target : `${target}.mjs`;
      if (existsSync(normalized)) queue.push(normalized);
      else if (existsSync(`${target}.js`)) queue.push(`${target}.js`);
    }
  }

  return graph.sort();
}

test("execution-lane browser client imports shared kinds without Node APIs", async () => {
  const mod = await import(pathToFileURL(path.join(PUBLIC, "execution-lane-client.mjs")).href);
  assert.equal(mod.EXECUTION_LANE_KIND.QUEUED_NEXT, EXECUTION_LANE_KIND.QUEUED_NEXT);
  assert.equal(isFutureExecutionLaneKind(EXECUTION_LANE_KIND.DEFERRED_BATCH), true);
  assert.equal(isFutureExecutionLaneKind(EXECUTION_LANE_KIND.IMMEDIATE_SINGLE), false);
  const source = readText("public/execution-lane-client.mjs");
  assert.ok(!NODE_IMPORT_RE.test(source));
  assert.ok(!source.includes("execution-lane.mjs"));
});

test("batch queue browser path imports core plan helpers without Node APIs", async () => {
  setBatchQueuePlanRandomIdFactory(() => randomUUID());
  const entry = createQueueEntryFromDraft(sampleDraft(1), { order: 1 });
  assert.match(entry.queueEntryId, /^[0-9a-f-]{36}$/i);
  assert.equal(entry.state, QUEUE_ENTRY_STATE.QUEUED);

  const appended = appendQueueEntry(null, entry);
  assert.equal(appended.ok, true);
  assert.equal(normalizeBatchQueuePlan(appended.plan).version, BATCH_QUEUE_PLAN_VERSION);

  const uiSource = readText("public/batch-queue-ui.mjs");
  assert.ok(!NODE_IMPORT_RE.test(uiSource));
  assert.ok(!uiSource.includes("batch-queue-plan.mjs"));
});

test("server batch queue plan wrapper keeps node:crypto UUID generation", () => {
  setBatchQueuePlanRandomIdFactory(() => randomUUID());
  const a = createQueueEntryFromDraft(sampleDraft(1), { order: 1 });
  const b = createQueueEntryFromDraft(sampleDraft(1), { order: 2 });
  assert.notEqual(a.queueEntryId, b.queueEntryId);
  assert.match(a.queueEntryId, /^[0-9a-f-]{36}$/i);
});

test("browser module graph has zero transitive node:* imports", () => {
  const graph = collectBrowserModuleGraph();
  assert.ok(graph.includes("public/app.js"));
  const offenders = [];
  for (const rel of graph) {
    const source = readText(rel);
    if (NODE_IMPORT_RE.test(source)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `Browser-reachable modules must not import node:*:\n${offenders.join("\n")}`
  );
});
