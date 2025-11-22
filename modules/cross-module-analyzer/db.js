const supabaseIntegration = require('../../modules/supabase-client');
const { supabaseClient } = require('../../modules/supabase-client');

class CrossModuleAnalyzerDb {
    constructor() {
        this.client = supabaseClient;
        this.integration = supabaseIntegration;
    }

    /**
     * Finds the previous completed audit for a given audit ID
     * @param {string} currentAuditId 
     * @returns {Promise<string|null>} ID of the previous audit or null
     */
    async getPreviousAuditId(currentAuditId) {
        try {
            const { data, error } = await this.client.rpc('get_previous_audit_id', {
                current_audit_id: currentAuditId
            });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error(`[CrossModuleAnalyzerDb] Failed to get previous audit ID: ${error.message}`);
            throw error;
        }
    }

    /**
     * Fetches full audit data for a given ID
     * @param {string} auditId 
     * @returns {Promise<Object>} Audit data including all module results
     */
    async getAuditData(auditId) {
        try {
            const { data, error } = await this.client
                .from('site_audits')
                .select('*')
                .eq('id', auditId)
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error(`[CrossModuleAnalyzerDb] Failed to fetch audit data for ${auditId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Saves comparison results
     * @param {Object} resultData 
     * @returns {Promise<Object>} Created record
     */
    async saveComparisonResults(resultData) {
        try {
            const { data, error } = await this.client
                .from('module_comparison_results')
                .insert({
                    current_audit_id: resultData.currentAuditId,
                    previous_audit_id: resultData.previousAuditId,
                    publisher_id: resultData.publisherId,
                    comparison_data: resultData.comparisonData
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error(`[CrossModuleAnalyzerDb] Failed to save comparison results: ${error.message}`);
            throw error;
        }
    }

    /**
     * Saves generated alerts
     * @param {Array<Object>} alerts 
     * @returns {Promise<Array>} Created alerts
     */
    async saveAlerts(alerts) {
        if (!alerts || alerts.length === 0) return [];

        try {
            const { data, error } = await this.client
                .from('publisher_trend_alerts')
                .insert(alerts.map(alert => ({
                    publisher_id: alert.publisherId,
                    alert_type: alert.type,
                    severity: alert.severity,
                    message: alert.message,
                    status: 'active',
                    metadata: alert.metadata || {}
                })))
                .select();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error(`[CrossModuleAnalyzerDb] Failed to save alerts: ${error.message}`);
            throw error;
        }
    }

    /**
     * Gets risk trajectory for a publisher
     * @param {string} publisherId 
     * @param {number} daysBack 
     * @returns {Promise<Array>} Risk scores over time
     */
    async getPublisherRiskTrajectory(publisherId, daysBack = 30) {
        try {
            const { data, error } = await this.client.rpc('calculate_publisher_risk_trajectory', {
                p_publisher_id: publisherId,
                days_back: daysBack
            });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error(`[CrossModuleAnalyzerDb] Failed to get risk trajectory: ${error.message}`);
            throw error;
        }
    }
}

module.exports = new CrossModuleAnalyzerDb();
