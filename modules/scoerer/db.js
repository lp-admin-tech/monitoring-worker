const { createClient } = require('@supabase/supabase-js');
const logger = require('../logger');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

class ScorerDB {
  constructor(supabaseUrl, supabaseServiceKey) {
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase URL and service key are required');
    }
    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
    this.logger = logger;
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

        this.logger.info(`${operationName} succeeded`, {
          module: 'scorer-db',
          attempt,
          durationMs: duration,
          ...context,
        });

        return { success: true, data: result, duration };
      } catch (error) {
        lastError = error;

        this.logger.warn(`${operationName} failed (attempt ${attempt}/${MAX_RETRIES})`, {
          module: 'scorer-db',
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
    this.logger.error(`${operationName} failed permanently`, lastError, {
      module: 'scorer-db',
      retries: MAX_RETRIES,
      ...context,
    });

    throw error;
  }

  async saveOverallRiskScore(publisherId, auditId, scoreData) {
    if (!publisherId || !scoreData) {
      throw new Error('Missing required parameters: publisherId, scoreData');
    }

    return this.retryOperation(
      async () => {
        const record = {
          publisher_id: publisherId,
          audit_id: auditId || null,
          overall_risk_score: scoreData.overallRiskScore || 0,
          mfa_probability: scoreData.mfaProbability || 0,
          weighted_score: scoreData.weightedScore || 0,
          behavioral_score: scoreData.componentScores?.behavioral || 0,
          content_score: scoreData.componentScores?.content || 0,
          technical_score: scoreData.componentScores?.technical || 0,
          layout_score: scoreData.componentScores?.layout || 0,
          gam_correlation_score: scoreData.componentScores?.gamCorrelation || 0,
          policy_score: scoreData.componentScores?.policy || 0,
          confidence_score: scoreData.confidenceScore || 0,
          methodology: scoreData.methodology || 'bayesian',
          component_breakdown: scoreData.componentScores || null,
        };

        const { data, error } = await this.supabase
          .from('scorer_risk_history')
          .insert(record)
          .select();

        if (error) {
          throw new Error(`Risk score insert failed: ${error.message}`);
        }

        this.logger.info('Overall risk score saved successfully', {
          id: data[0]?.id,
          publisherId,
          auditId,
        });

        return data[0];
      },
      'saveOverallRiskScore',
      { publisherId, auditId }
    );
  }

  async saveMethodologyDetails(publisherId, auditId, riskScoreId, methodologyData) {
    if (!publisherId || !methodologyData) {
      throw new Error('Missing required parameters: publisherId, methodologyData');
    }

    return this.retryOperation(
      async () => {
        const record = {
          publisher_id: publisherId,
          audit_id: auditId || null,
          risk_score_id: riskScoreId || null,
          model_version: methodologyData.modelVersion || 'v1',
          calculation_method: methodologyData.method || 'bayesian',
          summary: methodologyData.summary || null,
          primary_reasons: methodologyData.primaryReasons || null,
          contributing_factors: methodologyData.contributingFactors || null,
          recommendations: methodologyData.recommendations || null,
          risk_level: methodologyData.riskLevel || null,
          explanation_data: methodologyData.explanation || null,
        };

        const { data, error } = await this.supabase
          .from('scorer_methodology_log')
          .insert(record)
          .select();

        if (error) {
          throw new Error(`Methodology insert failed: ${error.message}`);
        }

        this.logger.info('Methodology details saved successfully', {
          id: data[0]?.id,
          publisherId,
          method: methodologyData.method,
        });

        return data[0];
      },
      'saveMethodologyDetails',
      { publisherId, auditId }
    );
  }

  async saveRiskScoreVersion(publisherId, auditId, versionData) {
    if (!publisherId || versionData.riskScore === undefined) {
      throw new Error('Missing required parameters: publisherId, versionData.riskScore');
    }

    return this.retryOperation(
      async () => {
        const { data: latestVersion } = await this.supabase
          .from('scorer_version_history')
          .select('version_number')
          .eq('publisher_id', publisherId)
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextVersion = (latestVersion?.version_number || 0) + 1;

        const record = {
          publisher_id: publisherId,
          audit_id: auditId || null,
          version_number: nextVersion,
          risk_score: versionData.riskScore,
          mfa_probability: versionData.mfaProbability || 0,
          risk_level: versionData.riskLevel || null,
        };

        const { data, error } = await this.supabase
          .from('scorer_version_history')
          .insert(record)
          .select();

        if (error) {
          throw new Error(`Version history insert failed: ${error.message}`);
        }

        this.logger.info('Risk score version saved successfully', {
          id: data[0]?.id,
          publisherId,
          version: nextVersion,
          riskScore: versionData.riskScore,
        });

        return data[0];
      },
      'saveRiskScoreVersion',
      { publisherId, auditId }
    );
  }

  async calculateAndSaveRiskDelta(publisherId, currentAuditId, currentScore, previousAuditId = null, previousScore = null) {
    if (!publisherId || currentScore === undefined) {
      throw new Error('Missing required parameters: publisherId, currentScore');
    }

    return this.retryOperation(
      async () => {
        let prevScore = previousScore;
        let prevAuditId = previousAuditId;

        if (prevScore === null) {
          const { data: previousData } = await this.supabase
            .from('scorer_version_history')
            .select('risk_score, audit_id, recorded_at')
            .eq('publisher_id', publisherId)
            .order('version_number', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (previousData) {
            prevScore = previousData.risk_score;
            prevAuditId = previousData.audit_id;
          }
        }

        if (prevScore === null || prevScore === undefined) {
          this.logger.warn('No previous score found for delta calculation', { publisherId, currentAuditId });
          return null;
        }

        const deltaValue = currentScore - prevScore;
        const deltaPercentage = prevScore !== 0 ? (deltaValue / prevScore) * 100 : 0;
        const deltaDirection = deltaValue > 0.01 ? 'increasing' : deltaValue < -0.01 ? 'decreasing' : 'stable';
        const velocity = deltaValue;

        const record = {
          publisher_id: publisherId,
          current_audit_id: currentAuditId || null,
          previous_audit_id: prevAuditId || null,
          current_score: currentScore,
          previous_score: prevScore,
          delta_value: deltaValue,
          delta_percentage: deltaPercentage,
          delta_direction: deltaDirection,
          velocity: velocity,
        };

        const { data, error } = await this.supabase
          .from('scorer_risk_deltas')
          .insert(record)
          .select();

        if (error) {
          throw new Error(`Risk delta insert failed: ${error.message}`);
        }

        this.logger.info('Risk delta calculated and saved successfully', {
          id: data[0]?.id,
          publisherId,
          deltaValue,
          direction: deltaDirection,
        });

        return data[0];
      },
      'calculateAndSaveRiskDelta',
      { publisherId, currentAuditId }
    );
  }

  async saveTrendAnalysisData(publisherId, auditId, trendData) {
    if (!publisherId || !trendData) {
      throw new Error('Missing required parameters: publisherId, trendData');
    }

    return this.retryOperation(
      async () => {
        const record = {
          publisher_id: publisherId,
          audit_id: auditId || null,
          trend_direction: trendData.direction || null,
          trend_magnitude: trendData.magnitude || 0,
          velocity: trendData.velocity?.velocity || 0,
          velocity_direction: trendData.velocity?.direction || null,
          deviation: trendData.deviation?.deviation || 0,
          zscore: trendData.deviation?.zscore || null,
          anomaly_detected: trendData.anomaly?.isAnomaly || false,
          anomaly_score: trendData.anomaly?.score || 0,
          anomaly_reasons: trendData.anomaly?.reasons || null,
          trend_score: trendData.trendScore || 0,
          statistics: trendData.statistics || null,
        };

        const { data, error } = await this.supabase
          .from('scorer_trend_analysis')
          .insert(record)
          .select();

        if (error) {
          throw new Error(`Trend analysis insert failed: ${error.message}`);
        }

        this.logger.info('Trend analysis data saved successfully', {
          id: data[0]?.id,
          publisherId,
          direction: trendData.direction,
        });

        return data[0];
      },
      'saveTrendAnalysisData',
      { publisherId, auditId }
    );
  }

  async saveBenchmarkComparison(publisherId, auditId, publisherGroup, comparisonData) {
    if (!publisherId || !comparisonData) {
      throw new Error('Missing required parameters: publisherId, comparisonData');
    }

    return this.retryOperation(
      async () => {
        const record = {
          publisher_id: publisherId,
          audit_id: auditId || null,
          publisher_group: publisherGroup || 'default',
          ctr_deviation: comparisonData.ctrDeviation || 0,
          ecpm_deviation: comparisonData.ecpmDeviation || 0,
          fill_rate_deviation: comparisonData.fillRateDeviation || 0,
          benchmark_data: comparisonData.benchmarks || null,
          current_metrics: comparisonData.currentMetrics || null,
          comparison_status: 'complete',
        };

        const { data, error } = await this.supabase
          .from('scorer_benchmark_comparisons')
          .insert(record)
          .select();

        if (error) {
          throw new Error(`Benchmark comparison insert failed: ${error.message}`);
        }

        this.logger.info('Benchmark comparison saved successfully', {
          id: data[0]?.id,
          publisherId,
          publisherGroup,
        });

        return data[0];
      },
      'saveBenchmarkComparison',
      { publisherId, auditId, publisherGroup }
    );
  }

  async saveComprehensiveScore(publisherId, auditId, comprehensiveScoreData) {
    if (!publisherId || !comprehensiveScoreData) {
      throw new Error('Missing required parameters: publisherId, comprehensiveScoreData');
    }

    return this.retryOperation(
      async () => {
        const results = {
          riskHistory: null,
          methodology: null,
          versionHistory: null,
          riskDelta: null,
          trendAnalysis: null,
          benchmarkComparison: null,
        };

        try {
          const riskHistoryResult = await this.saveOverallRiskScore(
            publisherId,
            auditId,
            {
              overallRiskScore: comprehensiveScoreData.riskScore,
              mfaProbability: comprehensiveScoreData.mfaProbability,
              weightedScore: comprehensiveScoreData.scores?.weightedScore,
              componentScores: comprehensiveScoreData.scores?.componentScores,
              confidenceScore: comprehensiveScoreData.explanation?.confidenceScore || 0,
              methodology: comprehensiveScoreData.methodology,
            }
          );
          results.riskHistory = riskHistoryResult?.data;

          if (results.riskHistory && comprehensiveScoreData.explanation) {
            const methodologyResult = await this.saveMethodologyDetails(
              publisherId,
              auditId,
              results.riskHistory.id,
              {
                method: comprehensiveScoreData.methodology,
                modelVersion: 'risk-probability-model-v1',
                summary: comprehensiveScoreData.explanation.summary,
                primaryReasons: comprehensiveScoreData.explanation.primaryReasons,
                contributingFactors: comprehensiveScoreData.explanation.contributingFactors,
                recommendations: comprehensiveScoreData.explanation.recommendations,
                riskLevel: comprehensiveScoreData.explanation.riskLevel,
                explanation: comprehensiveScoreData.explanation,
              }
            );
            results.methodology = methodologyResult?.data;
          }

          const versionResult = await this.saveRiskScoreVersion(
            publisherId,
            auditId,
            {
              riskScore: comprehensiveScoreData.riskScore,
              mfaProbability: comprehensiveScoreData.mfaProbability,
              riskLevel: comprehensiveScoreData.explanation?.riskLevel,
            }
          );
          results.versionHistory = versionResult?.data;

          const deltaResult = await this.calculateAndSaveRiskDelta(
            publisherId,
            auditId,
            comprehensiveScoreData.riskScore
          );
          results.riskDelta = deltaResult?.data;

          if (comprehensiveScoreData.trend) {
            const trendResult = await this.saveTrendAnalysisData(
              publisherId,
              auditId,
              comprehensiveScoreData.trend
            );
            results.trendAnalysis = trendResult?.data;
          }

          if (comprehensiveScoreData.benchmarks) {
            const benchmarkResult = await this.saveBenchmarkComparison(
              publisherId,
              auditId,
              comprehensiveScoreData.publisherGroup || 'default',
              {
                ctrDeviation: comprehensiveScoreData.benchmarks.ctrDeviation,
                ecpmDeviation: comprehensiveScoreData.benchmarks.ecpmDeviation,
                fillRateDeviation: comprehensiveScoreData.benchmarks.fillRateDeviation,
                benchmarks: comprehensiveScoreData.benchmarks.benchmarks,
                currentMetrics: {
                  ctr: comprehensiveScoreData.ctr,
                  ecpm: comprehensiveScoreData.ecpm,
                  fillRate: comprehensiveScoreData.fillRate,
                },
              }
            );
            results.benchmarkComparison = benchmarkResult?.data;
          }
        } catch (error) {
          this.logger.error('Error saving one or more components of comprehensive score', error, {
            publisherId,
            auditId,
          });
          throw error;
        }

        this.logger.info('Comprehensive score saved successfully', {
          publisherId,
          auditId,
          components: Object.keys(results).filter(k => results[k]),
        });

        return results;
      },
      'saveComprehensiveScore',
      { publisherId, auditId }
    );
  }

  async getLatestScore(publisherId) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const { data, error } = await this.supabase
          .from('scorer_risk_history')
          .select('*')
          .eq('publisher_id', publisherId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          throw new Error(`Latest score query failed: ${error.message}`);
        }

        this.logger.info('Latest score retrieved successfully', {
          found: !!data,
          publisherId,
        });

        return data;
      },
      'getLatestScore',
      { publisherId }
    );
  }

  async getScoreHistory(publisherId, limit = 30, offset = 0) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const { data, error } = await this.supabase
          .from('scorer_risk_history')
          .select('*')
          .eq('publisher_id', publisherId)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) {
          throw new Error(`Score history query failed: ${error.message}`);
        }

        this.logger.info('Score history retrieved successfully', {
          count: data?.length || 0,
          publisherId,
          limit,
        });

        return data || [];
      },
      'getScoreHistory',
      { publisherId, limit, offset }
    );
  }

  async getScoreTrend(publisherId, days = 30) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const { data, error } = await this.supabase
          .from('scorer_risk_history')
          .select('overall_risk_score, mfa_probability, created_at')
          .eq('publisher_id', publisherId)
          .gte('created_at', startDate.toISOString())
          .order('created_at', { ascending: true });

        if (error) {
          throw new Error(`Score trend query failed: ${error.message}`);
        }

        const trend = {
          dataPoints: data?.length || 0,
          scores: data?.map(d => d.overall_risk_score) || [],
          mfaProbabilities: data?.map(d => d.mfa_probability) || [],
          timestamps: data?.map(d => d.created_at) || [],
          average: data?.length > 0 ?
            data.reduce((sum, d) => sum + d.overall_risk_score, 0) / data.length : 0,
          min: data?.length > 0 ? Math.min(...data.map(d => d.overall_risk_score)) : 0,
          max: data?.length > 0 ? Math.max(...data.map(d => d.overall_risk_score)) : 0,
        };

        this.logger.info('Score trend calculated', { publisherId, days, dataPoints: trend.dataPoints });
        return trend;
      },
      'getScoreTrend',
      { publisherId, days }
    );
  }

  async getVersionHistory(publisherId, limit = 100) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const { data, error } = await this.supabase
          .from('scorer_version_history')
          .select('*')
          .eq('publisher_id', publisherId)
          .order('version_number', { ascending: false })
          .limit(limit);

        if (error) {
          throw new Error(`Version history query failed: ${error.message}`);
        }

        this.logger.info('Version history retrieved successfully', {
          count: data?.length || 0,
          publisherId,
        });

        return data || [];
      },
      'getVersionHistory',
      { publisherId, limit }
    );
  }

  async getRiskDeltaHistory(publisherId, limit = 50) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const { data, error } = await this.supabase
          .from('scorer_risk_deltas')
          .select('*')
          .eq('publisher_id', publisherId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) {
          throw new Error(`Risk delta history query failed: ${error.message}`);
        }

        this.logger.info('Risk delta history retrieved successfully', {
          count: data?.length || 0,
          publisherId,
        });

        return data || [];
      },
      'getRiskDeltaHistory',
      { publisherId, limit }
    );
  }

  async getTrendAnalysisHistory(publisherId, limit = 30) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const { data, error } = await this.supabase
          .from('scorer_trend_analysis')
          .select('*')
          .eq('publisher_id', publisherId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) {
          throw new Error(`Trend analysis history query failed: ${error.message}`);
        }

        this.logger.info('Trend analysis history retrieved successfully', {
          count: data?.length || 0,
          publisherId,
        });

        return data || [];
      },
      'getTrendAnalysisHistory',
      { publisherId, limit }
    );
  }

  async getBenchmarkComparisonHistory(publisherId, limit = 30) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const { data, error } = await this.supabase
          .from('scorer_benchmark_comparisons')
          .select('*')
          .eq('publisher_id', publisherId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) {
          throw new Error(`Benchmark comparison history query failed: ${error.message}`);
        }

        this.logger.info('Benchmark comparison history retrieved successfully', {
          count: data?.length || 0,
          publisherId,
        });

        return data || [];
      },
      'getBenchmarkComparisonHistory',
      { publisherId, limit }
    );
  }

  async getPublisherScoringSnapshot(publisherId) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const [latestScore, latestVersion, latestDelta, latestTrend, latestBenchmark] = await Promise.all([
          this.getLatestScore(publisherId),
          this.supabase
            .from('scorer_version_history')
            .select('*')
            .eq('publisher_id', publisherId)
            .order('version_number', { ascending: false })
            .limit(1)
            .maybeSingle(),
          this.supabase
            .from('scorer_risk_deltas')
            .select('*')
            .eq('publisher_id', publisherId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          this.supabase
            .from('scorer_trend_analysis')
            .select('*')
            .eq('publisher_id', publisherId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          this.supabase
            .from('scorer_benchmark_comparisons')
            .select('*')
            .eq('publisher_id', publisherId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        const snapshot = {
          latestRiskScore: latestScore?.data,
          versionHistory: latestVersion?.data,
          recentDelta: latestDelta?.data,
          currentTrend: latestTrend?.data,
          latestBenchmark: latestBenchmark?.data,
          timestamp: new Date().toISOString(),
        };

        this.logger.info('Publisher scoring snapshot retrieved successfully', {
          publisherId,
          hasLatestScore: !!snapshot.latestRiskScore,
        });

        return snapshot;
      },
      'getPublisherScoringSnapshot',
      { publisherId }
    );
  }

  async saveMultipleScores(publisherId, scoresArray) {
    if (!publisherId || !Array.isArray(scoresArray) || scoresArray.length === 0) {
      throw new Error('Missing required parameters: publisherId, non-empty scoresArray');
    }

    return this.retryOperation(
      async () => {
        const results = [];

        for (const scoreData of scoresArray) {
          try {
            const result = await this.saveOverallRiskScore(publisherId, scoreData.auditId, scoreData);
            results.push(result?.data);
          } catch (error) {
            this.logger.warn('Error saving individual score in batch', error, {
              publisherId,
              auditId: scoreData.auditId,
            });
          }
        }

        this.logger.info('Multiple scores saved successfully', {
          publisherId,
          saved: results.length,
          total: scoresArray.length,
        });

        return results;
      },
      'saveMultipleScores',
      { publisherId, count: scoresArray.length }
    );
  }

  async calculatePublisherTrendStatistics(publisherId, days = 90) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const { data: scores, error: scoresError } = await this.supabase
          .from('scorer_risk_history')
          .select('overall_risk_score, mfa_probability, created_at')
          .eq('publisher_id', publisherId)
          .gte('created_at', startDate.toISOString())
          .order('created_at', { ascending: true });

        if (scoresError) {
          throw new Error(`Score statistics query failed: ${scoresError.message}`);
        }

        if (!scores || scores.length === 0) {
          return {
            publisher_id: publisherId,
            days,
            dataPoints: 0,
            message: 'No data available for period',
          };
        }

        const riskScores = scores.map(s => s.overall_risk_score);
        const mfaScores = scores.map(s => s.mfa_probability);

        const calculateStats = (values) => {
          const sorted = [...values].sort((a, b) => a - b);
          const mean = values.reduce((a, b) => a + b, 0) / values.length;
          const median = sorted.length % 2 === 0
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)];
          const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
          const stdDev = Math.sqrt(variance);

          return {
            mean: Math.round(mean * 10000) / 10000,
            median: Math.round(median * 10000) / 10000,
            stdDev: Math.round(stdDev * 10000) / 10000,
            min: Math.min(...values),
            max: Math.max(...values),
            range: Math.max(...values) - Math.min(...values),
          };
        };

        const riskStats = calculateStats(riskScores);
        const mfaStats = calculateStats(mfaScores);

        const statistics = {
          publisher_id: publisherId,
          days,
          dataPoints: scores.length,
          riskScore: riskStats,
          mfaProbability: mfaStats,
          period: {
            start: startDate.toISOString(),
            end: new Date().toISOString(),
          },
        };

        this.logger.info('Publisher trend statistics calculated', {
          publisherId,
          days,
          dataPoints: scores.length,
        });

        return statistics;
      },
      'calculatePublisherTrendStatistics',
      { publisherId, days }
    );
  }
}

module.exports = ScorerDB;
