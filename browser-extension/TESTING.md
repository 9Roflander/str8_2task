# Testing Guide - Meetily LLM Message Extension

## Quick Start

### 1. Load Extension

```bash
# Open Chrome and go to:
chrome://extensions/

# Enable Developer Mode (top-right toggle)
# Click "Load unpacked"
# Select folder: /Users/sultangazydairov/meeting-minutes/browser-extension/dist
```

### 2. Test on Google Meet

1. Go to https://meet.google.com/new
2. Join the meeting
3. Click Meetily extension icon
4. Click "Generate & Post Test Message"
5. ✅ Message should appear in chat

---

## Detailed Testing Scenarios

### Test 1: Platform Detection

**Steps:**
1. Open extension popup on different pages
2. Check status indicator

**Expected Results:**
- Google Meet page → "Connected to Google Meet" (green)
- Zoom page → "Connected to Zoom" (green)
- Teams page → "Connected to Microsoft Teams" (green)
- Other pages → "Not on a supported platform" (red)

---

### Test 2: Test Message Generation

**Steps:**
1. Join a Google Meet
2. Open extension popup
3. Select "Acknowledgment" from dropdown
4. Click "Generate & Post Test Message"

**Expected Results:**
- Button shows "Generating message..."
- Then "Posting message..."
- Then "✓ Message Posted!"
- Message appears in Google Meet chat
- Example: "Thank you for sharing that insight."

**Repeat with:**
- Message Type: "Question" → Should post a question
- Message Type: "Summary" → Should post a summary

---

### Test 3: Message Queue

**Steps:**
1. In a meeting, rapidly click "Generate & Post Test Message" 3 times
2. Watch queue status indicator

**Expected Results:**
- Queue status appears: "Queue: 3 messages"
- Messages post one by one
- ~1 second delay between each
- Queue counts down: 3 → 2 → 1 → 0
- All 3 messages appear in chat

---

### Test 4: Manual Message Posting

**Steps:**
1. In a meeting, type "Hello from Meetily!" in the textarea
2. Click "Post Message"

**Expected Results:**
- Button shows "Posting..."
- Then "✓ Posted!"
- Message "Hello from Meetily!" appears in chat
- Textarea clears

---

### Test 5: Error Handling

**Steps:**
1. Open extension on google.com (not a meeting)
2. Try to post a message

**Expected Results:**
- Status shows "Not on a supported platform" (red)
- Buttons are disabled
- Cannot post messages

---

### Test 6: Retry Logic

**Steps:**
1. Join a meeting but close the chat panel
2. Try to post a message
3. Quickly open the chat panel

**Expected Results:**
- Extension attempts to open chat
- If it fails, retries up to 3 times
- Eventually posts message or shows error

---

## Build & Development

### Build Extension

```bash
cd /Users/sultangazydairov/meeting-minutes/browser-extension
npm install
npm run build
```

### Watch Mode (Auto-rebuild)

```bash
npm run watch
```

### After Code Changes

1. Make your changes in `src/` directory
2. Run `npm run build`
3. Go to `chrome://extensions/`
4. Click reload icon on Meetily extension
5. Test changes

---

## Troubleshooting

### Extension Not Loading

**Problem:** Extension doesn't appear after loading  
**Solution:** 
- Make sure you selected the `dist` folder, not the root
- Check for errors in `chrome://extensions/`

### Messages Not Posting

**Problem:** Button clicks but nothing happens  
**Solution:**
- Open Chrome DevTools (F12) on the meeting page
- Check Console for errors
- Make sure chat panel is visible
- Try manually opening chat first

### Platform Not Detected

**Problem:** Shows "Not on a supported platform" on meeting page  
**Solution:**
- Refresh the meeting page
- Reload the extension
- Check URL matches: meet.google.com, zoom.us, or teams.microsoft.com

### Build Errors

**Problem:** `npm run build` fails  
**Solution:**
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

## Debug Tools

### Console Logs

**Content Script (on meeting page):**
```javascript
// Open DevTools on meeting page
// Look for:
"Meetily extension content script loaded"
"Detected platform: google-meet"
```

**Background Script:**
```javascript
// Go to chrome://extensions/
// Click "service worker" under Meetily
// Look for:
"Meetily background service worker initialized"
"Added message to queue. Queue length: 1"
```

**Popup:**
```javascript
// Right-click extension icon → Inspect popup
// Check for errors
```

### Manual Testing via Console

On a meeting page, open DevTools and try:

```javascript
// Test platform detection
window.meetilyDebug.detectPlatform()

// Test message posting
window.meetilyDebug.postMessage("Test message")
```

---

## Success Criteria

✅ Extension loads without errors  
✅ Platform detection works on all 3 platforms  
✅ Test messages generate and post successfully  
✅ Manual messages post successfully  
✅ Message queue handles multiple messages  
✅ Error messages display when appropriate  
✅ UI updates reflect current state  

---

## Next: Phase 2 Testing

After Phase 1 testing is complete, Phase 2 will add:
- Real LLM integration with Meetily app
- External messaging from desktop app
- Authentication between app and extension
- Production deployment

For now, focus on testing the core message posting functionality with the test API.
