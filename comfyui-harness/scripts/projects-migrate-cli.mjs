#!/usr/bin/env node
/**
 * Project-store migration CLI — PLAN (zero writes) or APPLY (explicit --activate only).
 *
 * Usage:
 *   node scripts/projects-migrate-cli.mjs --source <dir> --target <dir> --plan
 *   node scripts/projects-migrate-cli.mjs --source <dir> --target <dir> --apply --activate
 */

import {
  applyProjectMigration,
  planProjectMigration
} from "../lib/project-migration.mjs";

function parseArgs(argv) {
  const out = {
    source: "",
    target: "",
    plan: false,
    apply: false,
    activate: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source") out.source = String(argv[++i] || "").trim();
    else if (arg === "--target") out.target = String(argv[++i] || "").trim();
    else if (arg === "--plan") out.plan = true;
    else if (arg === "--apply") out.apply = true;
    else if (arg === "--activate") out.activate = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

function usage() {
  return [
    "Project store migration (copy-only, never overwrite source)",
    "",
    "  node scripts/projects-migrate-cli.mjs --source <dir> --target <dir> --plan",
    "  node scripts/projects-migrate-cli.mjs --source <dir> --target <dir> --apply --activate"
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.plan && !args.apply)) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }
  if (!args.source || !args.target) {
    console.error("Both --source and --target are required.");
    process.exit(1);
  }
  if (args.plan && args.apply) {
    console.error("Use either --plan or --apply, not both.");
    process.exit(1);
  }

  if (args.plan) {
    const plan = await planProjectMigration({ sourceDir: args.source, targetDir: args.target });
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const plan = await planProjectMigration({ sourceDir: args.source, targetDir: args.target });
  const result = await applyProjectMigration({
    sourceDir: args.source,
    targetDir: args.target,
    plan,
    activate: args.activate
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error?.message || String(error));
  if (error?.conflicts) console.error(JSON.stringify({ conflicts: error.conflicts }, null, 2));
  process.exit(1);
});
