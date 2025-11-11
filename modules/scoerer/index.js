const logger = require('../logger');
const RiskEngine = require('./risk-engine');
const TrendAnalyzer = require('./trend-analyzer');
const BenchmarksModule = require('./benchmarks');
const ExplanationGenerator = require('./explanation');
const GAMMetricsAnalyzer = require('../gam-metrics-analyzer');
const weights = require('./weights.json');

class ScoringEngine {
  constructor(supabaseClient = null) {
    this.supabase = supabaseClient;
    this.weights = weights;
    this.riskEngine = new RiskEngine(weights);
    this.trendAnalyzer = new TrendAnalyzer(weights, supabaseClient);
    this.benchmarks = new BenchmarksModule(supabaseClient);
    this.explanationGenerator = new ExplanationGenerator();
    this.gamAnalyzer = new GAMMetricsAnalyzer(supabaseClient);
  }

  flattenAuditData(auditData) {
    if (!auditData) return {};

    const flattened = { ...auditData };

    if (auditData.contentAnalysis) {
      flattened.entropyScore = auditData.contentAnalysis.entropy?.score || auditData.contentAnalysis.entropyScore || 0;
      flattened.aiLikelihood = auditData.contentAnalysis.aiLikelihood?.percentage || auditData.contentAnalysis.aiLikelihood || 0;
      flattened.clickbaitScore = auditData.contentAnalysis.clickbait?.score || auditData.contentAnalysis.clickbaitScore || 0;
      flattened.readabilityScore = auditData.contentAnalysis.readability?.score || auditData.contentAnalysis.readabilityScore || 0;
      flattened.freshnessScore = auditData.contentAnalysis.freshness?.score || auditData.contentAnalysis.freshnessScore || 0;
      flattened.similarityScore = auditData.contentAnalysis.similarity?.score || auditData.contentAnalysis.similarityScore || 0;
    }

    if (auditData.adAnalysis) {
      flattened.adDensity = auditData.adAnalysis.adDensity || auditData.adAnalysis.density?.percentage || 0;
      flattened.autoRefreshRate = auditData.adAnalysis.autoRefreshRate || auditData.adAnalysis.autoRefresh?.rate || 0;
      flattened.viewportOcclusionPercent = auditData.adAnalysis.viewportOcclusion?.percent || auditData.adAnalysis.viewportOcclusionPercent || 0;
      flattened.suspiciousInteractionRatio = auditData.adAnalysis.suspiciousInteractionRatio || 0;
      flattened.scrollJackingDetected = auditData.adAnalysis.scrollJackingDetected || false;
    }

    if (auditData.technicalCheck) {
      const tech = auditData.technicalCheck;
      flattened.performanceScore = tech.components?.performance?.performanceScore || tech.performanceScore || 0;
      flattened.sslValid = tech.components?.ssl?.valid !== false;

      flattened.brokenLinkRatio = tech.components?.brokenLinks?.brokenRatio || 0;

      if (tech.components?.domainIntel) {
        const domainData = tech.components.domainIntel.domainAge;
        flattened.domainAgeMonths = domainData ? Math.round(domainData.days / 30) : 0;
        flattened.whoisPrivate = tech.components.domainIntel.whoisPrivate || false;
      }
    }

    if (auditData.policyCheck) {
      flattened.policyViolationCount = auditData.policyCheck.violations?.count || auditData.policyCheck.policyViolationCount || 0;
      flattened.restrictedKeywordMatches = auditData.policyCheck.keywords?.count || auditData.policyCheck.restrictedKeywordMatches || 0;
      flattened.jurisdictionViolations = auditData.policyCheck.jurisdictionViolations || 0;
    }

    if (auditData.gamMetrics) {
      flattened.ctr = auditData.gamMetrics.ctr || auditData.ctr || 0;
      flattened.ecpm = auditData.gamMetrics.ecpm || auditData.ecpm || 0;
      flattened.fillRate = auditData.gamMetrics.fillRate || auditData.fillRate || 0;
    } else {
      flattened.ctr = auditData.ctr || 0;
      flattened.ecpm = auditData.ecpm || 0;
      flattened.fillRate = auditData.fillRate || 0;
    }

    if (auditData.gamComparison) {
      flattened.ctrDeviation = auditData.gamComparison.deviations?.ctrDeviation || auditData.ctrDeviation || 0;
      flattened.ecpmDeviation = auditData.gamComparison.deviations?.ecpmDeviation || auditData.ecpmDeviation || 0;
      flattened.fillRateInconsistency = auditData.gamComparison.deviations?.fillRateDeviation || auditData.fillRateInconsistency || 0;
    } else {
      flattened.ctrDeviation = auditData.ctrDeviation || 0;
      flattened.ecpmDeviation = auditData.ecpmDeviation || 0;
      flattened.fillRateInconsistency = auditData.fillRateInconsistency || 0;
    }

    if (auditData.gamSpikeAnalysis) {
      flattened.impressionSpike = auditData.gamSpikeAnalysis.spikeRatio || auditData.impressionSpike || 0;
    } else {
      flattened.impressionSpike = auditData.impressionSpike || 0;
    }

    return flattened;
  }

