import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createExecutionLaneRegistry,
  EXECUTION_LANE_KIND,
  terminalPromptIdFromComfyMessage
} from "../lib/execution-lane.mjs";
import { createPageSessionRegistry } from "../lib/page-session.mjs";
import {
  clearStoredExecutionLane,
  getPageInstanceId,
  readStoredExecutionLane,
  reconcileExecutionLaneAfterReload,
  resetDocumentIdentityForTests,
  setPageSessionId,
  writeStoredExecutionLane
} from "../public/execution-lane-client.mjs";

function harness({ now: initial = 1_000, disconnectGraceMs = 1_000 } = {}) {
  let now = initial;
  const pageSessions = createPageSessionRegistry({
    now: () => now,
    disconnectGraceMs
  });
  const lane = createExecutionLaneRegistry({
    now: () => now,
    pageSessions
  });
  return {
    lane,
    pageSessions,
    advance(ms) { now += ms; }
  };
}

function memoryStorage(copied = null) {
  const map = new Map();
  if (copied) map.set("h3ExecutionLane", JSON.stringify(copied));
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); }
  };
}

function simulateQueue(lane, creds, submits) {
  const gate = lane.assertSubmitAllowed({
    ownerId: creds.ownerId,
    kind: creds.kind,
    leaseToken: creds.leaseToken,
    pageSessionId: creds.pageSessionId
  });
  if (!gate.ok) return gate;
  lane.beginSubmitTransaction();
  try {
    const promptId = `pid-${submits.length + 1}`;
    lane.notePromptAccepted(promptId);
    submits.push(promptId);
    return { ok: true, prompt_id: promptId };
  } finally {
    lane.endSubmitTransaction();
  }
}

test("pass7: F5 does not permanently orphan ACTIVE_BATCH (no live txn)", async () => {
  const h = harness({ disconnectGraceMs: 1_000 });
  const attachedA = h.pageSessions.attach("doc-a");
  const reserved = h.lane.reserve({
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    ownerId: "owner-a",
    pageSessionId: attachedA.pageSessionId
  });
  assert.equal(reserved.ok, true);
  const copied = {
    ownerId: "owner-a",
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken: reserved.leaseToken
  };
  const submits = [];

  // Real F5: drop SSE, new document loses old pageSessionId, storage may be copied.
  h.pageSessions.close(attachedA.pageSessionId, attachedA.connectionGeneration);
  resetDocumentIdentityForTests();
  setPageSessionId(null);
  const storage = memoryStorage(copied);
  const reconciled = await reconcileExecutionLaneAfterReload({
    hasLocalFutureIntent: false,
    storage
  });
  assert.equal(reconciled.status, "cleared-local-await-session");
  assert.equal(submits.length, 0, "no duplicate submission");
  assert.equal(readStoredExecutionLane(storage), null);

  // Foreign cannot steal during grace (page still protected).
  const foreignEarly = h.pageSessions.attach("doc-foreign-early");
  assert.equal(h.lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "foreign",
    pageSessionId: foreignEarly.pageSessionId
  }).code, "lane-busy");

  // Copied storage + different document cannot release/submit.
  const dup = h.pageSessions.attach("doc-dup");
  assert.equal(h.lane.release({
    ...copied,
    pageSessionId: dup.pageSessionId
  }).code, "invalid-page-session");
  assert.equal(simulateQueue(h.lane, { ...copied, pageSessionId: dup.pageSessionId }, submits).ok, false);
  assert.equal(submits.length, 0);

  h.advance(1_001);
  // After safe reconciliation (page gone, no live txn) lane is not stuck.
  const nextDoc = h.pageSessions.attach("doc-after-f5");
  const next = h.lane.reserve({
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    ownerId: "owner-next",
    pageSessionId: nextDoc.pageSessionId
  });
  assert.equal(next.ok, true, next.error || next.code);
  assert.equal(h.lane.get()?.ownerId, "owner-next");
  assert.equal(submits.length, 0);

  h.lane.clear();
  assert.equal(h.lane.get(), null, "Director restart still fail-closed");
  clearStoredExecutionLane(storage);
});

