# ComfyUI progress monitor — implementation notes

Verified behavior:

- ComfyUI emits live `progress` messages with `value`, `max`, `prompt_id`, and `node` during long-running node execution.
- The current harness already bridges ComfyUI WebSocket messages through `/api/events` and the browser already parses `progress` and `progress_state` events.
- The existing UI currently renders progress as text such as `In esecuzione · value/max · percent%`; therefore a graphical progress bar can be added without changing the H3 workflow or generation settings.

Implementation direction:

1. Add a graphical progress bar bound only to real reported progress.
2. Show current node, numeric progress, percentage, elapsed time, and prompt id.
3. Add an expandable terminal-style live event stream for execution lifecycle messages.
4. Keep recovery/read-only history polling as fallback; never fake a percentage when live progress is unavailable.
5. Add an optional visible-console ComfyUI launcher for future starts. If ComfyUI is already running, do not restart it just to obtain a console.
6. Activation/restart of the harness must wait for an empty ComfyUI queue unless the user explicitly approves otherwise.
