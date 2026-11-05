@echo off
setlocal
set "PYTHONUTF8=1"
set "PYTHONNOUSERSITE=1"
set "PATH=%~dp0runtimes\python;%~dp0runtimes\node;%PATH%"
if exist "%~dp0runtimes\python\python.exe" goto bundled
py.exe -3.14 -c "import sys,struct,sysconfig; assert sys.version_info[:2] == (3,14) and struct.calcsize('P') == 8 and not sysconfig.get_config_var('Py_GIL_DISABLED')" >nul 2>nul
if not errorlevel 1 goto launcher
python.exe -c "import sys,struct,sysconfig; assert sys.version_info[:2] == (3,14) and struct.calcsize('P') == 8 and not sysconfig.get_config_var('Py_GIL_DISABLED')" >nul 2>nul
if not errorlevel 1 goto installed
echo AstraAgent Lite requires standard CPython 3.14 x64.
echo Install Python 3.14 x64 with the Python launcher or add python.exe to PATH.
echo https://www.python.org/downloads/windows/
echo Alternatively, extract the Standard edition with its bundled environment.
exit /b 1
:bundled
"%~dp0runtimes\python\python.exe" %*
exit /b %errorlevel%
:launcher
py.exe -3.14 %*
exit /b %errorlevel%
:installed
python.exe %*
exit /b %errorlevel%
