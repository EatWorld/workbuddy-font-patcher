@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title WorkBuddy - 关闭界面校验开关（第 1 步）

echo ============================================================
echo   第 1 步：关闭 WorkBuddy 的界面校验开关
echo ============================================================
echo.
echo   新版 WorkBuddy 在程序里加了校验，改界面会被拒绝启动。
echo   本工具把这个开关关掉（改程序里 1 个字节），之后才能改字体和配色。
echo.
echo   只关开关，不动字体、不动配色。
echo   关完之后请重新打开 WorkBuddy 确认能正常启动，
echo   确认没问题再运行「改字体.bat」。
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

"%NODE%" "%~dp0workbuddy-fuse-tool.js" status
echo.
"%NODE%" "%~dp0workbuddy-fuse-tool.js" off
echo.
pause
