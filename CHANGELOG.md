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
- Closed PR #2 without merge and deleted the accidental parallel `agent/minimax-h3-director-comfyui-harness` branch; the operational harness remains on `agent/minimax-h3-comfyui-harness` / PR #1.
- Implemented privacy-safe persistent harness logging to `comfyui-harness/logs/harness.log` (Git-ignored) with logging failures unable to break generation.
- Implemented read-only 4-second history polling as a recovery fallback while keeping WebSocket/SSE as the primary progress mechanism; active-job recovery now survives reload more robustly, including guarded `/api/active` startup failure handling and history-based terminal failure detection.
- Added harness unit tests for logging and recovery helpers; validation result: 14/14 Node tests passing after implementation.
- No workflow, preset, model, sampler, scheduler, binding, or automatic ComfyUI startup behavior was changed.
- Activation notes: Node harness restart required for backend logging; browser hard refresh required for frontend recovery code.
