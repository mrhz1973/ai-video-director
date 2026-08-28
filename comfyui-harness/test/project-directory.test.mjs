/**
 * Issue #100 — persistent project-store authority resolution.
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {
  ProjectDirectoryError,
  defaultPersistentProjectDirectory,
  publicProjectStoreAuthorityView,
  resolveProjectDirectory
} from "../lib/project-directory.mjs";

const harnessRoot = path.join(os.tmpdir(), "h3-harness-root");

test("defaultPersistentProjectDirectory uses LOCALAPPDATA\\AI Video Director\\projects", () => {
  const resolved = defaultPersistentProjectDirectory({
    LOCALAPPDATA: "C:\\Users\\op\\AppData\\Local"
  });
  assert.equal(
    resolved.replace(/\\/g, "/"),
    "C:/Users/op/AppData/Local/AI Video Director/projects"
  );
});

test("H3_PROJECT_DIRECTORY wins over config.projectDirectory", () => {
  const envDir = path.join(os.tmpdir(), "explicit-projects");
  const result = resolveProjectDirectory({
    root: harnessRoot,
    config: { projectDirectory: "./projects" },
    env: { H3_PROJECT_DIRECTORY: envDir }
  });
  assert.equal(result.directory, path.resolve(envDir));
  assert.equal(result.source, "H3_PROJECT_DIRECTORY");
});

test("config.projectDirectory remains usable for dev/test when env unset", () => {
  const result = resolveProjectDirectory({
    root: harnessRoot,
    config: { projectDirectory: "./fixture-projects" },
    env: {}
  });
  assert.equal(result.directory, path.resolve(harnessRoot, "./fixture-projects"));
  assert.equal(result.source, "config.projectDirectory");
});

test("empty H3_PROJECT_DIRECTORY fails closed (no checkout fallback)", () => {
  assert.throws(
    () => resolveProjectDirectory({
      root: harnessRoot,
      config: { projectDirectory: "./projects" },
      env: { H3_PROJECT_DIRECTORY: "   " }
    }),
    ProjectDirectoryError
  );
});

test("Windows default uses persistent authority when no explicit override", () => {
  const result = resolveProjectDirectory({
    root: harnessRoot,
    config: {},
    env: { LOCALAPPDATA: "D:\\AppData\\Local" }
  });
  assert.equal(result.source, "default-persistent");
  assert.match(result.directory.replace(/\\/g, "/"), /AI Video Director\/projects$/);
});

test("non-Windows without LOCALAPPDATA falls back to checkout ./projects", () => {
  const result = resolveProjectDirectory({
    root: harnessRoot,
    config: {},
    env: {}
  });
  assert.equal(result.source, "default-checkout");
  assert.equal(result.directory, path.resolve(harnessRoot, "./projects"));
});

test("publicProjectStoreAuthorityView exposes source without project contents", () => {
  const view = publicProjectStoreAuthorityView({
    directory: "C:\\store\\projects",
    source: "H3_PROJECT_DIRECTORY"
  });
  assert.equal(view.source, "H3_PROJECT_DIRECTORY");
  assert.equal(view.persistent, true);
  assert.equal(view.directory, "C:\\store\\projects");
  assert.equal(Object.keys(view).sort().join(","), "directory,persistent,source");
});
