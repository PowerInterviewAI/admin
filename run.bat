@echo off
setlocal

rem Build and serve the admin dashboard on http://localhost:13000
rem The port is pinned by the "start" script in package.json, not here.

rem Run from this script's own folder so double-clicking works from anywhere.
cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm was not found on PATH. Install it from https://pnpm.io/
    goto :fail
)

if not exist ".env.local" (
    echo [ERROR] .env.local is missing. Copy .env.example and set MONGO_URL / MONGO_DB.
    goto :fail
)

if not exist "node_modules\" (
    echo [1/3] Installing dependencies...
    rem "call" is required: pnpm is a .cmd, and without it control never returns here.
    call pnpm install
    if errorlevel 1 goto :fail
) else (
    echo [1/3] Dependencies present, skipping install.
)

echo [2/3] Building...
call pnpm build
if errorlevel 1 goto :fail

echo [3/3] Starting on http://localhost:13000 - press Ctrl+C to stop.
call pnpm start
if errorlevel 1 goto :fail

endlocal
exit /b 0

:fail
echo.
echo Failed with error level %errorlevel%.
pause
endlocal
exit /b 1
