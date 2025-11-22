const { supabaseClient } = require('../../modules/supabase-client');

class TrendReporterDb {
    constructor() {
        this.client = supabaseClient;
    }

    /**
     * Fetch historical audit data for a publisher
     * @param {string} publisherId 
     * @param {Date} startDate 
     * @param {Date} endDate 
     * @returns {Promise<Array>} List of audits with metrics
     */
    async getHistoricalAudits(publisherId, startDate, endDate) {
        try {
            const { data, error } = await this.client
                .from('site_audits')
                .select(`
                    id,
                    created_at,
                    risk_score,
                    technical_health_score,
                    ad_density,
                    audit_status,
                    module_comparison_results (
                        comparison_data
                    )
                `)
                .eq('publisher_id', publisherId)
                .gte('created_at', startDate.toISOString())
                .lte('created_at', endDate.toISOString())
                .order('created_at', { ascending: true });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error(`[TrendReporterDb] Failed to fetch historical audits: ${error.message}`);
            throw error;
        }
    }

    /**
     * Fetch alert history for a publisher
     * @param {string} publisherId 
     * @param {Date} startDate 
     * @param {Date} endDate 
     * @returns {Promise<Array>} List of alerts
     */
    async getAlertHistory(publisherId, startDate, endDate) {
        try {
            const { data, error } = await this.client
                .from('publisher_trend_alerts')
                .select('*')
                .eq('publisher_id', publisherId)
                .gte('created_at', startDate.toISOString())
                .lte('created_at', endDate.toISOString())
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error(`[TrendReporterDb] Failed to fetch alert history: ${error.message}`);
            throw error;
        }
    }
}

module.exports = new TrendReporterDb();
