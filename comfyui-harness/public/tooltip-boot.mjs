import { initTooltipSystem } from "./tooltip.mjs";
import { applyStaticControlHelp } from "./control-help.mjs";
import { setControlHelp } from "./tooltip.mjs";
import { CONTROL_HELP } from "./control-help.mjs";

function boot() {
  initTooltipSystem();
  applyStaticControlHelp(document);
  const toggle = document.getElementById("inspectorToggle");
  if (toggle) setControlHelp(toggle, CONTROL_HELP.inspectorToggle);
  const gpuToggle = document.getElementById("gpuPowerToggle");
  if (gpuToggle) setControlHelp(gpuToggle, CONTROL_HELP.gpuPowerToggle);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
