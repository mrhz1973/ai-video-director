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

HARNESS_ENGINEERING idle after UI/UX v0.19.2 Wave 2

## STATUS

IDLE

## GATE

Explicit activation is required before starting another Harness lane. Generation remains separately gated by the project generation authorization phrase. ComfyUI lifecycle remains external to the Director. Wave 3 remains inactive until explicitly activated.

## NEXT

Await explicit operator/orchestrator activation of another Harness issue/lane. Do not auto-promote Wave 3, #89, older Harness backlog, or creative production work.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is IDLE. Wave 3 remains operator-approved roadmap but inactive. #89 remains a separate reusable-framework follow-up. Creative lanes remain governed by their own explicit activation gates.

## VERIFIED THROUGH

#88 UI/UX Wave 1 complete end-to-end and deployed. #92 UI/UX Wave 2 `v0.19.2` complete end-to-end: PR #93 merged at `79c73c0e6f8c2a491a2903b850ff5f6142a7aa16`; authorized Director-only deployment PASS; final deployment evidence persisted via PR #94 and merged to main at `8a1c9a57a5b0bbf916dbf1730325769f1d4d6d94`. Final evidence reports npm test 898/898 PASS, validator PASS, CI PASS, Wave 2 smoke PASS, UI `/api/health` `/api/config` all `0.19.2`, Director restart exact-PID only, ComfyUI restart NO / same PID YES, queue preflight and final 0/0, generation/upload/queue/GPU/project persistent mutation all zero/NO. Issue #92 is closed completed.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness package: **v0.19.2**
- Next functional/UI release must advance beyond **v0.19.2**
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
