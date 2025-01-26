import { turnOffAdvantageCreative, getAdPreviews } from './facebookApi.js';
import { facebookClient } from './facebookClient.js';
import { setVerboseMode, log } from './logger.js';

// Add these at the top of the file
const CONTENT_SCRIPT_RETRY_DELAY = 1000; // 1 second
const MAX_CONTENT_SCRIPT_RETRIES = 3;

// Sync verbose mode on startup
chrome.storage.sync.get(['verboseMode'], function(items) {
  setVerboseMode(items.verboseMode || false);
});

// Add storage change listener
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.verboseMode) {
    setVerboseMode(changes.verboseMode.newValue);
  }
});

async function tryConnectToTab(tabId, retries = 0) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "checkContentScriptReady" });
    //log(`Content script ready in tab ${tabId}`);
    return true;
  } catch (error) {
    if (retries < MAX_CONTENT_SCRIPT_RETRIES) {
      log(`Retrying content script connection for tab ${tabId} (${retries + 1}/${MAX_CONTENT_SCRIPT_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, CONTENT_SCRIPT_RETRY_DELAY));
      return tryConnectToTab(tabId, retries + 1);
    }
    log(`Failed to connect to content script in tab ${tabId} after ${MAX_CONTENT_SCRIPT_RETRIES} retries`);
    return false;
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.url.includes('adsmanager-graph.facebook.com') || details.url.includes('graph.facebook.com')) {
      const accessToken = facebookClient.extractAccessToken(details.url);
      if (accessToken) {
        //log(`New access token detected: ${accessToken.substring(0, 10)}...`);
        facebookClient.setAccessToken(accessToken);
      }
    }
  },
  { urls: ["https://*.facebook.com/*", "https://graph.facebook.com/*"] },
  ["requestBody"]
);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'log') {
    console.log(request.message);
  } else if (request.action === 'toggleVerboseMode') {
    chrome.storage.sync.set({ verboseMode: request.enabled }, function() {
      setVerboseMode(request.enabled);
      log(`Verbose mode ${request.enabled ? 'enabled' : 'disabled'}`);
    });
  } else if (request.action === 'turnOffAdvantageCreative') {
    turnOffAdvantageCreative(request.adIds, (current, total) => {
      // Progress callback
      chrome.runtime.sendMessage({ 
        action: 'updateProgress',
        message: 'Updating creative settings...',
        current,
        total
      });
    })
    .then((results) => {
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;
      log(`Advantage+ Creative processing complete. Successes: ${successCount}, Failures: ${failureCount}`);
      sendResponse({ success: true, results });
    })
    .catch((error) => {
      log(`Error turning off Advantage+ Creative: ${error.message}`);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (request.action === 'getAdPreviews') {
    getAdPreviews(request.adIds, (current, total) => {
      // Progress callback
      chrome.runtime.sendMessage({ 
        action: 'updateProgress',
        message: 'Fetching ad previews...',
        current,
        total
      });
    })
    .then((results) => {
      log(`Ad preview fetching complete. Fetched ${results.length} previews.`);
      sendResponse({ success: true, results });
    })
    .catch((error) => {
      log(`Error getting ad previews: ${error.message}`);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (request.action === 'parseAdIds') {
    // Wrap everything in a try-catch to ensure we always send a response
    try {
      chrome.tabs.query({active: true, currentWindow: true}, async function(tabs) {
        if (!tabs[0]) {
          sendResponse({error: "No active tab found"});
          return;
        }

        try {
          // First verify the content script is ready
          const isConnected = await tryConnectToTab(tabs[0].id);
          if (!isConnected) {
            sendResponse({error: "Content script not ready. Please refresh the page."});
            return;
          }

          // Now try to parse the ad IDs
          chrome.tabs.sendMessage(tabs[0].id, {action: "parseAdIds"}, function(response) {
            if (chrome.runtime.lastError) {
              sendResponse({error: chrome.runtime.lastError.message});
            } else {
              sendResponse(response || {error: "No response from content script"});
            }
          });
        } catch (error) {
          sendResponse({error: error.message});
        }
      });
    } catch (error) {
      sendResponse({error: "Unexpected error: " + error.message});
    }
    return true;  // Keep the message channel open
  } else if (request.action === 'contentScriptReady') {
    log('Content script initialized');
    // Send acknowledgment back to content script
    sendResponse({ received: true });
  }
  return true;  // Keep the message channel open for async responses
});

// Add listener for tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('facebook.com/adsmanager')) {
    log(`Tab ${tabId} loaded completely, waiting for content script...`);
    // Add a small delay before first attempt
    await new Promise(resolve => setTimeout(resolve, 500));
    await tryConnectToTab(tabId);
  }
});