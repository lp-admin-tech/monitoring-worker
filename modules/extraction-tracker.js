/**
 * Extraction Tracker Module
 * Tracks content extraction failures and flags publishers with high failure rates
 */

const logger = require('./logger');

class ExtractionTracker {
    constructor(supabaseClient) {
        this.supabase = supabaseClient;
    }

    /**
     * Track extraction failures for publisher flagging
     * @param {string} publisherId - Publisher UUID
     * @param {string} domain - Site domain
     * @param {string} siteAuditId - Site audit UUID
     * @param {string} reason - Failure reason
     * @param {Array} attempts - Extraction attempts details
     */
    async trackFailure(publisherId, domain, siteAuditId, reason, attempts = []) {
        try {
            await this.supabase.from('extraction_failures').insert({
                publisher_id: publisherId,
                domain,
                site_audit_id: siteAuditId,
                failure_reason: reason,
                extraction_attempts: attempts,
                created_at: new Date().toISOString()
            });
            logger.info(`[ExtractionTracker] Recorded extraction failure for ${domain}`, { publisherId, reason });
        } catch (err) {
            // Non-fatal - just log the error
            logger.warn(`[ExtractionTracker] Failed to track extraction failure`, { error: err.message });
        }
    }

    /**
     * Check publisher extraction health and flag if >50% failure rate
     * @param {string} publisherId - Publisher UUID
     */
    async checkPublisherHealth(publisherId) {
        try {
            const { data, error } = await this.supabase.rpc('get_extraction_failure_rate', {
                p_publisher_id: publisherId,
                p_days: 7
            });

            if (error) {
                logger.warn(`[ExtractionTracker] Could not check extraction health`, { error: error.message });
                return null;
            }

            const failureRate = data?.failure_rate || 0;

            if (failureRate > 0.5) {
                // Flag publisher for manual review
                logger.warn(`[ExtractionTracker] Publisher has HIGH extraction failure rate: ${(failureRate * 100).toFixed(1)}%`, {
                    publisherId,
                    totalAudits: data.total_audits,
                    failedExtractions: data.failed_extractions
                });

                // Update publisher extraction_health field
                await this.supabase.from('publishers').update({
                    extraction_health: {
                        status: 'needs_review',
                        failure_rate: failureRate,
                        total_audits: data.total_audits,
                        failed_extractions: data.failed_extractions,
                        last_checked: new Date().toISOString()
                    }
                }).eq('id', publisherId);
            }

            return { failureRate, ...data };
        } catch (err) {
            logger.warn(`[ExtractionTracker] Failed to check publisher extraction health`, { error: err.message });
            return null;
        }
    }
}

module.exports = ExtractionTracker;
