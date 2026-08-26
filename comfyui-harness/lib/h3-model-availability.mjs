/**
 * Issue #95 — read-only ComfyUI UNET discovery via object_info (same ownership as LoRA).
 */
import { H3_UNET_LOADER_CLASS } from "./h3-model-registry.mjs";

/**
 * @param {string} comfyUrl
 * @param {{ fetchFn?: typeof fetch, loaderClass?: string }} [opts]
 */
export async function fetchComfyUnetNames(comfyUrl, { fetchFn = fetch, loaderClass = H3_UNET_LOADER_CLASS } = {}) {
  const response = await fetchFn(`${comfyUrl}/object_info/${encodeURIComponent(loaderClass)}`);
  if (!response.ok) {
    throw new Error(`ComfyUI object_info failed: ${response.status}`);
  }
  const data = await response.json();
  const unetEnum = data?.[loaderClass]?.input?.required?.unet_name?.[0];
  return Array.isArray(unetEnum) ? unetEnum.map(String) : [];
}

/**
 * @param {string} comfyUrl
 * @param {{ fetchFn?: typeof fetch, logger?: { error?: Function } }} [opts]
 * @returns {Promise<{ names: string[], discoveryOk: boolean, loaderClass: string, error?: string }>}
 */
export async function readComfyUnetAvailability(comfyUrl, { fetchFn = fetch, logger = null } = {}) {
  try {
    const names = await fetchComfyUnetNames(comfyUrl, { fetchFn });
    return { names, discoveryOk: true, loaderClass: H3_UNET_LOADER_CLASS };
  } catch (error) {
    logger?.error?.("model_availability_failed", { reason: error.message });
    return {
      names: [],
      discoveryOk: false,
      loaderClass: H3_UNET_LOADER_CLASS,
      error: error.message
    };
  }
}
