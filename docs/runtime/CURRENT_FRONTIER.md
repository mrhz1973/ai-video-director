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

#97 — v0.19.4 stable runtime checkout / Windows launcher deployment automation — deploy gate

## STATUS

DEPLOY_GATE

## GATE

PR #98 is merged as exact release commit `4202dca9ab3b46f52983ca342732e59bfe38066f`. The accepted PR head was `7df684192ebc59e8bc226b557118c8d925ba755c`, with final source review PASS `5035670154`, npm 993/993 PASS, validator PASS, exact-head CI #517 PASS and Controlled Acceptance PASS `5432335099`. Production remains v0.19.3 at exact deployed release SHA `01a4d907655a076c2357dd9690731a2d1ce8c484`. Deploy v0.19.4 requires separate explicit operator authorization.

## NEXT

Await explicit operator deploy authorization for v0.19.4 exact merged release SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`. Before deploy, reverify the dedicated stable runtime is clean/detached at v0.19.3, Director/ComfyUI identities and exact PIDs, queue 0/0 and Desktop stable-runtime target. Execute only the permanent #97 deployment path: fetch, verify exact authorized release object/version, detached checkout to the exact merge SHA, fresh pre-stop safety snapshot, exact-PID Director restart, strict ComfyUI reuse-only, post-deploy UI/API/runtime/Desktop/queue verification, then persist evidence. Never deploy a later docs-only main HEAD.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #97 at `DEPLOY_GATE`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #97.

## VERIFIED THROUGH

#95 UI/UX Wave 3 is complete end-to-end and deployed as **v0.19.3**. Deployment evidence PR #96 comment `5431509478` confirms the dedicated stable runtime advanced cleanly to exact release SHA `01a4d907655a076c2357dd9690731a2d1ce8c484`, Director restarted exact-PID to v0.19.3, Desktop remained bound to stable runtime, ComfyUI stayed on the same PID, final queue 0/0 and side effects zero. For #97, PR #98 has final source review PASS, Controlled Acceptance PASS and is merged as `4202dca9ab3b46f52983ca342732e59bfe38066f`; deployment is the only remaining gate.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.3**
- #97 target release: **v0.19.4**
- Authorized merged v0.19.4 release SHA for eventual deploy: `4202dca9ab3b46f52983ca342732e59bfe38066f`
- Production release SHA remains `01a4d907655a076c2357dd9690731a2d1ce8c484` until explicit deploy authorization and successful deploy
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
