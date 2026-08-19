# Start here

This is the entry point for every new chat or collaborator.

## What this project is

AI Video Director is the public, text-only control plane for reproducible AI-video work. It currently contains both the Rambo cinematic production state and the operational MiniMax H3 / ComfyUI harness documentation.

For the Rambo sequence, the active production work remains SEQ01 / SH010: a five-second, silent, single-take radio-hut shot.

For local MiniMax H3 work, the existing operational Node.js harness is documented in `docs/HARNESS_STATE.md`. The approved future direction is documented in `docs/HARNESS_ROADMAP.md`. Do not create a parallel harness.

## Canonical repository state

As of 2026-08-19, PR #1 (`agent/minimax-h3-comfyui-harness`) has been merged successfully into `main` after repository validation, 14/14 Node tests, GitHub Actions validation, controlled local activation and a real browser smoke test. `main` is now the canonical source for the MiniMax H3 Director, operational Node.js harness and its project-memory documentation.

The old development branch name may still appear in historical notes or immutable PR records; treat those as lineage, not as the current canonical branch. New work should start from `main` unless a fresh task-specific branch is intentionally created.

GitHub is also the durable memory for future H3 development. Material prompt strategies, harness behavior changes, model/checkpoint experiments, workflow decisions and validation results must be recorded in the repository rather than existing only in chat history. Because the repository is public, keep media, model binaries, secrets, private paths, private workflow exports and private local project data out of Git.

## Read in this order

1. AGENTS.md
2. PROJECT_BRIEF.md
3. PROJECT_STATUS.md
4. HANDOFF.md
5. docs/HARNESS_STATE.md
6. docs/HARNESS_ROADMAP.md
7. docs/COMFYUI_H3_SETUP.md
8. CONTINUITY_BIBLE.md
9. shots/SEQ01/SH010/README.md
10. shots/SEQ01/SH010/G003/review.md
11. shots/SEQ01/SH010/G004/run.yaml
12. prompts/SEQ01/SH010/v04-prompt.md
13. registry/elements.yaml
14. docs/REFERENCE_ASSETS.md
15. docs/playbooks/INDEX.md

Read `story/SOURCE_MASTER.md`, `story/SHOT_LIST.yaml` and `story/AUDIO_PLAN.md` before planning later shots or final assembly.

If the task is specifically about the MiniMax H3 local harness, `docs/HARNESS_STATE.md` is the current architecture/status source of truth, `docs/HARNESS_ROADMAP.md` records approved future direction, and `docs/COMFYUI_H3_SETUP.md` is the setup/operations guide. The harness is an existing Node.js application; it expects ComfyUI to be started separately.

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

- Current canonical branch and harness version
- What the harness already does
- What it deliberately does not do
- Relevant roadmap item
- Workflow/source-of-truth files involved
- Whether the requested change touches runtime code, private local workflow exports or documentation only
- Whether a restart would be required
- Any real unknowns

## Copyable bootstrap request

Read `AGENTS.md` and follow its startup order. Resume the project from `HANDOFF.md`. For MiniMax H3 local work, also read `docs/HARNESS_STATE.md`, `docs/HARNESS_ROADMAP.md` and `docs/COMFYUI_H3_SETUP.md` before proposing changes. Confirm the current checkpoint first. Treat `main` as the canonical repository state after the 2026-08-19 PR #1 merge. Preserve the known-good harness/model baseline while testing prompt/model/advanced-control improvements, and record material approved changes and experiment conclusions back into GitHub. Treat historical prompts and run folders as immutable evidence, use exact registered handles where required, do not recreate a parallel harness, and never commit media, model binaries, private workflow exports, local paths or private identifiers because this repository is public.
