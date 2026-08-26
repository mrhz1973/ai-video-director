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
  ACTION,
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
import { runDeployDirector } from "../scripts/windows/launcher-cli.mjs";

export { RUNTIME_BLOCK };

export async function loadNormalizedLauncherConfig(configPath, { readConfigFn = readLauncherConfigFile } = {}) {
  const raw = await readConfigFn(configPath);
  return normalizeConfig(raw);
}

export async function fetchAndVerifyReleaseAuthority({
  runtimeRoot = "",
  releaseSha = "",
  expectedVersion = "",
  gitRunner,
  skipFetch = false
} = {}) {
  if (!gitRunner) {
    throw new Error("gitRunner is required for release authority verification");
  }
  if (!releaseSha) {
    throw new Error("releaseSha is required for release authority verification");
  }
  const root = normalizeRuntimeRoot(runtimeRoot);
  if (!skipFetch) {
    await gitRunner(["fetch", "origin"], root);
  }
  await verifyReleaseObjectExists({ runtimeRoot: root, releaseSha, gitRunner });
  const releaseVersion = await readPackageVersionAtGitRef({
    runtimeRoot: root,
    gitRef: releaseSha,
    gitRunner
  });
  if (expectedVersion && releaseVersion !== expectedVersion) {
    const error = new Error(
      `release SHA ${releaseSha} advertises version ${releaseVersion}, expected ${expectedVersion}`
    );
    error.code = RUNTIME_BLOCK.VERSION_MISMATCH;
    throw error;
  }
  return { releaseVersion };
}

export async function planLocalDeploymentPreflight({
  runtimeRoot = "",
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
      try {
        const shortcut = await readShortcutFn();
        const desktop = validateDesktopShortcutTarget({
          runtimeRoot: resolvedConfig.runtimeRoot || runtimeRoot,
          argumentsText: shortcut.argumentsText,
          workingDirectory: shortcut.workingDirectory
        });
        if (!desktop.ok) blockers.push(...desktop.errors);
      } catch (error) {
        blockers.push(error.message);
      }
    }
  }

  const cfg = resolvedConfig || DEFAULT_CONFIG;
  const comfyUrl = serviceBaseUrl(cfg, SERVICE.COMFY);
  const directorUrl = serviceBaseUrl(cfg, SERVICE.DIRECTOR);

  let comfyPortState = null;
  let directorPortState = null;
  let comfyHealth = null;
  let directorHealth = null;
  let comfyDecision = null;
  let directorDecision = null;
  let queue = null;

  try {
    comfyPortState = await inspectPortFn(cfg.comfyPort, { inspectPortFn });
    directorPortState = await inspectPortFn(cfg.directorPort, { inspectPortFn });
    comfyHealth = await probeComfyHealth(comfyUrl, { fetchFn });
    directorHealth = await probeDirectorHealth(directorUrl, "", { fetchFn });
    comfyDecision = decideServiceAction({
      portState: comfyPortState,
      healthy: Boolean(comfyHealth?.healthy),
      service: SERVICE.COMFY
    });
    directorDecision = decideServiceAction({
      portState: directorPortState,
      healthy: Boolean(directorHealth?.healthy),
      service: SERVICE.DIRECTOR
    });

    if (comfyPortState && comfyPortState.inspectionOk === false) {
      blockers.push(`ComfyUI port inspection failed on ${cfg.comfyPort}`);
    }
    if (directorPortState && directorPortState.inspectionOk === false) {
      blockers.push(`Director port inspection failed on ${cfg.directorPort}`);
    }
    if (!comfyHealth?.healthy) {
      blockers.push("ComfyUI must be healthy before deployment");
    }
    if (comfyDecision.action === ACTION.FAIL) {
      blockers.push(comfyDecision.message);
    }
    if (comfyDecision.action === ACTION.START) {
      blockers.push("deployment cannot start ComfyUI");
    }
    if (directorDecision.action === ACTION.FAIL) {
      blockers.push(directorDecision.message);
    }

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

  return {
    ok: blockers.length === 0,
    blockers,
    notes,
    runtimeRoot: fs.runtimeRoot,
    harnessRoot: fs.harnessRoot,
    git,
    packageVersion,
    config: resolvedConfig,
    comfy: {
      pid: comfyPortState?.processInfo?.pid ?? null,
      healthy: Boolean(comfyHealth?.healthy),
      port: cfg.comfyPort,
      decision: comfyDecision?.action || null
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
      : null
  };
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
  existsFn,
  skipFetch = false
} = {}) {
  const local = await planLocalDeploymentPreflight({
    runtimeRoot,
    expectedVersion,
    configPath,
    config,
    gitRunner,
    inspectPortFn,
    fetchFn,
    readShortcutFn,
    existsFn
  });

  const blockers = [...local.blockers];
  let releaseVersion = null;

  if (gitRunner && releaseSha && blockers.length === 0) {
    try {
      const release = await fetchAndVerifyReleaseAuthority({
        runtimeRoot: local.runtimeRoot,
        releaseSha,
        expectedVersion,
        gitRunner,
        skipFetch
      });
      releaseVersion = release.releaseVersion;
    } catch (error) {
      blockers.push(error.message);
    }
  }

  const idempotent = planIdempotentDeployment({
    runtimeHeadSha: local.git?.headSha || "",
    releaseSha,
    packageVersion: local.packageVersion || "",
    expectedVersion: releaseVersion || expectedVersion || "",
    directorHealthy: Boolean(local.director?.healthy),
    directorVersion: local.director?.version || ""
  });

  return {
    ok: blockers.length === 0,
    blockers,
    notes: local.notes,
    runtimeRoot: local.runtimeRoot,
    harnessRoot: local.harnessRoot,
    git: local.git,
    packageVersion: local.packageVersion,
    releaseVersion: releaseVersion || expectedVersion || null,
    config: local.config,
    comfy: local.comfy,
    director: local.director,
    queue: local.queue,
    idempotent
  };
}

