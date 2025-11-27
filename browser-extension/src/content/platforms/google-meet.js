import { waitForElement } from '../utils/dom.js';

export const config = {
    chatSelector: '[data-message-text]',

    // Multiple selector strategies for Google Meet
    inputSelectors: [
        'textarea[jsname="YPqjbf"]', // Primary selector from actual Google Meet
        'textarea[aria-label*="сообщени" i]', // Russian "Отправьте сообщение"
        'textarea[aria-label*="message" i]', // English "Send message"
        'textarea[placeholder*="сообщени" i]', // Russian placeholder
        'textarea[placeholder*="message" i]', // English placeholder
        '[contenteditable="true"][data-placeholder*="message"]',
        '[contenteditable="true"][aria-label*="message" i]',
        '[contenteditable="true"][aria-label*="chat" i]',
        'div[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"].Z3IZzb', // Google Meet class
        'div[contenteditable="true"]' // Fallback
    ],

    sendButtonSelectors: [
        // Primary selector using jsname from actual Google Meet button
        'button[jsname="SoqoBf"]',
        // Class-based selectors for the send button
        'button.pYTkkf-Bz112c-LgbsSe',
        'button.OT6Zte.te811b',
        'button[class*="pYTkkf-Bz112c-LgbsSe"]',
        // Language-agnostic aria-label selectors (covers multiple languages)
        'button[aria-label*="отправ" i]', // Russian: "Отправьте сообщение"
        'button[aria-label*="send" i]', // English: "Send message"
        'button[aria-label*="enviar" i]', // Spanish: "Enviar mensaje"
        'button[aria-label*="envoyer" i]', // French: "Envoyer le message"
        'button[aria-label*="senden" i]', // German: "Nachricht senden"
        'button[aria-label*="invia" i]', // Italian: "Invia messaggio"
        'button[aria-label*="送信" i]', // Japanese: "送信"
        'button[aria-label*="发送" i]', // Chinese: "发送"
        // Fallback selectors
        'div.pYTkkf-Bz112c-RLmnJb',
        'button[jsname="G0pghc"]',
        'div[class*="pYTkkf-Bz112c-RLmnJb"]',
        '[data-icon="send"]',
        'button[jsname="Cuz2Ue"]',
        // Note: Emoji send button selector removed to avoid false positives
    ],

    chatPanelSelector: '[data-panel-id="chat"]',

    chatToggleSelectors: [
        'button[aria-label*="чат" i]',
        'button[aria-label*="chat" i]',
        'button[jsname="Qx7uuf"]',
        '[data-tooltip*="Chat" i]',
        '[data-tooltip*="Чат" i]'
    ]
};

export async function ensureChatOpen() {
    let chatPanel = document.querySelector(config.chatPanelSelector);
    let chatVisible = chatPanel && chatPanel.offsetParent !== null;

    if (chatVisible) {
        console.log('Chat panel is already open');
        return;
    }

    console.log('Chat panel not visible, attempting to open...');

    for (const selector of config.chatToggleSelectors) {
        const chatToggle = document.querySelector(selector);
        if (chatToggle && chatToggle.offsetParent !== null) {
            const ariaLabel = (chatToggle.getAttribute('aria-label') || '').toLowerCase();
            const isShowButton = ariaLabel.includes('показать') || ariaLabel.includes('show');

            if (isShowButton || (!ariaLabel.includes('скрыть') && !ariaLabel.includes('hide'))) {
                console.log('Found chat toggle button:', selector, chatToggle);
                chatToggle.click();
                await new Promise(resolve => setTimeout(resolve, 1500));

                chatPanel = document.querySelector(config.chatPanelSelector);
                chatVisible = chatPanel && chatPanel.offsetParent !== null;

                if (chatVisible) {
                    console.log('Chat panel opened successfully');
                    return;
                }
            } else {
                console.log('Skipping chat toggle - it would close the chat:', ariaLabel);
            }
        }
    }

    console.warn('Could not verify chat panel is open, but will try to send message anyway...');
}

