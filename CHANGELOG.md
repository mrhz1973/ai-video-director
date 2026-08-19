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
