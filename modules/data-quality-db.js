const logger = require('./logger');

/**
 * DataQualityDB - Save comprehensive data quality metrics to audit_data_quality table
 * This provides detailed per-module tracking separate from the main site_audits
 */
class DataQualityDB {
    constructor(supabaseClient) {
        this.supabase = supabaseClient;
    }

    /**
     * Save detailed data quality metrics to audit_data_quality table
     */
    async saveDataQuality(siteAuditId, publisherId, dataQuality, moduleResults = {}) {
        if (!siteAuditId || !publisherId) {
            logger.warn('[DataQualityDB] Missing required IDs for saving data quality', { siteAuditId, publisherId });
            return { success: false, error: 'Missing siteAuditId or publisherId' };
        }

        if (!dataQuality) {
            logger.warn('[DataQualityDB] Missing dataQuality object');
            return { success: false, error: 'Missing dataQuality object' };
        }

        try {
            logger.info('[DataQualityDB] Saving data quality', {
                siteAuditId,
                publisherId,
                score: dataQuality.score,
                isComplete: dataQuality.isComplete
            });

            // Calculate per-module completeness
            const crawlerCompleteness = this.calculateModuleCompleteness('crawler', moduleResults.crawler);
            const contentCompleteness = this.calculateModuleCompleteness('content', moduleResults.contentAnalyzer);
            const adCompleteness = this.calculateModuleCompleteness('ad', moduleResults.adAnalyzer);
            const policyCompleteness = this.calculateModuleCompleteness('policy', moduleResults.policyChecker);
            const technicalCompleteness = this.calculateModuleCompleteness('technical', moduleResults.technicalChecker);

            const overallCompleteness = (
                crawlerCompleteness + contentCompleteness + adCompleteness +
                policyCompleteness + technicalCompleteness
            ) / 5;

            const qualityLevel = this.getQualityLevel(dataQuality.score);

            const record = {
                site_audit_id: siteAuditId,
                publisher_id: publisherId,
                data_quality_score: typeof dataQuality.score === 'number' ? dataQuality.score : 0,
                metrics_collected: dataQuality.metricsCollected || {},
                collection_failures: dataQuality.failures || [],

                // Per-module success flags
                crawler_success: !!moduleResults.crawler?.success,
                content_analysis_success: !!moduleResults.contentAnalyzer?.success,
                ad_analysis_success: !!moduleResults.adAnalyzer?.success,
                policy_check_success: !!moduleResults.policyChecker?.success,
                technical_check_success: !!moduleResults.technicalChecker?.success,

                // Per-module completeness scores
                crawler_completeness: crawlerCompleteness,
                content_completeness: contentCompleteness,
                ad_completeness: adCompleteness,
                policy_completeness: policyCompleteness,
                technical_completeness: technicalCompleteness,
                overall_completeness: overallCompleteness,

                // Status flags
                is_sufficient: (dataQuality.score || 0) >= 0.6,
                quality_level: qualityLevel,

                updated_at: new Date().toISOString()
            };

            // Retry logic for DB operation
            let lastError = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    // Check if record exists first to avoid ON CONFLICT issues
                    const { data: existing } = await this.supabase
                        .from('audit_data_quality')
                        .select('id')
                        .eq('site_audit_id', siteAuditId)
                        .maybeSingle();

                    let result;
                    if (existing) {
                        // Update existing
                        result = await this.supabase
                            .from('audit_data_quality')
                            .update(record)
                            .eq('id', existing.id)
                            .select();
                    } else {
                        // Insert new
                        result = await this.supabase
                            .from('audit_data_quality')
                            .insert(record)
                            .select();
                    }

                    const { data, error } = result;

                    if (error) throw error;

                    logger.info('[DataQualityDB] Data quality saved successfully', {
                        id: data?.[0]?.id,
                        qualityLevel,
                        overallCompleteness: overallCompleteness.toFixed(2),
                        attempt
                    });

                    return { success: true, data: data?.[0] };
                } catch (dbError) {
                    lastError = dbError;
                    logger.warn(`[DataQualityDB] DB save attempt ${attempt} failed`, { error: dbError.message });
                    if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt)); // Backoff
                }
            }

            logger.error('[DataQualityDB] Failed to save data quality after retries', { error: lastError?.message });
            return { success: false, error: lastError?.message };

        } catch (err) {
            logger.error('[DataQualityDB] Error preparing data quality record', { error: err.message });
            return { success: false, error: err.message };
        }
    }

    /**
     * Calculate completeness for a specific module based on its output
     */
    calculateModuleCompleteness(moduleName, moduleResult) {
        if (!moduleResult || moduleResult.error) return 0;
        if (!moduleResult.success || !moduleResult.data) return 0.2;

        const data = moduleResult.data;
        let completeness = 0.5; // Base score for having data

        switch (moduleName) {
            case 'crawler':
                if (data.finalUrl) completeness += 0.1;
                if (data.adElements?.length > 0) completeness += 0.2;
                if (data.har?.log?.entries?.length > 0) completeness += 0.1;
                if (data.screenshot) completeness += 0.1;
                break;

            case 'content':
                if (data.entropy?.entropyScore >= 0) completeness += 0.1;
                if (data.readability?.readabilityScore >= 0) completeness += 0.1;
                if (data.ai?.aiScore >= 0) completeness += 0.1;
                if (data.clickbait?.clickbaitScore >= 0) completeness += 0.1;
                if (data.qualityScore >= 0) completeness += 0.1;
                break;

            case 'ad':
                if (data.analysis?.density) completeness += 0.1;
                if (data.analysis?.visibility) completeness += 0.1;
                if (data.analysis?.autoRefresh) completeness += 0.1;
                if (data.analysis?.video) completeness += 0.1;
                if (data.analysis?.scrollInjection) completeness += 0.05;
                if (data.analysis?.trafficArbitrage) completeness += 0.05;
                break;

            case 'policy':
                if (data.complianceLevel) completeness += 0.2;
                if (data.violations?.length >= 0) completeness += 0.15;
                if (data.jurisdiction) completeness += 0.15;
                break;

            case 'technical':
                if (data.components?.ssl) completeness += 0.1;
                if (data.components?.performance) completeness += 0.1;
                if (data.components?.adsTxt) completeness += 0.15;
                if (data.technicalHealthScore >= 0) completeness += 0.15;
                break;

            default:
                completeness = 0.5;
        }

        return Math.min(1.0, completeness);
    }

    /**
     * Get quality level based on score
     */
    getQualityLevel(score) {
        if (score >= 0.9) return 'excellent';
        if (score >= 0.7) return 'good';
        if (score >= 0.5) return 'warning';
        return 'critical';
    }

    /**
     * Get historical data quality for a publisher
     */
    async getDataQualityHistory(publisherId, limit = 30) {
        try {
            const { data, error } = await this.supabase
                .from('audit_data_quality')
                .select('*')
                .eq('publisher_id', publisherId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) {
                return { success: false, error: error.message };
            }

            return { success: true, data };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Get average data quality for a publisher
     */
    async getAverageDataQuality(publisherId, days = 30) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const { data, error } = await this.supabase
                .from('audit_data_quality')
                .select('data_quality_score, overall_completeness, quality_level')
                .eq('publisher_id', publisherId)
                .gte('created_at', startDate.toISOString());

            if (error) {
                return { success: false, error: error.message };
            }

            if (!data || data.length === 0) {
                return { success: true, data: { avgScore: 0, avgCompleteness: 0, audits: 0 } };
            }

            const avgScore = data.reduce((sum, d) => sum + (d.data_quality_score || 0), 0) / data.length;
            const avgCompleteness = data.reduce((sum, d) => sum + (d.overall_completeness || 0), 0) / data.length;

            return {
                success: true,
                data: {
                    avgScore: parseFloat(avgScore.toFixed(3)),
                    avgCompleteness: parseFloat(avgCompleteness.toFixed(3)),
                    audits: data.length,
                    qualityBreakdown: {
                        excellent: data.filter(d => d.quality_level === 'excellent').length,
                        good: data.filter(d => d.quality_level === 'good').length,
                        warning: data.filter(d => d.quality_level === 'warning').length,
                        critical: data.filter(d => d.quality_level === 'critical').length
                    }
                }
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
}

module.exports = DataQualityDB;
