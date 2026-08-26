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

#97 — v0.19.4 stable runtime checkout / Windows launcher deployment automation — source-review corrections

## STATUS

CORRECTIONS_REQUIRED

## GATE

Initial PR #98 candidate at exact head `fc57d433030e7cba4dcf9f809223cca81a775311` reports npm 972/972 PASS, validator PASS, exact-head CI #507 PASS and production runtime untouched. Orchestrator source review `5035496812` found deploy-safety blockers, so Controlled Acceptance, merge and deploy are not authorized. Production authority remains v0.19.3 at exact release SHA `01a4d907655a076c2357dd9690731a2d1ce8c484`.

## NEXT

Correct PR #98 on the same branch. Required: fetch origin before verifying a newly authorized release object/version in the real deploy path; enforce unambiguous Director and ComfyUI ownership before any stop/start and make deployment incapable of spawning/restarting ComfyUI; make post-deploy verification fail closed on unchanged ComfyUI PID, final queue 0/0, Desktop stable-runtime target and UI + `/api/health` + `/api/config` version coherence, with actual shortcut reading wired into the real CLI; make installer `-RuntimeRoot` validation require a clean detached stable runtime and reject empty roots instead of resolving them to cwd. Add behavioral regressions, rerun full `npm test`, `python scripts/validate_project.py`, exact-head CI, update `docs/runtime/LAST_CURSOR_REPORT.md` to the new exact PR head, then stop for source re-review.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #97 with `CORRECTIONS_REQUIRED`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #97.

## VERIFIED THROUGH

#95 UI/UX Wave 3 is complete end-to-end and deployed as **v0.19.3**. Deployment evidence PR #96 comment `5431509478` confirms the dedicated stable runtime advanced cleanly to exact release SHA `01a4d907655a076c2357dd9690731a2d1ce8c484`, Director restarted exact-PID to v0.19.3, Desktop remained bound to stable runtime, ComfyUI stayed on the same PID, final queue 0/0 and side effects zero. For #97, initial PR #98 automated validation is green but source review requires the deploy-safety corrections recorded above before controlled acceptance.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.3**
- #97 target release: **v0.19.4**
- Production release SHA remains `01a4d907655a076c2357dd9690731a2d1ce8c484` until later explicit release gates
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Installer/reinstaller must not infer production runtime from its own development checkout and must fail closed on invalid runtime authority
- Release/deploy advances only the dedicated stable runtime checkout to the exact authorized merged release SHA before Director restart
- Director restart is exact-PID only; no broad `node.exe` kill
- ComfyUI lifecycle is external to the Director and deploy must never start/stop/restart it
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
