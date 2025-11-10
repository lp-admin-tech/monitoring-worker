const logger = require('../logger');
const RiskEngine = require('./risk-engine');
const TrendAnalyzer = require('./trend-analyzer');
const BenchmarksModule = require('./benchmarks');
const ExplanationGenerator = require('./explanation');
const weights = require('./weights.json');

class ScoringEngine {
  constructor(supabaseClient = null) {
    this.supabase = supabaseClient;
    this.weights = weights;
    this.riskEngine = new RiskEngine(weights);
    this.trendAnalyzer = new TrendAnalyzer(weights, supabaseClient);
    this.benchmarks = new BenchmarksModule(supabaseClient);
    this.explanationGenerator = new ExplanationGenerator();
  }

  async calculateComprehensiveScore(auditData, publisherData = {}, options = {}) {
    try {
      logger.info('Starting comprehensive risk score calculation', {
        auditId: auditData?.id,
        publisherId: publisherData?.id
      });

      const componentRisks = this.riskEngine.calculateComponentRisks({
        adDensity: auditData?.adDensity || 0,
        autoRefreshRate: auditData?.autoRefreshRate || 0,
        viewportOcclusionPercent: auditData?.viewportOcclusionPercent || 0,
        suspiciousInteractionRatio: auditData?.suspiciousInteractionRatio || 0,
        scrollJackingDetected: auditData?.scrollJackingDetected || false,
        entropyScore: auditData?.entropyScore || 0,
        aiLikelihood: auditData?.aiLikelihood || 0,
        clickbaitScore: auditData?.clickbaitScore || 0,
        readabilityScore: auditData?.readabilityScore || 0,
        freshnessScore: auditData?.freshnessScore || 0,
        similarityScore: auditData?.similarityScore || 0,
        performanceScore: auditData?.performanceScore || 0,
        sslValid: auditData?.sslValid !== false,
        brokenLinkRatio: auditData?.brokenLinkRatio || 0,
        domainAgeMonths: auditData?.domainAgeMonths || 0,
        whoisPrivate: auditData?.whoisPrivate || false,
        viewportInconsistencyRatio: auditData?.viewportInconsistencyRatio || 0,
        renderingAnomalies: auditData?.renderingAnomalies || 0,
        hiddenElementRatio: auditData?.hiddenElementRatio || 0,
        aggressivePositioning: auditData?.aggressivePositioning || 0,
        ctrDeviation: auditData?.ctrDeviation || 0,
        ecpmDeviation: auditData?.ecpmDeviation || 0,
        fillRateInconsistency: auditData?.fillRateInconsistency || 0,
        impressionSpike: auditData?.impressionSpike || 0,
        policyViolationCount: auditData?.policyViolationCount || 0,
        restrictedKeywordMatches: auditData?.restrictedKeywordMatches || 0,
        jurisdictionViolations: auditData?.jurisdictionViolations || 0
      });

      const method = options.method || 'bayesian';
      const riskScores = this.riskEngine.aggregateRiskScores({}, {method});
      riskScores.componentRisks = componentRisks;

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

      logger.info('Comprehensive score calculated successfully', {
        riskLevel: explanation.riskLevel,
        mfaProbability: riskScores.mfaProbability
      });

      return comprehensiveScore;
    } catch (error) {
      logger.error('Error calculating comprehensive score', error);
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
