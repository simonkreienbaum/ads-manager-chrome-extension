let verboseMode = true;

export function log(message) {
  if (verboseMode) {
    console.log(message);
    chrome.runtime.sendMessage({ action: 'log', message });
  }
}

export function setVerboseMode(enabled) {
  verboseMode = enabled;
}

export function getVerboseMode() {
  return verboseMode;
}