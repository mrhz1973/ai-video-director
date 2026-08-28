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

ACCEPTANCE_BLOCKED_RUNTIME_OFFLINE

## GATE

Controlled Acceptance evidence PR #99 comment `5454672422` is BLOCKED at preflight. Candidate exact head `322064e8847712bcd448849441808c2b860a3aeb`, package 0.19.5 and clean candidate checkout passed preflight, but production Director on 8787 and ComfyUI on 8188 were both not listening. Therefore exact Director/ComfyUI PID verification and queue 0/0 verification were impossible, and the corrected live `spawnFn: undefined -> spawnDetached` path was not exercised. No candidate was started and no runtime/ComfyUI/Desktop/queue/generation/GPU/project mutation occurred. Production stable runtime remains clean/detached at exact SHA `4202dca9ab3b46f52983ca342732e59bfe38066f` / v0.19.4.

## NEXT

Restore normal availability of the existing production services at unchanged v0.19.4 stable runtime SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`: Director on 8787 and existing ComfyUI on 8188 with idle queue. Do not deploy or advance the stable runtime. Then rerun Controlled Acceptance against exact PR #99 head `322064e8847712bcd448849441808c2b860a3aeb` if that remains current. Merge and deploy remain separately gated.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #97 at `ACCEPTANCE_BLOCKED_RUNTIME_OFFLINE`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #97.

## VERIFIED THROUGH

Production stable runtime is **v0.19.4** at exact SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`. PR #99 persists the v0.19.5 `resolveDeps()` correction and side-effect-free regressions; source re-review `5036205584` is PASS; exact candidate head `322064e8847712bcd448849441808c2b860a3aeb` has CI #536 PASS. Controlled Acceptance was attempted under authorization comment `5454521736` but stopped safely at preflight because both production services were offline. No acceptance PASS exists yet.

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
