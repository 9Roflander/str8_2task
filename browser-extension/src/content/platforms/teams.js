import { waitForElement } from '../utils/dom.js';

export const config = {
    chatSelector: '[data-tid="chat-message"]',
    
    // Multiple selector strategies for Microsoft Teams
    inputSelectors: [
        'div[contenteditable="true"][data-tid="ckeditor"]', // CKEditor input (most specific)
        '[data-tid="chat-input"]',
        '[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][data-tid*="input"]',
        'div[contenteditable="true"][placeholder*="message" i]',
        'div[contenteditable="true"][placeholder*="сообщени" i]', // Russian
        'textarea[placeholder*="message" i]',
        'textarea[placeholder*="сообщени" i]', // Russian
        'textarea[aria-label*="message" i]',
        'textarea[aria-label*="сообщени" i]', // Russian
        'textarea',
    ],
    
    sendButtonSelectors: [
        'button[data-tid="newMessageCommands-send"]', // Most specific Teams send button
        '[data-tid="send-button"]',
        'button[aria-label*="send" i]',
        'button[aria-label*="отправить" i]', // Russian
        'button[aria-label*="enviar" i]', // Spanish
        'button[aria-label*="envoyer" i]', // French
        'button[title*="send" i]',
        'button[title*="Send"]',
        'button[title*="Отправить" i]', // Russian
        'button[data-tid*="send"]',
        'button[class*="send"]',
    ],
    
    chatPanelSelector: '[data-tid="chat-panel"]'
};

export async function ensureChatOpen() {
    // Teams chat is usually always visible in meetings, but we can check
    const chatPanel = document.querySelector(config.chatPanelSelector);
    if (chatPanel && chatPanel.offsetParent !== null) {
        console.log('Teams chat panel is visible');
        return;
    }
    console.log('Teams chat panel check - will proceed anyway');
}

export async function postMessage(message) {
    await ensureChatOpen();
    await new Promise(resolve => setTimeout(resolve, 500));

    let inputElement;
    console.log('Searching for Teams chat input...');

    try {
        inputElement = await waitForElement(config.inputSelectors, 5000);
        console.log('Found input element:', inputElement);
    } catch (e) {
        console.log('Standard selectors failed, trying alternative search...');
        // Try to find any visible textarea or contenteditable
        const allInputs = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'));
        inputElement = allInputs.find(el => {
            const rect = el.getBoundingClientRect();
            return el.offsetParent !== null && rect.width > 0 && rect.height > 0;
        });
    }

    if (!inputElement) {
        throw new Error('Chat input not found in Teams. Make sure the chat panel is open.');
    }

    // Set the message
    if (inputElement.tagName === 'TEXTAREA') {
        inputElement.focus();
        await new Promise(resolve => setTimeout(resolve, 100));
        inputElement.value = message;
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
        // Contenteditable div (CKEditor in Teams)
        inputElement.focus();
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Clear existing content first
        const range = document.createRange();
        range.selectNodeContents(inputElement);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Try using execCommand first (most reliable for contenteditable/CKEditor)
        let contentSet = false;
        try {
            // Select all existing content
            document.execCommand('selectAll', false);
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Insert the new text (this should trigger CKEditor's internal state)
            document.execCommand('insertText', false, message);
            await new Promise(resolve => setTimeout(resolve, 150));
            
            // Verify content was set
            const checkContent = inputElement.textContent || inputElement.innerText || '';
            if (checkContent.trim() === message.trim()) {
                contentSet = true;
                console.log('Successfully set content using execCommand');
            }
        } catch (e) {
            console.log('execCommand failed, trying alternative method:', e);
        }
        
        // Fallback: Direct DOM manipulation with proper events
        if (!contentSet) {
            console.log('Using fallback method to set content...');
            
            // Clear content
            inputElement.textContent = '';
            inputElement.innerText = '';
            
            // Set content directly
            inputElement.textContent = message;
            inputElement.innerText = message;
            
            // Create and dispatch a comprehensive input event
            const inputEvent = new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: message,
                isComposing: false
            });
            inputElement.dispatchEvent(inputEvent);
            
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Dispatch additional events that CKEditor might listen to
        // Focus event to ensure CKEditor knows the field is active
        inputElement.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        
        // Composition events (some editors track these)
        try {
            inputElement.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
            inputElement.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: message }));
            inputElement.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: message }));
        } catch (e) {
            // CompositionEvent might not be available in all browsers
            console.log('CompositionEvent not available:', e);
        }
        
        // Dispatch a regular input event as well
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Trigger change event
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Blur and refocus to trigger any validation
        inputElement.blur();
        await new Promise(resolve => setTimeout(resolve, 50));
        inputElement.focus();
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Wait longer for CKEditor to process the changes
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify content was set
    const actualContent = inputElement.textContent || inputElement.innerText || inputElement.value || '';
    if (!actualContent.trim()) {
        console.warn('Warning: Content appears empty after setting. Trying one more time...');
        // One more attempt with direct manipulation
        if (inputElement.tagName !== 'TEXTAREA') {
            inputElement.textContent = message;
            inputElement.innerText = message;
            inputElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
        }
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Find and click send button
    let sendButton;
    console.log('Searching for Teams send button...');

    // First, try to find button near the input
    const inputParent = inputElement.closest('form') || 
                       inputElement.closest('div[role="group"]') ||
                       inputElement.parentElement?.parentElement;

    if (inputParent) {
        const buttons = inputParent.querySelectorAll('button');
        for (const btn of buttons) {
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            const title = (btn.getAttribute('title') || '').toLowerCase();
            const dataTid = btn.getAttribute('data-tid') || '';
            
            if (ariaLabel.includes('send') || 
                ariaLabel.includes('отправить') ||
                title.includes('send') ||
                dataTid.includes('send')) {
                sendButton = btn;
                console.log('Found send button near input:', sendButton);
                break;
            }
        }
    }

    // If not found, try standard selectors
    if (!sendButton) {
        try {
            sendButton = await waitForElement(config.sendButtonSelectors, 2000);
            console.log('Found send button with standard selector:', sendButton);
        } catch (e) {
            console.log('Standard selectors failed');
        }
    }

    if (!sendButton) {
        // Last resort: try pressing Enter
        console.log('Send button not found, trying Enter key...');
        inputElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
        inputElement.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }));
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
    }

    // Wait for button to become enabled if it's currently disabled
    const isDisabled = () => 
        sendButton.hasAttribute('disabled') || 
        sendButton.getAttribute('aria-disabled') === 'true' ||
        sendButton.classList.contains('disabled') ||
        sendButton.getAttribute('tabindex') === '-1';
    
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
    sendButton.focus();
    await new Promise(resolve => setTimeout(resolve, 100));
    sendButton.click();

    // Also dispatch events to ensure click is registered
    const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0
    });
    sendButton.dispatchEvent(clickEvent);

    // Dispatch pointer events as well (Teams may listen to these)
    const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    const pointerUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true });
    sendButton.dispatchEvent(pointerDown);
    sendButton.dispatchEvent(pointerUp);

    await new Promise(resolve => setTimeout(resolve, 500));

    return true;
}
