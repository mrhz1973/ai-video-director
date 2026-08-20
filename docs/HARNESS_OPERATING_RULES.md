# MiniMax H3 harness — operating rules

Updated: 2026-08-20
Canonical branch: `main`

This file records user-facing operating rules for safe day-to-day use of the local MiniMax H3 harness. Read it together with `docs/HARNESS_STATE.md` and `docs/HARNESS_ROADMAP.md`.

## Generation submission is an explicit gate

Preparing a run and submitting a run are separate actions.

Before any generation is submitted, the user must be able to review the effective run settings and reference selection. Automation must not silently turn a preparation step into a generation.

For routine use:

1. prepare the prompt, workflow, model, megapixels, duration, aspect ratio, steps, seed and references;
2. verify that the ComfyUI queue is empty or that any existing job is understood;
3. show the prepared state to the user;
4. stop before submission;
5. the user performs the final `Genera` action manually in the normal browser session.

Do not infer generation approval merely because a previous preparation task succeeded.

## Standard operating split: Director / Cursor / user

The default operating model is deliberately split into three roles:

- **Director/assistant**: writes and refines the H3 prompt, chooses the intended workflow and generation settings, and defines what Cursor should prepare.
- **Cursor/automation**: checks or starts the required local services when needed, prepares the harness form completely, loads the requested references, pastes the exact prompt and sets the requested values, then stops.
- **User**: visually reviews the prepared run in the normal browser session and clicks `Genera` manually.

Cursor must not submit `/api/queue`, press `Genera`, or otherwise start a generation during a prepare-only task.

The purpose of automation is to remove repetitive setup work while keeping the final paid/expensive generation action visible and under direct user control.

## Local service preparation

Cursor may prepare the local runtime before filling the harness:

1. check whether ComfyUI is listening on `127.0.0.1:8188`;
2. if ComfyUI is already running, leave it running and do not restart it;
3. if ComfyUI is not running, start the known local ComfyUI installation using the established launcher, then wait until port `8188` responds;
4. check whether the Node harness is listening on `127.0.0.1:8787`;
5. if the harness is already running, leave it running unless a restart is genuinely required by a runtime code change;
6. if the harness is not running, start the existing Node harness and wait until port `8787` responds;
7. verify `queue_running = []` and `queue_pending = []` before preparing a new run.

If an existing job is running or pending, do not overwrite or submit another job. Stop and report the active queue state first.

Starting a missing service for preparation is allowed; restarting an already-running service without a concrete need is not.

## Browser ownership

The user's normal operational browser is the user-owned browser session. Cursor-controlled or automation-controlled browser profiles are not the preferred interface for routine generation submission.

Reasons:

- an automation browser may use a different profile or incomplete browser setup;
- multiple browser tabs can show different local form values while all observing the same active backend job;
- browser automation can make it unclear which visible settings were actually submitted;
- file attachment handling may differ between an automation browser and the user's browser.

Therefore:

- prefer the user's own browser for visual review and the final Generate action;
- Cursor may inspect backend/API state and may prepare the harness form, including workflow, model, megapixels, duration, aspect ratio, steps, seed, prompt and requested reference files;
- Cursor preparation must stop with the run visibly ready but unsent;
- do not open a separate visible automation browser merely to press Generate;
- do not submit a generation from an automation browser during the standard prepare-only workflow;
- if the user explicitly requests automated submission for a specific run, treat that as a separate instruction and immediately report the exact submitted job/prompt ID and effective settings.

## Source of truth after submission

Browser form fields are not authoritative for an already-running job. Another tab may show defaults or stale values while recovering the same active prompt through `/api/active`.

For a submitted job, the source of truth is the actual ComfyUI queued/running graph and job metadata. The harness progress monitor shows **current-node** `value/max` from live events; treat that percentage as node progress, not guaranteed whole-job completion. The Eventi/Terminale panels are read-only and must not be used to cancel, reorder or resubmit jobs.

When diagnosing a running generation, identify at minimum:

- prompt/job ID;
- workflow/mode;
- model;
- duration;
- steps;
- seed;
- aspect ratio and the exact megapixels value bound to node `115`;
- effective uploaded reference(s), where safely identifiable;
- running and pending queue counts.

The `Megapixel` field is the authoritative resolution control. The `≈ WxH · class` text beside it is a read-only hint and must never be reported as a submitted setting; report the megapixels value and aspect ratio instead.

Do not cancel or resubmit merely because another browser tab displays different form defaults.

## Cancellation rule

If the user decides to abort a known job, prefer targeted cancellation by job/prompt ID when the installed ComfyUI API supports it. After cancellation, verify that both `queue_running` and `queue_pending` are empty before preparing a replacement run.

A generic interrupt is a fallback for the current execution and should not be used as the first choice when a precise job cancellation endpoint is available.

Never restart ComfyUI or kill its Python process merely to cancel one generation unless the user explicitly authorizes that stronger action.

## Automation/code-change boundary

A generation task must not modify harness source code or helper scripts unless code modification was explicitly part of the requested task.

If Cursor or another agent reports source edits during a generation-only operation, stop after the current safety action and inspect Git status before the next run. Unplanned code changes must be reviewed separately from generation execution.

## Durable reporting

For meaningful runs and experiments, retain safe text metadata such as mode, prompt strategy/version, settings, model, seed, outcome and verdict. Do not commit private reference filenames, local absolute paths, media or generated files to the public repository.

Operational lessons that change how future runs should be performed must be written back to this repository rather than left only in chat history.
