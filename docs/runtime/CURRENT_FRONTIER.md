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

UI/UX v0.19.2 Wave 2 — merge/deploy gate

## STATUS

WAITING_OPERATOR_AUTHORIZATION

## GATE

PR #93 source review, tests, validator, exact-head CI and controlled UI acceptance are PASS. Merge + deploy requires separate explicit operator authorization. Generation remains unauthorized. ComfyUI stop/start/restart remains unauthorized. No Wave 3 work is authorized.

## NEXT

After explicit merge + deploy authorization: re-check current `main` and PR #93 mergeability; if needed, narrowly realign only docs/bookkeeping while preserving the accepted implementation; rerun required validation/CI; merge PR #93; deploy merged `v0.19.2` with Director-only restart; verify UI `/api/health` `/api/config` version coherence and representative Wave 2 smoke; preserve ComfyUI PID and final queue 0/0; persist deployment evidence. Do not generate.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #92 and waiting for explicit merge + deploy authorization. Wave 3 remains operator-approved roadmap but inactive. #89 remains a separate reusable-framework follow-up.

## VERIFIED THROUGH

#88 UI/UX Wave 1 complete end-to-end and deployed. #92 PR #93 exact reviewed implementation head `e8f169177ecb8e1be55a4c56092296ab3057d99c` passed source review `5033127331`, npm test 898/898, validator, exact-head CI, and controlled UI acceptance. Acceptance evidence is persisted on PR #93 and branch report tip `71bd9e7aba9dde26532097d820496866cac59b7f`; commits after the tested implementation head are acceptance/report bookkeeping only, and exact-tip CI run 460 passed. Canonical Director was restored to main `922b9e8b2f9b3222d5466f1845fdd274c92771ad` at v0.19.0; ComfyUI same PID; final queue 0/0; generation/upload/queue/GPU/project persistent mutation all zero/NO.

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
