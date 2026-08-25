import test from "node:test";
import assert from "node:assert/strict";
import {
  resolvePostCompletionCopyPlan,
  shouldCloudFallbackAfterArchiveFailure
} from "../public/output-copy-orchestration.mjs";

test("archive enabled: no independent cloud auto; cloud via archive endpoint", () => {
  const plan = resolvePostCompletionCopyPlan({ enabled: true });
  assert.equal(plan.archiveEnabled, true);
  assert.equal(plan.runArchive, true);
  assert.equal(plan.runIndependentCloudAuto, false);
  assert.equal(plan.cloudViaArchiveEndpoint, true);
});

test("archive disabled: independent cloud auto allowed", () => {
  const plan = resolvePostCompletionCopyPlan({ enabled: false });
  assert.equal(plan.archiveEnabled, false);
  assert.equal(plan.runArchive, false);
  assert.equal(plan.runIndependentCloudAuto, true);
  assert.equal(plan.cloudViaArchiveEndpoint, false);
});

test("missing plan treated as archive off", () => {
  assert.equal(resolvePostCompletionCopyPlan(null).runIndependentCloudAuto, true);
  assert.equal(resolvePostCompletionCopyPlan({}).runArchive, false);
});

test("cloud fallback only after archive ran and failed", () => {
  assert.equal(shouldCloudFallbackAfterArchiveFailure(null), false);
  assert.equal(shouldCloudFallbackAfterArchiveFailure({ archiveRan: false }), false);
  assert.equal(
    shouldCloudFallbackAfterArchiveFailure({ archiveRan: true, archiveOk: true }),
    false
  );
  assert.equal(
    shouldCloudFallbackAfterArchiveFailure({
      archiveRan: true,
      archiveOk: false,
      reason: "archive-unconfigured"
    }),
    true
  );
  assert.equal(
    shouldCloudFallbackAfterArchiveFailure({
      archiveRan: true,
      archiveOk: false,
      reason: "archive-failed"
    }),
    true
  );
});
