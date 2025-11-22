const { supabaseClient } = require('../../modules/supabase-client');
const logger = require('../../modules/logger');

class RetentionAuditLogger {
    constructor() {
        this.client = supabaseClient;
    }

    /**
     * Log a data retention operation
     * @param {string} operationType - 'ARCHIVE' or 'DELETE'
     * @param {string} targetTable 
     * @param {number} recordsAffected 
     * @param {string} status - 'SUCCESS' or 'FAILURE'
     * @param {string} details 
     */
    async logOperation(operationType, targetTable, recordsAffected, status, details = '') {
        try {
            const { error } = await this.client
                .from('data_retention_policy_logs')
                .insert({
                    operation_type: operationType,
                    target_table: targetTable,
                    records_affected: recordsAffected,
                    status: status,
                    details: details,
                    executed_at: new Date().toISOString()
                });

            if (error) throw error;

            logger.info(`[Retention] ${operationType} on ${targetTable}: ${recordsAffected} records (${status})`);

        } catch (error) {
            logger.error(`[Retention] Failed to log operation`, error);
        }
    }
}

module.exports = new RetentionAuditLogger();
