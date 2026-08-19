# Start here

This is the entry point for every new chat or collaborator.

## What this project is

AI Video Director is the public, text-only control plane for reproducible AI-video work. It currently contains both the Rambo cinematic production state and the operational MiniMax H3 / ComfyUI harness documentation.

For the Rambo sequence, the active production work remains SEQ01 / SH010: a five-second, silent, single-take radio-hut shot.

For local MiniMax H3 work, the existing operational Node.js harness is documented in `docs/HARNESS_STATE.md`. Do not create a parallel harness.

## Read in this order

1. AGENTS.md
2. PROJECT_BRIEF.md
3. PROJECT_STATUS.md
4. HANDOFF.md
5. docs/HARNESS_STATE.md
6. docs/COMFYUI_H3_SETUP.md
7. CONTINUITY_BIBLE.md
8. shots/SEQ01/SH010/README.md
9. shots/SEQ01/SH010/G003/review.md
10. shots/SEQ01/SH010/G004/run.yaml
11. prompts/SEQ01/SH010/v04-prompt.md
12. registry/elements.yaml
13. docs/REFERENCE_ASSETS.md
14. docs/playbooks/INDEX.md

Read `story/SOURCE_MASTER.md`, `story/SHOT_LIST.yaml` and `story/AUDIO_PLAN.md` before planning later shots or final assembly.

If the task is specifically about the MiniMax H3 local harness, `docs/HARNESS_STATE.md` is the current architecture/status source of truth and `docs/COMFYUI_H3_SETUP.md` is the setup/operations guide. The harness is an existing Node.js application; it expects ComfyUI to be started separately.

## Required opening checkpoint

Before doing new work, state the relevant checkpoint instead of asking the user to repeat documented context.

For Rambo/Higgsfield production work, state:

- Project objective
- Current shot and status
- What is approved
- What is rejected
- Exact active Element
- Next action and whether authorization is still valid
- Any real unknowns

For MiniMax H3 harness work, state:

- Current harness branch and version
- What the harness already does
- What it deliberately does not do
- Workflow/source-of-truth files involved
- Whether the requested change touches runtime code, private local workflow exports or documentation only
- Whether a restart would be required
- Any real unknowns

## Copyable bootstrap request

Read `AGENTS.md` and follow its startup order. Resume the project from `HANDOFF.md`. For MiniMax H3 local work, also read `docs/HARNESS_STATE.md` and `docs/COMFYUI_H3_SETUP.md` before proposing changes. Confirm the current checkpoint first. Treat historical prompts and run folders as immutable evidence, use exact registered handles where required, do not recreate a parallel harness, and never commit media, private workflow exports, local paths or private identifiers because this repository is public.
