# Ultran Windows desktop companion

First desktop client for the Ultran monorepo. It provides a responsive chat UI
connected only to the local AirLLM API at 127.0.0.1:11435. It does not yet share
chat history with Android or expose Windows file/command tools; these require a
permissioned device-sync and tool-approval layer.

## Requirements
- Windows 10 x64
- Node.js 20+ and pnpm 9+
- Python 3.10–3.12 for the AirLLM bridge
- Ample free disk; CPU inference can be very slow on older hardware

## Run from repository root
```powershell
pnpm install
pnpm --filter @ultran/desktop start
```
In another PowerShell window:
```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\tools\airllm-windows\start-ultran-airllm.ps1
```
First run installs Python dependencies; the model downloads on first inference.
Model weights are not bundled into the desktop app.

## Build a portable Windows executable
```powershell
pnpm install
pnpm --filter @ultran/desktop dist:win
```
Output is under apps/desktop/dist. This is not yet self-contained: Python and
the model runtime must be installed separately.

## Security
Electron uses context isolation, sandboxing and no renderer Node integration.
The renderer cannot make arbitrary network requests. Its preload bridge permits
only status/chat calls to the hard-coded loopback endpoint. No LAN API, remote
device sync, or Windows command/file automation is included in this build.
