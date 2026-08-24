# Changelog

## 2026-08-24 — v0.13.0

- **Multi-Batch queue** (Issue #47): **CODA BATCH** — persist up to **50** ordered Batch snapshots in project `batchQueue`; explicit **AVVIA CODA** / **RIPRENDI CODA** arms server-side sequential scheduler (`createBatchQueueRuntimeService`). One Batch active at a time; browser may close while Director runs the queue.
- **Aggiungi alla coda** deep-clones the prepared Batch editor snapshot without mutating the source draft. Future queued batches remain editable until claimed (`queued` → `submitting`).
- Fail-closed after Director restart: plan restores; runtime `queueRunId` authority is **not** persisted or auto-restored. **Genera singolo** / **Avvia batch** blocked while queue armed. v0.12 ownership-safe interruption preserved.
- **PR #57 review blockers**: F5/reconcile merge preserves live server entry states (no completed/running → queued downgrade); stale revision rejected for structural edits but authority-safe F5 reconnect allowed; **RECUPERO RICHIESTO** no longer auto-requeued on **RIPRENDI CODA**; per-job queued snapshot editing; v0.12 interrupt wired for current queue Batch; CLIP SESSIONE reconstruction from server runtime metadata; submit failure → `failed` (not `cancelled`); `currentJobIndex` tracks active prompt; queue cards use safe DOM `textContent`.
- **PR #57 second-pass**: reconnect CLIP SESSIONE now fetches real `/api/outputs` rows (filename/url) before upsert; future queued Batches stay editable while the queue is armed; server durable descriptive checkpoints (no execution authority) survive Director restart without browser; multi-queue arm refuses legacy `queuedNext`/`deferredBatch`; `update-entry` applies semantic snapshot validation.
- **PR #57 third-pass**: import `buildQueueSessionOutputRecordsFromOutputs` in browser UI; claim checkpoint persistence failures are fail-closed (no `/prompt`); queue checkpoints patch only `batchQueue` (no stale full-project overwrite); full Batch stop durably checkpoints `cancelled`; server in-memory global execution-lane reservation shared by legacy future intents and multi-Batch queue (cross-tab safe; not persisted).
- **PR #57 fourth-pass**: deferred→active transfer before first `/api/queue` with single finally release; future-intent heartbeat + stale reclaim (F5/tab-loss); immediate Single joins global lane; truthful stop UI on `queueCheckpointFailed`; `RIPRENDI CODA` exits `RECOVERY_REQUIRED` after explicit resolve + durable persist.
- Reference: `docs/BATCH_QUEUE_RUNTIME.md`. Closes #47.

## 2026-08-24 — v0.12.0

- **Runtime interruption** (Issue #51): ownership-safe **INTERROMPI RENDER** (Single), **Interrompi job corrente**, and **INTERROMPI BATCH** controls using audited ComfyUI `POST /interrupt` and selective `POST /queue` `{ delete: [...] }` — never whole-queue clear.
- Server-side in-memory ownership registry on successful `POST /api/queue` (`x-h3-batch-id` / `x-h3-batch-index` for Batch). `GET /api/runtime/ownership` for fail-closed re-check after F5; Director restart intentionally loses destructive authority.
- Batch runtime states extended: `interrupting`, `interrupted`, `cancelled` (terminal). Full Batch stop cancels only verified owned pending prompt IDs; current-job interrupt leaves remaining Batch queue intact.
- Technical reference: `docs/COMFYUI_RUNTIME_CONTROL.md`. No process killing, no project/Batch draft mutation, no output deletion.

## 2026-08-24 — v0.11.0

- **Genera singolo** (Issue #53): explicit Single Render path independent from Batch. One click builds exactly one queue payload from the current prompt, workflow, model, Input bindings, seed, duration, steps, megapixels and aspect — never from Batch count/items/source.
- Prepared Batch jobs may coexist unchanged while Single Render runs. Only **Avvia batch** submits Batch execution.
- Batch section heading is now **Batch — opzionale** with helper copy; batch execution button is **Avvia batch (N)** instead of generic Queue batch.
- Single output still enters **CLIP SESSIONE** with `source = "single"`. No synthetic one-job `batchDraft`, no Batch mutation on Single submit.

## 2026-08-24 — v0.10.0

- **Salva come…** (Issue #50): Progetto inspector action duplicates the current editor state into a **new** project id via POST `/api/projects`. Original project remains untouched; identity switch happens only after successful persistence (fail-closed on error).
- Duplicate copies workflow, model, prompt, settings, asset library, file references, and the full persisted `batchDraft` (per-job prompts, seeds, durations, megapixels/aspect/steps, sparse `item.files`, job order). Runtime execution authority is **not** copied (`h3BatchRuntime:v1`, queued-next, deferred Batch, prompt IDs, etc.).
- **Impostazioni globali batch**: compact Megapixel / Aspect / Steps controls with mixed-value (`Misti`) detection and an explicit **Applica a tutti gli N job** action. Updates only `item.megapixels`, `item.aspect`, and `item.steps` on existing prepared jobs — prompts, seeds, durations, `item.files`, and order are preserved. No `Prepara dal draft` rebuild.
- **Espandi tutti / Comprimi tutti**: presentation-only Batch job card expand/collapse (UI session; not persisted in project JSON). Collapsed summaries now include aspect and steps alongside seed, duration, and megapixels.
- No generation, `/api/queue`, ComfyUI `/prompt`, GPU Power writes, or media deletion implied by any of these actions.

## 2026-08-23 — v0.9.0

- Output Inspector now prioritizes a **CLIP SESSIONE** gallery of finished single-job and Batch clips observed in the current browser session (`h3SessionOutputs:v1` in sessionStorage; survives F5, clears when the tab session ends).
- Gallery cards show job attribution, seed/duration/megapixels/aspect/steps/workflow, ComfyUI original filename/subfolder, optional archive copy filename + folder display name, and **Apri video**. Clearing the list removes session metadata only — never ComfyUI or archived media.
- Best-effort one-shot reconstruction from existing `h3BatchRuntime:v1` / latest-output metadata when promptId → job → output linkage is already authoritative (no output-folder scan, no guessed attribution).
- Existing Destinazione / naming / auto-copy settings move under a compact **Destinazione e nomi** section.
- Removed the legacy bottom **Attività / Output** drawer (`#activityDrawer` / `#log`). Harness-side errors and important notices use compact toast notifications (`showAppNotice`).
- ComfyUI **Eventi** and **Terminale** diagnostics remain in the render monitor.

## 2026-08-23 — v0.8.9

- Batch per-job input/asset bindings: each Batch job may override non-video workflow input roles (image/audio) via sparse `item.files`.
- `source.files` remains the shared fallback; effective job files are `{ ...source.files, ...item.files }`.
- Legacy Batch drafts without `item.files` keep v0.8.8 behavior (all jobs inherit the common snapshot).
- Expanded Batch Job cards expose an Input section with inherit/override selectors reused from the project Asset library.
- Queue payload construction and deferred-Batch snapshots resolve files per job; prompt text is never treated as an asset resolver.
- Per-job preflight identifies missing/unavailable roles by job index. Workflow and model remain common; changing the global Input selector after prepare does not wipe explicit per-job overrides.
- Execution authority remains non-persistent. No automatic generation behavior was added. Activation/restart of a live Director is a separate user-authorized step.

## 2026-08-23 — v0.8.8

- Windows launcher hotfix (Issue #44): fixed invalid PowerShell port-inspection script generation that joined block lines with `"; "` and produced parser errors such as `@{;` / `{;`.
- Port inspection now uses a testable `buildPortInspectionPowerShell()` helper executed via `-EncodedCommand` (UTF-16LE Base64).
- Added real Windows integration tests for temporary TCP listener detection and absent-port classification without mocking PowerShell execution.
- Hardened Desktop shortcut PowerShell resolution to prefer concrete `pwsh.exe` paths and reject `Microsoft\WindowsApps` App Execution Aliases; fallback to Windows PowerShell 5.1.
- Desktop shortcut now passes `-PauseOnError` so fail-closed startup errors remain visible until Enter; successful startup does not pause.

## 2026-08-23 — v0.8.7

- Windows one-click launcher (Issue #42): added health-gated, idempotent startup for ComfyUI (`8188`) and AI Video Director (`8787`) under `comfyui-harness/scripts/windows/`.
- Launcher reuses healthy services, starts missing ones exactly once, and fails closed when a port is occupied by an unexpected process (no broad `node.exe`/`python.exe` kills).
- Local machine config lives in `%LOCALAPPDATA%\AI Video Director\launcher.json` (not committed). Installer creates a Desktop **AI Video Director** shortcut via `WScript.Shell`.
- Browser opens `http://127.0.0.1:8787/` only after Director `/api/config` health succeeds. Status command is read-only. No generation, queue submission, or project mutation.

## 2026-08-22 — v0.8.6

- Persistence fix (Issue #40): a legacy/browser-local Batch restored into a saved project is no longer marked `Salvato` until the server confirms the same Batch in `project.batchDraft`.
- Load baseline uses the server project's Batch (or null). Unambiguous legacy auto-migration imports locally, stays dirty, and autosaves exactly once; only a verified PUT response advances the baseline.
- Manual Save and autosave reject HTTP responses that omit or mismatch a requested Batch (`Errore salvataggio`); browser-local recovery is retained until confirmation.
- Execution authority remains non-persistent; no autosubmit after migration.

## 2026-08-22 — v0.8.5

- UI-only (Issue #38): moved **Cancella prompt** and **Cronologia** from the two full-width rows above the prompt editor to the bottom prompt action row, immediately left of **Genera** (`[ Cancella prompt ] [ Cronologia ] [ Genera ]`).
- Removed the legacy `prompt-toolbar` rows so the prompt editor recovers vertical space; existing button IDs and JS handlers unchanged.
- Added layout regression tests for single-instance controls, shared action container, DOM order, and responsive right-aligned wrapping.

## 2026-08-22 — v0.8.4

- Hotfix (Issue #36): restored the DOM helper `const $ = id => document.getElementById(id);` in `comfyui-harness/public/app.js`, accidentally removed during the v0.8.3 import changes.
- The missing helper aborted frontend bootstrap with a ReferenceError: version not rendered, projects dropdown stuck on `Nessun progetto`, empty workflow/model selectors and a permanent `Connessione…` badge while server APIs stayed healthy.
- Added a frontend bootstrap regression test that fails if any browser entry module uses `$()` without defining the helper, or defines it after first use.
- No generation, GPU, workflow, project-data or Batch behavior changes.

# 2026-08-22

- Implemented harness **v0.8.3** project load feedback and durable project-bound Batch drafts (Issues #33–#34).
- Added explicit Progetto inspector status: `⟳ Caricamento…`, `✓ Progetto caricato`, `⚠ Progetto caricato con avvisi`, `✕ Errore caricamento` with stale async load protection.
- Prepared Batch drafts for saved projects now persist in the project JSON (`batchDraft`) via normal Salva/autosave; browser `h3BatchDraft:v1:*` remains cache/recovery only.
- Loading a saved project restores Batch jobs across harness restarts and different browser profiles without autosubmitting queued-next, deferred Batch, or `/api/queue`.
- Legacy v0.8.2 localStorage batches migrate when identity is unambiguous; ambiguous candidates show `Batch locale trovato · N job · Recupera` instead of silent overwrite.
- Execution authority (queued-next, deferred Batch, submit locks) is never serialized into project files.

## 2026-08-22 — v0.8.2

- Implemented harness **v0.8.2** live-use follow-ups as one coordinated release (Issues #27–#31).
- Added an explicit queued-next single job (`Metti in coda`, max one pending snapshot) and a deferred Batch handoff (`Metti batch in attesa`) so a prepared job/batch can wait while ComfyUI shows `1 running · 0 pending`, then submit exactly once when the queue becomes empty.
- Armed execution intent is in-memory only: reload/recovery restore the editable draft but never autosubmit queued-next or deferred Batch Job 1.
- One submission coordinator owns Generate, queued-next, deferred Batch and active Batch so they cannot race or double-POST `/api/queue`.
- Added prompt `Cancella prompt` plus bounded local `h3PromptHistory:v1` (30 entries, exact-dedupe). Restore/copy/delete never generate, queue, or write GPU.
- Normalized all normal duration semantics to whole seconds (`5s`, never `5.0s`) via a shared helper, including project load, recovery, Batch summaries and output tokens.
- Added a Render Monitor completion card (`✓ LAVORO FINITO`) with `Apri video` for the latest identifiable output, plus per-job Batch output links and an `ULTIMO OUTPUT` marker. `Mostra nella cartella` is omitted (no safe constrained reveal endpoint).
- Unified project Save: `Nome progetto` sits above Nuovo/Salva/Elimina; `Salva come` is removed. Unsaved Salva POSTs create; existing Salva PUTs the same id. Typing a name does not create a project.
- Asset groups now show a `GRUPPO ASSET` / Nome gruppo header while keeping member.label primary and filename secondary.
- Prompt vertical resize uses a clearer bottom handle (`ns-resize`, up=shorter, down=taller) persisted on `h3PromptHeight:v1`, independent of the monitor handle. Custom drag is disabled at ≤800px.
- No GPU Power writes, no ComfyUI lifecycle changes, and no private workflow JSON or `.pre-safe-fit.bak` mutations.

## 2026-08-17 — Project memory v2

- Added automatic onboarding through AGENTS.md and START_HERE.md.
- Added a live HANDOFF.md for new-chat continuity.
- Versioned the uploaded Acting, Lira and CineDance manuals as project-shared skills.
- Recorded exact source fingerprints for the three manuals.
- Added per-run metadata, lineage and reviews for G003 and planned G004.
- Added the final V4 prompt and exact corrected Element handle.
- Added the selected lateral hairless body reference and exact tattoo reference hashes.
- Added source-master, shot-list and audio-assembly planning.
- Documented the public text-only repository policy.
- Added local and GitHub Actions validation.

# 2026-08-18

- Added MiniMax H3 Director and provider-aware Video AI Director router skills.
- Added a minimal local ComfyUI HTTP/WebSocket harness with configurable API-workflow bindings.
- Documented local H3 setup, security boundaries, and workflow export requirements.

# 2026-08-19

- Renamed the repository-facing product to AI Video Director while preserving the existing Rambo production records.
- Added MiniMax H3 Reference Images to Video with seven images, one motion-reference video, and one audio reference.
- Added private local projects that remember prompts, settings, and ComfyUI input filenames without publishing media or personal paths.
- Added dynamic, human-readable attachment controls and versioned the local harness as v0.4.0.
- Hardened H3 reference prompting with explicit per-asset authority, exclusion boundaries, and conflict precedence while retaining MiniMax's official labels and section order.
- Audited the operational H3 harness and confirmed that it is a Node.js client/bridge for a separately running ComfyUI instance; it does not launch or manage the ComfyUI process.
- Added `docs/HARNESS_STATE.md` as the authoritative harness architecture/state document and wired it into START_HERE, AGENTS and HANDOFF for new-chat continuity.
- Documented intentional runtime decisions: `config.example.json` fallback, Base FL2VA checkpoint sharing across T2VA/I2VA/FL2VA, separate Ref2VA checkpoint, Preview/Final megapixel behavior, dormant generic width/height support and manual prompt passthrough.
- Documented workflow sources of truth: private Base-mode API exports plus tracked presets, and the tracked sanitized Ref2VA runtime graph built from a private local source export.
- Recorded current limitations as explicit design state rather than bugs: no runtime Director/LLM, no Save Project API, no automatic ComfyUI launch, no multi-job UI.
- Closed PR #2 without merge and deleted the accidental parallel `agent/minimax-h3-director-comfyui-harness` branch.
- Implemented privacy-safe persistent harness logging to `comfyui-harness/logs/harness.log` (Git-ignored) with logging failures unable to break generation.
- Implemented read-only 4-second history polling as a recovery fallback while keeping WebSocket/SSE as the primary progress mechanism; active-job recovery now survives reload more robustly, including guarded `/api/active` startup failure handling and history-based terminal failure detection.
- Added harness unit tests for logging and recovery helpers; validation result: 14/14 Node tests passing after implementation.
- No workflow, preset, model, sampler, scheduler, binding, or automatic ComfyUI startup behavior was changed.
- Fixed static serving so `.mjs` modules are returned with `text/javascript` instead of falling back to `text/html`.
- Performed a controlled harness-only restart with an empty ComfyUI queue; ComfyUI remained running unchanged.
- Browser smoke test passed after cache-bypass reload: `app.js` and `recovery.mjs` loaded with correct JavaScript MIME types, UI initialized correctly, ComfyUI showed connected, queue remained empty, and no blocking console errors were present.
- GitHub Actions `Validate project memory` passed on the final PR head.
- PR #1 was marked ready and merged successfully into `main` on 2026-08-19. `main` is now the canonical source for the MiniMax H3 Director, operational Node.js harness, and harness project memory.

# 2026-08-20

- Added `docs/HARNESS_ROADMAP.md` to preserve the approved future direction for the H3 harness and prompt workflow.
- Recorded GitHub as the durable memory for material harness behavior, prompt-strategy, model/checkpoint, workflow and experiment decisions; chat history alone is not considered sufficient project state.
- Set the future UI direction to a simple Basic view plus an expandable Advanced view that exposes only real validated ComfyUI workflow inputs.
- Added systematic H3 prompt improvement and controlled A/B prompt/reference experiments as first-class roadmap goals.
- Added controlled evaluation of stronger or higher-quality compatible H3 model/checkpoint variants while preserving the current known-good baseline and documenting quality, speed, memory/stability and regression results.
- Added future Save/Update Project, workflow/model registry and optional Director prompt-create/validate work to the roadmap while preserving manual prompt passthrough.
- Updated START_HERE and HANDOFF so future chats must read the roadmap before proposing H3 runtime/model/prompt changes.
- Replaced the user-facing `Preview / Final` quality selector with a direct `Megapixel` numeric control; the visible value is now the exact value bound to the ComfyUI workflow.
- Verified the real constraints from ComfyUI `/object_info` → `ResolutionSelector.megapixels`: min 0.1, max 16.0, step 0.1. The harness default is 0.3; the node's own 1.0 default is intentionally not used.
- Confirmed a real `megapixels` binding on node `115` for all four modes (T2VA, I2VA, FL2VA, Ref2VA); no mode needed a faked binding.
- Made explicit `megapixels` the generation source of truth. Legacy `quality: "Preview"` -> 0.3 and `quality: "Final"` -> 0.4 remain accepted only for old clients and old `.local.json` projects, with explicit megapixels always winning.
- Added backend rejection (HTTP 400) for empty, `NaN`, non-finite, zero, negative or out-of-range megapixel values; the harness never silently normalizes a user value.
- Added a read-only resolution hint beside the megapixel field showing approximate `WxH` plus a familiar class, recomputed live when megapixels or aspect ratio changes.
- Mirrored the real `ResolutionSelector` arithmetic in the hint (1024² pixels per megapixel, rounded to the workflow's `multiple` of 32), so 0.4 MP at 16:9 displays 864×480 rather than a generic estimate.
- Labeled familiar classes informationally only: `~480p`, `~720p HD`, `~1080p Full HD`, `~1440p QHD`, `~2160p 4K UHD`. 2560×1440 is labeled QHD and never exact `2K` (true DCI 2K is 2048×1080). Non-16:9 ratios show shape labels, and `21:9` reuses the height ladder with an `Ultrawide` suffix.
- Guaranteed the resolution label never modifies megapixels, aspect ratio, bindings, the generated workflow or submission state.
- Migrated the tracked preset contract from `options.qualities` to validated `options.megapixels` metadata (`default`, `min`, `max`, `step`, `multiple`) while preserving existing node IDs and bindings.
- Stopped sending dormant width/height in the queue payload so the display helper can never activate them; `dimensions()` remains an unused generic helper.
- Added harness unit tests for direct megapixels, legacy compatibility, validation, aspect conditioning, display-resolution rounding/labeling and the preset/workflow contract; validation result: 34/34 Node tests passing plus repository validation.
- Versioned the harness as v0.4.1. No H3 model, sampler, scheduler, workflow topology or ComfyUI lifecycle behavior was changed.
- Fixed the standard run handoff: the assistant/director defines prompt and settings, Cursor may start missing local services and fully prepare the harness form, and the user performs the final `Genera` click manually in the normal browser session.
- Documented that Cursor preparation must not submit `/api/queue`, press `Genera`, or silently turn preparation into execution; if ComfyUI or the harness is already running, Cursor must leave the existing process alone unless a real restart need exists.
- Implemented Issue #7: prominent graphical render monitor driven by real ComfyUI `progress` / `progress_state` / `executing` events, with active-node labeling, elapsed time (no ETA), conservative queue counts, expandable Eventi ComfyUI feed, and Terminale ComfyUI via `/internal/logs/raw` + subscribe on the existing SSE bridge client id.
- Documented that displayed percentages are current-node progress only, never timer-faked whole-job completion; job completion remains history/`executing null` authoritative.
- Documented native Windows console as an external `run_nvidia_gpu.bat` launch concern; harness remains not a ComfyUI service manager.
- Versioned the harness as v0.4.2. Validation: 44/44 Node tests plus repository validation.
- Implemented Issue #5: local project CRUD (Nuovo / Salva / Salva come / Elimina), dirty-state tracking, and a categorized multi-asset library (`elements` / `locations` / `objects` / `audio`) where each library item is a named group of ordered members.
- Kept asset library distinct from workflow bindings: drag/drop never auto-assigns roles, never changes workflow, and never submits generation; the active preset remains the source of truth for slots.
- Added legacy `.local.json` in-memory normalization to `schemaVersion: 1` without rewriting on load; stale/missing ComfyUI inputs are classified via `/api/asset-status` and block required roles on Generate.
- Removing a group/member clears role assignments but does not delete ComfyUI input files.
- Versioned the harness as v0.5.0. Validation: 56/56 Node tests plus repository validation.
- Fixed harness crash after completed generation/output retrieval caused by an attempted second HTTP response (`ERR_HTTP_HEADERS_SENT`). `/api/view` and `/api/upload` now buffer the upstream body before writing downstream headers; the JSON helper and outer request catch refuse duplicate `writeHead` after headers are already sent.
- Versioned the harness as v0.5.1. Validation: 67/67 Node tests plus repository validation.
- Streamlined the Director UI (Issue #11 PR A, v0.5.2): prompt editor moved above the render monitor so it is writable without scrolling; generation settings use a two-column grid at ≥1100px; ComfyUI connection badges use explicit green/amber/red states with text; workflow selectors show dynamic ordinal labels (`Group · Elements #1`) while bindings still persist filenames; Generate is disabled with a visible reason when preparation is invalid; double-submit is blocked.
- Thumbnails: `<img src>` no longer uses `URLSearchParams` (`+` / `%2B`) for filenames that contain spaces. View URLs now percent-encode `filename`, `type=input`, and `subfolder`. Image `available` status requires an `image/*` content-type. Audio is not classified with image MIME rules.
- Aspect-ratio-safe I2VA/FL2VA crop rewiring remains pending (Issue #11 PR B). No generation graph or private `*.api.json` was changed.
- Versioned the harness as v0.5.2. Validation: 86/86 Node tests plus repository validation.
- Fixed asset availability so `/api/asset-status` probes the member ComfyUI input `subfolder` instead of always using `""`. Thumbnails and status share `filename` + `type=input` + `subfolder`. Workflow bindings and `schemaVersion: 1` are unchanged; filename-only callers still default to root input. Generate no longer false-blocks a valid nested-subfolder assignment. Validation: 100/100 Node tests plus repository validation.
- Implemented Issue #11 PR B (v0.6.0): safe center-crop image fit for I2VA/FL2VA. Direct MiniMax `first_frame`/`last_frame` LoadImage links stretch non-uniformly; the safe graph routes through existing `ResizeImageMaskNode` center-crop nodes targeting ResolutionSelector WxH. Public fail-closed inspector + `scripts/apply_h3_safe_fit.mjs` (`--check` / explicit `--apply` with backup + atomic write). Harness disables Generate when private I2VA/FL2VA graphs are `needs-apply` or `unexpected`. Crop preview (object-fit cover, center) appears only when status is `safe`. Pad/Stretch deferred. Private `*.api.json` remain uncommitted. Validation: 110/110 Node tests plus repository validation.
- Hardened `scripts/apply_h3_safe_fit.mjs` to transactional two-phase apply (validate all supplied workflows before any backup/write) and documented `--check` exit codes (`0` safe, `3` needs-apply, `2` unexpected, `1` IO). Partial multi-file apply is impossible. Remains harness v0.6.0. Validation: 115/115 Node tests plus repository validation.
- Added apply-phase rollback for caught I/O/write failures after a prior workflow in the same `--apply` was committed: restore every modified source to exact original bytes (verified). Failed-run backups may remain as recovery artifacts. Remains v0.6.0. Validation: 117/117 Node tests plus repository validation.
- Hardened rollback reporting: incomplete restore is `APPLY_FAILED_ROLLBACK_FAILED` (`rollbackComplete=false`, never `rolledBack=true`, never claims originals match). Successful verified rollback remains `APPLY_FAILED_ROLLBACK_OK`. Remains v0.6.0. Validation: 119/119 Node tests plus repository validation.

# 2026-08-21

- Extended harness **v0.8.1** asset UX and persistence: member.label is the primary asset/role display name (filename secondary), labels are editable without renaming ComfyUI files, unsaved drafts recover via isolated `h3RecoveryDraft:v1`, and already-saved projects autosave through existing `PUT /api/projects/<id>` with 700 ms debounce and single-flight writes.
- Redesigned the desktop Director workspace for harness **v0.8.1** (layout/UX only): left primary canvas (prompt → quick generation controls → Batch → compact resizable monitor → collapsed Attività/Output drawer) and a right Inspector with sticky GPU Power plus Progetto / Asset / Input / Output tabs.
- Removed prompt duplication into the activity log on Generate (`add(prompt, "user")`), disabled the native textarea resize corner, removed whole-workspace native vertical resize, and added explicit prompt/monitor resize handles with isolated `h3PromptHeight:v1` / `h3MonitorHeight:v1` keys (sidebar width persistence unchanged).
- No Generate/Batch/GPU Power/Output Manager/safe-fit API behavior changes.
- Implemented Issue #24: GPU Power Modes (harness **v0.7.4**).
- Added a compact Generazione-sidebar **GPU POWER** panel with three explicit presets only: **ECO 100 W**, **BALANCED 130 W**, **NORMAL 170 W**.
- Live GPU state is read from `nvidia-smi` (draw, current/default/min/max limits) and classified as ECO / BALANCED / NORMAL / CUSTOM; browser localStorage is never the authority.
- Server routes: `GET /api/gpu-power` (read-only) and `POST /api/gpu-power` with body `{ "mode": "eco"|"balanced"|"normal" }` only. Arbitrary wattage, injection strings and unknown modes are rejected before invoking `nvidia-smi`.
- Power-limit writes use `child_process.execFile` with a fixed argument array (`-i 0 -pl <preset-watts>`). No shell, no UAC, no scheduled tasks, no stored credentials. Privilege denial returns HTTP 403 with a clear Italian UI message.
- GPU Power is global workstation state: independent of projects, workflows, Generate, Batch and output naming. Generate/Batch never change power mode implicitly.
- Validation: full harness Node test suite including mocked `nvidia-smi` setter coverage.
- Extended GPU Power with an optional Windows Scheduled Task helper (harness **v0.7.5**) so the non-elevated harness can switch modes without per-click UAC. Real-GPU smoke of v0.7.4 confirmed the direct setter is denied (HTTP 403) from a normal user, motivating this design.
- Added `scripts/install_gpu_power_tasks.ps1` (manual, one-time, Administrator-only; **not executed by the harness**) creating exactly three on-demand tasks under `\AI Video Director\GPU Power\` (ECO/BALANCED/NORMAL) whose action is a **direct** `nvidia-smi.exe -i 0 -pl 100|130|170` call — no shell, no script wrapper, no triggers, no stored credentials. Added the matching idempotent `scripts/uninstall_gpu_power_tasks.ps1`.
- Added `comfyui-harness/lib/gpu-power-helper.mjs`: before any run, each fixed task definition is exported via `schtasks /Query /XML` and strictly validated (command basename `nvidia-smi.exe`, exact fixed argv, RunLevel `HighestAvailable`, `InteractiveToken`, single Exec action, no triggers). Anything unexpected fails closed as `invalid` and nothing is executed.
- `POST /api/gpu-power` on Windows now runs at most **one** `schtasks /Run` per click and returns HTTP 200 only after `nvidia-smi` read-back confirms the expected wattage (poll ≤5 s); otherwise `helper-verify-timeout`. Helper absent/incomplete/invalid returns HTTP 409 (`gpu-helper-not-installed` / `gpu-helper-partial` / `gpu-helper-invalid`) with clear Italian UI messages and **no** direct `-pl` fallback. Non-Windows keeps the v0.7.4 direct setter; helper state reports `unsupported`.
- `GET /api/gpu-power` additionally exposes safe helper metadata (`helper.type/available/state` only). The UI shows a compact `Helper GPU` status line plus a "Configura controllo GPU" affordance that displays manual install instructions — it never elevates, never runs the installer, and never writes helper state to projects or localStorage.
- Validation: full harness Node test suite (mocked `schtasks`/`nvidia-smi`; no real task created, deleted or run) plus static security contracts on both PowerShell scripts.
- Implemented Issue #14 Batch generation v1 (harness **v0.8.0**) on top of GPU Power v0.7.5: browser-local draft editor (2–8 jobs, default prepare count 4), seed auto-increment, copy/move/remove, per-job overrides, sequential `/api/queue` submission with first-failure stop and no retries, runtime restore, Output Manager integration, queue-empty and safe-fit guards, and a block on direct video attachments. Batch never changes GPU power mode; GPU Power never submits Batch. Synced `agent/batch-generation-v1` with main `ac77a67` via merge commit (no rebase).
