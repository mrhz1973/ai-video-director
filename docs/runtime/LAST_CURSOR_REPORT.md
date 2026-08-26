# LAST_CURSOR_REPORT

TASK_REF: #95  
TASK: Fix blocked controlled acceptance — lib→public browser import boundary  
ROLE: HARNESS_ENGINEERING  
STATUS: PASS  
EVIDENCE_STATE: EVIDENCE_COMPLETE  
SOURCE: Cursor  
BASE_MAIN_SHA: ceb58d36f0e0abb2154ac660cb1f7dd0edb0ca5c  
WORK_REF: feat/issue-95-uiux-wave3-v0193  
COMMIT: 0efb650  
PR: https://github.com/mrhz1973/ai-video-director/pull/96  
VALIDATION: npm test 948/948 PASS; validate_project.py PASS  
CI: (pending exact-head)  
RUNTIME_TOUCHED: NO  

## SUMMARY

- **Main realignment** — merged `origin/main` @ `ceb58d3` (docs/state bookkeeping only; CURRENT_FRONTIER / Workboard / #97 preserved).
- **Root cause** — `lib/h3-model-registry.mjs` imported `../public/output-naming.mjs`; browser served at `/lib/h3-model-registry.mjs` resolved dependency to **`GET /public/output-naming.mjs` → 404** (Harness serves public modules at site root `/output-naming.mjs`).
- **Architectural fix** — extracted isomorphic helpers to **`lib/model-name.mjs`** (`sanitizeOutputSegment`, `shortModelName`); `h3-model-registry.mjs` now imports `./model-name.mjs`; `public/output-naming.mjs` re-exports from lib. **lib → public dependency eliminated** in browser graph.
- **Old failing browser URL:** `/public/output-naming.mjs`
- **Corrected browser dependency URL:** `/lib/model-name.mjs`
- **Browser import-graph regression** — `browser-static-import-graph.test.mjs` (4 tests): walks index.html module entries, proves `h3-model-registry` + `model-name` reachable, forbids `/public/*` URLs and `../public/*` imports in served lib modules; includes stale-URL negative proof.
- **Friendly-label regression** — existing `model-registry.test.mjs` + `output-naming.test.mjs` PASS unchanged behavior (`H3 Q4`, `H3 Q8CR`, `H3 Ref Q4`).
- **Wave 3 preserved** — v0.19.3 (no bump), model discovery, zero-model fail-safe, batch gates, CSS consolidation, Wave 1/2, SYSTEM NOT_IMPLEMENTED_BY_DESIGN.
- **npm test** — 948 tests, 0 failures.
- **Validator** — PASS.
- **Generation** — 0 | **Upload** — 0 | **Queue mutation** — NO | **GPU mutation** — NO | **Project mutation** — NO | **Director restart** — NO | **ComfyUI restart** — NO.

## NEXT_RELEVANCE

Operator may re-run controlled UI acceptance on new PR head. Merge/deploy remain separate gates.
