# Batch Queue runtime (v0.13.0 — Issue #47)

## Overview

The **CODA BATCH** feature adds a persistent, ordered queue of up to **50** independent Batch groups. Only **one** Batch executes at a time on the single ComfyUI lane. Batch *N+1* starts automatically after Batch *N* reaches a terminal state (when the queue is armed and authority is present).

## Plan vs authority

| Layer | Persists in project JSON | Can auto-submit after Director restart |
|-------|--------------------------|----------------------------------------|
| **Queue plan** (`batchQueue`) | Yes — entry snapshots, order, names, failure policy | **No** |
| **Runtime authority** (`queueRunId`, in-memory scheduler) | **No** | Lost intentionally on Director restart |

After **F5** (browser reload) while Director stays alive: UI reconnects to `/api/batch-queue/runtime` and displays live progress; the server scheduler continues without the tab.

After **Director restart**: plan restores from project; entries that were `submitting`/`running` become `recovery-required`; user must click **RIPRENDI CODA** to re-arm.

## UI

- **Batch — opzionale**: unchanged editable workspace; **Aggiungi alla coda** deep-clones the prepared batch without clearing the editor.
- **CODA BATCH**: summary, failure policy, **AVVIA CODA** / **RIPRENDI CODA**, grouped cards per queued batch.

While the queue is armed/running:

- **Genera singolo** and **Avvia batch** are blocked (`Coda Batch attiva.`).
- v0.12 **Interrompi job corrente** / **INTERROMPI BATCH** remain ownership-safe.

## Failure policy

- **Ferma coda** (default): failed batch → `paused-failure`; no next batch until **RIPRENDI CODA**.
- **Continua con il batch successivo**: failed batch marked failed; next eligible batch starts when lane is safe.
- Full **INTERROMPI BATCH** always pauses the multi-batch queue regardless of policy.

## Server API

- `GET /api/batch-queue/runtime?projectId=`
- `POST /api/batch-queue/sync`
- `POST /api/batch-queue/arm`
- `POST /api/batch-queue/resume`
- `POST /api/batch-queue/update-entry` (requires `expectedRevision`)
- `POST /api/batch-queue/reorder`
- `POST /api/batch-queue/cancel-entry`
- `POST /api/batch-queue/pause`

Pure modules: `lib/batch-queue-plan.mjs`, `lib/batch-queue-runtime.mjs`, `lib/batch-queue-executor.mjs`, `lib/batch-queue-service.mjs`.

Closes #47
