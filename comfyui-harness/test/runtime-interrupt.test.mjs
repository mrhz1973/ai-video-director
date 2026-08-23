import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRuntimeOwnershipRegistry } from "../lib/runtime-ownership.mjs";
import {
  planBatchCurrentInterrupt,
  planBatchStop,
  planSingleInterrupt,
  verifyPromptRemoval,
  formatBatchStopSummary
} from "../lib/runtime-control.mjs";
import { createRuntimeControlService } from "../lib/runtime-control-service.mjs";
import { parseComfyQueuePayload } from "../lib/comfy-queue.mjs";
import { comfyDeletePendingPrompts, comfyInterruptPrompt } from "../lib/comfy-runtime-api.mjs";
import {
  isTerminalBatchState,
  summarizeBatchJobs,
  formatBatchRuntimeSummary
} from "../public/batch-core.mjs";
import {
  singleInterruptActionable,
  batchCurrentInterruptActionable,
  batchStopActionable,
  applyBatchStopResult
} from "../public/runtime-interrupt-ui.mjs";
import { summarizeMonitor } from "../public/monitor.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const RUNNING = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PENDING_A = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PENDING_B = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const PENDING_C = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const BATCH = "batch-1111-1111-1111-111111111111";

function queuePayload(runningId, pendingIds = []) {
  const running = runningId ? [[1, runningId, {}, {}, []]] : [];
  const pending = pendingIds.map((id, index) => [index + 2, id, {}, {}, []]);
  return { queue_running: running, queue_pending: pending };
}

function registryWithSingle(promptId = RUNNING) {
  const registry = createRuntimeOwnershipRegistry();
  registry.register(promptId, { kind: "single", clientId: "c1" });
  return registry;
}

function registryWithBatch(promptIds, batchId = BATCH) {
  const registry = createRuntimeOwnershipRegistry();
  promptIds.forEach((id, index) => {
    registry.register(id, { kind: "batch", batchId, batchIndex: index, clientId: "c1" });
  });
  return registry;
}

test("audited interrupt adapter sends POST /interrupt with prompt_id only", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200 };
  };
  await comfyInterruptPrompt("http://127.0.0.1:8188", RUNNING, fetchFn);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/interrupt$/);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].body, { prompt_id: RUNNING });
});

test("audited queue delete adapter sends selective delete list only", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200 };
  };
  await comfyDeletePendingPrompts("http://127.0.0.1:8188", [PENDING_A, PENDING_B], fetchFn);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/queue$/);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].body, { delete: [PENDING_A, PENDING_B] });
  assert.equal(calls[0].body.clear, undefined);
});

