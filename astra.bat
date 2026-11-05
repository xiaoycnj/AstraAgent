@echo off
setlocal
set "ASTRA_ROOT=%~dp0"
set "PYTHONUTF8=1"
set "PYTHONNOUSERSITE=1"
call "%ASTRA_ROOT%python.bat" "%ASTRA_ROOT%cli.py" %*
exit /b %errorlevel%
