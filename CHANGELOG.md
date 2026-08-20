# Changelog

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
