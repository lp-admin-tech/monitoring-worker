const logger = require('../logger');

class BenchmarksModule {
  constructor(supabaseClient = null) {
    this.supabase = supabaseClient;
  }

  async calculateBenchmarks(publisherGroup, metrics = [], supabaseClient = null) {
    try {
      const client = supabaseClient || this.supabase;

      if (!client) {
        logger.warn('No Supabase client provided for benchmark calculation');
        return this.getDefaultBenchmarks();
      }

      if (!metrics || metrics.length === 0) {
        logger.info('No metrics provided for benchmark calculation');
        return this.getDefaultBenchmarks();
      }

      const benchmarks = {
        ctr: this.calculateMedianPercentiles(metrics.map(m => m.ctr || 0)),
        ecpm: this.calculateMedianPercentiles(metrics.map(m => m.ecpm || 0)),
        fillRate: this.calculateMedianPercentiles(metrics.map(m => m.fillRate || 0)),
        impressions: this.calculateMedianPercentiles(metrics.map(m => m.impressions || 0)),
        clicks: this.calculateMedianPercentiles(metrics.map(m => m.clicks || 0))
      };

      await this.saveBenchmarks(client, publisherGroup, benchmarks);

      return benchmarks;
    } catch (error) {
      logger.error('Error calculating benchmarks', error);
      return this.getDefaultBenchmarks();
    }
  }

  calculateMedianPercentiles(values) {
    if (!values || values.length === 0) {
      return {
        median: 0,
        percentile_25: 0,
        percentile_75: 0,
        min: 0,
        max: 0,
        mean: 0,
        stdDev: 0
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;

    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];

    const q1Index = Math.ceil(n * 0.25) - 1;
    const percentile_25 = sorted[Math.max(0, q1Index)];

    const q3Index = Math.ceil(n * 0.75) - 1;
    const percentile_75 = sorted[Math.min(n - 1, q3Index)];

    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    return {
      median,
      percentile_25,
      percentile_75,
      min: sorted[0],
      max: sorted[n - 1],
      mean,
      stdDev,
      sampleCount: n
    };
  }

  async saveBenchmarks(supabaseClient, publisherGroup, benchmarks) {
    try {
      const metricsToSave = [
        { metric_type: 'ctr', data: benchmarks.ctr },
        { metric_type: 'ecpm', data: benchmarks.ecpm },
        { metric_type: 'fillRate', data: benchmarks.fillRate },
        { metric_type: 'impressions', data: benchmarks.impressions },
        { metric_type: 'clicks', data: benchmarks.clicks }
      ];

      for (const { metric_type, data } of metricsToSave) {
        const { error } = await supabaseClient
          .from('score_benchmarks')
          .upsert({
            publisher_group: publisherGroup,
            metric_type,
            median_value: data.median,
            percentile_25: data.percentile_25,
            percentile_75: data.percentile_75,
            sample_count: data.sampleCount || 0,
            data_points: {
              min: data.min,
              max: data.max,
              mean: data.mean,
              stdDev: data.stdDev
            },
            last_updated: new Date().toISOString()
          }, { onConflict: 'publisher_group,metric_type' });

        if (error) {
          logger.error(`Error saving benchmark for ${metric_type}`, error);
        }
      }

      logger.info(`Benchmarks saved for publisher group: ${publisherGroup}`);
    } catch (error) {
      logger.error('Error in saveBenchmarks', error);
    }
  }

  async retrieveBenchmarks(publisherGroup, supabaseClient = null) {
    try {
      const client = supabaseClient || this.supabase;

      if (!client) {
        logger.warn('No Supabase client provided for benchmark retrieval');
        return this.getDefaultBenchmarks();
      }

      const { data: benchmarks, error } = await client
        .from('score_benchmarks')
        .select('*')
        .eq('publisher_group', publisherGroup);

      if (error) {
        logger.error('Error retrieving benchmarks', error);
        return this.getDefaultBenchmarks();
      }

      if (!benchmarks || benchmarks.length === 0) {
        logger.info(`No benchmarks found for publisher group: ${publisherGroup}`);
        return this.getDefaultBenchmarks();
      }

      const result = {};
      for (const benchmark of benchmarks) {
        result[benchmark.metric_type] = {
          median: benchmark.median_value,
          percentile_25: benchmark.percentile_25,
          percentile_75: benchmark.percentile_75,
          sampleCount: benchmark.sample_count,
          dataPoints: benchmark.data_points,
          lastUpdated: benchmark.last_updated
        };
      }

      return result;
    } catch (error) {
      logger.error('Error retrieving benchmarks', error);
      return this.getDefaultBenchmarks();
    }
  }

  async calculatePublisherGroupStatistics(supabaseClient = null) {
    try {
      const client = supabaseClient || this.supabase;

      if (!client) {
        logger.warn('No Supabase client provided for group statistics');
        return {};
      }

      const { data: reports, error } = await client
        .from('reports_dimensional')
        .select('publisher_id, ctr, ecpm, fill_rate')
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) {
        logger.error('Error fetching reports for group statistics', error);
        return {};
      }

      if (!reports || reports.length === 0) {
        return {};
      }

      const groupedMetrics = {};
      for (const report of reports) {
        if (!groupedMetrics[report.publisher_id]) {
          groupedMetrics[report.publisher_id] = [];
        }
        groupedMetrics[report.publisher_id].push({
          ctr: report.ctr || 0,
          ecpm: report.ecpm || 0,
          fillRate: report.fill_rate || 0
        });
      }

      const groupStats = {};
      for (const [publisherId, metrics] of Object.entries(groupedMetrics)) {
        groupStats[publisherId] = {
          ctr: this.calculateMedianPercentiles(metrics.map(m => m.ctr)),
          ecpm: this.calculateMedianPercentiles(metrics.map(m => m.ecpm)),
          fillRate: this.calculateMedianPercentiles(metrics.map(m => m.fillRate)),
          metricsCount: metrics.length
        };
      }

      logger.info('Publisher group statistics calculated', { publisherCount: Object.keys(groupStats).length });
      return groupStats;
    } catch (error) {
      logger.error('Error calculating publisher group statistics', error);
      return {};
    }
  }

