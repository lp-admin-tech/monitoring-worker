/**
 * CDP Crawler - Main Entry Point
 * Combines all components into a unified MFA detection crawler
 */

const ChromeCDPClient = require('./chrome-client');
const AntiDetect = require('./anti-detect');
const HumanSimulator = require('./human-simulator');
const NetworkInterceptor = require('./network-interceptor');
const AdHeatmapGenerator = require('./ad-heatmap');
const logger = require('../logger');

// Default fingerprint profiles
const FINGERPRINT_PROFILES = {
    desktop: {
        platform: 'Win32',
        languages: ['en-US', 'en'],
        cores: 8,
        memory: 8,
        isMobile: false,
        webglVendor: 'Google Inc. (Intel)',
        webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'
    },
    mobile: {
        platform: 'Linux armv8l',
        languages: ['en-US'],
        cores: 8,
        memory: 4,
        isMobile: true,
        webglVendor: 'Qualcomm',
        webglRenderer: 'Adreno (TM) 650'
    }
};

class CDPCrawler {
    constructor(options = {}) {
        this.options = {
            fingerprint: options.fingerprint || 'desktop',
            timeout: options.timeout || 60000,
            scrollDuration: options.scrollDuration || 30000,
            ...options
        };

        this.chromeClient = null;
        this.client = null;
        this.antiDetect = null;
        this.humanSimulator = null;
        this.networkInterceptor = null;
        this.adHeatmap = null;
    }

    async launch(proxyUrl = null) {
        logger.info('[CDPCrawler] Launching crawler...');

        // Create Chrome client
        this.chromeClient = new ChromeCDPClient({
            headless: true,
            proxy: proxyUrl
        });

        // Launch Chrome and connect
        this.client = await this.chromeClient.launch();

        // Initialize components
        this.antiDetect = new AntiDetect(this.client);
        this.humanSimulator = new HumanSimulator(this.client);
        this.networkInterceptor = new NetworkInterceptor(this.client);
        this.adHeatmap = new AdHeatmapGenerator(this.client);

        // Get fingerprint profile
        const profile = typeof this.options.fingerprint === 'string'
            ? FINGERPRINT_PROFILES[this.options.fingerprint] || FINGERPRINT_PROFILES.desktop
            : this.options.fingerprint;

        // Apply anti-detect patches
        await this.antiDetect.applyAll(profile);

        // Start network interception
        await this.networkInterceptor.start();

        logger.info('[CDPCrawler] Crawler ready');
        return this;
    }

    async crawl(url, options = {}) {
        const { fullHeatmap = true, simulateBrowsing = true } = options;

        logger.info(`[CDPCrawler] Crawling: ${url}`);
        const startTime = Date.now();

        try {
            // Navigate to page
            const navigated = await this.chromeClient.navigate(url, {
                timeout: this.options.timeout
            });

            if (!navigated) {
                throw new Error('Navigation failed');
            }

            // Wait for dynamic content
            await this.humanSimulator.wait(2000, 4000);

            // Generate ad heatmap (with scroll)
            let heatmapData = null;
            if (fullHeatmap) {
                heatmapData = await this.adHeatmap.generateFullHeatmap(this.humanSimulator);
            } else {
                heatmapData = await this.adHeatmap.quickScan();
            }

            // Additional browsing simulation
            if (simulateBrowsing) {
                await this.humanSimulator.randomMouseMovement(3000);
            }

            // Extract content
            const content = await this.extractContent();

            // Get network analysis
            const networkAnalysis = this.networkInterceptor.getAnalysis();

            // Calculate combined MFA indicators
            const mfaIndicators = this.calculateMFAIndicators(heatmapData, networkAnalysis);

            const duration = Date.now() - startTime;
            logger.info(`[CDPCrawler] Crawl complete in ${duration}ms`, {
                url,
                mfaScore: mfaIndicators.combinedScore,
                adCount: heatmapData.totalAdsDetected,
                adNetworks: networkAnalysis.adNetworkCount
            });

            return {
                url,
                success: true,
                duration,
                content,
                contentLength: content?.length || 0,
                networkAnalysis,
                adHeatmap: heatmapData,
                mfaIndicators,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            logger.error(`[CDPCrawler] Crawl failed: ${url}`, { error: error.message });
            return {
                url,
                success: false,
                error: error.message,
                duration: Date.now() - startTime,
                timestamp: new Date().toISOString()
            };
        }
    }

    async extractContent() {
        try {
            const content = await this.chromeClient.evaluate(`
        (() => {
          // Remove scripts and styles
          const clone = document.body.cloneNode(true);
          clone.querySelectorAll('script, style, noscript, iframe').forEach(el => el.remove());
          
          // Get text content
          return clone.innerText
            .replace(/\\s+/g, ' ')
            .trim()
            .substring(0, 50000);
        })()
      `);
            return content;
        } catch (error) {
            logger.warn('[CDPCrawler] Content extraction failed:', error.message);
            return '';
        }
    }

    calculateMFAIndicators(heatmapData, networkAnalysis) {
        const heatmapScore = heatmapData.mfaScore || 0;
        const networkScore = networkAnalysis.networkRiskScore || 0;

        // Weight: heatmap 60%, network 40%
        const combinedScore = Math.round(heatmapScore * 0.6 + networkScore * 0.4);

        // Compile all suspicious patterns
        const suspiciousPatterns = [
            ...(networkAnalysis.suspiciousPatterns?.map(p => p.type) || [])
        ];

        if (heatmapData.infiniteAdsPattern) {
            suspiciousPatterns.push('INFINITE_SCROLL_MFA');
        }
        if (heatmapData.scrollTrapDetected) {
            suspiciousPatterns.push('HIGH_AD_DENSITY');
        }
        if (heatmapData.avgCLS > 0.1) {
            suspiciousPatterns.push('HIGH_LAYOUT_SHIFT');
        }

        return {
            // Scores
            heatmapScore,
            networkScore,
            combinedScore,

            // Key metrics
            adDensity: heatmapData.avgAdDensity,
            layoutShift: heatmapData.avgCLS,
            adsAboveFold: heatmapData.adsAboveFold,
            totalAds: heatmapData.totalAdsDetected,
            adNetworkCount: networkAnalysis.adNetworkCount,

            // Patterns detected
            hasAutoRefresh: networkAnalysis.hasAutoRefresh,
            infiniteScrollMFA: heatmapData.infiniteAdsPattern,
            scrollTrap: heatmapData.scrollTrapDetected,
            suspiciousPatterns,

            // Risk level
            riskLevel: combinedScore >= 70 ? 'HIGH' :
                combinedScore >= 40 ? 'MEDIUM' : 'LOW'
        };
    }

    async screenshot(options = {}) {
        return this.chromeClient.screenshot(options);
    }

    async close() {
        logger.info('[CDPCrawler] Closing crawler...');
        await this.chromeClient?.close();
        this.client = null;
        this.chromeClient = null;
    }

    isConnected() {
        return this.chromeClient?.isConnected() || false;
    }
}

// Export both class and factory function
module.exports = CDPCrawler;
module.exports.CDPCrawler = CDPCrawler;
module.exports.FINGERPRINT_PROFILES = FINGERPRINT_PROFILES;
