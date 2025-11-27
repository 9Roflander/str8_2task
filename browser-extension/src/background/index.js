import { generateTestMessage } from './test-api.js';

// Message queue for handling multiple LLM messages
class MessageQueue {
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
                // Wait between messages to avoid overwhelming the platform
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error('Failed to send message:', error);
                // Retry logic: add back to queue if failed (max 3 retries)
                if (!item.retries || item.retries < 3) {
                    item.retries = (item.retries || 0) + 1;
                    console.log(`Retrying message (attempt ${item.retries}/3)`);
                    this.queue.push(item);
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retry
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
                    action: 'postMessage',
                    message: message,
                    platform: platform
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (response && response.success) {
                        console.log('Message posted successfully');
                        resolve(response);
                    } else {
                        reject(new Error(response?.error || 'Unknown error'));
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
}

const messageQueue = new MessageQueue();

// Extension installation handler
chrome.runtime.onInstalled.addListener((details) => {
    console.log('str8_2task extension installed:', details.reason);

    if (details.reason === 'install') {
        chrome.storage.local.set({
            installed: true,
            version: chrome.runtime.getManifest().version
        });
    }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request);

    if (request.action === 'postMessage') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                messageQueue.add(request.message, request.platform, tabs[0].id)
                    .then(() => sendResponse({ success: true }))
                    .catch((error) => sendResponse({ success: false, error: error.message }));
            } else {
                sendResponse({ success: false, error: 'No active tab found' });
            }
        });
        return true; // Keep message channel open for async response
    }

    if (request.action === 'generateTestMessage') {
        generateTestMessage(request.messageType)
            .then((message) => {
                sendResponse({ success: true, message });
            })
            .catch((error) => {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    if (request.action === 'getQueueStatus') {
        sendResponse(messageQueue.getStatus());
        return true;
    }
});

// Handle external messages from str8_2task app (Phase 2)
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    console.log('Background received external message from:', sender.url);
    console.log('Request:', request);

    if (request.action === 'postMessage') {
        // Find the meeting tab
        chrome.tabs.query({}, (tabs) => {
            const meetingTab = tabs.find(tab =>
                tab.url.includes('meet.google.com') ||
                tab.url.includes('zoom.us') ||
                tab.url.includes('teams.microsoft.com') ||
                tab.url.includes('teams.live.com')
            );

            if (meetingTab) {
                messageQueue.add(request.message, request.platform, meetingTab.id)
                    .then(() => sendResponse({ success: true }))
                    .catch((error) => sendResponse({ success: false, error: error.message }));
            } else {
                sendResponse({
                    success: false,
                    error: 'No active meeting tab found'
                });
            }
        });
        return true;
    }

    if (request.action === 'ping') {
        sendResponse({ success: true, message: 'Extension is active' });
        return true;
    }
});

// Extension icon click handler (optional)
chrome.action.onClicked.addListener((tab) => {
    // Could open popup or perform action
});

console.log('str8_2task background service worker initialized');
