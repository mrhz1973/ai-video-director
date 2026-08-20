#!/usr/bin/env node
/**
 * Canonical reproducible MiniMax H3 I2VA/FL2VA safe center-crop image-fit patcher.
 *
 * Does NOT embed private workflow contents or absolute local paths.
 * Pass explicit --i2v / --fl2v paths to private (ignored) API-format JSON files.
 *
 * Usage:
 *   node scripts/apply_h3_safe_fit.mjs --check --i2v <path> --fl2v <path>
 *   node scripts/apply_h3_safe_fit.mjs --apply --i2v <path> --fl2v <path>
 *
 * --apply is transactional for detected/caught failures (not filesystem ACID):
 *   PHASE 1 (preflight): validate every supplied workflow in memory; ZERO writes.
 *   PHASE 2 (apply): backup+patch prepared NEEDS_APPLY jobs; on a caught apply-phase
 *     failure after any commit, restore every workflow modified by THIS invocation
 *     to its exact original bytes (atomic replace from backup).
 *   Backups created by a failed invocation remain as recovery artifacts (reported);
 *   pre-existing backups are never deleted (preflight already rejects collisions).
 * Already-safe workflows are left untouched (ALREADY_SAFE).
 *
 * --check exit codes (most severe nonzero wins for multi-file):
 *   0  SAFE or not-applicable
 *   3  NEEDS_APPLY (action required; not a success for automation)
 *   2  UNEXPECTED / invalid graph contract
 *   1  missing file / unreadable / JSON parse / IO / backup collision / other
 */

import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  rename as fsRename,
  access as fsAccess,
  copyFile as fsCopyFile
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SAFE_FIT_STATES,
  applyH3SafeFit,
  inspectH3SafeFit
} from "../comfyui-harness/lib/h3-safe-fit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Exit codes for --check / failed --apply preflight. */
export const EXIT = Object.freeze({
  OK: 0,
  IO: 1,
  UNEXPECTED: 2,
  NEEDS_APPLY: 3
});

/** Injectable filesystem for PHASE 2 tests. */
export function createDefaultFs() {
  return {
    readFile: fsReadFile,
    writeFile: fsWriteFile,
    rename: fsRename,
    access: fsAccess,
    copyFile: fsCopyFile
  };
}

function usage(exitCode = EXIT.IO) {
  const text = `Usage:
  node scripts/apply_h3_safe_fit.mjs --check --i2v <path> [--fl2v <path>]
  node scripts/apply_h3_safe_fit.mjs --apply --i2v <path> [--fl2v <path>]

Options:
  --check   Inspect only; never write.
  --apply   Transactional patch: preflight ALL jobs, then write only if all pass.
            Caught apply-phase failures roll back every workflow modified by this
            invocation to original bytes. Backups from the failed run may remain
            as recovery artifacts. Not a guarantee against power loss / kill -9.
  --i2v     Path to private MiniMax H3 I2VA API JSON.
  --fl2v    Path to private MiniMax H3 FL2VA API JSON.

--check exit codes:
  0  SAFE or not-applicable
  3  NEEDS_APPLY
  2  UNEXPECTED / invalid graph
  1  missing/unreadable/parse/IO

Multi-file: most severe nonzero wins (UNEXPECTED > IO > NEEDS_APPLY).
--apply: preflight failure => ZERO writes. Apply-phase caught failure => rollback.
`;
  process.stderr.write(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = { check: false, apply: false, i2v: null, fl2v: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") out.check = true;
    else if (arg === "--apply") out.apply = true;
    else if (arg === "--i2v") out.i2v = argv[++i];
    else if (arg === "--fl2v") out.fl2v = argv[++i];
    else if (arg === "--help" || arg === "-h") usage(EXIT.OK);
    else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      usage(EXIT.IO);
    }
  }
  return out;
}

