param([string]$Model='base', [int]$Port=8790, [int]$Threads=4, [string]$Language='zh')
$ErrorActionPreference='Stop'
$sttRoot=Split-Path $PSScriptRoot -Parent
$sttPython=Join-Path $sttRoot '.local-stt\venv\Scripts\python.exe'
if(!(Test-Path -LiteralPath $sttPython)){throw 'Run scripts/install_local_stt.ps1 first.'}
$env:HF_HUB_DISABLE_TELEMETRY='1'
$sttArguments=@((Join-Path $sttRoot 'local_stt.py'),'--model',$Model,'--port',$Port,'--threads',$Threads)
if($Language){$sttArguments+=@('--language',$Language)}
& $sttPython @sttArguments
if($LASTEXITCODE -ne 0){throw 'Local STT stopped with an error. Check the selected model and console message.'}
