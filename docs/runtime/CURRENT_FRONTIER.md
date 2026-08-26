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

UI/UX v0.19.3 Wave 3 — corrected Controlled UI Acceptance authorized

## STATUS

ACCEPTANCE_AUTHORIZED

## GATE

PR #96 corrected candidate at exact head `43bd61d793404a56ea30d68ce284d42b5f454722` has source re-review PASS (`5035113265`), npm test 948/948 PASS, validator PASS and exact-head CI #495 PASS. The operator explicitly authorized fresh Controlled UI Acceptance for this exact head; authorization is persisted on PR #96 comment `5431215884`. Acceptance may temporarily restart Director only if required to serve the exact candidate, must not restart ComfyUI, and must restore deployed v0.19.2 from the dedicated stable runtime afterward. Merge and deploy remain unauthorized.

## NEXT

Execute Controlled UI Acceptance of exact PR head only. Perform runtime-safe/read-only preflight; fail closed if PR head changes or queue/runtime state is not safely idle. Verify actual browser `app.js` boot and UI/API version coherence at 0.19.3; friendly model labels + technical filename detail; truthful installed/missing/unavailable states; zero-compatible-model blocking if naturally present; `+ AGGIUNGI ALLA CODA` disabled/help and ordinary unprepared-Batch eligibility; Wave 1/2 visual/layout/Inspector/tooltips regressions. No generation, upload, POST prompt, POST queue, queue/GPU/project mutation, ComfyUI lifecycle operation, merge, or deploy. Restore deployed v0.19.2 and persist acceptance evidence, then stop for merge gate if PASS.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING remains ACTIVE on #95 / PR #96 with fresh Controlled UI Acceptance explicitly authorized for exact head `43bd61d793404a56ea30d68ce284d42b5f454722`. Issue #97 separately tracks the permanent stable-runtime checkout/Windows launcher deployment contract. #89 remains a separate reusable-framework follow-up. Creative production lanes remain inactive unless separately activated.

## VERIFIED THROUGH

#92 UI/UX Wave 2 remains complete end-to-end and deployed as `v0.19.2`. For #95, first Controlled UI Acceptance on `4c98d27...` was safely BLOCKED by a browser ESM path defect and restored v0.19.2 with ComfyUI unchanged and queue 0/0. Corrected PR head `43bd61d793404a56ea30d68ce284d42b5f454722` removes the `lib -> public` boundary violation, has browser-static import-graph regression, npm 948/948 PASS, validator PASS, exact-head CI #495 PASS, source re-review PASS and fresh exact-head operator acceptance authorization `5431215884`. No merge/deploy is authorized.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline before Wave 3: **v0.19.2**
- Wave 3 target release remains **v0.19.3**; correction does not bump again because v0.19.3 is unreleased
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
