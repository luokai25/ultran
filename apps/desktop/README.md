# Ultran Windows desktop companion

First Windows desktop client for the Ultran monorepo. It provides a responsive
chat UI connected only to the local AirLLM API at 127.0.0.1:11435. Conversations
are saved to this Windows user's Electron app-data folder using versioned,
crash-safe writes with a recovery backup. Clearing history also removes its
backup. Chat history does not yet sync with Android.

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
The renderer cannot make arbitrary network requests. The preload bridge exposes
only fixed local APIs. Built-in app launching is limited to File Explorer,
Notepad, Calculator and Task Manager; the main process validates the app ID and
shows a native Windows confirmation before starting it. No shell, arbitrary
commands, LAN API, or remote device sync is enabled.

The agent orchestration core in `src/agent-runtime.cjs` provides bounded
multi-round planning, explicit per-action approval, capability-aware event
traces, exact-call loop suppression, cancellation checks, output limits, and
fail-closed handling of unknown tools. It is an execution framework, not yet a
fully wired model-driven tool loop; the current chat path still performs local
text generation and only the launcher is exposed as an actionable desktop tool.

Model repositories requiring custom remote Python code are rejected before
AirLLM loads them. The bridge is loopback-only by default. Runtime dependencies
and model weights are installed separately and are not bundled in the EXE.


## Agent mode

The chat toolbar includes an explicit Agent mode. When enabled, the local model
returns one structured action at a time. Ultran runs a bounded loop (8 planning
rounds, 12 tool calls) and returns tool results to the local planner. Available
tools are imported-project listing, bounded text-file listing, literal code search and reading,
basic system information, and a fixed Windows app launcher. The launcher uses
the existing native Windows approval dialog. Read-only workspace tools are
restricted to imported workspace folders, skip symlinks and dependency/build
folders, and cap file reads at 32 KB. The agent has no shell or arbitrary
command tool and no project write tool. Planner output is parsed as JSON and
unknown tools fail closed. Agent progress is sent to the renderer as events;
cancellation aborts the active planner request. The agent loop is local-only
and accepts only the loopback AirLLM endpoint.


Agent mode can also create or replace supported text/source files inside an
imported project. Every write requires a separate native Windows confirmation
showing the destination and a content preview. Existing targets are copied to
a sibling `.ultran-backup` file before replacement; temporary writes are
renamed into place. Paths are confined to the imported project, symlinks and
non-regular targets are rejected, and file size is capped. There is still no
shell, arbitrary process execution, or unrestricted filesystem access.


## Durable agent task history

Agent tasks are journaled locally in the app user-data directory. The journal
records task goals, status, bounded progress events, and the final result. It
uses versioned JSON, serialized atomic replacement, and a backup recovery path.
The Tasks page can reopen a task journal after restarting Ultran. This is a
history and audit feature; it does not yet resume an interrupted model
generation automatically. Tool output snippets may be retained in this local
journal, so users should avoid asking Ultran to inspect secrets they do not
want stored in task history.
