# ComfyUI terminal and rendering progress monitor

Status: backlog / implementation target

## Goal

Restore the operational visibility previously provided by a visible ComfyUI terminal while retaining the API-driven MiniMax H3 harness.

The feature has two independent parts:

1. a real graphical rendering progress monitor in the harness;
2. an optional visible ComfyUI terminal window on future safe starts.

## Runtime progress source

The graphical progress bar must use only ComfyUI's real live execution events already bridged by the harness (`progress` and `progress_state`). Do not infer or fabricate percentages. When ComfyUI reports `value` and `max`, display `value/max` and the derived percent. Also display the active node, prompt/job id, and elapsed time when available. If no numeric progress is available for the current node, show an indeterminate state rather than a fake percentage.

The current harness already receives these events; implementation should reuse the existing event path instead of opening a competing ComfyUI WebSocket with the same client id.

## Terminal-style monitor

Add an expandable read-only terminal panel to the harness. It should show useful execution lifecycle messages and, where supported by the installed ComfyUI version, expose ComfyUI terminal logs via the internal logs interface. Treat internal ComfyUI log routes as optional/unstable capability: detect availability and degrade cleanly.

Do not create a second ComfyUI WebSocket using the active job's client id because ComfyUI replaces the registered socket when a client id is reused. Reuse the existing harness event bridge or a read-only HTTP log path.

## Visible native console

When ComfyUI is not already running, the standard local launcher may offer/start it in a visible Windows terminal using the established portable launcher. If ComfyUI is already running, never restart or interrupt it merely to obtain a console window. The exact console attached to a process that was started hidden may not be recoverable reliably in-place; in that case use the harness monitor until the next safe restart.

## Safety

- read-only monitoring must never submit, cancel, reorder, or mutate jobs;
- do not restart ComfyUI during an active/pending job;
- do not restart the harness during an active job merely to activate this feature unless the user explicitly approves;
- keep WebSocket/SSE live progress as primary and history polling as completion/failure fallback.
