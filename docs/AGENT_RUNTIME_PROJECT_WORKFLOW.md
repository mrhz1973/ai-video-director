# Agent runtime, project isolation, and dedicated first-frame workflow

Status: operational policy for AI agents working with the local MiniMax H3 / AI Video Director stack.

This document clarifies who owns local service startup, how agents must handle projects, and how externally prepared cinematic first frames are bound to I2VA jobs.

## 1. Runtime ownership

The Windows one-click launcher is the canonical human startup path for the local stack. It health-checks ComfyUI on `127.0.0.1:8188` and AI Video Director on `127.0.0.1:8787`, reuses healthy services, starts missing services exactly once, and fails closed on unexpected port ownership.

`comfyui-harness/server.mjs` itself is not a ComfyUI service manager. These statements are compatible: the external Windows launcher may start ComfyUI + Director, while the Node harness runtime does not own ComfyUI lifecycle.

### When the user says the stack is already started

An AI agent must:

1. Probe Director with `GET http://127.0.0.1:8787/api/config`.
2. Probe ComfyUI with `GET http://127.0.0.1:8188/system_stats` when ComfyUI health matters to the requested task.
3. Reuse the existing healthy instances.

The agent must not:

- click or automate the Desktop shortcut;
- run `Start-AIVideoDirector.ps1` again;
- run `node server.mjs` manually;
- start ComfyUI Python manually;
- start a second harness or ComfyUI instance;
- restart, stop, or kill healthy services;
- broadly kill `node.exe` or `python.exe`.

If an expected service is missing or unhealthy, stop and report the condition. Do not repair or start it unless the user explicitly asks the agent to perform startup/recovery.

### When the user explicitly asks the agent to start the stack

Use only the canonical Windows launcher path documented in `comfyui-harness/scripts/windows/README.md`. Do not substitute ad-hoc Node/Python startup commands. Respect the launcher's fail-closed port ownership checks.

Never restart either service during a live generation without explicit user approval.

## 2. Project isolation

When the user requests a new production project, create a new Director project with its own unique id.

Do not silently reuse, rename, overwrite, or mutate an existing project merely because it is currently loaded in the browser.

Rules:

- `POST /api/projects` is the normal path for a brand-new project.
- Project duplication is used only when the user explicitly wants to inherit an existing project. Harness **Salva come…** (v0.10.0, Issue #50) POSTs a new project from the current editor snapshot; the source project id is unchanged and runtime execution authority is not copied.
- **Genera singolo** (v0.11.0, Issue #53) submits exactly one clip from current editor/Input bindings. It must not mutate prepared Batch jobs or infer Batch execution from Numero job. Batch runs only after an explicit **Avvia batch** user action.
- **Runtime interruption** (v0.12.0, Issue #51): Single/Batch stop controls require live ComfyUI queue verification plus server in-memory ownership from the originating `POST /api/queue`. Never kill processes, never clear the whole ComfyUI queue, never mutate project JSON or editable Batch draft. See `docs/COMFYUI_RUNTIME_CONTROL.md`.
- **Multi-Batch queue** (v0.13.0, Issue #47): `batchQueue` in project JSON is plan-only. Arming/resuming (`POST /api/batch-queue/arm|resume`) requires explicit user action. Never auto-arm after Director restart. See `docs/BATCH_QUEUE_RUNTIME.md`.
- Before writing a Batch draft, verify the intended project's `id` and `label`.
- Save draft data only into the intended project.
- Do not delete or clear another project's `batchDraft` as cleanup unless the user explicitly requests it.
- Local `*.local.json` project files remain private and Git-ignored.

A project draft never implies submit authority.

## 3. Draft-only safety

Preparing and saving prompts, settings, `batchDraft`, and `batchQueue` plan entries is allowed when requested.

Unless the user explicitly requests generation, the agent must not:

- POST `/api/queue`;
- POST ComfyUI `/prompt`;
- click Generate / Genera;
- click Queue batch / Metti batch in attesa;
- arm queued-next execution;
- change GPU power;
- cancel existing jobs.

After writing a draft, read the saved project back and verify the server state before reporting success.

## 4. Dedicated first-frame I2VA workflow

A multi-shot I2VA sequence may use one independently prepared first-frame image per job.

This is a supported production pattern and is distinct from a chained workflow such as:

`video N final frame -> extract -> video N+1 first frame`.

When the production plan specifies dedicated first frames:

- each job has its own canonical neutral filename or asset label;
- from harness **v0.8.9**, bind those files explicitly via Batch per-job Input selectors (`item.files`), not by parsing prompt text;
- `source.files` remains a shared fallback for jobs without an override;
- the image is produced outside the harness by the image-reference / cinematic-keyframe workflow;
- the user may bind the images manually in Director before submission;
- the draft may still mention intended first-frame labels in prompt text for human readability, but prompts do **not** auto-resolve assets;
- an existing safe placeholder may remain temporarily bound only when the UI/schema requires it;
- do not invent a local path for a missing image;
- do not automatically extract frames from previous videos;
- do not automatically rebind first frames unless the user explicitly requests that action;
- do not submit while placeholder or missing first-frame bindings remain unresolved.

Neutral production filenames may be documented publicly when they do not reveal private filesystem paths or personal source filenames. Image bytes, local upload ids, ChatGPT file ids, and private ComfyUI input paths must never be committed.

## 5. Image creation routing

Production first-frame photographs, character reference repairs, body/tattoo continuity images, and other cinematic stills should be authored through the project's image-reference workflow and the Lira image skill.

The H3 harness/Director workflow should coordinate:

- project identity;
- job order;
- prompt text;
- seeds;
- duration;
- megapixels;
- workflow/model selection;
- intended first-frame labels;
- draft persistence.

It should not become a second image-generation or identity-reconstruction system.

For exact character marks such as tattoos, the dedicated tattoo reference is authoritative for design, scale, orientation, color state, and anatomical position. A generated still that reinterprets the artwork must be rejected rather than promoted as a new continuity master.

## 6. Recommended agent preflight for a new I2VA sequence

1. Read the repository handoff and harness state.
2. Read this policy.
3. Load the MiniMax H3 Director skill; load Lira when first-frame/reference preparation is part of the task.
4. Determine whether the user has already started the stack.
5. If already started, health-probe only and reuse.
6. Confirm whether the user wants a new project or an existing project.
7. Create/verify the intended project before writing Batch state.
8. Prepare the draft without submit authority.
9. Record dedicated first-frame filenames/labels when applicable.
10. Verify the saved server-side draft.
11. Stop before generation unless generation was explicitly requested.

## 7. Public repository boundary

This policy is text-only. Never commit:

- photographs or generated image bytes;
- video or audio;
- private local project JSON;
- absolute local paths;
- private ComfyUI API exports;
- account/file-library identifiers;
- secrets or credentials.

GitHub stores the durable rules and neutral production metadata; media remains external.
