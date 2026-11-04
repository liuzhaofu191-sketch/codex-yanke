@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or later is required. Install from https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd install --cache .cache/npm
  if errorlevel 1 goto failed
)
call npm.cmd run build
if errorlevel 1 goto failed
echo.
echo Open http://127.0.0.1:4317 in your browser.
echo Press Ctrl+C to stop the workbench.
call npm.cmd start
goto :eof
:failed
echo Setup failed. See the error above and retry.
pause
exit /b 1
