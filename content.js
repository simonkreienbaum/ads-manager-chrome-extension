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

function createPreviewTable(previews) {
  const table = document.createElement('table');
  table.className = 'preview-table';

  // Create header row
  const headerRow = document.createElement('tr');
  ['Ad ID', 'Post ID', 'Preview Link'].forEach(headerText => {
    const th = document.createElement('th');
    th.textContent = headerText;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  // Create data rows
  previews.forEach(preview => {
    if (!preview) return; // Skip null previews

    const row = document.createElement('tr');
    
    // Ad ID cell
    const adIdCell = document.createElement('td');
    adIdCell.textContent = preview.adId || 'N/A';
    row.appendChild(adIdCell);

    // Post ID cell
    const postIdCell = document.createElement('td');
    postIdCell.textContent = preview.effective_object_story_id || 'N/A';
    row.appendChild(postIdCell);

    // Preview Link cell
    const previewCell = document.createElement('td');
    const previewLink = document.createElement('a');
    previewLink.href = preview.previewUrl;
    previewLink.textContent = 'View Preview';
    previewLink.target = '_blank';
    previewCell.appendChild(previewLink);
    row.appendChild(previewCell);

    table.appendChild(row);
  });

  return table;
}

// Add styles for the preview table
const styles = `
  .preview-table {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
  }

  .preview-table th,
  .preview-table td {
    border: 1px solid #ddd;
    padding: 8px;
    text-align: left;
  }

  .preview-table th {
    background-color: #f4f4f4;
  }

  .preview-table a {
    color: #1877f2;
    text-decoration: none;
  }

  .preview-table a:hover {
    text-decoration: underline;
  }
`;

// Add the styles to the page
const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);