test("pass7: F5 ACTIVE_BATCH stays fail-closed while submit transaction is live", () => {
  const h = harness({ disconnectGraceMs: 500 });
  const attachedA = h.pageSessions.attach("doc-a-live");
  const reserved = h.lane.reserve({
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    ownerId: "owner-a",
    pageSessionId: attachedA.pageSessionId
  });
  const submits = [];
  const queued = simulateQueue(h.lane, {
    ownerId: "owner-a",
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken: reserved.leaseToken,
    pageSessionId: attachedA.pageSessionId
  }, submits);
  assert.equal(queued.ok, true);
  assert.equal(submits.length, 1);

  h.pageSessions.close(attachedA.pageSessionId, attachedA.connectionGeneration);
  h.advance(5_000);

  const foreign = h.pageSessions.attach("doc-thief");
  const steal = h.lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "thief",
    pageSessionId: foreign.pageSessionId
  });
  assert.equal(steal.ok, false);
  assert.equal(steal.code, "lane-busy");
  assert.equal(h.lane.reclaimStale().code, "transaction-live");
  assert.equal(submits.length, 1, "no duplicate /prompt");

  h.lane.notePromptTerminal(queued.prompt_id);
  const after = h.lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "after",
    pageSessionId: foreign.pageSessionId
  });
  assert.equal(after.ok, true, after.error || after.code);
  assert.equal(submits.length, 1);
});

test("pass7: F5 IMMEDIATE_SINGLE same lifecycle as ACTIVE_BATCH", async () => {
  const h = harness({ disconnectGraceMs: 1_000 });
  const attachedA = h.pageSessions.attach("imm-a");
  const reserved = h.lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "imm-owner",
    pageSessionId: attachedA.pageSessionId
  });
  const copied = {
    ownerId: "imm-owner",
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    leaseToken: reserved.leaseToken
  };
  const submits = [];
  const queued = simulateQueue(h.lane, {
    ...copied,
    pageSessionId: attachedA.pageSessionId
  }, submits);
  assert.equal(queued.ok, true);
  assert.equal(submits.length, 1);

  h.pageSessions.close(attachedA.pageSessionId, attachedA.connectionGeneration);
  resetDocumentIdentityForTests();
  const storage = memoryStorage(copied);
  await reconcileExecutionLaneAfterReload({ hasLocalFutureIntent: false, storage });
  assert.equal(submits.length, 1);

  h.advance(1_001);
  const foreign = h.pageSessions.attach("imm-foreign");
  assert.equal(h.lane.reserve({
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    ownerId: "imm-foreign",
    pageSessionId: foreign.pageSessionId
  }).ok, false);
  assert.equal(simulateQueue(h.lane, { ...copied, pageSessionId: foreign.pageSessionId }, submits).ok, false);

  h.lane.noteComfyMessage({ type: "execution_success", data: { prompt_id: queued.prompt_id } });
  assert.equal(h.lane.reserve({
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    ownerId: "imm-after",
    pageSessionId: foreign.pageSessionId
  }).ok, true);
  assert.equal(submits.length, 1);
});

test("pass7: SSE reconnect of same document keeps DEFERRED_BATCH authority", () => {
  const h = harness({ disconnectGraceMs: 1_000 });
  const first = h.pageSessions.attach("live-doc");
  const reserved = h.lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId: "tab-a",
    pageSessionId: first.pageSessionId
  });
  assert.equal(reserved.ok, true);
  const leaseToken = reserved.leaseToken;

  // Drop only SSE transport; document identity remains.
  h.pageSessions.close(first.pageSessionId, first.connectionGeneration);
  assert.equal(h.pageSessions.isConnected(first.pageSessionId), false);
  h.advance(2_000);
  assert.equal(h.pageSessions.isProtected(first.pageSessionId), false);

  const reattached = h.pageSessions.attach("live-doc");
  assert.equal(reattached.reattached, true);
  assert.equal(reattached.pageSessionId, first.pageSessionId);
  assert.equal(h.pageSessions.isConnected(first.pageSessionId), true);
  assert.equal(h.lane.get()?.ownerId, "tab-a");

  const foreign = h.pageSessions.attach("other-doc");
  assert.equal(h.lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "tab-b",
    pageSessionId: foreign.pageSessionId
  }).code, "lane-busy");

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
  const queued = simulateQueue(h.lane, {
    ownerId: "tab-a",
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken,
    pageSessionId: reattached.pageSessionId
  }, submits);
  assert.equal(queued.ok, true);
  assert.equal(submits.length, 1);
  assert.equal(simulateQueue(h.lane, {
    ownerId: "tab-a",
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken,
    pageSessionId: foreign.pageSessionId
  }, submits).ok, false);
  assert.equal(submits.length, 1);

  assert.equal(h.lane.release({
    ownerId: "tab-a",
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken,
    pageSessionId: reattached.pageSessionId
  }).ok, true);
  assert.equal(h.lane.get(), null);
});

