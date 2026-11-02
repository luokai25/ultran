$ErrorActionPreference = "Stop"
$RuntimeRoot = Join-Path $env:APPDATA "Ultran\airllm"
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
Write-Host "Ultran local model runtime setup" -ForegroundColor Cyan
Write-Host "Runtime directory: $RuntimeRoot"
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  Write-Host "Python 3.11 x64 is required. Install it from python.org, enable 'Add python.exe to PATH', then rerun this script." -ForegroundColor Yellow
  Read-Host "Press Enter to exit"
  exit 1
}
$version = python -c "import sys; print('{}.{}'.format(sys.version_info.major,sys.version_info.minor))"
if ($version -notin @("3.10","3.11","3.12")) { throw "Python $version detected. Install 64-bit Python 3.11 and retry." }
$Venv = Join-Path $RuntimeRoot ".venv"
if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) { python -m venv $Venv }
$Py = Join-Path $Venv "Scripts\python.exe"
& $Py -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }
# This laptop has AMD Radeon graphics, so install CPU PyTorch rather than CUDA.
& $Py -m pip install torch --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) { throw "CPU PyTorch install failed." }
& $Py -m pip install -r (Join-Path $PSScriptRoot "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "AirLLM dependency installation failed." }
Write-Host ""
Write-Host "Ultran's local model runtime is installed." -ForegroundColor Green
Write-Host "Return to Ultran and click Start local brain." -ForegroundColor Green
Read-Host "Press Enter to close"
