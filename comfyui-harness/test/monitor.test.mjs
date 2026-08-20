import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMonitorEvent,
  clampDisplayProgress,
  compactProgressText,
  formatElapsed,
  initialMonitorState,
  mergeTerminalEntries,
  parseQueueCounts,
  progressFromMessage,
  resolveJobStartMs,
  resolveObserverClientId,
  stripAnsi,
  summarizeMonitor
} from "../public/monitor.mjs";

test("numeric progress yields a display percentage", () => {
  assert.deepEqual(clampDisplayProgress(7, 20), { kind: "numeric", value: 7, max: 20, percent: 35 });
  assert.equal(progressFromMessage({ type: "progress", data: { value: 12, max: 20, node: "128", prompt_id: "abc" } }).percent, 60);
});

test("missing or zero max is indeterminate", () => {
  assert.equal(clampDisplayProgress(3, 0).kind, "indeterminate");
  assert.equal(clampDisplayProgress(3, undefined).kind, "indeterminate");
  assert.equal(clampDisplayProgress(NaN, 10).kind, "indeterminate");
  assert.equal(progressFromMessage({ type: "executing", data: { node: "92", display_node: "SaveVideo" } }).kind, "indeterminate");
  assert.equal(progressFromMessage({ type: "executing", data: { node: "92" } }).percent, null);
});

test("malformed numeric progress is clamped for display only", () => {
  assert.deepEqual(clampDisplayProgress(-4, 10), { kind: "numeric", value: 0, max: 10, percent: 0 });
  assert.deepEqual(clampDisplayProgress(15, 10), { kind: "numeric", value: 10, max: 10, percent: 100 });
});

test("node transition and executing-null completion stay distinct from node 100%", () => {
  let state = initialMonitorState();
  state = applyMonitorEvent(state, { type: "executing", data: { node: "128", display_node: "BasicScheduler", prompt_id: "p1" } });
  assert.equal(state.phase, "running");
  assert.equal(state.displayNode, "BasicScheduler");
  state = applyMonitorEvent(state, { type: "progress", data: { value: 20, max: 20, node: "128", prompt_id: "p1" } });
  assert.equal(state.progress.percent, 100);
  assert.equal(state.phase, "running");
  state = applyMonitorEvent(state, { type: "executing", data: { node: "92", display_node: "SaveVideo", prompt_id: "p1" } });
  assert.equal(state.progress.kind, "indeterminate");
  assert.equal(state.phase, "running");
  state = applyMonitorEvent(state, { type: "executing", data: { node: null, prompt_id: "p1" } });
  assert.equal(state.phase, "completed");
  assert.equal(summarizeMonitor(state).barMode, "complete");
});

test("execution_error and execution_interrupted update phase", () => {
  let state = initialMonitorState({ phase: "running" });
  state = applyMonitorEvent(state, { type: "execution_error", data: { prompt_id: "x" } });
  assert.equal(state.phase, "error");
  state = applyMonitorEvent(initialMonitorState({ phase: "running" }), { type: "execution_interrupted", data: {} });
  assert.equal(state.phase, "interrupted");
});

test("recovered active job summary stays honest without invented percentage", () => {
  const summary = summarizeMonitor(initialMonitorState({
    phase: "running",
    promptId: "3c703a3c-d965-4580-bae7-52a7d0b8881b",
    progress: { kind: "indeterminate", value: null, max: null, percent: null },
    nodeId: "128",
    displayNode: "BasicScheduler",
    queueRunning: 1,
    queuePending: 0,
    connection: "ComfyUI collegato"
  }));
  assert.equal(summary.percent, null);
  assert.match(summary.summary, /Nodo in esecuzione/);
  assert.equal(summary.queueRunning, 1);
  assert.equal(compactProgressText(summary), "Nodo in esecuzione · BasicScheduler");
});

