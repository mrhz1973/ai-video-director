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

MIGRATION_APPLY_GATE

## GATE

PR #101 exact current head `3bb4037d32219eaea1e6945e7e4385caa343ccfa` has SOURCE_REVIEW_PASS (`5054690679`) and exact-head workflow #562 PASS. The reviewed migration path is fail-closed: raw paths validate before resolve, APPLY freshly re-plans/revalidates, drift/conflict/invalid source block before writes, target copies use atomic `COPYFILE_EXCL`, and source/target hashes are verified.

The real-store PLAN (`5457262755`) is `PLAN_CLEAN`: the legacy `rambo-ai-film` source resolves to exactly 14 valid projects whose SHA-256 set matches discovery `5456981054`; the intended persistent target `%LOCALAPPDATA%\AI Video Director\projects` does not currently exist; classification is 14 `COPY_REQUIRED`, 0 `IDENTICAL_ALREADY_PRESENT`, 0 `SAME_ID_DIFFERENT_CONTENT`, 0 `INVALID_SOURCE`; PLAN made zero writes. Plan review PASS is `5457291327`.

Production remains v0.19.5 at exact stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. No real project migration has occurred yet.

The current gate requires explicit operator authorization before copy-only APPLY of the 14 projects.

## NEXT

Await explicit operator authorization for copy-only APPLY of exactly the 14 verified `rambo-ai-film` projects into `%LOCALAPPDATA%\AI Video Director\projects`. After authorization, re-resolve the exact source and target, perform a fresh authoritative re-plan/revalidation, fail closed on any drift/conflict/invalid source, copy only `COPY_REQUIRED` items with atomic exclusive no-overwrite semantics, verify post-copy SHA-256 for every target, prove source files unchanged, persist migration evidence, then stop for post-migration verification/next gate. `issue-73-live-acceptance` remains excluded.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #100 at `MIGRATION_APPLY_GATE`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #100.

## VERIFIED THROUGH

#97 is complete. Canonical deployed Harness is **v0.19.5** at exact dedicated stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. #100 discovery proved the 14 historical operator projects are intact and not deleted. PR #101 source review and CI PASS. Real-store PLAN is clean and zero-write. No migration APPLY has occurred.

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
- Project recovery/migration must be copy-only/fail-closed; no silent overwrite/delete/rename
- Current state is an explicit human APPLY gate: no project-file write before operator authorization
- `issue-73-live-acceptance` is excluded from the 14-project migration candidate
- No generation, upload, POST `/prompt`, POST `/api/queue`, persistent queue mutation, GPU mutation, Desktop rewrite, production restart, Controlled Acceptance, merge or deploy is authorized by the current gate
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
