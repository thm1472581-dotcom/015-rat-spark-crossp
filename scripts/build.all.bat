@echo off
setlocal EnableExtensions

rem Full build: web -> statik -> client templates -> server -> deploy pack
rem Usage: build.all.bat [skip-npm]
rem   skip-npm  skip "npm install" when web deps are already installed

cd /d "%~dp0.."
set "ROOT=%CD%\"

set "SKIP_NPM=0"
if /i "%~1"=="skip-npm" set "SKIP_NPM=1"

rem Ensure Go tools (statik) are reachable
if exist "%USERPROFILE%\go\bin" set "PATH=%USERPROFILE%\go\bin;%PATH%"
if exist "C:\Program Files\Go\bin" set "PATH=C:\Program Files\Go\bin;%PATH%"

set "STATIK=statik"
where statik >nul 2>&1
if errorlevel 1 (
    if exist "%USERPROFILE%\go\bin\statik.exe" (
        set "STATIK=%USERPROFILE%\go\bin\statik.exe"
    ) else (
        echo [ERROR] statik not found. Install with:
        echo         go install github.com/rakyll/statik@latest
        exit /b 1
    )
)

echo.
echo ========================================
echo  Spark full build
echo ========================================
echo  Project : %ROOT%
echo ========================================
echo.

rem --- Step 1: Build frontend ---
echo [1/5] Building frontend...
cd /d "%ROOT%web"
if "%SKIP_NPM%"=="0" (
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        exit /b 1
    )
) else (
    echo        Skipping npm install ^(skip-npm^).
)
call npm run build-prod
if errorlevel 1 (
    echo [ERROR] npm run build-prod failed.
    exit /b 1
)
if not exist "%ROOT%web\dist\index.html" (
    echo [ERROR] web\dist\index.html not found after build.
    exit /b 1
)
echo        OK: web\dist\

rem --- Step 2: Embed static assets ---
echo [2/5] Embedding static assets (statik)...
cd /d "%ROOT%"
"%STATIK%" -m -src="./web/dist" -f -dest="./server/embed" -p web -ns web
if errorlevel 1 (
    echo [ERROR] statik failed.
    exit /b 1
)
if not exist "%ROOT%server\embed\web\statik.go" (
    echo [ERROR] server\embed\web\statik.go not generated.
    exit /b 1
)
echo        OK: server\embed\web\statik.go

rem --- Step 3: Build client templates ---
echo [3/5] Building client templates (built/)...
cd /d "%ROOT%"
if not exist "%ROOT%built" mkdir "%ROOT%built"
set GO111MODULE=auto
call go mod tidy
if errorlevel 1 (
    echo [ERROR] go mod tidy failed.
    exit /b 1
)
call go mod download
if errorlevel 1 (
    echo [ERROR] go mod download failed.
    exit /b 1
)
call "%ROOT%scripts\build.client.bat"
if errorlevel 1 (
    echo [ERROR] build.client.bat failed.
    exit /b 1
)
if not exist "%ROOT%built\windows_amd64" (
    echo [ERROR] built\windows_amd64 not found after client build.
    exit /b 1
)
echo        OK: built\

rem --- Step 4: Build server ---
echo [4/5] Building server...
cd /d "%ROOT%"
if not exist "%ROOT%releases" mkdir "%ROOT%releases"
for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set "COMMIT=%%i"
if not defined COMMIT set "COMMIT=unknown"
go build -ldflags "-s -w -X 'Spark/server/config.Commit=%COMMIT%'" -tags=jsoniter -o "./releases/server_windows_amd64.exe" Spark/server
if errorlevel 1 (
    echo [ERROR] go build server failed.
    exit /b 1
)
if not exist "%ROOT%releases\server_windows_amd64.exe" (
    echo [ERROR] releases\server_windows_amd64.exe not found.
    exit /b 1
)
echo        OK: releases\server_windows_amd64.exe  ^(commit: %COMMIT%^)

rem --- Step 5: Pack deploy directory ---
echo [5/5] Packing deploy directory...
call "%ROOT%scripts\make.deploy.bat"
if errorlevel 1 (
    echo [ERROR] make.deploy.bat failed.
    exit /b 1
)

echo.
echo ========================================
echo  Build complete!
echo ========================================
echo  releases\server_windows_amd64.exe
echo  deploy\                             ^(ready to run^)
echo.
echo  Start server:
echo    cd deploy
echo    run.bat
echo ========================================
echo.
exit /b 0