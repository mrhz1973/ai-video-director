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

Post-Harness activation gate

## STATUS

WAITING

## GATE

Explicit activation of the next specialist lane. Creative/production work remains idle until explicitly activated; generation remains separately gated by the project generation authorization contract.

## NEXT

Await explicit creative/production activation for the post-Harness Phase 2 flow referenced by #58, or explicit activation of a specific Harness backlog issue.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

No specialist lane is currently ACTIVE. Lane state lives inside the Workboard.

## VERIFIED THROUGH

Harness #74 asset large-preview/lightbox implementation, tests, orchestrator review, controlled UI acceptance, merge and deployment PASS; final deployment evidence persisted to main via PR #85. HARNESS_ENGINEERING returned idle; older open Harness issues remain backlog only until explicitly activated. No persisted main SHA.

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
