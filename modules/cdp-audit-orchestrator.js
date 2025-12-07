/**
 * CDP Audit Orchestrator
 * Runs MFA detection using the raw CDP crawler
 * Memory-optimized for 2GB RAM VMs
 */

const logger = require('./logger');
const CDPCrawler = require('./cdp-crawler');
const directoryDetector = require('./directory-detector');

class CDPAuditOrchestrator {
    constructor(modules = {}) {
        this.contentAnalyzer = modules.contentAnalyzer;
        this.adAnalyzer = modules.adAnalyzer;
        this.policyChecker = modules.policyChecker;
        this.technicalChecker = modules.technicalChecker;

        // CDP Crawler instance (reused across audits)
        this.crawler = null;
        this.crawlerLaunched = false;
    }

    /**
     * Ensure CDP crawler is ready
     */
    async ensureCrawler() {
        if (this.crawler && this.crawlerLaunched && this.crawler.isConnected()) {
            logger.debug('[CDPOrchestrator] Crawler already connected');
            return;
        }

        // Close existing crawler if any
        if (this.crawler) {
            try {
                await this.crawler.close();
            } catch (err) {
                logger.warn('[CDPOrchestrator] Error closing old crawler:', err.message);
            }
        }

        logger.info('[CDPOrchestrator] Launching new CDP crawler...');
        this.crawler = new CDPCrawler({
            fingerprint: 'desktop',
            timeout: 60000,
            scrollDuration: 15000 // Reduced for memory
        });

        await this.crawler.launch();
        this.crawlerLaunched = true;
        logger.info('[CDPOrchestrator] CDP crawler ready');
    }

    /**
     * Run complete directory-aware audit
     */
    async runDirectoryAwareAudit(publisher, siteAuditId) {
        const startTime = Date.now();

        const auditResults = {
            publisherId: publisher.id,
            siteAuditId,
            mainSite: { desktop: null },
            directories: [],
            directoryDetection: null,
            crawlData: null,
            summary: {
                totalDirectories: 0,
                successfulAudits: 0,
                failedAudits: 0,
                totalDuration: 0
            }
        };

        try {
            logger.info('[CDPOrchestrator] Starting directory-aware audit', {
                publisherId: publisher.id,
                siteAuditId,
                url: publisher.site_url
            });

            // Normalize URL
            const normalizedUrl = this.normalizeUrl(publisher.site_url);
            if (!normalizedUrl) {
                throw new Error(`Invalid site URL: ${publisher.site_url}`);
            }

            // Ensure crawler is ready
            await this.ensureCrawler();

            // 1. Crawl main site with CDP
            logger.info('[CDPOrchestrator] Crawling main site...');
            const crawlResult = await this.crawler.crawl(normalizedUrl, {
                fullHeatmap: true,
                simulateBrowsing: true
            });

            if (!crawlResult.success) {
                throw new Error(`Crawl failed: ${crawlResult.error}`);
            }

            auditResults.crawlData = crawlResult;
            logger.info('[CDPOrchestrator] Crawl complete', {
                duration: crawlResult.duration,
                totalAds: crawlResult.mfaIndicators?.totalAds || 0,
                adNetworks: crawlResult.networkAnalysis?.adNetworkCount || 0
            });

            // 2. Run analysis modules with crawl data
            const moduleResults = await this.runAnalysisModules(
                normalizedUrl,
                crawlResult,
                publisher.id,
                siteAuditId
            );

            auditResults.mainSite.desktop = {
                url: normalizedUrl,
                location: 'main',
                viewport: 'desktop',
                success: true,
                crawlData: {
                    contentLength: crawlResult.contentLength,
                    mfaIndicators: crawlResult.mfaIndicators,
                    networkAnalysis: {
                        totalRequests: crawlResult.networkAnalysis?.totalRequests,
                        adRequests: crawlResult.networkAnalysis?.adRequests,
                        adNetworks: crawlResult.networkAnalysis?.adNetworks,
                        hasAutoRefresh: crawlResult.networkAnalysis?.hasAutoRefresh
                    },
                    adHeatmap: {
                        totalAds: crawlResult.adHeatmap?.totalAdsDetected,
                        avgAdDensity: crawlResult.adHeatmap?.avgAdDensity,
                        avgCLS: crawlResult.adHeatmap?.avgCLS,
                        adsAboveFold: crawlResult.adHeatmap?.adsAboveFold
                    }
                },
                modules: moduleResults,
                duration: crawlResult.duration
            };

            auditResults.summary.successfulAudits = 1;
            auditResults.summary.totalDuration = Date.now() - startTime;

            logger.info('[CDPOrchestrator] Audit complete', {
                publisherId: publisher.id,
                duration: auditResults.summary.totalDuration,
                mfaScore: crawlResult.mfaIndicators?.combinedScore
            });

            return auditResults;

        } catch (error) {
            logger.error('[CDPOrchestrator] Audit failed', {
                publisherId: publisher.id,
                error: error.message,
                stack: error.stack
            });

            auditResults.summary.failedAudits = 1;
            auditResults.summary.totalDuration = Date.now() - startTime;
            auditResults.error = error.message;

            return auditResults;
        }
    }

