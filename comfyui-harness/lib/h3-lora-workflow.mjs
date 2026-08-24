import { cloneAndBind } from "./workflow.mjs";
import { applyH3LoraPatch } from "./h3-lora-transform.mjs";

/**
 * Clone, bind preset values, then optionally apply a single MODEL-path LoRA patch.
 */
export function buildBoundWorkflowWithLora({
  workflow,
  preset,
  values,
  loraSelection
}) {
  const bound = cloneAndBind(workflow, preset?.bindings || {}, values);
  return applyH3LoraPatch(bound, { preset, loraSelection });
}
