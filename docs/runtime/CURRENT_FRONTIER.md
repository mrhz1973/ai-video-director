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

UI/UX v0.19.3 Wave 3 — deploy gate after merged PR #96

## STATUS

DEPLOY_GATE

## GATE

PR #96 merged successfully after explicit operator authorization. Accepted candidate head was `43bd61d793404a56ea30d68ce284d42b5f454722`; merge commit is `01a4d907655a076c2357dd9690731a2d1ce8c484`. Source re-review PASS (`5035113265`), npm 948/948 PASS, validator PASS, exact-head CI #495 PASS and Controlled UI Acceptance RETEST PASS (`5431275624`) remain the release evidence. Production runtime is still v0.19.2. Explicit operator authorization is required before deployment.

## NEXT

After explicit deploy authorization, deploy merged v0.19.3 from merge commit `01a4d907655a076c2357dd9690731a2d1ce8c484` while honoring issue #97: advance the dedicated stable runtime checkout to the exact authorized merged release SHA before restarting Director, keep the Desktop shortcut bound to that stable runtime root, do not restart ComfyUI, require queue idle, verify UI `/api/health` `/api/config` all report 0.19.3, verify ComfyUI PID/lifecycle and GPU/queue/project state are unchanged except the authorized Director restart/runtime advancement, persist deployment evidence, then reconcile #95 completion.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING remains ACTIVE on #95 at explicit DEPLOY_GATE. PR #96 is merged. Issue #97 separately tracks the permanent stable-runtime checkout/Windows launcher deployment contract and is mandatory for this deploy. #89 remains a separate reusable-framework follow-up. Creative production lanes remain inactive unless separately activated.

## VERIFIED THROUGH

#92 UI/UX Wave 2 remains complete end-to-end and deployed as `v0.19.2`. For #95, corrected Wave 3 candidate passed source review, npm 948/948, validator, exact-head CI #495 and Controlled UI Acceptance RETEST; PR #96 then merged as `01a4d907655a076c2357dd9690731a2d1ce8c484`. Production remains v0.19.2 until separate deploy authorization.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline before Wave 3: **v0.19.2**
- Wave 3 merged release target: **v0.19.3**
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Deployment advances that stable runtime checkout to the exact authorized merged release SHA before Director restart
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
