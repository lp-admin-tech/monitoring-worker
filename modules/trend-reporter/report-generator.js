const db = require('./db');
const aggregator = require('./historical-aggregator');
const formatter = require('./export-formatter');
const logger = require('../../modules/logger');

class ReportGenerator {
    /**
     * Generate a trend report for a publisher
     * @param {string} publisherId 
     * @param {number} daysBack 
     * @param {string} format 'json' or 'csv'
     * @returns {Promise<Object>} Report data and content
     */
    async generateReport(publisherId, daysBack = 30, format = 'json') {
        const requestId = `REP-${Date.now()}`;
        logger.info(`[${requestId}] Generating ${format.toUpperCase()} report for publisher ${publisherId} (${daysBack} days)`);

        try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - daysBack);

            // 1. Fetch Data
            const audits = await db.getHistoricalAudits(publisherId, startDate, endDate);
            const alerts = await db.getAlertHistory(publisherId, startDate, endDate);

            if (audits.length === 0) {
                logger.warn(`[${requestId}] No data found for report`);
                return {
                    success: false,
                    message: 'No data found for the specified period'
                };
            }

            // 2. Aggregate Data
            const aggregatedStats = aggregator.aggregate(audits);

            // Add alert summary
            aggregatedStats.alerts = {
                total: alerts.length,
                breakdown: this.groupAlerts(alerts)
            };

            // 3. Format Output
            let content;
            let contentType;
            let filename;

            if (format === 'csv') {
                content = formatter.formatCSV(aggregatedStats, audits);
                contentType = 'text/csv';
                filename = `report_${publisherId}_${endDate.toISOString().split('T')[0]}.csv`;
            } else {
                content = formatter.formatJSON({ stats: aggregatedStats, rawData: audits, alerts });
                contentType = 'application/json';
                filename = `report_${publisherId}_${endDate.toISOString().split('T')[0]}.json`;
            }

            logger.info(`[${requestId}] Report generated successfully`);

            return {
                success: true,
                filename,
                contentType,
                content,
                stats: aggregatedStats
            };

        } catch (error) {
            logger.error(`[${requestId}] Report generation failed`, error);
            throw error;
        }
    }

    groupAlerts(alerts) {
        const groups = {};
        alerts.forEach(a => {
            groups[a.alert_type] = (groups[a.alert_type] || 0) + 1;
        });
        return groups;
    }
}

module.exports = new ReportGenerator();
