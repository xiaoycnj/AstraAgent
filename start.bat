@echo off
setlocal
cd /d "%~dp0"
title AstraAgent - Personal Agent Workspace
call "%~dp0python.bat" -u "%~dp0desktop.py" %*
set "ASTRA_EXIT=%errorlevel%"
if not "%ASTRA_EXIT%"=="0" (
  echo.
  echo Desktop startup failed. Lite requires WebView2 Runtime and Windows .NET Framework.
  echo You can also run: astra.bat serve --open
  echo https://developer.microsoft.com/microsoft-edge/webview2/
)
echo.
echo The application has stopped. You may close this window.
if "%~1"=="" pause
exit /b %ASTRA_EXIT%
