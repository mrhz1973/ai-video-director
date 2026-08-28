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

CONTROLLED_ACCEPTANCE_GATE

## GATE

The real project recovery migration is complete and reviewed PASS. PR #101 migration evidence `5457492613` records exactly 14 authorized copy-only project copies into `%LOCALAPPDATA%\AI Video Director\projects`, target count 14, all target SHA-256 values equal the corresponding source values, source count/hashes unchanged, and zero overwrite/delete/move/rename/manual-copy. Orchestrator migration review `5457511731` is PASS. Tooling/source authority remains exact PR #101 head `3bb4037d32219eaea1e6945e7e4385caa343ccfa`, with SOURCE_REVIEW_PASS `5054690679` and exact-head workflow #562 PASS.

Production remains v0.19.5 at exact stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`; it has not been restarted, merged or deployed and does not yet consume the v0.19.6 persistent-store implementation.

The current gate requires separate explicit operator authorization for Controlled Acceptance of exact PR #101 head `3bb4037d32219eaea1e6945e7e4385caa343ccfa`.

## NEXT

After explicit Controlled Acceptance authorization, run a controlled v0.19.6 candidate against the existing persistent 14-project store without deploying. Prove the candidate resolves `%LOCALAPPDATA%\AI Video Director\projects`, reports exactly the 14 recovered projects, and can read/load representative recovered projects without modifying them. Verify GPU `Espandi` / `Comprimi` visibly reveals/hides ECO/BALANCED/NORMAL in SCENA, BATCH, CODA and OUTPUT while the toggle itself performs zero GPU POST/write. Preserve ComfyUI lifecycle and queue, do not generate/upload, and restore production v0.19.5 exactly after acceptance. Persist Controlled Acceptance PASS/BLOCKED evidence and stop for orchestrator `agg`. Merge and deploy remain later separate gates.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #100 at `CONTROLLED_ACCEPTANCE_GATE`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #100.

## VERIFIED THROUGH

#97 is complete. Canonical deployed Harness is **v0.19.5** at exact dedicated stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. #100 discovery recovered the historical catalog; migration PLAN was clean; operator authorized APPLY; real APPLY copied exactly 14 projects copy-only; all target hashes verified and all source hashes remained unchanged. PR #101 source review and exact-head CI PASS. No Controlled Acceptance, merge or deploy has occurred for v0.19.6.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.5**
- Production release SHA: `0617a68a8152bb073ace8ea51ac3375292779c11`
- Active correction target: **v0.19.6**
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Release/deploy advances only the dedicated stable runtime checkout to an exact separately authorized merged release SHA
- Director restart is exact-PID only; no broad `node.exe` kill
- ComfyUI lifecycle is external to Director and must not be changed by migration/acceptance work except read-only identity/health verification
- Persistent project definitions now exist in `%LOCALAPPDATA%\AI Video Director\projects`; exactly 14 recovered operator projects are verified there
- Legacy source project files remain preserved and unchanged
- `issue-73-live-acceptance` is excluded from the recovered catalog
- Controlled Acceptance requires separate explicit operator authorization
- No generation, upload, POST `/prompt`, POST `/api/queue`, persistent queue mutation, GPU power mutation, Desktop rewrite, merge or deploy is authorized by the current gate
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