export async function postMessage(message) {
    await ensureChatOpen();
    await new Promise(resolve => setTimeout(resolve, 1000));

    let inputElement;
    console.log('Searching for Google Meet chat input...');

    try {
        inputElement = await waitForElement(config.inputSelectors, 5000);
        console.log('Found input element using standard selectors:', inputElement);
    } catch (e) {
        console.log('Standard selectors failed, trying alternative search...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        let textarea = document.querySelector('textarea[jsname="YPqjbf"]');
        if (textarea) {
            inputElement = textarea;
        } else {
            const allTextareas = Array.from(document.querySelectorAll('textarea'));
            inputElement = allTextareas.find(el => {
                const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
                const rect = el.getBoundingClientRect();
                const isVisible = el.offsetParent !== null && rect.width > 0 && rect.height > 0;

                return isVisible && (
                    ariaLabel.includes('сообщени') || ariaLabel.includes('message') ||
                    placeholder.includes('сообщени') || placeholder.includes('message')
                );
            });
        }
    }

    if (!inputElement) {
        throw new Error('Chat input not found in Google Meet');
    }

    // Set the message
    if (inputElement.tagName === 'TEXTAREA') {
        inputElement.focus();
        await new Promise(resolve => setTimeout(resolve, 100));
        inputElement.value = message;
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        // Simulate Enter key press to send the message
        inputElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
        inputElement.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
    } else {
        inputElement.focus();
        await new Promise(resolve => setTimeout(resolve, 100));
        inputElement.textContent = message;
        inputElement.innerText = message;
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        // Simulate Enter key press to send the message
        inputElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
        inputElement.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    // Find and click send button
    let sendButton;
    console.log('Searching for send button...');

    const textareaParent = inputElement.closest('div[role="group"]') ||
        inputElement.closest('form') ||
        inputElement.parentElement?.parentElement;

    if (textareaParent) {
        console.log('Looking for send button near textarea...');
        const clickables = textareaParent.querySelectorAll('button, div[role="button"], div[jsname], div[jsaction*="click"]');
        console.log(`Found ${clickables.length} clickable elements near textarea`);

        for (const el of clickables) {
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const jsname = el.getAttribute('jsname');
            const classes = el.className;

            console.log('Checking element:', {
                tag: el.tagName,
                ariaLabel,
                jsname,
                classes: classes.substring(0, 50),
                disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'
            });

            // Check for send button using multiple criteria
            // 1. Check jsname (most reliable)
            const isSendButtonByJsname = jsname === 'SoqoBf' || jsname === 'G0pghc' || jsname === 'Cuz2Ue';
            
            // 2. Check for specific classes from the provided button structure
            const hasSendButtonClasses = 
                classes.includes('pYTkkf-Bz112c-LgbsSe') ||
                (classes.includes('OT6Zte') && classes.includes('te811b')) ||
                classes.includes('pYTkkf');
            
            // 3. Check aria-label for various languages (send message patterns)
            const sendMessagePatterns = [
                'отправ', // Russian: "Отправьте сообщение" (covers "отправить", "отправьте")
                'send', // English: "Send message"
                'enviar', // Spanish: "Enviar mensaje"
                'envoyer', // French: "Envoyer le message"
                'senden', // German: "Nachricht senden"
                'invia', // Italian: "Invia messaggio"
                '送信', // Japanese: "送信"
                '发送', // Chinese: "发送"
            ];
            const isSendButtonByAriaLabel = sendMessagePatterns.some(pattern => 
                ariaLabel.includes(pattern)
            );
            
            const isSendButton = isSendButtonByJsname || 
                (hasSendButtonClasses && isSendButtonByAriaLabel) ||
                (hasSendButtonClasses && jsname === 'SoqoBf');

            if (isSendButton) {
                // Found the button, even if disabled (we'll wait for it to become enabled)
                sendButton = el;
                const isCurrentlyDisabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
                console.log('Found send button!', el, isCurrentlyDisabled ? '(currently disabled)' : '(enabled)');
                break;
            }
        }
    }

    if (!sendButton) {
        console.log('Trying standard selectors...');
        try {
            // First, try to find the button even if disabled
            for (const selector of config.sendButtonSelectors) {
                const found = document.querySelector(selector);
                if (found) {
                    sendButton = found;
                    console.log('Found send button with standard selector (may be disabled):', sendButton);
                    break;
                }
            }
        } catch (e) {
            console.log('Standard selectors failed');
        }
    }

    if (!sendButton) {
        throw new Error('Send button not found. Make sure the chat is open and you typed a message.');
    }

    // Wait for button to become enabled if it's currently disabled
    const isDisabled = () => 
        sendButton.hasAttribute('disabled') || 
        sendButton.getAttribute('aria-disabled') === 'true' ||
        sendButton.classList.contains('disabled');
    
    if (isDisabled()) {
        console.log('Send button is disabled, waiting for it to become enabled...');
        let attempts = 0;
        const maxAttempts = 20; // 4 seconds max wait
        
        while (isDisabled() && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 200));
            attempts++;
        }
        
        if (isDisabled()) {
            console.warn('Send button is still disabled, but will try to click anyway...');
        } else {
            console.log('Send button is now enabled!');
        }
    }

    console.log('Clicking send button:', sendButton);
    console.log('Send button details:', {
        tag: sendButton.tagName,
        ariaLabel: sendButton.getAttribute('aria-label'),
        classes: sendButton.className,
        jsname: sendButton.getAttribute('jsname')
    });

    sendButton.focus();
    await new Promise(resolve => setTimeout(resolve, 100));
    sendButton.click();

    const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0
    });
    sendButton.dispatchEvent(clickEvent);

    const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    const pointerUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true });
    sendButton.dispatchEvent(pointerDown);
    sendButton.dispatchEvent(pointerUp);

    await new Promise(resolve => setTimeout(resolve, 500));

    return true;
}
