# CURSOR_EXECUTION_PACKET_V1

Contract for Cursor (and equivalent coding-agent) task closure when the result is required by the Wiki-LLM Lean orchestrator's next `agg`.

METHOD owner: `docs/method/WIKI_LLM_LEAN.md`.  
Report file: `docs/runtime/LAST_CURSOR_REPORT.md`.

## Packet-preparation rule

GPT Web may prepare and present a Cursor execution packet at any time under AUTO-VIA. **Packet preparation is not an operator gate and requires no authorization.**

If the packet contains an operation that itself requires explicit human authorization, the packet must distinguish preparation from execution:

- when authority is absent, state `EXECUTION BLOCKED UNTIL AUTHORIZATION` and identify the exact required authority/evidence;
- when authority is already present, the packet is immediately executable and GPT Web must not ask for an additional confirmation merely to provide it;
- Cursor must never infer operational authorization from the existence of a prepared packet.

Real operation gates defined by the active Workboard/runtime contract remain authoritative.

## Required closure rule

Before declaring the task closed, if the task result is required by the orchestrator's next `agg`, persist the final evidence/report to `docs/runtime/LAST_CURSOR_REPORT.md`. A result left only in Cursor chat is not evidence-complete.

The report must be persisted **before** the task is declared closed.

## Report discipline

- Overwrite `LAST_CURSOR_REPORT` for the latest relevant Cursor pass (not a historical log).
- Keep STATUS as `PASS` or `BLOCKED` and set `EVIDENCE_STATE: EVIDENCE_COMPLETE` only when the persisted report matches this pass.
- Record enough for deterministic `agg`: TASK_REF, STATUS, SOURCE, BASE_MAIN_SHA, WORK_REF, COMMIT, PR, VALIDATION, RUNTIME_TOUCHED, SUMMARY, NEXT_RELEVANCE.
- For gated execution, record the concrete authorization/evidence reference actually consumed.
- No secrets, local absolute paths, personal media/data, or unnecessary transcript dumps.

## Classification reminder for `agg`

Absent / stale / non-matching `LAST_CURSOR_REPORT` ⇒ `EVIDENCE_NOT_PERSISTED`, not `TASK_NOT_EXECUTED`.
