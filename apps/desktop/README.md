# Ultran Windows desktop companion

First Windows desktop client for the Ultran monorepo. It provides a responsive
chat UI connected only to the local AirLLM API at 127.0.0.1:11435. Conversations
are saved to this Windows user's Electron app-data folder. Chat history does not
yet sync with Android. Windows command execution is not enabled.

The user can explicitly select a text/source file through the native Windows
file picker. Only approved text-like extensions up to 128 KB are accepted; the
selected text is added as context for local model requests. File contents are
treated as untrusted data, not as instructions.

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
First run installs Python dependencies; model weights download on first
inference. Model weights are not bundled into the desktop app.

## Build a portable Windows executable
```powershell
pnpm install
pnpm --filter @ultran/desktop dist:win
```
Output is under apps/desktop/dist. This is not self-contained: Python and the
model runtime must be installed separately.

## Security
Electron uses context isolation, sandboxing and no renderer Node integration.
The renderer cannot make arbitrary network requests. The preload bridge only
exposes status/chat calls to the fixed loopback endpoint, a native file picker,
and bounded local history persistence. No LAN API, remote device sync, or
Windows command execution is included in this build.
