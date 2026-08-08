@echo off
setlocal
cd /d "%~dp0"
if /i "%~1"=="--test" goto test
if /i "%~1"=="--acceptance" goto acceptance
set "APS_LAUNCH_ARGS="
if defined APS_PORT set "APS_LAUNCH_ARGS=%APS_LAUNCH_ARGS% --port %APS_PORT%"
if defined APS_DATA_DIR set "APS_LAUNCH_ARGS=%APS_LAUNCH_ARGS% --data-dir %APS_DATA_DIR%"
if defined APS_LAUNCH_ARGS start "AI Presentation Studio" /min cmd.exe /d /s /k "pnpm start -- %APS_LAUNCH_ARGS%"
if not defined APS_LAUNCH_ARGS start "AI Presentation Studio" /min cmd.exe /d /s /k "pnpm start"
exit /b 0

:test
call pnpm start:fixture -- %2 %3 %4 %5 %6 %7 %8 %9
exit /b %errorlevel%

:acceptance
call pnpm start -- %2 %3 %4 %5 %6 %7 %8 %9
exit /b %errorlevel%
