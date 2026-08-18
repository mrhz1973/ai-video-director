# ComfyUI H3 Harness

A minimal local control surface for launching API-format ComfyUI workflows from
one prompt box with reference attachments and a small runtime sidebar.

The harness is intentionally model-node agnostic. It does not assume which
MiniMax H3 custom nodes are installed. Instead, it loads the API JSON workflows
that already work in the user's ComfyUI and patches the exact node inputs defined
in `config.json`.

## What it provides

- prompt/chat-style text box;
- image attachments;
- workflow selector for T2V, I2V and FL2V;
- sidebar fields for model, quality, steps, duration, aspect and seed;
- image upload through ComfyUI `/upload/image`;
- workflow submission through ComfyUI `/prompt`;
- real-time execution events through ComfyUI `/ws` proxied by the harness;
- `/history/{prompt_id}` polling as a fallback and completion source;
- output retrieval through ComfyUI `/view`.

The backend proxy keeps ComfyUI's local address and workflow details out of the
browser code and avoids depending on ComfyUI CORS settings.

## 1. Prerequisites

- Python 3.11+ recommended.
- A working local ComfyUI instance.
- The H3/custom-node workflows you intend to use already tested inside ComfyUI.
- ComfyUI reachable by default at `http://127.0.0.1:8188`, or another address
  configured in `config.json`.

The harness does not install MiniMax H3 models or ComfyUI custom nodes.

## 2. Export the working ComfyUI workflows

For each mode you want to expose, export the working graph in ComfyUI's API JSON
format and save it under `workflows/`.

Default names expected by the example config:

```text
workflows/t2v_api.json
workflows/i2v_api.json
workflows/fl2v_api.json
```

See `workflows/README.md` for the binding model.

## 3. Create local config

From this directory:

```powershell
Copy-Item config.example.json config.json
```

or on macOS/Linux:

```bash
cp config.example.json config.json
```

Open `config.json` and replace every example dotted binding with the real node
ID and input name from the exported API workflow.

For example, if the sampler is node `42` and its seed input is `seed`, bind:

```json
"seed": "42.inputs.seed"
```

If a parameter is fixed inside your workflow or not represented by one simple
input, remove that binding instead of guessing.

For I2V and FL2V, `bindings.images` defines attachment order. FL2V should map the
first uploaded image to the first-frame node and the second image to the
last-frame node.

## 4. Install harness dependencies

From `apps/comfyui-harness`:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
```

macOS/Linux equivalent:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## 5. Start ComfyUI

Start ComfyUI normally and confirm its web UI opens. The harness health check
calls `/system_stats` on the configured address.

No public bind is required. For a single-machine setup, keep ComfyUI bound to
localhost.

## 6. Start the harness

From `apps/comfyui-harness` with the virtual environment active:

```bash
uvicorn server:app --host 127.0.0.1 --port 8765
```

Open the harness at:

```text
http://127.0.0.1:8765
```

The status indicator should show `ComfyUI connected`.

## 7. Run a generation

1. Choose T2V, I2V or FL2V.
2. Paste the final H3 prompt produced by the MiniMax H3 Director skill.
3. Attach the number of images shown by the workflow hint.
4. Set model/quality/steps/duration/aspect/seed only where your workflow exposes
   those inputs.
5. Press **Queue in ComfyUI**.

The page receives WebSocket execution updates and simultaneously polls history.
History polling is deliberate: the final output metadata comes from
`/history/{prompt_id}`, and it also provides a fallback if a WebSocket event is
missed.

## Configuration file override

By default the server loads `config.json`; if it does not exist, it falls back
to `config.example.json` so the UI can still start.

To use another config file:

```powershell
$env:COMFY_HARNESS_CONFIG = "C:\path\to\my-config.json"
uvicorn server:app --host 127.0.0.1 --port 8765
```

## Security boundary

This tool is intended for local use. Keep both ComfyUI and this harness on
`127.0.0.1` unless you deliberately add authentication and transport security.
Do not commit `config.json` if you later place credentials or private network
information inside it. The repository should continue to contain only the
sanitized example configuration.

## API flow

The browser talks only to the local harness:

```text
Browser
  -> POST /api/run
       -> POST ComfyUI /upload/image (I2V/FL2V)
       -> POST ComfyUI /prompt
  -> WS /api/ws/{client_id}
       -> WS ComfyUI /ws?clientId=...
  -> GET /api/history/{prompt_id}
       -> GET ComfyUI /history/{prompt_id}
  -> GET /api/view
       -> GET ComfyUI /view
```

This follows ComfyUI's documented server routes and official WebSocket API
examples rather than scraping the ComfyUI web interface.

## Known minimal-harness limits

- No built-in model installer or node manager.
- No graph editor.
- No provider billing logic.
- No automatic discovery of which node corresponds to prompt/seed/duration;
  bindings are explicit by design.
- Binary WebSocket preview frames are ignored; completed files are fetched from
  history/output metadata.
- If a workflow represents aspect ratio as separate width/height values, either
  export separate workflow presets or extend the binding layer for that node
  pack rather than forcing the example `aspect` string binding.
