param([string]$Root=(Split-Path $PSScriptRoot -Parent))
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if(!(Test-Path -LiteralPath $compiler)){throw 'The .NET Framework C# compiler is required.'}
$source=Join-Path $Root 'native\Launcher.cs'
$icon=Join-Path $Root 'web\assets\icons\brand\astra.ico'
& $compiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll "/win32icon:$icon" "/out:$Root\AstraAgent.exe" $source
if($LASTEXITCODE -ne 0){throw 'GUI launcher compilation failed'}
& $compiler /nologo /target:exe /define:CLI /optimize+ /reference:System.Windows.Forms.dll "/win32icon:$icon" "/out:$Root\AstraAgent.CLI.exe" $source
if($LASTEXITCODE -ne 0){throw 'CLI launcher compilation failed'}
