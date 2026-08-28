/**
 * Copy-only project-store migration/reconciliation (plan + explicit apply).
 * Never overwrites, deletes, moves or renames source files.
 */

import { createHash } from "node:crypto";
import { constants } from "node:fs";
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

export class ProjectMigrationError extends Error {
  constructor(message, { code, details } = {}) {
    super(message);
    this.name = "ProjectMigrationError";
    this.code = code || "migration-error";
    this.details = details ?? null;
  }
}

/** Validate raw directory string before path.resolve — fail closed on empty/cwd hazard. */
export function assertRawMigrationDirectory(value, label = "directory") {
  if (value === null || value === undefined) {
    throw new ProjectMigrationError(`${label} is required`, { code: "invalid-directory" });
  }
  if (typeof value !== "string") {
    throw new ProjectMigrationError(`${label} must be a string`, { code: "invalid-directory" });
  }
  if (!value.trim()) {
    throw new ProjectMigrationError(
      `${label} must not be empty or whitespace-only`,
      { code: "invalid-directory" }
    );
  }
}

export function resolveMigrationDirectory(value, label = "directory") {
  assertRawMigrationDirectory(value, label);
  return path.resolve(String(value).trim());
}

async function sha256File(filePath) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
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

function normalizePlanItem(item) {
  return {
    file: item.file,
    id: item.id,
    hash: item.hash ?? null,
    targetHash: item.targetHash ?? null,
    classification: item.classification,
    reason: item.reason ?? null
  };
}

/** Compare stale PLAN snapshot with fresh authoritative PLAN; any material drift blocks APPLY. */
export function detectPlanDrift(stalePlan, freshPlan) {
  const drifts = [];
  if (!stalePlan || !freshPlan) return drifts;

  if (path.resolve(String(stalePlan.sourceDir || "")) !== path.resolve(String(freshPlan.sourceDir || ""))) {
    drifts.push({ field: "sourceDir", reason: "directory-changed-after-plan" });
  }
  if (path.resolve(String(stalePlan.targetDir || "")) !== path.resolve(String(freshPlan.targetDir || ""))) {
    drifts.push({ field: "targetDir", reason: "directory-changed-after-plan" });
  }

  const staleItems = new Map((stalePlan.items || []).map(item => [item.file, normalizePlanItem(item)]));
  const freshItems = new Map((freshPlan.items || []).map(item => [item.file, normalizePlanItem(item)]));

  for (const file of new Set([...staleItems.keys(), ...freshItems.keys()])) {
    const stale = staleItems.get(file);
    const fresh = freshItems.get(file);
    if (!stale) {
      drifts.push({ file, reason: "source-file-added-after-plan" });
      continue;
    }
    if (!fresh) {
      drifts.push({ file, reason: "source-file-removed-after-plan" });
      continue;
    }
    if (stale.hash !== fresh.hash) {
      drifts.push({ file, id: fresh.id, reason: "source-changed-after-plan" });
    }
    if (stale.targetHash !== fresh.targetHash) {
      drifts.push({ file, id: fresh.id, reason: "target-changed-after-plan" });
    }
    if (stale.classification !== fresh.classification) {
      drifts.push({ file, id: fresh.id, reason: "classification-changed-after-plan" });
    }
  }

  return drifts;
}

async function readSourceEntries(sourceDir) {
  const root = resolveMigrationDirectory(sourceDir, "sourceDir");
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
  const source = resolveMigrationDirectory(sourceDir, "sourceDir");
  const target = resolveMigrationDirectory(targetDir, "targetDir");

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

/** Atomic fail-if-exists copy — never overwrites an existing target file. */
export async function exclusiveCopyProjectFile(sourcePath, targetPath, {
  copyFileFn = copyFile
} = {}) {
  await copyFileFn(sourcePath, targetPath, constants.COPYFILE_EXCL);
}

function collectPreflightBlockers(plan) {
  const invalidSource = plan.items.filter(
    item => item.classification === MIGRATION_CLASS.INVALID_SOURCE
  );
  const conflicts = plan.items.filter(
    item => item.classification === MIGRATION_CLASS.SAME_ID_DIFFERENT_CONTENT
  );
  return { invalidSource, conflicts };
}

/**
 * APPLY mode — explicit activation required. Copy-only; fail-closed on conflicts.
 * Always re-plans fresh; optional stale plan is compared and must not drift.
 */
export async function applyProjectMigration({
  sourceDir,
  targetDir,
  plan: stalePlan = null,
  activate = false,
  deps = {}
} = {}) {
  if (!activate) {
    throw new ProjectMigrationError("APPLY requires explicit activation (activate: true)", {
      code: "activation-required"
    });
  }

  const source = resolveMigrationDirectory(sourceDir, "sourceDir");
  const target = resolveMigrationDirectory(targetDir, "targetDir");
  const freshPlan = await planProjectMigration({ sourceDir: source, targetDir: target });

  if (stalePlan) {
    const drifts = detectPlanDrift(stalePlan, freshPlan);
    if (drifts.length) {
      throw new ProjectMigrationError("Migration stopped: stale plan drift detected", {
        code: "stale-plan-drift",
        details: drifts
      });
    }
  }

  const plan = freshPlan;
  const { invalidSource, conflicts } = collectPreflightBlockers(plan);

  if (invalidSource.length) {
    throw new ProjectMigrationError("Migration stopped: invalid source entries", {
      code: "invalid-source",
      details: invalidSource.map(item => ({ file: item.file, reason: item.reason }))
    });
  }

  if (conflicts.length) {
    throw new ProjectMigrationError("Migration stopped: same-id different content conflicts", {
      code: "migration-conflict",
      details: conflicts.map(item => item.id)
    });
  }

  const copyItems = plan.items.filter(
    item => item.classification === MIGRATION_CLASS.COPY_REQUIRED
  );
  const copyExclusive = deps.copyExclusive
    || ((from, to) => exclusiveCopyProjectFile(from, to, { copyFileFn: deps.copyFileFn }));

  if (copyItems.length) {
    await mkdir(plan.targetDir, { recursive: true });
  }

  const copied = [];
  for (const item of copyItems) {
    const sourcePath = path.join(plan.sourceDir, item.file);
    const targetPath = path.join(plan.targetDir, projectFileName(item.id));

    const sourceHash = await sha256File(sourcePath);
    if (sourceHash !== item.hash) {
      throw new ProjectMigrationError(`Source changed for ${item.id} during apply`, {
        code: "source-changed-at-copy",
        details: { id: item.id, file: item.file }
      });
    }

    if (deps.beforeCopy) {
      await deps.beforeCopy({ item, sourcePath, targetPath });
    }

    try {
      await copyExclusive(sourcePath, targetPath);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new ProjectMigrationError(`Target already exists at copy time: ${item.id}`, {
          code: "target-exists-at-copy",
          details: { id: item.id, targetPath }
        });
      }
      throw error;
    }

    const verifyHash = await sha256File(targetPath);
    if (verifyHash !== item.hash) {
      throw new ProjectMigrationError(`Post-copy SHA-256 verification failed for ${item.id}`, {
        code: "verify-failed",
        details: { id: item.id }
      });
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
    invalidSource: 0
  };
}
