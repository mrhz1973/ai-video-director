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

UI/UX v0.19.0 Wave 1 — operator-first interface

## STATUS

IN_PROGRESS

## GATE

Isolated implementation/tests + validator + CI + orchestrator review. Controlled UI acceptance is separate. Merge/deploy are separate operator gates. No generation is authorized by this activation.

## NEXT

Implement #88 Wave 1 only: collapsible Inspector, compact GPU Power, FL2VA START+END frame strip, Batch terminology/history separation, OUTPUT action hierarchy, CODA terminal clarity, and reusable accessible tooltips on all visible buttons/actions.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #88. Wave 2/3 are operator-approved roadmap but are not active implementation scope yet.

## VERIFIED THROUGH

Harness #74 asset large-preview/lightbox implementation, tests, orchestrator review, controlled UI acceptance, merge and deployment PASS; final deployment evidence persisted to main via PR #85. UI/UX audit #86 completed and operator-approved. No persisted main SHA.

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
