# Windows one-click launcher (v0.19.4)

Definitive Windows launcher for the local AI Video stack:

- ComfyUI on `http://127.0.0.1:8188`
- AI Video Director on `http://127.0.0.1:8787`
- Browser opens only after Director health succeeds

## Development checkout ≠ stable runtime checkout

The Desktop shortcut and production Director **must** target a dedicated **stable runtime** repository/worktree — never a development/feature checkout.

| Role | Location |
|------|----------|
| Development / PR work | Any normal clone or worktree used for source changes |
| **Production runtime** | Dedicated stable runtime root (local-only path, not committed) |
| Runtime harness | `<stable-runtime-root>\comfyui-harness` |
| Launcher entry | `<stable-runtime-root>\comfyui-harness\scripts\windows\Start-AIVideoDirector.ps1` |

Installing or reinstalling from a development checkout is supported **only** when `-RuntimeRoot` explicitly names the stable runtime root. The installer never infers production authority from its own source location.

## Tracked files

| File | Purpose |
|------|---------|
| `Start-AIVideoDirector.ps1` | User-facing launcher entry point |
| `Get-AIVideoDirectorStatus.ps1` | Read-only status command |
| `Install-AIVideoDirectorLauncher.ps1` | Creates local config + Desktop shortcut (requires `-RuntimeRoot`) |
| `Deploy-AIVideoDirectorRuntime.ps1` | Reusable stable-runtime deployment entry point |
| `launcher-lib.ps1` | Shared PowerShell helpers |
| `launcher-cli.mjs` | Node orchestration (health probes, detached starts) |
| `deploy-runtime-cli.mjs` | Node deployment planning/execution |

Core logic lives in:

- `comfyui-harness/lib/windows-launcher.mjs`
- `comfyui-harness/lib/stable-runtime.mjs`
- `comfyui-harness/lib/windows-runtime-deploy.mjs`

## Local machine config (not committed)

Installer writes:

`%LOCALAPPDATA%\AI Video Director\launcher.json`

Example:

```json
{
  "runtimeRoot": "D:\\path\\to\\ai-video-director-runtime",
  "comfyRoot": "D:\\path\\to\\ComfyUI_portable",
  "openBrowser": true,
  "comfyTimeoutSeconds": 180,
  "directorTimeoutSeconds": 30
}
```

`runtimeRoot` is the dedicated stable runtime repository/worktree root. Machine-specific absolute paths must never be committed to the public repository.

## First install / reinstall

From PowerShell (installer may be run from **any** checkout):

```powershell
cd <any-checkout>\comfyui-harness\scripts\windows
.\Install-AIVideoDirectorLauncher.ps1 `
  -RuntimeRoot 'D:\path\to\ai-video-director-runtime' `
  -ComfyRoot 'D:\path\to\ComfyUI_portable'
```

This:

1. Validates the stable runtime root (filesystem + harness layout)
2. Writes local launcher config including `runtimeRoot`
3. Creates a Desktop shortcut that launches **the stable runtime** — not the installer checkout

Fail-closed: missing/invalid `-RuntimeRoot` → no shortcut write.

## Start

Double-click **AI Video Director** on the Desktop, or run the stable-runtime copy of:

```powershell
.\Start-AIVideoDirector.ps1
```

Startup cross-check: if the launcher script is executed from a harness root that disagrees with configured `runtimeRoot`, startup **fails closed** before Director mutation.

Startup order:

1. Validate local config + runtime-root authority
2. Probe ComfyUI `/system_stats`
3. Reuse healthy ComfyUI or start exactly one ComfyUI process
4. Probe Director `/api/health`
5. Reuse healthy Director or start exactly one `node server.mjs`
6. When `openBrowser` is true and both health gates succeed, open Director then ComfyUI

Re-running while both services are healthy at the same version is safe and idempotent (`spawn 0`).

## Deploy stable runtime release (Issue #97)

Deployment authority is always an **exact authorized release SHA** — never incidental `main` HEAD.

```powershell
cd <any-checkout>\comfyui-harness\scripts\windows
.\Deploy-AIVideoDirectorRuntime.ps1 `
  -RuntimeRoot 'D:\path\to\ai-video-director-runtime' `
  -ReleaseSha '<exact-merge-or-release-sha>' `
  -ExpectedVersion '0.19.4'
```

Preflight (fail-closed):

- stable runtime valid, clean, detached
- Director PID identity unambiguous
- ComfyUI healthy, queue idle (`0/0`)
- Desktop shortcut still targets stable runtime (when readable)

Mutating steps (only after preflight PASS):

1. `git fetch origin` (no pull/merge/rebase)
2. `git checkout --detach <ReleaseSha>` in stable runtime only
3. Verify package version == `-ExpectedVersion`
4. Stop **only** the verified Director PID on `8787`
5. Start Director from stable runtime harness

ComfyUI lifecycle remains external: deployment inspects health/queue/PID but never stops/starts/restarts ComfyUI.

Idempotent: if runtime is already at the target SHA and Director is already healthy at the expected version → safe NO-OP (`spawn 0`).

Plan-only dry run:

```powershell
.\Deploy-AIVideoDirectorRuntime.ps1 -RuntimeRoot '...' -ReleaseSha '...' -ExpectedVersion '0.19.4' -PlanOnly
```

## Status

```powershell
.\Get-AIVideoDirectorStatus.ps1
```

Read-only. No starts, no writes, no browser.

## Safety

The launcher/deployment tooling is startup/health/deployment only. It never:

- POSTs `/api/queue`
- POSTs ComfyUI `/prompt`
- modifies projects or `batchDraft`
- changes GPU power
- generates media
- `git reset`, `git clean`, or `git stash` the stable runtime automatically

If port `8188` or `8787` is occupied by an unexpected process, the launcher **fails closed** and reports PID/executable/command line when available. It does not broadly kill `node.exe` or `python.exe`.

## Logs

Optional runtime logs may be written under:

`%LOCALAPPDATA%\AI Video Director\logs\`

These files are local-only and must not be committed.
