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

#97 — v0.19.4 stable runtime checkout / Windows launcher deployment automation — final pre-stop race correction

## STATUS

CORRECTIONS_REQUIRED

## GATE

PR #98 current exact head `de79e757c253f6175bfc955f3230d07072852f71` reports npm 987/987 PASS, validator PASS, exact-current-head CI #514 PASS and production runtime untouched. Orchestrator re-review `5035610185` confirms the previous source blockers are resolved except one stale-state race before the destructive Director stop. Controlled Acceptance, merge and deploy remain unauthorized. Production authority remains v0.19.3 at exact release SHA `01a4d907655a076c2357dd9690731a2d1ce8c484`.

## NEXT

Correct PR #98 on the same branch. After release fetch/verification and any detached checkout, immediately before any Director stop/start perform a fresh safety guard: Director port inspection/identity must still be unambiguous and, when preflight recorded a Director PID, it must be the same exact PID; ComfyUI must still be healthy/unambiguous on the same exact PID; queue must still be 0 running / 0 pending. If any state changed, fail closed before `stopProcessFn`. Add regressions proving Director PID change/reuse, Comfy disappearance/PID change and queue becoming busy after preflight all produce `stopProcessFn=0`, and make post-deploy verification reject ambiguous Director port inspection/no PID. Rerun full `npm test`, `python scripts/validate_project.py`, exact-head CI, update `docs/runtime/LAST_CURSOR_REPORT.md`, then stop for source re-review.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #97 with `CORRECTIONS_REQUIRED`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #97.

## VERIFIED THROUGH

#95 UI/UX Wave 3 is complete end-to-end and deployed as **v0.19.3**. Deployment evidence PR #96 comment `5431509478` confirms the dedicated stable runtime advanced cleanly to exact release SHA `01a4d907655a076c2357dd9690731a2d1ce8c484`, Director restarted exact-PID to v0.19.3, Desktop remained bound to stable runtime, ComfyUI stayed on the same PID, final queue 0/0 and side effects zero. For #97, PR #98 now resolves fetch ordering, stable runtime authority, installer fail-closed validation, strict external-Comfy deployment and post-deploy checks; only the fresh pre-stop race guard remains before controlled acceptance.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.3**
- #97 target release: **v0.19.4**
- Production release SHA remains `01a4d907655a076c2357dd9690731a2d1ce8c484` until later explicit release gates
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