test("planSingleInterrupt accepts owned running prompt", () => {
  const registry = registryWithSingle();
  const plan = planSingleInterrupt({
    expectedPromptId: RUNNING,
    queuePayload: queuePayload(RUNNING),
    registry
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.interruptPromptId, RUNNING);
  assert.deepEqual(plan.pendingToDelete, []);
});

test("planSingleInterrupt fails closed on prompt mismatch", () => {
  const registry = registryWithSingle();
  const plan = planSingleInterrupt({
    expectedPromptId: RUNNING,
    queuePayload: queuePayload(OTHER),
    registry
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, "prompt-mismatch");
});

test("planSingleInterrupt fails closed without ownership", () => {
  const registry = createRuntimeOwnershipRegistry();
  const plan = planSingleInterrupt({
    expectedPromptId: RUNNING,
    queuePayload: queuePayload(RUNNING),
    registry
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, "ownership-missing");
});

test("planBatchCurrentInterrupt keeps pending batch jobs queued", () => {
  const registry = registryWithBatch([RUNNING, PENDING_A, PENDING_B]);
  const plan = planBatchCurrentInterrupt({
    batchId: BATCH,
    expectedPromptId: RUNNING,
    queuePayload: queuePayload(RUNNING, [PENDING_A, PENDING_B, OTHER]),
    registry
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.pendingToDelete, []);
});

test("planBatchStop interrupts running and deletes owned pending only", () => {
  const registry = registryWithBatch([RUNNING, PENDING_A, PENDING_B]);
  const plan = planBatchStop({
    batchId: BATCH,
    expectedRunningPromptId: RUNNING,
    queuePayload: queuePayload(RUNNING, [PENDING_A, PENDING_B, OTHER]),
    registry
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.interruptPromptId, RUNNING);
  assert.deepEqual(plan.pendingToDelete, [PENDING_A, PENDING_B]);
  assert.equal(plan.unrelatedPreserved, 1);
});

test("planBatchStop fails closed when ownership missing", () => {
  const registry = createRuntimeOwnershipRegistry();
  const plan = planBatchStop({
    batchId: BATCH,
    expectedRunningPromptId: RUNNING,
    queuePayload: queuePayload(RUNNING, [PENDING_A]),
    registry
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, "ownership-missing");
});

test("verifyPromptRemoval marks removed pending ids as cancelled", () => {
  const result = verifyPromptRemoval({
    attemptedIds: [PENDING_A],
    runningPromptIds: [],
    pendingPromptIds: []
  });
  assert.deepEqual(result.cancelled, [PENDING_A]);
  assert.deepEqual(result.stillPending, []);
  assert.deepEqual(result.nowRunning, []);
});

test("verifyPromptRemoval keeps still-pending ids as skipped", () => {
  const result = verifyPromptRemoval({
    attemptedIds: [PENDING_A, PENDING_B],
    runningPromptIds: [],
    pendingPromptIds: [PENDING_B]
  });
  assert.deepEqual(result.cancelled, [PENDING_A]);
  assert.deepEqual(result.stillPending, [PENDING_B]);
  assert.deepEqual(result.nowRunning, []);
});

test("verifyPromptRemoval never marks running prompt as cancelled", () => {
  const result = verifyPromptRemoval({
    attemptedIds: [PENDING_A],
    runningPromptIds: [PENDING_A],
    pendingPromptIds: []
  });
  assert.deepEqual(result.cancelled, []);
  assert.deepEqual(result.stillPending, []);
  assert.deepEqual(result.nowRunning, [PENDING_A]);
});

test("batch stop race: owned pending promoted to running is interrupted not cancelled", async () => {
  const NEXT = PENDING_A;
  let queueState = queuePayload(RUNNING, [NEXT, PENDING_B, OTHER]);
  const interrupted = [];
  const deleteBodies = [];
  const fetchFn = async (url, init) => {
    if (url.endsWith("/queue") && init?.method === "POST") {
      const body = JSON.parse(init.body);
      deleteBodies.push(body);
      queueState = {
        queue_running: queueState.queue_running,
        queue_pending: queueState.queue_pending.filter(entry => !body.delete.includes(entry[1]))
      };
      return { ok: true, status: 200 };
    }
    if (url.endsWith("/queue")) {
      return { ok: true, status: 200, json: async () => queueState };
    }
    if (url.endsWith("/interrupt")) {
      const body = JSON.parse(init.body);
      interrupted.push(body.prompt_id);
      if (body.prompt_id === RUNNING) {
        queueState = queuePayload(NEXT, [PENDING_B, OTHER]);
      } else if (body.prompt_id === NEXT) {
        queueState = queuePayload(null, [PENDING_B, OTHER]);
      }
      return { ok: true, status: 200 };
    }
    throw new Error(`unexpected ${url}`);
  };
  const registry = registryWithBatch([RUNNING, NEXT, PENDING_B]);
  const service = createRuntimeControlService({
    comfyUrl: "http://127.0.0.1:1",
    ownershipRegistry: registry,
    fetchFn
  });
  const result = await service.stopBatch({ batchId: BATCH, expectedRunningPromptId: RUNNING });
  assert.deepEqual(interrupted, [RUNNING, NEXT]);
  assert.ok(result.cancelledPromptIds.includes(PENDING_B));
  assert.equal(result.cancelledPromptIds.includes(NEXT), false);
  assert.equal(deleteBodies.length >= 1, true);
  assert.equal(deleteBodies.some(body => body.clear === true), false);
  assert.ok(deleteBodies.every(body => body.delete.every(id => [NEXT, PENDING_B].includes(id))));
});

test("batch stop race: unrelated successor is not interrupted", async () => {
  let queueState = queuePayload(RUNNING, [OTHER]);
  const interrupted = [];
  const fetchFn = async (url, init) => {
    if (url.endsWith("/queue") && init?.method === "POST") {
      const body = JSON.parse(init.body);
      queueState = {
        queue_running: queueState.queue_running,
        queue_pending: queueState.queue_pending.filter(entry => !body.delete.includes(entry[1]))
      };
      return { ok: true, status: 200 };
    }
    if (url.endsWith("/queue")) {
      return { ok: true, status: 200, json: async () => queueState };
    }
    if (url.endsWith("/interrupt")) {
      const body = JSON.parse(init.body);
      interrupted.push(body.prompt_id);
      if (body.prompt_id === RUNNING) {
        queueState = queuePayload(OTHER, []);
      }
      return { ok: true, status: 200 };
    }
    throw new Error(`unexpected ${url}`);
  };
  const registry = registryWithBatch([RUNNING]);
  const service = createRuntimeControlService({
    comfyUrl: "http://127.0.0.1:1",
    ownershipRegistry: registry,
    fetchFn
  });
  const result = await service.stopBatch({ batchId: BATCH, expectedRunningPromptId: RUNNING });
  assert.deepEqual(interrupted, [RUNNING]);
  assert.equal(result.cancelledPromptIds.includes(OTHER), false);
});

test("batch stop preserves unrelated pending queue entries", async () => {
  let queueState = queuePayload(RUNNING, [PENDING_A, OTHER]);
  const fetchFn = async (url, init) => {
    if (url.endsWith("/queue") && init?.method === "POST") {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.delete, [PENDING_A]);
      queueState = {
        queue_running: queueState.queue_running,
        queue_pending: queueState.queue_pending.filter(entry => !body.delete.includes(entry[1]))
      };
      return { ok: true, status: 200 };
    }
    if (url.endsWith("/queue")) {
      return { ok: true, status: 200, json: async () => queueState };
    }
    if (url.endsWith("/interrupt")) {
      queueState = queuePayload(null, [OTHER]);
      return { ok: true, status: 200 };
    }
    throw new Error(`unexpected ${url}`);
  };
  const registry = registryWithBatch([RUNNING, PENDING_A]);
  const service = createRuntimeControlService({
    comfyUrl: "http://127.0.0.1:1",
    ownershipRegistry: registry,
    fetchFn
  });
  const result = await service.stopBatch({ batchId: BATCH, expectedRunningPromptId: RUNNING });
  assert.deepEqual(result.cancelledPromptIds, [PENDING_A]);
  assert.equal(parseComfyQueuePayload(queueState).pendingPromptIds.includes(OTHER), true);
});

test("verifyPendingDeletions reports skipped ids still pending", () => {
  const result = verifyPromptRemoval({
    attemptedIds: [PENDING_A, PENDING_B],
    runningPromptIds: [],
    pendingPromptIds: [PENDING_B]
  });
  assert.deepEqual(result.cancelled, [PENDING_A]);
  assert.deepEqual(result.stillPending, [PENDING_B]);
});

test("runtime service interrupts owned single and is idempotent", async () => {
  let interruptCount = 0;
  const fetchFn = async (url, init) => {
    if (url.endsWith("/queue")) {
      return { ok: true, status: 200, json: async () => queuePayload(RUNNING) };
    }
    if (url.endsWith("/interrupt")) {
      interruptCount += 1;
      return { ok: true, status: 200 };
    }
    throw new Error(`unexpected ${url}`);
  };
  const registry = registryWithSingle();
  const service = createRuntimeControlService({
    comfyUrl: "http://127.0.0.1:1",
    ownershipRegistry: registry,
    fetchFn
  });
  const [first, second] = await Promise.all([
    service.interruptSingle({ expectedPromptId: RUNNING }),
    service.interruptSingle({ expectedPromptId: RUNNING })
  ]);
  assert.equal(first.ok, true);
  assert.ok(first.status === "already-in-flight" || second.status === "already-in-flight");
  assert.equal(interruptCount, 1);
});

test("runtime service stop-batch deletes owned pending and verifies removal", async () => {
  let queueState = queuePayload(RUNNING, [PENDING_A, PENDING_B, OTHER]);
  const calls = [];
  const fetchFn = async (url, init) => {
    if (url.endsWith("/queue") && init?.method === "POST") {
      const body = JSON.parse(init.body);
      calls.push(body);
      queueState = {
        queue_running: queueState.queue_running,
        queue_pending: queueState.queue_pending.filter(entry => !body.delete.includes(entry[1]))
      };
      return { ok: true, status: 200 };
    }
    if (url.endsWith("/queue")) {
      return { ok: true, status: 200, json: async () => queueState };
    }
    if (url.endsWith("/interrupt")) {
      return { ok: true, status: 200 };
    }
    throw new Error(`unexpected ${url}`);
  };
  const registry = registryWithBatch([RUNNING, PENDING_A, PENDING_B]);
  const service = createRuntimeControlService({
    comfyUrl: "http://127.0.0.1:1",
    ownershipRegistry: registry,
    fetchFn
  });
  const result = await service.stopBatch({ batchId: BATCH, expectedRunningPromptId: RUNNING });
  assert.equal(result.interruptedPromptId, RUNNING);
  assert.deepEqual(result.cancelledPromptIds, [PENDING_A, PENDING_B]);
  assert.deepEqual(result.skippedPromptIds, []);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].delete.sort(), [PENDING_A, PENDING_B].sort());
  assert.equal(calls[0].clear, undefined);
});

test("batch runtime states: cancelled and interrupted terminal; interrupting not terminal", () => {
  assert.equal(isTerminalBatchState("cancelled"), true);
  assert.equal(isTerminalBatchState("interrupted"), true);
  assert.equal(isTerminalBatchState("interrupting"), false);
});

test("batch summary counts completed, interrupted and cancelled", () => {
  assert.equal(formatBatchRuntimeSummary([
    { state: "completed" },
    { state: "completed" },
    { state: "completed" },
    { state: "interrupted" },
    { state: "cancelled" },
    { state: "cancelled" },
    { state: "cancelled" },
    { state: "cancelled" }
  ]), "3 completati · 1 interrotti · 4 annullati");
  const summary = summarizeBatchJobs([
    { state: "interrupting" },
    { state: "cancelled" }
  ]);
  assert.equal(summary.interrupting, 1);
  assert.equal(summary.cancelled, 1);
});

test("single interrupt UI is actionable only with ownership while running", () => {
  assert.equal(singleInterruptActionable({
    phase: "running",
    promptId: RUNNING,
    ownershipControllable: true,
    interruptPending: false
  }).enabled, true);
  assert.equal(singleInterruptActionable({
    phase: "running",
    promptId: RUNNING,
    ownershipControllable: false,
    interruptPending: false
  }).enabled, false);
  assert.equal(singleInterruptActionable({
    phase: "idle",
    promptId: RUNNING,
    ownershipControllable: true,
    interruptPending: false
  }).visible, false);
});

test("monitor shows interrupting and user-interrupted labels", () => {
  assert.equal(summarizeMonitor({ phase: "interrupting" }).summary, "Interruzione…");
  assert.equal(summarizeMonitor({ phase: "interrupted", userInterrupted: true }).summary, "Interrotto dall'utente");
});

test("applyBatchStopResult marks cancelled and interrupting jobs only from server result", () => {
  const jobs = [
    { promptId: RUNNING, state: "running" },
    { promptId: PENDING_A, state: "pending" },
    { promptId: PENDING_B, state: "pending" }
  ];
  const next = applyBatchStopResult(jobs, {
    interruptedPromptId: RUNNING,
    cancelledPromptIds: [PENDING_A],
    skippedPromptIds: [PENDING_B]
  });
  assert.equal(next[0].state, "interrupting");
  assert.equal(next[1].state, "cancelled");
  assert.equal(next[2].state, "pending");
});

test("batch stop UI requires ownership", () => {
  const jobs = [{ state: "running", promptId: RUNNING }];
  assert.equal(batchStopActionable({ jobs, ownershipControllable: false, stopPending: false }).enabled, false);
  assert.equal(batchCurrentInterruptActionable({ jobs, ownershipControllable: true, interruptPending: false }).enabled, true);
});

test("formatBatchStopSummary matches runtime summary semantics", () => {
  assert.equal(formatBatchStopSummary([
    { state: "completed" },
    { state: "interrupted" },
    { state: "cancelled" }
  ]), "1 completati · 1 interrotti · 1 annullati");
});

test("static safety: runtime interruption code has no process kill or whole-queue clear", async () => {
  const files = [
    "../server.mjs",
    "../lib/runtime-control-service.mjs",
    "../lib/runtime-control.mjs",
    "../lib/comfy-runtime-api.mjs",
    "../public/app.js",
    "../public/batch-ui.mjs"
  ];
  const forbidden = [
    /taskkill/i,
    /Stop-Process/i,
    /TerminateProcess/i,
    /kill python/i,
    /kill node/i,
    /"clear"\s*:\s*true/
  ];
  for (const rel of files) {
    const source = await readFile(new URL(rel, import.meta.url), "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${rel} must not contain ${pattern}`);
    }
  }
});

test("UI contract exposes interrupt controls without draft mutation", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const batch = await readFile(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");
  assert.match(html, /id="interruptSingleRender"/);
  assert.match(html, />INTERROMPI RENDER</);
  assert.match(app, /interruptSingleRender/);
  assert.match(app, /\/api\/runtime\/interrupt-single/);
  assert.match(batch, /batchInterruptCurrent/);
  assert.match(batch, /batchInterruptAll/);
  assert.match(batch, /batchCurrentInterruptConfirmMessage/);
  assert.match(batch, /\/api\/runtime\/stop-batch/);
  assert.doesNotMatch(batch, /clear:\s*true/);
});

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function freePort() {
  const probe = http.createServer();
  const port = await listen(probe);
  probe.close();
  await once(probe, "close");
  return port;
}

async function writeTempHarnessConfig({ comfyPort, harnessPort, projectsDir }) {
  const configPath = path.join(path.dirname(projectsDir), "harness.config.json");
  await writeFile(configPath, `${JSON.stringify({
    comfyUrl: `http://127.0.0.1:${comfyPort}`,
    listenHost: "127.0.0.1",
    listenPort: harnessPort,
    workflowDirectory: "./workflows",
    projectDirectory: projectsDir
  }, null, 2)}\n`, "utf8");
  return configPath;
}

async function spawnHarness(configPath) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, H3_CONFIG_PATH: configPath }
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`harness start timeout\n${stderr}`)), 8000);
    child.stdout.on("data", chunk => {
      if (String(chunk).includes("H3 harness:")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", code => {
      clearTimeout(timer);
      reject(new Error(`harness exited ${code}\n${stderr}`));
    });
  });
  return { child, stderr: () => stderr };
}

async function stopHarness(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
}

test("integration: ownership endpoint fails closed after server restart semantics", async () => {
  let queueState = queuePayload(null, []);
  const comfyCalls = { interrupt: 0, delete: 0 };
  const fakeComfy = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/queue") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(queueState));
      return;
    }
    if (req.method === "POST" && req.url === "/interrupt") {
      comfyCalls.interrupt += 1;
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === "POST" && req.url === "/queue") {
      comfyCalls.delete += 1;
      res.writeHead(200);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const comfyPort = await listen(fakeComfy);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "h3-runtime-int-"));
  const projects = path.join(tmp, "projects");
  await mkdir(projects, { recursive: true });
  const harnessPort = await freePort();
  const configPath = await writeTempHarnessConfig({ comfyPort, harnessPort, projectsDir: projects });
  let child;
  try {
    const spawned = await spawnHarness(configPath);
    child = spawned.child;
    const ownership = await fetch(`http://127.0.0.1:${harnessPort}/api/runtime/ownership?promptId=${RUNNING}`);
    const body = await ownership.json();
    assert.equal(body.controllable, false);
    const interrupt = await fetch(`http://127.0.0.1:${harnessPort}/api/runtime/interrupt-single`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedPromptId: RUNNING })
    });
    assert.equal(interrupt.status, 409);
    assert.equal(comfyCalls.interrupt, 0);
    assert.equal(comfyCalls.delete, 0);
  } finally {
    await stopHarness(child);
    fakeComfy.close();
    await rm(tmp, { recursive: true, force: true });
  }
});
