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

UI/UX v0.19.2 Wave 2 — focused second orchestrator correction pass

## STATUS

BLOCKED

## GATE

PR #93 must correct exact-head orchestrator re-review `5032896689`, rerun full tests + validator, reach green CI, and pass exact-head orchestrator re-review. Controlled UI acceptance is a later separate gate. Merge/deploy is a later separate explicit gate. No generation, upload, live queue mutation, GPU power change, Director restart or ComfyUI restart is authorized.

## NEXT

Correct issue #92 on the same isolated PR #93 branch without Wave 3 scope: keep OUTPUT Inspector truthful/live (do not label the first filtered clip as current without real selection; refresh Inspector when archive/cloud config changes), and add deterministic integration-level regressions for non-firstImage Batch override UI refresh and restored CODA-filter recovery reconciliation. Preserve target `v0.19.2`, Wave 1 tooltip/accessibility contract, compact project strip, and all already-passing Wave 2 work.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #92 and blocked in orchestrator re-review on PR #93. Wave 3 remains operator-approved roadmap but inactive. #89 remains a separate reusable-framework follow-up.

## VERIFIED THROUGH

#88 UI/UX Wave 1 complete end-to-end and deployed. #92 PR #93 correction head `ac8582b62df075d0fd310d8dcc53b3de09d7f1c9` is realigned with main, reports 896/896 tests + validator PASS, and has green CI. Original Wave 2 blockers for numeric OUTPUT ordering, all-role BATCH refresh, and recovery visibility are corrected. Exact-head re-review `5032896689` still blocks controlled UI acceptance because OUTPUT Inspector can invent/stale current/config state and two required integration regressions are not yet exercised.

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
