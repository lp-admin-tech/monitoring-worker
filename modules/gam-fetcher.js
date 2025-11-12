const supabase = require('./supabase-client');
const logger = require('./logger');
const { envConfig } = require('./env-config');

class GAMFetcher {
  constructor() {
    this.apiKey = envConfig.gam.apiKey;
    this.accountId = envConfig.gam.accountId;
    this.apiBaseUrl = 'https://admanager.googleapis.com/v1';
  }

  async fetchGAMReportsData(dimensions = ['PUBLISHER_ID', 'DATE'], metrics = ['AD_REQUESTS', 'AD_IMPRESSIONS', 'AD_CLICKS', 'TOTAL_LINE_ITEM_LEVEL_IMPRESSIONS_SOLD', 'TOTAL_LINE_ITEM_LEVEL_REVENUE'], dateRange) {
    try {
      if (!this.apiKey || !this.accountId) {
        logger.warn('GAM credentials not configured, returning empty data');
        return [];
      }

      logger.info('Fetching GAM reports data via API', {
        accountId: this.accountId,
        dimensions: dimensions.length,
        metrics: metrics.length,
        dateRange
      });

      const reportQuery = {
        dimensions,
        metrics,
        dateRangeFilter: dateRange ? {
          startDate: this.formatDate(new Date(dateRange.start)),
          endDate: this.formatDate(new Date(dateRange.end))
        } : undefined
      };

      const response = await fetch(`${this.apiBaseUrl}/networks/${this.accountId}/reports/run`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reportQuery)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        logger.error('GAM API error', {
          status: response.status,
          error: errorData
        });
        return [];
      }

      const data = await response.json();
      logger.info('GAM data fetched successfully', {
        rows: data?.rows?.length || 0
      });

      return data?.rows || [];
    } catch (error) {
      logger.error('Error fetching GAM reports data', error);
      return [];
    }
  }

  async fetchNewPublishersData(limit = 100) {
    try {
      logger.info('Fetching data for new publishers from GAM API');

      const newPublishers = await supabase.query('publishers', {
        metrics_updated_at: null,
      });

      if (!newPublishers || newPublishers.length === 0) {
        logger.info('No new publishers found');
        return [];
      }

      const publisherIds = newPublishers.slice(0, limit).map(p => p.id);
      logger.info(`Found ${publisherIds.length} new publishers to fetch`);

      const gamData = await this.fetchGAMReportsData(
        ['PUBLISHER_ID', 'DATE'],
        ['AD_REQUESTS', 'AD_IMPRESSIONS', 'AD_CLICKS', 'TOTAL_LINE_ITEM_LEVEL_REVENUE'],
        null
      );

      const filteredData = gamData.filter(row => publisherIds.includes(row.dimensionValues?.[0]?.value));

      logger.info(`Retrieved ${filteredData.length} records for new publishers`, {
        publisherCount: publisherIds.length,
        recordsCount: filteredData.length
      });

      if (filteredData.length > 0) {
        await this.storeReportData(filteredData, 'report_historical');
      }

      return filteredData;
    } catch (error) {
      logger.error('Error fetching new publishers data', error);
      throw error;
    }
  }

  async fetchExistingPublishersData(dateRange) {
    try {
      logger.info('Fetching data for existing publishers from GAM API', { dateRange });

      const existingPublishers = await supabase.query('publishers');

      if (!existingPublishers || existingPublishers.length === 0) {
        logger.info('No existing publishers found');
        return [];
      }

      const publisherIds = existingPublishers.map(p => p.id);
      logger.info(`Found ${publisherIds.length} existing publishers to fetch`);

      const gamData = await this.fetchGAMReportsData(
        ['PUBLISHER_ID', 'DATE'],
        ['AD_REQUESTS', 'AD_IMPRESSIONS', 'AD_CLICKS', 'TOTAL_LINE_ITEM_LEVEL_REVENUE'],
        dateRange
      );

      const filteredData = gamData.filter(row => publisherIds.includes(row.dimensionValues?.[0]?.value));

      logger.info(`Retrieved ${filteredData.length} records for existing publishers`, {
        publisherCount: publisherIds.length,
        recordsCount: filteredData.length
      });

      if (filteredData.length > 0) {
        await this.storeReportData(filteredData, 'reports_dimensional');
      }

      return filteredData;
    } catch (error) {
      logger.error('Error fetching existing publishers data', error);
      throw error;
    }
  }

  formatDate(date) {
    return date.toISOString().split('T')[0];
  }

  async storeReportData(data, table) {
    try {
      if (data.length === 0) return;

      const formattedData = data.map(row => ({
        publisher_id: row.dimensionValues?.[0]?.value,
        date: row.dimensionValues?.[1]?.value,
        ad_requests: parseInt(row.metricValues?.[0]?.value || 0),
        impressions: parseInt(row.metricValues?.[1]?.value || 0),
        clicks: parseInt(row.metricValues?.[2]?.value || 0),
        revenue: parseFloat(row.metricValues?.[3]?.value || 0),
        created_at: new Date().toISOString()
      }));

      await supabase.batchInsert(table, formattedData);
      logger.info(`Stored ${formattedData.length} records in ${table}`);
    } catch (error) {
      logger.error(`Error storing report data in ${table}`, error);
    }
  }

  processGAMData(data) {
    try {
      logger.info('Processing GAM data', { recordCount: data.length });

      const aggregated = {};

      for (const record of data) {
        const key = record.publisher_id;
        if (!aggregated[key]) {
          aggregated[key] = { ...record };
        } else {
          aggregated[key].revenue = (aggregated[key].revenue || 0) + (record.revenue || 0);
          aggregated[key].impressions = (aggregated[key].impressions || 0) + (record.impressions || 0);
          aggregated[key].clicks = (aggregated[key].clicks || 0) + (record.clicks || 0);
        }
      }

      return Object.values(aggregated);
    } catch (error) {
      logger.error('Error processing GAM data', error);
      throw error;
    }
  }

  async updatePublisherMetrics(publisherId, metrics) {
    try {
      await supabase.update('publishers', publisherId, {
        last_revenue: metrics.revenue,
        last_ecpm: metrics.ecpm,
        last_ctr: metrics.ctr,
        last_fill_rate: metrics.fillRate,
        metrics_updated_at: new Date().toISOString(),
      });

      logger.debug(`Updated metrics for publisher ${publisherId}`, { metrics });
    } catch (error) {
      logger.error(`Error updating metrics for publisher ${publisherId}`, error);
      throw error;
    }
  }
}

module.exports = new GAMFetcher();
