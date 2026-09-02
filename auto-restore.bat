@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title WorkBuddy - 更新后一键恢复字体和配色

echo ============================================================
echo   一键恢复：WorkBuddy 更新后恢复字体和配色
echo ============================================================
echo.
echo   用你上次的选择，自动完成：
echo     1. 关闭界面校验开关（更新后会被官方恢复，需要重新关）
echo     2. 恢复字体
echo     3. 恢复配色
echo.
echo   全程无需输入，跑完重新打开 WorkBuddy 即可。
echo.
echo ------------------------------------------------------------
echo   注意：必须先完全退出 WorkBuddy
echo        （右下角托盘图标右键 ^-^> 退出，不是关窗口）
echo ------------------------------------------------------------
echo.
pause

set "NODE="
for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
  if not defined NODE if exist "%%d\node.exe" set "NODE=%%d\node.exe"
)
if not defined NODE (
  for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
)
if not defined NODE (
  echo [错误] 没找到 Node.js，请到 https://nodejs.org 下载安装
  echo.
  pause
  exit /b 1
)

"%NODE%" "%~dp0workbuddy-font-patcher.js" auto
echo.
pause
