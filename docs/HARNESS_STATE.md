# MiniMax H3 harness — verified state

Last verified: 2026-08-20
Status: operational local Node.js harness; activated, browser-smoke-tested, and merged to `main`
Canonical repository branch: `main`
Merged pull request: #1 (merged 2026-08-19)

This file is the source of truth for the current MiniMax H3 / ComfyUI harness architecture. Read it before proposing harness changes. Do not recreate a parallel harness.

## What the harness is

The operational harness lives in `comfyui-harness/` and is a small Node.js application (`ai-video-director-harness`, v0.8.5, Node >=20) that provides a local browser UI plus an HTTP/SSE bridge to a separately running ComfyUI instance.

Default local endpoints:

- Harness UI: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`

The harness already supports prompt input, full local project CRUD, a categorized multi-asset library (Elements / Locations / Objects / Audio), explicit workflow role assignment, workflow selection, direct megapixels with a read-only resolution hint, model, steps, duration, aspect ratio, seed, dynamic attachments, a graphical ComfyUI progress monitor, expandable event/terminal panels, active-job recovery, output links, a workstation GPU Power panel, a browser-local Batch generation editor (Issue #14 / v0.8.0), and the v0.8.1 left-canvas / right-inspector desktop layout.

## GPU Power Modes (Issue #24, v0.7.4 + v0.7.5 helper)

The Generazione **Inspector** keeps a compact always-visible **GPU POWER** block above its tabs, with three explicit presets only:

| Mode | Watts |
|------|-------|
| ECO | 100 |
| BALANCED | 130 |
| NORMAL | 170 |

Actual GPU state is always read from `nvidia-smi` (draw, current limit, default/min/max limits) and classified as ECO / BALANCED / NORMAL / CUSTOM (±0.5 W). Browser localStorage and project files are never the authority for the current mode.

API:

- `GET /api/gpu-power` — read-only status plus the three allowed modes
- `POST /api/gpu-power` — body `{ "mode": "eco"|"balanced"|"normal" }` only

Writes use `child_process.execFile` with a fixed argument array (`nvidia-smi -i 0 -pl <preset>`). No shell, no privilege escalation, no stored credentials. If Windows denies the write, the harness returns HTTP 403 and keeps Director usable; the UI shows that administrator privileges are required.

GPU Power is **global workstation state**. It is not part of workflow payloads, project saves, Batch jobs, output naming, or Generate. Changing workflow/model/project does not change the GPU power limit; the user must press a power button explicitly.

### Windows Scheduled Task helper (v0.7.5) — security model

On Windows a normal user cannot run `nvidia-smi -pl` (real-GPU smoke of v0.7.4 confirmed HTTP 403). v0.7.5 adds an **optional, one-time-installed** privileged helper so the harness itself stays non-elevated:

- Three immutable on-demand Scheduled Tasks: `\AI Video Director\GPU Power\ECO|BALANCED|NORMAL`. Each task's action is a **direct** `nvidia-smi.exe -i 0 -pl 100|130|170` call — never `cmd.exe`, `powershell.exe`, `node.exe`, or any repo-writable script. No triggers, RunLevel Highest, InteractiveToken principal, no stored credentials.
- Installation is strictly manual: an Administrator runs `scripts/install_gpu_power_tasks.ps1` once (one normal UAC). The installer takes no parameters — executable path (trusted system/NVIDIA locations only), GPU index, wattages and task names are hard-coded. `scripts/uninstall_gpu_power_tasks.ps1` removes exactly those three tasks, idempotently. The harness, UI and Node code never install, modify, delete or elevate anything.
- Before every run, `lib/gpu-power-helper.mjs` exports the task definition (`schtasks /Query /TN <fixed> /XML`, `execFile`, no shell) and validates it strictly: exact task name, command basename `nvidia-smi.exe`, argv exactly `-i 0 -pl <expected>`, single Exec action, RunLevel `HighestAvailable`, `InteractiveToken`, no triggers. Any mismatch → state `invalid`, fail closed, nothing executed.
- Helper states: `ready` / `not-installed` / `partial` / `invalid` / `unsupported` (non-Windows). `GET /api/gpu-power` exposes only `helper.type/available/state`.
- A mode click performs at most **one** `schtasks /Run /TN <fixed>`; the browser still sends only `{ "mode": ... }` and can never influence task name, watts, executable or argv. HTTP 200 is returned only after `nvidia-smi` read-back confirms the expected limit (±0.5 W, poll ≤5 s); otherwise `helper-verify-timeout` (504) with no retry. `nvidia-smi` remains the sole authority for the current limit.
- When the helper is not `ready` on Windows, `POST /api/gpu-power` returns HTTP 409 (`gpu-helper-not-installed` / `gpu-helper-partial` / `gpu-helper-invalid`) and does **not** fall back to the direct setter, avoiding a 403 loop. Read-only status keeps working regardless. The UI shows a `Helper GPU` status line and "Configura controllo GPU" instructions (open PowerShell as Administrator, run the installer, refresh) — no endpoint can start elevation.

## Desktop workspace layout (v0.8.1)

For viewports wider than 800px the Director uses a two-pane layout:

- **Left canvas:** header → single `#prompt` (no native resize corner; dedicated height handle + `h3PromptHeight:v1`) → quick generation controls (`#workflow` / `#model` / MP / aspect / steps / duration / seed) → Batch (`#batchSection` mounted in `#batchMount`) → compact resizable render monitor (`h3MonitorHeight:v1`) → collapsed-by-default Attività/Output drawer (`#activityDrawer` / `#log`).
- **Right inspector:** sticky GPU Power header, then mutually exclusive tabs Progetto / Asset / Input / Output (`h3InspectorTab:v1`). Only the active tab body scrolls; the inspector fits the viewport height.
- **Asset labels:** `member.label` is the primary human-facing name in Asset cards and role selects (`Group / Member label`). Physical filenames remain secondary/tooltip identity and are never renamed by label edits.
- **Autosave:** unsaved work survives reload via isolated `h3RecoveryDraft:v1` (references only). Saved projects debounce-persist through existing `PUT /api/projects/<id>` (700 ms, single-flight). Manual **Salva** creates a new project (`POST /api/projects`) or updates the current id (`PUT /api/projects/<id>`). There is no separate Salva come. Recovery/autosave never submit Generate, Batch, or GPU Power. Armed queued-next / deferred-Batch intent is session/in-memory only and is never written to the recovery draft, saved projects, or prompt history.
- **Sidebar width:** existing `#sidebarResizeHandle` and `h3SidebarWidth:v1` remain (default about 460px). Whole-workspace native `resize: vertical` is removed; desktop `main` uses the viewport height instead of a 72vh resizable box.
- Generate no longer copies the prompt into Activity. Activity is for project notices, errors, warnings and output links — not a chat transcript.

