# ComfyUI runtime control (Issue #51)

This document records the audited local ComfyUI interrupt and selective queue-delete contracts used by AI Video Director v0.12.0. Development and tests use mock ComfyUI only; no destructive calls were made against a live instance during implementation.

## Audited ComfyUI build

- Version: **0.32.0**
- Commit: `c2bcbecd82ec5ae66594340b395c24ef0217b238`
- Source reference: `server.py` in the local portable install (path omitted from the public repo)

## Interrupt endpoint

| Property | Value |
|----------|--------|
| Method | `POST` |
| Path | `/interrupt` |
| Body | `{ "prompt_id": "<uuid>" }` — **required** for Director; omitting `prompt_id` is a global interrupt and is never used |
| Behavior | Interrupts only when the given `prompt_id` matches a **currently running** job; otherwise no-op |
| No job running | Safe no-op / log only |

## Selective queue delete

| Property | Value |
|----------|--------|
| Method | `POST` |
| Path | `/queue` |
| Body | `{ "delete": ["<prompt_id>", ...] }` |
| Behavior | Removes **pending** items whose `prompt_id` matches; never affects the running job |
| Forbidden | `{ "clear": true }` or any whole-queue clear |

## Queue entry shape

GET `/queue` returns `queue_running` and `queue_pending`. Each entry is a tuple; **`prompt_id` is index `[1]`**.

## Director ownership model

- In-memory registry only (not persisted to project JSON or disk).
- On successful `POST /api/queue`, the server records `promptId → { kind, batchId?, batchIndex?, clientId }`.
- Single renders: `kind: "single"`.
- Batch jobs: `kind: "batch"` with `x-h3-batch-id` / `x-h3-batch-index` headers.
- **Director restart** clears the registry; destructive controls fail closed with a user-visible message.
- Browser runtime metadata alone cannot authorize deletion.

## Harness API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/runtime/ownership?promptId=` | Read-only ownership check |
| `GET /api/runtime/ownership?batchId=` | Batch ownership check |
| `POST /api/runtime/interrupt-single` | `{ expectedPromptId }` |
| `POST /api/runtime/interrupt-batch-current` | `{ batchId, expectedPromptId }` |
| `POST /api/runtime/stop-batch` | `{ batchId, expectedRunningPromptId }` |

All destructive paths:

1. Fetch live ComfyUI `/queue`.
2. Verify expected running `prompt_id` when interrupting.
3. Verify server ownership before interrupt/delete.
4. Call audited ComfyUI endpoints only.
5. Re-fetch queue after pending deletes to verify removal.

## Semantics

### Single — INTERROMPI RENDER

- Confirmation required.
- Live running prompt must equal expected prompt.
- Does not clear queue, delete pending jobs, mutate project/Batch draft, or delete outputs.

### Batch current job — INTERROMPI JOB CORRENTE

- Interrupts only the running owned job.
- Pending jobs for the same Batch **remain queued** and continue automatically.

### Full Batch — INTERROMPI BATCH

- Interrupts owned running job (if any).
- Deletes owned **pending** prompt IDs only.
- Preserves unrelated ComfyUI queue entries and completed Batch outputs.

## Process safety

Runtime interruption does **not**:

- stop or restart ComfyUI;
- stop or restart Director;
- kill `python.exe` or `node.exe`;
- delete output files;
- write project or editable Batch draft data.

## Stable runtime deployment (Issue #97)

Windows production **stable runtime checkout** advancement and Desktop launcher authority are separate from ComfyUI interrupt/delete contracts. Deployment uses exact authorized release SHAs, detached runtime checkouts, exact-PID Director restart, and ComfyUI external lifecycle preservation. See `comfyui-harness/scripts/windows/README.md`.
