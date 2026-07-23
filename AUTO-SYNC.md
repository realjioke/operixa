# Operixa Auto-Sync Setup Guide

## 🚀 What This Does

This auto-sync system automatically commits and pushes all your VS Code changes to GitHub. No manual `git push` needed!

**Features:**
- ✅ Auto-saves files every 2 seconds
- ✅ Auto-commits changes every 60 seconds
- ✅ Auto-pushes to GitHub
- ✅ Works in the background
- ✅ Excludes `.env` files (secrets stay secret)

---

## 📋 Setup (2 Steps)

### Step 1: Start VS Code with Auto-Save

The `.vscode/settings.json` file is already configured. Just open the project in VS Code:

```powershell
code "c:\Users\DELL\Downloads\syncforge\syncforge"
```

VS Code will automatically:
- ✅ Save files after 2 seconds of inactivity
- ✅ Format code on save
- ✅ Auto-fetch from GitHub

### Step 2: Start the Auto-Sync Daemon

**Option A: Use the Batch File (Easiest)**

Double-click: `start-auto-sync.bat`

This will:
1. Start a terminal window
2. Display sync progress
3. Run continuously in the background

**Option B: Manual PowerShell**

```powershell
cd "c:\Users\DELL\Downloads\syncforge\syncforge"
.\auto-sync.ps1
```

**Option C: Custom Interval (for Advanced Users)**

```powershell
# Check for changes every 30 seconds instead of 60
.\auto-sync.ps1 -CheckInterval 30
```

---

## 🔄 How It Works

1. **You edit files in VS Code**
   ```
   Edit file → Auto-save (2 sec delay) → File saved locally
   ```

2. **Auto-sync daemon detects changes**
   ```
   Every 60 seconds, checks git status
   ```

3. **Automatic commit & push**
   ```
   git add -A
   git commit -m "Auto-sync: [timestamp]"
   git push origin main
   ```

4. **Changes appear on GitHub**
   ```
   https://github.com/realjioke/operixa/commits/main
   ```

---

## 📊 Example Workflow

**Scenario:** You fix a bug in `backend/src/auth/auth.service.ts`

```
3:45:02 PM  📝 Changes detected, committing...
3:45:03 PM  🚀 Pushing to GitHub...
3:45:05 PM  ✅ Successfully synced to GitHub
```

Now on GitHub:
- New commit appears in `realjioke/operixa`
- File history is updated
- Changes are backed up

---

## ⚙️ Configuration

### Change Check Interval

Edit `auto-sync.ps1`:

```powershell
# Line 25 - Change 60 to your preferred seconds
$CheckInterval = 60  # Every 60 seconds (1 minute)
```

### VS Code Auto-Save Delay

Edit `.vscode/settings.json`:

```json
{
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 2000  // Change 2000 to milliseconds (e.g., 5000 = 5 seconds)
}
```

### Exclude More Files from Sync

Add to `.gitignore`:

```
uploads/
temp/
*.log
```

---

## 🔒 Security Notes

**These files are NEVER committed:**
- `.env` (all environment variables)
- `node_modules/` (all dependencies)
- `.next/` (build files)
- `dist/` (compiled files)

Check `.gitignore` to verify what's excluded.

---

## 📍 Monitor Your Syncs

### View commit history on GitHub:
```
https://github.com/realjioke/operixa/commits/main
```

### View commits in VS Code:
Open Source Control (Ctrl+Shift+G) → See all commits

### View in terminal:
```powershell
cd "c:\Users\DELL\Downloads\syncforge\syncforge"
git log --oneline -10  # Last 10 commits
```

---

## ⚠️ Troubleshooting

### "Command not found: auto-sync.ps1"

**Fix:** Make sure you're in the correct directory:
```powershell
cd "c:\Users\DELL\Downloads\syncforge\syncforge"
.\auto-sync.ps1
```

### "Permission denied" error

**Fix:** Run PowerShell as Administrator, then:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### "fatal: not a git repository"

**Fix:** Make sure you're in the project root:
```powershell
cd "c:\Users\DELL\Downloads\syncforge\syncforge"
git status
```

### Commits not pushing

**Check your connection:**
```powershell
git remote -v
# Should show: origin https://github.com/realjioke/operixa.git
```

**Verify GitHub authentication:**
```powershell
git push origin main --dry-run
```

---

## 🎯 Best Practices

1. **Keep commits meaningful** - Make logical changes before saving
2. **Review before committing** - Check VS Code's Source Control tab
3. **Run locally first** - Test your code before pushing
4. **Don't sync secrets** - Keep `.env` files out of git
5. **Use meaningful commit messages** - Future you will thank you

---

## 🛑 Stop Auto-Sync

**From the Terminal:**
```
Press Ctrl+C
```

**From Windows:**
1. Press `Ctrl+Shift+Esc` (Task Manager)
2. Find "powershell.exe"
3. Click "End Task"

---

## 📈 Next: Deploy to Production

Once you've pushed to GitHub, deploy your changes:

1. **Frontend:** Auto-deploys on Vercel with every push
2. **Backend:** Auto-deploys on Railway with every push

See `DEPLOYMENT.md` for full instructions.

---

## ✅ You're All Set!

Your project is now:
- ✅ Hosted on GitHub (https://github.com/realjioke/operixa)
- ✅ Auto-syncing changes
- ✅ Ready for production deployment
- ✅ Backed up on the cloud

**Happy coding!** 🚀
