@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-DeveloperTest.ps1" %*
set "developerExitCode=%errorlevel%"
if not "%developerExitCode%"=="0" pause
exit /b %developerExitCode%
