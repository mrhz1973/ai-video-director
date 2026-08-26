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

UI/UX v0.19.3 Wave 3 — merge gate after Controlled UI Acceptance PASS

## STATUS

MERGE_GATE

## GATE

PR #96 exact head `43bd61d793404a56ea30d68ce284d42b5f454722` has source re-review PASS (`5035113265`), npm test 948/948 PASS, validator PASS, exact-head CI #495 PASS and fresh Controlled UI Acceptance RETEST PASS (`5431275624`). Actual browser `app.js` boot PASS; UI `/api/health` `/api/config` coherent at v0.19.3; model registry UI, Add-to-CODA disabled/help, Wave 1/2 visual/layout/Inspector/tooltips PASS. Acceptance produced zero generation/upload/POST prompt/POST queue/queue/GPU/project mutation; ComfyUI PID remained unchanged; stable Director v0.19.2 was restored; final queue 0/0. Explicit operator authorization is now required to merge PR #96. Deploy remains unauthorized.

## NEXT

After explicit merge authorization, re-verify PR #96 head remains exactly `43bd61d793404a56ea30d68ce284d42b5f454722` and PR remains mergeable, then merge PR #96. After merge, stop at a separate explicit deploy gate. Do not advance the dedicated stable runtime, restart the production Director, change the Desktop launcher target, or deploy v0.19.3 until deploy authorization is separately given. Eventual deploy must honor issue #97 stable-runtime invariant.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING remains ACTIVE on #95 / PR #96 at explicit MERGE_GATE. Issue #97 separately tracks the permanent stable-runtime checkout/Windows launcher deployment contract. #89 remains a separate reusable-framework follow-up. Creative production lanes remain inactive unless separately activated.

## VERIFIED THROUGH

#92 UI/UX Wave 2 remains complete end-to-end and deployed as `v0.19.2`. For #95, first Controlled UI Acceptance on `4c98d27...` was safely BLOCKED by a browser ESM path defect and restored v0.19.2 with ComfyUI unchanged and queue 0/0. Corrected PR head `43bd61d793404a56ea30d68ce284d42b5f454722` removes the `lib -> public` boundary violation, has browser-static import-graph regression, npm 948/948 PASS, validator PASS, exact-head CI #495 PASS, source re-review PASS and fresh Controlled UI Acceptance RETEST PASS. Production remains v0.19.2 until separate deploy authorization.

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
