# Live handoff

Updated: 2026-08-20
Repository visibility: public

This repository currently has two active context tracks:

1. Rambo / Higgsfield production state.
2. MiniMax H3 / local ComfyUI harness state.

A new chat must read both the production handoff below and `docs/HARNESS_STATE.md` before proposing changes to the local H3 harness. For future H3 development, also read `docs/HARNESS_ROADMAP.md`.

---

# Track A — Rambo / Higgsfield production

Active sequence / shot: SEQ01 / SH010
State: one V4 generation authorized, not launched

## Current objective

Generate one five-second silent V4 revision of the clandestine radio-hut shot. Preserve the V3 face, framing, environment and restrained eye-led reaction while correcting body hair, tattoo fidelity and head-to-body scale.

## Approved evidence

- V2A is the preferred body anatomy and skin baseline.
- V3 has the best facial identity, facial realism, framing and radio-hut composition.
- V3 correctly lets the eyes move before the head at the final danger cue.
- The lateral headless body reference is the preferred proportional bridge for the new Element.
- The separate two-angle tattoo reference is the only authority for tattoo artwork, scale, rotation and position.

## Rejected evidence

- V3 tattoo: redesigned, enlarged and misplaced.
- V3 torso and arms: artificial body hair.
- V3 anatomy: head too large, shoulders and body too small.
- The earlier generated headless body plate: residual hair and tattoo reinterpretation.

## Active Element

Exact handle: @char_char_martino-completo-corpo_v3_V3
Provider ID: unknown
Registry status: ready_for_v4

Do not correct, shorten or normalize the handle.

## Active files

- Prompt: prompts/SEQ01/SH010/v04-prompt.md
- Planned run: shots/SEQ01/SH010/G004/run.yaml
- Planned lineage: shots/SEQ01/SH010/G004/lineage.yaml
- Acceptance checklist: shots/SEQ01/SH010/G004/review.md
- Element registry: registry/elements.yaml
- Reference manifest: docs/REFERENCE_ASSETS.md

## Authorization

The user wrote the exact phrase AUTORIZZO LA GENERAZIONE on 2026-08-17. It is recorded for G004 only. G004 has not been launched.

Any run after G004 requires a new exact authorization.

## Next production action

If the user asks to execute the provider action, submit exactly one G004 generation with the documented settings and prompt. If the user only asks for prompt, review or repository work, do not open or control Higgsfield.

After output arrives, compute its SHA-256, fill G004 run and review files, append registry/generations.csv, update PROJECT_STATUS.md and HANDOFF.md, and record the result in the dated log.

---

# Track B — MiniMax H3 / local ComfyUI harness

Detailed source of truth: `docs/HARNESS_STATE.md`
Future-development roadmap: `docs/HARNESS_ROADMAP.md`
Setup/operations guide: `docs/COMFYUI_H3_SETUP.md`
Canonical branch: `main`
Historical merged pull request: #1
Harness implementation: existing Node.js application in `comfyui-harness/`
Known package version: 0.4.0

## Verified architecture

- Harness UI default endpoint: `http://127.0.0.1:8787`.
- ComfyUI default endpoint: `http://127.0.0.1:8188`.
- The harness does not launch, stop or own the ComfyUI process lifecycle.
- ComfyUI must be started externally before using the harness.
- The harness talks to ComfyUI through HTTP/WebSocket and bridges progress to the browser.
- Manual prompt text is passed essentially unchanged to ComfyUI; the H3 Director skill is not executed inside the harness runtime.
- `config.example.json` is the valid runtime fallback when no private `config.json` override exists.

## Verified H3 workflow state

Operational modes:

- T2VA
- I2VA
- FL2VA
- Ref2VA

T2VA/I2VA/FL2VA intentionally use the same H3 Base FL2VA checkpoint. Ref2VA intentionally uses a separate task-specific reference checkpoint.

The Base-family sampler currently comes from the source graphs as `res_multistep`; Ref2VA currently uses `er_sde`. This difference is inherited from the source workflows and is not recorded as an official MiniMax requirement.

