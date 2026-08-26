# CURSOR_EXECUTION_PACKET_V1

Contract for Cursor (and equivalent coding-agent) task closure when the result is required by the Wiki-LLM Lean orchestrator's next `agg`.

METHOD owner: `docs/method/WIKI_LLM_LEAN.md`.  
Report file: `docs/runtime/LAST_CURSOR_REPORT.md`.

## Required rule

Before declaring the task closed, if the task result is required by the orchestrator's next `agg`, persist the final evidence/report to `docs/runtime/LAST_CURSOR_REPORT.md`. A result left only in Cursor chat is not evidence-complete.

The report must be persisted **before** the task is declared closed.

## Report discipline

- Overwrite `LAST_CURSOR_REPORT` for the latest relevant Cursor pass (not a historical log).
- Keep STATUS as `PASS` or `BLOCKED` and set `EVIDENCE_STATE: EVIDENCE_COMPLETE` only when the persisted report matches this pass.
- Record enough for deterministic `agg`: TASK_REF, STATUS, SOURCE, BASE_MAIN_SHA, WORK_REF, COMMIT, PR, VALIDATION, RUNTIME_TOUCHED, SUMMARY, NEXT_RELEVANCE.
- No secrets, local absolute paths, personal media/data, or unnecessary transcript dumps.

## Classification reminder for `agg`

Absent / stale / non-matching `LAST_CURSOR_REPORT` ⇒ `EVIDENCE_NOT_PERSISTED`, not `TASK_NOT_EXECUTED`.