test("elapsed time helper formats and marks approximate starts", () => {
  assert.equal(formatElapsed(0), "00:00:00");
  assert.equal(formatElapsed(3661000), "01:01:01");
  assert.equal(formatElapsed(5000, { approximate: true }), "≈ 00:00:05");
  assert.equal(formatElapsed(null), "non disponibile");

  const exact = resolveJobStartMs({
    createdAt: 1_700_000_000_000,
    firstSeenAt: 1_700_000_100_000,
    now: 1_700_000_160_000
  });
  assert.equal(exact.approximate, false);
  assert.equal(exact.source, "create_time");
  assert.equal(exact.elapsedMs, 160_000);
  assert.equal(formatElapsed(exact.elapsedMs, { approximate: exact.approximate }), "00:02:40");

  const localOnly = resolveJobStartMs({ firstSeenAt: 1_700_000_000_000, now: 1_700_000_004_000 });
  assert.equal(localOnly.approximate, true);
  assert.equal(localOnly.source, "local");
  assert.equal(localOnly.elapsedMs, 4_000);
  assert.equal(formatElapsed(localOnly.elapsedMs, { approximate: localOnly.approximate }), "≈ 00:00:04");

  const persistedLocal = resolveJobStartMs({
    storedStartedAt: 1_700_000_000_000,
    firstSeenAt: 1_700_000_002_000,
    now: 1_700_000_010_000
  });
  assert.equal(persistedLocal.approximate, true);
  assert.ok(["session", "local"].includes(persistedLocal.source));
  assert.equal(formatElapsed(persistedLocal.elapsedMs, { approximate: persistedLocal.approximate }), "≈ 00:00:10");
});

test("recovering an external job never steals the active websocket clientId", () => {
  const local = "local-observer-uuid";
  const active = "foreign-job-client-uuid";
  const resolved = resolveObserverClientId({ localClientId: local, activeClientId: active });
  assert.equal(resolved.clientId, local);
  assert.equal(resolved.reusedActiveClientId, false);
  assert.equal(resolved.ignoredActiveClientId, active);
  assert.notEqual(resolved.clientId, active);
});

test("progress_state uses the running node and never invents a percent without max", () => {
  const result = progressFromMessage({
    type: "progress_state",
    data: {
      prompt_id: "p",
      nodes: {
        "1": { state: "finished", value: 20, max: 20, node_id: "1", display_node_id: "Done" },
        "2": { state: "running", value: 0, max: 0, node_id: "2", display_node_id: "SaveVideo" }
      }
    }
  });
  assert.equal(result.kind, "indeterminate");
  assert.equal(result.displayNode, "SaveVideo");
  assert.equal(result.percent, null);
});

test("finished-only progress_state does not show active-node numeric 100%", () => {
  const result = progressFromMessage({
    type: "progress_state",
    data: {
      prompt_id: "p",
      nodes: {
        "128": { state: "finished", value: 20, max: 20, node_id: "128", display_node_id: "BasicScheduler" }
      }
    }
  });
  assert.equal(result.kind, "indeterminate");
  assert.equal(result.percent, null);
  assert.equal(result.value, null);
  assert.equal(result.nodeId, null);
  const summary = summarizeMonitor(applyMonitorEvent(initialMonitorState({ phase: "running" }), {
    type: "progress_state",
    data: {
      prompt_id: "p",
      nodes: {
        "128": { state: "finished", value: 20, max: 20, node_id: "128", display_node_id: "BasicScheduler" }
      }
    }
  }));
  assert.notEqual(summary.barMode, "numeric");
  assert.equal(summary.percent, null);
  assert.doesNotMatch(summary.summary, /100%/);
});

test("queue count parsing", () => {
  assert.deepEqual(parseQueueCounts({ queue_running: [[1], [2]], queue_pending: [[3]] }), { running: 2, pending: 1 });
  assert.deepEqual(parseQueueCounts({}), { running: 0, pending: 0 });
});

test("log/event formatting strips ansi and merges terminal entries", () => {
  assert.equal(stripAnsi("\u001b[32m[INFO]\u001b[0m hello"), "[INFO] hello");
  const merged = mergeTerminalEntries([], [{ t: "2026-08-20T11:00:00", m: "\u001b[32mok\u001b[0m" }]);
  assert.equal(merged[0].m, "ok");
  let state = applyMonitorEvent(initialMonitorState(), {
    type: "logs",
    data: { entries: [{ t: "t1", m: "line1" }] }
  });
  assert.equal(state.terminal[0].m, "line1");
});
