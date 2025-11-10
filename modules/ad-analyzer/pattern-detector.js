const logger = require('../logger');

class PatternDetector {
  constructor(networkConfig = {}) {
    this.networkConfig = networkConfig;
    this.patterns = this.buildPatterns();
  }

  buildPatterns() {
    return {
      ssps: [
        { name: 'Prebid', patterns: ['prebid', 'pbjs'] },
        { name: 'Google Ad Manager', patterns: ['googlesyndication', 'doubleclick', 'pagead2.googlesyndication', 'tpc.googlesyndication'] },
        { name: 'AppNexus (Xandr)', patterns: ['appnexus', 'adnxs.com', 'ib.adnxs.com'] },
        { name: 'OpenX', patterns: ['openx.com', 'openxe.com', 'ox-d.com'] },
        { name: 'Criteo', patterns: ['criteo.com', 'static.criteo.net'] },
        { name: 'Rubicon Project', patterns: ['rubiconproject.com', 'rubiconproject.net'] },
        { name: 'Pubmatic', patterns: ['pubmatic.com', 'ads.pubmatic.com'] },
        { name: 'Index Exchange', patterns: ['indexww.com', 'casalemedia.com'] },
        { name: 'Conversant', patterns: ['conversant.com', 'conversantmedia.com'] },
        { name: 'Districtm', patterns: ['districtm.io'] },
        { name: 'Magnite', patterns: ['magnite.com', 'rubiconproject.com'] },
      ],
      dsps: [
        { name: 'Google DV360', patterns: ['doubleclickbygoogle', 'doubleclick.net'] },
        { name: 'Amazon DSP', patterns: ['amazon-adsystem', 'assoc-amazon'] },
        { name: 'Programmatic Media', patterns: ['liveramp.com', 'evidon'] },
        { name: 'The Trade Desk', patterns: ['tradedesk.com'] },
        { name: 'MediaBuy', patterns: ['pixel.mathtag.com', 'mathtag.com'] },
      ],
      suspicious: [
        { name: 'Affiliate Networks', patterns: ['impact-affiliate', 'awin.com', 'commission-junction', 'cj.com'] },
        { name: 'Tracking Pixels', patterns: ['pixel.', 'track.', 'beacon.', 'log/', 'analytics/pixel'] },
        { name: 'Content Injection', patterns: ['/ads/native', 'content-recommendation', 'widget.', 'outbrain', 'taboola'] },
      ],
    };
  }

  matchNetworkPattern(url, networkType) {
    if (!url) return null;
    const urlLower = url.toLowerCase();

    const networks = this.patterns[networkType] || [];
    for (const network of networks) {
      for (const pattern of network.patterns) {
        if (urlLower.includes(pattern.toLowerCase())) {
          return {
            network: network.name,
            type: networkType,
            matchedPattern: pattern,
          };
        }
      }
    }
    return null;
  }

  analyzeNetworkRequests(networkRequests) {
    if (!Array.isArray(networkRequests)) {
      return { detectedNetworks: [], suspiciousPatterns: [] };
    }

    const detectedNetworks = new Map();
    const suspiciousPatterns = [];

    for (const request of networkRequests) {
      if (!request.url) continue;

      const sspMatch = this.matchNetworkPattern(request.url, 'ssps');
      if (sspMatch) {
        const key = sspMatch.network;
        if (!detectedNetworks.has(key)) {
          detectedNetworks.set(key, { count: 0, type: 'SSP', urls: [] });
        }
        const entry = detectedNetworks.get(key);
        entry.count += 1;
        entry.urls.push(request.url);
      }

      const dspMatch = this.matchNetworkPattern(request.url, 'dsps');
      if (dspMatch) {
        const key = dspMatch.network;
        if (!detectedNetworks.has(key)) {
          detectedNetworks.set(key, { count: 0, type: 'DSP', urls: [] });
        }
        const entry = detectedNetworks.get(key);
        entry.count += 1;
        entry.urls.push(request.url);
      }

      const suspMatch = this.matchNetworkPattern(request.url, 'suspicious');
      if (suspMatch) {
        suspiciousPatterns.push({
          network: suspMatch.network,
          url: request.url,
          matchedPattern: suspMatch.matchedPattern,
        });
      }
    }

    return {
      detectedNetworks: Array.from(detectedNetworks.entries()).map(([name, data]) => ({
        network: name,
        ...data,
      })),
      suspiciousPatterns,
      networkDiversity: detectedNetworks.size,
    };
  }

  identifyMFAIndicators(networkData, adElements) {
    const indicators = {
      highNetworkDiversity: false,
      unexpectedNetworks: false,
      pixelChains: false,
      affiliateTraffic: false,
      riskScore: 0,
    };

    if (networkData.networkDiversity > 8) {
      indicators.highNetworkDiversity = true;
      indicators.riskScore += 0.15;
    }

    const affiliatePatterns = networkData.suspiciousPatterns.filter(p =>
      p.network.includes('Affiliate') || p.network.includes('Tracking')
    );

    if (affiliatePatterns.length > 0) {
      indicators.affiliateTraffic = true;
      indicators.riskScore += 0.2;
    }

    const pixelURLs = networkData.suspiciousPatterns.filter(p =>
      p.url.match(/pixel|beacon|track/i)
    );

    if (pixelURLs.length > 5) {
      indicators.pixelChains = true;
      indicators.riskScore += 0.15;
    }

    return indicators;
  }

  detectAnomalies(detectedNetworks) {
    const anomalies = [];

    if (detectedNetworks.length > 15) {
      anomalies.push({
        severity: 'high',
        message: 'Excessive network diversity detected - unusually high number of ad networks',
        count: detectedNetworks.length,
      });
    }

    const highFrequencyNetworks = detectedNetworks.filter(n => n.count > 50);
    if (highFrequencyNetworks.length > 0) {
      anomalies.push({
        severity: 'medium',
        message: `High-frequency network calls detected: ${highFrequencyNetworks.map(n => n.network).join(', ')}`,
        networks: highFrequencyNetworks,
      });
    }

    return anomalies;
  }

  generateReport(crawlData) {
    try {
      const networkRequests = crawlData.har?.log?.entries?.map(e => ({
        url: e.request.url,
        method: e.request.method,
        statusCode: e.response?.status,
      })) || [];

      const networkAnalysis = this.analyzeNetworkRequests(networkRequests);
      const mfaIndicators = this.identifyMFAIndicators(networkAnalysis, crawlData.adElements);
      const anomalies = this.detectAnomalies(networkAnalysis.detectedNetworks);

      return {
        timestamp: new Date().toISOString(),
        networkAnalysis,
        mfaIndicators,
        anomalies,
        summary: {
          totalNetworks: networkAnalysis.detectedNetworks.length,
          suspiciousPatterns: networkAnalysis.suspiciousPatterns.length,
          totalRequests: networkRequests.length,
          mfaRiskScore: mfaIndicators.riskScore,
        },
      };
    } catch (error) {
      logger.error('Error generating pattern detector report', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = PatternDetector;