  async enrichAuditDataWithGAM(auditData, publisherId) {
    try {
      if (!this.gamAnalyzer || !publisherId) {
        logger.warn('GAM enrichment skipped', { reason: !this.gamAnalyzer ? 'no analyzer' : 'no publisherId' });
        return auditData;
      }

      return await this.gamAnalyzer.enrichAuditDataWithGAM(auditData, publisherId);
    } catch (error) {
      logger.error('Error enriching audit data with GAM', error);
      return auditData;
    }
  }

  async calculateComprehensiveScore(auditData, publisherData = {}, options = {}) {
    try {
      logger.info('Score calculation started', {
        module: 'Scorer',
        auditId: auditData?.id,
        publisherId: publisherData?.id
      });

      const flattenedData = this.flattenAuditData(auditData);

      const componentRisks = this.riskEngine.calculateComponentRisks({
        adDensity: flattenedData.adDensity || 0,
        autoRefreshRate: flattenedData.autoRefreshRate || 0,
        viewportOcclusionPercent: flattenedData.viewportOcclusionPercent || 0,
        suspiciousInteractionRatio: flattenedData.suspiciousInteractionRatio || 0,
        scrollJackingDetected: flattenedData.scrollJackingDetected || false,
        entropyScore: flattenedData.entropyScore || 0,
        aiLikelihood: flattenedData.aiLikelihood || 0,
        clickbaitScore: flattenedData.clickbaitScore || 0,
        readabilityScore: flattenedData.readabilityScore || 0,
        freshnessScore: flattenedData.freshnessScore || 0,
        similarityScore: flattenedData.similarityScore || 0,
        performanceScore: flattenedData.performanceScore || 0,
        sslValid: flattenedData.sslValid !== false,
        brokenLinkRatio: flattenedData.brokenLinkRatio || 0,
        domainAgeMonths: flattenedData.domainAgeMonths || 0,
        whoisPrivate: flattenedData.whoisPrivate || false,
        viewportInconsistencyRatio: flattenedData.viewportInconsistencyRatio || 0,
        renderingAnomalies: flattenedData.renderingAnomalies || 0,
        hiddenElementRatio: flattenedData.hiddenElementRatio || 0,
        aggressivePositioning: flattenedData.aggressivePositioning || 0,
        ctrDeviation: flattenedData.ctrDeviation || 0,
        ecpmDeviation: flattenedData.ecpmDeviation || 0,
        fillRateInconsistency: flattenedData.fillRateInconsistency || 0,
        impressionSpike: flattenedData.impressionSpike || 0,
        policyViolationCount: flattenedData.policyViolationCount || 0,
        restrictedKeywordMatches: flattenedData.restrictedKeywordMatches || 0,
        jurisdictionViolations: flattenedData.jurisdictionViolations || 0
      });

      const method = options.method || 'bayesian';
      const riskScores = this.riskEngine.aggregateRiskScores(componentRisks, {method});
      riskScores.riskScore = riskScores.overallRiskScore;

      const historicalScores = auditData?.historicalScores || [];
      const trendAnalysis = await this.trendAnalyzer.analyzeRiskTrend(
        publisherData?.id,
        riskScores.mfaProbability,
        historicalScores
      );

      const benchmarkDeviation = await this.trendAnalyzer.compareWithBenchmarks(
        publisherData?.group || 'default',
        {
          ctr: auditData?.ctr || 0,
          ecpm: auditData?.ecpm || 0,
          fillRate: auditData?.fillRate || 0
        },
        this.supabase
      );

      const patternDrift = await this.trendAnalyzer.detectPatternDrift(
        publisherData?.id,
        this.supabase
      );

      const explanation = this.explanationGenerator.generateExplanation(
        riskScores,
        componentRisks,
        options
      );

      const comprehensiveScore = {
        auditId: auditData?.id,
        publisherId: publisherData?.id,
        riskScore: riskScores.overallRiskScore,
        mfaProbability: riskScores.mfaProbability,
        scores: {
          mfaProbability: riskScores.mfaProbability,
          overallRiskScore: riskScores.overallRiskScore,
          weightedScore: riskScores.weightedScore,
          componentScores: {
            behavioral: componentRisks.behavioral?.score || 0,
            content: componentRisks.content?.score || 0,
            technical: componentRisks.technical?.score || 0,
            layout: componentRisks.layout?.score || 0,
            gamCorrelation: componentRisks.gamCorrelation?.score || 0,
            policy: componentRisks.policy?.score || 0
          }
        },
        trend: {
          direction: trendAnalysis?.trend,
          velocity: trendAnalysis?.velocity,
          deviation: trendAnalysis?.deviation,
          anomaly: trendAnalysis?.anomalyDetection
        },
        benchmarks: benchmarkDeviation,
        patternDrift,
        explanation,
        methodology: riskScores.methodology,
        timestamp: new Date().toISOString()
      };

      logger.success('Score calculated', {
        module: 'Scorer',
        riskScore: Math.round(riskScores.overallRiskScore * 100) / 100,
        riskLevel: explanation.riskLevel,
        publisherId: publisherData?.id
      });

      return comprehensiveScore;
    } catch (error) {
      logger.error('Score calculation failed', error, { module: 'Scorer' });
      throw error;
    }
  }

