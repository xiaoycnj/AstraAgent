param([string]$Python='', [string]$Model='base', [switch]$SkipModelDownload)
$ErrorActionPreference='Stop'
$sttRoot=Split-Path $PSScriptRoot -Parent
$sttHome=Join-Path $sttRoot '.local-stt'
$sttEnvironment=Join-Path $sttHome 'venv'
if(!$Python){
    if(Get-Command py -ErrorAction SilentlyContinue){$Python=(& py -3 -c 'import sys;print(sys.executable)').Trim()}
    elseif(Get-Command python -ErrorAction SilentlyContinue){$Python=(& python -c 'import sys;print(sys.executable)').Trim()}
}
if(!$Python -or !(Test-Path -LiteralPath $Python)){throw 'Install standard Python 3.10+ from python.org, then rerun this script.'}
& $Python -c 'import sys;assert sys.version_info >= (3,10), "Python 3.10+ required";import venv'
if($LASTEXITCODE -ne 0){throw 'A standard Python with venv support is required.'}
if(!(Test-Path -LiteralPath (Join-Path $sttEnvironment 'Scripts\python.exe'))){
    & $Python -m venv $sttEnvironment
    if($LASTEXITCODE -ne 0){throw 'Could not create the optional speech environment.'}
}
$sttPython=Join-Path $sttEnvironment 'Scripts\python.exe'
& $sttPython -m pip install --only-binary=:all: -r (Join-Path $sttRoot 'requirements-stt.txt')
if($LASTEXITCODE -ne 0){throw 'Speech dependency installation failed. Check the network and Python wheel compatibility.'}
& $sttPython (Join-Path $PSScriptRoot 'stt_notices.py') --output (Join-Path $sttHome 'notices.json')
if($LASTEXITCODE -ne 0){throw 'Could not export optional dependency license notices.'}
& $sttPython -m pip freeze | Set-Content -LiteralPath (Join-Path $sttHome 'requirements-lock.txt') -Encoding UTF8
$env:HF_HUB_DISABLE_TELEMETRY='1'
$env:HF_HUB_DISABLE_XET='1'
$env:HF_HUB_DOWNLOAD_TIMEOUT='60'
if(!$SkipModelDownload){
    & $sttPython (Join-Path $sttRoot 'local_stt.py') --model $Model --download-only
    if($LASTEXITCODE -ne 0){throw 'Model download failed. Rerun to continue or use a local converted model directory.'}
}
Write-Host "Local STT installed. Start with: powershell -File scripts/start_local_stt.ps1 -Model '$Model'"
