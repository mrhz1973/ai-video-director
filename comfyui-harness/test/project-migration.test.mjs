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
  ProjectMigrationError,
  applyProjectMigration,
  assertRawMigrationDirectory,
  detectPlanDrift,
  exclusiveCopyProjectFile,
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

async function tempDirs() {
  const source = await mkdtemp(path.join(os.tmpdir(), "h3-mig-src-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "h3-mig-tgt-"));
  return {
    source,
    target,
    cleanup: async () => {
      await rm(source, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  };
}

test("assertRawMigrationDirectory rejects missing, empty and whitespace paths", () => {
  for (const bad of [null, undefined, "", "   ", "\t\n"]) {
    assert.throws(() => assertRawMigrationDirectory(bad, "sourceDir"), ProjectMigrationError);
  }
  assert.doesNotThrow(() => assertRawMigrationDirectory("./projects", "sourceDir"));
});

test("plan rejects empty sourceDir and targetDir before path.resolve", async () => {
  const { source, target, cleanup } = await tempDirs();
  try {
    await assert.rejects(
      () => planProjectMigration({ sourceDir: "", targetDir: target }),
      /whitespace-only/
    );
    await assert.rejects(
      () => planProjectMigration({ sourceDir: source, targetDir: "  " }),
      /whitespace-only/
    );
  } finally {
    await cleanup();
  }
});

test("apply rejects missing targetDir", async () => {
  const { source, cleanup } = await tempDirs();
  try {
    await writeProject(source, "path-a");
    await assert.rejects(
      () => applyProjectMigration({ sourceDir: source, targetDir: null, activate: true }),
      ProjectMigrationError
    );
  } finally {
    await cleanup();
  }
});

test("plan mode performs zero writes", async () => {
  const { source, target, cleanup } = await tempDirs();
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
    await cleanup();
  }
});

test("apply copies COPY_REQUIRED and verifies SHA-256", async () => {
  const { source, target, cleanup } = await tempDirs();
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
    await cleanup();
  }
});

test("identical target is freshly verified without copy", async () => {
  const { source, target, cleanup } = await tempDirs();
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
    await cleanup();
  }
});

test("same-id different content blocks apply before writes", async () => {
  const { source, target, cleanup } = await tempDirs();
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
      err => err instanceof ProjectMigrationError && err.code === "migration-conflict"
    );
    const targetText = await readFile(path.join(target, "delta.local.json"), "utf8");
    assert.match(targetText, /Target/);
    assert.equal(existsSync(path.join(target, "other-copy.local.json")), false);
  } finally {
    await cleanup();
  }
});

test("INVALID_SOURCE mixed with COPY_REQUIRED blocks apply with copied 0", async () => {
  const { source, target, cleanup } = await tempDirs();
  try {
    await writeProject(source, "good");
    await writeFile(path.join(source, "bad.local.json"), "{ not json", "utf8");
    const plan = await planProjectMigration({ sourceDir: source, targetDir: target });
    assert.equal(plan.items.length, 2);
    await assert.rejects(
      () => applyProjectMigration({
        sourceDir: source,
        targetDir: target,
        plan,
        activate: true
      }),
      err => err instanceof ProjectMigrationError && err.code === "invalid-source"
    );
    assert.equal(existsSync(path.join(target, "good.local.json")), false);
  } finally {
    await cleanup();
  }
});

test("SAME_ID_DIFFERENT_CONTENT mixed with COPY_REQUIRED blocks apply with copied 0", async () => {
  const { source, target, cleanup } = await tempDirs();
  try {
    await writeProject(source, "ok-copy");
    await writeProject(source, "conflict", sampleProject("conflict", "Source"));
    await writeProject(target, "conflict", sampleProject("conflict", "Target"));
    const plan = await planProjectMigration({ sourceDir: source, targetDir: target });
    await assert.rejects(
      () => applyProjectMigration({
        sourceDir: source,
        targetDir: target,
        plan,
        activate: true
      }),
      err => err instanceof ProjectMigrationError && err.code === "migration-conflict"
    );
    assert.equal(existsSync(path.join(target, "ok-copy.local.json")), false);
  } finally {
    await cleanup();
  }
});

test("stale plan blocks when source changed after plan", async () => {
  const { source, target, cleanup } = await tempDirs();
  try {
    await writeProject(source, "eta", sampleProject("eta", "Original"));
    const stale = await planProjectMigration({ sourceDir: source, targetDir: target });
    await writeProject(source, "eta", sampleProject("eta", "Changed"));
    await assert.rejects(
      () => applyProjectMigration({
        sourceDir: source,
        targetDir: target,
        plan: stale,
        activate: true
      }),
      err => err instanceof ProjectMigrationError && err.code === "stale-plan-drift"
    );
    assert.equal(existsSync(path.join(target, "eta.local.json")), false);
  } finally {
    await cleanup();
  }
});

