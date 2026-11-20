$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Write-Error "Python was not found. Install 64-bit Python 3.11, then reopen PowerShell." }
$pyVersion = python -c "import sys; print('{}.{}'.format(sys.version_info.major,sys.version_info.minor))"
if ($pyVersion -notin @("3.10", "3.11", "3.12")) { Write-Host "Detected Python $pyVersion. Dependencies may require a supported version." -ForegroundColor Yellow }
if (-not (Test-Path ".venv\Scripts\python.exe")) { python -m venv .venv }
$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
& $python -m pip install --upgrade pip
# AMD Radeon laptop: deliberately use CPU-only PyTorch, not NVIDIA CUDA.
& $python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
& $python -m pip install -r requirements.txt
if (-not $env:ULTRAN_AIRLLM_MODEL) { $env:ULTRAN_AIRLLM_MODEL = "Qwen/Qwen2.5-1.5B-Instruct" }
if (-not $env:ULTRAN_AIRLLM_HOST) { $env:ULTRAN_AIRLLM_HOST = "127.0.0.1" }
if (-not $env:ULTRAN_AIRLLM_PORT) { $env:ULTRAN_AIRLLM_PORT = "11435" }
Write-Host "Starting Ultran AirLLM bridge for $env:ULTRAN_AIRLLM_MODEL" -ForegroundColor Cyan
Write-Host "Local API: http://127.0.0.1:$env:ULTRAN_AIRLLM_PORT/v1" -ForegroundColor Green
Write-Host "First model load may take a long time and needs substantial free disk space." -ForegroundColor Yellow
& $python server.py