async function exists(filePath, fs = createDefaultFs()) {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function backupPathFor(filePath) {
  return `${filePath}.pre-safe-fit.bak`;
}

/**
 * Combine per-job exit codes: UNEXPECTED (2) > IO (1) > NEEDS_APPLY (3) > OK (0).
 */
export function combineExitCodes(codes) {
  const set = new Set(codes.filter(code => code !== EXIT.OK));
  if (set.has(EXIT.UNEXPECTED)) return EXIT.UNEXPECTED;
  if (set.has(EXIT.IO)) return EXIT.IO;
  if (set.has(EXIT.NEEDS_APPLY)) return EXIT.NEEDS_APPLY;
  return EXIT.OK;
}

function exitCodeForStatus(status) {
  if (status === SAFE_FIT_STATES.SAFE || status === SAFE_FIT_STATES.NOT_APPLICABLE) {
    return EXIT.OK;
  }
  if (status === SAFE_FIT_STATES.NEEDS_APPLY) return EXIT.NEEDS_APPLY;
  return EXIT.UNEXPECTED;
}

function printStatus(label, filePath, inspection, extra = "") {
  const base = path.basename(filePath);
  process.stdout.write(
    `${label} ${base}: status=${inspection.status} mode=${inspection.mode || "-"} reason=${inspection.reason || "-"}${extra}\n`
  );
}

function asBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

/**
 * PHASE 1 — read/inspect/plan only. Never writes, never creates backups.
 */
export async function preflightJob({ filePath, mode }, { fs = createDefaultFs() } = {}) {
  const job = {
    filePath,
    mode,
    status: null,
    exitCode: EXIT.OK,
    needsWrite: false,
    backupPath: null,
    patchedWorkflow: null,
    originalBytes: null,
    inspection: null,
    error: null
  };

  try {
    if (!(await exists(filePath, fs))) {
      job.exitCode = EXIT.IO;
      job.error = `File not found: ${path.basename(filePath)}`;
      return job;
    }

    let originalBytes;
    try {
      originalBytes = asBuffer(await fs.readFile(filePath));
    } catch (error) {
      job.exitCode = EXIT.IO;
      job.error = `Unreadable: ${path.basename(filePath)} (${error.message})`;
      return job;
    }

    const raw = originalBytes.toString("utf8");
    let workflow;
    try {
      workflow = JSON.parse(raw);
    } catch (error) {
      job.exitCode = EXIT.IO;
      job.error = `JSON parse failed: ${path.basename(filePath)} (${error.message})`;
      return job;
    }

    job.originalBytes = originalBytes;

    const inspection = inspectH3SafeFit(workflow, { mode });
    job.inspection = inspection;
    job.status = inspection.status;
    job.exitCode = exitCodeForStatus(inspection.status);

    if (inspection.status === SAFE_FIT_STATES.SAFE) {
      return job;
    }
    if (inspection.status === SAFE_FIT_STATES.NOT_APPLICABLE) {
      return job;
    }
    if (inspection.status !== SAFE_FIT_STATES.NEEDS_APPLY) {
      job.exitCode = EXIT.UNEXPECTED;
      job.error = `UNEXPECTED ${path.basename(filePath)}: ${inspection.reason}`;
      return job;
    }

    let result;
    try {
      result = applyH3SafeFit(workflow, { mode });
    } catch (error) {
      job.exitCode = EXIT.UNEXPECTED;
      job.error = `ABORT ${path.basename(filePath)}: ${error.message}`;
      return job;
    }

    if (!result.changed) {
      job.status = SAFE_FIT_STATES.SAFE;
      job.exitCode = EXIT.OK;
      job.inspection = result.report;
      return job;
    }

    if (result.report.status !== SAFE_FIT_STATES.SAFE) {
      job.exitCode = EXIT.UNEXPECTED;
      job.status = SAFE_FIT_STATES.UNEXPECTED;
      job.error = `Patched in-memory result not SAFE for ${path.basename(filePath)}: ${result.report.reason}`;
      return job;
    }

    const bak = backupPathFor(filePath);
    if (await exists(bak, fs)) {
      job.exitCode = EXIT.IO;
      job.error = `Backup already exists (refusing silent overwrite): ${path.basename(bak)}`;
      return job;
    }

    job.needsWrite = true;
    job.backupPath = bak;
    job.patchedWorkflow = result.workflow;
    job.patchedInspection = result.report;
    return job;
  } catch (error) {
    job.exitCode = EXIT.IO;
    job.error = error.message;
    return job;
  }
}

async function atomicReplaceBytes(filePath, bytes, fs) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, filePath);
}

