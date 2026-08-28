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

DEPLOY_GATE

## GATE

PR #101 exact reviewed/accepted head `3bb4037d32219eaea1e6945e7e4385caa343ccfa` was merged successfully with expected-head protection. Exact merge/release SHA is `bd8cdd026fd1b2015b09135f6d18bfd595bbdf13`; merge evidence is PR #101 comment `5457836584`. Source review, exact-head CI and Controlled Acceptance are PASS.

Acceptance proved: exact candidate v0.19.6 on isolated port 8788; persistent project authority `%LOCALAPPDATA%\AI Video Director\projects`; exactly 14 recovered projects visible via API/config/selector and representative read-only loads; project hashes unchanged; GPU `Espandi` / `Comprimi` PASS in SCENA/BATCH/CODA/OUTPUT; POST `/api/gpu-power` 0 and GPU state unchanged; production v0.19.5 remained running and unchanged; ComfyUI PID unchanged; queue 0/0; Desktop unchanged; prohibited side effects zero.

Production remains v0.19.5 at exact stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`.

Current real gate: explicit operator authorization to deploy v0.19.6 exact release SHA `bd8cdd026fd1b2015b09135f6d18bfd595bbdf13`. Merge authorization does not authorize deployment.

## NEXT

After explicit deploy authorization, advance only the dedicated stable runtime checkout to exact release SHA `bd8cdd026fd1b2015b09135f6d18bfd595bbdf13` using the permanent deployment contract. Preserve the persistent 14-project store, ComfyUI lifecycle/PID, queue and Desktop launcher target; verify UI/API 0.19.6 and project catalog; persist deployment PASS/BLOCKED evidence; then reconcile/close #100 if PASS. Prompt/packet preparation is automatic and is not a human gate.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #100 at `DEPLOY_GATE`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #100.

## VERIFIED THROUGH

#97 is complete. Canonical deployed Harness is **v0.19.5** at exact release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. #100 discovery and copy-only migration are PASS; exactly 14 recovered operator projects exist in the persistent store with source/target hashes verified. PR #101 source review, exact-head CI, Controlled Acceptance, acceptance evidence review and merge all PASS. v0.19.6 is merged at exact release SHA `bd8cdd026fd1b2015b09135f6d18bfd595bbdf13` but not yet deployed.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.5**
- Production release SHA: `0617a68a8152bb073ace8ea51ac3375292779c11`
- Merged target: **v0.19.6** @ `bd8cdd026fd1b2015b09135f6d18bfd595bbdf13`
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Release/deploy advances only the dedicated stable runtime checkout to an exact separately authorized merged release SHA
- Director restart is exact-PID only; no broad `node.exe` kill
- ComfyUI lifecycle is external to Director and must not be changed by deployment except read-only identity/health verification
- Persistent project definitions exist in `%LOCALAPPDATA%\AI Video Director\projects`; exactly 14 recovered operator projects are verified there and must survive deployment unchanged
- Legacy source project files remain preserved and unchanged
- `issue-73-live-acceptance` is excluded from the recovered catalog
- Prompt preparation/presentation is never a human gate; GPT Web prepares the next Cursor packet automatically under AUTO-VIA
- Deploy requires explicit operator authorization for exact release SHA `bd8cdd026fd1b2015b09135f6d18bfd595bbdf13`
- No generation, upload, POST `/prompt`, POST `/api/queue`, queue mutation, GPU power mutation, project mutation, Desktop rewrite or ComfyUI lifecycle is authorized by the current gate
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
