# Harness output management

Status: operational in v0.16.0 (Archivio locale Director).

## Goal

Keep ComfyUI's normal output/history behavior intact while letting AI Video Director archive completed renders to a user-selected local folder with readable deterministic filenames.

## Architecture (v0.16.0)

ComfyUI remains the source/staging location. The harness does **not** change ComfyUI's global output directory and does not delete, move, or rename the original generated file.

Archive writes are performed by the **Node Director server**, not by the browser File System Access API.

1. The user chooses a destination through `POST /api/archive/pick-folder` (native Windows folder picker). Absolute paths persist in `%LOCALAPPDATA%\AI Video Director\archive.json` (never in Git or project JSON).
2. Naming preferences (template, scene, variant, counter scope, auto-archive) remain browser-local for UI/preview and are snapshotted into an immutable plan when `/api/queue` returns a `prompt_id`.
3. When `/api/outputs` reports completion and auto-archive is enabled, the browser calls `POST /api/archive-output`.
4. The server resolves the source via promptId + Comfy `/history` match + realpath containment under the configured Comfy output root, allocates a collision-free filename, then `fs.copyFile` into the archive root.
5. Byte size is verified; the progressive counter advances only after a successful copy.
6. Existing filenames are never overwritten; repeated archive events for the same prompt/output are idempotent.

If archive copy fails, the original ComfyUI output remains untouched and the Director reports the archive error separately. The browser no longer requires Edge/Chrome write permission prompts for archiving.

Legacy IndexedDB directory handles from older browser-archive builds may still exist locally; they are unused for writes and are not deleted automatically.

## User controls

The OUTPUT destination section supports:

- global default directory;
- per-project directory override;
- **Scegli cartella** / **Apri cartella**;
- scene/shot label;
- optional variant label;
- editable filename template;
- progressive counter scope: project, scene, or global;
- live filename preview;
- Auto-archivia nuovi output.

Default template:

```text
{project}_{scene}_{workflow}_{model}_{mp}MP_{duration}s_{steps}st_seed{seed}_{counter:04}
```

## APIs

| Method | Path | Role |
|--------|------|------|
| `GET` | `/api/archive/config` | Destination status for a folder key |
| `POST` | `/api/archive/pick-folder` | Native picker + persist |
| `POST` | `/api/archive/open-folder` | Open archive root in Explorer |
| `POST` | `/api/archive-output` | Authoritative copy into archive |

Client absolute source/destination paths are rejected. Gallery actions **Apri video**, **Mostra nella cartella**, and **Scarica MP4** remain unchanged and continue to use Comfy originals under the configured output root.
