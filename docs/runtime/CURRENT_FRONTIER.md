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

MIGRATION_PLAN_READ_ONLY

## GATE

PR #101 exact current head `3bb4037d32219eaea1e6945e7e4385caa343ccfa` has SOURCE_REVIEW_PASS (`5054690679`). The prior migration-safety blockers are corrected: raw migration paths fail closed before `path.resolve`; APPLY re-plans fresh and rejects stale source/target/classification/hash drift; INVALID_SOURCE and SAME_ID_DIFFERENT_CONTENT block the whole apply before project copies; target copying uses atomic `COPYFILE_EXCL` fail-if-exists semantics with deterministic race coverage; source and target SHA-256 are verified. Cursor reports 1032/1032 tests PASS and validator PASS; exact-head workflow #562 / run `33206274222` is PASS. Persistent project-store authority and GPU expand/collapse source corrections remain accepted. Production remains v0.19.5 at exact stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. The 14 historical operator projects remain intact and unmigrated.

The current gate authorizes only a READ-ONLY real-store migration PLAN. It does not authorize APPLY or any project-file write.

## NEXT

Using the reviewed v0.19.6 migration tooling on PR #101, resolve and verify the exact discovered 14-project `rambo-ai-film` source path and the intended `%LOCALAPPDATA%\AI Video Director\projects` persistent target, then run PLAN mode only. Persist exact source/target paths privately where required, public-safe item count/classification/source hashes/target state, and explicit zero-write side effects. `issue-73-live-acceptance` remains excluded because it is not in the 14-project `rambo-ai-film` source. No `--apply` or `--activate`. If and only if the plan is clean, stop at a separate explicit operator APPLY authorization gate.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #100 at `MIGRATION_PLAN_READ_ONLY`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #100.

## VERIFIED THROUGH

#97 is complete. Canonical deployed Harness is **v0.19.5** at exact dedicated stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. #100 discovery proved 14 historical operator projects are intact and not deleted. PR #101 exact head `3bb4037d32219eaea1e6945e7e4385caa343ccfa` has SOURCE_REVIEW_PASS and exact-head CI PASS. No real migration has occurred; next is read-only PLAN evidence only.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.5**
- Production release SHA: `0617a68a8152bb073ace8ea51ac3375292779c11`
- Active correction target: **v0.19.6**
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Release/deploy advances only the dedicated stable runtime checkout to an exact separately authorized merged release SHA
- Director restart is exact-PID only; no broad `node.exe` kill
- ComfyUI lifecycle is external to Director and must not be changed by source/discovery/plan work
- Project definitions are local/private data and must not be committed publicly
- Project recovery/migration must be copy-only/fail-closed; no silent overwrite/delete/rename; real APPLY requires a separate explicit operator gate after a clean real-store PLAN
- Current authorization is PLAN READ-ONLY only: no real project file writes, no `--apply`, no `--activate`
- No generation, upload, POST `/prompt`, POST `/api/queue`, persistent queue mutation, GPU mutation, project mutation, Desktop rewrite, production restart, Controlled Acceptance, merge or deploy is authorized by the current plan-only state
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
