import { facebookClient } from './facebookClient.js';
import { log } from './logger.js';

async function ensureAccessToken() {
  let accessToken = await facebookClient.getAccessToken();
  if (!accessToken) {
    log('No access token found. Attempting to refresh the page and get a new token.');
    await refreshPageAndGetToken();
    accessToken = await facebookClient.getAccessToken();
    if (!accessToken) {
      throw new Error('Failed to obtain access token after refresh');
    }
  }
  log('Access token available.');
  return accessToken;
}

async function turnOffAdvantageCreative(adIds, onProgress) {
  log('Starting turnOffAdvantageCreative process');
  
  await ensureAccessToken();
  
  try {
    const results = [];
    for (let i = 0; i < adIds.length; i++) {
      if (onProgress) {
        onProgress(i + 1, adIds.length);
      }
      log(`Processing ad ${adIds[i]}`);
      try {
        const adCreative = await facebookClient.fetchAdCreative(adIds[i]);
        const newCreativeId = await createAdCreativeWithoutAdvantage(adCreative);
        await facebookClient.updateAd(adIds[i], newCreativeId);
        results.push({ adId: adIds[i], success: true });
      } catch (error) {
        log(`Error processing ad ${adIds[i]}: ${error.message}`);
        results.push({ adId: adIds[i], success: false, error: error.message });
      }
    }
    log('Finished processing all ads');
    return results;
  } catch (error) {
    log(`Error turning off Advantage+ Creative: ${error.message}`);
    throw error;
  }
}

async function refreshPageAndGetToken() {
  return new Promise((resolve) => {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0]) {
        chrome.tabs.reload(tabs[0].id, {}, () => {
          log('Page reloaded. Waiting for new access token...');
          setTimeout(resolve, 5000); // Wait 5 seconds for the page to reload and token to be captured
        });
      } else {
        log('No active tab found to refresh');
        resolve();
      }
    });
  });
}

async function createAdCreativeWithoutAdvantage(adCreative) {
  const { id, account_id, ...newCreative } = {
    ...adCreative,
    degrees_of_freedom_spec: {
      creative_features_spec: {
        standard_enhancements: { enroll_status: "OPT_OUT" },
        inline_comment: { enroll_status: "OPT_OUT" },
        image_brightness_and_contrast: { enroll_status: "OPT_OUT" },
        description_automation: { enroll_status: "OPT_OUT" },
        text_optimizations: { enroll_status: "OPT_OUT" }
      }
    },
    contextual_multi_ads: { enroll_status: "OPT_OUT" }
  };

  // Remove fields starting with "__"
  Object.keys(newCreative).forEach(key => {
    if (key.startsWith('__')) {
      delete newCreative[key];
    }
  });

  // Handle asset_feed_spec
  if (newCreative.asset_feed_spec && newCreative.asset_feed_spec.audios) {
    newCreative.asset_feed_spec.audios = [{"type":"opted_out"}];
  }

  if (newCreative.degrees_of_freedom_spec && newCreative.degrees_of_freedom_spec.creative_features_spec) {
    for (const [key, value] of Object.entries(newCreative.degrees_of_freedom_spec.creative_features_spec)) {
      if (value && value.enroll_status === "OPT_IN") {
        newCreative.degrees_of_freedom_spec.creative_features_spec[key].enroll_status = "OPT_OUT";
      }
    }
  }

  return await facebookClient.createNewAdCreative(account_id, newCreative);
}

async function getAdPreviews(adIds, onProgress) {
  log('Starting getAdPreviews process');
  
  await ensureAccessToken();
  
  try {
    const results = [];
    for (let i = 0; i < adIds.length; i++) {
      if (onProgress) {
        onProgress(i + 1, adIds.length);
      }
      log(`Fetching preview for ad ${adIds[i]}`);
      try {
        const preview = await facebookClient.fetchAdPreview(adIds[i]);
        results.push(preview);
      } catch (error) {
        log(`Error fetching preview for ad ${adIds[i]}: ${error.message}`);
        results.push(null);
      }
    }
    log(`Successfully fetched previews for ${results.length} ads`);
    return results;
  } catch (error) {
    log(`Error fetching ad previews: ${error.message}`);
    throw error;
  }
}

export { turnOffAdvantageCreative, getAdPreviews };
