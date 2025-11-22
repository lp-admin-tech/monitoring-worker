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

            // Create new browser context and page
            context = await this.crawler.browser.newContext({
                userAgent: this.crawler.getRandomUserAgent(),
                viewport: this.crawler.viewports[0],
                extraHTTPHeaders: {
                    'Accept-Language': 'en-US,en;q=0.9',
                },
            });
            page = await context.newPage();

            const auditResults = {
                publisherId: publisher.id,
                siteAuditId,
                mainSite: null,
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

            // Navigate to main site first
            await page.goto(publisher.site_url, {
                waitUntil: 'networkidle',
                timeout: 60000
            }).catch(() => {
                logger.warn(`Navigation timeout for ${publisher.site_url}, continuing with partial load`);
            });

            // 1. Detect if it's a directory website
            logger.info('Detecting directory website', { publisherId: publisher.id });
            const detection = await directoryDetector.detectDirectory(page);
            auditResults.directoryDetection = detection;

            // 2. Extract directory data if it's a directory
            let directoryData = null;
            if (detection.isDirectory) {
                logger.info('Directory detected, extracting data', {
                    type: detection.directoryType,
                    confidence: detection.confidence
                });
                directoryData = await directoryDetector.extractDirectoryData(page);
            }

            // 3. Run full audit on main site
            logger.info('Running audit on main site', { url: publisher.site_url });
            const mainAudit = await this.runFullAudit(
                publisher.site_url,
                publisher.id,
                siteAuditId,
                page,
                'main'
            );
            auditResults.mainSite = mainAudit;

            if (mainAudit.success) {
                auditResults.summary.successfulAudits++;
            } else {
                auditResults.summary.failedAudits++;
            }

            // 4. Discover all directories
            logger.info('Discovering directories', { url: publisher.site_url });
            const discoveredDirs = await this.discoverDirectories(page, publisher.site_url);
            const specifiedDirs = publisher.subdirectories || [];
            const allDirs = new Set([...specifiedDirs, ...discoveredDirs]);
            const directoriesToAudit = Array.from(allDirs);

            auditResults.summary.totalDirectories = directoriesToAudit.length;

            logger.info(`Found ${directoriesToAudit.length} directories to audit`, {
                discovered: discoveredDirs.length,
                specified: specifiedDirs.length,
                directories: directoriesToAudit
            });

            // 5. Run full audit on each directory
            for (const directory of directoriesToAudit) {
                try {
                    const directoryUrl = `${publisher.site_url}${directory}`.replace(/\/+/g, '/');
                    const directoryUrl2 = directoryUrl.replace(':/', '://'); // Fix protocol

                    logger.info(`Running audit on directory: ${directory}`, {
                        url: directoryUrl2
                    });

                    // Navigate to directory
                    await page.goto(directoryUrl2, {
                        waitUntil: 'networkidle',
                        timeout: 60000
                    }).catch(() => {
                        logger.warn(`Navigation timeout for ${directoryUrl2}, continuing with partial load`);
                    });

                    // Run full audit
                    const directoryAudit = await this.runFullAudit(
                        directoryUrl2,
                        publisher.id,
                        siteAuditId,
                        page,
                        directory
                    );

                    auditResults.directories.push({
                        directory,
                        url: directoryUrl2,
                        ...directoryAudit
                    });

                    if (directoryAudit.success) {
                        auditResults.summary.successfulAudits++;
                    } else {
                        auditResults.summary.failedAudits++;
                    }

                } catch (error) {
                    logger.error(`Failed to audit directory: ${directory}`, error);
                    auditResults.directories.push({
                        directory,
                        success: false,
                        error: error.message
                    });
                    auditResults.summary.failedAudits++;
                }
            }

            auditResults.summary.totalDuration = Date.now() - startTime;

            logger.info('Directory-aware audit completed', {
                publisherId: publisher.id,
                totalDirectories: auditResults.summary.totalDirectories,
                successful: auditResults.summary.successfulAudits,
                failed: auditResults.summary.failedAudits,
                duration: auditResults.summary.totalDuration
            });

            return auditResults;

        } catch (error) {
            logger.error('Directory-aware audit failed', error);
            throw error;
        } finally {
            if (page) await page.close().catch(() => { });
            if (context) await context.close().catch(() => { });
        }
    }

    /**
     * Run all analysis modules on a single URL
     */
    async runFullAudit(url, publisherId, siteAuditId, page, location = 'main') {
        const auditStartTime = Date.now();
        const results = {
            url,
            location,
            success: false,
            modules: {},
            errors: [],
            duration: 0
        };

        try {
            logger.info(`Running full audit for ${location}`, { url });

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
                viewport: 'desktop'
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
                        return await this.adAnalyzer.processPublisher(crawlData, { width: 1920, height: 1080 });
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

        // Aggregate scores from all locations
        const allAudits = [auditResults.mainSite, ...auditResults.directories];
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
            location: audit.location || audit.directory || 'main',
            url: audit.url,
            success: audit.success,
            modulesRun: Object.keys(audit.modules || {}).length
        }));

        return aggregated;
    }
}

module.exports = DirectoryAuditOrchestrator;
