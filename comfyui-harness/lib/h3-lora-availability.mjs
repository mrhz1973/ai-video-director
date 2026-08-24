import { H3_LORA_OFF, listH3LoraProfiles } from "./h3-lora-catalog.mjs";

export async function fetchComfyLoraNames(comfyUrl, { fetchFn = fetch } = {}) {
  const response = await fetchFn(`${comfyUrl}/object_info/${encodeURIComponent("LoraLoaderModelOnly")}`);
  if (!response.ok) {
    throw new Error(`ComfyUI object_info failed: ${response.status}`);
  }
  const data = await response.json();
  const loraEnum = data?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0];
  return Array.isArray(loraEnum) ? loraEnum : [];
}

export function buildH3LoraAvailability(availableComfyPaths = []) {
  const available = new Set(availableComfyPaths);
  const profiles = {};
  for (const profile of listH3LoraProfiles()) {
    if (profile.id === H3_LORA_OFF) {
      profiles[profile.id] = { available: true };
      continue;
    }
    profiles[profile.id] = {
      available: available.has(profile.comfyPath),
      comfyPath: profile.comfyPath
    };
  }
  return profiles;
}
