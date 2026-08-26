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

#97 — v0.19.4 stable runtime checkout / Windows launcher deployment automation — Controlled Acceptance authorized

## STATUS

ACCEPTANCE_AUTHORIZED

## GATE

Controlled Acceptance is explicitly authorized for PR #98 exact head `7df684192ebc59e8bc226b557118c8d925ba755c` by operator authorization persisted as PR comment `5432231886`. Final source review `5035670154` is PASS; npm 993/993 PASS, validator PASS and exact-current-head CI #517 PASS. Acceptance only is authorized. Merge and deploy remain unauthorized. Production authority remains v0.19.3 at exact release SHA `01a4d907655a076c2357dd9690731a2d1ce8c484`.

## NEXT

Execute Controlled Acceptance v0.19.4 on exact authorized PR head `7df684192ebc59e8bc226b557118c8d925ba755c`. Begin with real read-only/plan-only checks of explicit stable RuntimeRoot, clean detached runtime authority, Desktop target, exact authorized release-SHA planning independent of newer main, strict external ComfyUI, queue-idle and fresh pre-stop fail-closed guards. If a temporary candidate Director/runtime exercise is required, it must be acceptance-scoped and reversible, use exact-PID Director handling only, never start/stop/restart ComfyUI, and restore production v0.19.3 afterward. Persist top-level PR acceptance evidence and stop for merge gate only if PASS.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #97 at `ACCEPTANCE_AUTHORIZED`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #97.

## VERIFIED THROUGH

#95 UI/UX Wave 3 is complete end-to-end and deployed as **v0.19.3**. Deployment evidence PR #96 comment `5431509478` confirms the dedicated stable runtime advanced cleanly to exact release SHA `01a4d907655a076c2357dd9690731a2d1ce8c484`, Director restarted exact-PID to v0.19.3, Desktop remained bound to stable runtime, ComfyUI stayed on the same PID, final queue 0/0 and side effects zero. For #97, PR #98 has final source review PASS after resolving explicit runtime authority, installer fail-closed validation, exact release-SHA deployment planning, strict external-Comfy behavior, complete post-deploy verification and the final fresh pre-stop PID/queue race guard.

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
