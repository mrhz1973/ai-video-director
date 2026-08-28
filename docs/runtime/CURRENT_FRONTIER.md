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

none

## STATUS

HARNESS_IDLE

## GATE

No active Harness operation gate. New Harness work requires explicit activation. Generation remains separately gated by the project generation authorization contract.

## NEXT

HARNESS_ENGINEERING awaits explicit new Harness activation. #89 autonomous specialist intake remains a separate follow-up and is not auto-activated. Creative/production lanes remain governed by their own Workboard state and activation gates.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is idle after successful completion of #100. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated.

## VERIFIED THROUGH

#100 is complete. Canonical deployed Harness is **v0.19.6** at exact dedicated stable-runtime release SHA `bd8cdd026fd1b2015b09135f6d18bfd595bbdf13`.

Deployment verification PASS:
- package, `/api/health`, `/api/config` and UI version surface = **0.19.6**;
- dedicated stable runtime clean + detached at the exact authorized release;
- persistent project authority is `%LOCALAPPDATA%\AI Video Director\projects` via `H3_PROJECT_DIRECTORY`;
- exactly 14 recovered operator projects are exposed by `/api/projects` and `/api/config.projects`, representative read-only loads PASS, and all 14 project SHA-256 values are unchanged;
- `issue-73-live-acceptance` remains excluded from the recovered catalog;
- Director runs on `127.0.0.1:8787`; ComfyUI PID/lifecycle remained unchanged through deployment;
- queue remained `0/0`, Desktop launcher target/WorkingDirectory remained unchanged, GPU mode/limit remained unchanged;
- generation/upload/POST `/prompt`/POST `/api/queue`/queue mutation/GPU mutation/project mutation/migration APPLY/Desktop rewrite/ComfyUI lifecycle/broad process kill side effects were zero.

Canonical deployment evidence: PR #101 comment `5458010931`. Orchestrator closure review: #100 comment `5458032685`.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.6**
- Production release SHA: `bd8cdd026fd1b2015b09135f6d18bfd595bbdf13`
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Release/deploy advances only the dedicated stable runtime checkout to an exact separately authorized merged release SHA
- Director restart is exact-PID only; no broad `node.exe` kill
- ComfyUI lifecycle is external to Director and must not be changed by deployment except read-only identity/health verification
- Persistent project definitions exist in `%LOCALAPPDATA%\AI Video Director\projects`; exactly 14 recovered operator projects are verified there and must survive future releases unchanged unless separately authorized
- Legacy source project files remain preserved and unchanged
- `issue-73-live-acceptance` is excluded from the recovered catalog
- Prompt preparation/presentation is never a human gate; GPT Web prepares the next Cursor packet automatically under AUTO-VIA
- No generation authorization is implied by Harness deployment or idle state
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
