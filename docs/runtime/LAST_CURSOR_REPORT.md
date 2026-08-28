# LAST_CURSOR_REPORT

TASK_REF: #100 / v0.19.6 source implementation
STATUS: PASS
EVIDENCE_STATE: EVIDENCE_COMPLETE
TARGET_VERSION: 0.19.6
BASE_MAIN_SHA: 01da1dafb27497f9ea553228fcbf263f2e103295
WORK_REF: fix/issue-100-project-store-gpu-v0196
SOURCE: Cursor Agent (#100 task delta)
RUNTIME_TOUCHED: NO (source-only; no production restart/deploy/migration)

## SUMMARY

v0.19.6 source implementation for #100: persistent project-store authority via `H3_PROJECT_DIRECTORY` / `%LOCALAPPDATA%\AI Video Director\projects`, copy-only migration plan/apply tooling with temp-fixture tests, GPU compact expand/collapse CSS fix for BATCH/CODA/OUTPUT, version coherence 0.19.6.

## PROJECT-STORE RESOLUTION CONTRACT

Precedence: `H3_PROJECT_DIRECTORY` (fail-closed if set empty) → `config.projectDirectory` (dev/test) → Windows `default-persistent` → checkout `./projects` fallback. Launcher `buildDirectorCommand` injects persistent path when env unset. `/api/config.projectStore` exposes read-only `{ source, directory, persistent }`.

## MIGRATION TOOL CONTRACT

`lib/project-migration.mjs` + `scripts/projects-migrate-cli.mjs`: PLAN (zero writes) / APPLY (`--activate` only). Classifications: COPY_REQUIRED, IDENTICAL_ALREADY_PRESENT, SAME_ID_DIFFERENT_CONTENT, INVALID_SOURCE. Copy-only, fail-if-exists, SHA-256 verify, source untouched. No real operator store APPLY in this pass.

## GPU CORRECTION

`design-system.css`: compact hide rules scoped to `:not(.is-expanded)` so Espandi/Comprimi reveals ECO/BALANCED/NORMAL in BATCH/CODA/OUTPUT; SCENA unchanged; toggle remains display-only (no POST).

## VALIDATION

- npm test: 1021 pass / 0 fail
- python scripts/validate_project.py: PASS

## SIDE EFFECTS (explicit)

real project copies = 0 | moves = 0 | deletes = 0 | renames = 0 | production project writes = 0 | production restart = 0 | ComfyUI lifecycle = 0 | GPU writes = 0 | generation = 0 | upload = 0 | queue mutation = 0 | Desktop rewrite = 0 | real migration APPLY = 0

## NEXT_RELEVANCE

Orchestrator agg: PR review/merge decision; operator migration of 14 legacy projects is a separate authorized step (not executed here).
