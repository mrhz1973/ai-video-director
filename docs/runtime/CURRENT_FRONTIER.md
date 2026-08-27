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

#97 — permanent stable-runtime / Windows launcher deployment automation — post-deploy source correction

## STATUS

CORRECTIONS_REQUIRED

## GATE

Runtime deployment of v0.19.4 is PASS. PR #98 deployment evidence `5432521760` confirms production is healthy at exact stable-runtime release SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`: runtime clean/detached, package/UI/API v0.19.4, Director exact-PID restart, same ComfyUI PID, queue 0/0, Desktop unchanged and prohibited side effects zero/NO. However the first real execution of the merged permanent #97 deployment path failed with `spawnFn is not a function`; a local `resolveDeps` hotfix enabled the successful second execution but that source correction is not persisted on GitHub. Current `main` still has defaults followed by `...deps` in `launcher-cli.mjs::resolveDeps()`. Classification: `DEPLOY_PASS / SOURCE_HOTFIX_NOT_PERSISTED`.

## NEXT

Keep production v0.19.4 running; do not rollback. Persist the smallest source correction for `resolveDeps` so undefined dependency properties cannot overwrite working defaults, and add a deterministic regression reproducing the real deployment failure (`spawnFn: undefined`). Because v0.19.4 is already released and this is a functional launcher/deployment source change, the next source release identity is v0.19.5. Implementation/testing only in an isolated branch/PR; no live runtime, Desktop, Director, ComfyUI, queue, generation, GPU or project mutation. Stop for orchestrator source review after tests/validator/exact-head CI PASS.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #97 at `CORRECTIONS_REQUIRED`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #97.

## VERIFIED THROUGH

Production Harness is **v0.19.4** at exact stable-runtime release SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`. Deployment evidence PR #98 comment `5432521760` is PASS for runtime/UI/API/Desktop/queue/ComfyUI invariants. #97 is not yet complete only because the local source hotfix required to make the permanent deployment operation succeed has not been persisted to GitHub.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.4**
- Production release SHA: `4202dca9ab3b46f52983ca342732e59bfe38066f`
- Next source correction target: **v0.19.5**
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