  compareToBenchmark(currentValue, benchmarkData) {
    if (!benchmarkData || !benchmarkData.median) {
      return {
        aboveMedian: false,
        deviation: 0,
        percentageDeviation: 0,
        percentile: 'unknown',
        isOutlier: false
      };
    }

    const deviation = currentValue - benchmarkData.median;
    const percentageDeviation = benchmarkData.median !== 0
      ? (deviation / benchmarkData.median) * 100
      : 0;

    let percentile = 'median';
    let isOutlier = false;

    if (currentValue < benchmarkData.percentile_25) {
      percentile = 'below_25th';
      isOutlier = currentValue < (benchmarkData.percentile_25 - (benchmarkData.percentile_75 - benchmarkData.percentile_25) * 1.5);
    } else if (currentValue > benchmarkData.percentile_75) {
      percentile = 'above_75th';
      isOutlier = currentValue > (benchmarkData.percentile_75 + (benchmarkData.percentile_75 - benchmarkData.percentile_25) * 1.5);
    }

    return {
      aboveMedian: currentValue > benchmarkData.median,
      deviation,
      percentageDeviation,
      percentile,
      isOutlier
    };
  }

  getDefaultBenchmarks() {
    return {
      ctr: {
        median: 0.02,
        percentile_25: 0.01,
        percentile_75: 0.03,
        mean: 0.022,
        stdDev: 0.015,
        sampleCount: 0
      },
      ecpm: {
        median: 8.5,
        percentile_25: 5.0,
        percentile_75: 12.0,
        mean: 8.8,
        stdDev: 4.2,
        sampleCount: 0
      },
      fillRate: {
        median: 0.85,
        percentile_25: 0.75,
        percentile_75: 0.95,
        mean: 0.84,
        stdDev: 0.12,
        sampleCount: 0
      },
      impressions: {
        median: 50000,
        percentile_25: 20000,
        percentile_75: 100000,
        mean: 60000,
        stdDev: 45000,
        sampleCount: 0
      },
      clicks: {
        median: 1000,
        percentile_25: 300,
        percentile_75: 2500,
        mean: 1250,
        stdDev: 950,
        sampleCount: 0
      }
    };
  }

  generateBenchmarkReport(publisherGroup, benchmarks, supabaseClient = null) {
    try {
      const report = {
        publisherGroup,
        benchmarks,
        generatedAt: new Date().toISOString(),
        summary: {
          metricsTracked: Object.keys(benchmarks).length,
          dataQuality: this.assessDataQuality(benchmarks)
        }
      };

      return report;
    } catch (error) {
      logger.error('Error generating benchmark report', error);
      return null;
    }
  }

  assessDataQuality(benchmarks) {
    const quality = {};

    for (const [metricType, data] of Object.entries(benchmarks)) {
      const sampleCount = data.sampleCount || 0;
      let dataQuality = 'low';

      if (sampleCount >= 100) dataQuality = 'excellent';
      else if (sampleCount >= 50) dataQuality = 'good';
      else if (sampleCount >= 20) dataQuality = 'fair';

      quality[metricType] = {
        quality: dataQuality,
        sampleCount,
        confidence: Math.min(sampleCount / 100, 1)
      };
    }

    return quality;
  }
}

module.exports = BenchmarksModule;
