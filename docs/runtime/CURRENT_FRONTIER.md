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

UI/UX v0.19.0 Wave 1 — merge/deploy gate

## STATUS

WAITING

## GATE

Explicit operator authorization to merge PR #90 and deploy the merged Wave 1 Harness. Deploy requires idle queue preflight, no generation, and no ComfyUI restart. Wave 2/3 are not active.

## NEXT

If authorized: re-check current main and PR #90 mergeability/CI, merge PR #90, deploy canonical merged main with Director restart only as required, preserve ComfyUI process, verify health/UI/queue, and persist deployment evidence. Otherwise remain waiting.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #88 and waiting for merge/deploy authorization. Wave 2/3 remain operator-approved roadmap but inactive.

## VERIFIED THROUGH

#88 Wave 1 implementation and automated validation PASS on PR #90: npm test 878/878, validator PASS, CI green, orchestrator code review PASS. Controlled UI acceptance also PASS on the exact reviewed code head: Inspector collapse/restore, compact GPU disclosure without power mutation, SCENA workflow strip behavior, Batch terminology, CODA empty terminal clarity, and sampled global tooltip behavior passed; unavailable live states retained automated coverage. Acceptance used generation 0, upload 0, POST /prompt 0, POST /api/queue 0, queue mutation NO, GPU mutation NO, project persistent mutation NO; ComfyUI PID remained unchanged and canonical Director was restored afterward.

## GLOBAL RUNTIME INVARIANTS

- Canonical Harness package: **v0.19.0**
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- ComfyUI lifecycle is external to the Director
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
