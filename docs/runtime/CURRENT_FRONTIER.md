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

UI/UX v0.19.2 Wave 2 — merge/deploy execution

## STATUS

AUTHORIZED

## GATE

Merge + deploy of PR #93 / release `v0.19.2` is explicitly authorized. Before merge, re-check current `main` and PR mergeability and narrowly realign only docs/bookkeeping if required; accepted Wave 2 behavior must not drift. Generation, upload, live queue mutation, GPU power change, ComfyUI stop/start/restart, Wave 3 and unrelated fixes remain unauthorized.

## NEXT

Execute authorized merge + deploy: use current `main` as authority; if PR #93 is non-mergeable solely because `main` advanced with docs/bookkeeping, realign narrowly; rerun full tests + validator + CI; require accepted v0.19.2 code unchanged; merge PR #93; deploy merged main with Director-only exact-PID restart; verify UI `/api/health` `/api/config` all report `0.19.2` and representative Wave 2 smoke passes; preserve ComfyUI PID and final queue 0/0; persist deployment evidence. Do not generate.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #92 with merge + deploy authorized. Wave 3 remains operator-approved roadmap but inactive. #89 remains a separate reusable-framework follow-up.

## VERIFIED THROUGH

#88 UI/UX Wave 1 complete end-to-end and deployed. #92 PR #93 exact reviewed implementation head `e8f169177ecb8e1be55a4c56092296ab3057d99c` passed source review `5033127331`, npm test 898/898, validator, exact-head CI, and controlled UI acceptance. Acceptance evidence is persisted on PR #93 and branch report tip `71bd9e7aba9dde26532097d820496866cac59b7f`; commits after the tested implementation head are acceptance/report bookkeeping only, and exact-tip CI run 460 passed. Canonical Director was restored to main `922b9e8b2f9b3222d5466f1845fdd274c92771ad` at v0.19.0; ComfyUI same PID; final queue 0/0; generation/upload/queue/GPU/project persistent mutation all zero/NO. Operator subsequently authorized merge + deploy for #92.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness package before Wave 2: **v0.19.0**
- Wave 2 target release: **v0.19.2**
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
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
