const logger = require('../logger');
const PatternDetector = require('./pattern-detector');
const AutoRefreshDetector = require('./auto-refresh');
const VisibilityChecker = require('./visibility');
const AdDensityCalculator = require('./ad-density');

class AdBehaviorAggregator {
  constructor(config = {}) {
    this.patternDetector = new PatternDetector(config.networks);
    this.autoRefreshDetector = new AutoRefreshDetector(config.refresh);
    this.visibilityChecker = new VisibilityChecker(config.visibility);
    this.adDensityCalculator = new AdDensityCalculator(config.density);
    this.config = config;
  }

  mergeNetworkWithAdElements(crawlData) {
    const networkRequests = (crawlData.har?.log?.entries || []).map(e => ({
      url: e.request.url,
      method: e.request.method,
      statusCode: e.response?.status,
      timestamp: new Date(e.startedDateTime).getTime(),
      size: e.response?.bodySize || 0,
    }));

    const adElements = crawlData.adElements || [];
    const merged = {
      networkRequests,
      adElements,
      totalNetworkRequests: networkRequests.length,
      totalAdElements: adElements.length,
      correlations: this.correlateNetworkWithAds(networkRequests, adElements),
    };

    return merged;
  }

  correlateNetworkWithAds(networkRequests, adElements) {
    const correlations = [];

    for (const ad of adElements) {
      const relatedRequests = networkRequests.filter(req => {
        return this.isRequestRelatedToAd(req, ad);
      });

      if (relatedRequests.length > 0) {
        correlations.push({
          adId: ad.id,
          relatedRequestCount: relatedRequests.length,
          requestURLs: relatedRequests.map(r => r.url),
          totalDataSize: relatedRequests.reduce((sum, r) => sum + r.size, 0),
        });
      }
    }

    return correlations;
  }

  isRequestRelatedToAd(request, adElement) {
    const urlLower = request.url.toLowerCase();
    const adIdStr = adElement.id ? adElement.id.toLowerCase() : '';
    const adClassStr = adElement.className ? adElement.className.toLowerCase() : '';

    if (adIdStr && urlLower.includes(adIdStr)) return true;
    if (adClassStr && urlLower.includes(adClassStr.replace(/\s+/g, ''))) return true;

    if (urlLower.includes('ad') || urlLower.includes('slot')) {
      return true;
    }

    return false;
  }

  aggregateAnalysis(crawlData, viewport) {
    const timestamp = new Date().toISOString();

    logger.info('Starting ad behavior aggregation', {
      publisherId: crawlData.publisherId,
      timestamp,
    });

    const merged = this.mergeNetworkWithAdElements(crawlData);

    const patternReport = this.patternDetector.generateReport(crawlData);
    const refreshReport = this.autoRefreshDetector.generateReport(crawlData);
    const visibilityReport = this.visibilityChecker.generateReport(crawlData, viewport);
    const densityReport = this.adDensityCalculator.generateReport(crawlData, viewport);

    const aggregated = {
      timestamp,
      publisherId: crawlData.publisherId,
      metadata: {
        totalNetworkRequests: merged.totalNetworkRequests,
        totalAdElements: merged.totalAdElements,
        viewport: viewport || { width: 1920, height: 1080 },
      },
      analysis: {
        patterns: patternReport,
        autoRefresh: refreshReport,
        visibility: visibilityReport,
        density: densityReport,
      },
      correlations: merged.correlations,
      riskAssessment: this.calculateRiskScore(
        patternReport,
        refreshReport,
        visibilityReport,
        densityReport
      ),
    };

    logger.info('Ad behavior aggregation completed', {
      publisherId: crawlData.publisherId,
      riskScore: aggregated.riskAssessment.overallRiskScore,
    });

    return aggregated;
  }

  calculateRiskScore(patternReport, refreshReport, visibilityReport, densityReport) {
    let totalRisk = 0;
    const factors = {};

    if (patternReport.summary) {
      const patternRisk = Math.min(
        patternReport.summary.mfaRiskScore || 0,
        1
      );
      factors.patternRisk = patternRisk;
      totalRisk += patternRisk * 0.25;
    }

    if (refreshReport.summary) {
      const refreshRisk = refreshReport.summary.autoRefreshDetected ? 0.3 : 0;
      factors.refreshRisk = refreshRisk;
      totalRisk += refreshRisk * 0.25;
    }

    if (visibilityReport.summary) {
      const visibilityRisk =
        visibilityReport.summary.complianceStatus === 'non_compliant' ? 0.4 : 0.1;
      factors.visibilityRisk = visibilityRisk;
      totalRisk += visibilityRisk * 0.25;
    }

    if (densityReport.summary) {
      const densityRisk =
        densityReport.summary.complianceStatus === 'non_compliant'
          ? densityReport.metrics.adDensity
          : 0;
      factors.densityRisk = densityRisk;
      totalRisk += densityRisk * 0.25;
    }

    return {
      overallRiskScore: parseFloat(totalRisk.toFixed(3)),
      factors,
      riskLevel: this.getRiskLevel(totalRisk),
      recommendations: this.getRecommendations(
        patternReport,
        refreshReport,
        visibilityReport,
        densityReport
      ),
    };
  }

  getRiskLevel(score) {
    if (score >= 0.7) return 'critical';
    if (score >= 0.5) return 'high';
    if (score >= 0.3) return 'medium';
    if (score >= 0.1) return 'low';
    return 'minimal';
  }

  getRecommendations(patternReport, refreshReport, visibilityReport, densityReport) {
    const recommendations = [];

    if (
      patternReport.summary &&
      patternReport.summary.mfaRiskScore > 0.3
    ) {
      recommendations.push(
        'Review ad network diversity and investigate suspicious patterns'
      );
    }

    if (refreshReport.summary?.autoRefreshDetected) {
      recommendations.push(
        'Investigate auto-refresh behavior - may indicate invalid traffic'
      );
    }

    if (visibilityReport.summary?.complianceStatus === 'non_compliant') {
      recommendations.push(
        'Improve ad viewability - many ads are not visible to users'
      );
    }

    if (densityReport.summary?.complianceStatus === 'non_compliant') {
      recommendations.push(
        'Reduce ad density - current density exceeds industry standards'
      );
    }

    if (densityReport.summary?.mfaIndicator) {
      recommendations.push(
        'Audit tiny ad placements - may indicate MFA tactics'
      );
    }

    return recommendations.slice(0, 5);
  }

  async processPublisher(crawlData, viewport) {
    try {
      const result = this.aggregateAnalysis(crawlData, viewport);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error('Error processing publisher ad behavior', error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = AdBehaviorAggregator;
