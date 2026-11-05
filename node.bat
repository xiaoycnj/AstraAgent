@echo off
setlocal
set "PATH=%~dp0runtimes\node;%~dp0runtimes\python;%PATH%"
if exist "%~dp0runtimes\node\node.exe" goto bundled
node.exe --version >nul 2>nul
if not errorlevel 1 goto installed
echo Node.js was not found. Install Node.js for Node-based tools and MCP servers.
echo https://nodejs.org/
exit /b 1
:bundled
"%~dp0runtimes\node\node.exe" %*
exit /b %errorlevel%
:installed
node.exe %*
exit /b %errorlevel%
