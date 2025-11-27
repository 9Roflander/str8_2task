import { waitForElement } from '../utils/dom.js';

export const config = {
    chatSelector: '.zm-chat-message',
    inputSelector: '#chatInput',
    sendButtonSelector: '[aria-label="Send"]',
    chatPanelSelector: '#chatPanel'
};

export async function postMessage(message) {
    const inputElement = await waitForElement(config.inputSelector, 5000);

    if (!inputElement) {
        throw new Error('Chat input not found in Zoom');
    }

    inputElement.value = message;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 200));

    const sendButton = await waitForElement(config.sendButtonSelector, 2000);

    if (!sendButton) {
        throw new Error('Send button not found in Zoom');
    }

    sendButton.click();
    await new Promise(resolve => setTimeout(resolve, 300));

    return true;
}