At ≤800px the layout remains a usable single column. No Generate, Batch, GPU Power, Output Manager or safe-fit semantics change in v0.8.1.

## Batch generation (Issue #14, v0.8.0)

Browser-local Batch editor for 2–8 jobs (default prepare count 4) with seed auto-increment, copy/move/remove, per-job overrides, sequential queueing through the ordinary `/api/queue` route, first-failure stop, no retries, runtime restore, draft persistence, Output Manager integration, queue-empty and safe-fit validation, and a block on direct video attachments. There is no special server-side Batch submit endpoint.

### Queued-next and deferred Batch (v0.8.2)

When ComfyUI has exactly one active render (`1 running · 0 pending`):

- **Genera** becomes **Metti in coda** and may arm at most one pending single-job snapshot (explicit user action). The snapshot does not follow later editor edits unless the user presses **Aggiorna dal draft**. **Annulla** drops it.
- A prepared Batch (2–8 jobs) may be armed with **Metti batch in attesa** (`IN ATTESA DELLA CODA`) instead of being refused. Batch Job 1 is not submitted until the queue is empty.
- When the observed queue becomes `0 running · 0 pending`, the coordinator submits the armed queued-next job **or** Batch Job 1 exactly once, then existing sequential Batch behavior continues.
- Reload/browser recovery never autosubmits an armed intent. The user must arm again.

