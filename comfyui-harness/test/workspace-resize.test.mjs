import test from "node:test";
import assert from "node:assert/strict";
import {
  clampWorkspaceHeight,
  defaultWorkspaceHeight,
  storedWorkspaceHeight
} from "../public/workspace-resize.mjs";

test("workspace height clamps to usable desktop bounds", () => {
  assert.equal(clampWorkspaceHeight(200, 1000), 440);
  assert.equal(clampWorkspaceHeight(700, 1000), 700);
  assert.equal(clampWorkspaceHeight(1400, 1000), 984);
});

test("default workspace height is compact and viewport-aware", () => {
  assert.equal(defaultWorkspaceHeight(1000), 720);
  assert.equal(defaultWorkspaceHeight(600), 440);
});

test("stored workspace height restores valid preference and rejects invalid values", () => {
  assert.equal(storedWorkspaceHeight("650", 1000), 650);
  assert.equal(storedWorkspaceHeight("9999", 1000), 984);
  assert.equal(storedWorkspaceHeight("not-a-number", 1000), 720);
  assert.equal(storedWorkspaceHeight("0", 1000), 720);
});
