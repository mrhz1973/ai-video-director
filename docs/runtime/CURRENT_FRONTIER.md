# CURRENT_FRONTIER

Updated: 2026-08-26  
Scope: cross-track LIVE STATE only. No history. No per-shot or per-generation state.

## AUTHORITY

- Repo: `mrhz1973/ai-video-director`
- Branch: `main`
- Remote `main` HEAD at boot is authority. Do **not** persist the current SHA in this file.

## FOUNDATION

- `PROJECT_BRIEF.md`
- Issue #70 — one creative production project = maximum 1–3 short films
- `AGENTS.md`
- `decisions/ADR-004-public-repository-data-policy.md`

## WORKSTREAM

AI Video Director specialist operations

## BLOCK

Harness stabilization

## STATUS

IN_PROGRESS

## GATE

Follow the active specialist-lane gate in Workboard #75

## NEXT

Continue the active HARNESS_ENGINEERING lane (#73); creative lanes remain idle until explicitly activated

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

Lane ACTIVE items (#71, #72, #73, etc.) live **inside** the Workboard. They are not separate project-level ACTIVE WORK pointers.

## VERIFIED THROUGH

Harness #72 launcher health reuse implementation, controlled live acceptance, merge and deployment PASS; final deployment evidence persisted to main via PR #81; Workboard advanced to #73. No persisted main SHA.

## GLOBAL RUNTIME INVARIANTS

- Canonical Harness package: **v0.19.0**
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- ComfyUI lifecycle is external to the Director
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
