const { supabaseClient } = require('../../modules/supabase-client');
const logger = require('../../modules/logger');
const auditLogger = require('./audit-logger');

class ArchiveManager {
    constructor() {
        this.client = supabaseClient;
    }

    /**
     * Delete records older than the cutoff date
     * @param {string} tableName 
     * @param {Date} cutoffDate 
     * @param {string} dateColumn 
     * @returns {Promise<number>} Number of records deleted
     */
    async cleanupTable(tableName, cutoffDate, dateColumn = 'created_at') {
        try {
            // Supabase delete doesn't return count by default unless we select count
            // But we can't easily get count of deleted rows in one go with JS client without a stored proc usually
            // We'll select count first then delete

            const { count, error: countError } = await this.client
                .from(tableName)
                .select('*', { count: 'exact', head: true })
                .lt(dateColumn, cutoffDate.toISOString());

            if (countError) throw countError;

            if (count === 0) return 0;

            const { error: deleteError } = await this.client
                .from(tableName)
                .delete()
                .lt(dateColumn, cutoffDate.toISOString());

            if (deleteError) throw deleteError;

            await auditLogger.logOperation('DELETE', tableName, count, 'SUCCESS');
            return count;

        } catch (error) {
            await auditLogger.logOperation('DELETE', tableName, 0, 'FAILURE', error.message);
            throw error;
        }
    }
}

module.exports = new ArchiveManager();
