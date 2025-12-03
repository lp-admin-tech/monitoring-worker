const logger = require('../logger');

// Known ad network domains for classification
const AD_NETWORK_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'googletag', 'gpt.js', 'adnxs.com', 'pubmatic.com', 'rubiconproject.com',
  'openx.net', 'criteo.com', 'criteo.net', 'amazon-adsystem.com',
  'adsafeprotected.com', 'moatads.com', 'iasds01.com', 'ias-ad.com',
  'taboola.com', 'outbrain.com', 'mgid.com', 'revcontent.com',
  'teads.tv', 'sharethrough.com', 'triplelift.com', 'indexexchange.com',
  'prebid', 'bidswitch.com', 'casalemedia.com', 'contextweb.com',
  'smartadserver.com', 'adform.net', 'yieldmo.com', '33across.com',
  'sovrn.com', 'lijit.com', 'gumgum.com', 'stickyads.tv'
];

class HARRecorder {
  constructor() {
    this.entries = [];
    this.startTime = Date.now();
    this.adRequests = [];
    this.bidRequests = [];
  }

  classifyRequest(url) {
    const urlLower = url.toLowerCase();
    
    // Check if it's an ad-related request
    const isAdRequest = AD_NETWORK_DOMAINS.some(domain => urlLower.includes(domain));
    
    // Check for bid request patterns
    const isBidRequest = /\/bid|\/auction|\/hb|prebid|\/rtb/i.test(urlLower);
    
    // Check for impression/tracking pixels
    const isTrackingPixel = /\/pixel|\/track|\/imp|\/beacon|1x1|\.gif\?/i.test(urlLower);
    
    return {
      isAdRequest,
      isBidRequest,
      isTrackingPixel,
      adNetwork: isAdRequest ? this.identifyAdNetwork(urlLower) : null
    };
  }

  identifyAdNetwork(url) {
    if (url.includes('doubleclick') || url.includes('googlesyndication') || url.includes('googletag')) return 'google';
    if (url.includes('adnxs')) return 'appnexus';
    if (url.includes('pubmatic')) return 'pubmatic';
    if (url.includes('rubiconproject')) return 'rubicon';
    if (url.includes('openx')) return 'openx';
    if (url.includes('criteo')) return 'criteo';
    if (url.includes('amazon-adsystem')) return 'amazon';
    if (url.includes('taboola')) return 'taboola';
    if (url.includes('outbrain')) return 'outbrain';
    if (url.includes('indexexchange')) return 'indexexchange';
    if (url.includes('prebid')) return 'prebid';
    return 'unknown';
  }

  addRequest(request) {
    try {
      const url = request.url();
      const classification = this.classifyRequest(url);
      
      // Safely get post data - postDataJSON() throws for non-JSON payloads
      let postData = null;
      try {
        const rawPostData = request.postData();
        if (rawPostData) {
          try {
            postData = JSON.parse(rawPostData);
          } catch {
            postData = rawPostData; // Keep as string if not valid JSON
          }
        }
      } catch {
        // Ignore post data extraction errors
      }
      
      const entry = {
        type: 'request',
        timestamp: Date.now(),
        method: request.method(),
        url: url,
        resourceType: request.resourceType(),
        postData: postData,
        ...classification
      };
      
      this.entries.push(entry);
      
      if (classification.isAdRequest) {
        this.adRequests.push(entry);
      }
      if (classification.isBidRequest) {
        this.bidRequests.push(entry);
      }
    } catch (error) {
      // Log but don't fail on individual request errors
      logger.debug('Failed to record request', { error: error.message });
    }
  }

  addResponse(response, request) {
    try {
      const url = response.url();
      const classification = this.classifyRequest(url);
      
      this.entries.push({
        type: 'response',
        timestamp: Date.now(),
        url: url,
        status: response.status(),
        statusText: response.statusText(),
        fromCache: response.fromCache(),
        fromServiceWorker: response.fromServiceWorker(),
        ...classification
      });
    } catch (error) {
      // Log but don't fail on individual response errors
      logger.debug('Failed to record response', { error: error.message });
    }
  }

  getHAR() {
    // Calculate ad network statistics
    const adNetworkCounts = {};
    this.adRequests.forEach(req => {
      const network = req.adNetwork || 'unknown';
      adNetworkCounts[network] = (adNetworkCounts[network] || 0) + 1;
    });

    return {
      log: {
        version: '1.2.0',
        creator: {
          name: 'site-monitoring-crawler',
          version: '2.0.0',
        },
        entries: this.entries,
        totalTime: Date.now() - this.startTime,
        // Enhanced ad analysis data
        adAnalysis: {
          totalRequests: this.entries.length,
          adRequestCount: this.adRequests.length,
          bidRequestCount: this.bidRequests.length,
          adNetworkCounts: adNetworkCounts,
          detectedNetworks: Object.keys(adNetworkCounts)
        }
      },
    };
  }
}

function setupNetworkLogging(page) {
  const harRecorder = new HARRecorder();

  page.on('request', (request) => {
    try {
      harRecorder.addRequest(request);
    } catch (error) {
      logger.debug('Failed to record request', { error });
    }
  });

  page.on('response', (response) => {
    try {
      const request = response.request();
      harRecorder.addResponse(response, request);
    } catch (error) {
      logger.debug('Failed to record response', { error });
    }
  });

  return harRecorder;
}

module.exports = {
  setupNetworkLogging,
  HARRecorder,
};
