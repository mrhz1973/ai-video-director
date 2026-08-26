#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  planDeploymentPreflight,
  runRuntimeDeployment
} from "../../lib/windows-runtime-deploy.mjs";
import { resolveConfigPath } from "../../lib/windows-launcher.mjs";
import { createDefaultGitRunner } from "../../lib/stable-runtime.mjs";

const execFileAsync = promisify(execFile);

function parseArgs(argv = []) {
  const args = {
    command: "",
    runtimeRoot: "",
    releaseSha: "",
    expectedVersion: "",
    config: "",
    planOnly: false,
    noBrowser: true
  };
  const rest = [...argv];
  args.command = rest.shift() || "";
  while (rest.length) {
    const token = rest.shift();
    if (token === "--runtime-root") args.runtimeRoot = rest.shift() || "";
    else if (token === "--release-sha") args.releaseSha = rest.shift() || "";
    else if (token === "--expected-version") args.expectedVersion = rest.shift() || "";
    else if (token === "--config") args.config = rest.shift() || "";
    else if (token === "--plan-only") args.planOnly = true;
    else if (token === "--open-browser") args.noBrowser = false;
  }
  return args;
}

async function stopProcessWindows(pid) {
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Stop-Process -Id ${Number(pid)} -Force -ErrorAction Stop`
  ], { windowsHide: true });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const configPath = resolveConfigPath(args.config);
  const gitRunner = createDefaultGitRunner(execFileAsync);

  if (args.command === "plan") {
    const plan = await planDeploymentPreflight({
      runtimeRoot: args.runtimeRoot,
      releaseSha: args.releaseSha,
      expectedVersion: args.expectedVersion,
      configPath,
      gitRunner
    });
    console.log(JSON.stringify(plan, null, 2));
    process.exitCode = plan.ok ? 0 : 1;
    return;
  }

  if (args.command === "deploy") {
    if (args.planOnly) {
      const plan = await planDeploymentPreflight({
        runtimeRoot: args.runtimeRoot,
        releaseSha: args.releaseSha,
        expectedVersion: args.expectedVersion,
        configPath,
        gitRunner
      });
      console.log(JSON.stringify({ ok: plan.ok, planOnly: true, plan }, null, 2));
      process.exitCode = plan.ok ? 0 : 1;
      return;
    }
    const result = await runRuntimeDeployment({
      runtimeRoot: args.runtimeRoot,
      releaseSha: args.releaseSha,
      expectedVersion: args.expectedVersion,
      configPath,
      gitRunner,
      execFileFn: execFileAsync,
      stopProcessFn: stopProcessWindows,
      deps: {
        execFileFn: execFileAsync
      }
    });
    console.log(JSON.stringify({ ok: result.ok, ...result }, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  console.error("Usage: deploy-runtime-cli.mjs <plan|deploy> --runtime-root PATH --release-sha SHA [--expected-version X] [--config PATH] [--plan-only]");
  process.exitCode = 2;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch(error => {
    console.error(`[ERROR] ${error.message}`);
    process.exitCode = 1;
  });
}
