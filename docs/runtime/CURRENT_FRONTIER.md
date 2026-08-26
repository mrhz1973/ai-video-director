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

UI/UX v0.19.3 Wave 3 — deployment authorized after merged PR #96

## STATUS

DEPLOY_AUTHORIZED

## GATE

PR #96 merged successfully after explicit operator authorization. Accepted candidate head was `43bd61d793404a56ea30d68ce284d42b5f454722`; merge commit is `01a4d907655a076c2357dd9690731a2d1ce8c484`. Source re-review PASS (`5035113265`), npm 948/948 PASS, validator PASS, exact-head CI #495 PASS and Controlled UI Acceptance RETEST PASS (`5431275624`) remain the release evidence. The operator explicitly authorized deployment of v0.19.3; authorization is persisted on PR #96 comment `5431448050`. Production remains v0.19.2 until deployment verification passes.

## NEXT

Execute the authorized v0.19.3 deployment from exact merge commit `01a4d907655a076c2357dd9690731a2d1ce8c484` while honoring issue #97. Perform fail-closed read-only preflight; require queue idle and unambiguous Director/ComfyUI identities; require dedicated stable runtime checkout clean. Advance ONLY that dedicated runtime checkout to the exact authorized merge SHA, verify package version 0.19.3 and exact SHA, keep the Desktop shortcut bound to that stable runtime root, restart ONLY the exact Director PID, do not restart ComfyUI, then verify UI `/api/health` `/api/config` all report 0.19.3, ComfyUI PID is unchanged, final queue is 0/0 and generation/upload/queue/GPU/project side effects are zero. Persist deployment evidence and then reconcile #95 completion.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING remains ACTIVE on #95 with v0.19.3 DEPLOY_AUTHORIZED. PR #96 is merged. Issue #97 separately tracks the permanent stable-runtime checkout/Windows launcher deployment contract and is mandatory for this deploy. #89 remains a separate reusable-framework follow-up. Creative production lanes remain inactive unless separately activated.

## VERIFIED THROUGH

#92 UI/UX Wave 2 remains complete end-to-end and deployed as `v0.19.2`. For #95, corrected Wave 3 candidate passed source review, npm 948/948, validator, exact-head CI #495 and Controlled UI Acceptance RETEST; PR #96 then merged as `01a4d907655a076c2357dd9690731a2d1ce8c484`. Deployment authorization for v0.19.3 is now explicit and persisted; production remains v0.19.2 until the authorized deployment completes and is verified.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline before Wave 3: **v0.19.2**
- Wave 3 merged release target: **v0.19.3**
- Authorized release merge SHA: `01a4d907655a076c2357dd9690731a2d1ce8c484`
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Deployment advances that stable runtime checkout to the exact authorized merged release SHA before Director restart
- Director restart is exact-PID only; no broad `node.exe` kill
- ComfyUI lifecycle is external to the Director and must remain untouched for this deploy
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
