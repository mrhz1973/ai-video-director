/**
 * Eighth-pass regressions for PR #57:
 * 1) Abandoned ACTIVE/IMMEDIATE prompt settlement is browser-independent (Comfy history/queue).
 * 2) FUTURE authority survives transport outage beyond the old 5s grace until abandon.
 * 3) Submit bookkeeping cannot mutate a later reservation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createExecutionLaneRegistry,
  EXECUTION_LANE_KIND,
  PAGE_SESSION_DISCONNECT_GRACE_MS,
  PAGE_SESSION_RECONNECT_WINDOW_MS,
  PAGE_SESSION_LIFECYCLE,
  PROMPT_STATE
} from "../lib/execution-lane.mjs";
import { createPageSessionRegistry } from "../lib/page-session.mjs";
import {
  createResolvePromptState,
  promptStateFromHistoryEntry
} from "../lib/prompt-settlement.mjs";

function harness({
  now: initial = 1_000,
  abandonAfterMs = PAGE_SESSION_RECONNECT_WINDOW_MS,
  resolvePromptState = null
} = {}) {
  let now = initial;
  const pageSessions = createPageSessionRegistry({
    now: () => now,
    abandonAfterMs
  });
  const lane = createExecutionLaneRegistry({
    now: () => now,
    pageSessions,
    resolvePromptState
  });
  return {
    lane,
    pageSessions,
    advance(ms) { now += ms; },
    get now() { return now; }
  };
}

function mockComfy({ promptStates = new Map(), unreachable = false } = {}) {
  let promptPosts = 0;
  const states = promptStates;
  return {
    promptPosts: () => promptPosts,
    setState(id, state) { states.set(String(id), state); },
    resolvePromptState: createResolvePromptState({
      comfyUrl: "http://comfy.test",
      fetchFn: async (url) => {
        if (unreachable) throw new Error("network down");
        const u = String(url);
        if (u.endsWith("/queue")) {
          const running = [];
          const pending = [];
          for (const [id, state] of states) {
            if (state === PROMPT_STATE.RUNNING || state === "queued") {
              (state === "queued" ? pending : running).push([0, id]);
            }
          }
          return {
            ok: true,
            json: async () => ({ queue_running: running, queue_pending: pending })
          };
        }
        const histMatch = u.match(/\/history\/([^/?]+)/);
        if (histMatch) {
          const id = decodeURIComponent(histMatch[1]);
          const state = states.get(id);
          if (!state || state === PROMPT_STATE.RUNNING || state === "queued" || state === PROMPT_STATE.UNKNOWN) {
            return { ok: true, json: async () => ({}) };
          }
          const type =
            state === PROMPT_STATE.COMPLETED ? "execution_success"
              : state === PROMPT_STATE.INTERRUPTED ? "execution_interrupted"
                : state === PROMPT_STATE.FAILED ? "execution_error"
                  : null;
          if (!type) return { ok: true, json: async () => ({}) };
          return {
            ok: true,
            json: async () => ({
              [id]: { status: { messages: [[type, {}]] } }
            })
          };
        }
        if (u.endsWith("/prompt")) {
          promptPosts += 1;
          return { ok: true, json: async () => ({ prompt_id: `unexpected-${promptPosts}` }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }
    })
  };
}

async function simulateQueue(lane, creds, submits) {
  const gate = lane.assertSubmitAllowed({
    ownerId: creds.ownerId,
    kind: creds.kind,
    leaseToken: creds.leaseToken,
    pageSessionId: creds.pageSessionId
  });
  if (!gate.ok) return gate;
  const binding = { generation: gate.generation, leaseToken: gate.leaseToken };
  lane.beginSubmitTransaction(binding);
  try {
    const promptId = `pid-${submits.length + 1}`;
    lane.notePromptAccepted(promptId, binding);
    submits.push(promptId);
    return { ok: true, prompt_id: promptId };
  } finally {
    lane.endSubmitTransaction(binding);
  }
}

async function abandonedInFlightSettlement(kind, terminalState) {
  const comfy = mockComfy();
  const h = harness({
    abandonAfterMs: 1_000,
    resolvePromptState: comfy.resolvePromptState
  });
  const attachedA = h.pageSessions.attach("doc-a");
  const reserved = await h.lane.reserve({
    kind,
    ownerId: "owner-a",
    pageSessionId: attachedA.pageSessionId
  });
  assert.equal(reserved.ok, true);
  const submits = [];
  const queued = await simulateQueue(h.lane, {
    ownerId: "owner-a",
    kind,
    leaseToken: reserved.leaseToken,
    pageSessionId: attachedA.pageSessionId
  }, submits);
  assert.equal(queued.ok, true);
  assert.equal(submits.length, 1);
  const p1 = queued.prompt_id;
  comfy.setState(p1, PROMPT_STATE.RUNNING);

  // Remove ALL browser SSE observers (no notePromptTerminal / noteComfyMessage).
  h.pageSessions.close(attachedA.pageSessionId, attachedA.connectionGeneration);
  h.advance(1_001);
  assert.equal(h.pageSessions.getLifecycle(attachedA.pageSessionId), PAGE_SESSION_LIFECYCLE.ABANDONED);

  const foreign = h.pageSessions.attach("doc-b");
  const stealWhileRunning = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "thief",
    pageSessionId: foreign.pageSessionId
  });
  assert.equal(stealWhileRunning.ok, false);
  assert.equal(stealWhileRunning.code, "lane-busy");
  assert.equal(stealWhileRunning.transactionLive, true);
  const reclaimLive = await h.lane.reclaimStale({ requesterId: "thief" });
  assert.equal(reclaimLive.ok, false);
  assert.equal(reclaimLive.code, "transaction-live");
  assert.equal(submits.length, 1);
  assert.equal(comfy.promptPosts(), 0, "no automatic /prompt replay");

  // Authoritative terminal via Comfy history only — no browser SSE.
  comfy.setState(p1, terminalState);
  const after = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "owner-b",
    pageSessionId: foreign.pageSessionId
  });
  assert.equal(after.ok, true, after.error || after.code);
  assert.equal(h.lane.get()?.ownerId, "owner-b");
  assert.equal(submits.length, 1, "exactly one prior acceptance; no replay");
  assert.equal(comfy.promptPosts(), 0);
}

test("pass8: abandoned ACTIVE_BATCH settles via Comfy history success (no SSE)", async () => {
  await abandonedInFlightSettlement(EXECUTION_LANE_KIND.ACTIVE_BATCH, PROMPT_STATE.COMPLETED);
});

test("pass8: abandoned IMMEDIATE_SINGLE settles via Comfy history success (no SSE)", async () => {
  await abandonedInFlightSettlement(EXECUTION_LANE_KIND.IMMEDIATE_SINGLE, PROMPT_STATE.COMPLETED);
});

test("pass8: abandoned ACTIVE_BATCH settles on execution_error", async () => {
  await abandonedInFlightSettlement(EXECUTION_LANE_KIND.ACTIVE_BATCH, PROMPT_STATE.FAILED);
});

test("pass8: abandoned IMMEDIATE_SINGLE settles on execution_interrupted", async () => {
  await abandonedInFlightSettlement(EXECUTION_LANE_KIND.IMMEDIATE_SINGLE, PROMPT_STATE.INTERRUPTED);
});

test("pass8: history/network unavailable remains fail-closed", async () => {
  const comfy = mockComfy({ unreachable: true });
  const h = harness({
    abandonAfterMs: 500,
    resolvePromptState: comfy.resolvePromptState
  });
  const a = h.pageSessions.attach("net-a");
  const reserved = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    ownerId: "a",
    pageSessionId: a.pageSessionId
  });
  const submits = [];
  await simulateQueue(h.lane, {
    ownerId: "a",
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken: reserved.leaseToken,
    pageSessionId: a.pageSessionId
  }, submits);
  h.pageSessions.close(a.pageSessionId, a.connectionGeneration);
  h.advance(1_000);
  const b = h.pageSessions.attach("net-b");
  assert.equal((await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "b",
    pageSessionId: b.pageSessionId
  })).code, "lane-busy");
  assert.equal((await h.lane.reclaimStale()).code, "transaction-live");
  assert.equal(submits.length, 1);
});

test("pass8: prompt still queued/running remains fail-closed", async () => {
  const comfy = mockComfy();
  const h = harness({
    abandonAfterMs: 500,
    resolvePromptState: comfy.resolvePromptState
  });
  const a = h.pageSessions.attach("run-a");
  const reserved = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "a",
    pageSessionId: a.pageSessionId
  });
  const submits = [];
  const queued = await simulateQueue(h.lane, {
    ownerId: "a",
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    leaseToken: reserved.leaseToken,
    pageSessionId: a.pageSessionId
  }, submits);
  comfy.setState(queued.prompt_id, "queued");
  h.pageSessions.close(a.pageSessionId, a.connectionGeneration);
  h.advance(2_000);
  const b = h.pageSessions.attach("run-b");
  assert.equal((await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    ownerId: "b",
    pageSessionId: b.pageSessionId
  })).ok, false);
  assert.equal((await h.lane.reclaimStale()).code, "transaction-live");
  assert.equal(submits.length, 1);
  assert.equal(comfy.promptPosts(), 0);
});

test("pass8: queue absence alone does not prune (fail-closed unknown)", async () => {
  const resolvePromptState = async () => PROMPT_STATE.UNKNOWN;
  const h = harness({ abandonAfterMs: 200, resolvePromptState });
  const a = h.pageSessions.attach("unk-a");
  const reserved = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    ownerId: "a",
    pageSessionId: a.pageSessionId
  });
  const submits = [];
  await simulateQueue(h.lane, {
    ownerId: "a",
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken: reserved.leaseToken,
    pageSessionId: a.pageSessionId
  }, submits);
  h.pageSessions.close(a.pageSessionId, a.connectionGeneration);
  h.advance(500);
  assert.equal((await h.lane.reclaimStale()).code, "transaction-live");
  assert.equal(submits.length, 1);
});

test("pass8: DEFERRED_BATCH race — B cannot steal during reconnect window after >5s SSE gap", async () => {
  assert.ok(PAGE_SESSION_RECONNECT_WINDOW_MS > PAGE_SESSION_DISCONNECT_GRACE_MS);
  const h = harness({ abandonAfterMs: PAGE_SESSION_RECONNECT_WINDOW_MS });
  const first = h.pageSessions.attach("live-doc");
  const reserved = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId: "tab-a",
    pageSessionId: first.pageSessionId
  });
  assert.equal(reserved.ok, true);
  const leaseToken = reserved.leaseToken;

  // Drop ONLY SSE; same pageInstanceId document remains logically alive.
  h.pageSessions.close(first.pageSessionId, first.connectionGeneration);
  assert.equal(h.pageSessions.getLifecycle(first.pageSessionId), PAGE_SESSION_LIFECYCLE.RECONNECTABLE);

  // Advance beyond the OLD 5s transport grace — still RECONNECTABLE.
  h.advance(PAGE_SESSION_DISCONNECT_GRACE_MS + 1_000);
  assert.equal(h.pageSessions.getLifecycle(first.pageSessionId), PAGE_SESSION_LIFECYCLE.RECONNECTABLE);
  assert.equal(h.pageSessions.isProtected(first.pageSessionId), true);

  // B reserves FIRST — before A reattaches.
  const foreign = h.pageSessions.attach("other-doc");
  const steal = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "tab-b",
    pageSessionId: foreign.pageSessionId
  });
  assert.equal(steal.ok, false);
  assert.equal(steal.code, "lane-busy");
  assert.equal(steal.pageLifecycle, PAGE_SESSION_LIFECYCLE.RECONNECTABLE);

  // A reconnects with same pageInstanceId.
  const reattached = h.pageSessions.attach("live-doc");
  assert.equal(reattached.reattached, true);
  assert.equal(reattached.pageSessionId, first.pageSessionId);
  assert.equal(h.lane.get()?.ownerId, "tab-a");
  assert.equal(h.lane.get()?.kind, EXECUTION_LANE_KIND.DEFERRED_BATCH);

  assert.equal(h.lane.heartbeat({
    ownerId: "tab-a",
    leaseToken,
    pageSessionId: reattached.pageSessionId
  }).ok, true);

  const transferred = h.lane.transferKind({
    ownerId: "tab-a",
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken,
    pageSessionId: reattached.pageSessionId
  });
  assert.equal(transferred.ok, true);

  const submits = [];
  const queued = await simulateQueue(h.lane, {
    ownerId: "tab-a",
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken,
    pageSessionId: reattached.pageSessionId
  }, submits);
  assert.equal(queued.ok, true);
  assert.equal(submits.length, 1);

  assert.equal(h.lane.release({
    ownerId: "tab-a",
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken,
    pageSessionId: reattached.pageSessionId
  }).ok, true);
  assert.equal(h.lane.get(), null);
});

test("pass8: QUEUED_NEXT same reconnect race protection", async () => {
  const h = harness({ abandonAfterMs: PAGE_SESSION_RECONNECT_WINDOW_MS });
  const first = h.pageSessions.attach("qn-doc");
  const reserved = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "a",
    pageSessionId: first.pageSessionId
  });
  h.pageSessions.close(first.pageSessionId, first.connectionGeneration);
  h.advance(PAGE_SESSION_DISCONNECT_GRACE_MS + 2_000);
  const b = h.pageSessions.attach("qn-b");
  assert.equal((await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId: "b",
    pageSessionId: b.pageSessionId
  })).code, "lane-busy");
  const re = h.pageSessions.attach("qn-doc");
  assert.equal(re.pageSessionId, first.pageSessionId);
  assert.equal(h.lane.heartbeat({
    ownerId: "a",
    leaseToken: reserved.leaseToken,
    pageSessionId: re.pageSessionId
  }).ok, true);
});

test("pass8: genuine page abandon eventually reclaimable; no stale auto-submit", async () => {
  const h = harness({ abandonAfterMs: 2_000 });
  const first = h.pageSessions.attach("dead-doc");
  await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId: "dead",
    pageSessionId: first.pageSessionId
  });
  h.pageSessions.close(first.pageSessionId, first.connectionGeneration);
  h.advance(2_001);
  assert.equal(h.pageSessions.getLifecycle(first.pageSessionId), PAGE_SESSION_LIFECYCLE.ABANDONED);
  assert.equal(h.pageSessions.isProtected(first.pageSessionId), false);

  const next = h.pageSessions.attach("new-doc");
  const acquired = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "new",
    pageSessionId: next.pageSessionId
  });
  assert.equal(acquired.ok, true);
  assert.equal(h.lane.get()?.ownerId, "new");
  assert.equal(h.lane.get()?.kind, EXECUTION_LANE_KIND.QUEUED_NEXT, "stale deferred not restored");
});

test("pass8: copied sessionStorage + different pageInstanceId cannot operate A", async () => {
  const h = harness();
  const first = h.pageSessions.attach("orig");
  const reserved = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId: "orig",
    pageSessionId: first.pageSessionId
  });
  const copied = {
    ownerId: "orig",
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    leaseToken: reserved.leaseToken
  };
  const dup = h.pageSessions.attach("dup");
  assert.notEqual(dup.pageSessionId, first.pageSessionId);
  assert.equal(h.lane.heartbeat({ ...copied, pageSessionId: dup.pageSessionId }).code, "invalid-page-session");
  assert.equal(h.lane.transferKind({
    ...copied,
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    pageSessionId: dup.pageSessionId
  }).code, "invalid-page-session");
  assert.equal(h.lane.release({ ...copied, pageSessionId: dup.pageSessionId }).code, "invalid-page-session");
  assert.equal((await simulateQueue(h.lane, { ...copied, pageSessionId: dup.pageSessionId }, [])).ok, false);
});

test("pass8: late submit end/accept cannot mutate a later reservation", async () => {
  const h = harness({ abandonAfterMs: 100 });
  const a = h.pageSessions.attach("tx-a");
  const r1 = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    ownerId: "a",
    pageSessionId: a.pageSessionId
  });
  const gate1 = h.lane.assertSubmitAllowed({
    ownerId: "a",
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken: r1.leaseToken,
    pageSessionId: a.pageSessionId
  });
  const binding1 = { generation: gate1.generation, leaseToken: gate1.leaseToken };
  h.lane.beginSubmitTransaction(binding1);
  h.lane.release({
    ownerId: "a",
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken: r1.leaseToken,
    pageSessionId: a.pageSessionId
  });

  const b = h.pageSessions.attach("tx-b");
  const r2 = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "b",
    pageSessionId: b.pageSessionId
  });
  assert.equal(r2.ok, true);
  assert.equal(h.lane.get()?.httpInFlight, undefined); // not in public snapshot

  // Stale completion from reservation A must not touch B.
  assert.equal(h.lane.endSubmitTransaction(binding1).status, "stale");
  assert.equal(h.lane.notePromptAccepted("orphan-p1", binding1).status, "stale");

  // B still clean: can release without transaction-live.
  assert.equal(h.lane.release({
    ownerId: "b",
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    leaseToken: r2.leaseToken,
    pageSessionId: b.pageSessionId
  }).ok, true);
});

test("pass8: promptStateFromHistoryEntry mapping", () => {
  assert.equal(promptStateFromHistoryEntry({
    status: { messages: [["execution_success", {}]] }
  }), PROMPT_STATE.COMPLETED);
  assert.equal(promptStateFromHistoryEntry({
    status: { messages: [["execution_error", {}]] }
  }), PROMPT_STATE.FAILED);
  assert.equal(promptStateFromHistoryEntry({
    status: { messages: [["execution_interrupted", {}]] }
  }), PROMPT_STATE.INTERRUPTED);
  assert.equal(promptStateFromHistoryEntry({ status: { messages: [] } }), null);
});

test("pass8: production wiring audit", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /createResolvePromptState/);
  assert.match(server, /resolvePromptState/);
  assert.match(server, /settleAbandonedAcceptedPrompts/);
  assert.match(server, /submitBinding/);
  assert.match(server, /await executionLane\.reserve/);
  assert.match(server, /await executionLane\.reclaimStale/);
  assert.match(server, /PAGE_SESSION_RECONNECT_WINDOW_MS|abandonAfterMs|createPageSessionRegistry/);

  const lane = readFileSync(new URL("../lib/execution-lane.mjs", import.meta.url), "utf8");
  assert.match(lane, /settleAbandonedAcceptedPrompts/);
  assert.match(lane, /bindingMatches/);
  assert.match(lane, /RECONNECTABLE|isProtected/);

  const session = readFileSync(new URL("../lib/page-session.mjs", import.meta.url), "utf8");
  assert.match(session, /PAGE_SESSION_RECONNECT_WINDOW_MS/);
  assert.match(session, /RECONNECTABLE/);
});
