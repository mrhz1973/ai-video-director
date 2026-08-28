# CURRENT_FRONTIER

Updated: 2026-08-28  
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

#100 — v0.19.6 restore persistent project catalog and GPU expand/collapse

## STATUS

IMPLEMENTATION_ACTIVE

## GATE

Read-only discovery `5456981054` is PASS and orchestrator discovery review `5456997834` confirms the historical operator projects were not deleted: 14 valid `*.local.json` project definitions remain in the legacy `rambo-ai-film` ChatGPT-project checkout, all unique to that store, with no same-id/different-content collisions or invalid JSON. Production v0.19.5 stable runtime at exact release SHA `0617a68a8152bb073ace8ea51ac3375292779c11` resolves its project store relative to its own checkout and therefore exposes 0 projects through `/api/projects` and `/api/config.projects`. The separate `issue-73-live-acceptance` project is classified as a test artifact and excluded from the operator migration candidate. GPU root cause is confirmed: contextual compact CSS hides `.gpu-power-controls` even when the existing `.is-expanded` state is active in BATCH/CODA/OUTPUT.

## NEXT

Implement **source-only v0.19.6** in an isolated branch/worktree. Make project authority user-scoped and release-stable outside all git worktrees (preferred Windows authority `%LOCALAPPDATA%\AI Video Director\projects`, or an equivalent explicit deterministic local authority), with launcher/runtime resolution that does not depend on the checkout containing `server.mjs`. Add copy-only/fail-closed legacy migration tooling with collision detection using temp fixtures only; no real migration write is authorized yet. Correct GPU compact-by-default behavior so `Espandi` visibly reveals ECO/BALANCED/NORMAL in SCENA/BATCH/CODA/OUTPUT while the toggle itself remains display-only. Require full tests, validator and exact-head CI before source review. Real 14-project migration, Controlled Acceptance, merge and deploy remain separate gates.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #100 at `IMPLEMENTATION_ACTIVE`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #100.

## VERIFIED THROUGH

#97 complete; production Harness **v0.19.5** at exact dedicated stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. #100 discovery `5456981054` PASS; orchestrator review `5456997834` PASS; Workboard implementation SYNC `5456999778`. Fourteen historical operator projects are intact in the legacy store; current production-visible count is 0 only because project storage is checkout-relative. GPU expand/collapse source root cause is confirmed.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.5**
- Production release SHA: `0617a68a8152bb073ace8ea51ac3375292779c11`
- Active correction target: **v0.19.6**
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Project definitions are local/private data and must not be committed publicly
- Target project authority must be independent of release/dev git worktrees
- Real legacy project migration must be copy-only/fail-closed; no silent overwrite/delete/rename; same-id/different-content is a blocker
- The 14-project `rambo-ai-film` catalog is the migration candidate; `issue-73-live-acceptance` remains excluded as a test artifact
- No real project copy/move/delete/rename/overwrite or production project API write is authorized during source implementation
- Director restart is exact-PID only when separately authorized; no broad process kill
- ComfyUI lifecycle remains external and untouched
- No generation, upload, POST `/prompt`, POST `/api/queue`, queue mutation, GPU mutation, Desktop rewrite, production restart, merge or deploy is authorized by the implementation gate
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
