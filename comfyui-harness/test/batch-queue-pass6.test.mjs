import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createExecutionLaneRegistry,
  EXECUTION_LANE_KIND
} from "../lib/execution-lane.mjs";
import { createPageSessionRegistry } from "../lib/page-session.mjs";
import {
  clearPageSessionId,
  clearStoredExecutionLane,
  getPageSessionId,
  readStoredExecutionLane,
  reconcileExecutionLaneAfterReload,
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
    now: () => now,
    advance(ms) { now += ms; },
    setNow(value) { now = value; }
  };
}

test("pass6 A–E: JS heartbeat silence does not steal live page FUTURE lane", async () => {
  const h = harness({ disconnectGraceMs: 1_000 });
  const pageA = h.pageSessions.open();
  const reserved = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId: "tab-a",
    pageSessionId: pageA
  });
  assert.equal(reserved.ok, true);

  // Advance simulated JS heartbeat silence well past 45s / 60s.
  h.advance(70_000);
  assert.equal(h.pageSessions.isConnected(pageA), true);
  assert.equal(h.pageSessions.isProtected(pageA), true);

  const pageB = h.pageSessions.open();
  const foreign = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "tab-b",
    pageSessionId: pageB
  });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.code, "lane-busy");
  assert.equal(h.lane.get()?.ownerId, "tab-a");
  assert.equal(h.lane.get()?.pageSessionId, pageA);
  assert.equal((await h.lane.reclaimStale({ requesterId: "tab-b" })).ok, false);
  assert.equal((await h.lane.reclaimStale({ requesterId: "tab-b" })).code, "still-alive");
});

test("pass6 F–I: after owner connection loss, FUTURE becomes reclaimable once (no auto-submit)", async () => {
  const h = harness({ disconnectGraceMs: 1_000 });
  const pageA = h.pageSessions.open();
  const reserved = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.DEFERRED_BATCH,
    ownerId: "tab-a",
    pageSessionId: pageA
  });
  assert.equal(reserved.ok, true);

  // Owner connection genuinely disappears.
  h.pageSessions.close(pageA);
  assert.equal(h.pageSessions.isConnected(pageA), false);
  // Still inside grace — not reclaimable yet.
  const pageEarly = h.pageSessions.open();
  assert.equal((await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "early",
    pageSessionId: pageEarly
  })).ok, false);

  h.advance(1_001);
  assert.equal(h.pageSessions.isProtected(pageA), false);

  const pageB = h.pageSessions.open();
  const next = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "tab-b",
    pageSessionId: pageB
  });
  assert.equal(next.ok, true, next.error || next.code);
  assert.equal(h.lane.get()?.ownerId, "tab-b");
  // Exactly one authority — second reserve busy.
  const pageC = h.pageSessions.open();
  assert.equal((await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "tab-c",
    pageSessionId: pageC
  })).ok, false);
  // Stale intent is not auto-submitted (no coordinator arm here — authority only).
  assert.equal(h.lane.get()?.kind, EXECUTION_LANE_KIND.QUEUED_NEXT);
});

test("pass6: copied sessionStorage lease cannot control another page session", async () => {
  const h = harness();
  const pageA = h.pageSessions.open();
  const reserved = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    ownerId: "owner-a",
    pageSessionId: pageA
  });
  assert.equal(reserved.ok, true);
  const copied = {
    ownerId: "owner-a",
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken: reserved.leaseToken
  };

  // Page B: different server page session (duplicated tab).
  const pageB = h.pageSessions.open();
  setPageSessionId(pageB);
  const storage = {
    _map: new Map([["h3ExecutionLane", JSON.stringify(copied)]]),
    getItem(k) { return this._map.has(k) ? this._map.get(k) : null; },
    setItem(k, v) { this._map.set(k, String(v)); },
    removeItem(k) { this._map.delete(k); }
  };

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts = {}) => {
    const body = JSON.parse(opts.body || "{}");
    const result = h.lane.release(body);
    return {
      ok: result.ok,
      status: result.ok ? 200 : 409,
      json: async () => result
    };
  };
  try {
    const reconciled = await reconcileExecutionLaneAfterReload({
      hasLocalFutureIntent: false,
      storage
    });
    assert.equal(reconciled.status, "cleared-local-only");
    assert.equal(reconciled.released?.ok, false);
    assert.equal(h.lane.get()?.ownerId, "owner-a");
    assert.equal(h.lane.get()?.pageSessionId, pageA);
  } finally {
    globalThis.fetch = previousFetch;
  }

  // B heartbeat / transfer / submit with copied lease MUST fail.
  assert.equal(h.lane.heartbeat({
    ownerId: copied.ownerId,
    leaseToken: copied.leaseToken,
    pageSessionId: pageB
  }).code, "invalid-page-session");
  assert.equal(h.lane.transferKind({
    ownerId: copied.ownerId,
    kind: EXECUTION_LANE_KIND.ACTIVE_BATCH,
    leaseToken: copied.leaseToken,
    pageSessionId: pageB
  }).code, "invalid-page-session");
  assert.equal(h.lane.release({
    ownerId: copied.ownerId,
    kind: copied.kind,
    leaseToken: copied.leaseToken,
    pageSessionId: pageB
  }).code, "invalid-page-session");
  assert.equal(h.lane.assertSubmitAllowed({
    ownerId: copied.ownerId,
    kind: copied.kind,
    leaseToken: copied.leaseToken,
    pageSessionId: pageB
  }).code, "invalid-page-session");

  // A remains authoritative with matching page session.
  assert.equal(h.lane.assertSubmitAllowed({
    ownerId: copied.ownerId,
    kind: copied.kind,
    leaseToken: copied.leaseToken,
    pageSessionId: pageA
  }).ok, true);

  // Genuinely lose A → ACTIVE with no live transaction is abandoned-reclaimable
  // so F5 cannot permanently orphan the lane. Copied B still cannot operate A's lease
  // while the reservation exists.
  h.pageSessions.close(pageA);
  h.advance(5_000);
  assert.equal(h.lane.release({
    ...copied,
    pageSessionId: pageB
  }).code, "invalid-page-session");
  const abandoned = await h.lane.reclaimStale();
  assert.equal(abandoned.ok, true, abandoned.error || abandoned.code);
  assert.equal(abandoned.status, "reclaimed");
  assert.equal(h.lane.get(), null);

  clearPageSessionId();
  clearStoredExecutionLane(storage);
});

