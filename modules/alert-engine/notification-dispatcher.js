const { supabaseClient } = require('../../modules/supabase-client');
const logger = require('../../modules/logger');

class NotificationDispatcher {
    constructor() {
        this.client = supabaseClient;
    }

    /**
     * Dispatch an alert notification via Supabase Edge Function
     * @param {Object} alert - The alert object
     * @param {Object} publisher - The publisher details
     * @param {string} adminEmail - The admin email to send to
     * @returns {Promise<Object>} Result of the dispatch
     */
    async dispatchEmail(alert, publisher, adminEmail) {
        const requestId = `NOTIF-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        try {
            logger.info(`[${requestId}] Dispatching email for alert ${alert.id} to ${adminEmail}`);

            if (!adminEmail) {
                throw new Error('Admin email is required');
            }

            const { data, error } = await this.client.functions.invoke('send-alert-email', {
                body: {
                    alertId: alert.id,
                    publisherName: publisher.name,
                    publisherDomain: publisher.primary_domain,
                    recipientEmail: adminEmail,
                    alertType: alert.alert_type,
                    severity: alert.severity,
                    message: alert.message,
                    metadata: alert.metadata,
                    timestamp: alert.created_at
                }
            });

            if (error) throw error;

            logger.info(`[${requestId}] Email dispatched successfully`);
            return { success: true, data };

        } catch (error) {
            logger.error(`[${requestId}] Failed to dispatch email`, error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new NotificationDispatcher();
