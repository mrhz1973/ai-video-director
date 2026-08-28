/**
 * Copy-only project-store migration/reconciliation (plan + explicit apply).
 * Never overwrites, deletes, moves or renames source files.
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { isValidProjectId, parseProjectJson, projectFileName } from "./projects.mjs";

export const MIGRATION_CLASS = Object.freeze({
  COPY_REQUIRED: "COPY_REQUIRED",
  IDENTICAL_ALREADY_PRESENT: "IDENTICAL_ALREADY_PRESENT",
  SAME_ID_DIFFERENT_CONTENT: "SAME_ID_DIFFERENT_CONTENT",
  INVALID_SOURCE: "INVALID_SOURCE"
});

async function sha256File(filePath) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function readSourceEntries(sourceDir) {
  const root = path.resolve(sourceDir);
  const names = (await readdir(root)).filter(name => name.endsWith(".local.json"));
  const entries = [];
  for (const file of names) {
    const filePath = path.join(root, file);
    const idFromName = file.replace(/\.local\.json$/, "");
    try {
      const text = await readFile(filePath, "utf8");
      const hash = sha256Text(text);
      const project = parseProjectJson(text);
      const id = project.id || idFromName;
      if (!isValidProjectId(id)) {
        entries.push({
          file,
          filePath,
          id: idFromName,
          hash,
          classification: MIGRATION_CLASS.INVALID_SOURCE,
          reason: "invalid-project-id"
        });
        continue;
      }
      entries.push({ file, filePath, id, hash, project, classification: null });
    } catch (error) {
      entries.push({
        file,
        filePath,
        id: idFromName,
        hash: null,
        classification: MIGRATION_CLASS.INVALID_SOURCE,
        reason: error?.message || "invalid-source"
      });
    }
  }
  return { root, entries };
}

/**
 * PLAN mode — zero writes. Classifies each source *.local.json against target store.
 */
export async function planProjectMigration({ sourceDir, targetDir }) {
  const source = path.resolve(String(sourceDir || "").trim());
  const target = path.resolve(String(targetDir || "").trim());
  if (!source || !target) {
    throw new Error("sourceDir and targetDir are required");
  }

  const { entries } = await readSourceEntries(source);
  const items = [];

  for (const entry of entries) {
    if (entry.classification === MIGRATION_CLASS.INVALID_SOURCE) {
      items.push({ ...entry });
      continue;
    }
    const targetPath = path.join(target, projectFileName(entry.id));
    if (!existsSync(targetPath)) {
      items.push({
        ...entry,
        targetPath,
        classification: MIGRATION_CLASS.COPY_REQUIRED
      });
      continue;
    }
    const targetHash = await sha256File(targetPath);
    if (targetHash === entry.hash) {
      items.push({
        ...entry,
        targetPath,
        targetHash,
        classification: MIGRATION_CLASS.IDENTICAL_ALREADY_PRESENT
      });
    } else {
      items.push({
        ...entry,
        targetPath,
        targetHash,
        classification: MIGRATION_CLASS.SAME_ID_DIFFERENT_CONTENT
      });
    }
  }

  return {
    mode: "plan",
    sourceDir: source,
    targetDir: target,
    items: items.map(publicMigrationItemView)
  };
}

function publicMigrationItemView(item) {
  return {
    file: item.file,
    id: item.id,
    hash: item.hash,
    targetPath: item.targetPath || null,
    targetHash: item.targetHash || null,
    classification: item.classification,
    reason: item.reason || null
  };
}

/**
 * APPLY mode — explicit activation required. Copy-only; fail-closed on conflicts.
 */
export async function applyProjectMigration({
  sourceDir,
  targetDir,
  plan: existingPlan = null,
  activate = false
} = {}) {
  if (!activate) {
    throw new Error("APPLY requires explicit activation (activate: true)");
  }

  const plan = existingPlan || await planProjectMigration({ sourceDir, targetDir });
  const conflicts = plan.items.filter(
    item => item.classification === MIGRATION_CLASS.SAME_ID_DIFFERENT_CONTENT
  );
  if (conflicts.length) {
    const error = new Error("Migration stopped: same-id different content conflicts");
    error.code = "migration-conflict";
    error.conflicts = conflicts.map(item => item.id);
    throw error;
  }

  await mkdir(plan.targetDir, { recursive: true });

  const copied = [];
  for (const item of plan.items) {
    if (item.classification !== MIGRATION_CLASS.COPY_REQUIRED) continue;
    const sourcePath = path.join(plan.sourceDir, item.file);
    const targetPath = path.join(plan.targetDir, projectFileName(item.id));
    if (existsSync(targetPath)) {
      const error = new Error(`Target already exists: ${targetPath}`);
      error.code = "target-exists";
      throw error;
    }
    await copyFile(sourcePath, targetPath);
    const verifyHash = await sha256File(targetPath);
    if (verifyHash !== item.hash) {
      const error = new Error(`Post-copy SHA-256 verification failed for ${item.id}`);
      error.code = "verify-failed";
      throw error;
    }
    copied.push({ id: item.id, targetPath, hash: verifyHash });
  }

  return {
    mode: "apply",
    sourceDir: plan.sourceDir,
    targetDir: plan.targetDir,
    copied,
    skippedIdentical: plan.items.filter(
      item => item.classification === MIGRATION_CLASS.IDENTICAL_ALREADY_PRESENT
    ).length,
    invalidSource: plan.items.filter(
      item => item.classification === MIGRATION_CLASS.INVALID_SOURCE
    ).length
  };
}
