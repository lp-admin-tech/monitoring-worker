const supabaseIntegration = require('../../modules/supabase-client');
const { supabaseClient } = require('../../modules/supabase-client');

class AlertEngineDb {
    constructor() {
        this.client = supabaseClient;
    }

    /**
     * Fetch active alerts that haven't been notified yet
     * @param {number} limit 
     * @returns {Promise<Array>} List of alerts
     */
    async getPendingAlerts(limit = 50) {
        try {
            const { data, error } = await this.client
                .from('publisher_trend_alerts')
                .select(`
                    *,
                    publishers (
                        name,
                        primary_domain
                    )
                `)
                .eq('status', 'active')
                .is('notified_at', null)
                .order('created_at', { ascending: true })
                .limit(limit);

            if (error) throw error;
            return data;
        } catch (error) {
            console.error(`[AlertEngineDb] Failed to fetch pending alerts: ${error.message}`);
            throw error;
        }
    }

    /**
     * Fetch all admin user emails
     * @returns {Promise<Array<string>>} List of admin emails
     */
    async getAdminEmails() {
        try {
            const { data, error } = await this.client
                .from('app_users')
                .select('email')
                .in('role', ['admin', 'super_admin']);

            if (error) throw error;
            return data.map(user => user.email).filter(email => email);
        } catch (error) {
            console.error(`[AlertEngineDb] Failed to fetch admin emails: ${error.message}`);
            throw error;
        }
    }

    /**
     * Mark alerts as notified
     * @param {Array<string>} alertIds 
     * @returns {Promise<void>}
     */
    async markAlertsAsNotified(alertIds) {
        if (!alertIds || alertIds.length === 0) return;

        try {
            const { error } = await this.client
                .from('publisher_trend_alerts')
                .update({
                    status: 'notified',
                    notified_at: new Date().toISOString()
                })
                .in('id', alertIds);

            if (error) throw error;
        } catch (error) {
            console.error(`[AlertEngineDb] Failed to mark alerts as notified: ${error.message}`);
            throw error;
        }
    }

    /**
     * Log notification attempt
     * @param {Object} logData 
     */
    async logNotificationAttempt(logData) {
        // You might want a separate table for notification logs, 
        // or just rely on the worker logs. For now, we'll just log to console/file via logger
        // but if we had a table:
        /*
        await this.client.from('notification_logs').insert({
            alert_id: logData.alertId,
            status: logData.success ? 'success' : 'failure',
            error: logData.error,
            sent_at: new Date().toISOString()
        });
        */
    }
}

module.exports = new AlertEngineDb();
