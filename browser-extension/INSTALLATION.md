# Installation Guide - Meetily Browser Extension

## Quick Start

### Step 1: Prepare the Extension

Make sure you have the `browser-extension` folder with all the necessary files:
- `manifest.json`
- `background.js`
- `content.js`
- `popup.html`
- `popup.js`
- `icons/` folder (with icon files)

### Step 2: Open Chrome Extensions Page

**Option A: Via Address Bar**
1. Open Chrome
2. Type `chrome://extensions/` in the address bar
3. Press Enter

**Option B: Via Menu**
1. Click the three dots (⋮) in the top-right corner
2. Go to **More tools** → **Extensions**

### Step 3: Enable Developer Mode

1. Look for the toggle switch labeled **"Developer mode"** in the top-right corner
2. Turn it **ON** (it should turn blue/highlighted)

### Step 4: Load the Extension

1. Click the **"Load unpacked"** button (appears after enabling Developer mode)
2. Navigate to the `browser-extension` folder in your project
3. Select the folder and click **"Select Folder"** (Windows/Linux) or **"Open"** (Mac)

### Step 5: Verify Installation

✅ You should see:
- The Meetily extension in your extensions list
- The extension icon in your Chrome toolbar (puzzle piece icon area)
- Status showing "Enabled"

### Step 6: Pin the Extension (Optional but Recommended)

1. Click the **puzzle piece icon** (🧩) in Chrome toolbar
2. Find "Meetily - Meeting Message Assistant"
3. Click the **pin icon** (📌) to pin it to your toolbar

## Testing the Extension

1. **Go to a Meeting Platform**
   - Navigate to: `https://meet.google.com/` (or any meeting link)
   - Or: `https://zoom.us/` 
   - Or: `https://teams.microsoft.com/`

2. **Join a Meeting**
   - Join any test meeting

3. **Open Extension Popup**
   - Click the Meetily extension icon in your toolbar
   - You should see the popup with status showing the detected platform

4. **Test Message Posting**
   - Type a test message
   - Click "Post Message"
   - The message should appear in the meeting chat

## Troubleshooting

### Extension Not Appearing

**Problem:** Extension doesn't show up after loading

**Solutions:**
- Make sure you selected the correct folder (the one containing `manifest.json`)
- Check for errors in the extensions page (red error messages)
- Try reloading the extension (click the refresh icon)

### Extension Icon Not Showing

**Problem:** Can't find the extension icon

**Solutions:**
- Click the puzzle piece icon (🧩) in Chrome toolbar
- Find Meetily in the list
- Click the pin icon to pin it
- Or: Go to `chrome://extensions/` and enable "Show in toolbar"

### "Manifest file is missing or unreadable"

**Problem:** Error when trying to load extension

**Solutions:**
- Make sure you're selecting the `browser-extension` folder (not a parent folder)
- Verify `manifest.json` exists in the folder
- Check that `manifest.json` is valid JSON (no syntax errors)

### Extension Not Working on Meeting Pages

**Problem:** Extension loads but doesn't work on meeting sites

**Solutions:**
- Make sure you're on a supported platform (Google Meet, Zoom, Teams)
- Check browser console for errors (F12 → Console)
- Verify the meeting chat is open/visible
- Try reloading the extension

### "This extension may have been corrupted"

**Problem:** Chrome shows corruption warning

**Solutions:**
- Remove the extension
- Re-download or recreate the extension files
- Make sure all files are present and not corrupted
- Try loading again

## Updating the Extension

When you make changes to the extension:

1. **Edit the files** in `browser-extension/` folder
2. **Go to** `chrome://extensions/`
3. **Find** Meetily extension
4. **Click the refresh/reload icon** (🔄) on the extension card
5. **Test** your changes

## Removing the Extension

1. Go to `chrome://extensions/`
2. Find Meetily extension
3. Click **"Remove"**
4. Confirm removal

## Next Steps

After installation:
- Test on all three platforms (Google Meet, Zoom, Teams)
- Customize the message posting logic if needed
- Add icons to the `icons/` folder for better appearance
- Consider packaging for distribution

## Need Help?

- Check the main `README.md` in the `browser-extension/` folder
- Review browser console for error messages
- Verify all files are present and correct







