import { comfyAspectRatio, selectMegapixels, validateMegapixels } from "../public/resolution.mjs";

export { selectMegapixels, validateMegapixels };

export function cloneAndBind(workflow, bindings, values) {
  const result = structuredClone(workflow);
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    const binding = bindings[key];
    if (!binding) continue;
    const node = result[String(binding.node)];
    if (!node?.inputs || !(binding.input in node.inputs)) {
      throw new Error(`Binding ${key} points to missing ${binding.node}.${binding.input}`);
    }
    node.inputs[binding.input] = value;
  }
  return result;
}

// Dormant generic helper: the active H3 presets bind neither width nor height,
// because node 115 feeds those inputs directly. Not used by the generation path.
export function dimensions(aspect, quality) {
  const table = {
    Preview: { "16:9": [1024, 576], "9:16": [576, 1024], "1:1": [768, 768], "4:3": [896, 672], "3:4": [672, 896], "21:9": [1152, 480] },
    Final: { "16:9": [1376, 768], "9:16": [768, 1376], "1:1": [1024, 1024], "4:3": [1184, 896], "3:4": [896, 1184], "21:9": [1568, 672] }
  };
  return (table[quality] || table.Preview)[aspect] || table.Preview["16:9"];
}

export function resolutionSettings(aspect, megapixels) {
  return {
    aspectRatio: comfyAspectRatio(aspect),
    megapixels: validateMegapixels(megapixels)
  };
}

export function collectOutputs(history, baseUrl) {
  const outputs = [];
  for (const node of Object.values(history?.outputs || {})) {
    for (const key of ["images", "animated", "videos", "audio"]) {
      for (const item of node?.[key] || []) {
        if (!item.filename) continue;
        const query = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder || "", type: item.type || "output" });
        outputs.push({
          kind: key,
          filename: item.filename,
          subfolder: item.subfolder || "",
          url: `${baseUrl}/api/view?${query}`
        });
      }
    }
  }
  return outputs;
}
