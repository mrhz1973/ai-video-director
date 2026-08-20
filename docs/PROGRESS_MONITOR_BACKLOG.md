# Backlog — ComfyUI terminal/progress monitor

Goal: restore visibility into ComfyUI execution while keeping the API-driven harness workflow.

Planned work:

- Add a read-only graphical progress bar to the harness driven by the real ComfyUI `progress` / `progress_state` events already bridged through the harness.
- Show current node id/name, `value/max`, percentage, elapsed time, and prompt/job id while a run is active.
- Add a compact terminal-style event log in the harness for execution lifecycle/progress messages without altering the submitted workflow.
- Preserve WebSocket/SSE as the primary live source and history polling as fallback.
- Do not synthesize progress when ComfyUI does not report it; display indeterminate state instead.
- Add a safe local launcher option that starts ComfyUI in a visible terminal window when the service is not already running.
- Never restart or interrupt an active ComfyUI job merely to obtain a console window.
- Keep the visible console and the harness monitor optional/read-only; neither may submit, cancel, reorder, or mutate jobs.

The exact ComfyUI terminal window from a process that was launched without/hidden from a console may not be recoverable in-place. In that case, use the harness live monitor immediately and restore the real visible console on the next safe ComfyUI start.
