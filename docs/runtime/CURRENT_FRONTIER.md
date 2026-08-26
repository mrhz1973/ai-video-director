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

UI/UX v0.19.3 Wave 3 — final source-review correction

## STATUS

CORRECTIONS_REQUIRED

## GATE

PR #96 corrected candidate at exact head `3ae8f2e8a099e236cdf43349df07b26d11f4ca8b` resolves the original zero-compatible-model fail-safe blocker and the CSS/cascade consolidation blocker. npm test 935/935 PASS, validator PASS and exact-head CI run #479 PASS with runtime untouched. Latest orchestrator re-review marker `5034486382` found one final UI-state defect: `#batchAddToQueue` remains visually enabled while the authoritative model gate says the Batch is not actionable, even though the deeper click/submission path correctly fails safe. Controlled acceptance, merge and deploy remain unauthorized.

## NEXT

Correct PR #96 on the same branch: apply `currentModelBlocker()` to the primary `+ AGGIUNGI ALLA CODA` disabled/readiness state and disabled help without overriding unrelated eligibility rules; preserve `getCurrentBatchSnapshotForQueue()` as the deeper fail-safe; add regression; rerun full tests + validator + exact-head CI; update `LAST_CURSOR_REPORT`; stop for orchestrator re-review. Do not touch runtime.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING remains ACTIVE on #95 / PR #96 with one final correction required. Issue #97 separately tracks the permanent stable-runtime checkout/Windows launcher deployment contract and does not broaden PR #96. #89 remains a separate reusable-framework follow-up. Creative production lanes remain inactive unless separately activated.

## VERIFIED THROUGH

#92 UI/UX Wave 2 is complete end-to-end and deployed as `v0.19.2`. For #95 / PR #96, exact head `3ae8f2e8a099e236cdf43349df07b26d11f4ca8b` has: zero-compatible-model selection/submission fail-safe RESOLVED; CSS/cascade consolidation RESOLVED with measured deduplication evidence; SYSTEM panel decision `NOT_IMPLEMENTED_BY_DESIGN`; legacy reconciliation persisted; npm test 935/935 PASS; validator PASS; exact-head CI #479 PASS; generation/upload/queue/GPU/runtime mutations zero/NO. One final primary Add-to-CODA disabled-state correction remains before controlled acceptance.

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
