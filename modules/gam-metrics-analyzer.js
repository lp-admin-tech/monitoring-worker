const logger = require('./logger');

class GAMMetricsAnalyzer {
  constructor(supabaseClient = null) {
    this.supabase = supabaseClient;
  }

  async fetchPublisherGAMData(publisherId, dateRange = null) {
    try {
      if (!this.supabase) {
        logger.warn('No Supabase client available for fetching GAM data');
        return null;
      }

      logger.info('Fetching GAM data for publisher', {
        publisherId,
        dateRange
      });

      let query = this.supabase
        .from('reports_dimensional')
        .select('*')
        .eq('publisher_id', publisherId)
        .order('date', { ascending: false })
        .limit(90);

      if (dateRange?.start && dateRange?.end) {
        const startDate = new Date(dateRange.start).toISOString().split('T')[0];
        const endDate = new Date(dateRange.end).toISOString().split('T')[0];
        query = query
          .gte('date', startDate)
          .lte('date', endDate);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Error fetching GAM data', error, { publisherId });
        return null;
      }

      logger.info('GAM data fetched successfully', {
        publisherId,
        recordCount: data?.length || 0
      });

      return data || [];
    } catch (error) {
      logger.error('Error in fetchPublisherGAMData', error);
      return null;
    }
  }

  calculateGAMMetrics(gamData = []) {
    try {
      if (!gamData || gamData.length === 0) {
        return this.getDefaultGAMMetrics();
      }

      logger.info('Calculating GAM metrics', { recordCount: gamData.length });

      const totalMetrics = gamData.reduce((acc, row) => ({
        adRequests: (acc.adRequests || 0) + (parseInt(row.ad_requests) || 0),
        impressions: (acc.impressions || 0) + (parseInt(row.impressions) || 0),
        clicks: (acc.clicks || 0) + (parseInt(row.clicks) || 0),
        revenue: (acc.revenue || 0) + (parseFloat(row.revenue) || 0),
      }), {});

      const ctr = totalMetrics.impressions > 0
        ? totalMetrics.clicks / totalMetrics.impressions
        : 0;

      const ecpm = totalMetrics.impressions > 0
        ? (totalMetrics.revenue / totalMetrics.impressions) * 1000
        : 0;

      const fillRate = totalMetrics.adRequests > 0
        ? totalMetrics.impressions / totalMetrics.adRequests
        : 0;

      return {
        adRequests: totalMetrics.adRequests,
        impressions: totalMetrics.impressions,
        clicks: totalMetrics.clicks,
        revenue: totalMetrics.revenue,
        ctr: Math.min(Math.max(ctr, 0), 1),
        ecpm: Math.max(ecpm, 0),
        fillRate: Math.min(Math.max(fillRate, 0), 1),
        dataPoints: gamData.length,
        dateRange: {
          start: gamData[gamData.length - 1]?.date,
          end: gamData[0]?.date
        }
      };
    } catch (error) {
      logger.error('Error calculating GAM metrics', error);
      return this.getDefaultGAMMetrics();
    }
  }

