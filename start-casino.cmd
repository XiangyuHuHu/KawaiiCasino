@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules\socket.io (
  call npm ci --no-fund --no-audit
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo.
echo Starting Kawaii Casino. Open http://localhost:3000 in your browser.
echo Share a LAN address printed below with friends on the same Wi-Fi.
node server/index.js
pause
