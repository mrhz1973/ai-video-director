# CURRENT_FRONTIER

Updated: 2026-08-28  
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

#97 — permanent stable-runtime / Windows launcher deployment automation — v0.19.5 post-deploy source correction

## STATUS

DEPLOY_GATE

## GATE

PR #99 merged successfully under explicit operator merge authorization from exact accepted head `322064e8847712bcd448849441808c2b860a3aeb`. Exact merged v0.19.5 release authority is `0617a68a8152bb073ace8ea51ac3375292779c11`; `comfyui-harness/package.json` at that SHA is version 0.19.5. Merge evidence is PR #99 comment `5454956303`. Controlled Acceptance rerun `5454841745` and orchestrator acceptance review `5454883926` are PASS. Production remains v0.19.4 at exact stable-runtime SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`. Deployment has not occurred and is separately gated.

## NEXT

Await explicit operator deployment authorization bound to exact release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. On authorization, use the permanent deployment entry point against only the dedicated stable runtime. Require clean detached runtime, exact release pin, package/UI/API 0.19.5 coherence, fresh exact Director PID/identity before stop, exact-PID Director restart only, ComfyUI healthy/reuse-only with same PID, queue 0/0 before and after, Desktop target/working directory unchanged, and prohibited side effects zero. Persist top-level deployment evidence and stop for orchestrator `agg`. Later docs/bookkeeping commits on `main` do not replace the exact merged release SHA as deployment authority.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #97 at `DEPLOY_GATE`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #97.

## VERIFIED THROUGH

Source re-review `5036205584` PASS; exact candidate CI #536 PASS; Controlled Acceptance rerun `5454841745` PASS; orchestrator acceptance review `5454883926` PASS; PR #99 merged to exact release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`, package 0.19.5. Production remains **v0.19.4** at exact stable-runtime SHA `4202dca9ab3b46f52983ca342732e59bfe38066f` until a separately authorized deployment completes.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.4**
- Production release SHA: `4202dca9ab3b46f52983ca342732e59bfe38066f`
- Authorized deployment candidate after separate gate: **v0.19.5** release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Installer/reinstaller must not infer production runtime from its own development checkout and must fail closed on invalid runtime authority
- Release/deploy advances only the dedicated stable runtime checkout to the exact authorized merged release SHA before Director restart
- Director restart is exact-PID only; no broad `node.exe` kill; exact PID/identity must be freshly revalidated immediately before stop
- ComfyUI lifecycle is external to the Director and deploy must never start/stop/restart it; same PID and idle queue must be freshly revalidated before Director stop/start
- Automated Harness tests must not spawn real Director/ComfyUI processes or mutate live runtime state
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