test("pass7: duplicate tab with copied storage cannot operate reattached document", () => {
  const h = harness();
  const first = h.pageSessions.attach("orig-doc");
  const reserved = h.lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId: "orig",
    pageSessionId: first.pageSessionId
  });
  const copied = {
    ownerId: "orig",
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    leaseToken: reserved.leaseToken
  };
  const dup = h.pageSessions.attach("dup-doc");
  assert.notEqual(dup.pageSessionId, first.pageSessionId);
  assert.equal(h.lane.heartbeat({ ...copied, pageSessionId: dup.pageSessionId }).code, "invalid-page-session");
  assert.equal(h.lane.transferKind({
    ...copied,
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    pageSessionId: dup.pageSessionId
  }).code, "invalid-page-session");
  assert.equal(h.lane.release({ ...copied, pageSessionId: dup.pageSessionId }).code, "invalid-page-session");
  assert.equal(h.lane.assertSubmitAllowed({
    ...copied,
    pageSessionId: dup.pageSessionId
  }).code, "invalid-page-session");
  assert.equal(h.lane.get()?.pageSessionId, first.pageSessionId);
});

test("pass7: ACTIVE_BATCH / IMMEDIATE_SINGLE survive SSE reconnect of same document", () => {
  for (const kind of [EXECUTION_LANE_KIND.ACTIVE_BATCH, EXECUTION_LANE_KIND.IMMEDIATE_SINGLE]) {
    const h = harness({ disconnectGraceMs: 400 });
    const first = h.pageSessions.attach(`doc-${kind}`);
    const reserved = h.lane.reserve({
      kind,
      ownerId: `owner-${kind}`,
      pageSessionId: first.pageSessionId
    });
    h.pageSessions.close(first.pageSessionId, first.connectionGeneration);
    h.advance(1_000);
    const reattached = h.pageSessions.attach(`doc-${kind}`);
    assert.equal(reattached.pageSessionId, first.pageSessionId);
    assert.equal(h.lane.heartbeat({
      ownerId: `owner-${kind}`,
      leaseToken: reserved.leaseToken,
      pageSessionId: reattached.pageSessionId
    }).ok, true);
    const submits = [];
    assert.equal(simulateQueue(h.lane, {
      ownerId: `owner-${kind}`,
      kind,
      leaseToken: reserved.leaseToken,
      pageSessionId: reattached.pageSessionId
    }, submits).ok, true);
    assert.equal(submits.length, 1);
    const thief = h.pageSessions.attach(`thief-${kind}`);
    assert.equal(h.lane.reserve({
      kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
      ownerId: "thief",
      pageSessionId: thief.pageSessionId
    }).ok, false);
    assert.equal(h.lane.release({
      ownerId: `owner-${kind}`,
      kind,
      leaseToken: reserved.leaseToken,
      pageSessionId: reattached.pageSessionId
    }).ok, true);
  }
});

test("pass7: stale SSE close after reattach does not declare page dead", () => {
  const h = harness({ disconnectGraceMs: 200 });
  const first = h.pageSessions.attach("stable-doc");
  h.lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "a",
    pageSessionId: first.pageSessionId
  });
  const second = h.pageSessions.attach("stable-doc");
  assert.equal(second.reattached, true);
  h.pageSessions.close(first.pageSessionId, first.connectionGeneration);
  h.advance(1_000);
  assert.equal(h.pageSessions.isConnected(second.pageSessionId), true);
  const foreign = h.pageSessions.attach("foreign");
  assert.equal(h.lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId: "b",
    pageSessionId: foreign.pageSessionId
  }).code, "lane-busy");
});

test("pass7: terminalPromptIdFromComfyMessage helper", () => {
  assert.equal(terminalPromptIdFromComfyMessage({
    type: "execution_success",
    data: { prompt_id: "p1" }
  }), "p1");
  assert.equal(terminalPromptIdFromComfyMessage(JSON.stringify({
    type: "execution_error",
    data: { prompt_id: "p2" }
  })), "p2");
  assert.equal(terminalPromptIdFromComfyMessage({ type: "progress", data: { prompt_id: "p3" } }), null);
});

test("pass7: production identity wiring (audit)", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /getPageInstanceId\(\)/);
  assert.match(app, /pageInstanceId=/);
  assert.match(app, /executionLaneSubmitHeaders/);

  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /pageSessions\.attach\(url\.searchParams\.get\("pageInstanceId"\)\)/);
  assert.doesNotMatch(server, /pageSessions\.open\(\)/);

  const client = readFileSync(new URL("../public/execution-lane-client.mjs", import.meta.url), "utf8");
  assert.match(client, /getPageInstanceId/);
  assert.doesNotMatch(client, /sessionStorage\.(get|set)Item\([^)]*pageInstance/);

  assert.ok(getPageInstanceId());
  resetDocumentIdentityForTests();
});
