# CURRENT_FRONTIER

Updated: 2026-08-27  
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

#97 — v0.19.4 stable runtime checkout / Windows launcher deployment automation — merge gate

## STATUS

MERGE_GATE

## GATE

PR #98 exact accepted head `7df684192ebc59e8bc226b557118c8d925ba755c` has final source review PASS `5035670154`, npm 993/993 PASS, validator PASS, exact-head CI #517 PASS, and Controlled Acceptance PASS persisted as PR comment `5432335099`. Acceptance confirms explicit stable-runtime validation, exact authorized release-SHA planning independent of newer main, candidate UI + `/api/health` + `/api/config` v0.19.4 PASS, strict external ComfyUI with same PID, queue 0/0, production v0.19.3 restored, stable runtime SHA unchanged and prohibited side effects zero/NO. Merge now requires explicit operator authorization. Deploy remains separately unauthorized.

## NEXT

Await explicit operator merge authorization for PR #98 exact head `7df684192ebc59e8bc226b557118c8d925ba755c`. Before merge reverify exact head, PR open/mergeable state, source review `5035670154`, acceptance evidence `5432335099`, and exact-head CI #517 PASS. If all still match, merge only. After merge, advance to a separate deploy gate and stop; do not automatically advance the dedicated stable runtime or restart production.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #97 at `MERGE_GATE`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #97.

## VERIFIED THROUGH

#95 UI/UX Wave 3 is complete end-to-end and deployed as **v0.19.3**. Deployment evidence PR #96 comment `5431509478` confirms the dedicated stable runtime advanced cleanly to exact release SHA `01a4d907655a076c2357dd9690731a2d1ce8c484`, Director restarted exact-PID to v0.19.3, Desktop remained bound to stable runtime, ComfyUI stayed on the same PID, final queue 0/0 and side effects zero. For #97, PR #98 now has final source review PASS and Controlled Acceptance PASS after validating the permanent stable-runtime/launcher/deployment contract without changing production authority.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.3**
- #97 target release: **v0.19.4**
- Production release SHA remains `01a4d907655a076c2357dd9690731a2d1ce8c484` until later explicit deploy authorization
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Installer/reinstaller must not infer production runtime from its own development checkout and must fail closed on invalid runtime authority
- Release/deploy advances only the dedicated stable runtime checkout to the exact authorized merged release SHA before Director restart
- Director restart is exact-PID only; no broad `node.exe` kill; exact PID/identity must be freshly revalidated immediately before stop
- ComfyUI lifecycle is external to the Director and deploy must never start/stop/restart it; same PID and idle queue must be freshly revalidated before Director stop/start
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
