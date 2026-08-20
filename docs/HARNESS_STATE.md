# MiniMax H3 harness — verified state

Last verified: 2026-08-20
Status: operational local Node.js harness; activated, browser-smoke-tested, and merged to `main`
Canonical repository branch: `main`
Merged pull request: #1 (merged 2026-08-19)

This file is the source of truth for the current MiniMax H3 / ComfyUI harness architecture. Read it before proposing harness changes. Do not recreate a parallel harness.

## What the harness is

The operational harness lives in `comfyui-harness/` and is a small Node.js application (`ai-video-director-harness`, v0.6.0, Node >=20) that provides a local browser UI plus an HTTP/SSE bridge to a separately running ComfyUI instance.

Default local endpoints:

- Harness UI: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`

The harness already supports prompt input, full local project CRUD, a categorized multi-asset library (Elements / Locations / Objects / Audio), explicit workflow role assignment, workflow selection, direct megapixels with a read-only resolution hint, model, steps, duration, aspect ratio, seed, dynamic attachments, a graphical ComfyUI progress monitor, expandable event/terminal panels, active-job recovery and output links.

## Progress and terminal monitor (Issue #7)

Since v0.4.2 the harness UI includes a prominent render monitor driven only by real ComfyUI events bridged through `/api/events`:

- `progress` → `{ value, max, prompt_id, node }`
- `progress_state` → `{ prompt_id, nodes[id].{ value, max, state, node_id, display_node_id, ... } }`
- `executing` / `executed` / `execution_error` / `execution_interrupted`

Displayed percentage is **current-node numeric progress** (`value/max`), labeled as such. It is never a timer-based estimate and is never claimed to be whole-job completion. When a node is running without a usable `max`, the UI shows an indeterminate `Elaborazione…` state. Job completion remains authoritative from `executing` with `node: null` and/or history outputs.

Elapsed wall-clock time uses ComfyUI `create_time` when recovered via `/api/active` (exact). If only a local first-seen timestamp is available — including values persisted in `sessionStorage` across refresh — the UI shows an approximate `≈ HH:MM:SS`. There is no ETA.

Recovering an already-running external job preserves the harness page's own WebSocket/SSE `clientId`. The recovered `promptId` is used for filtering/history/output; the foreign job `clientId` is never adopted, so a second tab cannot steal the original ComfyUI socket.

Queue running/pending counts are refreshed conservatively from the existing `/api/active` queue read (about every 8s while relevant).

Two expandable panels:

1. **Eventi ComfyUI** — reconstructed lifecycle feed from real events (not raw stdout).
2. **Terminale ComfyUI** — uses the installed ComfyUI internal log API:
   - `GET /internal/logs/raw` proxied as harness `GET /api/comfy-logs`
   - live push via `PATCH /internal/logs/subscribe` on the **existing** SSE-bridged WebSocket client id (no second job WebSocket)

If the log API is unavailable, the panel shows a graceful fallback message. Log contents are local-only and must not be committed to Git.

Native Windows ComfyUI console visibility remains an **external launcher** concern. The portable `run_nvidia_gpu.bat` already runs Python in the foreground of its console (`python_embeded\python.exe -s ComfyUI\main.py ...` then `pause`). Launch that `.bat` from an ordinary visible `cmd.exe` window when a native console is desired. Do not restart an active ComfyUI job merely to attach a console. The harness is not a ComfyUI service manager.

## Critical architecture decision: the harness does not start ComfyUI

`server.mjs` contains no `child_process`, `spawn`, `exec` or `execFile` launcher path. It expects ComfyUI to be active already and communicates with it over HTTP and WebSocket.

A separately observed local ComfyUI process had been launched through `cmd.exe /c run_nvidia_gpu.bat`, which then started the embedded Python interpreter and `ComfyUI/main.py`. That launcher was external to this repository and to `server.mjs`.

Therefore:

- do not add automatic ComfyUI startup unless the user explicitly chooses that feature later;
- do not claim the current harness owns or manages the ComfyUI process lifecycle;
- terminal visibility is controlled by the external launch mechanism, not by the harness.

## Configuration behavior

`server.mjs` resolves config via `lib/config-path.mjs`: `comfyui-harness/config.json` when present, otherwise `config.example.json`.

Optional override for isolated tests/tools only: set `H3_CONFIG_PATH` to an absolute or relative JSON config path. When unset, production resolution is unchanged. Tests must never write the real package-root `config.json`.

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

## Megapixels and resolution

Since v0.4.1 the user-facing `Preview` / `Final` control no longer exists. The UI exposes a direct `Megapixel` numeric field, and that exact value is the generation source of truth bound to the workflow.

Resolution conditioning is still `aspectRatio` plus `megapixels` on node `115` (`ResolutionSelector`) in all four modes.

Real constraints, read from ComfyUI `/object_info` → `ResolutionSelector.megapixels` (`FLOAT`):

- min `0.1`
- max `16.0`
- step `0.1`

The harness operational default is `0.3`. The ComfyUI node's own default (`1.0`) is deliberately not used.

Historical equivalents are kept only as compatibility mapping:

- `Preview` → `0.3` megapixels
- `Final` → `0.4` megapixels

Backend priority order is explicit `megapixels`, then legacy `quality`, then the `0.3` default. Invalid values (empty, `NaN`, non-finite, zero, negative, outside `0.1`–`16`) are rejected with HTTP 400 before submission; the harness never silently normalizes a user value.

Tracked presets advertise the contract as `options.megapixels` (`default`, `min`, `max`, `step`, `multiple`). The legacy `options.qualities` metadata was removed.

### Read-only resolution hint

Next to the `Megapixel` field the UI shows an informational hint, for example `≈ 864×480 · ~480p`.

It is recomputed whenever megapixels or aspect ratio changes and mirrors the real `ResolutionSelector` arithmetic so the displayed dimensions match what the node will produce:

```
total_pixels = megapixels × 1024 × 1024
scale        = sqrt(total_pixels / (W × H))
width        = round(W × scale / multiple) × multiple
height       = round(H × scale / multiple) × multiple
```

`multiple` is `32` because that is the value of the `multiple` widget on node `115` in every active H3 workflow. Note that ComfyUI uses 1024² pixels per megapixel, not 1,000,000, so the hint uses the same base.

Familiar labels are applied only when a standard class is within 25% of the computed height: `~360p`, `~480p`, `~720p HD`, `~1080p Full HD`, `~1440p QHD`, `~2160p 4K UHD`, `~4320p 8K UHD`. 2560×1440 is labeled `~1440p QHD` and never exact `2K`; true DCI 2K is 2048×1080 and is not part of this ladder.

`21:9` reuses the height ladder with an `Ultrawide` suffix. `1:1`, `4:3`, `3:4` and `9:16` show only a shape label (`Square`, `Standard`, `Portrait Standard`, `Portrait`) so the UI never implies an exact broadcast raster.

The hint is informational only. It never modifies megapixels, aspect ratio, bindings, the generated workflow, or submits anything.

### Dormant width/height

The generic `dimensions()` helper still exists but is no longer called by the generation path, and `width`/`height` are no longer sent in the queue payload. The active presets bind neither input because node `115` feeds those values directly inside the graph.

This remains intentional dormant generic support, not an operational resolution bug. Do not activate it from the display helper.

## Projects and categorized asset library (Issue #5)

Private projects live in `comfyui-harness/projects/*.local.json` and are ignored by Git. Absolute project-directory paths are never returned to the browser.

Since v0.5.0 the UI supports local project CRUD:

- **Nuovo** — unsaved draft (warns if dirty);
- **Salva** — create or update the selected project;
- **Salva come** — create a distinct project from the current editor state;
- **Elimina** — confirmation required; deletes only the `.local.json` definition (never ComfyUI input media);
- editable project label;
- visible dirty state: `Modifiche non salvate`.

REST-like routes (loopback only):

- `GET/POST /api/projects`
- `GET/PUT/DELETE /api/projects/:id`
- `POST /api/projects/:id/duplicate`
- `GET /api/asset-status?filename=...&subfolder=...` (repeated parallel pairs; omitted subfolder defaults to root `""`)

Project ids are sanitized; path traversal and absolute paths are rejected. Writes are atomic under the configured `projectDirectory` only. Malformed `.local.json` files are skipped on list and do not crash the server.

### schemaVersion and legacy compatibility

Persisted projects use `schemaVersion: 1`. Legacy files without `schemaVersion` are treated as v0 and **normalized in memory** on load. Loading alone does not rewrite disk files.

### Asset library ≠ workflow bindings

The project holds a categorized **asset library** separate from workflow submission:

- `elements` — named groups of image members (e.g. multiple views of one character);
- `locations` — named groups of place views;
- `objects` — named groups of prop/detail views;
- `audio` — named groups of audio references.

Each group has a stable id, editable label, and ordered members. Each member stores ComfyUI input filename tokens plus labels — never media bytes/base64.

`files` (or equivalent role map) remains the **explicit** workflow slot assignment (`firstImage`, `lastImage`, Ref2VA slots, audio roles declared by the active preset). Drag/drop into the library never auto-assigns roles, never changes workflow, and never calls `/api/queue` or ComfyUI `/prompt`.

The full binding map is retained across workflow switches. Switching I2VA → T2VA → I2VA must not erase `firstImage`. Only the active preset's attachment keys are rendered and submitted; inactive bindings stay persisted but are filtered out of the queue payload. Saved `settings.model` is restored after the preset rebuilds the model list; if unavailable, the UI falls back to the preset default with an explicit warning.

### Stale / missing references

`GET /api/asset-status` probes ComfyUI `/view` read-only using the same percent-encoded `filename`, `type=input`, and `subfolder` query as thumbnails. Library members persist optional `subfolder`; workflow `files[role]` bindings remain filename-only. Status map keys stay the filename for root/legacy assets and use `<subfolder>/<filename>` when the subfolder is non-empty (filenames cannot contain `/`, so this is unambiguous). The same filename in two subfolders is classified under two keys; role/Generate lookup uses the first library member with that filename. Legacy filename-only callers still default to root input `subfolder=""`. For image files, `available` requires HTTP success **and** an `image/*` content-type. Audio uses non-image MIME rules (JSON/image responses are not treated as available audio). Missing required roles disable Generate with a visible reason. Removing a group/member clears role assignments that pointed at those filenames but does **not** delete ComfyUI input files.

Thumbnails request `/api/view` with percent-encoded `filename`, `type=input`, and `subfolder`. This avoids `URLSearchParams` `+` / `%2B` encoding, which 404s ComfyUI for input names that contain spaces even when status still reported Disponibile. Library/selector thumbs are identification only; they are not a generation crop preview.

Workflow binding `<option>` labels are dynamic ordinals (`Martino · Elements #1`) from current group order. Reorder refreshes labels immediately. The option value and saved project binding remain the ComfyUI filename. `schemaVersion` is unchanged.

The desktop workspace order is header → prompt/Generate → render monitor → log. Generation settings use two columns at viewport ≥1100px and one column below that. ComfyUI connection text is always shown; green/amber/red classes only reinforce `collegato` / `Connessione…`|`Riconnessione…` / `scollegato`.

Aspect-ratio-safe I2VA/FL2VA preprocessing is implemented in harness **v0.6.0** as fail-closed inspection + an external private-workflow patcher (Issue #11 PR B). Pad/Stretch UI modes remain deferred.

### Safe center-crop image fit (Issue #11 PR B, v0.6.0)

**Why:** MiniMax `MiniMaxH3ImageToVideo` linked directly to `LoadImage` resizes first/last frames with independent X/Y scales to ResolutionSelector WxH. A portrait source (e.g. 1024×1536) into a landscape target (e.g. ~736×416) widens the subject. Safe behavior is center COVER crop to the target aspect, then uniform resize.

**Public graph contract (do not commit private JSON):**

| Role | Node | Class | Notes |
|------|------|-------|-------|
| Resolution | 115 | `ResolutionSelector` | width/height outputs |
| First LoadImage | 114 | `LoadImage` | preset binding target |
| Last LoadImage | 141 | `LoadImage` | FL2VA only |
| First resize | 144 | `ResizeImageMaskNode` | `crop=center`, WxH from 115, input←114 |
| Last resize | 142 | `ResizeImageMaskNode` | `crop=center`, WxH from 115, input←141 |
| MiniMax | 133 | `MiniMaxH3ImageToVideo` | safe: first←144, last←142 |

Legacy unsafe: `133.first_frame←114` (and FL2VA `last_frame←141`). Safe: `133.first_frame←144`, FL2VA `last_frame←142`.

**Reproduce without committing private files:**

```text
node scripts/apply_h3_safe_fit.mjs --check --i2v <private-i2v.api.json> --fl2v <private-fl2v.api.json>
node scripts/apply_h3_safe_fit.mjs --apply --i2v <path> --fl2v <path>
```

`--apply` is explicit-only, fail-closed, creates `<file>.pre-safe-fit.bak` (never overwrites an existing backup), writes atomically, and is idempotent (`ALREADY_SAFE` on second run). Inspector lives in `comfyui-harness/lib/h3-safe-fit.mjs`.

**Harness behavior:** `/api/config` presets include read-only `safeFit` (`safe` / `needs-apply` / `unexpected` / `not-applicable`). I2VA/FL2VA Generate is blocked when not `safe` (UI + `/api/queue` 409). T2VA/Ref2VA are `not-applicable`. Crop preview for first/last roles uses CSS `object-fit: cover` + center and only appears when status is `safe`. Preset bindings and `schemaVersion: 1` filename project roles are unchanged (patch is downstream of LoadImage).

Pad and Stretch remain future options only; Crop is the supported v0.6.0 safe mode.

Saving persists label, workflow, prompt, generation settings, library groups/members/order, and explicit role assignments. It does **not** persist job id, progress, terminal logs, queue state, or session `clientId`.

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

At v0.5.1:

- H3 workflow launching: working;
- direct megapixels control with read-only resolution hint: implemented;
- graphical ComfyUI progress monitor + event feed + terminal log panel: implemented (Issue #7);
- project CRUD + categorized multi-asset library + explicit role binding + stale detection: implemented (Issue #5);
- HTTP response safety: hardened so a late failure after headers are sent cannot crash Node with `ERR_HTTP_HEADERS_SENT` (notably `/api/view` and `/api/upload`);
- attachments: working;
- output retrieval: basic but working;
- progress/recovery normal path: working;
- private project reuse and save: working;
- Director skill: AI-side only, not integrated into runtime;
- automatic prompt generation: not implemented;
- persistent harness logging: implemented and activated (`comfyui-harness/logs/harness.log`, Git-ignored);
- automatic ComfyUI launch: intentionally not implemented;
- multi-job management: not implemented;
- workflow migration/schema versioning for graphs: not implemented;
- polling recovery fallback: implemented and browser-smoke-tested (4-second read-only history polling; WebSocket/SSE remains primary).

## Future architecture, if approved

The original builder suggested keeping four explicit layers if the system is expanded:

1. optional local service manager for ComfyUI health/start/stop/logs, disabled by default;
2. versioned workflow registry with source hashes, node versions and binding validation;
3. optional Director runtime with separate prompt creation/validation action and manual passthrough preserved;
4. application persistence extensions: job registry, output gallery, multi-job handling, and optional ComfyUI media cleanup.

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
