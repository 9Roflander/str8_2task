import { generateTestMessage } from './test-api.js';

// ============================================================================
// Configuration
// ============================================================================

const BACKEND_WS_URL = 'ws://localhost:5167/ws/extension';
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;

// ============================================================================
// WebSocket Connection Manager
// ============================================================================

class WebSocketManager {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.connectionId = null;
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        this.shouldReconnect = true;
    }

    connect() {
        if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
            console.log('WebSocket already connected or connecting');
            return;
        }

        this.isConnecting = true;
        this.connectionId = `ext-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
        
        const wsUrl = `${this.url}?connection_id=${this.connectionId}`;
        console.log(`Connecting to WebSocket: ${wsUrl}`);

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('WebSocket connected to backend');
                this.isConnecting = false;
                this.reconnectAttempts = 0;
                
                // Send initial status
                this.sendStatus();
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this.ws.onclose = (event) => {
                console.log(`WebSocket closed: ${event.code} - ${event.reason}`);
                this.isConnecting = false;
                this.ws = null;
                
                if (this.shouldReconnect) {
                    this.scheduleReconnect();
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.isConnecting = false;
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.isConnecting = false;
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.warn('Max reconnection attempts reached, stopping');
            return;
        }

        this.reconnectAttempts++;
        const delay = RECONNECT_DELAY_MS * Math.min(this.reconnectAttempts, 5);
        console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

        setTimeout(() => {
            if (this.shouldReconnect) {
                this.connect();
            }
        }, delay);
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            console.log('Received from backend:', message);

            switch (message.action) {
                case 'postMessage':
                    this.handlePostMessage(message);
                    break;
                case 'ping':
                    this.sendPong();
                    break;
                default:
                    console.log('Unknown action:', message.action);
            }
        } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
        }
    }

    async handlePostMessage(message) {
        const { message: text, platform } = message;
        
        if (!text) {
            console.error('No message text provided');
            this.sendError('No message text provided');
            return;
        }

        console.log(`Posting message to chat: "${text.substring(0, 50)}..."`);

        try {
            // Find a meeting tab
            const tabs = await chrome.tabs.query({});
            const meetingTab = tabs.find(tab => 
                tab.url && (
                    tab.url.includes('meet.google.com') ||
                    tab.url.includes('zoom.us') ||
                    tab.url.includes('teams.microsoft.com') ||
                    tab.url.includes('teams.live.com')
                )
            );

            if (!meetingTab) {
                console.error('No active meeting tab found');
                this.sendError('No active meeting tab found');
                return;
            }

            // Add to message queue
            await messageQueue.add(text, platform || this.detectPlatform(meetingTab.url), meetingTab.id);
            
            // Confirm message was queued
            this.send({
                action: 'message_sent',
                message_id: Date.now().toString(),
                success: true
            });
        } catch (error) {
            console.error('Failed to post message:', error);
            this.sendError(error.message);
        }
    }

    detectPlatform(url) {
        if (url.includes('meet.google.com')) return 'google-meet';
        if (url.includes('zoom.us')) return 'zoom';
        if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'microsoft-teams';
        return null;
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            console.warn('WebSocket not connected, cannot send:', data);
        }
    }

    sendPong() {
        this.send({ action: 'pong' });
    }

    sendError(error) {
        this.send({ action: 'error', error });
    }

    async sendStatus() {
        // Check for active meeting tabs
        const tabs = await chrome.tabs.query({});
        const meetingTab = tabs.find(tab => 
            tab.url && (
                tab.url.includes('meet.google.com') ||
                tab.url.includes('zoom.us') ||
                tab.url.includes('teams.microsoft.com') ||
                tab.url.includes('teams.live.com')
            )
        );

        this.send({
            action: 'status',
            platform: meetingTab ? this.detectPlatform(meetingTab.url) : null,
            meeting_active: !!meetingTab,
            queue_length: messageQueue.getStatus().queueLength
        });
    }

    disconnect() {
        this.shouldReconnect = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    getStatus() {
        return {
            connected: this.ws && this.ws.readyState === WebSocket.OPEN,
            connectionId: this.connectionId,
            reconnectAttempts: this.reconnectAttempts
        };
    }
}

// ============================================================================
// Message Queue (existing implementation)
// ============================================================================

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

// ============================================================================
// Initialize Instances
// ============================================================================

const messageQueue = new MessageQueue();
const wsManager = new WebSocketManager(BACKEND_WS_URL);

// ============================================================================
// Extension Lifecycle
// ============================================================================

// Extension installation handler
chrome.runtime.onInstalled.addListener((details) => {
    console.log('str8_2task extension installed:', details.reason);

    if (details.reason === 'install') {
        chrome.storage.local.set({
            installed: true,
            version: chrome.runtime.getManifest().version
        });
    }
    
    // Connect to backend WebSocket
    wsManager.connect();
});

// Service worker startup - connect to WebSocket
wsManager.connect();

// ============================================================================
// Message Handlers
// ============================================================================

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
        sendResponse({
            ...messageQueue.getStatus(),
            websocket: wsManager.getStatus()
        });
        return true;
    }
    
    if (request.action === 'getWebSocketStatus') {
        sendResponse(wsManager.getStatus());
        return true;
    }
    
    if (request.action === 'reconnectWebSocket') {
        wsManager.shouldReconnect = true;
        wsManager.reconnectAttempts = 0;
        wsManager.connect();
        sendResponse({ success: true });
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
        sendResponse({ 
            success: true, 
            message: 'Extension is active',
            websocket: wsManager.getStatus()
        });
        return true;
    }
});

// Extension icon click handler (optional)
chrome.action.onClicked.addListener((tab) => {
    // Could open popup or perform action
});

// Periodically send status updates to backend
setInterval(() => {
    if (wsManager.ws && wsManager.ws.readyState === WebSocket.OPEN) {
        wsManager.sendStatus();
    }
}, 30000); // Every 30 seconds

console.log('str8_2task background service worker initialized');
