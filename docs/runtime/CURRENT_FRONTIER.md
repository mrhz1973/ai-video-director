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

ACCEPTANCE_GATE

## GATE

PR #99 source re-review PASS `5036205584` remains valid. The functional/test source head is `d4f85e203da77c653ae21f2453aa6dc30b38eca4`. Current exact PR head is now `322064e8847712bcd448849441808c2b860a3aeb`, which is docs/evidence-only and changes only `docs/runtime/LAST_CURSOR_REPORT.md` to replace the SOURCE_HEAD placeholder with the exact functional commit; no source/test behavior changed. Exact-current-head GitHub Actions run #536 is PASS. The operator authorization naming prior head `a56d66e5257d6dc1354a1e6b31dea0f004e8b68f` is classified `AUTHORIZATION_HEAD_STALE` and was not executed; evidence is PR #99 comment `5432824972`. Production remains healthy at v0.19.4 on exact stable-runtime release SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`. Merge and deploy are not authorized.

## NEXT

Await refreshed explicit operator authorization for Controlled Acceptance v0.19.5 on exact PR #99 head `322064e8847712bcd448849441808c2b860a3aeb`. No additional source review is required unless source/test behavior changes. Acceptance should validate the corrected permanent deployment dependency-resolution path and package/UI/API v0.19.5 coherence under controlled reversible conditions, while preserving production v0.19.4 as the stable authority. No merge/deploy follows without separate gates.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #97 at `ACCEPTANCE_GATE`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #97.

## VERIFIED THROUGH

Production Harness is **v0.19.4** at exact stable-runtime release SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`. Deployment evidence PR #98 comment `5432521760` remains PASS for runtime/UI/API/Desktop/queue/ComfyUI invariants. PR #99 persists the v0.19.5 `resolveDeps()` correction and side-effect-free regressions; source re-review is PASS. #97 remains incomplete until Controlled Acceptance, merge and deployment of the corrected source complete under separate gates.

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
