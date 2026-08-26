/**
 * Issue #97 — reusable Windows stable-runtime deployment planning/execution.
 */
import path from "node:path";
import {
  RUNTIME_BLOCK,
  assertHarnessRootMatchesRuntimeAuthority,
  assertQueueIdle,
  createDefaultGitRunner,
  inspectGitRuntimeState,
  planIdempotentDeployment,
  planInstallerShortcut,
  normalizeRuntimeRoot,
  readPackageVersion,
  readPackageVersionAtGitRef,
  resolveRuntimeHarnessRoot,
  validateDesktopShortcutTarget,
  validateRuntimeFilesystem,
  validateStableRuntimeCheckout,
  verifyReleaseObjectExists
} from "./stable-runtime.mjs";
import {
  DEFAULT_CONFIG,
  SERVICE,
  decideServiceAction,
  normalizeConfig,
  probeComfyHealth,
  probeDirectorHealth,
  readLauncherConfigFile,
  serviceBaseUrl,
  validateConfig
} from "./windows-launcher.mjs";
import { inspectPort } from "./windows-port-inspect.mjs";
import { runStart } from "../scripts/windows/launcher-cli.mjs";

export { RUNTIME_BLOCK };

export async function loadNormalizedLauncherConfig(configPath, { readConfigFn = readLauncherConfigFile } = {}) {
  const raw = await readConfigFn(configPath);
  return normalizeConfig(raw);
}

export async function planDeploymentPreflight({
  runtimeRoot = "",
  releaseSha = "",
  expectedVersion = "",
  configPath = "",
  config = null,
  gitRunner,
  inspectPortFn = inspectPort,
  fetchFn = fetch,
  readShortcutFn = null,
  existsFn
} = {}) {
  const blockers = [];
  const notes = [];

  const fs = validateRuntimeFilesystem({ runtimeRoot, existsFn });
  if (!fs.ok) blockers.push(...fs.errors);

  let git = null;
  if (fs.ok && gitRunner) {
    try {
      git = await inspectGitRuntimeState({ runtimeRoot: fs.runtimeRoot, gitRunner });
      if (!git.clean) blockers.push("runtime working tree is dirty");
      if (!git.detached) blockers.push(`runtime checkout attached to branch ${git.branch}`);
    } catch (error) {
      blockers.push(error.message);
    }
  }

  let packageVersion = null;
  if (fs.ok) {
    try {
      packageVersion = await readPackageVersion(fs.harnessRoot);
    } catch (error) {
      blockers.push(error.message);
    }
  }

  let resolvedConfig = config;
  if (!resolvedConfig && configPath) {
    try {
      resolvedConfig = await loadNormalizedLauncherConfig(configPath);
    } catch (error) {
      blockers.push(error.message);
    }
  }
  if (resolvedConfig) {
    const configErrors = validateConfig(resolvedConfig);
    blockers.push(...configErrors);
    if (resolvedConfig.runtimeRoot) {
      try {
        assertHarnessRootMatchesRuntimeAuthority({
          runtimeRoot: resolvedConfig.runtimeRoot,
          harnessRoot: fs.harnessRoot
        });
      } catch (error) {
        blockers.push(error.message);
      }
    } else {
      blockers.push("launcher config missing runtimeRoot");
    }
    if (readShortcutFn) {
      const shortcut = await readShortcutFn();
      const desktop = validateDesktopShortcutTarget({
        runtimeRoot: resolvedConfig.runtimeRoot || runtimeRoot,
        argumentsText: shortcut.argumentsText,
        workingDirectory: shortcut.workingDirectory
      });
      if (!desktop.ok) blockers.push(...desktop.errors);
    }
  }

  let releaseVersion = null;
  if (gitRunner && releaseSha && blockers.length === 0) {
    try {
      await verifyReleaseObjectExists({ runtimeRoot: fs.runtimeRoot, releaseSha, gitRunner });
      releaseVersion = await readPackageVersionAtGitRef({
        runtimeRoot: fs.runtimeRoot,
        gitRef: releaseSha,
        gitRunner
      });
      if (expectedVersion && releaseVersion !== expectedVersion) {
        blockers.push(`release SHA ${releaseSha} advertises version ${releaseVersion}, expected ${expectedVersion}`);
      }
    } catch (error) {
      blockers.push(error.message);
    }
  }

  const cfg = resolvedConfig || DEFAULT_CONFIG;
  const comfyUrl = serviceBaseUrl(cfg, SERVICE.COMFY);
  const directorUrl = serviceBaseUrl(cfg, SERVICE.DIRECTOR);

  let comfyPortState = null;
  let directorPortState = null;
  let comfyHealth = null;
  let directorHealth = null;
  let queue = null;

  try {
    comfyPortState = await inspectPortFn(cfg.comfyPort, { inspectPortFn });
    directorPortState = await inspectPortFn(cfg.directorPort, { inspectPortFn });
    comfyHealth = await probeComfyHealth(comfyUrl, { fetchFn });
    directorHealth = await probeDirectorHealth(directorUrl, releaseVersion || packageVersion || "", { fetchFn });
    const queueResp = await fetchFn(`${comfyUrl.replace(/\/$/, "")}/queue`);
    if (queueResp.ok) {
      queue = await queueResp.json();
      try {
        assertQueueIdle({
          running: queue.queue_running?.length || 0,
          pending: queue.queue_pending?.length || 0
        });
      } catch (error) {
        blockers.push(error.message);
      }
    } else {
      blockers.push(`ComfyUI queue probe failed (${queueResp.status})`);
    }
  } catch (error) {
    blockers.push(error.message);
  }

  const directorDecision = directorPortState && directorHealth
    ? decideServiceAction({
      portState: directorPortState,
      healthy: directorHealth.healthy,
      service: SERVICE.DIRECTOR
    })
    : null;

  const idempotent = planIdempotentDeployment({
    runtimeHeadSha: git?.headSha || "",
    releaseSha,
    packageVersion: packageVersion || "",
    expectedVersion: releaseVersion || expectedVersion || "",
    directorHealthy: Boolean(directorHealth?.healthy),
    directorVersion: directorHealth?.version || ""
  });

  return {
    ok: blockers.length === 0,
    blockers,
    notes,
    runtimeRoot: fs.runtimeRoot,
    harnessRoot: fs.harnessRoot,
    git,
    packageVersion,
    releaseVersion: releaseVersion || expectedVersion || null,
    config: resolvedConfig,
    comfy: {
      pid: comfyPortState?.processInfo?.pid ?? null,
      healthy: Boolean(comfyHealth?.healthy),
      port: cfg.comfyPort
    },
    director: {
      pid: directorPortState?.processInfo?.pid ?? null,
      healthy: Boolean(directorHealth?.healthy),
      version: directorHealth?.version || null,
      port: cfg.directorPort,
      decision: directorDecision?.action || null
    },
    queue: queue
      ? {
        running: queue.queue_running?.length || 0,
        pending: queue.queue_pending?.length || 0
      }
      : null,
    idempotent
  };
}

