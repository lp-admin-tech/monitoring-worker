const db = require('./db');
const dispatcher = require('./notification-dispatcher');
const logger = require('../../modules/logger');

class AlertManager {
    /**
     * Process all pending alerts and send notifications
     */
    async processPendingAlerts() {
        const requestId = `ALERT-PROC-${Date.now()}`;
        logger.info(`[${requestId}] Starting alert processing`);

        try {
            // 1. Fetch pending alerts
            const alerts = await db.getPendingAlerts();

            if (alerts.length === 0) {
                logger.info(`[${requestId}] No pending alerts found`);
                return { processed: 0, success: 0, failed: 0 };
            }

            logger.info(`[${requestId}] Found ${alerts.length} pending alerts`);

            // 2. Fetch all admin emails
            const adminEmails = await db.getAdminEmails();

            if (adminEmails.length === 0) {
                logger.warn(`[${requestId}] No admin emails found. Skipping notifications.`);
                return { processed: alerts.length, success: 0, failed: alerts.length };
            }

            logger.info(`[${requestId}] Sending alerts to ${adminEmails.length} admin(s)`);

            let successCount = 0;
            let failedCount = 0;
            const successfulAlertIds = [];

            // 3. Dispatch notifications to all admins for each alert
            for (const alert of alerts) {
                const publisher = alert.publishers;

                if (!publisher) {
                    logger.warn(`[${requestId}] Alert ${alert.id} has no associated publisher data`);
                    failedCount++;
                    continue;
                }

                // Send to all admins
                let alertSuccess = true;
                for (const adminEmail of adminEmails) {
                    const result = await dispatcher.dispatchEmail(alert, publisher, adminEmail);
                    if (!result.success) {
                        alertSuccess = false;
                        logger.error(`[${requestId}] Failed to send alert ${alert.id} to ${adminEmail}`);
                    }
                }

                if (alertSuccess) {
                    successCount++;
                    successfulAlertIds.push(alert.id);
                } else {
                    failedCount++;
                }
            }

            // 4. Update status for successful notifications
            if (successfulAlertIds.length > 0) {
                await db.markAlertsAsNotified(successfulAlertIds);
                logger.info(`[${requestId}] Marked ${successfulAlertIds.length} alerts as notified`);
            }

            return {
                processed: alerts.length,
                success: successCount,
                failed: failedCount
            };

        } catch (error) {
            logger.error(`[${requestId}] Alert processing failed`, error);
            throw error;
        }
    }
}

module.exports = new AlertManager();
