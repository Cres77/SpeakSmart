@echo off
cd /d "%~dp0"
if /I "%~1"=="__setup" goto setup_only

title FreeWili bridge
echo FreeWili bridge
echo.
call :setup
if errorlevel 1 exit /b 1

echo.
echo Starting the FreeWili bridge. It does not open a web page.
echo The SpeakSmart website connects to ws://127.0.0.1:4173/ws while you record.
call npm start
if errorlevel 1 (
  echo.
  echo The FreeWili bridge stopped because of an error.
  pause
  exit /b 1
)
exit /b 0

:setup_only
call :setup
set "SETUP_ERR=%ERRORLEVEL%"
exit /b %SETUP_ERR%

:setup
echo Checking Node.js 20 or newer, 64-bit Python 3.11 or newer, and Git.
echo.

call :have_node
if errorlevel 1 (
  echo Node.js 20 or newer was not found.
  call :require_winget
  if errorlevel 1 exit /b 1
  call :install_id OpenJS.NodeJS.LTS "Node.js"
  call :have_node
  if errorlevel 1 (
    echo.
    echo Node.js 20 or newer is still not available after winget.
    pause
    exit /b 1
  )
)
echo Node.js is ready.

call :have_python
if errorlevel 1 (
  echo 64-bit Python 3.11 or newer was not found.
  echo The Microsoft Store python alias is skipped.
  call :require_winget
  if errorlevel 1 exit /b 1
  call :install_id Python.Python.3.12 "Python 3.12"
  call :have_python
  if errorlevel 1 (
    echo.
    echo 64-bit Python 3.11 or newer is still not available after winget.
    pause
    exit /b 1
  )
)
echo Python is ready.

call :have_git
if errorlevel 1 (
  echo Git was not found.
  call :require_winget
  if errorlevel 1 exit /b 1
  call :install_id Git.Git "Git"
  call :have_git
  if errorlevel 1 (
    echo.
    echo Git is still not available after winget.
    echo Git is required because OneWili installs from a git URL.
    pause
    exit /b 1
  )
)
echo Git is ready.

echo.
echo Installing Python packages from bridge\requirements.txt
echo OneWili is downloaded from Git. This can take a few minutes.
call :run_pip
if errorlevel 1 (
  echo.
  echo pip could not install bridge\requirements.txt. The FreeWili bridge was not started.
  pause
  exit /b 1
)

echo.
echo Installing Node packages.
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. The FreeWili bridge was not started.
  pause
  exit /b 1
)

echo Setup finished.
exit /b 0

:have_node
where node >nul 2>&1
if errorlevel 1 exit /b 1
node -e "process.exit(parseInt(process.versions.node,10)>=20?0:1)"
if errorlevel 1 exit /b 1
exit /b 0

:have_git
git --version >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 0

:have_python
set "PYEXE="
set "PYARG="
call :python_works py -3
if not errorlevel 1 goto use_py
call :python_works python
if not errorlevel 1 goto use_python
exit /b 1

:use_py
set "PYEXE=py"
set "PYARG=-3"
echo Using py -3.
exit /b 0

:use_python
set "PYEXE=python"
set "PYARG="
echo Using python.
exit /b 0

:python_works
set "PYOUT=%TEMP%\speaksmart-python-check.txt"
%* -c "import sys; raise SystemExit(0 if sys.version_info>=(3, 11) and sys.maxsize>2**32 else 1)" >"%PYOUT%" 2>&1
set "PYCODE=%ERRORLEVEL%"
findstr /I /C:"Python was not found" /C:"Microsoft Store" "%PYOUT%" >nul 2>&1
set "STORE=%ERRORLEVEL%"
del /q "%PYOUT%" >nul 2>&1
if "%STORE%"=="0" exit /b 1
if not "%PYCODE%"=="0" exit /b 1
exit /b 0

:require_winget
where winget >nul 2>&1
if not errorlevel 1 exit /b 0
echo.
echo winget is not available, so this script cannot install what is missing.
echo Install these, then double-click this file again:
echo   Node.js 20 or newer: https://nodejs.org/en/download
echo   Python 3.11 or newer, 64-bit: https://www.python.org/downloads/windows/
echo   Git: https://git-scm.com/download/win
pause
exit /b 1

:install_id
echo.
echo Installing %~2.
echo winget install -e --id %~1 --accept-package-agreements --accept-source-agreements
winget install -e --id %~1 --accept-package-agreements --accept-source-agreements
set "WINGET_ERR=%ERRORLEVEL%"
if not "%WINGET_ERR%"=="0" echo winget returned %WINGET_ERR%. Checking whether %~2 is available now.
call :refresh_path
exit /b 0

:refresh_path
echo Refreshing PATH from the Machine and User registry values.
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0

:run_pip
if not "%PYEXE%"=="py" goto pip_plain
py -3 -m pip install -r bridge\requirements.txt
exit /b %ERRORLEVEL%

:pip_plain
"%PYEXE%" -m pip install -r bridge\requirements.txt
exit /b %ERRORLEVEL%
