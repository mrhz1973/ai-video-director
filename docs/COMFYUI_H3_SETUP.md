# MiniMax H3 local harness

The harness in `comfyui-harness/` is a small local UI and API bridge. It exposes a prompt/chat area, first/last-frame attachments, workflow selection, quality, model, steps, duration, aspect ratio, seed, WebSocket progress, and output links.

## 1. Prepare ComfyUI

Start ComfyUI on `http://127.0.0.1:8188`. Keep it local. Verify the H3 custom nodes, checkpoints, text encoder, VAE, and required model files are installed and that T2VA/I2VA/FL2VA graphs run successfully in ComfyUI itself before using the harness.

The public H3 repository describes H3-Base as task-specific checkpoints; the exact node names and graph wiring depend on the user's installed ComfyUI extension. For that reason the harness binds an exported graph rather than guessing node classes.

## 2. Export API workflows

For every working mode, use ComfyUI's **Save (API Format)** and place the sanitized file in `comfyui-harness/workflows/`, for example:

- `t2va.api.json`
- `i2va.api.json`
- `fl2va.api.json`

Create matching `.preset.json` files using `workflows/README.md`. Node IDs and input names must match the exported graph exactly. Keep models in the preset's `options.models` list. Do not commit local absolute paths, credentials, or private filenames.

## 3. Configure and run

Copy `config.example.json` to `config.json` only when defaults need changing. With Node.js 20 or newer:

```text
cd comfyui-harness
npm start
```

Open `http://127.0.0.1:8787`.

## 4. Request lifecycle

Attachments are uploaded through `/upload/image`; their returned ComfyUI names are inserted into declared LoadImage bindings. The selected API workflow is cloned, sidebar values are applied only to validated bindings, and the graph is sent to `/prompt`. The browser listens on `/ws?clientId=...`, filters events by `prompt_id`, and retrieves the completed history and output files through `/history/{prompt_id}` and `/view`.

If a graph is rejected, inspect `node_errors`: usually a preset points to a stale node/input or the workflow needs a custom node/model not installed locally. If WebSocket events stop while ComfyUI still works, query the job history; restarting a long-running ComfyUI instance may restore event delivery.

## 5. Security and repository policy

- Bind both services to `127.0.0.1` by default.
- Never place API keys or provider tokens in workflow JSON.
- This public repository stores text configuration only, never uploaded images, video, audio, or generated media.
- Output files remain in ComfyUI's configured output directory.
