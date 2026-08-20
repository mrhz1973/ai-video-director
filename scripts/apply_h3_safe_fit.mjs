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
 * --apply is transactional:
 *   PHASE 1 (preflight): validate every supplied workflow in memory; ZERO writes.
 *   PHASE 2 (apply): only if every job passes preflight, backup+patch NEEDS_APPLY files.
 * Already-safe workflows are left untouched (ALREADY_SAFE).
 *
 * --check exit codes (most severe nonzero wins for multi-file):
 *   0  SAFE or not-applicable
 *   3  NEEDS_APPLY (action required; not a success for automation)
 *   2  UNEXPECTED / invalid graph contract
 *   1  missing file / unreadable / JSON parse / IO / backup collision / other
 */

import { readFile, writeFile, rename, access, copyFile } from "node:fs/promises";
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

function usage(exitCode = EXIT.IO) {
  const text = `Usage:
  node scripts/apply_h3_safe_fit.mjs --check --i2v <path> [--fl2v <path>]
  node scripts/apply_h3_safe_fit.mjs --apply --i2v <path> [--fl2v <path>]

Options:
  --check   Inspect only; never write.
  --apply   Transactional patch: preflight ALL jobs, then write only if all pass.
  --i2v     Path to private MiniMax H3 I2VA API JSON.
  --fl2v    Path to private MiniMax H3 FL2VA API JSON.

--check exit codes:
  0  SAFE or not-applicable
  3  NEEDS_APPLY
  2  UNEXPECTED / invalid graph
  1  missing/unreadable/parse/IO

Multi-file: most severe nonzero wins (UNEXPECTED > IO > NEEDS_APPLY).
--apply: if any job fails preflight, abort with ZERO writes and ZERO backups.
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

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
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

/**
 * PHASE 1 — read/inspect/plan only. Never writes, never creates backups.
 */
export async function preflightJob({ filePath, mode }) {
  const job = {
    filePath,
    mode,
    status: null,
    exitCode: EXIT.OK,
    needsWrite: false,
    backupPath: null,
    patchedWorkflow: null,
    inspection: null,
    error: null
  };

  try {
    if (!(await exists(filePath))) {
      job.exitCode = EXIT.IO;
      job.error = `File not found: ${path.basename(filePath)}`;
      return job;
    }

    let raw;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      job.exitCode = EXIT.IO;
      job.error = `Unreadable: ${path.basename(filePath)} (${error.message})`;
      return job;
    }

    let workflow;
    try {
      workflow = JSON.parse(raw);
    } catch (error) {
      job.exitCode = EXIT.IO;
      job.error = `JSON parse failed: ${path.basename(filePath)} (${error.message})`;
      return job;
    }

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
    if (await exists(bak)) {
      job.exitCode = EXIT.IO;
      job.error = `Backup already exists (refusing silent overwrite): ${path.basename(bak)}`;
      return job;
    }

    // Keep original needs-apply inspection for --check reporting; store patched graph separately.
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

async function atomicWriteJson(filePath, workflow) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const body = `${JSON.stringify(workflow, null, 2)}\n`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, filePath);
}

/**
 * PHASE 2 — only after every job passed preflight. Writes only NEEDS_APPLY jobs.
 */
export async function applyPreparedJobs(jobs) {
  const results = [];
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

    await copyFile(job.filePath, job.backupPath);
    await atomicWriteJson(job.filePath, job.patchedWorkflow);
    process.stdout.write(
      `APPLIED ${path.basename(job.filePath)} backup=${path.basename(job.backupPath)}\n`
    );
    printStatus("AFTER", job.filePath, job.patchedInspection || job.inspection);
    results.push({ ...job, changed: true });
  }
  return results;
}

export async function runPatcherCommand({ check, apply, jobs }) {
  const prepared = [];
  for (const job of jobs) {
    const result = await preflightJob(job);
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

  // --apply: any preflight failure aborts with ZERO writes.
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

  // All jobs are SAFE (exit 0) or NEEDS_APPLY (exit 3) with a prepared patch plan.
  const anyWrite = prepared.some(j => j.needsWrite);
  if (!anyWrite) {
    for (const job of prepared) {
      process.stdout.write(`ALREADY_SAFE ${path.basename(job.filePath)}\n`);
    }
    return { exitCode: EXIT.OK, jobs: prepared, wrote: false };
  }

  await applyPreparedJobs(prepared);
  return { exitCode: EXIT.OK, jobs: prepared, wrote: true };
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
