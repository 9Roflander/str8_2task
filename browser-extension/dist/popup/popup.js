(() => {
  // src/popup/popup.js
  var currentPlatform = null;
  document.addEventListener("DOMContentLoaded", async () => {
    await detectPlatform();
    setupEventListeners();
    startQueueStatusPolling();
  });
  async function detectPlatform() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        updateStatus(false, "No active tab");
        return;
      }
      let retries = 3;
      let response = null;
      while (retries > 0 && !response) {
        try {
          response = await chrome.tabs.sendMessage(tab.id, { action: "detectPlatform" });
          if (response && response.platform) {
            break;
          }
        } catch (error) {
          console.log(`Platform detection attempt failed, retries left: ${retries - 1}`);
          retries--;
          if (retries > 0) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }
      }
      if (response && response.platform) {
        currentPlatform = response.platform;
        const platformNames = {
          "google-meet": "Google Meet",
          "zoom": "Zoom",
          "microsoft-teams": "Microsoft Teams"
        };
        updateStatus(true, `Connected to ${platformNames[currentPlatform]}`);
        enableButtons();
      } else {
        updateStatus(false, "Not on a supported platform");
      }
    } catch (error) {
      console.error("Error detecting platform:", error);
      updateStatus(false, "Not on a supported platform");
    }
  }
  function updateStatus(isActive, message) {
    const statusEl = document.getElementById("status");
    const statusDot = statusEl.querySelector(".status-dot");
    const statusText = statusEl.querySelector("span");
    if (isActive) {
      statusEl.className = "status active";
    } else {
      statusEl.className = "status inactive";
    }
    statusText.textContent = message;
  }
  function enableButtons() {
    document.getElementById("testLLMButton").disabled = false;
    document.getElementById("postButton").disabled = false;
  }
  function setupEventListeners() {
    document.getElementById("testLLMButton").addEventListener("click", async () => {
      const button = document.getElementById("testLLMButton");
      const messageType = document.getElementById("messageType").value;
      button.disabled = true;
      button.textContent = "Generating message...";
      try {
        const response = await chrome.runtime.sendMessage({
          action: "generateTestMessage",
          messageType
        });
        if (response.success) {
          button.textContent = "Posting message...";
          await postMessage(response.message);
          button.textContent = "\u2713 Message Posted!";
          setTimeout(() => {
            button.textContent = "Generate & Post Test Message";
            button.disabled = false;
          }, 2e3);
        } else {
          throw new Error(response.error || "Failed to generate message");
        }
      } catch (error) {
        console.error("Error with test message:", error);
        button.textContent = "\u2717 Failed";
        setTimeout(() => {
          button.textContent = "Generate & Post Test Message";
          button.disabled = false;
        }, 2e3);
        showError(error.message);
      }
    });
    document.getElementById("postButton").addEventListener("click", async () => {
      const messageInput = document.getElementById("message");
      const message = messageInput.value.trim();
      if (!message) {
        showError("Please enter a message");
        return;
      }
      const button = document.getElementById("postButton");
      button.disabled = true;
      button.textContent = "Posting...";
      try {
        await postMessage(message);
        button.textContent = "\u2713 Posted!";
        messageInput.value = "";
        setTimeout(() => {
          button.textContent = "Post Message";
          button.disabled = false;
        }, 2e3);
      } catch (error) {
        console.error("Error posting message:", error);
        button.textContent = "\u2717 Failed";
        setTimeout(() => {
          button.textContent = "Post Message";
          button.disabled = false;
        }, 2e3);
        showError(error.message);
      }
    });
  }
  async function postMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: "postMessage",
          message,
          platform: currentPlatform
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.success) {
            resolve(response);
          } else {
            reject(new Error(response?.error || "Failed to post message"));
          }
        }
      );
    });
  }
  function showError(message) {
    const statusEl = document.getElementById("status");
    const originalClass = statusEl.className;
    const originalText = statusEl.querySelector("span").textContent;
    updateStatus(false, `Error: ${message}`);
    setTimeout(() => {
      statusEl.className = originalClass;
      statusEl.querySelector("span").textContent = originalText;
    }, 3e3);
  }
  function startQueueStatusPolling() {
    updateQueueStatus();
    setInterval(updateQueueStatus, 1e3);
  }
  async function updateQueueStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: "getQueueStatus" });
      if (response) {
        const queueStatusEl = document.getElementById("queueStatus");
        const queueLengthEl = document.getElementById("queueLength");
        queueLengthEl.textContent = response.queueLength;
        if (response.queueLength > 0 || response.processing) {
          queueStatusEl.classList.add("visible");
        } else {
          queueStatusEl.classList.remove("visible");
        }
      }
    } catch (error) {
    }
  }
})();
//# sourceMappingURL=popup.js.map
