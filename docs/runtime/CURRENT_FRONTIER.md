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

UI/UX v0.19.2 Wave 2 — controlled UI acceptance gate

## STATUS

WAITING_OPERATOR_AUTHORIZATION

## GATE

Exact reviewed PR #93 head `e8f169177ecb8e1be55a4c56092296ab3057d99c` passed source review `5033127331`, npm test 898/898, validator PASS, and exact-head CI. Controlled UI acceptance requires explicit operator authorization. Merge/deploy is a later separate explicit gate. No generation, upload, live queue mutation, GPU power change or ComfyUI restart is authorized.

## NEXT

After explicit operator authorization, perform controlled UI acceptance of Wave 2 `v0.19.2`: verify version coherence; contextual Inspector across SCENA/BATCH/CODA/OUTPUT; CODA display-only filters with recovery always reachable; OUTPUT gallery/list/filter/group/order and truthful live Inspector/archive/cloud state; BATCH shared input versus per-job override behavior; compact project strip; and Wave 1 tooltip/accessibility contract. Restore canonical Director afterward if a temporary PR-head Director restart is required. Do not generate or mutate queue/GPU state.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #92 and waiting for controlled UI acceptance authorization. Wave 3 remains operator-approved roadmap but inactive. #89 remains a separate reusable-framework follow-up.

## VERIFIED THROUGH

#88 UI/UX Wave 1 complete end-to-end and deployed. #92 PR #93 exact head `e8f169177ecb8e1be55a4c56092296ab3057d99c` is realigned with the reviewed main base, reports 898/898 tests + validator PASS, has green exact-head CI, and passed orchestrator review `5033127331`. Source blockers are cleared; controlled UI acceptance is the first remaining real gate.

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
