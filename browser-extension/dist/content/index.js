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
      // Primary selector using jsname from actual Google Meet button
      'button[jsname="SoqoBf"]',
      // Class-based selectors for the send button
      "button.pYTkkf-Bz112c-LgbsSe",
      "button.OT6Zte.te811b",
      'button[class*="pYTkkf-Bz112c-LgbsSe"]',
      // Language-agnostic aria-label selectors (covers multiple languages)
      'button[aria-label*="\u043E\u0442\u043F\u0440\u0430\u0432" i]',
      // Russian: "Отправьте сообщение"
      'button[aria-label*="send" i]',
      // English: "Send message"
      'button[aria-label*="enviar" i]',
      // Spanish: "Enviar mensaje"
      'button[aria-label*="envoyer" i]',
      // French: "Envoyer le message"
      'button[aria-label*="senden" i]',
      // German: "Nachricht senden"
      'button[aria-label*="invia" i]',
      // Italian: "Invia messaggio"
      'button[aria-label*="\u9001\u4FE1" i]',
      // Japanese: "送信"
      'button[aria-label*="\u53D1\u9001" i]',
      // Chinese: "发送"
      // Fallback selectors
      "div.pYTkkf-Bz112c-RLmnJb",
      'button[jsname="G0pghc"]',
      'div[class*="pYTkkf-Bz112c-RLmnJb"]',
      '[data-icon="send"]',
      'button[jsname="Cuz2Ue"]'
      // Note: Emoji send button selector removed to avoid false positives
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
      inputElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      inputElement.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
    } else {
      inputElement.focus();
      await new Promise((resolve) => setTimeout(resolve, 100));
      inputElement.textContent = message;
      inputElement.innerText = message;
      inputElement.dispatchEvent(new Event("input", { bubbles: true }));
      inputElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      inputElement.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
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
        const isSendButtonByJsname = jsname === "SoqoBf" || jsname === "G0pghc" || jsname === "Cuz2Ue";
        const hasSendButtonClasses = classes.includes("pYTkkf-Bz112c-LgbsSe") || classes.includes("OT6Zte") && classes.includes("te811b") || classes.includes("pYTkkf");
        const sendMessagePatterns = [
          "\u043E\u0442\u043F\u0440\u0430\u0432",
          // Russian: "Отправьте сообщение" (covers "отправить", "отправьте")
          "send",
          // English: "Send message"
          "enviar",
          // Spanish: "Enviar mensaje"
          "envoyer",
          // French: "Envoyer le message"
          "senden",
          // German: "Nachricht senden"
          "invia",
          // Italian: "Invia messaggio"
          "\u9001\u4FE1",
          // Japanese: "送信"
          "\u53D1\u9001"
          // Chinese: "发送"
        ];
        const isSendButtonByAriaLabel = sendMessagePatterns.some(
          (pattern) => ariaLabel.includes(pattern)
        );
        const isSendButton = isSendButtonByJsname || hasSendButtonClasses && isSendButtonByAriaLabel || hasSendButtonClasses && jsname === "SoqoBf";
        if (isSendButton) {
          sendButton = el;
          const isCurrentlyDisabled = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
          console.log("Found send button!", el, isCurrentlyDisabled ? "(currently disabled)" : "(enabled)");
          break;
        }
      }
    }
    if (!sendButton) {
      console.log("Trying standard selectors...");
      try {
        for (const selector of config.sendButtonSelectors) {
          const found = document.querySelector(selector);
          if (found) {
            sendButton = found;
            console.log("Found send button with standard selector (may be disabled):", sendButton);
            break;
          }
        }
      } catch (e) {
        console.log("Standard selectors failed");
      }
    }
    if (!sendButton) {
      throw new Error("Send button not found. Make sure the chat is open and you typed a message.");
    }
    const isDisabled = () => sendButton.hasAttribute("disabled") || sendButton.getAttribute("aria-disabled") === "true" || sendButton.classList.contains("disabled");
    if (isDisabled()) {
      console.log("Send button is disabled, waiting for it to become enabled...");
      let attempts = 0;
      const maxAttempts = 20;
      while (isDisabled() && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        attempts++;
      }
      if (isDisabled()) {
        console.warn("Send button is still disabled, but will try to click anyway...");
      } else {
        console.log("Send button is now enabled!");
      }
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
    ensureChatOpen: () => ensureChatOpen2,
    postMessage: () => postMessage3
  });
  var config3 = {
    chatSelector: '[data-tid="chat-message"]',
    // Multiple selector strategies for Microsoft Teams
    inputSelectors: [
      'div[contenteditable="true"][data-tid="ckeditor"]',
      // CKEditor input (most specific)
      '[data-tid="chat-input"]',
      '[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-tid*="input"]',
      'div[contenteditable="true"][placeholder*="message" i]',
      'div[contenteditable="true"][placeholder*="\u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438" i]',
      // Russian
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="\u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438" i]',
      // Russian
      'textarea[aria-label*="message" i]',
      'textarea[aria-label*="\u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438" i]',
      // Russian
      "textarea"
    ],
    sendButtonSelectors: [
      'button[data-tid="newMessageCommands-send"]',
      // Most specific Teams send button
      '[data-tid="send-button"]',
      'button[aria-label*="send" i]',
      'button[aria-label*="\u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C" i]',
      // Russian
      'button[aria-label*="enviar" i]',
      // Spanish
      'button[aria-label*="envoyer" i]',
      // French
      'button[title*="send" i]',
      'button[title*="Send"]',
      'button[title*="\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C" i]',
      // Russian
      'button[data-tid*="send"]',
      'button[class*="send"]'
    ],
    chatPanelSelector: '[data-tid="chat-panel"]'
  };
  async function ensureChatOpen2() {
    const chatPanel = document.querySelector(config3.chatPanelSelector);
    if (chatPanel && chatPanel.offsetParent !== null) {
      console.log("Teams chat panel is visible");
      return;
    }
    console.log("Teams chat panel check - will proceed anyway");
  }
  async function postMessage3(message) {
    await ensureChatOpen2();
    await new Promise((resolve) => setTimeout(resolve, 500));
    let inputElement;
    console.log("Searching for Teams chat input...");
    try {
      inputElement = await waitForElement(config3.inputSelectors, 5e3);
      console.log("Found input element:", inputElement);
    } catch (e) {
      console.log("Standard selectors failed, trying alternative search...");
      const allInputs = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'));
      inputElement = allInputs.find((el) => {
        const rect = el.getBoundingClientRect();
        return el.offsetParent !== null && rect.width > 0 && rect.height > 0;
      });
    }
    if (!inputElement) {
      throw new Error("Chat input not found in Teams. Make sure the chat panel is open.");
    }
    if (inputElement.tagName === "TEXTAREA") {
      inputElement.focus();
      await new Promise((resolve) => setTimeout(resolve, 100));
      inputElement.value = message;
      inputElement.dispatchEvent(new Event("input", { bubbles: true }));
      inputElement.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      inputElement.focus();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const range = document.createRange();
      range.selectNodeContents(inputElement);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      let contentSet = false;
      try {
        document.execCommand("selectAll", false);
        await new Promise((resolve) => setTimeout(resolve, 50));
        document.execCommand("insertText", false, message);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const checkContent = inputElement.textContent || inputElement.innerText || "";
        if (checkContent.trim() === message.trim()) {
          contentSet = true;
          console.log("Successfully set content using execCommand");
        }
      } catch (e) {
        console.log("execCommand failed, trying alternative method:", e);
      }
      if (!contentSet) {
        console.log("Using fallback method to set content...");
        inputElement.textContent = "";
        inputElement.innerText = "";
        inputElement.textContent = message;
        inputElement.innerText = message;
        const inputEvent = new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: message,
          isComposing: false
        });
        inputElement.dispatchEvent(inputEvent);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      inputElement.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
      try {
        inputElement.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        inputElement.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: message }));
        inputElement.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: message }));
      } catch (e) {
        console.log("CompositionEvent not available:", e);
      }
      inputElement.dispatchEvent(new Event("input", { bubbles: true }));
      inputElement.dispatchEvent(new Event("change", { bubbles: true }));
      inputElement.blur();
      await new Promise((resolve) => setTimeout(resolve, 50));
      inputElement.focus();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const actualContent = inputElement.textContent || inputElement.innerText || inputElement.value || "";
    if (!actualContent.trim()) {
      console.warn("Warning: Content appears empty after setting. Trying one more time...");
      if (inputElement.tagName !== "TEXTAREA") {
        inputElement.textContent = message;
        inputElement.innerText = message;
        inputElement.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: message }));
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    let sendButton;
    console.log("Searching for Teams send button...");
    const inputParent = inputElement.closest("form") || inputElement.closest('div[role="group"]') || inputElement.parentElement?.parentElement;
    if (inputParent) {
      const buttons = inputParent.querySelectorAll("button");
      for (const btn of buttons) {
        const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
        const title = (btn.getAttribute("title") || "").toLowerCase();
        const dataTid = btn.getAttribute("data-tid") || "";
        if (ariaLabel.includes("send") || ariaLabel.includes("\u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C") || title.includes("send") || dataTid.includes("send")) {
          sendButton = btn;
          console.log("Found send button near input:", sendButton);
          break;
        }
      }
    }
    if (!sendButton) {
      try {
        sendButton = await waitForElement(config3.sendButtonSelectors, 2e3);
        console.log("Found send button with standard selector:", sendButton);
      } catch (e) {
        console.log("Standard selectors failed");
      }
    }
    if (!sendButton) {
      console.log("Send button not found, trying Enter key...");
      inputElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
      inputElement.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter" }));
      await new Promise((resolve) => setTimeout(resolve, 500));
      return true;
    }
    const isDisabled = () => sendButton.hasAttribute("disabled") || sendButton.getAttribute("aria-disabled") === "true" || sendButton.classList.contains("disabled") || sendButton.getAttribute("tabindex") === "-1";
    if (isDisabled()) {
      console.log("Send button is disabled, waiting for it to become enabled...");
      let attempts = 0;
      const maxAttempts = 20;
      while (isDisabled() && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        attempts++;
      }
      if (isDisabled()) {
        console.warn("Send button is still disabled, but will try to click anyway...");
      } else {
        console.log("Send button is now enabled!");
      }
    }
    console.log("Clicking send button:", sendButton);
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

  // src/content/index.js
  function detectPlatform() {
    const url = window.location.href;
    if (url.includes("meet.google.com")) {
      return "google-meet";
    } else if (url.includes("zoom.us") || url.includes(".zoom.us")) {
      return "zoom";
    } else if (url.includes("teams.microsoft.com") || url.includes("teams.live.com")) {
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
  window.str8_2taskDebug = {
    detectPlatform,
    postMessage: postMessage4
  };
  document.body.setAttribute("data-str8_2task-installed", "true");
})();
//# sourceMappingURL=index.js.map
