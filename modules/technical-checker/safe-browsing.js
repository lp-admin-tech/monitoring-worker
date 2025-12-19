/**
 * Google Safe Browsing API Checker
 * Checks URLs against Google's Safe Browsing lists for malware, phishing, and unwanted software
 */

const axios = require('axios');
const logger = require('../logger');
const { envConfig } = require('../env-config');

class SafeBrowsingChecker {
    constructor(config = {}) {
        this.apiKey = config.apiKey || envConfig.googleSafeBrowsing?.apiKey || process.env.GOOGLE_SAFE_BROWSING_API_KEY || '';
        this.clientId = config.clientId || 'site-monitoring-worker';
        this.clientVersion = config.clientVersion || '1.0.0';
        this.apiUrl = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
        this.enabled = !!this.apiKey;
    }

    /**
     * Check a URL against Google Safe Browsing API
     * @param {string} url - URL to check
     * @returns {Promise<Object>} Safe Browsing result
     */
    async checkUrl(url) {
        if (!this.enabled) {
            logger.debug('Safe Browsing API disabled - no API key configured');
            return {
                checked: false,
                safe: null,
                reason: 'API key not configured',
            };
        }

        try {
            logger.info('Checking URL against Safe Browsing API', { url });

            const requestBody = {
                client: {
                    clientId: this.clientId,
                    clientVersion: this.clientVersion,
                },
                threatInfo: {
                    threatTypes: [
                        'MALWARE',
                        'SOCIAL_ENGINEERING',
                        'UNWANTED_SOFTWARE',
                        'POTENTIALLY_HARMFUL_APPLICATION',
                    ],
                    platformTypes: ['ANY_PLATFORM'],
                    threatEntryTypes: ['URL'],
                    threatEntries: [{ url }],
                },
            };

            const response = await axios.post(
                `${this.apiUrl}?key=${this.apiKey}`,
                requestBody,
                {
                    timeout: 10000,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            // Empty matches means the URL is safe
            const matches = response.data.matches || [];
            const isSafe = matches.length === 0;

            if (!isSafe) {
                logger.warn('Unsafe URL detected', {
                    url,
                    threats: matches.map(m => ({
                        type: m.threatType,
                        platform: m.platformType,
                    })),
                });
            }

            return {
                checked: true,
                safe: isSafe,
                threats: matches.map(m => ({
                    type: m.threatType,
                    platform: m.platformType,
                    threatEntryType: m.threatEntryType,
                })),
                threatCount: matches.length,
                checkedAt: new Date().toISOString(),
            };
        } catch (error) {
            // Handle rate limiting
            if (error.response?.status === 429) {
                logger.warn('Safe Browsing API rate limit exceeded', { url });
                return {
                    checked: false,
                    safe: null,
                    error: 'Rate limit exceeded',
                    rateLimited: true,
                };
            }

            // Handle invalid API key
            if (error.response?.status === 403 || error.response?.status === 401) {
                logger.error('Safe Browsing API authentication failed', {
                    status: error.response?.status,
                    url,
                });
                return {
                    checked: false,
                    safe: null,
                    error: 'Invalid API key',
                    authError: true,
                };
            }

            logger.error('Safe Browsing API check failed', {
                error: error.message,
                url,
                status: error.response?.status,
            });

            return {
                checked: false,
                safe: null,
                error: error.message,
            };
        }
    }

    /**
     * Check multiple URLs at once (batch mode)
     * @param {string[]} urls - Array of URLs to check
     * @returns {Promise<Object>} Batch results
     */
    async checkUrls(urls) {
        if (!this.enabled) {
            return {
                checked: false,
                results: {},
                reason: 'API key not configured',
            };
        }

        if (!Array.isArray(urls) || urls.length === 0) {
            return {
                checked: true,
                results: {},
                safeCount: 0,
                unsafeCount: 0,
            };
        }

        try {
            logger.info(`Batch checking ${urls.length} URLs against Safe Browsing API`);

            const requestBody = {
                client: {
                    clientId: this.clientId,
                    clientVersion: this.clientVersion,
                },
                threatInfo: {
                    threatTypes: [
                        'MALWARE',
                        'SOCIAL_ENGINEERING',
                        'UNWANTED_SOFTWARE',
                        'POTENTIALLY_HARMFUL_APPLICATION',
                    ],
                    platformTypes: ['ANY_PLATFORM'],
                    threatEntryTypes: ['URL'],
                    threatEntries: urls.map(url => ({ url })),
                },
            };

            const response = await axios.post(
                `${this.apiUrl}?key=${this.apiKey}`,
                requestBody,
                {
                    timeout: 15000,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            const matches = response.data.matches || [];

            // Build results map
            const results = {};
            const unsafeUrls = new Set();

            for (const match of matches) {
                const matchedUrl = match.threat?.url;
                if (matchedUrl) {
                    unsafeUrls.add(matchedUrl);
                    if (!results[matchedUrl]) {
                        results[matchedUrl] = {
                            safe: false,
                            threats: [],
                        };
                    }
                    results[matchedUrl].threats.push({
                        type: match.threatType,
                        platform: match.platformType,
                    });
                }
            }

            // Mark safe URLs
            for (const url of urls) {
                if (!results[url]) {
                    results[url] = { safe: true, threats: [] };
                }
            }

            const safeCount = urls.length - unsafeUrls.size;
            const unsafeCount = unsafeUrls.size;

            logger.info('Batch Safe Browsing check completed', {
                totalUrls: urls.length,
                safeCount,
                unsafeCount,
            });

            return {
                checked: true,
                results,
                safeCount,
                unsafeCount,
                checkedAt: new Date().toISOString(),
            };
        } catch (error) {
            logger.error('Batch Safe Browsing check failed', { error: error.message });
            return {
                checked: false,
                results: {},
                error: error.message,
            };
        }
    }

    /**
     * Get a summary suitable for audit reports
     * @param {Object} checkResult - Result from checkUrl()
     * @returns {Object} Formatted summary
     */
    getSummary(checkResult) {
        if (!checkResult.checked) {
            return {
                status: 'unknown',
                message: checkResult.error || 'Check not performed',
                riskLevel: 'unknown',
            };
        }

        if (checkResult.safe) {
            return {
                status: 'safe',
                message: 'No threats detected by Google Safe Browsing',
                riskLevel: 'low',
            };
        }

        // Determine risk level based on threat types
        const threatTypes = checkResult.threats.map(t => t.type);
        let riskLevel = 'medium';

        if (threatTypes.includes('MALWARE') || threatTypes.includes('SOCIAL_ENGINEERING')) {
            riskLevel = 'critical';
        } else if (threatTypes.includes('POTENTIALLY_HARMFUL_APPLICATION')) {
            riskLevel = 'high';
        }

        return {
            status: 'unsafe',
            message: `Threats detected: ${threatTypes.join(', ')}`,
            riskLevel,
            threatTypes,
            threatCount: checkResult.threatCount,
        };
    }
}

module.exports = SafeBrowsingChecker;
