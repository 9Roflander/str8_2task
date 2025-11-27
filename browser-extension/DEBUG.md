# Extension Debugging Guide

## Issue: "Not on a supported platform" on Google Meet

### Step 1: Verify Extension is Loaded Correctly

1. Open Chrome and go to: `chrome://extensions/`
2. Find "Meetily - Meeting Message Assistant"
3. Check:
   - ✅ Extension is **enabled** (toggle is blue/on)
   - ✅ Shows version "1.0.0"
   - ✅ No errors displayed

### Step 2: Check Which Folder Was Loaded

**CRITICAL:** You must load the `dist` folder, not the root folder!

❌ **WRONG:** `/Users/sultangazydairov/meeting-minutes/browser-extension`  
✅ **CORRECT:** `/Users/sultangazydairov/meeting-minutes/browser-extension/dist`

**To fix:**
1. Go to `chrome://extensions/`
2. Click "Remove" on the Meetily extension
3. Click "Load unpacked"
4. Navigate to and select: `/Users/sultangazydairov/meeting-minutes/browser-extension/dist`

### Step 3: Test on Google Meet

1. Open a new tab
2. Go to: `https://meet.google.com/new`
3. Open DevTools (F12 or Cmd+Option+I)
4. Go to Console tab
5. Look for: `"Meetily extension content script loaded"`
6. If you see it, the extension is working!

### Step 4: Check Content Script Injection

In the Console on Google Meet, type:

```javascript
window.meetilyDebug.detectPlatform()
```

**Expected result:** Should return `"google-meet"`

If you get an error like "meetilyDebug is not defined", the content script didn't load.

### Step 5: Verify Manifest Paths

The extension should have these files in the `dist` folder:

```
dist/
├── background/
│   └── index.js
├── content/
│   └── index.js
├── popup/
│   └── popup.js
├── popup.html
├── manifest.json
└── icons/
```

### Common Issues & Fixes

#### Issue 1: Content Script Not Loading

**Symptoms:** No console logs, `meetilyDebug` undefined

**Fix:**
```bash
cd /Users/sultangazydairov/meeting-minutes/browser-extension
npm run build
# Then reload extension in chrome://extensions/
```

#### Issue 2: Wrong Folder Loaded

**Symptoms:** Extension loads but doesn't work

**Fix:** Remove and reload the `dist` folder specifically

#### Issue 3: Manifest Errors

**Symptoms:** Red error badge on extension

**Fix:** Check the errors in chrome://extensions/ and rebuild

### Quick Verification Script

Run this in your terminal to verify the build:

```bash
cd /Users/sultangazydairov/meeting-minutes/browser-extension
echo "Checking dist folder structure..."
ls -la dist/
echo ""
echo "Checking if content script exists..."
ls -la dist/content/
echo ""
echo "Checking manifest..."
cat dist/manifest.json | grep -A 3 "content_scripts"
```

### Still Not Working?

If you're still seeing "Not on a supported platform" after these steps:

1. **Take a screenshot** of:
   - The chrome://extensions/ page showing the Meetily extension
   - The Google Meet page with DevTools console open
   - The extension popup

2. **Check the exact URL** you're on - it must be:
   - `https://meet.google.com/*` (not just google.com)

3. **Try incognito mode** to rule out conflicts with other extensions
