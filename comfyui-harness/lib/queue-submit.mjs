/**
 * Shared ComfyUI queue submission helper (Issue #47).
 */

import { cloneAndBind, resolutionSettings, selectMegapixels } from "./workflow.mjs";
import {
  inspectH3SafeFit,
  publicSafeFitSummary,
  safeFitBlocksGenerate,
  describeSafeFitBlocker
} from "./h3-safe-fit.mjs";

export async function submitWorkflowToComfy({
  input,
  preset,
  workflow,
  comfyUrl,
  fetchFn = fetch
}) {
  const fit = inspectH3SafeFit(workflow, { mode: preset.mode });
  if (safeFitBlocksGenerate(fit.status)) {
    const gate = describeSafeFitBlocker(fit.status);
    const error = new Error(gate.reason);
    error.code = "safe_fit_blocked";
    error.safeFit = publicSafeFitSummary(fit);
    error.status = 409;
    throw error;
  }
  const requested = selectMegapixels(input);
  const { aspectRatio, megapixels } = resolutionSettings(input.aspect, requested);
  const values = {
    prompt: input.prompt,
    model: input.model,
    steps: Number(input.steps),
    duration: Number(input.duration),
    seed: Number(input.seed),
    aspectRatio,
    megapixels,
    firstImage: input.firstImage,
    lastImage: input.lastImage,
    ...(input.files || {})
  };
  const bound = cloneAndBind(workflow, preset.bindings || {}, values);
  const upstream = await fetchFn(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: bound, client_id: input.clientId })
  });
  const data = await upstream.json();
  return { ok: upstream.ok, status: upstream.status, data };
}
