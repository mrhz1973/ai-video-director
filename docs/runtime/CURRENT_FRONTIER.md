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

UI/UX v0.19.2 Wave 2 — workflow usability and scalable operator views

## STATUS

IN_PROGRESS

## GATE

Isolated implementation/tests + validator + CI + orchestrator review. Controlled UI acceptance is a later separate gate. Merge/deploy is a later separate explicit gate. No generation, upload, live queue mutation, GPU power change or ComfyUI restart is authorized.

## NEXT

Implement issue #92 only: contextual Inspector by active workspace; CODA filters and compact terminal history; OUTPUT compact/gallery views with authoritative filtering/grouping/ordering; clearer BATCH summaries and shared-input vs per-job override state; compact project strip; preserve Wave 1 global tooltip/accessibility contract. Release target is `v0.19.2` with package/UI/API version coherence and regression protection.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #92. Wave 3 remains operator-approved roadmap but inactive. #89 remains a separate reusable-framework follow-up.

## VERIFIED THROUGH

#88 UI/UX Wave 1 complete end-to-end and deployed: implementation/tests/review/controlled UI acceptance/merge/deploy PASS; deployment evidence persisted via PR #91. Harness release before Wave 2 remains `v0.19.0`; Wave 2 must release as `v0.19.2` and future functional/UI releases must advance the version again. Docs/evidence-only bookkeeping commits are exempt.

## GLOBAL RUNTIME INVARIANTS

- Canonical Harness package before Wave 2: **v0.19.0**
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
