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

#97 — v0.19.4 stable runtime checkout / Windows launcher deployment automation

## STATUS

IMPLEMENTATION

## GATE

Operator explicitly continued after #95 completion, promoting #97 as the next HARNESS_ENGINEERING lane. Production authority remains v0.19.3 at exact release SHA `01a4d907655a076c2357dd9690731a2d1ce8c484`. #97 implementation is isolated source/test work only: no live runtime advancement, real Desktop shortcut rewrite, Director/ComfyUI restart, generation/upload/queue/GPU/project mutation, merge or deploy is authorized.

## NEXT

Implement issue #97 with target v0.19.4 in an isolated branch/worktree. Make stable runtime root explicit and fail-closed for installer/reinstaller; add reusable runtime-checkout validation and an exact-release-SHA Windows deployment operation; prevent any development checkout from silently becoming the Desktop production target; preserve launcher version-aware fail-closed behavior, same-version idempotent reuse, exact-PID Director semantics and external ComfyUI ownership; add deterministic tests; run full `npm test`, `python scripts/validate_project.py`, exact-head CI, persist `docs/runtime/LAST_CURSOR_REPORT.md`, open one PR and stop for orchestrator source review.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #97. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #97.

## VERIFIED THROUGH

#95 UI/UX Wave 3 is complete end-to-end and deployed as **v0.19.3**. Deployment evidence PR #96 comment `5431509478` confirms the dedicated stable runtime advanced cleanly to exact release SHA `01a4d907655a076c2357dd9690731a2d1ce8c484`, Director restarted exact-PID to v0.19.3, Desktop remained bound to stable runtime, ComfyUI stayed on the same PID, final queue 0/0 and side effects zero. That manually proven invariant is the behavioral baseline #97 must encode permanently.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.3**
- #97 target release: **v0.19.4**
- Production release SHA remains `01a4d907655a076c2357dd9690731a2d1ce8c484` until later explicit release gates
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Installer/reinstaller must not infer production runtime from its own development checkout
- Release/deploy advances only the dedicated stable runtime checkout to the exact authorized merged release SHA before Director restart
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
