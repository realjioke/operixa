@echo off
REM Auto-sync startup script for Operixa
REM This script enables automatic GitHub syncing

echo.
echo ╔════════════════════════════════════════╗
echo ║   Operixa Auto-Sync Starting...        ║
echo ╚════════════════════════════════════════╝
echo.

cd /d "c:\Users\DELL\Downloads\syncforge\syncforge"

REM Check if git is installed
git --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Git is not installed! Please install Git first.
    pause
    exit /b 1
)

REM Verify we're in a git repository
git rev-parse --git-dir >nul 2>&1
if errorlevel 1 (
    echo ❌ Not in a git repository!
    pause
    exit /b 1
)

echo ✅ Git is configured
echo.
echo 🔄 Starting auto-sync daemon...
echo    - Check interval: 60 seconds
echo    - Changes will auto-commit and push
echo    - Press Ctrl+C to stop
echo.

REM Run the PowerShell sync script
powershell -NoProfile -ExecutionPolicy Bypass -File "auto-sync.ps1" -CheckInterval 60

pause