    /**
     * Run analysis modules with crawl data
     */
    async runAnalysisModules(url, crawlResult, publisherId, siteAuditId) {
        const modules = {};

        // Content Analysis
        if (this.contentAnalyzer && crawlResult.content) {
            try {
                logger.info('[CDPOrchestrator] Running content analyzer...');
                const contentResult = await this.runModule('contentAnalyzer', () =>
                    this.contentAnalyzer.analyze({
                        content: crawlResult.content,
                        url: url,
                        publisherId: publisherId
                    })
                );
                modules.contentAnalyzer = contentResult;
            } catch (err) {
                modules.contentAnalyzer = { error: err.message };
                logger.warn('[CDPOrchestrator] Content analyzer failed:', err.message);
            }
        }

        // Ad Analysis - use CDP network data
        if (this.adAnalyzer) {
            try {
                logger.info('[CDPOrchestrator] Running ad analyzer...');
                // Convert CDP data to format expected by adAnalyzer
                const adData = {
                    adElements: crawlResult.adHeatmap?.levels?.flatMap(l => l.ads) || [],
                    adRequests: crawlResult.networkAnalysis?.adRequests || 0,
                    adNetworks: crawlResult.networkAnalysis?.adNetworks || [],
                    hasAutoRefresh: crawlResult.networkAnalysis?.hasAutoRefresh || false,
                    adDensity: crawlResult.mfaIndicators?.adDensity || 0,
                    adsAboveFold: crawlResult.mfaIndicators?.adsAboveFold || 0
                };

                const adResult = await this.runModule('adAnalyzer', () =>
                    this.adAnalyzer.analyze({
                        url: url,
                        publisherId: publisherId,
                        crawlData: adData
                    })
                );
                modules.adAnalyzer = adResult;
            } catch (err) {
                modules.adAnalyzer = { error: err.message };
                logger.warn('[CDPOrchestrator] Ad analyzer failed:', err.message);
            }
        }

        // Policy Checker
        if (this.policyChecker) {
            try {
                logger.info('[CDPOrchestrator] Running policy checker...');
                const policyResult = await this.runModule('policyChecker', () =>
                    this.policyChecker.analyze({
                        url: url,
                        content: crawlResult.content,
                        publisherId: publisherId
                    })
                );
                modules.policyChecker = policyResult;
            } catch (err) {
                modules.policyChecker = { error: err.message };
                logger.warn('[CDPOrchestrator] Policy checker failed:', err.message);
            }
        }

        // Technical Checker - use CDP metrics
        if (this.technicalChecker) {
            try {
                logger.info('[CDPOrchestrator] Running technical checker...');
                const technicalResult = await this.runModule('technicalChecker', () =>
                    this.technicalChecker.analyze({
                        url: url,
                        publisherId: publisherId,
                        metrics: {
                            cls: crawlResult.mfaIndicators?.layoutShift || 0,
                            adDensity: crawlResult.mfaIndicators?.adDensity || 0,
                            requestCount: crawlResult.networkAnalysis?.totalRequests || 0
                        }
                    })
                );
                modules.technicalChecker = technicalResult;
            } catch (err) {
                modules.technicalChecker = { error: err.message };
                logger.warn('[CDPOrchestrator] Technical checker failed:', err.message);
            }
        }

        return modules;
    }

    /**
     * Run a single module with timeout and error handling
     */
    async runModule(moduleName, moduleFunction) {
        const timeout = 30000; // 30 second timeout
        const startTime = Date.now();

        try {
            const result = await Promise.race([
                moduleFunction(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`${moduleName} timeout`)), timeout)
                )
            ]);

            logger.debug(`[CDPOrchestrator] ${moduleName} completed in ${Date.now() - startTime}ms`);
            return result;
        } catch (error) {
            logger.error(`[CDPOrchestrator] ${moduleName} failed:`, error.message);
            return { error: error.message, duration: Date.now() - startTime };
        }
    }

    /**
     * Normalize URL
     */
    normalizeUrl(url) {
        if (!url || typeof url !== 'string') {
            return null;
        }

        let normalized = url.trim();
        normalized = normalized.replace(/[:\\/]+$/, '');

        if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
            normalized = `https://${normalized}`;
        }

        try {
            const urlObj = new URL(normalized);
            return urlObj.href;
        } catch (e) {
            logger.warn('[CDPOrchestrator] URL normalization failed:', e.message);
            return null;
        }
    }

    /**
     * Aggregate results for scoring
     */
    aggregateResults(auditResults) {
        const crawlData = auditResults.crawlData;
        const moduleResults = auditResults.mainSite?.desktop?.modules || {};

        return {
            publisherId: auditResults.publisherId,
            siteAuditId: auditResults.siteAuditId,

            // CDP crawler data (primary source)
            mfaScore: crawlData?.mfaIndicators?.combinedScore || 0,
            riskLevel: crawlData?.mfaIndicators?.riskLevel || 'UNKNOWN',

            // Ad metrics
            totalAds: crawlData?.mfaIndicators?.totalAds || 0,
            adsAboveFold: crawlData?.mfaIndicators?.adsAboveFold || 0,
            adDensity: crawlData?.mfaIndicators?.adDensity || 0,
            hasAutoRefresh: crawlData?.mfaIndicators?.hasAutoRefresh || false,

            // Network metrics
            adNetworks: crawlData?.networkAnalysis?.adNetworks || [],
            adNetworkCount: crawlData?.networkAnalysis?.adNetworkCount || 0,

            // Layout metrics
            layoutShift: crawlData?.mfaIndicators?.layoutShift || 0,

            // Suspicious patterns
            suspiciousPatterns: crawlData?.mfaIndicators?.suspiciousPatterns || [],

            // Content
            contentLength: crawlData?.contentLength || 0,

            // Module results
            modules: {
                content: moduleResults.contentAnalyzer || null,
                ads: moduleResults.adAnalyzer || null,
                policy: moduleResults.policyChecker || null,
                technical: moduleResults.technicalChecker || null
            },

            // Duration
            duration: auditResults.summary?.totalDuration || 0
        };
    }

    /**
     * Close crawler and cleanup
     */
    async close() {
        if (this.crawler) {
            await this.crawler.close();
            this.crawler = null;
            this.crawlerLaunched = false;
        }
    }
}

module.exports = CDPAuditOrchestrator;