test("stale plan blocks when identical target changed after plan", async () => {
  const { source, target, cleanup } = await tempDirs();
  try {
    const { text } = await writeProject(source, "theta");
    await writeFile(path.join(target, "theta.local.json"), text, "utf8");
    const stale = await planProjectMigration({ sourceDir: source, targetDir: target });
    await writeProject(target, "theta", sampleProject("theta", "Mutated"));
    await assert.rejects(
      () => applyProjectMigration({
        sourceDir: source,
        targetDir: target,
        plan: stale,
        activate: true
      }),
      err => err instanceof ProjectMigrationError && err.code === "stale-plan-drift"
    );
  } finally {
    await cleanup();
  }
});

test("stale plan blocks when previously absent target appears", async () => {
  const { source, target, cleanup } = await tempDirs();
  try {
    await writeProject(source, "iota");
    const stale = await planProjectMigration({ sourceDir: source, targetDir: target });
    await writeProject(target, "iota", sampleProject("iota", "Inserted"));
    await assert.rejects(
      () => applyProjectMigration({
        sourceDir: source,
        targetDir: target,
        plan: stale,
        activate: true
      }),
      err => err instanceof ProjectMigrationError && err.code === "stale-plan-drift"
    );
    const targetText = await readFile(path.join(target, "iota.local.json"), "utf8");
    assert.match(targetText, /Inserted/);
  } finally {
    await cleanup();
  }
});

test("detectPlanDrift reports classification and hash changes", () => {
  const stale = {
    sourceDir: "/a/src",
    targetDir: "/a/tgt",
    items: [{
      file: "p.local.json",
      id: "p",
      hash: "aaa",
      targetHash: null,
      classification: MIGRATION_CLASS.COPY_REQUIRED
    }]
  };
  const fresh = {
    sourceDir: "/a/src",
    targetDir: "/a/tgt",
    items: [{
      file: "p.local.json",
      id: "p",
      hash: "bbb",
      targetHash: "bbb",
      classification: MIGRATION_CLASS.IDENTICAL_ALREADY_PRESENT
    }]
  };
  const drifts = detectPlanDrift(stale, fresh);
  assert.ok(drifts.some(d => d.reason === "source-changed-after-plan"));
  assert.ok(drifts.some(d => d.reason === "classification-changed-after-plan"));
});

test("exclusiveCopyProjectFile fails when target already exists", async () => {
  const { source, target, cleanup } = await tempDirs();
  try {
    const srcFile = path.join(source, "src.txt");
    const tgtFile = path.join(target, "tgt.txt");
    await writeFile(srcFile, "source-bytes", "utf8");
    await writeFile(tgtFile, "original-target", "utf8");
    await assert.rejects(
      () => exclusiveCopyProjectFile(srcFile, tgtFile),
      err => err.code === "EEXIST"
    );
    assert.equal(await readFile(tgtFile, "utf8"), "original-target");
  } finally {
    await cleanup();
  }
});

test("apply blocks when target appears at copy time without overwriting", async () => {
  const { source, target, cleanup } = await tempDirs();
  try {
    await writeProject(source, "kappa", sampleProject("kappa", "Kappa"));
    const plan = await planProjectMigration({ sourceDir: source, targetDir: target });
    await assert.rejects(
      () => applyProjectMigration({
        sourceDir: source,
        targetDir: target,
        plan,
        activate: true,
        deps: {
          beforeCopy: async ({ item }) => {
            if (item.id === "kappa") {
              await writeProject(target, "kappa", sampleProject("kappa", "Race"));
            }
          }
        }
      }),
      err => err instanceof ProjectMigrationError && err.code === "target-exists-at-copy"
    );
    const targetText = await readFile(path.join(target, "kappa.local.json"), "utf8");
    assert.match(targetText, /Race/);
  } finally {
    await cleanup();
  }
});

test("apply without activate is rejected", async () => {
  const { source, target, cleanup } = await tempDirs();
  try {
    await writeProject(source, "epsilon");
    await assert.rejects(
      () => applyProjectMigration({ sourceDir: source, targetDir: target, activate: false }),
      /explicit activation/
    );
  } finally {
    await cleanup();
  }
});

test("source files remain untouched after apply", async () => {
  const { source, target, cleanup } = await tempDirs();
  try {
    const { text, hash } = await writeProject(source, "zeta");
    const plan = await planProjectMigration({ sourceDir: source, targetDir: target });
    await applyProjectMigration({ sourceDir: source, targetDir: target, plan, activate: true });
    const after = await readFile(path.join(source, "zeta.local.json"), "utf8");
    assert.equal(after, text);
    assert.equal(createHash("sha256").update(after).digest("hex"), hash);
  } finally {
    await cleanup();
  }
});

test("invalid source JSON is classified INVALID_SOURCE in plan", async () => {
  const { source, target, cleanup } = await tempDirs();
  try {
    await writeFile(path.join(source, "bad-id.local.json"), "{ not json", "utf8");
    const plan = await planProjectMigration({ sourceDir: source, targetDir: target });
    assert.equal(plan.items[0].classification, MIGRATION_CLASS.INVALID_SOURCE);
  } finally {
    await cleanup();
  }
});
