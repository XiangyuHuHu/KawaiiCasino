@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22 或更高版本：https://nodejs.org/
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
echo 正在启动 Kawaii Casino，浏览器打开 http://localhost:3000
echo 把终端显示的局域网地址发给同一 Wi-Fi 下的朋友。
node server/index.js
pause
