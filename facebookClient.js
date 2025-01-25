import { log } from './logger.js';

class FacebookClient {
  constructor() {
    this.accessToken = null;
  }

  async getAccessToken() {
    if (this.accessToken) {
      return this.accessToken;
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['accessToken'], async (result) => {
        if (result.accessToken) {
          this.accessToken = result.accessToken;
          resolve(this.accessToken);
        } else {
          try {
            await this.fetchNewAccessToken();
            resolve(this.accessToken);
          } catch (error) {
            reject(error);
          }
        }
      });
    });
  }

  async fetchNewAccessToken() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0] && tabs[0].url.includes('facebook.com')) {
          chrome.tabs.sendMessage(tabs[0].id, {action: "getAccessToken"}, (response) => {
            if (response && response.token) {
              this.setAccessToken(response.token);
              resolve(this.accessToken);
            } else {
              reject(new Error('Failed to fetch access token'));
            }
          });
        } else {
          reject(new Error('Not on a Facebook page'));
        }
      });
    });
  }

  setAccessToken(token) {
    const previousToken = this.accessToken;
    this.accessToken = token;
    chrome.storage.local.set({accessToken: token}, () => {
      if (!previousToken) {
        log('Access token saved and set');
      }
    });
  }

  extractAccessToken(url) {
    const match = url.match(/access_token=([^&]+)/);
    return match ? match[1] : null;
  }

  async makeApiCall(endpoint, method = 'GET', data = null) {
    try {
      const token = await this.getAccessToken();
      const url = `https://graph.facebook.com/v20.0/${endpoint}`;
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      };

      if (data && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(data);
      }

      const response = await fetch(url, options);
      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(`API error: ${JSON.stringify(responseData.error)}`);
      }

      return responseData;
    } catch (error) {
      log('API call failed:', error);
      throw error;
    }
  }

  async fetchAdCreative(adId) {
    const creativeFields = 'platform_customizations,portrait_customizations,product_set_id,source_instagram_media_id,template_url_spec,template_url,adlabels,applink_treatment,category_media_source,creative_sourcing_spec,dynamic_ad_voice,destination_set_id,interactive_components_spec,account_id,object_story_spec,asset_feed_spec,degrees_of_freedom_spec,object_story_id,url_tags,authorization_category,contextual_multi_ads';
    const adFields = `id,account_id,creative{${creativeFields}}`;
    
    try {
      const data = await this.makeApiCall(`${adId}?fields=${adFields}`);
      log(`Successfully fetched ad ${adId}`);
      return data.creative;
    } catch (error) {
      log(`Error in fetchAdCreative for ad ${adId}:`, error.message);
      throw error;
    }
  }

  async createNewAdCreative(accountId, newCreative) {
    const data = await this.makeApiCall(`act_${accountId}/adcreatives`, 'POST', newCreative);
    log(`Successfully created new ad creative`);
    return data.id;
  }

  async updateAd(adId, newCreativeId) {
    try {
      const data = await this.makeApiCall(`${adId}`, 'POST', {
        creative: { creative_id: newCreativeId }
      });
      if (data.success) {
        log(`Successfully updated ad ${adId}`);
      } else {
        throw new Error(`Failed to update ad ${adId}: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      log(`Error updating ad ${adId}: ${error.message}`);
      throw error;
    }
  }

  async fetchAdPreview(adId) {
    const fields = 'id,name,preview_shareable_link';
    try {
      log(`Fetching preview for ad ${adId}`);
      const data = await this.makeApiCall(`${adId}?fields=${fields}`);
      log(`Successfully fetched preview for ad ${adId}`);
      return data;
    } catch (error) {
      log(`Error in fetchAdPreview for ad ${adId}:`, error.message);
      throw error;
    }
  }

  async batchFetchAdPreviews(adIds) {
    const chunkSize = 50;
    const allResults = [];

    for (let i = 0; i < adIds.length; i += chunkSize) {
      const chunk = adIds.slice(i, i + chunkSize);
      const fields = 'id,name,preview_shareable_link';
      const endpoint = `?ids=${chunk.join(',')}&fields=${fields}`;

      try {
        log(`Fetching previews for ads ${i + 1} to ${Math.min(i + chunkSize, adIds.length)}`);
        const data = await this.makeApiCall(endpoint);
        
        // Convert object response to array and filter out fields starting with '__'
        const resultsArray = Object.entries(data).map(([id, adData]) => {
          const filteredAdData = Object.fromEntries(
            Object.entries(adData).filter(([key]) => !key.startsWith('__'))
          );
          return {
            adId: id,
            ...filteredAdData
          };
        });

        allResults.push(...resultsArray);
        log(`Successfully fetched previews for ${resultsArray.length} ads`);
      } catch (error) {
        log(`Error in batchFetchAdPreviews for chunk starting at ${i}:`, error.message);
        // Continue with the next chunk instead of throwing
      }
    }

    return allResults;
  }
}

export const facebookClient = new FacebookClient();
