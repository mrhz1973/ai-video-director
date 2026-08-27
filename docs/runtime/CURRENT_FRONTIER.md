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

#97 — permanent stable-runtime / Windows launcher deployment automation — v0.19.5 post-deploy source correction

## STATUS

CORRECTIONS_REQUIRED

## GATE

Production deployment of v0.19.4 remains PASS and healthy at exact stable-runtime release SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`. PR #99 now persists the required `resolveDeps()` source correction for target v0.19.5 and exact current PR head `3509f9c4d54c3378a3cb2533b24ccf3feb0010b2` has npm 999/999 PASS, validator PASS and exact-head CI #531 PASS. Orchestrator source review `5036147953` nevertheless found a regression-isolation blocker: the new deployment integration test intentionally leaves `spawnFn` undefined, then executes a restart path in which the fixed resolver selects the real `spawnDetached()` implementation. Automated tests therefore can launch a real detached Director process instead of remaining fully mocked. The same test can also pass after an unrelated thrown error because it only rejects the original `spawnFn is not a function` message. Source approval is withheld until the regression is side-effect-free and assertive.

## NEXT

Correct PR #99 on the same branch. Preserve the `resolveDeps()` production fix. Replace/factor the deployment-shaped regression so the real `spawnFn: undefined` wiring semantics are verified without ever invoking real `spawnDetached()`, inject/capture a deterministic fake spawn at a safe boundary for integration behavior, require a successful non-null simulated deployment result with exactly one Director spawn and zero ComfyUI spawn, and reject unrelated errors. Correct stale `LAST_CURSOR_REPORT.md` PR_HEAD/CI metadata to the final exact head. Then rerun focused tests, full npm test, validator and exact-current-head CI; stop for orchestrator re-review. No live acceptance, merge or deployment is authorized.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #97 at `CORRECTIONS_REQUIRED`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #97.

## VERIFIED THROUGH

Production Harness is **v0.19.4** at exact stable-runtime release SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`. Deployment evidence PR #98 comment `5432521760` remains PASS for runtime/UI/API/Desktop/queue/ComfyUI invariants. The `resolveDeps()` source fix in PR #99 is directionally correct, but #97 remains incomplete until the v0.19.5 regression harness is fully side-effect-free, source-reviewed, accepted, merged and eventually released under separate gates.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.4**
- Production release SHA: `4202dca9ab3b46f52983ca342732e59bfe38066f`
- Active source correction target: **v0.19.5**
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
