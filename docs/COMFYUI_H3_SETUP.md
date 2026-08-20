# MiniMax H3 local harness

Current architecture/status source of truth: `docs/HARNESS_STATE.md`.

The harness in `comfyui-harness/` is a small local Node.js UI and API bridge. It exposes a prompt/chat area, reusable private projects, mode-specific attachments, workflow selection, megapixels, model, steps, duration, aspect ratio, seed, a graphical ComfyUI progress monitor with expandable event/terminal panels, and output links.

## 1. Prepare ComfyUI

Start ComfyUI separately on `http://127.0.0.1:8188`. Keep it local. Verify the H3 custom nodes, checkpoints, text encoder, VAE, and required model files are installed and that T2VA/I2VA/FL2VA graphs run successfully in ComfyUI itself before using the harness.

The current harness does **not** start, stop, restart or own the ComfyUI process. This is intentional. Any batch file, terminal or service used to launch ComfyUI is external to `server.mjs` unless a future optional service-manager feature is explicitly approved.

The public H3 repository describes H3-Base as task-specific checkpoints; the exact node names and graph wiring depend on the user's installed ComfyUI extension. For that reason the harness binds an exported graph rather than guessing node classes.

## 2. Export API workflows

For every working Base mode, use ComfyUI's **Save (API Format)** and keep the operational local API JSON in `comfyui-harness/workflows/`. These private `*.api.json` files are ignored by Git and are the complete graph source for T2VA/I2VA/FL2VA runtime topology/defaults.

Create or maintain matching tracked `.preset.json` files using `workflows/README.md`. The preset is the UI-to-node contract: node IDs and input names must match the local exported graph exactly. Keep models in the preset's `options.models` list.

### Ref2VA source/runtime distinction

For Ref2VA, the tracked runtime workflow is:

`comfyui-harness/workflows/minimax-h3-reference.workflow.json`

The private ignored `minimax-h3-ref2v.api.json` is the local source/master export and may contain local prompt/file data. It is used manually as input to the builder. Rebuild the sanitized tracked Ref2VA graph with the documented script pattern:

```text
node scripts/build-ref-workflow.mjs workflows/private-ref2v.api.json workflows/minimax-h3-reference.workflow.json
```

Do not commit private API exports, local absolute paths, credentials or private filenames.

## 3. Configure and run the harness

Copy `config.example.json` to `config.json` only when defaults need changing. The absence of `config.json` is valid: `server.mjs` intentionally falls back to `config.example.json`.

With Node.js 20 or newer:

```text
cd comfyui-harness
npm start
```

Open `http://127.0.0.1:8787`.

Private reusable project definitions live in `comfyui-harness/projects/*.local.json`. They may remember the prompt, settings, and ComfyUI input filenames, but are ignored by Git and are available only through the local loopback service.

The current UI can read/reuse these projects but does not yet provide a Save Project API/UI.

## 4. Request lifecycle

Attachments are uploaded through `/upload/image`; ComfyUI stores supported image, video or audio input bytes and returns a local filename. The filename is inserted only into the loader binding declared by the preset. The selected API workflow is cloned, sidebar values are applied only to validated bindings, and the graph is sent to `/prompt`.

The backend bridges ComfyUI WebSocket events to the page, filters progress by `prompt_id`, and retrieves completed history and output files through `/history/{prompt_id}` and `/view`.

Since v0.4.2 the UI also shows a graphical **current-node** progress monitor from those live events, plus expandable Eventi ComfyUI and Terminale ComfyUI panels. Terminal logs use ComfyUI `GET /internal/logs/raw` (proxied) and optional subscribe on the existing bridge client id. See Issue #7 and `docs/HARNESS_STATE.md`.

To keep a **visible native Windows console** for ComfyUI, start the portable launcher from an ordinary visible `cmd.exe` window, for example by double-clicking or running `run_nvidia_gpu.bat` in `D:\Ai\ComfyUI_windows_portable_nvidia`. That bat already runs Python in the foreground. Do not restart an active job merely to attach a console. The harness does not manage ComfyUI lifecycle.

The manual prompt is passed essentially unchanged to ComfyUI. The browser trims only leading/trailing whitespace. The MiniMax H3 Director skill is an AI-side authoring/review layer; the harness does not currently execute an LLM or load `SKILL.md` files at runtime.

If a future Director runtime is added, keep manual passthrough available and make prompt creation/validation an explicit optional action rather than silently rewriting prompts.

## 5. Megapixels behavior

Resolution control is `aspectRatio` plus `megapixels` on node `115` (`ResolutionSelector`) for all four H3 presets.

Since v0.4.1 the UI exposes the megapixels value directly instead of a `Preview` / `Final` selector. Real node constraints are min `0.1`, max `16.0`, step `0.1`; the harness default is `0.3`.

The old labels are still accepted from legacy clients and legacy `.local.json` projects, mapping `Preview` → `0.3` and `Final` → `0.4`. An explicit `megapixels` value always wins.

A read-only hint beside the field shows the approximate dimensions and a familiar resolution class, for example `≈ 864×480 · ~480p`. It is display-only and never changes what is submitted. See `docs/HARNESS_STATE.md` for the exact arithmetic.

The generic width/height calculations in the helper library are not bound by the current H3 presets and are no longer sent in the queue payload. They are dormant generic support, not the active resolution path.

Changing megapixels does not automatically change steps, sampler, seed, duration or model.

## 6. Recovery and current limitations

The current normal recovery path uses `sessionStorage`, `/api/active`, the first running queue item and WebSocket/SSE reconnection. It is intentionally single-visible-job oriented.

Known limitations:

- pending jobs are not recovered;
- there is no read-only history polling fallback yet;
- no persistent harness application log exists yet;
- previously uploaded reference filenames become stale if their files disappear from the active ComfyUI input directory;
- multi-job management is not implemented.

A privacy-safe persistent log and a conservative read-only `/history` polling fallback are approved design directions for a future implementation pass, but they are not present until code changes are explicitly made and tested.

## 7. Troubleshooting

If a graph is rejected, inspect `node_errors`: usually a preset points to a stale node/input or the workflow needs a custom node/model not installed locally.

If WebSocket events stop while ComfyUI still works, query the job history. Do not restart a long-running ComfyUI instance or the Node harness during an active generation without explicit user approval.

If a previously saved project fails on a reference loader, verify that its referenced ComfyUI input files still exist before changing workflow bindings.

## 8. Security and repository policy

- Bind both services to `127.0.0.1` by default.
- Never place API keys or provider tokens in workflow JSON.
- This public repository stores text configuration only, never uploaded images, video, audio or generated media.
- Output files remain in ComfyUI's configured output directory.
- `config.json`, private `*.api.json` exports and `projects/*.local.json` remain local and ignored by Git.
- Never commit local filesystem paths or personal/private reference filenames.

For the full verified design decisions, workflow source-of-truth rules and future-change guardrails, read `docs/HARNESS_STATE.md` before editing runtime code.
