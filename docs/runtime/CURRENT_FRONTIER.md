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

MIGRATION_APPLY_AUTHORIZED

## GATE

Operator explicitly authorized the copy-only APPLY of exactly the 14 verified historical projects from the discovered `rambo-ai-film` legacy store into `%LOCALAPPDATA%\AI Video Director\projects`. Authorization is persisted as PR #101 comment `5457334362`. Tooling authority remains exact source-reviewed PR #101 head `3bb4037d32219eaea1e6945e7e4385caa343ccfa`; source review `5054690679`; exact-head workflow #562 / run `33206274222` is PASS. Real-store PLAN `5457262755` is CLEAN: 14 `COPY_REQUIRED`, 0 `IDENTICAL_ALREADY_PRESENT`, 0 `SAME_ID_DIFFERENT_CONTENT`, 0 `INVALID_SOURCE`; the persistent target was absent/empty and PLAN performed zero writes. Production remains v0.19.5 at exact stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`.

This authorization covers only the 14-project copy-only migration APPLY. It does not authorize production project API writes, runtime restart, Controlled Acceptance, merge, deploy, generation, GPU/queue mutation, Desktop rewrite or ComfyUI lifecycle.

## NEXT

Execute one real migration APPLY using exact reviewed v0.19.6 tooling. Immediately before any write: re-resolve the exact legacy source path; verify exactly the same 14 files/IDs/source hashes as discovery and clean PLAN; re-resolve `%LOCALAPPDATA%\AI Video Director\projects`; freshly re-plan source + target; require the same clean classification or fail closed. Copy only `COPY_REQUIRED` items using atomic exclusive `COPYFILE_EXCL` semantics, never overwrite, verify target SHA-256 for every copied project, and prove all source hashes remain unchanged. `issue-73-live-acceptance` remains excluded. Persist migration evidence and STOP for orchestrator `agg`.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #100 at `MIGRATION_APPLY_AUTHORIZED`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #100.

## VERIFIED THROUGH

#97 is complete. Canonical deployed Harness is **v0.19.5** at exact dedicated stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. #100 discovery proved 14 historical operator projects are intact and not deleted. PR #101 exact head `3bb4037d32219eaea1e6945e7e4385caa343ccfa` has SOURCE_REVIEW_PASS and exact-head CI PASS. Real-store migration PLAN is CLEAN; the operator has now authorized the exact 14-project copy-only APPLY, but no real migration evidence has yet been reviewed.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.5**
- Production release SHA: `0617a68a8152bb073ace8ea51ac3375292779c11`
- Active correction target: **v0.19.6**
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Release/deploy advances only the dedicated stable runtime checkout to an exact separately authorized merged release SHA
- Director restart is exact-PID only; no broad `node.exe` kill
- ComfyUI lifecycle is external to Director and must not be changed by migration work
- Project definitions are local/private data and must not be committed publicly
- Authorized real migration is copy-only/fail-closed for exactly the 14 verified `rambo-ai-film` projects into `%LOCALAPPDATA%\AI Video Director\projects`
- No silent overwrite/delete/move/rename; APPLY must freshly revalidate and fail closed on drift
- `issue-73-live-acceptance` is excluded from the migration candidate
- No generation, upload, POST `/prompt`, POST `/api/queue`, persistent queue mutation, GPU mutation, production project API write, Desktop rewrite, production restart, Controlled Acceptance, merge or deploy is authorized by the current migration APPLY scope
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