async function atomicWriteJson(filePath, workflow, fs = createDefaultFs()) {
  const body = Buffer.from(`${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  await atomicReplaceBytes(filePath, body, fs);
}

async function restoreJobFromBackup(job, fs) {
  const backupBytes = asBuffer(await fs.readFile(job.backupPath));
  await atomicReplaceBytes(job.filePath, backupBytes, fs);
  const restored = asBuffer(await fs.readFile(job.filePath));
  if (!restored.equals(asBuffer(job.originalBytes))) {
    throw new Error(
      `ROLLBACK VERIFY FAILED for ${path.basename(job.filePath)}: restored bytes do not match original`
    );
  }
  return restored;
}

async function verifyOriginalBytes(job, fs) {
  const current = asBuffer(await fs.readFile(job.filePath));
  if (!current.equals(asBuffer(job.originalBytes))) {
    throw new Error(
      `VERIFY FAILED for ${path.basename(job.filePath)}: source bytes differ from preflight original`
    );
  }
}

/**
 * PHASE 2 — only after every job passed preflight.
 * Tracks commits; on caught failure, restores every committed workflow.
 */
export async function applyPreparedJobs(jobs, { fs = createDefaultFs() } = {}) {
  const results = [];
  const committed = [];
  const createdBackups = [];
  let current = null;

  try {
    for (const job of jobs) {
      if (!job.needsWrite) {
        if (job.status === SAFE_FIT_STATES.SAFE || job.exitCode === EXIT.OK) {
          process.stdout.write(`ALREADY_SAFE ${path.basename(job.filePath)}\n`);
        } else if (job.status === SAFE_FIT_STATES.NOT_APPLICABLE) {
          process.stdout.write(`SKIP ${path.basename(job.filePath)} (not-applicable)\n`);
        }
        results.push({ ...job, changed: false, alreadySafe: job.status === SAFE_FIT_STATES.SAFE });
        continue;
      }

      current = job;
      await fs.copyFile(job.filePath, job.backupPath);
      job.backupCreated = true;
      createdBackups.push(job.backupPath);

      await atomicWriteJson(job.filePath, job.patchedWorkflow, fs);
      job.committed = true;
      committed.push(job);
      current = null;

      process.stdout.write(
        `APPLIED ${path.basename(job.filePath)} backup=${path.basename(job.backupPath)}\n`
      );
      printStatus("AFTER", job.filePath, job.patchedInspection || job.inspection);
      results.push({ ...job, changed: true });
    }

    return {
      ok: true,
      results,
      createdBackups,
      rolledBack: false
    };
  } catch (error) {
    process.stderr.write(`ERROR: apply-phase failure: ${error.message}\n`);
    process.stderr.write(
      "ROLLBACK: restoring every workflow modified by this invocation to original bytes.\n"
    );

    const restoreTargets = [...committed];
    if (current && current.backupCreated && !current.committed) {
      // Backup exists; source should still be original if rename did not complete,
      // but restore from backup anyway if bytes drifted.
      try {
        const cur = asBuffer(await fs.readFile(current.filePath));
        if (!cur.equals(asBuffer(current.originalBytes))) {
          restoreTargets.push(current);
        }
      } catch {
        restoreTargets.push(current);
      }
    }

    const rolledBack = [];
    for (const job of restoreTargets) {
      await restoreJobFromBackup(job, fs);
      job.committed = false;
      job.rolledBack = true;
      rolledBack.push(job.filePath);
      process.stderr.write(`ROLLBACK OK ${path.basename(job.filePath)}\n`);
    }

    // Every NEEDS_APPLY source must match preflight original bytes.
    for (const job of jobs) {
      if (!job.needsWrite || !job.originalBytes) continue;
      await verifyOriginalBytes(job, fs);
    }

    for (const bak of createdBackups) {
      process.stderr.write(
        `RECOVERY_ARTIFACT backup retained: ${path.basename(bak)}\n`
      );
    }

    const fail = new Error(error.message);
    fail.code = "APPLY_PHASE_FAILED";
    fail.cause = error;
    fail.rolledBack = rolledBack;
    fail.createdBackups = createdBackups;
    throw fail;
  }
}

export async function runPatcherCommand({ check, apply, jobs, fs = createDefaultFs() }) {
  const prepared = [];
  for (const job of jobs) {
    const result = await preflightJob(job, { fs });
    prepared.push(result);
    if (result.inspection) {
      printStatus("CHECK", result.filePath, {
        status: result.status,
        mode: result.mode,
        reason: result.inspection.reason
      });
    }
    if (result.error) {
      process.stderr.write(`ERROR: ${result.error}\n`);
    }
  }

  const codes = prepared.map(j => j.exitCode);
  const combined = combineExitCodes(codes);

  if (check) {
    return { exitCode: combined, jobs: prepared, wrote: false };
  }

  const blockers = prepared.filter(j => j.exitCode !== EXIT.OK && j.exitCode !== EXIT.NEEDS_APPLY);
  const needsApplyOk = prepared.every(
    j => j.exitCode === EXIT.OK || j.exitCode === EXIT.NEEDS_APPLY
  );

  if (!needsApplyOk || blockers.length) {
    process.stderr.write(
      "ABORT: preflight failed for one or more workflows; no files were modified and no backups were created.\n"
    );
    return {
      exitCode: combined === EXIT.NEEDS_APPLY ? EXIT.IO : combined || EXIT.IO,
      jobs: prepared,
      wrote: false
    };
  }

  const anyWrite = prepared.some(j => j.needsWrite);
  if (!anyWrite) {
    for (const job of prepared) {
      process.stdout.write(`ALREADY_SAFE ${path.basename(job.filePath)}\n`);
    }
    return { exitCode: EXIT.OK, jobs: prepared, wrote: false };
  }

  try {
    const applied = await applyPreparedJobs(prepared, { fs });
    return {
      exitCode: EXIT.OK,
      jobs: prepared,
      wrote: true,
      createdBackups: applied.createdBackups
    };
  } catch (error) {
    process.stderr.write(
      "ABORT: apply-phase failed after rollback; all supplied source workflows match preflight originals.\n"
    );
    return {
      exitCode: EXIT.IO,
      jobs: prepared,
      wrote: false,
      rolledBack: true,
      createdBackups: error.createdBackups || [],
      error: error.message
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if ((!args.check && !args.apply) || (args.check && args.apply)) usage(EXIT.IO);
  if (!args.i2v && !args.fl2v) usage(EXIT.IO);

  const jobs = [];
  if (args.i2v) jobs.push({ filePath: path.resolve(args.i2v), mode: "I2VA" });
  if (args.fl2v) jobs.push({ filePath: path.resolve(args.fl2v), mode: "FL2VA" });

  const result = await runPatcherCommand({
    check: args.check,
    apply: args.apply,
    jobs
  });
  process.exitCode = result.exitCode;
}

const isDirect = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirect) {
  await main();
}

export {
  parseArgs,
  backupPathFor,
  atomicWriteJson,
  exitCodeForStatus
};
