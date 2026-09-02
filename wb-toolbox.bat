@echo off
setlocal enabledelayedexpansion
title WorkBuddy 字体配色工具箱

rem 找 Node.js（优先 WorkBuddy 自带的，其次系统安装的）
set "NODE="
for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
  if not defined NODE if exist "%%d\node.exe" set "NODE=%%d\node.exe"
)
if not defined NODE (
  for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
)
if not defined NODE (
  echo [错误] 没找到 Node.js，请到 https://nodejs.org 下载安装
  pause
  exit /b 1
)

:menu
cls
echo ============================================================
echo    WorkBuddy 字体配色工具箱
echo ============================================================
echo.
echo    [1] 改字体 + 配色（手动输入字体名）
echo    [2] 更新后一键恢复（自动用上次的选择，最常用）
echo    [3] 体检（只看当前状态，不改任何东西）
echo    [4] 还原官方原样（字体配色、程序文件全部恢复默认）
echo.
echo    提示：改字体/恢复前，记得先完全退出 WorkBuddy
echo    直接回车 = 退出
echo ============================================================
echo.
set "choice="
set /p choice=请输入数字后回车： 
if "%choice%"=="" exit /b 0
if "%choice%"=="1" goto do_font
if "%choice%"=="2" goto do_auto
if "%choice%"=="3" goto do_check
if "%choice%"=="4" goto do_restore
echo 无效输入（%choice%），请重新输入
pause
goto menu

:do_font
echo.
echo ===== 改字体 + 配色 =====
echo 提示：请先完全退出 WorkBuddy 再继续（会自动处理校验开关）
pause
"%NODE%" "%~dp0workbuddy-font-patcher.js"
goto end

:do_auto
echo.
echo ===== 更新后一键恢复 =====
echo 用上次记住的字体和配色设置自动恢复，不需要输入
echo 提示：请先完全退出 WorkBuddy 再继续
pause
"%NODE%" "%~dp0workbuddy-font-patcher.js" auto
goto end

:do_check
echo.
echo ===== 体检 =====
"%NODE%" "%~dp0workbuddy-font-patcher.js" check
goto end

:do_restore
echo.
echo ===== 还原官方原样 =====
echo 会还原：界面字体/配色 + WorkBuddy.exe（校验开关也恢复官方状态）
echo 提示：请先完全退出 WorkBuddy 再继续
pause
"%NODE%" "%~dp0workbuddy-font-patcher.js" restore
goto end

:end
echo.
pause
