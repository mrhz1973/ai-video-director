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

DISCOVERY_ACTIVE

## GATE

Operator live use of production v0.19.5 exposed two regressions. First, in BATCH/CODA/OUTPUT the GPU `Espandi` / `Comprimi` control changes state but does not reveal the ECO/BALANCED/NORMAL controls. Source inspection confirms `inspector-context.mjs` applies `gpuCompactOnly: true`, `inspector-ui.mjs` adds `gpu-power-context-compact`, and `design-system.css` then unconditionally hides `.gpu-power-controls`, overriding the expansion state. Second, the historical project list disappeared after dedicated stable-runtime launch. Current server storage resolves `projectDirectory` relative to the executing runtime root while `projects/*.local.json` is gitignored, so changing checkout/runtime authority can make legacy projects invisible without deleting them. Issue #100 records the v0.19.6 correction contract. Production remains v0.19.5 at exact stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`.

## NEXT

Perform **read-only local discovery first** for project data: enumerate candidate historical/current `comfyui-harness/projects/*.local.json` stores across known ai-video-director checkouts/worktrees, record counts/ids/labels/source paths/hashes/collisions, and identify the former project authority. Do not copy, move, delete, rename, overwrite, restart production, rewrite Desktop, change GPU power, generate, upload, or mutate queue/project data. In source-only isolated work, design v0.19.6 so project authority is release-stable and independent of git worktrees, with copy-only/fail-closed legacy migration, and correct GPU compact-by-default but expandable behavior in all Inspector contexts. Migration writes require an explicit safe plan after discovery evidence. Controlled Acceptance, merge and deploy remain separate gates.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #100 at `DISCOVERY_ACTIVE`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #100.

## VERIFIED THROUGH

#97 is complete. Canonical deployed Harness is **v0.19.5** at exact dedicated stable-runtime release SHA `0617a68a8152bb073ace8ea51ac3375292779c11`. Issue #100 is open for the newly observed regressions. GPU root cause is source-visible; missing project-file location is a strong runtime-relative-storage hypothesis requiring read-only local confirmation before any migration write.

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
- Project recovery/migration must be copy-only/fail-closed until explicit evidence supports reconciliation; no silent overwrite/delete/rename
- No generation, upload, POST `/prompt`, POST `/api/queue`, persistent queue mutation, GPU mutation, project mutation, Desktop rewrite, or production restart is authorized by discovery/source work
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
