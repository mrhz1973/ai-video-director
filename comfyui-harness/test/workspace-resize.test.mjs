import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  clampSidebarWidth,
  storedSidebarWidth
} from "../public/workspace-resize.mjs";

test("right sidebar width defaults to the compact inspector range", () => {
  assert.equal(clampSidebarWidth(undefined, 1600), 460);
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
  assert.equal(storedSidebarWidth("not-a-number", 1600), 460);
  assert.equal(storedSidebarWidth("0", 900), 460);
});

test("workspace no longer uses native whole-panel vertical resize", () => {
  const cssPath = fileURLToPath(new URL("../public/workspace-resize.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  assert.match(css, /\.workspace\s*\{[\s\S]*?resize:\s*none;/);
  assert.doesNotMatch(css, /resize:\s*vertical/);
  assert.doesNotMatch(css, /↕\s*ridimensiona/i);
  assert.doesNotMatch(css, /\.workspace::after/);
});

test("workspace-resize module no longer owns whole-workspace height persistence", () => {
  const source = readFileSync(new URL("../public/workspace-resize.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /h3WorkspaceHeight:v1/);
  assert.doesNotMatch(source, /initWorkspaceResize/);
  assert.match(source, /h3SidebarWidth:v1/);
  assert.match(source, /DEFAULT_SIDEBAR_WIDTH = 460/);
});