export async function advanceRuntimeCheckout({
  runtimeRoot = "",
  releaseSha = "",
  gitRunner
} = {}) {
  await gitRunner(["fetch", "origin"], normalizeRuntimeRoot(runtimeRoot));
  await verifyReleaseObjectExists({ runtimeRoot, releaseSha, gitRunner });
  await gitRunner(["checkout", "--detach", releaseSha], normalizeRuntimeRoot(runtimeRoot));
  const headSha = await gitRunner(["rev-parse", "HEAD"], normalizeRuntimeRoot(runtimeRoot));
  if (headSha !== releaseSha) {
    const error = new Error(`Runtime HEAD ${headSha} does not match requested release SHA ${releaseSha}`);
    error.code = RUNTIME_BLOCK.SHA_MISMATCH;
    throw error;
  }
  const porcelain = await gitRunner(["status", "--porcelain"], normalizeRuntimeRoot(runtimeRoot));
  if (porcelain.length > 0) {
    const error = new Error("Runtime working tree is dirty after checkout");
    error.code = RUNTIME_BLOCK.DIRTY;
    throw error;
  }
  const harnessRoot = resolveRuntimeHarnessRoot(runtimeRoot);
  const packageVersion = await readPackageVersion(harnessRoot);
  return { headSha, packageVersion, harnessRoot };
}

export async function verifyPostDeployment({
  runtimeRoot = "",
  releaseSha = "",
  expectedVersion = "",
  gitRunner,
  fetchFn = fetch,
  inspectPortFn = inspectPort,
  config = DEFAULT_CONFIG
} = {}) {
  const git = await inspectGitRuntimeState({ runtimeRoot, gitRunner });
  const harnessRoot = resolveRuntimeHarnessRoot(runtimeRoot);
  const packageVersion = await readPackageVersion(harnessRoot);
  const directorUrl = serviceBaseUrl(config, SERVICE.DIRECTOR);
  const directorHealth = await probeDirectorHealth(directorUrl, expectedVersion, { fetchFn });
  const comfyPortState = await inspectPortFn(config.comfyPort, { inspectPortFn });
  const directorPortState = await inspectPortFn(config.directorPort, { inspectPortFn });
  const errors = [];
  if (git.headSha !== releaseSha) errors.push(`runtime HEAD ${git.headSha} != ${releaseSha}`);
  if (!git.clean) errors.push("runtime working tree dirty after deployment");
  if (!git.detached) errors.push("runtime checkout not detached after deployment");
  if (packageVersion !== expectedVersion) errors.push(`package version ${packageVersion} != ${expectedVersion}`);
  if (!directorHealth.healthy) errors.push("Director health verification failed");
  return {
    ok: errors.length === 0,
    errors,
    git,
    packageVersion,
    director: {
      healthy: directorHealth.healthy,
      version: directorHealth.version,
      pid: directorPortState?.processInfo?.pid ?? null
    },
    comfy: {
      pid: comfyPortState?.processInfo?.pid ?? null
    }
  };
}

