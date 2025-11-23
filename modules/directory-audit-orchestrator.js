const logger = require('./logger');
const directoryDetector = require('./directory-detector');

/**
 * Directory-Aware Audit Orchestrator
 * Runs all analysis modules on every discovered directory
 */

class DirectoryAuditOrchestrator {
    constructor(modules = {}) {
        this.contentAnalyzer = modules.contentAnalyzer;
        this.adAnalyzer = modules.adAnalyzer;
        this.policyChecker = modules.policyChecker;
        this.technicalChecker = modules.technicalChecker;
        this.crawler = modules.crawler;
    }

    /**
     * Run complete audit on main site + all discovered directories
     */
    async runDirectoryAwareAudit(publisher, siteAuditId) {
        let context = null;
        let page = null;

        try {
            logger.info('Starting directory-aware audit', {
                publisherId: publisher.id,
                siteAuditId,
                url: publisher.site_url
            });

            const auditResults = {
                publisherId: publisher.id,
                siteAuditId,
                mainSite: { desktop: null, mobile: null },
                directories: [],
                directoryDetection: null,
                summary: {
                    totalDirectories: 0,
                    successfulAudits: 0,
                    failedAudits: 0,
                    totalDuration: 0
                }
            };

            const startTime = Date.now();

            // 1. Directory Discovery (Use Desktop)
            context = await this.crawler.browser.newContext({
                userAgent: this.crawler.getRandomUserAgent(),
                viewport: this.crawler.viewports[0], // Use desktop for discovery
                extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
            });
            page = await context.newPage();

            await page.goto(publisher.site_url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => { });

            logger.info('Detecting directory website', { publisherId: publisher.id });
            const detection = await directoryDetector.detectDirectory(page);
            auditResults.directoryDetection = detection;

            logger.info('Discovering directories', { url: publisher.site_url });
            const discoveredDirs = await this.discoverDirectories(page, publisher.site_url);
            const specifiedDirs = publisher.subdirectories || [];
            const allDirs = new Set([...specifiedDirs, ...discoveredDirs]);
            const directoriesToAudit = Array.from(allDirs);
            auditResults.summary.totalDirectories = directoriesToAudit.length;

            await page.close();
            await context.close();

            // Helper to run audit for a specific URL on all viewports
            const auditUrlOnAllViewports = async (url, locationName) => {
                const results = {};

                for (const viewport of this.crawler.viewports) {
                    const viewportName = viewport.name || 'desktop';
                    logger.info(`Running audit for ${locationName} on ${viewportName}`, { url });

                    const vpContext = await this.crawler.browser.newContext({
                        userAgent: viewport.isMobile
                            ? this.crawler.userAgents.find(ua => ua.platform === 'mobile')?.agent
                            : this.crawler.getRandomUserAgent(),
                        viewport: viewport,
                        isMobile: viewport.isMobile,
                        hasTouch: viewport.isMobile,
                        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
                    });
                    const vpPage = await vpContext.newPage();

                    try {
                        await vpPage.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => { });

                        const auditResult = await this.runFullAudit(
                            url,
                            publisher.id,
                            siteAuditId,
                            vpPage,
                            locationName,
                            viewport
                        );

                        results[viewportName] = auditResult;

                        if (auditResult.success) auditResults.summary.successfulAudits++;
                        else auditResults.summary.failedAudits++;

                    } catch (err) {
                        logger.error(`Failed audit for ${url} on ${viewportName}`, err);
                        results[viewportName] = { success: false, error: err.message };
                        auditResults.summary.failedAudits++;
                    } finally {
                        await vpPage.close();
                        await vpContext.close();
                    }
                }
                return results;
            };

            // 2. Audit Main Site (Desktop & Mobile)
            auditResults.mainSite = await auditUrlOnAllViewports(publisher.site_url, 'main');

            // 3. Audit Directories (Desktop & Mobile)
            for (const directory of directoriesToAudit) {
                let baseUrl = publisher.site_url;
                if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;
                const directoryUrl = `${baseUrl}${directory}`.replace(/(?<!:)\/+/g, '/');

                const dirResults = await auditUrlOnAllViewports(directoryUrl, directory);

                auditResults.directories.push({
                    directory,
                    url: directoryUrl,
                    ...dirResults
                });
            }

            auditResults.summary.totalDuration = Date.now() - startTime;

            // Flatten results for backward compatibility if needed, or just return the rich structure
            // The caller (worker-runner.js) expects specific structure, so we might need to adapt there too.
            // For now, we return the rich structure and will update worker-runner if needed.

            return auditResults;

        } catch (error) {
            logger.error('Directory-aware audit failed', error);
            throw error;
        }
    }

    /**
     * Run all analysis modules on a single URL
     */
    async runFullAudit(url, publisherId, siteAuditId, page, location = 'main', viewport = { width: 1920, height: 1080, name: 'desktop' }) {
        const auditStartTime = Date.now();
        const results = {
            url,
            location,
            viewport: viewport.name,
            success: false,
            modules: {},
            errors: [],
            duration: 0
        };

        try {
            logger.info(`Running full audit for ${location} on ${viewport.name}`, { url });

            // Extract data needed for modules
            const textContent = await this.crawler.extractPageContent(page);
            const metrics = await this.crawler.extractPageMetrics(page);
            const adElements = await this.crawler.extractPageAdElements(page);
            const iframes = await this.crawler.extractPageIframes(page);

            // Construct crawlData object expected by modules
            const crawlData = {
                url,
                metrics,
                adElements,
                iframes,
                content: [textContent], // Some modules expect array of content
                viewport: viewport.name,
                publisherId,
                siteAuditId
            };

            // Run all modules in parallel for speed
            const modulePromises = [];

            // Content Analyzer
            if (this.contentAnalyzer) {
                modulePromises.push(
                    this.runModule('contentAnalyzer', async () => {
                        return await this.contentAnalyzer.analyzeContent(textContent);
                    })
                );
            }

            // Ad Analyzer
            if (this.adAnalyzer) {
                modulePromises.push(
                    this.runModule('adAnalyzer', async () => {
                        return await this.adAnalyzer.processPublisher(crawlData, viewport);
                    })
                );
            }

            // Policy Checker
            if (this.policyChecker) {
                modulePromises.push(
                    this.runModule('policyChecker', async () => {
                        return await this.policyChecker.runPolicyCheck([textContent]);
                    })
                );
            }

            // Technical Checker
            if (this.technicalChecker) {
                modulePromises.push(
                    this.runModule('technicalChecker', async () => {
                        return await this.technicalChecker.runTechnicalHealthCheck(crawlData, url);
                    })
                );
            }

            // Wait for all modules to complete
            const moduleResults = await Promise.allSettled(modulePromises);

            // Process results
            moduleResults.forEach((result) => {
                if (result.status === 'fulfilled') {
                    results.modules[result.value.moduleName] = {
                        success: result.value.success,
                        data: result.value.data,
                        duration: result.value.duration
                    };
                } else {
                    results.errors.push({
                        module: 'unknown',
                        error: result.reason?.message || 'Unknown error'
                    });
                }
            });

            results.success = results.errors.length === 0;
            results.duration = Date.now() - auditStartTime;
            results.crawlData = crawlData; // Include raw crawl data for scorer

            logger.info(`Full audit completed for ${location}`, {
                url,
                success: results.success,
                modulesRun: Object.keys(results.modules).length,
                errors: results.errors.length,
                duration: results.duration
            });

            return results;

        } catch (error) {
            logger.error(`Full audit failed for ${location}`, error);
            results.success = false;
            results.errors.push({ error: error.message });
            results.duration = Date.now() - auditStartTime;
            return results;
        }
    }

    /**
     * Run a single module with error handling
     */
    async runModule(moduleName, moduleFunction) {
        const startTime = Date.now();
        try {
            const data = await moduleFunction();
            return {
                moduleName,
                success: true,
                data,
                duration: Date.now() - startTime
            };
        } catch (error) {
            logger.error(`Module ${moduleName} failed`, error);
            return {
                moduleName,
                success: false,
                error: error.message,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Discover directories from a page
     */
    async discoverDirectories(page, baseUrl) {
        try {
            // Ensure protocol exists
            if (!baseUrl.startsWith('http')) {
                baseUrl = 'https://' + baseUrl;
            }

            const discoveredDirs = await page.evaluate((baseUrlParam) => {
                const discoveredSet = new Set();
                const baseUrlObj = new URL(baseUrlParam);

                const links = Array.from(document.querySelectorAll('a[href]'));

                links.forEach(link => {
                    try {
                        const href = link.href;
                        if (!href) return;

                        const absoluteUrl = new URL(href, baseUrlParam);

                        if (absoluteUrl.hostname === baseUrlObj.hostname) {
                            const pathname = absoluteUrl.pathname;
                            const segments = pathname.split('/').filter(s => s.length > 0);

                            if (segments.length > 0) {
                                const firstSegment = '/' + segments[0];

                                if (firstSegment !== '/' && !firstSegment.includes('.')) {
                                    discoveredSet.add(firstSegment);
                                }
                            }
                        }
                    } catch (e) {
                        // Skip invalid URLs
                    }
                });

                return Array.from(discoveredSet);
            }, baseUrl);

            logger.info(`Discovered ${discoveredDirs.length} directories`, {
                baseUrl,
                directories: discoveredDirs
            });

            return discoveredDirs;

        } catch (error) {
            logger.error('Error discovering directories', error);
            return [];
        }
    }

    /**
     * Aggregate results from all directories
     */
    aggregateResults(auditResults) {
        const aggregated = {
            publisherId: auditResults.publisherId,
            siteAuditId: auditResults.siteAuditId,
            isDirectory: auditResults.directoryDetection?.isDirectory || false,
            directoryType: auditResults.directoryDetection?.directoryType,
            directoryConfidence: auditResults.directoryDetection?.confidence,
            totalLocationsAudited: 1 + auditResults.directories.length,
            aggregatedScores: {
                avgContentQuality: 0,
                avgAdDensity: 0,
                avgTechnicalScore: 0,
                avgPolicyCompliance: 0
            },
            locationBreakdown: []
        };

        // Flatten all audits (Main Desktop, Main Mobile, Dir 1 Desktop, Dir 1 Mobile, etc.)
        const allAudits = [];

        if (auditResults.mainSite.desktop) allAudits.push({ ...auditResults.mainSite.desktop, location: 'main', viewport: 'desktop' });
        if (auditResults.mainSite.mobile) allAudits.push({ ...auditResults.mainSite.mobile, location: 'main', viewport: 'mobile' });

        auditResults.directories.forEach(dir => {
            if (dir.desktop) allAudits.push({ ...dir.desktop, location: dir.directory, viewport: 'desktop' });
            if (dir.mobile) allAudits.push({ ...dir.mobile, location: dir.directory, viewport: 'mobile' });
        });

        const successfulAudits = allAudits.filter(a => a.success);

        if (successfulAudits.length > 0) {
            // Calculate averages
            const contentScores = successfulAudits
                .map(a => a.modules?.contentAnalyzer?.data?.qualityScore)
                .filter(s => s !== undefined);

            const adScores = successfulAudits
                .map(a => a.modules?.adAnalyzer?.data?.densityScore)
                .filter(s => s !== undefined);

            const technicalScores = successfulAudits
                .map(a => a.modules?.technicalChecker?.data?.healthScore)
                .filter(s => s !== undefined);

            const policyScores = successfulAudits
                .map(a => a.modules?.policyChecker?.data?.complianceScore)
                .filter(s => s !== undefined);

            aggregated.aggregatedScores.avgContentQuality =
                contentScores.length > 0
                    ? contentScores.reduce((sum, s) => sum + s, 0) / contentScores.length
                    : 0;

            aggregated.aggregatedScores.avgAdDensity =
                adScores.length > 0
                    ? adScores.reduce((sum, s) => sum + s, 0) / adScores.length
                    : 0;

            aggregated.aggregatedScores.avgTechnicalScore =
                technicalScores.length > 0
                    ? technicalScores.reduce((sum, s) => sum + s, 0) / technicalScores.length
                    : 0;

            aggregated.aggregatedScores.avgPolicyCompliance =
                policyScores.length > 0
                    ? policyScores.reduce((sum, s) => sum + s, 0) / policyScores.length
                    : 0;
        }

        // Location breakdown
        aggregated.locationBreakdown = allAudits.map(audit => ({
            location: audit.location,
            url: audit.url,
            viewport: audit.viewport,
            success: audit.success,
            modulesRun: Object.keys(audit.modules || {}).length
        }));

        return aggregated;
    }
}

module.exports = DirectoryAuditOrchestrator;
