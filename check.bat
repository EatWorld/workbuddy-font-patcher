@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

set "NODE="
rem 1) prefer WorkBuddy bundled node
for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
  if not defined NODE if exist "%%d\node.exe" set "NODE=%%d\node.exe"
)
rem 2) fallback to system node
if not defined NODE (
  for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
)
if not defined NODE (
  echo [ERROR] Node.js not found. Please install it from https://nodejs.org
  pause
  exit /b 1
)

"%NODE%" "%~dp0workbuddy-font-patcher.js" check
echo.
pause
