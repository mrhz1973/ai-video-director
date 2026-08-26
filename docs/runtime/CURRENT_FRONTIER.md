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

UI/UX v0.19.3 Wave 3 — source-review corrections

## STATUS

CORRECTIONS_REQUIRED

## GATE

PR #96 first implementation candidate passed npm test 924/924, validator and exact-head CI, but orchestrator source review on exact head `6a73972088f0d87eefdbd36e83f02866d9ba12d0` found two blockers: zero-available-model selection does not yet fail safe, and the CSS work adds new overlay layers without materially reducing historical cascade/override duplication as required by #95. Corrections remain isolated; runtime activation, controlled live/UI acceptance, merge and deploy are not authorized. Generation, upload, live queue mutation, GPU power change and Director/ComfyUI restart remain unauthorized.

## NEXT

Correct PR #96 on the same branch: make discovery-success/all-models-missing a truthful non-selectable state that blocks Single Render/Batch readiness; add the missing behavioral model-registry regressions; perform measured narrow CSS/cascade consolidation with before/after evidence while preserving Wave 1/2 geometry and visual language; rerun full tests + validator + exact-head CI; update `LAST_CURSOR_REPORT`; stop for orchestrator re-review.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING remains ACTIVE on #95 / PR #96 with corrections required. Issue #97 separately tracks the permanent stable-runtime checkout/Windows launcher deployment contract and does not broaden PR #96. #89 remains a separate reusable-framework follow-up. Creative production lanes remain inactive unless separately activated.

## VERIFIED THROUGH

#92 UI/UX Wave 2 is complete end-to-end and deployed as `v0.19.2`. #95 first implementation candidate on PR #96 reached exact head `6a73972088f0d87eefdbd36e83f02866d9ba12d0`, npm test 924/924 PASS, validator PASS and CI run #476 PASS with runtime untouched. Orchestrator review `5034021270` requires corrections before controlled acceptance. During operator launcher verification, a stale development checkout was found as the Desktop launch target; a dedicated stable runtime checkout was established locally and issue #97 now makes that separation a permanent deployment invariant. Eventual #95 deployment must advance the dedicated runtime checkout to the exact authorized merged release SHA before Director restart.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline before Wave 3: **v0.19.2**
- Wave 3 target release: **v0.19.3**
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- ComfyUI lifecycle is external to the Director
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
