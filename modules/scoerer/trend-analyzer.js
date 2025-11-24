const logger = require('../logger');

class TrendAnalyzer {
  constructor(weights = {}, supabaseClient = null) {
    this.weights = weights.trendAnalysis || {};
    this.supabase = supabaseClient;
  }

  async analyzeRiskTrend(publisherId, currentScore, historicalScores = []) {
    try {
      const stats = this.calculateTrendStatistics(historicalScores, currentScore);

      const trend = this.detectTrend(historicalScores, currentScore);

      const velocity = this.calculateVelocity(historicalScores, currentScore);

      const deviation = this.calculateDeviation(historicalScores, currentScore);

      const anomalyDetection = this.detectAnomalies(historicalScores, currentScore);

      const recencyScore = this.calculateRecencyWeight(historicalScores);

      const trendScore = this.calculateTrendScore(velocity, deviation, anomalyDetection, recencyScore);

      return {
        currentScore,
        previousScore: historicalScores.length > 0 ? historicalScores[historicalScores.length - 1].score : null,
        trend: trend.direction,
        trendMagnitude: trend.magnitude,
        velocity,
        deviation,
        anomalyDetection,
        trendScore,
        statistics: stats,
        recencyWeight: recencyScore,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error analyzing risk trend', error);
      throw error;
    }
  }

  calculateTrendStatistics(historicalScores, currentScore) {
    if (!historicalScores || historicalScores.length === 0) {
      return {
        mean: currentScore,
        median: currentScore,
        stdDev: 0,
        min: currentScore,
        max: currentScore,
        dataPoints: 1
      };
    }

    const scores = historicalScores.map(h => h.score || h).concat([currentScore]);

    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

    const sorted = [...scores].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    return {
      mean,
      median,
      stdDev,
      min: Math.min(...scores),
      max: Math.max(...scores),
      dataPoints: scores.length
    };
  }

  detectTrend(historicalScores, currentScore) {
    if (!historicalScores || historicalScores.length < 2) {
      return { direction: 'insufficient_data', magnitude: 0 };
    }

    const recent = historicalScores.slice(-5).map(h => h.score || h);
    recent.push(currentScore);

    const windowSize = Math.min(3, recent.length);
    const oldAvg = recent.slice(0, windowSize).reduce((a, b) => a + b, 0) / windowSize;
    const newAvg = recent.slice(-windowSize).reduce((a, b) => a + b, 0) / windowSize;

    const change = newAvg - oldAvg;
    const magnitude = Math.abs(change);

    let direction = 'stable';
    if (change > 0.1) direction = 'increasing';
    else if (change < -0.1) direction = 'decreasing';

    return { direction, magnitude, change };
  }

  calculateVelocity(historicalScores, currentScore) {
    if (!historicalScores || historicalScores.length === 0) {
      return { velocity: 0, timeWindow: 0, rateOfChange: 0 };
    }

    const lastScore = historicalScores[historicalScores.length - 1];
    const scoreDifference = currentScore - (lastScore.score || lastScore);

    const lastTimestamp = lastScore.timestamp || lastScore.recorded_at;
    const timeWindow = lastTimestamp
      ? Math.floor((Date.now() - new Date(lastTimestamp).getTime()) / (1000 * 60 * 60 * 24))
      : 1;

    const velocity = timeWindow > 0 ? scoreDifference / timeWindow : 0;

    return {
      velocity: Math.min(Math.abs(velocity), 1),
      direction: velocity > 0 ? 'accelerating' : 'decelerating',
      scoreChange: scoreDifference,
      timeWindowDays: timeWindow,
      rateOfChange: Math.abs(velocity)
    };
  }

  calculateDeviation(historicalScores, currentScore) {
    if (!historicalScores || historicalScores.length === 0) {
      return { deviation: 0, zscore: 0, percentageChange: 0 };
    }

    const stats = this.calculateTrendStatistics(historicalScores, null);
    const scores = historicalScores.map(h => h.score || h);

    if (stats.stdDev === 0) {
      return {
        deviation: Math.abs(currentScore - stats.mean),
        zscore: currentScore === stats.mean ? 0 : Infinity,
        percentageChange: 0,
        mean: stats.mean
      };
    }

    const zscore = (currentScore - stats.mean) / stats.stdDev;
    const deviation = Math.abs(currentScore - stats.mean);
    const previousScore = scores[scores.length - 1] || stats.mean;
    const percentageChange = previousScore !== 0
      ? Math.abs((currentScore - previousScore) / previousScore)
      : 0;

    return {
      deviation: Math.min(deviation, 1),
      zscore,
      percentageChange,
      mean: stats.mean,
      stdDev: stats.stdDev
    };
  }

  detectAnomalies(historicalScores, currentScore) {
    if (!historicalScores || historicalScores.length < 3) {
      return { isAnomaly: false, score: 0, reasons: [] };
    }

    const reasons = [];
    let anomalyScore = 0;

    const stats = this.calculateTrendStatistics(historicalScores, null);

    if (stats.stdDev > 0) {
      const zscore = (currentScore - stats.mean) / stats.stdDev;
      if (Math.abs(zscore) > 2.5) {
        anomalyScore += 0.4;
        reasons.push('extreme_statistical_outlier');
      } else if (Math.abs(zscore) > 2) {
        anomalyScore += 0.2;
        reasons.push('statistical_outlier');
      }
    }

    const scores = historicalScores.map(h => h.score || h);
    const maxPreviousChange = this.calculateMaxConsecutiveChange(scores);
    const currentChange = Math.abs(currentScore - scores[scores.length - 1]);

    if (currentChange > maxPreviousChange * 2) {
      anomalyScore += 0.3;
      reasons.push('excessive_change_rate');
    }

    if (currentScore > stats.max) {
      anomalyScore += 0.15;
      reasons.push('new_maximum_score');
    }

    if (scores.every(s => s < currentScore * 0.5)) {
      anomalyScore += 0.15;
      reasons.push('sudden_spike_from_baseline');
    }

    const isAnomaly = anomalyScore > 0.5;

    return {
      isAnomaly,
      score: Math.min(anomalyScore, 1),
      reasons,
      statistics: {
        mean: stats.mean,
        stdDev: stats.stdDev,
        maxPreviousChange
      }
    };
  }

  calculateMaxConsecutiveChange(scores) {
    if (!scores || scores.length < 2) return 0;

    let maxChange = 0;
    for (let i = 1; i < scores.length; i++) {
      const change = Math.abs(scores[i] - scores[i - 1]);
      maxChange = Math.max(maxChange, change);
    }

    return maxChange;
  }

  calculateRecencyWeight(historicalScores) {
    if (!historicalScores || historicalScores.length === 0) {
      return 1.0;
    }

    const lastScore = historicalScores[historicalScores.length - 1];
    const lastTimestamp = lastScore.timestamp || lastScore.recorded_at;

    if (!lastTimestamp) return 1.0;

    const daysSinceLastScore = Math.floor(
      (Date.now() - new Date(lastTimestamp).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceLastScore <= 7) return 1.0;
    if (daysSinceLastScore <= 14) return 0.9;
    if (daysSinceLastScore <= 30) return 0.75;
    if (daysSinceLastScore <= 90) return 0.5;
    return 0.25;
  }

  calculateTrendScore(velocity, deviation, anomalyDetection, recencyScore) {
    const velocityComponent = (velocity.rateOfChange || 0) * (this.weights.velocityWeight || 0.30);
    const deviationComponent = (deviation.deviation || 0) * (this.weights.deviationWeight || 0.25);
    const anomalyComponent = (anomalyDetection.score || 0) * (this.weights.anomalyWeight || 0.25);
    const recencyComponent = (1 - recencyScore) * (this.weights.recencyWeight || 0.20);

    const rawScore = velocityComponent + deviationComponent + anomalyComponent + recencyComponent;

    return Math.min(rawScore, 1);
  }

  async compareWithBenchmarks(publisherGroup, metrics = {}, supabaseClient = null) {
    try {
      const client = supabaseClient || this.supabase;

      if (!client) {
        logger.warn('No Supabase client provided for benchmark comparison');
        return {
          ctrDeviation: 0,
          ecpmDeviation: 0,
          fillRateDeviation: 0,
          benchmarks: null
        };
      }

      const { data: benchmarks, error } = await client
        .from('score_benchmarks')
        .select('*')
        .eq('publisher_group', publisherGroup);

      if (error) {
        logger.error('Error fetching benchmarks', error);
        return {
          ctrDeviation: 0,
          ecpmDeviation: 0,
          fillRateDeviation: 0,
          benchmarks: null
        };
      }

      if (!benchmarks || benchmarks.length === 0) {
        logger.info(`No benchmarks found for publisher group: ${publisherGroup}`);
        return {
          ctrDeviation: 0,
          ecpmDeviation: 0,
          fillRateDeviation: 0,
          benchmarks: null
        };
      }

      const deviations = {
        ctrDeviation: 0,
        ecpmDeviation: 0,
        fillRateDeviation: 0,
        benchmarks: {}
      };

      for (const benchmark of benchmarks) {
        const metricType = benchmark.metric_type;
        const medianValue = benchmark.median_value || 0;
        const currentValue = metrics[metricType] || 0;

        if (medianValue > 0) {
          const deviation = Math.abs((currentValue - medianValue) / medianValue);
          deviations[`${metricType}Deviation`] = Math.min(deviation, 1);
        }

        deviations.benchmarks[metricType] = {
          median: medianValue,
          percentile_25: benchmark.percentile_25,
          percentile_75: benchmark.percentile_75,
          current: currentValue
        };
      }

      return deviations;
    } catch (error) {
      logger.error('Error comparing with benchmarks', error);
      return {
        ctrDeviation: 0,
        ecpmDeviation: 0,
        fillRateDeviation: 0,
        benchmarks: null
      };
    }
  }

  async detectPatternDrift(publisherId, supabaseClient = null) {
    try {
      const client = supabaseClient || this.supabase;

      if (!client) {
        logger.warn('No Supabase client provided for pattern drift detection');
        return { driftDetected: false, severity: 'none', patterns: [] };
      }

      if (!publisherId) {
        logger.warn('No publisher ID provided for pattern drift detection', {
          reason: 'no_publisher_id',
          source: 'detectPatternDrift',
          context: 'Pattern drift analysis skipped - publisher ID required for historical comparison'
        });
        return { driftDetected: false, severity: 'none', patterns: [], reason: 'no_publisher_id' };
      }

      // Query site_audits instead of publisher_risk_trends (which was dropped)
      const { data: recentAudits, error } = await client
        .from('site_audits')
        .select('id, mfa_probability, risk_score, created_at, updated_at')
        .eq('publisher_id', publisherId)
        .eq('status', 'completed')
        .order('updated_at', { ascending: false })
        .limit(20);

      if (error) {
        logger.error('Error fetching recent audits for drift detection', error);
        return { driftDetected: false, severity: 'none', patterns: [] };
      }

      if (!recentAudits || recentAudits.length < 5) {
        return { driftDetected: false, severity: 'none', patterns: [], reason: 'insufficient_history' };
      }

      const patterns = [];
      const driftIndicators = [];

      // Analyze MFA probability trends
      const riskScores = recentAudits.map(t => t.mfa_probability || t.risk_score || 0);
      const riskStats = this.calculateTrendStatistics(riskScores.slice(0, -1), riskScores[riskScores.length - 1]);

      if (riskStats.stdDev > 0.3) {
        driftIndicators.push('high_risk_volatility');
      }

      // Note: Since we don't have benchmark comparison data in site_audits,
      // we'll skip CTR/eCPM drift detection for now
      // This can be added back if we store GAM metrics in site_audits

      const anomalyCount = 0; // Can't detect anomalies without is_anomaly flag

      const driftDetected = driftIndicators.length > 0;
      const severity = driftIndicators.length >= 3 ? 'critical' : driftIndicators.length >= 2 ? 'high' : 'medium';

      return {
        driftDetected,
        severity: driftDetected ? severity : 'none',
        indicators: driftIndicators,
        patterns,
        dataPoints: recentAudits.length,
        timeRange: {
          start: recentAudits[recentAudits.length - 1].updated_at,
          end: recentAudits[0].updated_at
        },
        note: 'Using site_audits for drift detection - some metrics unavailable without dedicated trend table'
      };
    } catch (error) {
      logger.error('Error detecting pattern drift', error);
      return { driftDetected: false, severity: 'none', patterns: [] };
    }
  }
}

module.exports = TrendAnalyzer;
