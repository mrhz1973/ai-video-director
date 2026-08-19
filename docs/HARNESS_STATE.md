# MiniMax H3 harness — verified state

Last verified: 2026-08-19
Status: operational local Node.js harness; activated, browser-smoke-tested, and merged to `main`
Canonical repository branch: `main`
Merged pull request: #1 (merged 2026-08-19)

This file is the source of truth for the current MiniMax H3 / ComfyUI harness architecture. Read it before proposing harness changes. Do not recreate a parallel harness.

## What the harness is

The operational harness lives in `comfyui-harness/` and is a small Node.js application (`ai-video-director-harness`, v0.4.0, Node >=20) that provides a local browser UI plus an HTTP/SSE bridge to a separately running ComfyUI instance.

Default local endpoints:

- Harness UI: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`

The harness already supports prompt input, private reusable projects, workflow selection, quality, model, steps, duration, aspect ratio, seed, dynamic attachments, live progress, active-job recovery and output links.

## Critical architecture decision: the harness does not start ComfyUI

`server.mjs` contains no `child_process`, `spawn`, `exec` or `execFile` launcher path. It expects ComfyUI to be active already and communicates with it over HTTP and WebSocket.

A separately observed local ComfyUI process had been launched through `cmd.exe /c run_nvidia_gpu.bat`, which then started the embedded Python interpreter and `ComfyUI/main.py`. That launcher was external to this repository and to `server.mjs`.

Therefore:

- do not add automatic ComfyUI startup unless the user explicitly chooses that feature later;
- do not claim the current harness owns or manages the ComfyUI process lifecycle;
- terminal visibility is controlled by the external launch mechanism, not by the harness.

## Configuration behavior

`server.mjs` reads `comfyui-harness/config.json` when present. If absent, it falls back to `config.example.json`.

This is intentional. `config.example.json` is also the default operational configuration. `config.json` is an optional local override and is ignored by Git.

## Runtime request flow

The browser sends the prompt and UI settings to the Node harness. The harness:

1. loads the selected preset and workflow;
2. validates explicit node/input bindings;
3. uploads declared attachments through ComfyUI `/upload/image`;
4. applies only values that have valid bindings;
5. submits the cloned graph to ComfyUI `/prompt`;
6. bridges ComfyUI WebSocket progress through `/api/events`;
7. retrieves history/output data through `/history/{prompt_id}` and `/view`.

Important backend routes include:

- `/api/config`
- `/api/active`
- `/api/events`
- `/api/upload`
- `/api/history`
- `/api/view`
- `/api/queue`
- `/api/outputs`

## Prompt behavior

The harness does not currently run an LLM, load `SKILL.md` files, generate a prompt, normalize prompt structure or apply a provider template.

The browser performs only `trim()` on the textarea content. The resulting text is bound directly to the workflow prompt input.

The MiniMax H3 Director skill is therefore an AI-side authoring/review layer, not a runtime component of the web harness.

Do not silently introduce prompt rewriting into the harness. If a future Director runtime is added, it should be explicit and optional, for example a separate `Create/Validate prompt` action while preserving manual prompt passthrough.

## Workflow sources of truth

For T2VA, I2VA and FL2VA, the runtime source of truth is a pair:

- private ignored `*.api.json`: complete ComfyUI graph topology and defaults;
- tracked `*.preset.json`: contract between the UI and workflow nodes, including bindings, attachments and selectable models.

The ComfyUI editor is the authoring tool, but the harness does not read the graph currently open in ComfyUI. After graph changes, a new API-format export is required.

### Ref2VA

The tracked runtime workflow selected by `minimax-h3-reference.preset.json` is:

`comfyui-harness/workflows/minimax-h3-reference.workflow.json`

The local ignored `minimax-h3-ref2v.api.json` is the private source/master export. It may contain local prompt/file data and is used manually as input to `scripts/build-ref-workflow.mjs`, which creates the sanitized tracked workflow.

Do not confuse the private source export with the tracked runtime workflow.

## H3 mode/model decisions

Current modes:

- T2VA — Text to Video
- I2VA — Image to Video
- FL2VA — First & Last Frame to Video
- Ref2VA — reference images/video/audio to video

T2VA, I2VA and FL2VA intentionally share the H3 Base FL2VA checkpoint. The Base checkpoint supports no frame, first frame only, last frame only, or first+last frame conditioning.

Ref2VA intentionally uses a separate task-specific reference checkpoint. Base and Ref2VA checkpoints are not considered interchangeable.

Current sampler choices are inherited from the source workflows:

- Base family: `res_multistep`
- Ref2VA: `er_sde`

This sampler difference is not documented here as an official MiniMax requirement. Do not change it merely for naming consistency; change only after controlled testing or stronger evidence.

## Quality and resolution

For the current workflows, the effective `Preview` / `Final` difference is implemented through `aspectRatio` plus `megapixels`:

- Preview: `0.3` megapixels
- Final: `0.4` megapixels

The existing generic `dimensions()` helper also calculates width/height values, but the current presets do not bind `width` or `height`; those values are dormant for the active H3 workflows.

This is intentional generic support, not an operational resolution bug.

## Projects and reference persistence

Private projects live in `comfyui-harness/projects/*.local.json` and are ignored by Git.

Current project support is read/reuse only from the UI. There is no Save Project API yet. Existing local project files were created outside the UI.

A project can restore:

- workflow id;
- prompt;
- generation settings;
- previously uploaded ComfyUI input filenames keyed by attachment role.

Stored reference filenames remain valid across harness, ComfyUI and Windows restarts only while the referenced files remain in the active ComfyUI `input` directory. They become stale if those files are deleted, renamed, moved or belong to another ComfyUI installation.

## Recovery behavior

The UI stores `clientId` and current `promptId` in `sessionStorage`, calls `/api/active` at startup, reconnects to ComfyUI WebSocket events through the harness SSE bridge, and uses a read-only history polling fallback every 4 seconds while a prompt is tracked.

Recovery flow:

1. WebSocket/SSE remains the primary progress mechanism.
2. If `/api/active` succeeds, the first running queue item is recovered as today.
3. If `/api/active` temporarily fails, page initialization continues; a stored `h3CurrentPrompt` is kept and history polling starts without clearing the prompt.
4. While `currentPrompt` exists, polling queries `/api/history?promptId=...` read-only.
5. Successful completion is detected from history outputs and uses the existing `/api/outputs` path.
6. Terminal failure/interruption is detected from ComfyUI history `status.status_str === "error"` or `execution_error` / `execution_interrupted` messages.
7. Transient history fetch/network/HTTP/JSON errors do not stop polling or clear recovery state.

The current recovery design still assumes one visible running job. Pending jobs are not recovered, and there is no multi-job UI.

Known remaining edge cases include:

- job pending but not yet running;
- missing client id;
- a job started by another client being mistaken for the harness job;
- ComfyUI restart or queue response-layout change;
- stale `sessionStorage` prompt with no terminal history state yet.

Multi-job management is a separate feature and is not required by the current MVP.

## Logging

The harness writes a lightweight persistent log to `comfyui-harness/logs/harness.log`. The logs directory and `*.log` files are ignored by Git.

Logged events include startup/version, ComfyUI reachability, queue submit/accept/reject, upload success/failure, history/output fetch failures, SSE bridge open/close/error, and active-job recovery. Full prompts, project JSON, uploaded personal filenames, secrets and private absolute paths are not written.

Logging failures must never break generation.

Activation verified on 2026-08-19: the Node harness was restarted with an empty ComfyUI queue, persistent logging became active, the frontend was cache-bypass reloaded, and a real browser smoke test confirmed correct JavaScript MIME serving, successful `recovery.mjs` import, normal UI initialization, ComfyUI connection, and no blocking console errors. Future backend code changes still require a Node restart; frontend asset changes may require a hard refresh.

## Current completeness

At v0.4.0:

- H3 workflow launching: working;
- attachments: working;
- output retrieval: basic but working;
- progress/recovery normal path: working;
- private project reuse: working;
- Director skill: AI-side only, not integrated into runtime;
- automatic prompt generation: not implemented;
- Save Project UI/API: not implemented;
- persistent harness logging: implemented and activated (`comfyui-harness/logs/harness.log`, Git-ignored);
- automatic ComfyUI launch: intentionally not implemented;
- multi-job management: not implemented;
- workflow migration/schema versioning: not implemented;
- proactive validation of previously uploaded asset existence: not implemented;
- polling recovery fallback: implemented and browser-smoke-tested (4-second read-only history polling; WebSocket/SSE remains primary).

## Future architecture, if approved

The original builder suggested keeping four explicit layers if the system is expanded:

1. optional local service manager for ComfyUI health/start/stop/logs, disabled by default;
2. versioned workflow registry with source hashes, node versions and binding validation;
3. optional Director runtime with separate prompt creation/validation action and manual passthrough preserved;
4. application persistence: Save Project, asset validation, job registry, output gallery and multi-job handling.

These are design ideas, not implemented requirements.

## Safety and repository hygiene

This repository is public. Never commit:

- private local filesystem paths;
- `config.json` overrides;
- private `*.api.json` workflow exports;
- `*.local.json` project files;
- uploaded images/video/audio;
- generated media;
- secrets, tokens or credentials.

Never create a second parallel harness when extending the current one. Modify the existing Node.js harness only after reviewing this file, `docs/COMFYUI_H3_SETUP.md`, the active presets and the local private workflow exports when available.

## Branch/PR clarification

PR #1 (`agent/minimax-h3-comfyui-harness`) was the development branch for the operational harness and was merged successfully into `main` on 2026-08-19 after 14/14 Node tests, repository validation, successful GitHub Actions, controlled local activation and a browser smoke test. `main` is now canonical. Treat the old branch name and PR as lineage/history, not as the current source branch.

An accidental parallel branch named `agent/minimax-h3-director-comfyui-harness` and its PR #2 were intentionally abandoned on 2026-08-19. PR #2 was closed without merge and the parallel branch was deleted. Do not recreate or resume that implementation.
