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

UI/UX v0.19.3 Wave 3 — browser ESM boundary correction after blocked acceptance

## STATUS

CORRECTIONS_REQUIRED

## GATE

Controlled UI Acceptance of PR #96 exact head `4c98d27b6acba81d1f18c30eccad473a0ff7d7bf` executed under operator authorization and returned `BLOCKED` (evidence PR comment `5430836683`). Candidate `/api/health` and `/api/config` were 0.19.3, but browser `app.js` did not boot because `/lib/h3-model-registry.mjs` imports `../public/output-naming.mjs`; in browser URL space this becomes `/public/output-naming.mjs`, which the Harness static server does not serve. Source confirmation is recorded in orchestrator review `5034892150`. Acceptance restored the stable Director to v0.19.2; ComfyUI PID remained unchanged; queue finished 0/0; generation/upload/queue/GPU/project mutations remained zero/NO.

## NEXT

Correct the SAME PR #96/branch without runtime touch: remove the `lib -> public` dependency while preserving model-label behavior and the one-way shared-module boundary (`public -> lib` allowed; shared lib must not depend on UI-public modules). Add deterministic browser-static import-graph coverage that fails on the blocked head and proves every browser-reachable dependency resolves to a served route. Rerun full npm tests, validator, exact-head CI, update LAST_CURSOR_REPORT, then stop for source re-review. A corrected PR head requires fresh Controlled UI Acceptance authorization after source review PASS.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING remains ACTIVE on #95 / PR #96 in correction state after blocked Controlled UI Acceptance. Issue #97 separately tracks the permanent stable-runtime checkout/Windows launcher deployment contract and does not broaden this correction. #89 remains a separate reusable-framework follow-up. Creative production lanes remain inactive unless separately activated.

## VERIFIED THROUGH

#92 UI/UX Wave 2 remains complete end-to-end and deployed as `v0.19.2`. For #95, source-level Wave 3 requirements had passed through exact head `4c98d27...` with npm 944/944 PASS, validator PASS and CI #488 PASS, but runtime acceptance exposed an untested browser ESM path defect before UI boot. The acceptance safely restored v0.19.2 from the dedicated stable runtime; ComfyUI remained untouched and queue 0/0. No merge/deploy is authorized.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline before Wave 3: **v0.19.2**
- Wave 3 target release remains **v0.19.3**; this correction does not bump again because v0.19.3 is unreleased
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Controlled acceptance must restore the deployed stable-runtime Director after temporary candidate serving
- Eventual deploy advances that stable runtime checkout to the exact authorized merged release SHA before Director restart
- ComfyUI lifecycle is external to the Director
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
