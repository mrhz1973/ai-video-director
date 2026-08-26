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

UI/UX audit v0.19.0

## STATUS

IN_PROGRESS

## GATE

Read-only audit report + operator review before any implementation activation. No application code/runtime/generation/upload/queue/deploy work is authorized by audit activation.

## NEXT

Complete #86 read-only UI/UX audit of canonical v0.19.0, reconcile older Harness UX backlog against the current app, and present prioritized P0/P1/P2/P3 findings for operator selection.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #86 audit only. Other specialist lanes remain independently governed by the Workboard.

## VERIFIED THROUGH

Harness #74 asset large-preview/lightbox implementation, tests, orchestrator review, controlled UI acceptance, merge and deployment PASS; final deployment evidence persisted to main via PR #85. #86 is an audit-only activation and does not reopen runtime stabilization by itself. No persisted main SHA.

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
