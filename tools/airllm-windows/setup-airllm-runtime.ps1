$ErrorActionPreference = "Stop"
$RuntimeRoot = Join-Path $env:APPDATA "Ultran\airllm"
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
Write-Host "Ultran local model runtime setup" -ForegroundColor Cyan
Write-Host "Runtime directory: $RuntimeRoot"
$Python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $Python) {
  $KnownPython = Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\python.exe"
  if (Test-Path $KnownPython) { $Python = $KnownPython }
}
if (-not $Python) {
  $PyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($PyLauncher) { $Python = $PyLauncher.Source; $PythonArgs = @("-3.11") }
}
if (-not $Python) { throw "Python 3.11 x64 was not found. Install Python 3.11 x64 and rerun runtime setup." }
if (-not $PythonArgs) { $PythonArgs = @() }
$version = & $Python @PythonArgs -c "import sys; print('{}.{}'.format(sys.version_info.major,sys.version_info.minor))"
if ($LASTEXITCODE -ne 0 -or $version -notin @("3.10","3.11","3.12")) { throw "Python $version detected. Install Python 3.11 x64 and retry." }
$architecture = & $Python @PythonArgs -c "import struct; print(struct.calcsize('P') * 8)"
if ($LASTEXITCODE -ne 0 -or $architecture -ne "64") { throw "64-bit Python is required. The detected interpreter is $architecture-bit." }
$Venv = Join-Path $RuntimeRoot ".venv"
if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) { & $Python @PythonArgs -m venv $Venv; if ($LASTEXITCODE -ne 0) { throw "Could not create the local Python environment." } }
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
