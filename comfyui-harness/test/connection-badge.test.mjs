import test from "node:test";
import assert from "node:assert/strict";
import { connectionBadge } from "../public/connection-badge.mjs";

test("connectionBadge maps open/connected to green collegato text", () => {
  for (const state of ["open", "connected", "ComfyUI collegato"]) {
    const badge = connectionBadge(state);
    assert.equal(badge.state, "open");
    assert.equal(badge.text, "ComfyUI collegato");
    assert.equal(badge.className, "status-ok");
  }
});

test("connectionBadge maps connecting to amber Connessione…", () => {
  for (const state of ["", "connecting", "Connessione…", "Recupero connessione…"]) {
    const badge = connectionBadge(state);
    assert.equal(badge.state, "connecting");
    assert.equal(badge.text, "Connessione…");
    assert.equal(badge.className, "status-wait");
  }
});

test("connectionBadge maps reconnecting to amber Riconnessione…", () => {
  for (const state of ["reconnect", "reconnecting", "Riconnessione…"]) {
    const badge = connectionBadge(state);
    assert.equal(badge.state, "reconnecting");
    assert.equal(badge.text, "Riconnessione…");
    assert.equal(badge.className, "status-wait");
  }
});

test("connectionBadge maps closed/error to red scollegato and never collides with collegato", () => {
  for (const state of ["closed", "error", "disconnected", "ComfyUI scollegato"]) {
    const badge = connectionBadge(state);
    assert.equal(badge.state, "closed");
    assert.equal(badge.text, "ComfyUI scollegato");
    assert.equal(badge.className, "status-bad");
    assert.notEqual(badge.text, "ComfyUI collegato");
  }
});
