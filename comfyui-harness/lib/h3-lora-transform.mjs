import {
  H3_LORA_LOADER_CLASS,
  H3_LORA_INJECT_NODE_ID,
  H3_LORA_OFF,
  getH3LoraProfile,
  isActiveH3LoraId,
  presetSupportsH3Lora
} from "./h3-lora-catalog.mjs";

function deepCloneWorkflow(workflow) {
  return structuredClone(workflow);
}

function modelLoaderNodeId(preset = {}) {
  const node = preset?.bindings?.model?.node;
  return node != null ? String(node) : "";
}

/** Find nodes whose `model` input is wired directly to the UNet loader. */
export function findModelConsumers(workflow, loaderNodeId) {
  const loader = String(loaderNodeId);
  const consumers = [];
  for (const [nodeId, node] of Object.entries(workflow || {})) {
    const modelRef = node?.inputs?.model;
    if (
      Array.isArray(modelRef)
      && modelRef.length === 2
      && String(modelRef[0]) === loader
      && modelRef[1] === 0
    ) {
      consumers.push({ nodeId: String(nodeId), inputName: "model" });
    }
  }
  return consumers;
}

/**
 * Insert exactly one LoraLoaderModelOnly on the MODEL path.
 * Never mutates the source workflow object.
 */
export function applyH3LoraPatch(workflow, { preset = {}, loraSelection = {} } = {}) {
  const clone = deepCloneWorkflow(workflow);
  const loraId = loraSelection?.loraId || H3_LORA_OFF;

  if (!isActiveH3LoraId(loraId) || !presetSupportsH3Lora(preset)) {
    return clone;
  }

  const profile = getH3LoraProfile(loraId);
  const loaderId = modelLoaderNodeId(preset);
  if (!loaderId || !clone[loaderId]) {
    throw new Error(`Workflow model loader node missing: ${loaderId || "(unset)"}`);
  }

  const consumers = findModelConsumers(clone, loaderId);
  if (!consumers.length) {
    throw new Error(`No MODEL consumers found for loader node ${loaderId}`);
  }

  if (clone[H3_LORA_INJECT_NODE_ID]) {
    throw new Error(`LoRA inject node id collision: ${H3_LORA_INJECT_NODE_ID}`);
  }

  clone[H3_LORA_INJECT_NODE_ID] = {
    class_type: H3_LORA_LOADER_CLASS,
    inputs: {
      model: [loaderId, 0],
      lora_name: profile.comfyPath,
      strength_model: Number(loraSelection.loraStrength)
    }
  };

  for (const { nodeId, inputName } of consumers) {
    clone[nodeId].inputs[inputName] = [H3_LORA_INJECT_NODE_ID, 0];
  }

  return clone;
}

export function countLoraNodes(workflow) {
  let count = 0;
  for (const node of Object.values(workflow || {})) {
    if (node?.class_type === H3_LORA_LOADER_CLASS) count += 1;
  }
  return count;
}
