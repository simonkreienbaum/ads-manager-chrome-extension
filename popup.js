import { log } from './logger.js';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// Add these helper functions after the imports
function showLoading(message = 'Loading...') {
  // Check verbose mode first
  chrome.storage.sync.get(['verboseMode'], function(items) {
    if (!items.verboseMode) {
      // Only show loading overlay if not in verbose mode
      const loadingDiv = document.createElement('div');
      loadingDiv.id = 'loadingSpinner';
      loadingDiv.innerHTML = `
        <div class="loading-overlay">
          <div class="spinner"></div>
          <div class="loading-message">${message}</div>
        </div>
      `;
      document.body.appendChild(loadingDiv);
    } else {
      // In verbose mode, ensure log is visible and scroll to it
      const logElement = document.getElementById('log');
      if (logElement) {
        logElement.style.display = 'block';
        logElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }
  });
}

function hideLoading() {
  const loadingDiv = document.getElementById('loadingSpinner');
  if (loadingDiv) {
    loadingDiv.remove();
  }
  // In verbose mode, scroll to the bottom of the log
  chrome.storage.sync.get(['verboseMode'], function(items) {
    if (items.verboseMode) {
      const logElement = document.getElementById('log');
      if (logElement) {
        logElement.scrollTop = logElement.scrollHeight;
      }
    }
  });
}

// Add this function near the top, after imports
function syncVerboseMode() {
  chrome.storage.sync.get(['verboseMode'], function(items) {
    const logElement = document.getElementById('log');
    const logLabel = document.getElementById('logLabel');
    if (logElement && logLabel) {
      logElement.style.display = items.verboseMode ? 'block' : 'none';
      logLabel.style.display = items.verboseMode ? 'block' : 'none';
    }
  });
}

async function tryConnectToContentScript(tab, retries = 0) {
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {action: "checkContentScriptReady"});
    if (response && response.ready) {
      return true;
    }
  } catch (error) {
    if (retries < MAX_RETRIES) {
      console.log(`Retry ${retries + 1} of ${MAX_RETRIES} to connect to content script...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return tryConnectToContentScript(tab, retries + 1);
    }
    throw new Error('Content script not available. Please refresh the page and try again.');
  }
  return false;
}

// Add these validation functions near the top
function validateAdIds(adIds) {
  const invalidIds = adIds.filter(id => !/^\d+$/.test(id));
  if (invalidIds.length > 0) {
    log(`Error: Invalid ad IDs found. Ad IDs must be numeric: ${invalidIds.join(', ')}`);
    return false;
  }
  return true;
}

function updateButtonStates() {
  const adIdsText = document.getElementById('adIds').value;
  const adIds = adIdsText.split('\n').filter(id => id.trim() !== '');
  const submitButton = document.getElementById('submitAdIds');
  const previewButton = document.getElementById('getAdPreviews');
  
  const hasValidIds = adIds.length > 0 && validateAdIds(adIds);
  
  submitButton.disabled = !hasValidIds;
  previewButton.disabled = !hasValidIds;
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded');
  
  syncVerboseMode();
  
  // Add input event listener for the textarea
  const adIdsTextarea = document.getElementById('adIds');
  adIdsTextarea.addEventListener('input', updateButtonStates);
  
  // Initial button state
  updateButtonStates();
  
  // Add storage change listener
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.verboseMode) {
      const logElement = document.getElementById('log');
      const logLabel = document.getElementById('logLabel');
      if (logElement && logLabel) {
        logElement.style.display = changes.verboseMode.newValue ? 'block' : 'none';
        logLabel.style.display = changes.verboseMode.newValue ? 'block' : 'none';
      }
    }
  });
  
  const parseAdIdsButton = document.getElementById('parseAdIds');
  if (parseAdIdsButton) {
    console.log('Parse Ad IDs button found');
    parseAdIdsButton.addEventListener('click', async () => {
      console.log('Parse Ad IDs button clicked');
      
      try {
        const tab = await getCurrentTab();
        
        // Check if we're on the correct page
        if (!tab.url.includes('facebook.com/adsmanager')) {
          throw new Error('Please navigate to Facebook Ads Manager first');
        }
        
        // Try to connect to content script with retries
        const isConnected = await tryConnectToContentScript(tab);
        if (!isConnected) {
          throw new Error('Could not connect to content script');
        }
        
        // Now proceed with parsing ad IDs
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({action: "parseAdIds"}, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ error: chrome.runtime.lastError.message });
            } else {
              resolve(response);
            }
          });
        });

        if (response.error) {
          throw new Error(response.error);
        } else if (response.adIds && response.adIds.length > 0) {
          document.getElementById('adIds').value = response.adIds.join('\n');
          log(`Successfully parsed ${response.adIds.length} ad IDs from URL`);
          updateButtonStates(); // Add this line to update button states after parsing
        } else {
          log('No ad IDs found. Please select some ads in the Ads Manager first.');
        }
      } catch (error) {
        log(`Error: ${error.message}`);
      }
    });
  } else {
    console.error('Parse Ad IDs button not found');
  }

  document.getElementById('submitAdIds').addEventListener('click', (event) => {
    const adIds = document.getElementById('adIds').value.split('\n').filter(id => id.trim() !== '');
    
    if (!validateAdIds(adIds)) {
      return; // Stop if validation fails
    }
    
    // Hide the previewTable and copyToClipboard button
    document.getElementById('previewTable').style.display = 'none';
    document.getElementById('copyToClipboard').style.display = 'none';
    document.getElementById('createGSheet').style.display = 'none';

    const confirmDialog = document.createElement('div');
    confirmDialog.innerHTML = `
      <div style="position: fixed; padding: 20px; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;">
        <div style="background: white; padding: 20px; border-radius: 5px; text-align: center;">
          <p>This will make changes to all of your selected ads and may reset the learning phase and social proof. Are you sure?</p>
          <button id="confirmYes" style="width: 60%;">Yes, apply changes</button>
          <button id="confirmNo" style="width: 60%; background: none; color: #423ebd; border: none; cursor: pointer;">No, go back</button>
        </div>
      </div>
    `;
    document.body.appendChild(confirmDialog);
    const tokenStatus = document.getElementById('tokenStatus');
    document.getElementById('confirmYes').addEventListener('click', () => {
      document.body.removeChild(confirmDialog);
      const submitButton = document.getElementById('submitAdIds');
      submitButton.disabled = true;
      const adIds = document.getElementById('adIds').value.split('\n').filter(id => id.trim() !== '');
      
      showLoading(`Updating creative settings... (0/${adIds.length})`);
      log(`Submitting ${adIds.length} ad IDs for processing`);
      
      chrome.runtime.sendMessage({ 
        action: 'turnOffAdvantageCreative', 
        adIds 
      }, (response) => {
        hideLoading();
        
        if (response.success) {
          const successCount = response.results.filter(r => r.success).length;
          const failureCount = response.results.length - successCount;
          log(`Processing complete. Successes: ${successCount}, Failures: ${failureCount}`);
          response.results.forEach(result => {
            if (!result.success) {
              log(`Error processing ad ${result.adId}: ${result.error}`);
            }
          });
          
          // Add refresh after successful completion
          log('Refreshing page to show updated creatives...');
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs[0]) {
              chrome.tabs.reload(tabs[0].id);
            }
          });
        } else {
          log(`Error: ${response.error}`);
        }
        submitButton.disabled = false;
      });
    });
    document.getElementById('confirmNo').addEventListener('click', () => {
      document.body.removeChild(confirmDialog);
    });
  });

  function parseAdIdsFromUrl(url) {
    const urlParams = new URLSearchParams(url.split('?')[1]);
    const selectedAdIds = urlParams.get('selected_ad_ids');
    return selectedAdIds ? selectedAdIds.split(',') : [];
  }

  // Add this function to update the log in the popup
  function updateLog(message) {
    const logElement = document.getElementById('log');
    if (logElement) {
      logElement.innerHTML += `${message}<br>`;
      logElement.scrollTop = logElement.scrollHeight;
    }
  }

  // Listen for log messages from the background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'log') {
      updateLog(request.message);
    } else if (request.action === 'updateProgress') {
      const loadingDiv = document.getElementById('loadingSpinner');
      if (loadingDiv) {
        const messageDiv = loadingDiv.querySelector('.loading-message');
        if (messageDiv) {
          messageDiv.textContent = `${request.message} (${request.current}/${request.total})`;
        }
      }
    }
  });

  function reloadCurrentTab() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0]) {
        chrome.tabs.reload(tabs[0].id);
      }
    });
  }

  // Modify the getAdPreviews click handler
  document.getElementById('getAdPreviews').addEventListener('click', (event) => {
    const adIds = document.getElementById('adIds').value.split('\n').filter(id => id.trim() !== '');
    
    if (!validateAdIds(adIds)) {
      return; // Stop if validation fails
    }
    
    const previewButton = event.target;
    previewButton.disabled = true;
    
    // Show loading spinner with initial count
    showLoading(`Fetching ad previews... (0/${adIds.length})`);
    log(`Fetching previews for ${adIds.length} ad IDs`);
    
    // Use the batch fetching method
    chrome.runtime.sendMessage({ 
      action: 'getAdPreviews', 
      adIds 
    }, (response) => {
      hideLoading();
      
      if (response.success) {
        // Make sure the table is visible
        const table = document.getElementById('previewTable');
        table.style.display = 'table';
        displayAdPreviews(response.results);
      } else {
        log(`Error: ${response.error}`);
      }
      previewButton.disabled = false;
    });
  });


  function displayAdPreviews(previews) {
    const table = document.getElementById('previewTable');
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';

    previews.forEach(preview => {
      if (preview && !preview.adId?.startsWith('__')) {  // Add null check
        const row = tbody.insertRow();
        row.insertCell(0).textContent = preview.id;
        row.insertCell(1).textContent = preview.name || 'N/A';
        const linkCell = row.insertCell(2);
        const link = document.createElement('a');
        link.href = preview.preview_shareable_link;
        link.textContent = preview.preview_shareable_link;
        link.target = '_blank';
        linkCell.appendChild(link);
        row.insertCell(3).textContent = preview.creative?.effective_object_story_id || 'N/A';
      }
    });

    // Ensure table is visible and update button visibility
    table.style.display = 'table';
    document.getElementById('copyToClipboard').style.display = 'inline-block';
    document.getElementById('createGSheet').style.display = 'inline-block';
  }

  document.getElementById('copyToClipboard').addEventListener('click', (event) => {
    const table = document.getElementById('previewTable');
    const range = document.createRange();
    range.selectNode(table);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.execCommand('copy');
    window.getSelection().removeAllRanges();
    log('Table copied to clipboard');
    
    const tooltip = document.createElement('div');
    tooltip.textContent = 'Copied to clipboard';
    tooltip.style.position = 'absolute';
    tooltip.style.backgroundColor = 'rgba(0,0,0,0.7)';
    tooltip.style.color = 'white';
    tooltip.style.padding = '5px';
    tooltip.style.borderRadius = '3px';
    tooltip.style.fontSize = '12px';
    tooltip.style.top = `${event.clientY + 10}px`;
    tooltip.style.left = `${event.clientX + 10}px`;
    document.body.appendChild(tooltip);
    
    setTimeout(() => {
      document.body.removeChild(tooltip);
      document.getElementById('copyToClipboard').style.display = 'none';
      document.getElementById('previewTable').style.display = 'none';
      document.getElementById('createGSheet').style.display = 'none';
      
    }, 1000);
  });

  document.getElementById('refreshPopup').addEventListener('click', () => {
    document.getElementById('adIds').value = '';
    document.getElementById('previewTable').style.display = 'none';
    document.getElementById('copyToClipboard').style.display = 'none';
    document.getElementById('createGSheet').style.display = 'none';
    document.getElementById('log').innerHTML = '';
    log('Popup refreshed');
    updateButtonStates(); // Add this line to update button states after refresh
  });
  
  document.getElementById('createGSheet').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://sheets.new' });
  });
});

// Add this helper function at the bottom of popup.js
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  return tab;
}
