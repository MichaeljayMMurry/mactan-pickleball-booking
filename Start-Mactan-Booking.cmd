@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24 or later to run Mactan Pickleball Booking.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:3000/ in Chrome or Edge and keep this window open.
node --env-file-if-exists=.env server.mjs
if errorlevel 1 pause
