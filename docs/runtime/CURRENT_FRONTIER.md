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

ACCEPTANCE_EVIDENCE_REPAIR

## GATE

Controlled Acceptance was executed for exact PR #101 head `3bb4037d32219eaea1e6945e7e4385caa343ccfa`. PR comment `5457644381` declares `ACCEPTANCE_PASS` and records the candidate on isolated port 8788 with the persistent user-scoped project store while production 8787 was not stopped. However, that persisted comment is truncated during the Preflight table, and `docs/runtime/LAST_CURSOR_REPORT.md` on main remains stale (#97). Orchestrator evidence review `5457692293` therefore classifies the state as `EVIDENCE_NOT_PERSISTED`, not `ACCEPTANCE_FAILED` and not `TASK_NOT_EXECUTED`.

Production remains v0.19.5 at exact stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. PR #101 remains open and mergeable, but merge is blocked until acceptance evidence is complete and reviewed.

Evidence repair is docs/bookkeeping only and does not require operator authorization. No new Controlled Acceptance execution is authorized by this state.

## NEXT

Recover and persist the complete evidence from the already executed Controlled Acceptance without rerunning it if deterministic local/session evidence remains available. Required repaired evidence: exact candidate authority; persistent `%LOCALAPPDATA%\AI Video Director\projects` authority; exactly 14 recovered projects; representative read-only project loads; SCENA/BATCH/CODA/OUTPUT GPU Espandi/Comprimi behavior; zero GPU POST/write; project files/hashes unchanged; final production/Comfy/queue/Desktop state; complete side-effect matrix. If the underlying evidence cannot be recovered deterministically, persist `EVIDENCE_REPAIR_BLOCKED` rather than infer PASS. After evidence-complete PASS and orchestrator review, the next real gate is merge.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #100 at `ACCEPTANCE_EVIDENCE_REPAIR`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #100.

## VERIFIED THROUGH

#97 is complete. Canonical deployed Harness is **v0.19.5** at exact release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. #100 discovery and copy-only migration are PASS; exactly 14 recovered operator projects exist in the persistent store with source/target hashes verified. PR #101 source review and exact-head CI PASS. Controlled Acceptance execution reported PASS, but its persisted evidence is incomplete/truncated; current evidence state is `EVIDENCE_NOT_PERSISTED` pending evidence repair.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.5**
- Production release SHA: `0617a68a8152bb073ace8ea51ac3375292779c11`
- Active correction target: **v0.19.6**
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Release/deploy advances only the dedicated stable runtime checkout to an exact separately authorized merged release SHA
- Director restart is exact-PID only; no broad `node.exe` kill
- ComfyUI lifecycle is external to Director and must not be changed by evidence repair
- Persistent project definitions exist in `%LOCALAPPDATA%\AI Video Director\projects`; exactly 14 recovered operator projects are verified there
- Legacy source project files remain preserved and unchanged
- `issue-73-live-acceptance` is excluded from the recovered catalog
- Prompt preparation/presentation is never a human gate; GPT Web prepares the next Cursor packet automatically under AUTO-VIA
- Evidence repair does not authorize generation, upload, POST `/prompt`, POST `/api/queue`, queue mutation, GPU power mutation, Desktop rewrite, new Controlled Acceptance execution, merge or deploy
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- Preparing or presenting a Cursor execution packet is orchestration, not an operation gate; never ask the operator for authorization merely to draft/provide the packet.
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