Duration controls and labels use integer seconds only (`5s`). Prompt clear/history uses `h3PromptHistory:v1` (cap 30). Completed renders show a monitor completion card with **Apri video**. Asset group cards show **GRUPPO ASSET** / Nome gruppo above members.

### Project load feedback and durable Batch drafts (v0.8.3)

- Saved projects may include an optional `batchDraft` object persisted through normal Salva/autosave (700 ms debounce, single-flight). Browser `h3BatchDraft:v1:*` keys remain cache/recovery only for saved projects.
- Loading a saved project shows explicit Progetto status (`Caricamento…` / success / warning / error) and restores prepared Batch jobs without autosubmitting execution intent.
- Legacy v0.8.2 localStorage batches migrate only when project identity is unambiguous; otherwise the UI offers a non-destructive **Recupera** action.
- Reload and harness restart never restore queued-next, deferred Batch, or active submit authority from disk.

### Frontend bootstrap hotfix (v0.8.4)

- v0.8.3 accidentally removed the DOM helper `$` from `public/app.js`, aborting frontend initialization (empty selectors, stuck `Connessione…`) while server APIs stayed healthy. v0.8.4 restores the helper and adds a bootstrap regression test that fails whenever a browser entry module uses `$()` without defining it first.

### Prompt action row layout (v0.8.5)

- **Cancella prompt** and **Cronologia** now sit on the same bottom row as **Genera**, right-aligned in order clear → history → generate. The old full-width `prompt-toolbar` above the textarea is removed; button IDs and handlers are unchanged.

**Independence from GPU Power:** Batch never changes GPU mode, never posts `/api/gpu-power`, never invokes `schtasks` or `nvidia-smi -pl`, and never passes wattage or task names. GPU Power never submits Batch or mutates Batch draft/seed/settings. Both remain explicit user actions.

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
- **Salva** — create a new unsaved project (`POST`) or update the current project (`PUT`); a distinct copy starts with **Nuovo**;
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

The desktop workspace (v0.8.1) order is header → prompt → quick generation controls → Batch → compact monitor → Attività/Output drawer on the left, with Project/Asset/Input/Output inspector tabs on the right and GPU Power always visible above those tabs. ComfyUI connection text is always shown; green/amber/red classes only reinforce `collegato` / `Connessione…`|`Riconnessione…` / `scollegato`.

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

`--apply` is explicit-only, fail-closed, and **transactional for detected/caught failures** (not a filesystem ACID / power-loss / process-kill / hardware-failure guarantee): PHASE 1 preflights every supplied workflow in memory (existence, parse, graph contract, backup destination, in-memory patched result reaches `safe`) with **zero writes**; PHASE 2 creates backups and atomic-writes only if every job passed preflight. If a caught apply-phase error occurs after one or more workflows were already modified, restore is attempted for every workflow modified by **this invocation** (continues after individual restore failures). Successful rollback is byte-verified (`APPLY_FAILED_ROLLBACK_OK`, `rollbackComplete=true`, `rolledBack=true`). Incomplete rollback is reported explicitly (`APPLY_FAILED_ROLLBACK_FAILED`, `rollbackComplete=false`, `rolledBack` must not be true) and never claims that all sources match originals; `failedRestoreFiles` / unverified sources are listed. Backups created by the failed invocation remain as recovery artifacts for manual repair; pre-existing backups are never deleted (preflight already rejects collisions). A preflight failure still aborts with zero writes and zero backups. Already-safe files are left untouched (`ALREADY_SAFE`). Idempotent on second `--apply`.

`--check` exit codes (most severe nonzero wins for multi-file: UNEXPECTED > IO > NEEDS_APPLY): `0` SAFE/not-applicable; `3` NEEDS_APPLY; `2` UNEXPECTED/invalid graph; `1` missing/unreadable/parse/IO. Automation must not treat exit `0` as “needs action” or “unexpected”.

Inspector lives in `comfyui-harness/lib/h3-safe-fit.mjs`.

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
