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

UI/UX v0.19.3 Wave 3 — structural polish, design system and model registry

## STATUS

ACTIVE

## GATE

Issue #95 is explicitly activated for isolated implementation/test/CI/review only. Runtime activation, controlled live/UI acceptance, merge and deploy remain later separate gates. Generation, upload, live queue mutation, GPU power change, Director/ComfyUI restart, creative work and #89 are not authorized by this activation.

## NEXT

Implement #95 from current canonical `main` in an isolated branch/worktree: consolidate legacy CSS into a coherent design system; standardize buttons/badges/spacing/type/state surfaces; implement authoritative friendly validated model registry/discovery while reconciling #6; make an evidence-based decision on the optional unified SYSTEM panel; reconcile legacy #46/#15/#7/#6/#4 after the final Wave 3 state. Target release `v0.19.3`; preserve all Wave 1/2 contracts; run full tests + validator + CI and persist `LAST_CURSOR_REPORT`; stop for orchestrator review. Do not touch runtime.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #95 / Wave 3 target `v0.19.3`. #89 remains a separate reusable-framework follow-up. Creative production lanes remain inactive unless separately activated.

## VERIFIED THROUGH

#92 UI/UX Wave 2 is complete end-to-end and deployed as `v0.19.2`: PR #93 merged; authorized Director-only deployment PASS; deployment evidence persisted via PR #94 and merged to main. UI/API version coherence PASS; tests 898/898; validator PASS; CI PASS; Wave 2 smoke PASS; ComfyUI unchanged; queue preflight/final 0/0; generation/upload/queue/GPU/project persistent mutation zero/NO. Issue #95 now activates the operator-approved Wave 3 roadmap from audit #86.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline before Wave 3: **v0.19.2**
- Wave 3 target release: **v0.19.3**
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
