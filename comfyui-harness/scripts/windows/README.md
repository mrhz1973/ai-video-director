# Windows one-click launcher (v0.9.0)

Definitive Windows launcher for the local AI Video stack:

- ComfyUI on `http://127.0.0.1:8188`
- AI Video Director on `http://127.0.0.1:8787`
- Browser opens only after Director health succeeds

## Tracked files

| File | Purpose |
|------|---------|
| `Start-AIVideoDirector.ps1` | User-facing launcher entry point |
| `Get-AIVideoDirectorStatus.ps1` | Read-only status command |
| `Install-AIVideoDirectorLauncher.ps1` | Creates local config + Desktop shortcut |
| `launcher-lib.ps1` | Shared PowerShell helpers |
| `launcher-cli.mjs` | Node orchestration (health probes, detached starts) |

Core decision logic lives in `comfyui-harness/lib/windows-launcher.mjs` and is covered by Node tests.

## Local machine config (not committed)

Installer writes:

`%LOCALAPPDATA%\AI Video Director\launcher.json`

Example:

```json
{
  "comfyRoot": "D:\\path\\to\\ComfyUI_portable",
  "openBrowser": true,
  "comfyTimeoutSeconds": 180,
  "directorTimeoutSeconds": 30
}
```

Machine-specific absolute paths must never be committed to the public repository.

## Install (post-merge, manual)

From an elevated or normal PowerShell session:

```powershell
cd <repo>\comfyui-harness\scripts\windows
.\Install-AIVideoDirectorLauncher.ps1 -ComfyRoot 'D:\path\to\ComfyUI_portable'
```

This validates the ComfyUI portable root, writes the local config, and creates a Desktop shortcut named **AI Video Director**.

The shortcut invokes PowerShell with `-NoProfile -ExecutionPolicy Bypass` and does not depend on `.ps1` file association.

## Start

Double-click **AI Video Director** on the Desktop, or run:

```powershell
.\Start-AIVideoDirector.ps1
```

Startup order:

1. Validate local config
2. Probe ComfyUI `/system_stats`
3. Reuse healthy ComfyUI or start exactly one ComfyUI process
4. Probe Director `/api/config`
5. Reuse healthy Director or start exactly one `node server.mjs`
6. Open `http://127.0.0.1:8787/` only when Director is healthy (if `openBrowser` is true)

Re-running while both services are healthy is safe and idempotent.

## Status

```powershell
.\Get-AIVideoDirectorStatus.ps1
```

Read-only. No starts, no writes, no browser.

## Safety

The launcher is startup/health only. It never:

- POSTs `/api/queue`
- POSTs ComfyUI `/prompt`
- modifies projects or `batchDraft`
- changes GPU power
- generates media

If port `8188` or `8787` is occupied by an unexpected process, the launcher **fails closed** and reports PID/executable/command line when available. It does not broadly kill `node.exe` or `python.exe`.

## Logs

Optional runtime logs may be written under:

`%LOCALAPPDATA%\AI Video Director\logs\`

These files are local-only and must not be committed.
