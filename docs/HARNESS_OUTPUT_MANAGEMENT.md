# Harness output management

Status: implementation branch for Issue #15.

## Goal

Keep ComfyUI's normal output/history behavior intact while letting the AI Video Director archive completed renders to a user-selected local folder with readable deterministic filenames.

## Architecture

ComfyUI remains the source/staging location. The harness does **not** change ComfyUI's global output directory and does not delete, move, or rename the original generated file.

The browser-side Output manager:

1. lets the user choose a destination directory with Edge/Chromium's File System Access API;
2. stores the directory handle locally in IndexedDB, never in Git;
3. stores output preferences in browser-local storage, scoped globally or to the selected project;
4. captures an immutable output plan when `/api/queue` returns a `prompt_id`;
5. when the existing harness requests `/api/outputs` after successful completion, fetches the original output through the existing `/api/view` URL and copies it into the selected directory;
6. validates the written byte size and advances the progressive counter only after a successful copy;
7. never silently overwrites an existing filename.

If archive copy fails, the original ComfyUI output remains untouched and the Director reports the archive error separately.

## User controls

The Output section supports:

- global default directory;
- per-project directory override;
- scene/shot label;
- optional variant label;
- editable filename template;
- progressive counter scope: project, scene, or global;
- live filename preview;
- opt-in/out automatic copy at render completion.

Default template:

```text
{project}_{scene}_{workflow}_{model}_{mp}MP_{duration}s_{steps}st_seed{seed}_{counter:04}
```

Example:

```text
Portovenere_followme_I2VA_Q8CR_0.3MP_15s_20st_seed628211386369717_0001.mp4
```

Recognized useful tokens currently include:

- `{project}`
- `{scene}`
- `{variant}`
- `{workflow}`
- `{model}`
- `{mp}`
- `{duration}`
- `{steps}`
- `{seed}`
- `{aspect}`
- `{counter}` or `{counter:04}` / another width

## Privacy and safety

The browser directory handle is private local state. Chromium intentionally does not expose the full absolute filesystem path to page JavaScript; the UI therefore displays the selected directory name, not a Windows absolute path.

No directory handle, personal absolute path, generated video, ComfyUI private workflow, or local project media is committed to the public repository.

The archive manager is deliberately non-blocking for generation: it wraps the existing browser fetch path but always lets the original harness request proceed. Archive bookkeeping errors cannot reject a valid `/api/queue` request or remove a ComfyUI output.

## Current scope / follow-ups

This first implementation targets the user's immediate requirements: select destination, choose naming, progressive numbering, and automatic copy after a normal harness generation.

Issue #15 remains the source of truth for follow-ups, including deeper batch UI integration, richer archive history, and any future native/server-side archive mode if atomic filesystem moves or Explorer integration become necessary.

## Browser requirement

Direct destination selection requires a current Chromium-family browser implementing `window.showDirectoryPicker`, such as Microsoft Edge. If the API is unavailable, generation continues normally and ComfyUI keeps its original outputs; only automatic external archiving is unavailable.
