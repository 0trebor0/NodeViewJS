@echo off
setlocal EnableDelayedExpansion

rem NodeViewJS Windows prerequisite installer.
rem
rem Installs what README.md lists under Requirements: Node.js 20 or newer,
rem Python 3, Visual Studio Build Tools 2022 with the Desktop development
rem with C++ workload, and the Microsoft Edge WebView2 Runtime.
rem
rem   setup.bat          install anything missing, then npm install
rem   setup.bat /check   report what is missing and change nothing
rem   setup.bat /deps    install missing prerequisites, skip npm install

set "MODE=install"
if /i "%~1"=="/check" set "MODE=check"
if /i "%~1"=="/deps" set "MODE=deps"
if /i "%~1"=="/?" goto :usage
if /i "%~1"=="-h" goto :usage
if /i "%~1"=="--help" goto :usage

set "MISSING=0"
set "INSTALLED=0"
set "FAILED=0"

echo.
echo  NodeViewJS prerequisite setup
echo  ============================================================
if "%MODE%"=="check" echo  Mode: check only, nothing will be installed.
echo.

rem ---------------------------------------------------------------- winget
where winget >nul 2>&1
if errorlevel 1 (
  echo  [X] winget was not found.
  echo      winget ships with App Installer. Install it from the Microsoft
  echo      Store, then run this script again:
  echo      https://apps.microsoft.com/detail/9nblggh4nns1
  echo.
  exit /b 1
)
echo  [ok] winget is available.

rem ---------------------------------------------------------------- Node.js
set "NODE_OK=0"
for /f "tokens=1 delims=." %%a in ('node --version 2^>nul') do set "NODE_RAW=%%a"
if defined NODE_RAW (
  set "NODE_MAJOR=!NODE_RAW:v=!"
  if !NODE_MAJOR! GEQ 20 (
    for /f "delims=" %%v in ('node --version 2^>nul') do echo  [ok] Node.js %%v
    set "NODE_OK=1"
  ) else (
    for /f "delims=" %%v in ('node --version 2^>nul') do echo  [X] Node.js %%v is too old; 20 or newer is required.
  )
) else (
  echo  [X] Node.js was not found.
)
if "!NODE_OK!"=="0" (
  set /a MISSING+=1
  call :install "Node.js LTS" "OpenJS.NodeJS.LTS"
)

rem ---------------------------------------------------------------- Python 3
set "PY_OK=0"
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set "PY_VER=%%v"
if defined PY_VER (
  echo  [ok] Python !PY_VER!
  set "PY_OK=1"
) else (
  py -3 --version >nul 2>&1
  if not errorlevel 1 (
    for /f "tokens=2" %%v in ('py -3 --version 2^>^&1') do echo  [ok] Python %%v via the py launcher
    set "PY_OK=1"
  ) else (
    echo  [X] Python 3 was not found. node-gyp needs it to build the addon.
  )
)
if "!PY_OK!"=="0" (
  set /a MISSING+=1
  call :install "Python 3.12" "Python.Python.3.12"
)

rem ------------------------------------------- Visual Studio Build Tools 2022
set "VS_OK=0"
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "!VSWHERE!" (
  for /f "usebackq delims=" %%p in (`"!VSWHERE!" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2^>nul`) do set "VS_PATH=%%p"
  if defined VS_PATH (
    echo  [ok] Visual Studio C++ build tools at !VS_PATH!
    set "VS_OK=1"
  )
)
if "!VS_OK!"=="0" (
  echo  [X] The Desktop development with C++ workload was not found.
  set /a MISSING+=1
  call :installvs
)

rem ------------------------------------------------------ WebView2 Runtime
set "WV_KEY={F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
set "WV_OK=0"
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\%WV_KEY%" /v pv >nul 2>&1
if not errorlevel 1 set "WV_OK=1"
if "!WV_OK!"=="0" (
  reg query "HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\%WV_KEY%" /v pv >nul 2>&1
  if not errorlevel 1 set "WV_OK=1"
)
if "!WV_OK!"=="1" (
  echo  [ok] Microsoft Edge WebView2 Runtime is installed.
) else (
  echo  [X] Microsoft Edge WebView2 Runtime was not found.
  set /a MISSING+=1
  call :install "WebView2 Runtime" "Microsoft.EdgeWebView2Runtime"
)

rem ---------------------------------------------------------------- summary
echo.
echo  ============================================================
if "%MODE%"=="check" (
  if !MISSING! EQU 0 (
    echo  All prerequisites are present.
  ) else (
    echo  Missing prerequisites: !MISSING!
    echo  Run setup.bat without /check to install them.
  )
  echo.
  exit /b 0
)

if !FAILED! GTR 0 (
  echo  !FAILED! install^(s^) failed. Review the output above and retry.
  echo.
  exit /b 1
)

if !INSTALLED! GTR 0 (
  echo  Installed !INSTALLED! component^(s^).
  echo.
  echo  Close this window and open a new terminal so PATH updates are
  echo  visible, then run setup.bat again to continue.
  echo.
  exit /b 0
)

echo  All prerequisites are present.

if "%MODE%"=="deps" (
  echo.
  exit /b 0
)

rem ------------------------------------------------------- project install
echo.
echo  Installing project dependencies and building the native addon...
echo.
call npm install
if errorlevel 1 (
  echo.
  echo  npm install failed. If node-gyp cannot find Python, set PYTHON to
  echo  your python.exe and run npm install again.
  echo.
  exit /b 1
)

echo.
echo  Setup complete. Try it with:
echo      npm start        run the example app
echo      npm run dev      run it with DevTools
echo      npm test         run the default test suite
echo.
exit /b 0

rem ---------------------------------------------------------------- helpers
:install
if "%MODE%"=="check" goto :eof
echo      installing %~1 ...
winget install --id %~2 --exact --silent --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo      [X] %~1 install failed.
  set /a FAILED+=1
) else (
  echo      [ok] %~1 installed.
  set /a INSTALLED+=1
)
goto :eof

:installvs
if "%MODE%"=="check" goto :eof
echo      installing Visual Studio Build Tools 2022 with the C++ workload ...
echo      this one is large and may take a while.
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --silent ^
  --accept-package-agreements --accept-source-agreements ^
  --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
if errorlevel 1 (
  echo      [X] Visual Studio Build Tools install failed.
  set /a FAILED+=1
) else (
  echo      [ok] Visual Studio Build Tools installed.
  set /a INSTALLED+=1
)
goto :eof

:usage
echo.
echo  Usage: setup.bat [/check ^| /deps]
echo.
echo    (no argument)  install missing prerequisites, then npm install
echo    /check         report what is missing and change nothing
echo    /deps          install missing prerequisites, skip npm install
echo.
exit /b 0