export async function runRuntimeDeployment({
  runtimeRoot = "",
  releaseSha = "",
  expectedVersion = "",
  configPath = "",
  gitRunner = null,
  execFileFn = null,
  stopProcessFn = null,
  inspectPortFn = inspectPort,
  fetchFn = fetch,
  readShortcutFn = null,
  noBrowser = true,
  deps = {}
} = {}) {
  const git = gitRunner || createDefaultGitRunner(deps.execFileFn || execFileFn);
  const preflight = await planDeploymentPreflight({
    runtimeRoot,
    releaseSha,
    expectedVersion,
    configPath,
    gitRunner: git,
    inspectPortFn,
    fetchFn,
    readShortcutFn,
    existsFn: deps.existsFn
  });
  if (!preflight.ok) {
    const error = new Error(preflight.blockers.join("; "));
    error.code = "DEPLOY_PREFLIGHT_BLOCKED";
    error.preflight = preflight;
    throw error;
  }

  const harnessRoot = preflight.harnessRoot;
  const releaseVersion = preflight.releaseVersion || expectedVersion;
  const config = preflight.config;
  const directorPidBefore = preflight.director.pid;
  const comfyPidBefore = preflight.comfy.pid;

  let checkoutPerformed = false;
  let packageVersion = preflight.packageVersion;

  if (preflight.idempotent.checkout) {
    const advanced = await advanceRuntimeCheckout({ runtimeRoot, releaseSha, gitRunner: git });
    checkoutPerformed = true;
    packageVersion = advanced.packageVersion;
    if (packageVersion !== releaseVersion) {
      const error = new Error(`Package version ${packageVersion} != expected ${releaseVersion} after checkout`);
      error.code = RUNTIME_BLOCK.VERSION_MISMATCH;
      throw error;
    }
  } else if (packageVersion !== releaseVersion) {
    const error = new Error(`Runtime package version ${packageVersion} != expected ${releaseVersion}`);
    error.code = RUNTIME_BLOCK.VERSION_MISMATCH;
    throw error;
  }

  let directorRestarted = false;
  let startResult = null;

  if (preflight.idempotent.restartDirector) {
    if (directorPidBefore && stopProcessFn) {
      await stopProcessFn(directorPidBefore);
      if (deps.sleepFn) await deps.sleepFn(500);
      else await new Promise(resolve => setTimeout(resolve, 500));
    } else if (directorPidBefore && !stopProcessFn) {
      const error = new Error("Director restart required but stopProcessFn was not provided");
      throw error;
    }
    startResult = await runStart({
      harnessRoot,
      configPath,
      configOverride: noBrowser ? { openBrowser: false } : {},
      deps: {
        fetchFn,
        inspectPortFn,
        openBrowserFn: () => {},
        spawnFn: deps.spawnFn,
        sleepFn: deps.sleepFn,
        log: deps.log || (() => {})
      }
    });
    directorRestarted = Boolean(startResult?.spawns?.director) || preflight.idempotent.restartDirector;
  } else {
    startResult = {
      spawns: { comfy: 0, director: 0 },
      directorVersion: releaseVersion,
      director: { action: "reuse" },
      comfy: { action: "reuse" }
    };
  }

  const post = await verifyPostDeployment({
    runtimeRoot,
    releaseSha,
    expectedVersion: releaseVersion,
    gitRunner: git,
    fetchFn,
    inspectPortFn,
    config
  });

  return {
    ok: post.ok,
    preflight,
    post,
    checkoutPerformed,
    directorRestarted,
    directorPidBefore,
    directorPidAfter: post.director.pid,
    comfyPidBefore,
    comfyPidAfter: post.comfy.pid,
    releaseSha,
    releaseVersion,
    startResult,
    action: preflight.idempotent.action
  };
}

export { planInstallerShortcut, validateStableRuntimeCheckout, assertHarnessRootMatchesRuntimeAuthority };
