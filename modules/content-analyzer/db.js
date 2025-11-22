const logger = require('../logger');
const { supabaseClient: supabase } = require('../supabase-client');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

class ContentAnalyzerDb {
  constructor() {
    this.tableName = 'content_analysis_results';
    this.historyTableName = 'content_analysis_history';
    this.fingerprintsTableName = 'similarity_fingerprints';
    this.trendsTableName = 'content_risk_trends';
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async retryOperation(operation, operationName, context = {}) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const startTime = Date.now();
        const result = await operation();
        const duration = Date.now() - startTime;

        logger.info(`${operationName} succeeded`, {
          module: 'content-analyzer-db',
          attempt,
          durationMs: duration,
          ...context,
        });

        return { success: true, data: result, duration };
      } catch (error) {
        lastError = error;
        const duration = Date.now() - Date.now();

        logger.warn(`${operationName} failed (attempt ${attempt}/${MAX_RETRIES})`, {
          module: 'content-analyzer-db',
          attempt,
          error: error.message,
          ...context,
        });

        if (attempt < MAX_RETRIES) {
          const delayMs = RETRY_DELAY_MS * attempt;
          await this.sleep(delayMs);
        }
      }
    }

    const error = new Error(`${operationName} failed after ${MAX_RETRIES} retries: ${lastError?.message}`);
    logger.error(`${operationName} failed permanently`, lastError, {
      module: 'content-analyzer-db',
      retries: MAX_RETRIES,
      ...context,
    });

    throw error;
  }

  async saveAnalysisMetrics(publisherId, pageUrl, siteAuditId, metrics) {
    if (!publisherId || !pageUrl || !metrics) {
      throw new Error('Missing required parameters: publisherId, pageUrl, metrics');
    }

    return this.retryOperation(
      async () => {
        const analysisData = {
          publisher_id: publisherId,
          page_url: pageUrl,
          site_audit_id: siteAuditId || null,
          content_hash: metrics.similarity?.contentHash || null,
          simhash: metrics.similarity?.simhashFingerprint || null,
          analysis_timestamp: new Date().toISOString(),
          entropy_score: metrics.entropy?.entropyScore || null,
          entropy_metrics: metrics.entropy || null,
          readability_score: metrics.readability?.readabilityScore || null,
          readability_metrics: metrics.readability || null,
          ai_likelihood_score: metrics.ai?.aiScore || null,
          ai_metrics: metrics.ai || null,
          clickbait_score: metrics.clickbait?.clickbaitScore || null,
          clickbait_metrics: metrics.clickbait || null,
          similarity_hash: metrics.similarity?.simhashFingerprint || null,
          freshness_score: metrics.freshness?.daysOld || null,
          freshness_metrics: metrics.freshness || null,
          risk_assessment: metrics.riskAssessment || null,
          flag_status: metrics.flagStatus || 'clean',
          analysis_data: metrics,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.tableName)
          .insert(analysisData)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save analysis metrics',
      { publisherId, pageUrl }
    );
  }

  async saveEntropyScore(publisherId, pageUrl, siteAuditId, entropyScore, metrics) {
    if (!publisherId || !pageUrl || entropyScore === undefined) {
      throw new Error('Missing required parameters: publisherId, pageUrl, entropyScore');
    }

    return this.retryOperation(
      async () => {
        const updateData = {
          entropy_score: entropyScore,
          entropy_metrics: metrics || {},
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.tableName)
          .update(updateData)
          .eq('publisher_id', publisherId)
          .eq('page_url', pageUrl)
          .order('created_at', { ascending: false })
          .limit(1)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save entropy score',
      { publisherId, pageUrl, entropyScore }
    );
  }

  async saveReadabilityScore(publisherId, pageUrl, siteAuditId, readabilityScore, metrics) {
    if (!publisherId || !pageUrl || readabilityScore === undefined) {
      throw new Error('Missing required parameters: publisherId, pageUrl, readabilityScore');
    }

    return this.retryOperation(
      async () => {
        const updateData = {
          readability_score: readabilityScore,
          readability_metrics: metrics || {},
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.tableName)
          .update(updateData)
          .eq('publisher_id', publisherId)
          .eq('page_url', pageUrl)
          .order('created_at', { ascending: false })
          .limit(1)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save readability score',
      { publisherId, pageUrl, readabilityScore }
    );
  }

  async saveAILikelihoodScore(publisherId, pageUrl, siteAuditId, aiScore, metrics) {
    if (!publisherId || !pageUrl || aiScore === undefined) {
      throw new Error('Missing required parameters: publisherId, pageUrl, aiScore');
    }

    return this.retryOperation(
      async () => {
        const updateData = {
          ai_likelihood_score: aiScore,
          ai_metrics: metrics || {},
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.tableName)
          .update(updateData)
          .eq('publisher_id', publisherId)
          .eq('page_url', pageUrl)
          .order('created_at', { ascending: false })
          .limit(1)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save AI likelihood score',
      { publisherId, pageUrl, aiScore }
    );
  }

  async saveClickbaitScore(publisherId, pageUrl, siteAuditId, clickbaitScore, metrics) {
    if (!publisherId || !pageUrl || clickbaitScore === undefined) {
      throw new Error('Missing required parameters: publisherId, pageUrl, clickbaitScore');
    }

    return this.retryOperation(
      async () => {
        const updateData = {
          clickbait_score: clickbaitScore,
          clickbait_metrics: metrics || {},
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.tableName)
          .update(updateData)
          .eq('publisher_id', publisherId)
          .eq('page_url', pageUrl)
          .order('created_at', { ascending: false })
          .limit(1)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save clickbait score',
      { publisherId, pageUrl, clickbaitScore }
    );
  }

  async saveSimilarityHash(publisherId, pageUrl, siteAuditId, simhash, contentHash, metrics) {
    if (!publisherId || !pageUrl || !simhash) {
      throw new Error('Missing required parameters: publisherId, pageUrl, simhash');
    }

    return this.retryOperation(
      async () => {
        const updateData = {
          similarity_hash: simhash,
          simhash: simhash,
          content_hash: contentHash || null,
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.tableName)
          .update(updateData)
          .eq('publisher_id', publisherId)
          .eq('page_url', pageUrl)
          .order('created_at', { ascending: false })
          .limit(1)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save similarity hash',
      { publisherId, pageUrl, simhash }
    );
  }

  async saveFreshnessMetrics(publisherId, pageUrl, siteAuditId, freshnessScore, metrics) {
    if (!publisherId || !pageUrl || freshnessScore === undefined) {
      throw new Error('Missing required parameters: publisherId, pageUrl, freshnessScore');
    }

    return this.retryOperation(
      async () => {
        const updateData = {
          freshness_score: freshnessScore,
          freshness_metrics: metrics || {},
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.tableName)
          .update(updateData)
          .eq('publisher_id', publisherId)
          .eq('page_url', pageUrl)
          .order('created_at', { ascending: false })
          .limit(1)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save freshness metrics',
      { publisherId, pageUrl, freshnessScore }
    );
  }

  async saveCompleteAnalysis(publisherId, pageUrl, siteAuditId, completeAnalysis) {
    if (!publisherId || !pageUrl || !completeAnalysis) {
      throw new Error('Missing required parameters: publisherId, pageUrl, completeAnalysis');
    }

    return this.retryOperation(
      async () => {
        const analysisData = {
          publisher_id: publisherId,
          page_url: pageUrl,
          site_audit_id: siteAuditId || null,
          content_hash: completeAnalysis.similarity?.contentHash || null,
          simhash: completeAnalysis.similarity?.simhashFingerprint || null,
          analysis_timestamp: new Date().toISOString(),
          entropy_score: completeAnalysis.entropy?.entropyScore || null,
          entropy_metrics: completeAnalysis.entropy || null,
          readability_score: completeAnalysis.readability?.readabilityScore || null,
          readability_metrics: completeAnalysis.readability || null,
          ai_likelihood_score: completeAnalysis.ai?.aiScore || null,
          ai_metrics: completeAnalysis.ai || null,
          clickbait_score: completeAnalysis.clickbait?.clickbaitScore || null,
          clickbait_metrics: completeAnalysis.clickbait || null,
          similarity_hash: completeAnalysis.similarity?.simhashFingerprint || null,
          freshness_score: completeAnalysis.freshness?.daysOld || null,
          freshness_metrics: completeAnalysis.freshness || null,
          risk_assessment: completeAnalysis.riskAssessment || null,
          flag_status: completeAnalysis.flagStatus || 'clean',
          analysis_data: completeAnalysis,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.tableName)
          .insert(analysisData)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save complete analysis',
      { publisherId, pageUrl }
    );
  }

  async trackVersionHistory(publisherId, pageUrl, currentAnalysis, previousAnalysisId = null) {
    if (!publisherId || !pageUrl || !currentAnalysis) {
      throw new Error('Missing required parameters: publisherId, pageUrl, currentAnalysis');
    }

    return this.retryOperation(
      async () => {
        let previousAnalysis = null;
        if (previousAnalysisId) {
          const { data } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('id', previousAnalysisId)
            .maybeSingle();
          previousAnalysis = data;
        } else {
          const { data } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('publisher_id', publisherId)
            .eq('page_url', pageUrl)
            .order('created_at', { ascending: false })
            .limit(2);
          previousAnalysis = data?.[1] || null;
        }

        const detectedChanges = this.compareAnalysis(currentAnalysis, previousAnalysis);
        const riskScoreChange = previousAnalysis
          ? (currentAnalysis.riskAssessment?.totalRiskScore || 0) - (previousAnalysis.risk_assessment?.totalRiskScore || 0)
          : null;

        const historyEntry = {
          content_analysis_id: null,
          publisher_id: publisherId,
          previous_flag_status: previousAnalysis?.flag_status || null,
          current_flag_status: currentAnalysis.flagStatus || 'clean',
          detected_changes: detectedChanges,
          risk_score_change: riskScoreChange,
          comparison_timestamp: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.historyTableName)
          .insert(historyEntry)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Track version history',
      { publisherId, pageUrl }
    );
  }

  compareAnalysis(currentAnalysis, previousAnalysis) {
    const changes = [];

    if (!previousAnalysis) {
      return ['new_analysis_created'];
    }

    if ((currentAnalysis.entropy?.entropyScore || 0) !== (previousAnalysis.entropy_score || 0)) {
      changes.push('entropy_score_changed');
    }

    if ((currentAnalysis.readability?.readabilityScore || 0) !== (previousAnalysis.readability_score || 0)) {
      changes.push('readability_score_changed');
    }

    if ((currentAnalysis.ai?.aiScore || 0) !== (previousAnalysis.ai_likelihood_score || 0)) {
      changes.push('ai_likelihood_changed');
    }

    if ((currentAnalysis.clickbait?.clickbaitScore || 0) !== (previousAnalysis.clickbait_score || 0)) {
      changes.push('clickbait_score_changed');
    }

    if ((currentAnalysis.similarity?.simhashFingerprint || '') !== (previousAnalysis.simhash || '')) {
      changes.push('content_similarity_changed');
    }

    if ((currentAnalysis.freshness?.daysOld || 0) !== (previousAnalysis.freshness_score || 0)) {
      changes.push('freshness_changed');
    }

    if ((currentAnalysis.flagStatus || 'clean') !== (previousAnalysis.flag_status || 'clean')) {
      changes.push('flag_status_changed');
    }

    if ((currentAnalysis.riskAssessment?.totalRiskScore || 0) !== (previousAnalysis.risk_assessment?.totalRiskScore || 0)) {
      changes.push('risk_score_changed');
    }

    return changes.length > 0 ? changes : ['no_changes_detected'];
  }

  async getTrendData(publisherId, metricType = 'all', daysBack = 30, limit = 100) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    const validMetricTypes = ['entropy', 'readability', 'ai_detection', 'all'];
    if (!validMetricTypes.includes(metricType)) {
      throw new Error(`Invalid metricType: ${metricType}. Must be one of: ${validMetricTypes.join(', ')}`);
    }

    return this.retryOperation(
      async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        const startDateStr = startDate.toISOString().split('T')[0];

        let query = supabase
          .from(this.tableName)
          .select('entropy_score, readability_score, ai_likelihood_score, clickbait_score, freshness_score, flag_status, created_at, page_url')
          .eq('publisher_id', publisherId)
          .gte('created_at', startDateStr)
          .order('created_at', { ascending: false })
          .limit(limit);

        const { data, error } = await query;

        if (error) throw error;

        const trends = this.aggregateTrendMetrics(data, metricType);
        return {
          publisherId,
          metricType,
          daysBack,
          dataPoints: data?.length || 0,
          trends,
          aggregatedAt: new Date().toISOString(),
        };
      },
      'Get trend data',
      { publisherId, metricType, daysBack }
    );
  }

  aggregateTrendMetrics(dataPoints, metricType) {
    if (!dataPoints || dataPoints.length === 0) {
      return {
        entropyTrend: [],
        readabilityTrend: [],
        aiDetectionTrend: [],
        flagStatusDistribution: {},
      };
    }

    const entropyTrend = [];
    const readabilityTrend = [];
    const aiDetectionTrend = [];
    const flagStatusDistribution = {};

    dataPoints.forEach(point => {
      if (metricType === 'entropy' || metricType === 'all') {
        entropyTrend.push({
          date: point.created_at,
          score: point.entropy_score,
          url: point.page_url,
        });
      }

      if (metricType === 'readability' || metricType === 'all') {
        readabilityTrend.push({
          date: point.created_at,
          score: point.readability_score,
          url: point.page_url,
        });
      }

      if (metricType === 'ai_detection' || metricType === 'all') {
        aiDetectionTrend.push({
          date: point.created_at,
          score: point.ai_likelihood_score,
          url: point.page_url,
        });
      }

      if (metricType === 'all') {
        const status = point.flag_status || 'unknown';
        flagStatusDistribution[status] = (flagStatusDistribution[status] || 0) + 1;
      }
    });

    return {
      entropyTrend: metricType === 'all' || metricType === 'entropy' ? entropyTrend : [],
      readabilityTrend: metricType === 'all' || metricType === 'readability' ? readabilityTrend : [],
      aiDetectionTrend: metricType === 'all' || metricType === 'ai_detection' ? aiDetectionTrend : [],
      flagStatusDistribution: metricType === 'all' ? flagStatusDistribution : {},
      statistics: this.calculateStatistics(dataPoints, metricType),
    };
  }

  calculateStatistics(dataPoints, metricType) {
    const stats = {};

    if (metricType === 'entropy' || metricType === 'all') {
      const entropyScores = dataPoints.map(p => p.entropy_score).filter(s => s !== null && s !== undefined);
      stats.entropy = {
        average: entropyScores.length > 0 ? (entropyScores.reduce((a, b) => a + b) / entropyScores.length).toFixed(3) : null,
        min: entropyScores.length > 0 ? Math.min(...entropyScores).toFixed(3) : null,
        max: entropyScores.length > 0 ? Math.max(...entropyScores).toFixed(3) : null,
        dataPoints: entropyScores.length,
      };
    }

    if (metricType === 'readability' || metricType === 'all') {
      const readabilityScores = dataPoints.map(p => p.readability_score).filter(s => s !== null && s !== undefined);
      stats.readability = {
        average: readabilityScores.length > 0 ? (readabilityScores.reduce((a, b) => a + b) / readabilityScores.length).toFixed(3) : null,
        min: readabilityScores.length > 0 ? Math.min(...readabilityScores).toFixed(3) : null,
        max: readabilityScores.length > 0 ? Math.max(...readabilityScores).toFixed(3) : null,
        dataPoints: readabilityScores.length,
      };
    }

    if (metricType === 'ai_detection' || metricType === 'all') {
      const aiScores = dataPoints.map(p => p.ai_likelihood_score).filter(s => s !== null && s !== undefined);
      stats.aiDetection = {
        average: aiScores.length > 0 ? (aiScores.reduce((a, b) => a + b) / aiScores.length).toFixed(3) : null,
        min: aiScores.length > 0 ? Math.min(...aiScores).toFixed(3) : null,
        max: aiScores.length > 0 ? Math.max(...aiScores).toFixed(3) : null,
        dataPoints: aiScores.length,
      };
    }

    return stats;
  }

  async getLatestAnalysis(publisherId, pageUrl) {
    if (!publisherId || !pageUrl) {
      throw new Error('Missing required parameters: publisherId, pageUrl');
    }

    return this.retryOperation(
      async () => {
        const { data, error } = await supabase
          .from(this.tableName)
          .select('*')
          .eq('publisher_id', publisherId)
          .eq('page_url', pageUrl)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        return data;
      },
      'Get latest analysis',
      { publisherId, pageUrl }
    );
  }

  async getAnalysisHistory(publisherId, pageUrl, limit = 20) {
    if (!publisherId || !pageUrl) {
      throw new Error('Missing required parameters: publisherId, pageUrl');
    }

    return this.retryOperation(
      async () => {
        const { data, error } = await supabase
          .from(this.tableName)
          .select('*')
          .eq('publisher_id', publisherId)
          .eq('page_url', pageUrl)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;
        return data || [];
      },
      'Get analysis history',
      { publisherId, pageUrl, limit }
    );
  }
}

module.exports = new ContentAnalyzerDb();
module.exports.ContentAnalyzerDb = ContentAnalyzerDb;
