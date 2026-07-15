@echo off
setlocal
cd /d "%~dp0"
if /i "%~1"=="--test" (
  pnpm start:fixture -- --no-open --port 4318 --data-dir output/launcher-test
  exit /b %errorlevel%
)
start "AI Presentation Studio" /min cmd.exe /d /s /k "pnpm start"
