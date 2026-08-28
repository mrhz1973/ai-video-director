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

MERGE_GATE

## GATE

Controlled Acceptance v0.19.5 rerun on exact PR #99 head `322064e8847712bcd448849441808c2b860a3aeb` is PASS (`5454841745`) and orchestrator acceptance review `5454883926` is ACCEPTANCE_PASS. Live proof exercised deployment-shaped `spawnFn` omitted/undefined, resolved the real default `spawnDetached`, successfully started candidate Director v0.19.5, and did not reproduce `spawnFn is not a function`. Production was then fully restored to v0.19.4 at exact stable-runtime SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`; ComfyUI PID remained invariant, queue remained 0/0, Desktop unchanged and prohibited side effects were zero/NO. PR #99 remains on the exact accepted head and GitHub currently reports mergeable/rebaseable with mergeable_state clean. Merge and deploy remain separately gated.

## NEXT

Await explicit operator merge authorization bound to exact PR #99 head `322064e8847712bcd448849441808c2b860a3aeb`. On authorization, freshly reverify the exact PR head and mergeability before merging. After merge, determine and persist the exact merged v0.19.5 release SHA, then stop at a separate explicit deployment gate. Production v0.19.4 remains the stable authority until separately authorized deployment completes.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #97 at `MERGE_GATE`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #97.

## VERIFIED THROUGH

Production Harness is **v0.19.4** at exact stable-runtime release SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`. PR #99 source re-review `5036205584` is PASS; exact candidate head `322064e8847712bcd448849441808c2b860a3aeb` has CI #536 PASS; Controlled Acceptance rerun `5454841745` is PASS; orchestrator acceptance review `5454883926` is PASS. #97 remains incomplete until explicit merge and separate deployment complete.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.4**
- Production release SHA: `4202dca9ab3b46f52983ca342732e59bfe38066f`
- Active correction target: **v0.19.5**
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
