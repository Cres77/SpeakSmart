@echo off
cd /d "%~dp0"
title SpeakSmart diagnose
echo SpeakSmart USB check
echo.
call "%~dp0start-windows.bat" __setup
if errorlevel 1 exit /b 1
echo.
echo Running npm run diagnose.
echo Listen for the tone. This window does not know whether you heard it.
echo.
call npm run diagnose
if errorlevel 1 (
  echo.
  echo Diagnose failed.
  pause
  exit /b 1
)
echo.
echo Diagnose finished.
pause
exit /b 0
