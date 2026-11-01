@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the current LTS from https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\three\package.json" (
  echo Installing locked runtime dependencies...
  call npm ci --omit=dev
  if errorlevel 1 (
    echo Dependency installation failed. Check the network and retry.
    pause
    exit /b 1
  )
)
echo FlowLens local studio: http://127.0.0.1:4173/
echo Keep this window open while using FlowLens. Press Ctrl+C to stop.
node server.mjs
if errorlevel 1 (
  echo Startup failed. If port 4173 is already used by FlowLens, open the URL above.
  pause
)
