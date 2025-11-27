(() => {
  // src/background/index.js
  chrome.runtime.onInstalled.addListener((details) => {
    console.log("Meetily extension installed:", details.reason);
    if (details.reason === "install") {
      chrome.storage.local.set({
        installed: true,
        version: chrome.runtime.getManifest().version
      });
    }
  });
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background received message:", request);
    if (request.action === "postMessage") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "postMessage",
            message: request.message,
            platform: request.platform
          });
        }
      });
      sendResponse({ success: true });
    }
    return true;
  });
  chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    console.log("Background received external message from:", sender.url);
    console.log("Request:", request);
    if (request.action === "postMessage") {
      chrome.tabs.query({}, (tabs) => {
        const meetingTab = tabs.find(
          (tab) => tab.url.includes("meet.google.com") || tab.url.includes("zoom.us") || tab.url.includes("teams.microsoft.com")
        );
        if (meetingTab) {
          chrome.tabs.sendMessage(meetingTab.id, {
            action: "postMessage",
            message: request.message,
            platform: request.platform
          }, (response) => {
            if (chrome.runtime.lastError) {
              sendResponse({
                success: false,
                error: chrome.runtime.lastError.message
              });
            } else {
              sendResponse(response);
            }
          });
        } else {
          sendResponse({
            success: false,
            error: "No active meeting tab found"
          });
        }
      });
      return true;
    }
    if (request.action === "ping") {
      sendResponse({ success: true, message: "Extension is active" });
      return true;
    }
  });
  chrome.action.onClicked.addListener((tab) => {
  });
})();
//# sourceMappingURL=background.js.map
