/**
 * Display-only policy for OUTPUT post-completion archive + cloud auto-copy.
 * Does not submit /prompt or change execution authority.
 */

/**
 * When local auto-archive is enabled for the prompt plan, cloud auto-copy must
 * not race independently — POST /api/archive-output already runs
 * archiveCompletedOutput → tryAutoCloudMirror.
 *
 * When archive is disabled, cloud may auto-copy from authoritative Comfy output.
 */
export function resolvePostCompletionCopyPlan(plan = null) {
  const archiveEnabled = Boolean(plan && plan.enabled === true);
  return {
    archiveEnabled,
    runArchive: archiveEnabled,
    /** Independent browser cloud chain — only when archive is off. */
    runIndependentCloudAuto: !archiveEnabled,
    /** Cloud is expected via /api/archive-output after a successful archive. */
    cloudViaArchiveEndpoint: archiveEnabled
  };
}

/**
 * After an archive attempt that did not succeed, cloud may still fall back to
 * authoritative Comfy output when cloud auto is enabled server-side.
 */
export function shouldCloudFallbackAfterArchiveFailure(archiveResult = null) {
  if (!archiveResult || archiveResult.archiveRan !== true) return false;
  return archiveResult.archiveOk !== true;
}
