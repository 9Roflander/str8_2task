# Meetily Extension - Quick Reference

## 🚀 Quick Start

1. **Load Extension:**
   - Open `chrome://extensions/`
   - Enable Developer Mode
   - Load unpacked → Select `dist` folder

2. **Test on Google Meet:**
   - Go to https://meet.google.com/new
   - Click Meetily icon
   - Click "Generate & Post Test Message"

## 📁 Project Structure

```
browser-extension/
├── src/              # Source code (edit here)
├── dist/             # Built files (load in Chrome)
├── build.js          # Build configuration
└── package.json      # Dependencies
```

## 🛠️ Development Commands

```bash
# Install dependencies
npm install

# Build extension
npm run build

# Watch mode (auto-rebuild)
npm run watch

# After changes: reload extension in chrome://extensions/
```

## ✨ Features

- **Test LLM Messages**: Generate and post AI-like messages
- **Message Queue**: Handles multiple messages with retry logic
- **Platform Support**: Google Meet, Zoom, Microsoft Teams
- **Manual Posting**: Type and send custom messages

## 🎯 Message Types

- **Acknowledgment**: "Thank you for sharing that insight."
- **Question**: "Could you elaborate on that point?"
- **Summary**: "To summarize: we'll proceed..."

## 📝 Files to Know

| File | Purpose |
|------|---------|
| `src/background/index.js` | Message queue & handlers |
| `src/background/test-api.js` | Mock LLM API |
| `src/content/index.js` | Main content script |
| `src/content/platforms/google-meet.js` | Google Meet integration |
| `src/popup/popup.html` | Extension UI |
| `src/popup/popup.js` | UI logic |

## 🔧 Customization

### Add New Message Types

Edit `src/background/test-api.js`:

```javascript
const testMessages = {
  acknowledgment: [...],
  question: [...],
  summary: [...],
  yourType: ["Your message here"]  // Add this
};
```

Then update `src/popup/popup.html`:

```html
<select id="messageType">
  <option value="yourType">Your Type</option>
</select>
```

### Modify Google Meet Selectors

Edit `src/content/platforms/google-meet.js` if Google Meet UI changes.

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Extension not loading | Select `dist` folder, not root |
| Messages not posting | Check chat is open, refresh page |
| Build fails | `rm -rf node_modules && npm install` |

## 📚 Documentation

- [TESTING.md](file:///Users/sultangazydairov/meeting-minutes/browser-extension/TESTING.md) - Detailed testing guide
- [Walkthrough](file:///Users/sultangazydairov/.gemini/antigravity/brain/849aa191-293f-463c-8cee-6062affc6aa6/walkthrough.md) - Complete implementation details
- [Implementation Plan](file:///Users/sultangazydairov/.gemini/antigravity/brain/849aa191-293f-463c-8cee-6062affc6aa6/implementation_plan.md) - Architecture & design

## 🔮 Phase 2: App Integration

Next steps to connect with Meetily app:
1. Publish extension to get extension ID
2. Add `externally_connectable` to manifest
3. Create backend API endpoint
4. Replace test API with real LLM calls
5. Add authentication

See walkthrough for details.

## 📞 Support

Check console logs:
- **Content script**: DevTools on meeting page
- **Background**: Click "service worker" in chrome://extensions/
- **Popup**: Right-click icon → Inspect popup
