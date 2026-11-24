@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-and-verify.ps1"
echo.
pause
