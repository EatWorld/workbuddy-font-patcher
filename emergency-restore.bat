@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title WorkBuddy - 紧急还原（回到官方原样）

echo ============================================================
echo   紧急还原：把 WorkBuddy 恢复成 100%% 官方原样
echo ============================================================
echo.
echo   会还原：
echo     1. 界面字体 / 配色  ^-^> 官方默认
echo     2. WorkBuddy.exe   ^-^> 官方原版（校验开关恢复开启）
echo.
echo   用于 WorkBuddy 改完打不开、或者想彻底恢复原样的情况。
echo.
echo ------------------------------------------------------------
echo   注意：必须先完全退出 WorkBuddy
echo        （右下角托盘图标右键 ^-^> 退出，不是关窗口）
echo        如果已经打不开了，那说明没在运行，可以直接继续。
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

"%NODE%" "%~dp0workbuddy-font-patcher.js" restore-all --force
echo.
pause