Current quality behavior:

- Preview -> 0.3 megapixels
- Final -> 0.4 megapixels

Current presets bind `aspectRatio` and `megapixels`. Generic calculated width/height values are dormant for the active H3 workflows and are not an operational bug.

## Workflow source of truth

For T2VA/I2VA/FL2VA:

- ignored private `*.api.json` files = complete operational graph topology/defaults;
- tracked `*.preset.json` files = UI-to-node binding contract.

For Ref2VA:

- tracked runtime workflow: `comfyui-harness/workflows/minimax-h3-reference.workflow.json`;
- private ignored source/master export: `minimax-h3-ref2v.api.json`;
- `scripts/build-ref-workflow.mjs` is used manually to sanitize/build the tracked reference workflow.

## Current limitations that are not bugs

- No runtime LLM / automatic Director prompt generation.
- No Save Project API/UI; private project files are read/reused only.
- No automatic ComfyUI startup by the harness.
- No multi-job management.
- Recovery is primarily single-running-job plus WebSocket/SSE, with read-only 4-second history polling as fallback.
- Persistent harness logging is implemented and activated at `comfyui-harness/logs/harness.log` (Git-ignored).
- Previously uploaded reference filenames remain valid only while their files remain in the active ComfyUI input directory.

The 2026-08-19 activation and browser smoke test passed, including correct `.mjs` JavaScript MIME serving and successful `recovery.mjs` import.

## Approved future direction

The user explicitly wants the harness and output quality to evolve without losing simplicity. The durable plan is in `docs/HARNESS_ROADMAP.md`.

Key goals:

1. keep a simple Basic UI for routine work;
2. add an expandable Advanced UI exposing more real ComfyUI controls only when they are valid workflow bindings;
3. improve H3 prompt quality systematically and preserve successful prompt strategies/experiment results in GitHub;
4. evaluate stronger or higher-quality compatible H3 models/checkpoints while preserving the current known-good baseline;
5. compare models/settings/prompts with controlled A/B experiments instead of changing many variables at once;
6. add Save/Update Project behavior for private local projects;
7. improve workflow/model registry metadata and validation;
8. consider an optional Director prompt-create/validate action later while keeping manual prompt passthrough.

Candidate Advanced controls include sampler, scheduler, guidance/CFG-equivalent controls, megapixels/resolution, denoise/strength, model-specific sampling parameters and conditioning controls — but only after inspecting the real active graph. Do not invent controls that are not connected to workflow inputs.

## Mandatory memory rule

Do not leave material implementation decisions or meaningful experiment conclusions only in chat/Cursor output.

After an approved harness change, prompt-strategy change, model-selection experiment, workflow change or important quality comparison, update the appropriate public text-only repository memory and `CHANGELOG.md` when material. Preserve privacy rules: do not commit media, model binaries, secrets, private absolute paths, private API workflow exports, private `.local.json` project data or personal reference filenames.

A change is not considered fully integrated if it exists only on the local machine or in a chat transcript.

## Repository/branch clarification

PR #1 and `agent/minimax-h3-comfyui-harness` are historical development lineage. PR #1 was merged successfully on 2026-08-19. `main` is now canonical for new work unless a new task-specific branch is intentionally created.

An accidental parallel implementation branch, `agent/minimax-h3-director-comfyui-harness`, was intentionally abandoned on 2026-08-19. PR #2 was closed without merge and that branch was deleted. Do not recreate or resume it.

## Last audit / validation result

On 2026-08-19 the harness received persistent logging and read-only history polling recovery. Pure Node tests passed 14/14 after implementation. The audit also verified that active preset bindings referenced valid workflow node/input pairs and that the currently referenced H3 model names were available to ComfyUI at runtime. The updated harness was then activated and passed a real browser smoke test before PR #1 was merged to `main`.

Treat this as a dated observation, not a permanent guarantee. Re-check live services, Git status, installed models and private workflow exports before future runtime/model changes.