  compareGAMMetrics(currentMetrics, historicalMetrics = []) {
    try {
      if (!historicalMetrics || historicalMetrics.length === 0) {
        logger.info('No historical metrics available for comparison');
        return this.getDefaultGAMComparison();
      }

      logger.info('Comparing GAM metrics with historical data', {
        historicalPoints: historicalMetrics.length
      });

      const avgHistorical = {
        ctr: historicalMetrics.reduce((sum, m) => sum + (m.ctr || 0), 0) / historicalMetrics.length,
        ecpm: historicalMetrics.reduce((sum, m) => sum + (m.ecpm || 0), 0) / historicalMetrics.length,
        fillRate: historicalMetrics.reduce((sum, m) => sum + (m.fillRate || 0), 0) / historicalMetrics.length,
      };

      const stdDev = {
        ctr: this.calculateStdDev(historicalMetrics.map(m => m.ctr || 0)),
        ecpm: this.calculateStdDev(historicalMetrics.map(m => m.ecpm || 0)),
        fillRate: this.calculateStdDev(historicalMetrics.map(m => m.fillRate || 0)),
      };

      const ctrDeviation = stdDev.ctr > 0
        ? Math.abs(currentMetrics.ctr - avgHistorical.ctr) / stdDev.ctr
        : 0;

      const ecpmDeviation = stdDev.ecpm > 0
        ? Math.abs(currentMetrics.ecpm - avgHistorical.ecpm) / stdDev.ecpm
        : 0;

      const fillRateDeviation = stdDev.fillRate > 0
        ? Math.abs(currentMetrics.fillRate - avgHistorical.fillRate) / stdDev.fillRate
        : 0;

      return {
        currentMetrics,
        historicalAverage: avgHistorical,
        standardDeviation: stdDev,
        deviations: {
          ctrDeviation: Math.min(ctrDeviation, 1),
          ecpmDeviation: Math.min(ecpmDeviation, 1),
          fillRateDeviation: Math.min(fillRateDeviation, 1),
        },
        anomalies: {
          ctrAnomaly: ctrDeviation > 2,
          ecpmAnomaly: ecpmDeviation > 2,
          fillRateAnomaly: fillRateDeviation > 2,
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error comparing GAM metrics', error);
      return this.getDefaultGAMComparison();
    }
  }

  detectImpressionSpikes(gamData = []) {
    try {
      if (!gamData || gamData.length < 2) {
        return { spikeDetected: false, spikeRatio: 0 };
      }

      const impressions = gamData.map(d => parseInt(d.impressions) || 0);
      const avgImpressions = impressions.reduce((a, b) => a + b, 0) / impressions.length;
      const stdDev = this.calculateStdDev(impressions);

      const latestImpressions = impressions[0];
      const spikeRatio = stdDev > 0
        ? Math.abs(latestImpressions - avgImpressions) / stdDev
        : 0;

      const spikeDetected = spikeRatio > 2;

      logger.info('Impression spike detection', {
        spikeDetected,
        spikeRatio: Math.round(spikeRatio * 100) / 100,
        latest: latestImpressions,
        average: Math.round(avgImpressions)
      });

      return {
        spikeDetected,
        spikeRatio: Math.min(spikeRatio, 1),
        latestImpressions,
        averageImpressions: avgImpressions,
        standardDeviation: stdDev
      };
    } catch (error) {
      logger.error('Error detecting impression spikes', error);
      return { spikeDetected: false, spikeRatio: 0 };
    }
  }

  calculateStdDev(values) {
    if (!values || values.length === 0) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;

    return Math.sqrt(variance);
  }

  getDefaultGAMMetrics() {
    return {
      adRequests: 0,
      impressions: 0,
      clicks: 0,
      revenue: 0,
      ctr: 0,
      ecpm: 0,
      fillRate: 0,
      dataPoints: 0,
      dateRange: { start: null, end: null }
    };
  }

  getDefaultGAMComparison() {
    return {
      currentMetrics: this.getDefaultGAMMetrics(),
      historicalAverage: { ctr: 0, ecpm: 0, fillRate: 0 },
      standardDeviation: { ctr: 0, ecpm: 0, fillRate: 0 },
      deviations: {
        ctrDeviation: 0,
        ecpmDeviation: 0,
        fillRateDeviation: 0,
      },
      anomalies: {
        ctrAnomaly: false,
        ecpmAnomaly: false,
        fillRateAnomaly: false,
      },
      timestamp: new Date().toISOString()
    };
  }

  async enrichAuditDataWithGAM(auditData, publisherId) {
    try {
      logger.info('Enriching audit data with GAM metrics', { publisherId });

      const gamData = await this.fetchPublisherGAMData(publisherId, {
        start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        end: new Date()
      });

      if (!gamData || gamData.length === 0) {
        logger.warn('No GAM data available for publisher', { publisherId });
        return {
          ...auditData,
          gamMetrics: this.getDefaultGAMMetrics(),
          gamComparison: this.getDefaultGAMComparison()
        };
      }

      const currentMetrics = this.calculateGAMMetrics(gamData);
      const historicalMetrics = gamData.slice(1).map(row => this.calculateGAMMetrics([row]));
      const comparison = this.compareGAMMetrics(currentMetrics, historicalMetrics);
      const spikeAnalysis = this.detectImpressionSpikes(gamData);

      const enrichedData = {
        ...auditData,
        gamMetrics: currentMetrics,
        gamComparison: comparison,
        gamSpikeAnalysis: spikeAnalysis,
        ctr: currentMetrics.ctr,
        ecpm: currentMetrics.ecpm,
        fillRate: currentMetrics.fillRate,
        ctrDeviation: comparison.deviations.ctrDeviation,
        ecpmDeviation: comparison.deviations.ecpmDeviation,
        fillRateInconsistency: comparison.deviations.fillRateDeviation,
        impressionSpike: spikeAnalysis.spikeRatio
      };

      logger.info('Audit data enriched with GAM metrics', {
        publisherId,
        ctr: Math.round(currentMetrics.ctr * 10000) / 100,
        ecpm: Math.round(currentMetrics.ecpm * 100) / 100
      });

      return enrichedData;
    } catch (error) {
      logger.error('Error enriching audit data with GAM', error);
      return auditData;
    }
  }
}

module.exports = GAMMetricsAnalyzer;
