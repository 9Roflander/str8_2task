(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/content/platforms/google-meet.js
  var google_meet_exports = {};
  __export(google_meet_exports, {
    config: () => config,
    ensureChatOpen: () => ensureChatOpen,
    postMessage: () => postMessage
  });

  // src/content/utils/dom.js
  function waitForElement(selectors, timeout = 5e3) {
    return new Promise((resolve, reject) => {
      const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
      const startTime = Date.now();
      let attempts = 0;
      const check = () => {
        attempts++;
        for (const selector of selectorArray) {
          const element = document.querySelector(selector);
          if (element && element.offsetParent !== null) {
            resolve(element);
            return;
          }
        }
        if (Date.now() - startTime >= timeout) {
          reject(new Error(`Element not found with selectors: ${selectorArray.join(", ")} after ${attempts} attempts`));
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  }

  // src/content/platforms/google-meet.js
  var config = {
    chatSelector: "[data-message-text]",
    // Multiple selector strategies for Google Meet
    inputSelectors: [
      'textarea[jsname="YPqjbf"]',
      // Primary selector from actual Google Meet
      'textarea[aria-label*="\u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438" i]',
      // Russian "Отправьте сообщение"
      'textarea[aria-label*="message" i]',
      // English "Send message"
      'textarea[placeholder*="\u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438" i]',
      // Russian placeholder
      'textarea[placeholder*="message" i]',
      // English placeholder
      '[contenteditable="true"][data-placeholder*="message"]',
      '[contenteditable="true"][aria-label*="message" i]',
      '[contenteditable="true"][aria-label*="chat" i]',
      'div[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"].Z3IZzb',
      // Google Meet class
      'div[contenteditable="true"]'
      // Fallback
    ],
    sendButtonSelectors: [
      "div.pYTkkf-Bz112c-RLmnJb",
      // This is the actual send button (it's a div!)
      'button[jsname="G0pghc"]',
      'button[aria-label*="\u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C" i]',
      'button[aria-label*="send" i]',
      'div[class*="pYTkkf-Bz112c-RLmnJb"]',
      '[data-icon="send"]',
      'button[jsname="Cuz2Ue"]'
    ],
    chatPanelSelector: '[data-panel-id="chat"]',
    chatToggleSelectors: [
      'button[aria-label*="\u0447\u0430\u0442" i]',
      'button[aria-label*="chat" i]',
      'button[jsname="Qx7uuf"]',
      '[data-tooltip*="Chat" i]',
      '[data-tooltip*="\u0427\u0430\u0442" i]'
    ]
  };
  async function ensureChatOpen() {
    let chatPanel = document.querySelector(config.chatPanelSelector);
    let chatVisible = chatPanel && chatPanel.offsetParent !== null;
    if (chatVisible) {
      console.log("Chat panel is already open");
      return;
    }
    console.log("Chat panel not visible, attempting to open...");
    for (const selector of config.chatToggleSelectors) {
      const chatToggle = document.querySelector(selector);
      if (chatToggle && chatToggle.offsetParent !== null) {
        const ariaLabel = (chatToggle.getAttribute("aria-label") || "").toLowerCase();
        const isShowButton = ariaLabel.includes("\u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C") || ariaLabel.includes("show");
        if (isShowButton || !ariaLabel.includes("\u0441\u043A\u0440\u044B\u0442\u044C") && !ariaLabel.includes("hide")) {
          console.log("Found chat toggle button:", selector, chatToggle);
          chatToggle.click();
          await new Promise((resolve) => setTimeout(resolve, 1500));
          chatPanel = document.querySelector(config.chatPanelSelector);
          chatVisible = chatPanel && chatPanel.offsetParent !== null;
          if (chatVisible) {
            console.log("Chat panel opened successfully");
            return;
          }
        } else {
          console.log("Skipping chat toggle - it would close the chat:", ariaLabel);
        }
      }
    }
    console.warn("Could not verify chat panel is open, but will try to send message anyway...");
  }
  async function postMessage(message) {
    await ensureChatOpen();
    await new Promise((resolve) => setTimeout(resolve, 1e3));
    let inputElement;
    console.log("Searching for Google Meet chat input...");
    try {
      inputElement = await waitForElement(config.inputSelectors, 5e3);
      console.log("Found input element using standard selectors:", inputElement);
    } catch (e) {
      console.log("Standard selectors failed, trying alternative search...");
      await new Promise((resolve) => setTimeout(resolve, 1e3));
      let textarea = document.querySelector('textarea[jsname="YPqjbf"]');
      if (textarea) {
        inputElement = textarea;
      } else {
        const allTextareas = Array.from(document.querySelectorAll("textarea"));
        inputElement = allTextareas.find((el) => {
          const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
          const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
          const rect = el.getBoundingClientRect();
          const isVisible = el.offsetParent !== null && rect.width > 0 && rect.height > 0;
          return isVisible && (ariaLabel.includes("\u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438") || ariaLabel.includes("message") || placeholder.includes("\u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438") || placeholder.includes("message"));
        });
      }
    }
    if (!inputElement) {
      throw new Error("Chat input not found in Google Meet");
    }
    if (inputElement.tagName === "TEXTAREA") {
      inputElement.focus();
      await new Promise((resolve) => setTimeout(resolve, 100));
      inputElement.value = message;
      inputElement.dispatchEvent(new Event("input", { bubbles: true }));
      inputElement.dispatchEvent(new Event("change", { bubbles: true }));
      inputElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
      inputElement.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));
    } else {
      inputElement.focus();
      await new Promise((resolve) => setTimeout(resolve, 100));
      inputElement.textContent = message;
      inputElement.innerText = message;
      inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    let sendButton;
    console.log("Searching for send button...");
    const textareaParent = inputElement.closest('div[role="group"]') || inputElement.closest("form") || inputElement.parentElement?.parentElement;
    if (textareaParent) {
      console.log("Looking for send button near textarea...");
      const clickables = textareaParent.querySelectorAll('button, div[role="button"], div[jsname], div[jsaction*="click"]');
      console.log(`Found ${clickables.length} clickable elements near textarea`);
      for (const el of clickables) {
        const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
        const jsname = el.getAttribute("jsname");
        const classes = el.className;
        console.log("Checking element:", {
          tag: el.tagName,
          ariaLabel,
          jsname,
          classes: classes.substring(0, 50),
          disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true"
        });
        const isSendButton = ariaLabel.includes("\u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C") || ariaLabel.includes("send") || jsname === "G0pghc" || classes.includes("pYTkkf") && ariaLabel.includes("\u043E\u0442\u043A\u043B\u0438\u043A");
        if (isSendButton && !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true") {
          sendButton = el;
          console.log("Found send button!", el);
          break;
        }
      }
    }
    if (!sendButton) {
      console.log("Trying standard selectors...");
      try {
        sendButton = await waitForElement(config.sendButtonSelectors, 2e3);
        console.log("Found send button with standard selector:", sendButton);
      } catch (e) {
        console.log("Standard selectors failed");
      }
    }
    if (!sendButton) {
      throw new Error("Send button not found. Make sure the chat is open and you typed a message.");
    }
    console.log("Clicking send button:", sendButton);
    console.log("Send button details:", {
      tag: sendButton.tagName,
      ariaLabel: sendButton.getAttribute("aria-label"),
      classes: sendButton.className,
      jsname: sendButton.getAttribute("jsname")
    });
    sendButton.focus();
    await new Promise((resolve) => setTimeout(resolve, 100));
    sendButton.click();
    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0
    });
    sendButton.dispatchEvent(clickEvent);
    const pointerDown = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    const pointerUp = new PointerEvent("pointerup", { bubbles: true, cancelable: true });
    sendButton.dispatchEvent(pointerDown);
    sendButton.dispatchEvent(pointerUp);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return true;
  }

  // src/content/platforms/zoom.js
  var zoom_exports = {};
  __export(zoom_exports, {
    config: () => config2,
    postMessage: () => postMessage2
  });
  var config2 = {
    chatSelector: ".zm-chat-message",
    inputSelector: "#chatInput",
    sendButtonSelector: '[aria-label="Send"]',
    chatPanelSelector: "#chatPanel"
  };
  async function postMessage2(message) {
    const inputElement = await waitForElement(config2.inputSelector, 5e3);
    if (!inputElement) {
      throw new Error("Chat input not found in Zoom");
    }
    inputElement.value = message;
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const sendButton = await waitForElement(config2.sendButtonSelector, 2e3);
    if (!sendButton) {
      throw new Error("Send button not found in Zoom");
    }
    sendButton.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return true;
  }

  // src/content/platforms/teams.js
  var teams_exports = {};
  __export(teams_exports, {
    config: () => config3,
    postMessage: () => postMessage3
  });
  var config3 = {
    chatSelector: '[data-tid="chat-message"]',
    inputSelector: '[data-tid="chat-input"]',
    sendButtonSelector: '[data-tid="send-button"]',
    chatPanelSelector: '[data-tid="chat-panel"]'
  };
  async function postMessage3(message) {
    const inputElement = await waitForElement(config3.inputSelector, 5e3);
    if (!inputElement) {
      throw new Error("Chat input not found in Teams");
    }
    inputElement.value = message;
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const sendButton = await waitForElement(config3.sendButtonSelector, 2e3);
    if (!sendButton) {
      throw new Error("Send button not found in Teams");
    }
    sendButton.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return true;
  }

  // src/content/index.js
  function detectPlatform() {
    const url = window.location.href;
    if (url.includes("meet.google.com")) {
      return "google-meet";
    } else if (url.includes("zoom.us") || url.includes(".zoom.us")) {
      return "zoom";
    } else if (url.includes("teams.microsoft.com")) {
      return "microsoft-teams";
    }
    return null;
  }
  var platforms = {
    "google-meet": google_meet_exports,
    "zoom": zoom_exports,
    "microsoft-teams": teams_exports
  };
  async function postMessage4(message, platform = null) {
    if (!message || message.trim() === "") {
      throw new Error("Message cannot be empty");
    }
    if (!platform) {
      platform = detectPlatform();
      if (!platform) {
        throw new Error("Not on a supported meeting platform");
      }
    }
    const platformModule = platforms[platform];
    if (!platformModule) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    try {
      return await platformModule.postMessage(message);
    } catch (error) {
      console.error(`Failed to post message to ${platform}:`, error);
      throw error;
    }
  }
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "postMessage") {
      postMessage4(request.message, request.platform).then((success) => {
        sendResponse({ success: true });
      }).catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }
    if (request.action === "detectPlatform") {
      const platform = detectPlatform();
      sendResponse({ platform });
      return true;
    }
  });
  console.log("Meetily extension content script loaded");
  var currentPlatform = detectPlatform();
  if (currentPlatform) {
    console.log(`Detected platform: ${currentPlatform}`);
  }
  window.meetilyDebug = {
    detectPlatform,
    postMessage: postMessage4
  };
  document.body.setAttribute("data-meetily-installed", "true");
})();
//# sourceMappingURL=content.js.map
