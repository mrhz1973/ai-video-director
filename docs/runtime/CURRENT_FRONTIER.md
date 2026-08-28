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

#97 — permanent stable-runtime / Windows launcher deployment automation — v0.19.5 post-deploy source correction

## STATUS

ACCEPTANCE_RERUN_PENDING_VERIFICATION

## GATE

Prior Controlled Acceptance evidence PR #99 comment `5454672422` BLOCKED safely at preflight because production Director 8787 and ComfyUI 8188 were offline. Afterward the operator performed a targeted production-availability repair using the official v0.19.4 stable-runtime installer/reinstaller: launcher config was rewritten with the canonical dedicated runtime root and the Desktop shortcut was recreated to the same stable runtime; no deploy or stable-runtime SHA advancement was performed. Operator then launched the normal stable launcher and reports browser pages opened. This is operator-reported availability only and must be freshly verified by Harness. Deployed launcher behavior at v0.19.4 intentionally opens two browser targets when `openBrowser=true`: Director 8787 and ComfyUI 8188; two tabs alone do not imply duplicate ComfyUI processes. PR #99 exact candidate head remains `322064e8847712bcd448849441808c2b860a3aeb`, so existing authorization comment `5454521736` remains exact-head applicable. PR #99 is currently mergeable=false due docs/bookkeeping drift on main; do not rebase/update before acceptance because that would change the authorized head.

## NEXT

Fresh read-only verify production v0.19.4 at unchanged stable-runtime SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`: Director 8787 exact PID/health, ComfyUI 8188 exact PID/health and queue 0/0. If healthy, rerun the already-authorized Controlled Acceptance against exact PR #99 head `322064e8847712bcd448849441808c2b860a3aeb`, using temporary `openBrowser=false` candidate config, Comfy reuse-only, exact-PID Director control, the corrected real `spawnFn: undefined -> spawnDetached` path and mandatory restoration of production v0.19.4. Persist top-level PR #99 PASS/BLOCKED evidence and stop. Merge/deploy remain separately gated.

## ACTIVE WORK

Exactly one pointer: [ACTIVE WORKBOARD — AI Video Director specialist lanes](https://github.com/mrhz1973/ai-video-director/issues/75) (#75)

HARNESS_ENGINEERING is ACTIVE on #97 at `ACCEPTANCE_RERUN_PENDING_VERIFICATION`. IMAGE_ELEMENT_DIRECTOR, VIDEO_DIRECTOR and MASTER_FILM_DIRECTOR remain idle unless separately activated. #89 autonomous specialist intake remains a separate follow-up and is not part of #97.

## VERIFIED THROUGH

Production stable runtime authority remains **v0.19.4** at exact SHA `4202dca9ab3b46f52983ca342732e59bfe38066f`; no deploy or stable-runtime advancement is evidenced after the prior blocker. PR #99 persists the v0.19.5 `resolveDeps()` correction and side-effect-free regressions; source re-review `5036205584` is PASS; exact candidate head `322064e8847712bcd448849441808c2b860a3aeb` has CI #536 PASS. Existing Controlled Acceptance authorization remains bound to that exact candidate head. Workboard SYNC `5454794556` records the operator-reported launcher repair and required fresh runtime verification before rerun.

## GLOBAL RUNTIME INVARIANTS

- Canonical deployed Harness baseline: **v0.19.4**
- Production release SHA: `4202dca9ab3b46f52983ca342732e59bfe38066f`
- Active correction target: **v0.19.5**
- Director: `http://127.0.0.1:8787`
- ComfyUI: `http://127.0.0.1:8188`
- Desktop launcher production target: dedicated stable runtime checkout pinned to the exact deployed release SHA; never a development checkout/worktree
- Installer/reinstaller must not infer production runtime from its own development checkout and must fail closed on invalid runtime authority
- Release/deploy advances only the dedicated stable runtime checkout to the exact authorized merged release SHA before Director restart
- Director restart is exact-PID only; no broad `node.exe` kill; exact PID/identity must be freshly revalidated immediately before stop
- ComfyUI lifecycle is external to the Director and deploy must never start/stop/restart it; same PID and idle queue must be freshly revalidated before Director stop/start
- Automated Harness tests must not spawn real Director/ComfyUI processes or mutate live runtime state
- Harness detail: `docs/HARNESS_STATE.md`
- Generation authorization phrase (contract): `AUTORIZZO LA GENERAZIONE`
- Public repository: text, hashes and non-secret technical metadata only

## PRODUCTION STATE

Pointer only: see `registry/*` and the scoped production authority referenced by the active Workboard lane. Do not duplicate shot/generation/asset facts here.

## RULES

- Every functional/UI modification released to `main` advances the Harness version; docs/evidence-only bookkeeping commits are exempt.
- Evidence never self-promotes to METHOD defaults (see Issue #69 caveat).
- This file never contains chat recap, cinematic continuity dumps, or Harness release history.
