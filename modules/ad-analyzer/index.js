const logger = require('../logger');
const PatternDetector = require('./pattern-detector');
const AutoRefreshDetector = require('./auto-refresh');
const VisibilityChecker = require('./visibility');
const AdDensityCalculator = require('./ad-density');
const AdAnalyzerDB = require('./db');
const VideoAnalyzer = require('./video-analyzer');

class AdBehaviorAggregator {
  constructor(config = {}) {
    this.patternDetector = new PatternDetector(config.networks);
    this.autoRefreshDetector = new AutoRefreshDetector(config.refresh);
    this.visibilityChecker = new VisibilityChecker(config.visibility);
    this.adDensityCalculator = new AdDensityCalculator(config.density);
    this.videoAnalyzer = new VideoAnalyzer(config.video);
    this.config = config;

    if (config.supabaseUrl && config.supabaseServiceKey) {
      this.db = new AdAnalyzerDB(config.supabaseUrl, config.supabaseServiceKey);
    }
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
    const videoReport = this.videoAnalyzer.analyze(crawlData);

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
        video: videoReport,
      },
      correlations: merged.correlations,
      riskAssessment: this.calculateRiskScore(
        patternReport,
        refreshReport,
        visibilityReport,
        densityReport,
        videoReport
      ),
      adElements: merged.adElements || [],
    };

    logger.info('Ad behavior aggregation completed', {
      publisherId: crawlData.publisherId,
      riskScore: aggregated.riskAssessment.overallRiskScore,
    });

    return aggregated;
  }

  calculateRiskScore(patternReport, refreshReport, visibilityReport, densityReport, videoReport) {
    let totalRisk = 0;
    const factors = {};

    if (patternReport.summary) {
      const patternRisk = Math.min(
        patternReport.summary.mfaRiskScore || 0,
        1
      );
      factors.patternRisk = patternRisk;
      totalRisk += patternRisk * 0.20;
    }

    if (refreshReport.summary) {
      let refreshRisk = refreshReport.summary.autoRefreshDetected ? 0.2 : 0;
      if (refreshReport.summary.criticalRefreshCount > 0) {
        refreshRisk = 1.0; // Critical MFA indicator
      } else if (refreshReport.summary.warningRefreshCount > 0) {
        refreshRisk = 0.6;
      }
      factors.refreshRisk = refreshRisk;
      totalRisk += refreshRisk * 0.20;
    }

    if (visibilityReport.summary) {
      const visibilityRisk =
        visibilityReport.summary.complianceStatus === 'non_compliant' ? 0.4 : 0.1;
      factors.visibilityRisk = visibilityRisk;
      totalRisk += visibilityRisk * 0.20;
    }

    if (densityReport.summary) {
      let densityRisk =
        densityReport.summary.complianceStatus === 'non_compliant'
          ? densityReport.metrics.adDensity
          : 0;

      // Ad Stacking is a critical fraud/MFA indicator
      if (densityReport.problems && densityReport.problems.some(p => p.message.includes('ad stacking'))) {
        densityRisk = 1.0;
      }

      factors.densityRisk = densityRisk;
      totalRisk += densityRisk * 0.20;
    }

    if (videoReport && videoReport.summary) {
      const videoRisk = videoReport.summary.riskScore || 0;
      factors.videoRisk = videoRisk;
      totalRisk += videoRisk * 0.20;
    }

    return {
      overallRiskScore: parseFloat(totalRisk.toFixed(3)),
      factors,
      riskLevel: this.getRiskLevel(totalRisk),
      recommendations: this.getRecommendations(
        patternReport,
        refreshReport,
        visibilityReport,
        densityReport,
        videoReport
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

  getRecommendations(patternReport, refreshReport, visibilityReport, densityReport, videoReport) {
    const recommendations = [];

    if (
      patternReport.summary &&
      patternReport.summary.mfaRiskScore > 0.3
    ) {
      recommendations.push(
        'Review ad network diversity and investigate suspicious patterns'
      );
    }

    if (refreshReport.summary?.criticalRefreshCount > 0) {
      recommendations.push(
        'CRITICAL: Disable rapid auto-refresh (< 30s) immediately to avoid MFA classification'
      );
    } else if (refreshReport.summary?.autoRefreshDetected) {
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

    if (densityReport.problems && densityReport.problems.some(p => p.message.includes('ad stacking'))) {
      recommendations.push(
        'CRITICAL: Remove overlapping ad slots (Ad Stacking) - this is considered fraud'
      );
    }

    if (densityReport.summary?.mfaIndicator) {
      recommendations.push(
        'Audit tiny ad placements - may indicate MFA tactics'
      );
    }

    if (videoReport && videoReport.recommendations) {
      recommendations.push(...videoReport.recommendations);
    }

    return recommendations.slice(0, 5);
  }

  async persistAnalysisResults(publisherId, siteAuditId, aggregatedAnalysis) {
    if (!this.db) {
      logger.warn('Database not configured, skipping persistence');
      return { success: false, error: 'Database not configured' };
    }

    try {
      logger.info('Persisting analysis results to database', {
        publisherId,
        siteAuditId,
      });

      const analysisData = {
        densityData: {
          density_percentage: aggregatedAnalysis.analysis?.density?.metrics?.adDensity || 0,
          total_viewport_pixels: aggregatedAnalysis.analysis?.density?.metrics?.totalViewportPixels || 0,
          total_ad_pixels: aggregatedAnalysis.analysis?.density?.metrics?.totalAdPixels || 0,
          compliance_status: aggregatedAnalysis.analysis?.density?.summary?.complianceStatus || 'unknown',
          viewport_width: aggregatedAnalysis.metadata?.viewport?.width,
          viewport_height: aggregatedAnalysis.metadata?.viewport?.height,
        },
        autoRefreshData: {
          auto_refresh_detected: aggregatedAnalysis.analysis?.autoRefresh?.summary?.autoRefreshDetected || false,
          refresh_count: aggregatedAnalysis.analysis?.autoRefresh?.detectedPatterns?.length || 0,
          refresh_intervals: aggregatedAnalysis.analysis?.autoRefresh?.intervals || [],
          affected_ad_slots: aggregatedAnalysis.analysis?.autoRefresh?.affectedSlots || 0,
          risk_level: this.getRiskLevel(aggregatedAnalysis.riskAssessment?.factors?.refreshRisk || 0),
        },
        visibilityData: {
          compliance_status: aggregatedAnalysis.analysis?.visibility?.summary?.complianceStatus || 'unknown',
          visible_ads_percentage: aggregatedAnalysis.analysis?.visibility?.metrics?.visiblePercentage || 0,
          visible_ads_count: aggregatedAnalysis.analysis?.visibility?.metrics?.visibleCount || 0,
          hidden_ads_count: aggregatedAnalysis.analysis?.visibility?.metrics?.hiddenCount || 0,
          total_ads_count: aggregatedAnalysis.metadata?.totalAdElements || 0,
          recommendations: aggregatedAnalysis.riskAssessment?.recommendations || [],
        },
        patternData: {
          network_diversity: aggregatedAnalysis.analysis?.patterns?.networkAnalysis?.networkDiversity || 0,
          detected_networks: aggregatedAnalysis.analysis?.patterns?.networkAnalysis?.detectedNetworks || [],
          suspicious_patterns: aggregatedAnalysis.analysis?.patterns?.networkAnalysis?.suspiciousPatterns?.length || 0,
          mfa_risk_score: aggregatedAnalysis.analysis?.patterns?.mfaIndicators?.riskScore || 0,
          mfa_indicators: aggregatedAnalysis.analysis?.patterns?.mfaIndicators || {},
          detected_anomalies: aggregatedAnalysis.analysis?.patterns?.anomalies || [],
          correlation_data: aggregatedAnalysis.correlations || [],
        },
        videoData: {
          video_player_count: aggregatedAnalysis.analysis?.video?.metrics?.videoPlayerCount || 0,
          autoplay_count: aggregatedAnalysis.analysis?.video?.metrics?.autoplayCount || 0,
          video_stuffing_detected: aggregatedAnalysis.analysis?.video?.summary?.videoStuffingDetected || false,
          risk_score: aggregatedAnalysis.analysis?.video?.summary?.riskScore || 0,
          video_players_data: aggregatedAnalysis.analysis?.video?.metrics?.videoPlayers || [],
        },
        adElements: aggregatedAnalysis.adElements || [],
      };

      return await this.db.saveMultipleAnalysis(publisherId, siteAuditId, analysisData);
    } catch (error) {
      logger.error('Error persisting analysis results', error);
      return { success: false, error: error.message };
    }
  }

  async processPublisher(crawlData, viewport) {
    try {
      const result = this.aggregateAnalysis(crawlData, viewport);

      if (this.db && crawlData.publisherId && crawlData.siteAuditId) {
        const persistResult = await this.persistAnalysisResults(
          crawlData.publisherId,
          crawlData.siteAuditId,
          result
        );
        result.persistenceResult = persistResult;
      }

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
