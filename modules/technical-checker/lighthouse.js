const logger = require('../logger');
const axios = require('axios');
const { envConfig } = require('../env-config');

/**
 * PageSpeed Insights API Analyzer
 * Uses Google's PageSpeed Insights API for accurate performance scoring
 */

class PageSpeedAnalyzer {
    constructor(config = {}) {
        this.enabled = config.enabled !== false;
        this.timeout = config.timeout || 60000; // 60s timeout
        this.apiKey = config.apiKey || envConfig.googleSafeBrowsing?.apiKey || process.env.PAGESPEED_API_KEY || '';
        this.strategy = config.strategy || 'desktop'; // desktop or mobile
        this.apiUrl = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
    }

    /**
     * Run PageSpeed Insights analysis on a given URL
     * @param {string} url - URL to analyze
     * @returns {object} PageSpeed Insights results
     */
    async runPageSpeed(url) {
        if (!this.enabled) {
            logger.info('PageSpeed Insights is disabled, skipping');
            return null;
        }

        try {
            logger.info('Running PageSpeed Insights analysis', {
                url,
                strategy: this.strategy,
                hasApiKey: !!this.apiKey
            });
            const startTime = Date.now();

            // Build request URL
            const requestUrl = new URL(this.apiUrl);
            requestUrl.searchParams.set('url', url);
            requestUrl.searchParams.set('category', 'performance');
            requestUrl.searchParams.set('strategy', this.strategy);

            if (this.apiKey) {
                requestUrl.searchParams.set('key', this.apiKey);
            }

            // Make API request
            const response = await axios.get(requestUrl.toString(), {
                timeout: this.timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; SiteMonitoringWorker/1.0)',
                },
            });

            if (!response.data || !response.data.lighthouseResult) {
                throw new Error('PageSpeed API returned invalid response');
            }

            const duration = Date.now() - startTime;
            const lhr = response.data.lighthouseResult;

            // Extract Core Web Vitals
            const performanceCategory = lhr.categories.performance;
            const audits = lhr.audits;

            const metrics = {
                performanceScore: Math.round(performanceCategory.score * 100),
                metrics: {
                    fcp: audits['first-contentful-paint']?.numericValue || 0,
                    lcp: audits['largest-contentful-paint']?.numericValue || 0,
                    cls: audits['cumulative-layout-shift']?.numericValue || 0,
                    tbt: audits['total-blocking-time']?.numericValue || 0,
                    si: audits['speed-index']?.numericValue || 0,
                    tti: audits['interactive']?.numericValue || 0,
                },
                diagnostics: {
                    mainThreadWorkBreakdown: audits['mainthread-work-breakdown']?.details?.items || [],
                    resourceSummary: audits['resource-summary']?.details?.items || [],
                    thirdPartySummary: audits['third-party-summary']?.details?.items || [],
                },
                audits: {
                    fcp: this.formatAudit(audits['first-contentful-paint']),
                    lcp: this.formatAudit(audits['largest-contentful-paint']),
                    cls: this.formatAudit(audits['cumulative-layout-shift']),
                    tbt: this.formatAudit(audits['total-blocking-time']),
                    si: this.formatAudit(audits['speed-index']),
                    tti: this.formatAudit(audits['interactive']),
                },
                opportunities: this.extractOpportunities(lhr),
                fieldData: this.extractFieldData(response.data),
                duration,
            };

            logger.info('PageSpeed Insights analysis completed', {
                url,
                score: metrics.performanceScore,
                duration,
            });

            return metrics;
        } catch (error) {
            // Check for rate limiting
            if (error.response?.status === 429) {
                logger.warn('PageSpeed API rate limit exceeded', { url });
                return {
                    error: 'Rate limit exceeded',
                    performanceScore: null,
                    rateLimited: true,
                };
            }

            // Check for quota exceeded
            if (error.response?.status === 403) {
                logger.warn('PageSpeed API quota exceeded or invalid API key', { url });
                return {
                    error: 'API quota exceeded or invalid key',
                    performanceScore: null,
                    quotaExceeded: true,
                };
            }

            logger.error('PageSpeed Insights analysis failed', {
                error: error.message,
                url,
                status: error.response?.status,
                data: error.response?.data?.error,
            });

            return {
                error: error.message,
                performanceScore: null,
            };
        }
    }

    /**
     * Format audit result for easier consumption
     */
    formatAudit(audit) {
        if (!audit) return null;

        return {
            score: audit.score,
            displayValue: audit.displayValue,
            numericValue: audit.numericValue,
            numericUnit: audit.numericUnit,
            scoreDisplayMode: audit.scoreDisplayMode,
        };
    }

    /**
     * Extract performance opportunities (suggestions)
     */
    extractOpportunities(lhr) {
        const opportunities = [];
        const auditRefs = lhr.categories.performance.auditRefs;

        for (const auditRef of auditRefs) {
            if (auditRef.group === 'load-opportunities') {
                const audit = lhr.audits[auditRef.id];
                if (audit && audit.score !== null && audit.score < 1) {
                    opportunities.push({
                        id: auditRef.id,
                        title: audit.title,
                        description: audit.description,
                        score: audit.score,
                        displayValue: audit.displayValue,
                        savings: {
                            ms: audit.numericValue || 0,
                            bytes: audit.details?.overallSavingsBytes || 0,
                        },
                    });
                }
            }
        }

        // Sort by potential savings (ms)
        opportunities.sort((a, b) => b.savings.ms - a.savings.ms);

        return opportunities.slice(0, 5); // Top 5 opportunities
    }

    /**
     * Extract real-world field data from Chrome UX Report
     */
    extractFieldData(apiResponse) {
        const fieldData = apiResponse.loadingExperience;
        if (!fieldData) return null;

        return {
            overallCategory: fieldData.overall_category,
            metrics: {
                fcp: fieldData.metrics?.FIRST_CONTENTFUL_PAINT_MS,
                lcp: fieldData.metrics?.LARGEST_CONTENTFUL_PAINT_MS,
                cls: fieldData.metrics?.CUMULATIVE_LAYOUT_SHIFT_SCORE,
                fid: fieldData.metrics?.FIRST_INPUT_DELAY_MS,
            },
        };
    }
}

module.exports = PageSpeedAnalyzer;
