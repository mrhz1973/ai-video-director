# Wiki-LLM Lean METHOD

Canonical METHOD for Wiki-LLM Lean bootstrap, `agg`, Cursor packet preparation, and Cursor evidence persistence.

Authority chain: README AI-BOOT → this METHOD → `docs/contracts/CURSOR_EXECUTION_PACKET_V1.md` (Cursor task closure) → `docs/contracts/CROSS_CHAT_SYNC_V1.md` (cross-chat SYNC). LIVE STATE remains `docs/runtime/CURRENT_FRONTIER.md` only.

## Loop

```
Cursor executes
→ validates
→ PASS | BLOCKED
→ persists docs/runtime/LAST_CURSOR_REPORT.md
→ closes task
→ operator invokes agg
→ GPT Web observes persisted report
→ AUTO-VIA to next real gate
→ GPT Web prepares the next Cursor execution packet automatically
```

A result left only in Cursor chat is not evidence-complete for `agg`.

## Prompt preparation is NOT a gate

Preparing, drafting, or presenting a Cursor execution packet is non-mutating orchestration work and **never requires operator authorization**.

When `agg` or AUTO-VIA reaches a next executable task or a real human gate, GPT Web must prepare the next self-contained Cursor packet automatically instead of asking the operator whether it should prepare a prompt.

If the underlying operation itself requires explicit human authorization (for example real migration APPLY, Controlled Acceptance that touches live runtime state, merge, deploy, generation, destructive file operations, or another explicitly gated action), the authorization gate applies to **execution of that operation**, not to preparation of its packet.

Therefore:

- no `Do you want me to prepare the Cursor prompt?` gate;
- no authorization phrase is required merely to receive a prompt;
- a ready packet may be shown before the operation is authorized, but it must state `EXECUTION BLOCKED UNTIL AUTHORIZATION` and the exact required authority/evidence;
- once the required authorization is already present, GPT Web must immediately provide the executable packet without a second confirmation;
- documentation/evidence bookkeeping and prompt preparation remain AUTO-VIA work and do not consume a human gate;
- genuine operation gates remain intact and must not be bypassed.

## Evidence states

### EVIDENCE_COMPLETE

A Cursor result needed for NEXT is evidence-complete only after the required final report is persisted to GitHub as `docs/runtime/LAST_CURSOR_REPORT.md` (and reachable from remote HEAD / the PR that lands it).

### EVIDENCE_NOT_PERSISTED

The technical task may have executed, but the orchestrator-visible evidence has not yet been persisted (absent, stale, or non-matching `LAST_CURSOR_REPORT`).

### TASK_NOT_EXECUTED

Must never be inferred merely from an absent or stale report. Absence of GitHub evidence does not prove Cursor did not execute the task.

## Operator-relayed evidence

If the operator supplies the complete missing Cursor final report to GPT Web, GPT Web may persist it as:

`SOURCE: operator-relayed Cursor evidence`

AUTO-VIA may continue without rerunning the technical task.

## Persistence scope

Persisting `LAST_CURSOR_REPORT` is bookkeeping / docs-only. It:

- does not reopen a runtime gate;
- does not authorize new operations;
- does not change technical PASS / BLOCKED;
- exists only to synchronize GitHub-visible evidence for `agg`.

## `agg` (conditional)

When a Cursor pass result is required to determine NEXT:

`remote HEAD → CURRENT_FRONTIER → Workboard / own ACTIVE lane → addressed SYNC after LAST_SYNC → LAST_CURSOR_REPORT once → explicitly pointed evidence only if necessary → AUTO-VIA → prepare next Cursor packet automatically`

Do not turn `agg` into a full reboot. Read `LAST_CURSOR_REPORT` only when needed for NEXT.

At a genuine human gate, stop execution at the gate, but still prepare the next packet automatically. The operator should only be asked for the authorization that changes real state, never for permission to draft the packet.

## Report file

`docs/runtime/LAST_CURSOR_REPORT.md` is the latest Cursor pass record (overwrite). Historical detail stays in issue / PR / commit. Public-repo policy applies: no secrets, no local absolute paths, no personal media/data, no transcript dump.
