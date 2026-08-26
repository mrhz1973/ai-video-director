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

UI/UX v0.19.3 Wave 3 — controlled UI acceptance authorized

## STATUS

ACCEPTANCE_AUTHORIZED

## GATE

PR #96 final corrected candidate at exact head `4c98d27b6acba81d1f18c30eccad473a0ff7d7bf` has source review PASS, npm test 944/944 PASS, validator PASS and exact-head CI #488 PASS. Operator explicitly authorized Controlled UI Acceptance v0.19.3; authorization is persisted on PR #96 comment `5430699803`. Acceptance may temporarily restart Director only if required to serve the exact candidate, must not restart ComfyUI, and must restore deployed v0.19.2 from the dedicated stable runtime afterward. Merge and deploy remain unauthorized.

## NEXT

Execute controlled UI acceptance of exact PR head only. Perform runtime-safe/read-only preflight; fail closed if PR head changes or queue/runtime state is not safely idle. Verify UI/API/version coherence at 0.19.3; friendly model labels + technical filename detail; truthful installed/missing/unavailable states; zero-compatible-model Single/Batch blocking without submission; `+ AGGIUNGI ALLA CODA` disabled/help and ordinary unprepared-Batch eligibility; Wave 1/2 visual/layout/Inspector/tooltips regressions. No generation, upload, POST prompt, POST queue, queue/GPU/project mutation, ComfyUI lifecycle operation, merge, or deploy. Restore deployed v0.19.2 and persist acceptance evidence, then stop for merge gate.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING remains ACTIVE on #95 / PR #96 with Controlled UI Acceptance explicitly authorized. Issue #97 separately tracks the permanent stable-runtime checkout/Windows launcher deployment contract and does not broaden acceptance. #89 remains a separate reusable-framework follow-up. Creative production lanes remain inactive unless separately activated.

## VERIFIED THROUGH

#92 UI/UX Wave 2 is complete end-to-end and deployed as `v0.19.2`. For #95 / PR #96 exact head `4c98d27b6acba81d1f18c30eccad473a0ff7d7bf`: zero-compatible-model selection/submission fail-safe RESOLVED; CSS/cascade consolidation RESOLVED with measured deduplication evidence; SYSTEM panel decision `NOT_IMPLEMENTED_BY_DESIGN`; legacy reconciliation persisted; Add-to-CODA authoritative model/readiness state RESOLVED; npm test 944/944 PASS; validator PASS; exact-head CI #488 PASS; orchestrator source review PASS marker `5034728957`; operator acceptance authorization PR comment `5430699803`; generation/upload/queue/GPU/runtime mutations zero/NO before acceptance execution.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline before Wave 3: **v0.19.2**
- Wave 3 target release: **v0.19.3**
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
