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

Harness idle after UI/UX v0.19.3 Wave 3 completion

## STATUS

IDLE

## GATE

#95 is complete and closed. PR #96 merged as release commit `01a4d907655a076c2357dd9690731a2d1ce8c484`; deployment evidence PASS is PR #96 comment `5431509478`. Production authority is v0.19.3 from the dedicated stable runtime pinned cleanly to that exact release SHA. Director v0.19.3 is healthy; UI `/api/health` `/api/config` are coherent; ComfyUI PID/lifecycle remained unchanged; final queue is 0/0; generation/upload/queue/GPU/project side effects were zero.

## NEXT

Await explicit activation of a new Harness lane or explicit creative/production activation. Open follow-ups #97 (permanent stable-runtime deployment/installer automation) and #89 (autonomous specialist intake contract) remain separate and are not auto-promoted. Generation remains separately gated by the project generation authorization contract.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is idle. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR are also idle unless separately activated in their own project context. #97 and #89 remain open follow-ups, not active lanes.

## VERIFIED THROUGH

#95 UI/UX Wave 3 is complete end-to-end and deployed as **v0.19.3**. Accepted PR head `43bd61d793404a56ea30d68ce284d42b5f454722` passed source review, npm 948/948, validator, exact-head CI #495 and Controlled UI Acceptance RETEST. PR #96 merged as `01a4d907655a076c2357dd9690731a2d1ce8c484`. Deployment evidence `5431509478` confirms the dedicated stable runtime advanced cleanly to that exact release SHA, Director restarted exact-PID to v0.19.3, Desktop remained bound to stable runtime, ComfyUI stayed on the same PID, final queue 0/0 and side effects zero.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.3**
- Production release SHA: `01a4d907655a076c2357dd9690731a2d1ce8c484`
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Release/deploy advances that dedicated runtime checkout to the exact authorized merged release SHA before Director restart
- Director restart is exact-PID only; no broad `node.exe` kill
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
