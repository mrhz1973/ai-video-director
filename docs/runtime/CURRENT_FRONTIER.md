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

UI/UX v0.19.3 Wave 3 — controlled UI acceptance

## STATUS

ACCEPTANCE_GATE

## GATE

PR #96 final corrected candidate at exact head `4c98d27b6acba81d1f18c30eccad473a0ff7d7bf` has completed source review PASS. npm test 944/944 PASS, validator PASS and exact-head CI run #488 PASS with runtime untouched. Zero-compatible-model Single/Batch fail-safe, measured CSS/cascade consolidation, and primary `+ AGGIUNGI ALLA CODA` disabled/help behavior are source-verified. Controlled UI acceptance now requires explicit operator authorization. Merge and deploy remain unauthorized.

## NEXT

After explicit operator authorization, perform controlled UI acceptance of candidate v0.19.3 only. Verify UI/API/version coherence, friendly/technical model presentation and unavailable states, zero-compatible-model blocking, Add-to-CODA disabled/help behavior, and Wave 1/2 visual/layout regressions. Acceptance must not generate, upload, mutate live queue/GPU/project state, restart ComfyUI, merge, or deploy. Stop after acceptance evidence for the merge gate.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING remains ACTIVE on #95 / PR #96 at the Controlled UI Acceptance gate. Issue #97 separately tracks the permanent stable-runtime checkout/Windows launcher deployment contract and does not broaden PR #96. #89 remains a separate reusable-framework follow-up. Creative production lanes remain inactive unless separately activated.

## VERIFIED THROUGH

#92 UI/UX Wave 2 is complete end-to-end and deployed as `v0.19.2`. For #95 / PR #96 exact head `4c98d27b6acba81d1f18c30eccad473a0ff7d7bf`: zero-compatible-model selection/submission fail-safe RESOLVED; CSS/cascade consolidation RESOLVED with measured deduplication evidence; SYSTEM panel decision `NOT_IMPLEMENTED_BY_DESIGN`; legacy reconciliation persisted; Add-to-CODA authoritative model/readiness state RESOLVED; npm test 944/944 PASS; validator PASS; exact-head CI #488 PASS; orchestrator source review PASS marker `5034728957`; generation/upload/queue/GPU/runtime mutations zero/NO.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline before Wave 3: **v0.19.2**
- Wave 3 target release: **v0.19.3**
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
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