export async function assertComfyUnchangedForDeploy({
  config = DEFAULT_CONFIG,
  comfyPidBefore = null,
  inspectPortFn = inspectPort,
  fetchFn = fetch
} = {}) {
  const comfyUrl = serviceBaseUrl(config, SERVICE.COMFY);
  const portState = await inspectPortFn(config.comfyPort, { inspectPortFn });
  const health = await probeComfyHealth(comfyUrl, { fetchFn });
  const decision = decideServiceAction({
    portState,
    healthy: Boolean(health?.healthy),
    service: SERVICE.COMFY
  });
  if (portState.inspectionOk === false) {
    const error = new Error(`ComfyUI port inspection failed on ${config.comfyPort}`);
    error.code = RUNTIME_BLOCK.PORT_AMBIGUOUS;
    throw error;
  }
  if (!health?.healthy) {
    const error = new Error("ComfyUI became unhealthy before Director restart");
    throw error;
  }
  if (decision.action !== ACTION.REUSE) {
    const error = new Error("ComfyUI must remain running; deployment cannot start or replace ComfyUI");
    throw error;
  }
  const pid = portState.processInfo?.pid ?? null;
  if (comfyPidBefore != null && pid !== comfyPidBefore) {
    const error = new Error(`ComfyUI PID changed from ${comfyPidBefore} to ${pid}`);
    throw error;
  }
  return { pid, healthy: true };
}

