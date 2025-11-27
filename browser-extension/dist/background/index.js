(() => {
  // src/background/test-api.js
  var testMessages = {
    acknowledgment: [
      "Thank you for sharing that insight.",
      "That's a great point, I appreciate the clarification.",
      "Understood, thanks for explaining.",
      "I see what you mean, that makes sense.",
      "Good to know, thank you!"
    ],
    question: [
      "Could you elaborate on that point?",
      "What are the next steps for this?",
      "How does this align with our timeline?",
      "Can you provide more details about the implementation?",
      "What would be the best approach here?"
    ],
    summary: [
      "To summarize: we'll proceed with the discussed approach.",
      "Let me recap the key points from this discussion.",
      "Just to confirm, we agreed on the following action items.",
      "In summary, the main takeaways are...",
      "To wrap up, here's what we've decided."
    ]
  };
  async function generateTestMessage(type = "acknowledgment") {
    await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 500));
    const messages = testMessages[type] || testMessages.acknowledgment;
    const randomIndex = Math.floor(Math.random() * messages.length);
    return messages[randomIndex];
  }

  // src/background/index.js
  var MessageQueue = class {
    constructor() {
      this.queue = [];
      this.processing = false;
    }
    async add(message, platform, tabId) {
      this.queue.push({ message, platform, tabId, timestamp: Date.now() });
      console.log(`Added message to queue. Queue length: ${this.queue.length}`);
      if (!this.processing) {
        await this.process();
      }
    }
    async process() {
      if (this.processing || this.queue.length === 0) {
        return;
      }
      this.processing = true;
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        console.log(`Processing message from queue. Remaining: ${this.queue.length}`);
        try {
          await this.sendMessage(item);
          await new Promise((resolve) => setTimeout(resolve, 1e3));
        } catch (error) {
          console.error("Failed to send message:", error);
          if (!item.retries || item.retries < 3) {
            item.retries = (item.retries || 0) + 1;
            console.log(`Retrying message (attempt ${item.retries}/3)`);
            this.queue.push(item);
            await new Promise((resolve) => setTimeout(resolve, 2e3));
          }
        }
      }
      this.processing = false;
    }
    async sendMessage({ message, platform, tabId }) {
      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(
          tabId,
          {
            action: "postMessage",
            message,
            platform
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.success) {
              console.log("Message posted successfully");
              resolve(response);
            } else {
              reject(new Error(response?.error || "Unknown error"));
            }
          }
        );
      });
    }
    getStatus() {
      return {
        queueLength: this.queue.length,
        processing: this.processing
      };
    }
  };
  var messageQueue = new MessageQueue();
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
          messageQueue.add(request.message, request.platform, tabs[0].id).then(() => sendResponse({ success: true })).catch((error) => sendResponse({ success: false, error: error.message }));
        } else {
          sendResponse({ success: false, error: "No active tab found" });
        }
      });
      return true;
    }
    if (request.action === "generateTestMessage") {
      generateTestMessage(request.messageType).then((message) => {
        sendResponse({ success: true, message });
      }).catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }
    if (request.action === "getQueueStatus") {
      sendResponse(messageQueue.getStatus());
      return true;
    }
  });
  chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    console.log("Background received external message from:", sender.url);
    console.log("Request:", request);
    if (request.action === "postMessage") {
      chrome.tabs.query({}, (tabs) => {
        const meetingTab = tabs.find(
          (tab) => tab.url.includes("meet.google.com") || tab.url.includes("zoom.us") || tab.url.includes("teams.microsoft.com") || tab.url.includes("teams.live.com")
        );
        if (meetingTab) {
          messageQueue.add(request.message, request.platform, meetingTab.id).then(() => sendResponse({ success: true })).catch((error) => sendResponse({ success: false, error: error.message }));
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
  console.log("Meetily background service worker initialized");
})();
//# sourceMappingURL=index.js.map
