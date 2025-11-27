# Meetily Browser Extension

Browser extension for posting messages in Google Meet, Zoom, and Microsoft Teams meetings.

## Installation in Chrome

### Method 1: Load Unpacked Extension (Development)

1. **Open Chrome Extensions Page**
   - Open Chrome browser
   - Go to `chrome://extensions/`
   - Or: Click the three dots menu → More tools → Extensions

2. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

3. **Load the Extension**
   - Click "Load unpacked" button
   - Navigate to this folder: `browser-extension/`
   - Select the folder and click "Select Folder" (or "Open" on Mac)

4. **Verify Installation**
   - You should see the Meetily extension in your extensions list
   - The extension icon should appear in your Chrome toolbar

### Method 2: Pack Extension (For Distribution)

1. **Pack the Extension**
   - Go to `chrome://extensions/`
   - Enable Developer mode
   - Click "Pack extension"
   - Select the `browser-extension/` folder
   - This creates a `.crx` file and `.pem` key file

2. **Install Packed Extension**
   - Drag the `.crx` file into Chrome
   - Or use the "Load unpacked" method with the folder

## Usage

1. **Navigate to a Meeting**
   - Go to Google Meet, Zoom, or Microsoft Teams
   - Join a meeting

2. **Open Extension Popup**
   - Click the Meetily extension icon in Chrome toolbar
   - The popup will show if you're on a supported platform

3. **Post a Message**
   - Type your message in the text area
   - Click "Post Message"
   - The message will be posted to the meeting chat

## Supported Platforms

- ✅ **Google Meet** (`meet.google.com`)
- ✅ **Zoom** (`zoom.us` or `*.zoom.us`)
- ✅ **Microsoft Teams** (`teams.microsoft.com` or `teams.live.com`)

## Development

### File Structure

```
browser-extension/
├── manifest.json       # Extension manifest (Manifest V3)
├── background.js       # Service worker (background script)
├── content.js          # Content script (runs on meeting pages)
├── popup.html          # Extension popup UI
├── popup.js            # Popup script
├── icons/              # Extension icons
└── README.md           # This file
```

### Making Changes

1. **Edit Files**
   - Make your changes to the extension files

2. **Reload Extension**
   - Go to `chrome://extensions/`
   - Find Meetily extension
   - Click the refresh/reload icon
   - Or: Right-click extension → Reload

3. **Test Changes**
   - Navigate to a meeting platform
   - Test the functionality

### Debugging

**Content Script Debugging:**
- Right-click on the meeting page → Inspect
- Check Console tab for logs
- Look for "Meetily extension content script loaded"

**Background Script Debugging:**
- Go to `chrome://extensions/`
- Find Meetily extension
- Click "service worker" link (under "Inspect views")
- This opens the service worker console

**Popup Debugging:**
- Right-click the extension icon → Inspect popup
- This opens DevTools for the popup

## Permissions

The extension requires:
- `activeTab`: Access to the current tab
- `storage`: Store extension settings
- `scripting`: Inject content scripts
- Host permissions for meeting platforms

## Troubleshooting

**Extension not working:**
- Make sure you're on a supported meeting platform
- Check that the meeting chat is open
- Reload the extension
- Check the browser console for errors

**Message not posting:**
- Verify you're in an active meeting
- Make sure the chat panel is visible
- Check if the platform's DOM structure has changed
- Look for errors in the console

**Extension icon not showing:**
- Go to `chrome://extensions/`
- Find Meetily extension
- Click the pin icon to pin it to toolbar

## Building for Production

1. **Create Icons**
   - Add icon files: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`
   - Icons should be PNG format

2. **Update Version**
   - Update version in `manifest.json`

3. **Pack Extension**
   - Use Chrome's "Pack extension" feature
   - Or use a build tool like `web-ext` for cross-browser support

## Notes

- This extension uses Manifest V3 (required for Chrome)
- Content scripts run on meeting platform pages
- Background service worker handles extension lifecycle
- Popup provides UI for posting messages


