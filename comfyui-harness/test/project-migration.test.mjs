/**
 * Issue #100 — copy-only project migration plan/apply (temp fixtures only).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import {
  MIGRATION_CLASS,
  applyProjectMigration,
  planProjectMigration
} from "../lib/project-migration.mjs";

function sampleProject(id, label = "Sample") {
  return {
    schemaVersion: 1,
    id,
    label,
    workflowId: "t2va",
    prompt: "test",
    settings: {},
    library: { elements: [], locations: [], objects: [], audio: [] },
    files: {}
  };
}

async function writeProject(dir, id, payload = sampleProject(id)) {
  const file = path.join(dir, `${id}.local.json`);
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(file, text, "utf8");
  return { file, text, hash: createHash("sha256").update(text).digest("hex") };
}

test("plan mode performs zero writes", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "h3-mig-src-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "h3-mig-tgt-"));
  try {
    await writeProject(source, "alpha");
    const before = await readFile(path.join(source, "alpha.local.json"), "utf8");
    const plan = await planProjectMigration({ sourceDir: source, targetDir: target });
    assert.equal(plan.mode, "plan");
    assert.equal(plan.items.length, 1);
    assert.equal(plan.items[0].classification, MIGRATION_CLASS.COPY_REQUIRED);
    assert.equal(existsSync(path.join(target, "alpha.local.json")), false);
    const after = await readFile(path.join(source, "alpha.local.json"), "utf8");
    assert.equal(after, before);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("apply copies COPY_REQUIRED and verifies SHA-256", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "h3-mig-src-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "h3-mig-tgt-"));
  try {
    const { hash } = await writeProject(source, "beta", sampleProject("beta", "Beta"));
    const plan = await planProjectMigration({ sourceDir: source, targetDir: target });
    const result = await applyProjectMigration({
      sourceDir: source,
      targetDir: target,
      plan,
      activate: true
    });
    assert.equal(result.copied.length, 1);
    assert.equal(result.copied[0].id, "beta");
    assert.equal(result.copied[0].hash, hash);
    const targetText = await readFile(path.join(target, "beta.local.json"), "utf8");
    const sourceText = await readFile(path.join(source, "beta.local.json"), "utf8");
    assert.equal(targetText, sourceText);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("identical target is classified without copy", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "h3-mig-src-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "h3-mig-tgt-"));
  try {
    const { text } = await writeProject(source, "gamma");
    await writeFile(path.join(target, "gamma.local.json"), text, "utf8");
    const plan = await planProjectMigration({ sourceDir: source, targetDir: target });
    assert.equal(plan.items[0].classification, MIGRATION_CLASS.IDENTICAL_ALREADY_PRESENT);
    const result = await applyProjectMigration({
      sourceDir: source,
      targetDir: target,
      plan,
      activate: true
    });
    assert.equal(result.copied.length, 0);
    assert.equal(result.skippedIdentical, 1);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("same-id different content fails closed on apply", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "h3-mig-src-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "h3-mig-tgt-"));
  try {
    await writeProject(source, "delta", sampleProject("delta", "Source"));
    await writeProject(target, "delta", sampleProject("delta", "Target"));
    const plan = await planProjectMigration({ sourceDir: source, targetDir: target });
    assert.equal(plan.items[0].classification, MIGRATION_CLASS.SAME_ID_DIFFERENT_CONTENT);
    await assert.rejects(
      () => applyProjectMigration({
        sourceDir: source,
        targetDir: target,
        plan,
        activate: true
      }),
      /same-id different content/
    );
    const targetText = await readFile(path.join(target, "delta.local.json"), "utf8");
    assert.match(targetText, /Target/);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("apply without activate is rejected", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "h3-mig-src-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "h3-mig-tgt-"));
  try {
    await writeProject(source, "epsilon");
    await assert.rejects(
      () => applyProjectMigration({ sourceDir: source, targetDir: target, activate: false }),
      /explicit activation/
    );
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("source files remain untouched after apply", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "h3-mig-src-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "h3-mig-tgt-"));
  try {
    const { text, hash } = await writeProject(source, "zeta");
    const plan = await planProjectMigration({ sourceDir: source, targetDir: target });
    await applyProjectMigration({ sourceDir: source, targetDir: target, plan, activate: true });
    const after = await readFile(path.join(source, "zeta.local.json"), "utf8");
    assert.equal(after, text);
    assert.equal(createHash("sha256").update(after).digest("hex"), hash);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("invalid source JSON is classified INVALID_SOURCE", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "h3-mig-src-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "h3-mig-tgt-"));
  try {
    await writeFile(path.join(source, "bad-id.local.json"), "{ not json", "utf8");
    const plan = await planProjectMigration({ sourceDir: source, targetDir: target });
    assert.equal(plan.items[0].classification, MIGRATION_CLASS.INVALID_SOURCE);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});
