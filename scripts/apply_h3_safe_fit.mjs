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
 * --apply creates a sibling backup (<file>.pre-safe-fit.bak) before mutation.
 * Already-safe workflows are left untouched (ALREADY_SAFE).
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

function usage(exitCode = 1) {
  const text = `Usage:
  node scripts/apply_h3_safe_fit.mjs --check --i2v <path> [--fl2v <path>]
  node scripts/apply_h3_safe_fit.mjs --apply --i2v <path> [--fl2v <path>]

Options:
  --check   Inspect only; never write.
  --apply   Patch needs-apply graphs after validation; creates .pre-safe-fit.bak first.
  --i2v     Path to private MiniMax H3 I2VA API JSON.
  --fl2v    Path to private MiniMax H3 FL2VA API JSON.

Fail-closed: unexpected topology aborts with no write.
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
    else if (arg === "--help" || arg === "-h") usage(0);
    else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      usage(1);
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

async function loadWorkflow(filePath, mode) {
  const raw = await readFile(filePath, "utf8");
  const workflow = JSON.parse(raw);
  return { workflow, raw, inspection: inspectH3SafeFit(workflow, { mode }) };
}

function printStatus(label, filePath, inspection, extra = "") {
  const base = path.basename(filePath);
  process.stdout.write(
    `${label} ${base}: status=${inspection.status} mode=${inspection.mode || "-"} reason=${inspection.reason || "-"}${extra}\n`
  );
}

async function backupPathFor(filePath) {
  const bak = `${filePath}.pre-safe-fit.bak`;
  if (await exists(bak)) {
    const err = new Error(`Backup already exists (refusing silent overwrite): ${path.basename(bak)}`);
    err.code = "BACKUP_EXISTS";
    throw err;
  }
  return bak;
}

async function atomicWriteJson(filePath, workflow) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const body = `${JSON.stringify(workflow, null, 2)}\n`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, filePath);
}

async function processOne({ filePath, mode, apply }) {
  const loaded = await loadWorkflow(filePath, mode);
  printStatus("CHECK", filePath, loaded.inspection);
  if (!apply) return { filePath, mode, inspection: loaded.inspection, changed: false };

  if (loaded.inspection.status === SAFE_FIT_STATES.SAFE) {
    process.stdout.write(`ALREADY_SAFE ${path.basename(filePath)}\n`);
    return { filePath, mode, inspection: loaded.inspection, changed: false, alreadySafe: true };
  }
  if (loaded.inspection.status === SAFE_FIT_STATES.NOT_APPLICABLE) {
    process.stdout.write(`SKIP ${path.basename(filePath)} (not-applicable)\n`);
    return { filePath, mode, inspection: loaded.inspection, changed: false };
  }
  if (loaded.inspection.status !== SAFE_FIT_STATES.NEEDS_APPLY) {
    const err = new Error(`ABORT ${path.basename(filePath)}: ${loaded.inspection.reason}`);
    err.code = "UNEXPECTED_TOPOLOGY";
    err.inspection = loaded.inspection;
    throw err;
  }

  const result = applyH3SafeFit(loaded.workflow, { mode });
  if (!result.changed) {
    process.stdout.write(`ALREADY_SAFE ${path.basename(filePath)}\n`);
    return { filePath, mode, inspection: result.report, changed: false, alreadySafe: true };
  }

  const bak = await backupPathFor(filePath);
  await copyFile(filePath, bak);
  await atomicWriteJson(filePath, result.workflow);
  process.stdout.write(`APPLIED ${path.basename(filePath)} backup=${path.basename(bak)}\n`);
  printStatus("AFTER", filePath, result.report);
  return { filePath, mode, inspection: result.report, changed: true, backup: bak };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if ((!args.check && !args.apply) || (args.check && args.apply)) usage(1);
  if (!args.i2v && !args.fl2v) usage(1);

  const jobs = [];
  if (args.i2v) jobs.push({ filePath: path.resolve(args.i2v), mode: "I2VA", apply: args.apply });
  if (args.fl2v) jobs.push({ filePath: path.resolve(args.fl2v), mode: "FL2VA", apply: args.apply });

  let failed = false;
  for (const job of jobs) {
    try {
      if (!(await exists(job.filePath))) {
        throw new Error(`File not found: ${job.filePath}`);
      }
      await processOne(job);
    } catch (error) {
      failed = true;
      process.stderr.write(`ERROR: ${error.message}\n`);
      if (error.code === "UNEXPECTED_TOPOLOGY") process.exitCode = 2;
      else process.exitCode = 1;
    }
  }
  if (failed && !process.exitCode) process.exitCode = 1;
}

const isDirect = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirect) {
  await main();
}

export { parseArgs, processOne, loadWorkflow, atomicWriteJson, backupPathFor };