  async calculateBenchmarks(publisherGroup, metrics = []) {
    try {
      logger.info(`Calculating benchmarks for publisher group: ${publisherGroup}`);

      const benchmarks = await this.benchmarks.calculateBenchmarks(
        publisherGroup,
        metrics,
        this.supabase
      );

      logger.info('Benchmarks calculated', { publisherGroup });
      return benchmarks;
    } catch (error) {
      logger.error('Error calculating benchmarks', error);
      throw error;
    }
  }

  async retrieveBenchmarks(publisherGroup) {
    try {
      return await this.benchmarks.retrieveBenchmarks(publisherGroup, this.supabase);
    } catch (error) {
      logger.error('Error retrieving benchmarks', error);
      throw error;
    }
  }

  async getPublisherGroupStatistics() {
    try {
      return await this.benchmarks.calculatePublisherGroupStatistics(this.supabase);
    } catch (error) {
      logger.error('Error getting publisher group statistics', error);
      throw error;
    }
  }

  compareToBenchmark(currentValue, benchmarkData) {
    return this.benchmarks.compareToBenchmark(currentValue, benchmarkData);
  }

  generateExplanation(riskScores, componentRisks = {}, options = {}) {
    return this.explanationGenerator.generateExplanation(riskScores, componentRisks, options);
  }

  generateHumanReadableJustification(explanation) {
    return this.explanationGenerator.generateHumanReadableRiskJustification(explanation);
  }

  async saveRiskScore(riskScoreData) {
    try {
      if (!this.supabase) {
        logger.warn('No Supabase client available for saving risk score');
        return null;
      }

      const { data, error } = await this.supabase
        .from('mfa_risk_scores')
        .insert([{
          audit_id: riskScoreData.auditId,
          domain: riskScoreData.domain,
          fraud_probability: riskScoreData.mfaProbability,
          confidence_level: riskScoreData.confidenceScore,
          risk_factors: riskScoreData.componentRisks,
          reasoning: {
            summary: riskScoreData.explanation?.summary,
            primaryReasons: riskScoreData.explanation?.primaryReasons,
            recommendations: riskScoreData.explanation?.recommendations
          },
          model_version: 'risk-probability-model-v1'
        }])
        .select();

      if (error) {
        logger.error('Error saving risk score', error);
        return null;
      }

      logger.info('Risk score saved', { auditId: riskScoreData.auditId });
      return data?.[0];
    } catch (error) {
      logger.error('Error in saveRiskScore', error);
      return null;
    }
  }

  async saveTrendData(trendData) {
    try {
      if (!this.supabase) {
        logger.warn('No Supabase client available for saving trend data');
        return null;
      }

      const { data, error } = await this.supabase
        .from('publisher_risk_trends')
        .insert([{
          publisher_id: trendData.publisherId,
          site_url: trendData.domain,
          mfa_probability: trendData.mfaProbability,
          trend_direction: trendData.trendDirection,
          velocity: trendData.velocity,
          previous_mfa_probability: trendData.previousScore,
          days_since_previous: trendData.daysSincePrevious,
          probability_change: trendData.probabilityChange,
          ctr_deviation: trendData.ctrDeviation,
          ctr_vs_benchmark: trendData.ctrVsBenchmark,
          ecpm_deviation: trendData.ecpmDeviation,
          ecpm_vs_benchmark: trendData.ecpmVsBenchmark,
          fill_rate_change: trendData.fillRateChange,
          is_anomaly: trendData.isAnomaly,
          anomaly_score: trendData.anomalyScore,
          anomaly_reasons: trendData.anomalyReasons
        }])
        .select();

      if (error) {
        logger.error('Error saving trend data', error);
        return null;
      }

      logger.info('Trend data saved', { publisherId: trendData.publisherId });
      return data?.[0];
    } catch (error) {
      logger.error('Error in saveTrendData', error);
      return null;
    }
  }

  mapScoreToRiskLevel(score) {
    return this.riskEngine.mapScoreToRiskLevel(score);
  }

  getWeights() {
    return this.weights;
  }

  setWeights(newWeights) {
    this.weights = { ...this.weights, ...newWeights };
    this.riskEngine = new RiskEngine(this.weights);
    this.trendAnalyzer = new TrendAnalyzer(this.weights, this.supabase);
  }
}

module.exports = ScoringEngine;
