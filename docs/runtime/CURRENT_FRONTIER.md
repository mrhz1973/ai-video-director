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

SOURCE_REVIEW_CHANGES_REQUIRED

## GATE

PR #101 exact reviewed head `99652b42d8eefc5178bf9f02ee1d9fa3d3b4d956` correctly introduces user-scoped persistent project authority outside git worktrees and corrects the GPU compact expand/collapse regression. Target version is 0.19.6; reported npm tests are 1021/1021 PASS, validator PASS, and exact-head workflow #559 PASS. Source review `5054602553` nevertheless blocks the migration APPLY path before any real operator migration: ordinary `copyFile` after an `existsSync` check is not atomic fail-if-exists; APPLY may trust a stale supplied PLAN without fresh authoritative source/target revalidation; INVALID_SOURCE does not currently block before writes; and raw empty source/target library inputs can resolve to cwd through `path.resolve('')`. Production remains v0.19.5 at exact stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. The 14 historical operator projects remain intact in the legacy store and have not been copied or mutated.

## NEXT

Correct only PR #101 migration safety: validate raw non-empty source/target inputs before resolution; perform a fresh authoritative APPLY preflight and reject stale plan/source/target drift; make INVALID_SOURCE, SAME_ID_DIFFERENT_CONTENT and any deterministic plan drift block before mkdir/copy; use atomic exclusive copy/fail-if-exists semantics; and add deterministic tests for empty paths, stale source, stale target, target appearing at copy time with no overwrite, mixed invalid+valid zero-copy, conflicts and source preservation. Preserve the already-reviewed persistent project-store and GPU fixes unless required by this correction. Re-run full tests, validator and exact-head CI, then persist corrected evidence for source re-review. The real 14-project migration remains a separate explicit operator gate after source review PASS.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #100 at `SOURCE_REVIEW_CHANGES_REQUIRED`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #100.

## VERIFIED THROUGH

#97 is complete. Canonical deployed Harness is **v0.19.5** at exact dedicated stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. #100 discovery proved 14 historical operator projects are intact and not deleted. PR #101 persistent-store and GPU changes are directionally accepted, but migration source safety must be corrected before any migration authorization.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.5**
- Production release SHA: `0617a68a8152bb073ace8ea51ac3375292779c11`
- Active correction target: **v0.19.6**
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Release/deploy advances only the dedicated stable runtime checkout to an exact separately authorized merged release SHA
- Director restart is exact-PID only; no broad `node.exe` kill
- ComfyUI lifecycle is external to Director and must not be changed by source/discovery work
- Project definitions are local/private data and must not be committed publicly
- Project recovery/migration must be copy-only/fail-closed; no silent overwrite/delete/rename; real migration requires a separate explicit gate
- No generation, upload, POST `/prompt`, POST `/api/queue`, persistent queue mutation, GPU mutation, project mutation, Desktop rewrite, or production restart is authorized by source correction work
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