export async function advanceRuntimeCheckout({
  runtimeRoot = "",
  releaseSha = "",
  gitRunner,
  skipFetch = true
} = {}) {
  if (!skipFetch) {
    await gitRunner(["fetch", "origin"], normalizeRuntimeRoot(runtimeRoot));
  }
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

export async function probeDirectorConfigVersion(baseUrl, expectedVersion = "", { fetchFn = fetch } = {}) {
  const resp = await fetchFn(`${baseUrl.replace(/\/$/, "")}/api/config`);
  if (!resp.ok) {
    return { ok: false, version: null, status: resp.status };
  }
  try {
    const data = await resp.json();
    const version = typeof data?.version === "string" ? data.version : null;
    const ok = Boolean(version && (!expectedVersion || version === expectedVersion));
    return { ok, version, status: resp.status, data };
  } catch (error) {
    return { ok: false, version: null, status: resp.status, error: error.message };
  }
}

export async function probeDirectorUiVersion(baseUrl, expectedVersion = "", { fetchFn = fetch } = {}) {
  const resp = await fetchFn(`${baseUrl.replace(/\/$/, "")}/`);
  if (!resp.ok) {
    return { ok: false, version: null, status: resp.status };
  }
  const html = await resp.text();
  if (!html.includes('id="version"')) {
    return { ok: false, version: null, error: "UI version mount point missing from index.html" };
  }
  const config = await probeDirectorConfigVersion(baseUrl, expectedVersion, { fetchFn });
  if (!config.ok) {
    return { ok: false, version: config.version, error: "UI version source /api/config failed coherence check" };
  }
  return { ok: true, version: config.version, status: resp.status };
}

export async function verifyPostDeployment({
  runtimeRoot = "",
  releaseSha = "",
  expectedVersion = "",
  gitRunner,
  fetchFn = fetch,
  inspectPortFn = inspectPort,
  config = DEFAULT_CONFIG,
  comfyPidBefore = null,
  readShortcutFn = null,
  comfySpawnCount = 0
} = {}) {
  const git = await inspectGitRuntimeState({ runtimeRoot, gitRunner });
  const harnessRoot = resolveRuntimeHarnessRoot(runtimeRoot);
  const packageVersion = await readPackageVersion(harnessRoot);
  const directorUrl = serviceBaseUrl(config, SERVICE.DIRECTOR);
  const comfyUrl = serviceBaseUrl(config, SERVICE.COMFY);
  const directorHealth = await probeDirectorHealth(directorUrl, expectedVersion, { fetchFn });
  const configVersion = await probeDirectorConfigVersion(directorUrl, expectedVersion, { fetchFn });
  const uiVersion = await probeDirectorUiVersion(directorUrl, expectedVersion, { fetchFn });
  const comfyPortState = await inspectPortFn(config.comfyPort, { inspectPortFn });
  const directorPortState = await inspectPortFn(config.directorPort, { inspectPortFn });
  const comfyHealth = await probeComfyHealth(comfyUrl, { fetchFn });

  const errors = [];
  let queueRunning = null;
  let queuePending = null;
  const queueResp = await fetchFn(`${comfyUrl.replace(/\/$/, "")}/queue`);
  if (queueResp.ok) {
    const queue = await queueResp.json();
    queueRunning = queue.queue_running?.length || 0;
    queuePending = queue.queue_pending?.length || 0;
  } else {
    errors.push(`ComfyUI queue probe failed (${queueResp.status})`);
  }

  if (git.headSha !== releaseSha) errors.push(`runtime HEAD ${git.headSha} != ${releaseSha}`);
  if (!git.clean) errors.push("runtime working tree dirty after deployment");
  if (!git.detached) errors.push("runtime checkout not detached after deployment");
  if (packageVersion !== expectedVersion) errors.push(`package version ${packageVersion} != ${expectedVersion}`);
  if (!directorHealth.healthy) errors.push("Director health verification failed");
  if (!configVersion.ok) {
    errors.push(
      configVersion.version
        ? `/api/config version ${configVersion.version} != ${expectedVersion}`
        : "/api/config version probe failed"
    );
  }
  if (!uiVersion.ok) {
    errors.push(
      uiVersion.version
        ? `UI version ${uiVersion.version} != ${expectedVersion}`
        : "UI version probe failed"
    );
  }
  if (!comfyHealth?.healthy) errors.push("ComfyUI health verification failed after deployment");
  if (comfyPidBefore != null && comfyPortState?.processInfo?.pid !== comfyPidBefore) {
    errors.push(`ComfyUI PID changed from ${comfyPidBefore} to ${comfyPortState?.processInfo?.pid ?? "absent"}`);
  }
  if (Number(comfySpawnCount) !== 0) errors.push(`ComfyUI spawn count ${comfySpawnCount} != 0`);
  if (queueRunning !== null && (queueRunning !== 0 || queuePending !== 0)) {
    errors.push(`ComfyUI queue not idle (${queueRunning} running, ${queuePending} pending)`);
  }

  if (readShortcutFn) {
    try {
      const shortcut = await readShortcutFn();
      const desktop = validateDesktopShortcutTarget({
        runtimeRoot,
        argumentsText: shortcut.argumentsText,
        workingDirectory: shortcut.workingDirectory
      });
      if (!desktop.ok) errors.push(...desktop.errors);
    } catch (error) {
      errors.push(error.message);
    }
  }

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
      pid: comfyPortState?.processInfo?.pid ?? null,
      healthy: Boolean(comfyHealth?.healthy)
    },
    queue: queueRunning == null ? null : { running: queueRunning, pending: queuePending },
    versions: {
      package: packageVersion,
      health: directorHealth.version || null,
      config: configVersion.version || null,
      ui: uiVersion.version || null
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
    const advanced = await advanceRuntimeCheckout({
      runtimeRoot,
      releaseSha,
      gitRunner: git,
      skipFetch: true
    });
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
      throw new Error("Director restart required but stopProcessFn was not provided");
    }

    await assertComfyUnchangedForDeploy({
      config,
      comfyPidBefore,
      inspectPortFn,
      fetchFn
    });

    startResult = await runDeployDirector({
      harnessRoot,
      configPath,
      configOverride: noBrowser ? { openBrowser: false } : {},
      requiredComfyPid: comfyPidBefore,
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
    config,
    comfyPidBefore,
    readShortcutFn,
    comfySpawnCount: startResult?.spawns?.comfy ?? 0
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
