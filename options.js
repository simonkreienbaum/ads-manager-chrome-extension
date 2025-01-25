function saveOptions() {
    const verboseMode = document.getElementById('verboseMode').checked;
    chrome.storage.sync.set({ verboseMode: verboseMode }, function() {
      const status = document.getElementById('status');
      status.textContent = 'Options saved.';
      setTimeout(function() {
        status.textContent = '';
      }, 750);
    });
  }
  
  function restoreOptions() {
    chrome.storage.sync.get(['verboseMode'], function(items) {
      document.getElementById('verboseMode').checked = items.verboseMode || false;
    });
  }
  
  document.addEventListener('DOMContentLoaded', restoreOptions);
  document.getElementById('verboseMode').addEventListener('change', saveOptions);