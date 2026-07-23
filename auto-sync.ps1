#!/usr/bin/env pwsh
<#
.SYNOPSIS
Auto-sync script for Operixa - Automatically commits and pushes changes to GitHub
.DESCRIPTION
This script monitors the project directory for changes and automatically commits and pushes them to GitHub
.EXAMPLE
.\auto-sync.ps1
#>

param(
    [int]$CheckInterval = 60  # Check for changes every 60 seconds
)

$projectPath = "c:\Users\DELL\Downloads\syncforge\syncforge"
$lastCommitTime = Get-Date

function Sync-ToGithub {
    param(
        [string]$Message = "Auto-sync: Update files"
    )
    
    try {
        Set-Location $projectPath
        
        # Get the status
        $status = git status --porcelain
        
        if ($status) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 📝 Changes detected, committing..." -ForegroundColor Yellow
            
            # Add all changes
            git add -A
            
            # Create commit with timestamp
            $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            git commit -m "Auto-sync: $timestamp`n`nAutomatic commit from VS Code"
            
            # Push to GitHub
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 🚀 Pushing to GitHub..." -ForegroundColor Cyan
            git push origin main
            
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ✅ Successfully synced to GitHub" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ❌ Error during sync: $_" -ForegroundColor Red
    }
}

# Initial message
Write-Host @"
🔄 Operixa Auto-Sync Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 Project: $projectPath
⏱️  Check Interval: ${CheckInterval} seconds
📍 Branch: main

Changes will be automatically committed and pushed to GitHub.
Press Ctrl+C to stop.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"@ -ForegroundColor Green

# Main loop
while ($true) {
    Sync-ToGithub
    Start-Sleep -Seconds $CheckInterval
}
