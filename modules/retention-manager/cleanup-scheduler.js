const cron = require('node-cron');
const policies = require('./retention-policy');
const archiveManager = require('./archive-manager');
const logger = require('../../modules/logger');

class CleanupScheduler {
    /**
     * Initialize the cleanup scheduler
     * Runs daily at 3 AM
     */
    init() {
        logger.info('[CleanupScheduler] Initializing retention policy scheduler (Daily at 03:00)');

        // Schedule task for 03:00 AM every day
        cron.schedule('0 3 * * *', async () => {
            await this.runCleanupJob();
        });
    }

    /**
     * Execute the cleanup job manually or via schedule
     */
    async runCleanupJob() {
        const jobId = `CLEANUP-${Date.now()}`;
        logger.info(`[${jobId}] Starting daily data cleanup job`);

        try {
            const now = new Date();

            // 1. Clean Raw Audit Data
            const auditCutoff = new Date(now);
            auditCutoff.setDate(auditCutoff.getDate() - policies.RAW_AUDIT_DATA.days);
            await archiveManager.cleanupTable('site_audits', auditCutoff);

            // 2. Clean Alerts
            const alertCutoff = new Date(now);
            alertCutoff.setDate(alertCutoff.getDate() - policies.ALERTS.days);
            await archiveManager.cleanupTable('publisher_trend_alerts', alertCutoff);

            // 3. Clean Logs
            const logCutoff = new Date(now);
            logCutoff.setDate(logCutoff.getDate() - policies.LOGS.days);
            await archiveManager.cleanupTable('data_retention_policy_logs', logCutoff, 'executed_at');
            // Note: We might want to clean worker logs too if stored in DB

            logger.info(`[${jobId}] Cleanup job completed successfully`);

        } catch (error) {
            logger.error(`[${jobId}] Cleanup job failed`, error);
        }
    }
}

module.exports = new CleanupScheduler();
