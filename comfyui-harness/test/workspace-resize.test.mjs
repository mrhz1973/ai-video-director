import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  borderBoxHeightFromResizeEntry,
  clampSidebarWidth,
  clampWorkspaceHeight,
  defaultWorkspaceHeight,
  storedSidebarWidth,
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

test("resize persistence prefers border-box size over content-box measurements", () => {
  assert.equal(borderBoxHeightFromResizeEntry({ borderBoxSize: [{ blockSize: 560 }], contentRect: { height: 504 } }, 559.5), 560);
  assert.equal(borderBoxHeightFromResizeEntry({ borderBoxSize: { blockSize: 650 }, contentRect: { height: 594 } }, 649.5), 650);
});

test("resize persistence falls back to getBoundingClientRect border-box height", () => {
  assert.equal(borderBoxHeightFromResizeEntry({ contentRect: { height: 504 } }, 560), 560);
  assert.equal(borderBoxHeightFromResizeEntry({}, 650), 650);
  assert.equal(borderBoxHeightFromResizeEntry({}, 0), null);
});

test("right sidebar width defaults wider and clamps to safe desktop bounds", () => {
  assert.equal(clampSidebarWidth(undefined, 1600), 520);
  assert.equal(clampSidebarWidth(200, 1600), 360);
  assert.equal(clampSidebarWidth(620, 1600), 620);
  assert.equal(clampSidebarWidth(900, 1600), 760);
});

test("right sidebar leaves room for the left workspace on narrower desktop viewports", () => {
  assert.equal(clampSidebarWidth(700, 1000), 572);
  assert.equal(clampSidebarWidth(520, 900), 472);
  assert.equal(clampSidebarWidth(360, 900), 360);
});

test("stored sidebar width restores valid preference and rejects invalid values", () => {
  assert.equal(storedSidebarWidth("650", 1600), 650);
  assert.equal(storedSidebarWidth("9999", 1600), 760);
  assert.equal(storedSidebarWidth("not-a-number", 1600), 520);
  assert.equal(storedSidebarWidth("0", 900), 472);
});

test("workspace resize UI uses the native corner without the old text label", () => {
  const cssPath = fileURLToPath(new URL("../public/workspace-resize.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  assert.match(css, /\.workspace\s*\{[\s\S]*?resize:\s*vertical;/);
  assert.doesNotMatch(css, /↕\s*ridimensiona/i);
  assert.doesNotMatch(css, /\.workspace::after/);
});
