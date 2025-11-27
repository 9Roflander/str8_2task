import * as GoogleMeet from './platforms/google-meet.js';
import * as Zoom from './platforms/zoom.js';
import * as Teams from './platforms/teams.js';

function detectPlatform() {
    const url = window.location.href;

    if (url.includes('meet.google.com')) {
        return 'google-meet';
    } else if (url.includes('zoom.us') || url.includes('.zoom.us')) {
        return 'zoom';
    } else if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) {
        return 'microsoft-teams';
    }

    return null;
}

const platforms = {
    'google-meet': GoogleMeet,
    'zoom': Zoom,
    'microsoft-teams': Teams
};

async function postMessage(message, platform = null) {
    if (!message || message.trim() === '') {
        throw new Error('Message cannot be empty');
    }

    if (!platform) {
        platform = detectPlatform();
        if (!platform) {
            throw new Error('Not on a supported meeting platform');
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

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'postMessage') {
        postMessage(request.message, request.platform)
            .then((success) => {
                sendResponse({ success: true });
            })
            .catch((error) => {
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep the message channel open for async response
    }

    if (request.action === 'detectPlatform') {
        const platform = detectPlatform();
        sendResponse({ platform });
        return true;
    }
});

console.log('Meetily extension content script loaded');

const currentPlatform = detectPlatform();
if (currentPlatform) {
    console.log(`Detected platform: ${currentPlatform}`);
}

// Debug helper
window.meetilyDebug = {
    detectPlatform,
    postMessage
};

// Mark that extension is installed
document.body.setAttribute('data-meetily-installed', 'true');
