# LAST_CURSOR_REPORT

TASK_REF: #97  
TARGET_VERSION: 0.19.4  
ROLE: HARNESS_ENGINEERING  
STATUS: PASS  
EVIDENCE_STATE: EVIDENCE_COMPLETE  
SOURCE: Cursor  
BASE_MAIN_SHA: 06bbf4832dd3d93ff3d54f3b7cfa3c22dab84397  
WORK_REF: fix/issue-97-stable-runtime-v0194  
COMMIT: (pending push)  
PR: (pending)  
VALIDATION: npm test 972/972 PASS; validate_project.py PASS  
CI: (pending exact-head)  
RUNTIME_TOUCHED: NO  

## SUMMARY

- **Implementation branch:** `fix/issue-97-stable-runtime-v0194` from `origin/main` @ `06bbf48`
- **Version:** `0.19.3` → **`0.19.4`** (package/UI/API coherent)
- **Explicit runtime-root design:** `launcher.json.runtimeRoot` + mandatory installer `-RuntimeRoot`; production harness = `<runtimeRoot>\comfyui-harness`; no inference from installer source checkout
- **Installer dev-checkout regression:** `Install-AIVideoDirectorLauncher.ps1` requires `-RuntimeRoot`; Desktop shortcut + WorkingDirectory bind to stable runtime Start script (never `Get-HarnessRoot` from dev checkout)
- **Launcher mismatch guard:** `runStart()` fail-closed via `assertHarnessRootMatchesRuntimeAuthority()` when configured runtime root disagrees with executing harness root
- **Runtime validation:** `lib/stable-runtime.mjs` — filesystem/git/detached/clean/desktop/queue checks (testable, no auto-clean/reset/stash)
- **Deployment design:** `lib/windows-runtime-deploy.mjs` + `deploy-runtime-cli.mjs` + `Deploy-AIVideoDirectorRuntime.ps1`; authority = exact `-ReleaseSha` (fetch + detached checkout only); idempotent noop when already at SHA + healthy Director
- **Exact-PID semantics:** deployment stops only verified Director PID via injected `stopProcessFn`; no broad node/python kill
- **ComfyUI external/no-restart:** deployment preflight reads health/queue/PID; never stops/starts ComfyUI; requires same PID pre/post
- **Idempotent behavior:** same SHA + expected version + healthy Director → `action: noop`, spawn 0
- **npm test:** 972 tests, 0 failures (+24 new stable-runtime/deploy regressions)
- **Validator:** PASS
- **Production runtime untouched:** YES (`ai-video-director-runtime` @ `01a4d90` / v0.19.3)
- **Desktop shortcut untouched:** YES
- **Director restart:** NO
- **ComfyUI restart:** NO
- **Generation:** 0 | **Upload:** 0 | **Queue mutation:** NO | **GPU mutation:** NO | **Project mutation:** NO

## NEXT_RELEVANCE

Orchestrator source review #97. Live deploy/install remains operator-gated.
