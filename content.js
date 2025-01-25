let verboseMode = false;
let initializationRetries = 0;
const MAX_INIT_RETRIES = 3;

// Add this function to sync verbose mode
function syncVerboseMode() {
  chrome.storage.sync.get(['verboseMode'], function(items) {
    verboseMode = items.verboseMode || false;
    console.log('Verbose mode synced:', verboseMode);
  });
}

// Add storage change listener
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.verboseMode) {
    verboseMode = changes.verboseMode.newValue;
    console.log('Verbose mode updated:', verboseMode);
  }
});

function initializeContentScript() {
  chrome.runtime.sendMessage({ action: 'contentScriptReady' }, (response) => {
    if (chrome.runtime.lastError) {
      console.log('Failed to initialize content script:', chrome.runtime.lastError);
      if (initializationRetries < MAX_INIT_RETRIES) {
        initializationRetries++;
        setTimeout(initializeContentScript, 1000);
      }
    } else {
      console.log('Content script initialized successfully');
    }
  });
}

// Call initialization
initializeContentScript();

function log(message) {
  if (verboseMode) {
    chrome.runtime.sendMessage({ action: 'log', message });
  }
}

function extractAccessToken(url) {
  const match = url.match(/access_token=([^&]+)/);
  return match ? match[1] : null;
}

// Listen for XHR requests
let originalXHROpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function() {
  this.addEventListener('load', function() {
    if (this.responseURL.includes('adsmanager-graph.facebook.com') && this.responseURL.includes('access_token=')) {
      const accessToken = extractAccessToken(this.responseURL);
      if (accessToken) {
        chrome.runtime.sendMessage({ action: 'setAccessToken', token: accessToken });
      }
    }
  });
  originalXHROpen.apply(this, arguments);
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request.action);
  
  try {
    if (request.action === 'checkContentScriptReady') {
      console.log('Responding to ready check');
      sendResponse({ ready: true });
      return true;
    }
    
    if (request.action === 'parseAdIds') {
      log('Parsing ad IDs from URL');
      const url = window.location.href;
      log(`Current URL: ${url}`);
      const adIds = parseAdIdsFromUrl(url);
      sendResponse({adIds: adIds});
      return true;  // Keep the message channel open
    }
    
    if (request.action === 'accessTokenFetched') {
      updateTokenUI(request.token);
      sendResponse({ success: true });
      return true;
    } 
    
    if (request.action === 'log') {
      log(request.message);
      sendResponse({ success: true });
      return true;
    }
    
    // Default response for unknown actions
    sendResponse({ error: 'Unknown action' });
    return true;
  } catch (error) {
    console.error('Error in content script message handler:', error);
    sendResponse({ error: error.message });
    return true;
  }
});

function parseAdIdsFromUrl(url) {
  try {
    const urlParams = new URLSearchParams(url.split('?')[1]);
    const selectedAdIds = urlParams.get('selected_ad_ids');
    if (!selectedAdIds) {
      log('No selected_ad_ids found in URL');
      return [];
    }
    const adIds = selectedAdIds.split(',').filter(id => id.trim() !== '');
    log(`Found ${adIds.length} ad IDs in URL`);
    return adIds;
  } catch (error) {
    log(`Error parsing ad IDs from URL: ${error.message}`);
    return [];
  }
}