test("pass6: queued-next copied lease also cannot release owner page", async () => {
  const h = harness({ disconnectGraceMs: 500 });
  const pageA = h.pageSessions.open();
  const reserved = await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    ownerId: "qn-a",
    pageSessionId: pageA
  });
  const pageB = h.pageSessions.open();
  assert.equal(h.lane.release({
    ownerId: "qn-a",
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    leaseToken: reserved.leaseToken,
    pageSessionId: pageB
  }).ok, false);
  assert.equal(h.lane.get()?.ownerId, "qn-a");

  h.pageSessions.close(pageA);
  h.advance(501);
  const pageC = h.pageSessions.open();
  assert.equal((await h.lane.reserve({
    kind: EXECUTION_LANE_KIND.IMMEDIATE_SINGLE,
    ownerId: "qn-c",
    pageSessionId: pageC
  })).ok, true);
});

test("pass6: production paths bind page-session + lease (audit)", async () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /pageSessions\.attach\(/);
  assert.match(server, /event: page-session/);
  assert.match(server, /pageSessions\.close\(pageSessionId,\s*connectionGeneration\)/);
  assert.match(server, /x-h3-page-session/);
  assert.match(server, /pageSessionId:\s*lanePageSession/);
  assert.match(server, /beginSubmitTransaction/);
  assert.match(server, /notePromptAccepted/);
  assert.match(server, /noteComfyMessage/);

  const client = readFileSync(new URL("../public/execution-lane-client.mjs", import.meta.url), "utf8");
  assert.match(client, /memoryPageSessionId/);
  assert.match(client, /memoryPageInstanceId/);
  assert.match(client, /executionLaneSubmitHeaders/);
  assert.match(client, /x-h3-page-session/);
  assert.doesNotMatch(client, /sessionStorage\.setItem\([^)]*pageSessionId/);
  assert.doesNotMatch(client, /sessionStorage\.setItem\([^)]*pageInstanceId/);

  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /setPageSessionId/);
  assert.match(app, /page-session/);
  assert.match(app, /pageInstanceId/);
  assert.match(app, /executionLaneSubmitHeaders/);

  const batchUi = readFileSync(new URL("../public/batch-ui.mjs", import.meta.url), "utf8");
  assert.match(batchUi, /executionLaneSubmitHeaders/);
  assert.match(batchUi, /getPageSessionId/);

  const service = readFileSync(new URL("../lib/batch-queue-service.mjs", import.meta.url), "utf8");
  assert.match(service, /MULTI_BATCH_QUEUE/);
  assert.match(service, /pageSessionId:\s*null/);
});

test("pass6: pageSessionId is never loaded from storage helpers", async () => {
  clearPageSessionId();
  assert.equal(getPageSessionId(), null);
  setPageSessionId("live-from-sse");
  assert.equal(getPageSessionId(), "live-from-sse");
  const storage = {
    _map: new Map(),
    getItem(k) { return this._map.has(k) ? this._map.get(k) : null; },
    setItem(k, v) { this._map.set(k, String(v)); },
    removeItem(k) { this._map.delete(k); }
  };
  writeStoredExecutionLane({
    ownerId: "o",
    kind: EXECUTION_LANE_KIND.QUEUED_NEXT,
    leaseToken: "tok",
    pageSessionId: "should-not-persist"
  }, storage);
  const stored = readStoredExecutionLane(storage);
  assert.equal(stored.pageSessionId, undefined);
  clearPageSessionId();
});
