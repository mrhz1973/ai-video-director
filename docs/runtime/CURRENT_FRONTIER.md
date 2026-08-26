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

HARNESS_ENGINEERING idle after #88 Wave 1 completion

## STATUS

IDLE

## GATE

Explicit activation before starting Wave 2 or another Harness issue. Generation remains separately gated by the project generation authorization contract.

## NEXT

Await explicit operator/orchestrator activation of Wave 2 or another Harness issue. Wave 2/3 remain approved roadmap but inactive. #89 autonomous specialist intake remains a separate reusable-framework follow-up and is not auto-promoted by #88 completion.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is idle. Other specialist lanes are governed independently by the Workboard and scoped production authority.

## VERIFIED THROUGH

#88 UI/UX v0.19.0 Wave 1 complete end-to-end. PR #90 merged at `ca101ee025ab1302dc6cb42d6c4630a549acbd7d`; authorized Director-only deployment PASS. Final deployment evidence persisted via PR #91 and merged to main. Deployment evidence records queue preflight 0/0, Director restart YES (exact PID only), ComfyUI restart NO / same PID YES, `/api/health` PASS, `/api/config` PASS, Wave 1 smoke PASS, generation 0, upload 0, POST `/prompt` 0, POST `/api/queue` 0, queue mutation NO, GPU mutation NO.

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
