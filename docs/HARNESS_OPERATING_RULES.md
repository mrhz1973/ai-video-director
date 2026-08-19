# MiniMax H3 harness — operating rules

Updated: 2026-08-20
Canonical branch: `main`

This file records user-facing operating rules for safe day-to-day use of the local MiniMax H3 harness. Read it together with `docs/HARNESS_STATE.md` and `docs/HARNESS_ROADMAP.md`.

## Generation submission is an explicit gate

Preparing a run and submitting a run are separate actions.

Before any generation is submitted, the user must be able to review the effective run settings and reference selection. Automation must not silently turn a preparation step into a generation.

For routine use:

1. prepare the prompt, workflow, model, quality, duration, aspect ratio, steps, seed and references;
2. verify that the ComfyUI queue is empty or that any existing job is understood;
3. show the prepared state to the user;
4. stop before submission unless the user has explicitly asked to generate;
5. submit exactly one job only after that explicit instruction.

Do not infer generation approval merely because a previous preparation task succeeded.

## Browser ownership

The user's normal operational browser is the user-owned browser session. Cursor-controlled or automation-controlled browser profiles are not the preferred interface for routine generation submission.

Reasons:

- an automation browser may use a different profile or incomplete browser setup;
- multiple browser tabs can show different local form values while all observing the same active backend job;
- browser automation can make it unclear which visible settings were actually submitted;
- file attachment handling may differ between an automation browser and the user's browser.

Therefore:

- prefer the user's own browser for visual review and the final Generate action;
- Cursor may inspect backend/API state, prepare text, validate files/settings and perform read-only diagnostics;
- do not open a separate visible automation browser merely to press Generate unless the user explicitly requests browser automation for that run;
- when an automation browser is used, report the exact submitted job/prompt ID and effective settings immediately after submission.

## Source of truth after submission

Browser form fields are not authoritative for an already-running job. Another tab may show defaults or stale values while recovering the same active prompt through `/api/active`.

For a submitted job, the source of truth is the actual ComfyUI queued/running graph and job metadata.

When diagnosing a running generation, identify at minimum:

- prompt/job ID;
- workflow/mode;
- model;
- duration;
- steps;
- seed;
- aspect/resolution conditioning;
- effective uploaded reference(s), where safely identifiable;
- running and pending queue counts.

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
