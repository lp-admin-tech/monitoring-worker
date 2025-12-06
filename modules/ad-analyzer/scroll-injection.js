const logger = require('../logger');

/**
 * ScrollInjectionDetector - Detect ads injected during scroll
 * MFA sites often inject additional ads as users scroll to maximize impressions
 */
class ScrollInjectionDetector {
    constructor(config = {}) {
        // Thresholds for MFA detection
        this.lazyLoadThreshold = config.lazyLoadThreshold || 5; // Normal lazy load limit
        this.criticalInjectionThreshold = config.criticalInjectionThreshold || 10;
        this.adInjectionRatioThreshold = config.adInjectionRatioThreshold || 0.3; // 30% new ads = suspicious
    }

    /**
     * Analyze mutation log for scroll-triggered ad injection patterns
     */
    analyzeScrollInjection(crawlData) {
        try {
            const mutationLog = crawlData.mutationLog || [];
            const scrollEvents = crawlData.scrollEvents || [];
            const adElements = crawlData.adElements || [];

            // Track ads added during/after scroll events
            const scrollTriggeredAds = [];
            const timeWindowMs = 2000; // 2 second window after scroll

            for (const mutation of mutationLog) {
                if (mutation.type !== 'ADDED') continue;

                // Check if this is an ad-related element
                const isAdElement = this.isLikelyAdElement(mutation.target || '', mutation.attributes || {});
                if (!isAdElement) continue;

                // Check if it occurred near a scroll event
                const nearScroll = scrollEvents.some(scroll =>
                    Math.abs((scroll.timestamp || 0) - (mutation.timestamp || 0)) < timeWindowMs
                );

                if (nearScroll) {
                    scrollTriggeredAds.push({
                        timestamp: mutation.timestamp,
                        selector: mutation.target,
                        type: 'scroll_triggered'
                    });
                }
            }

            // Analyze ad injection patterns
            const injectionAnalysis = this.analyzeInjectionPatterns(mutationLog, adElements);

            // Calculate metrics
            const totalAdsOnPage = adElements.length;
            const scrollInjectedCount = scrollTriggeredAds.length;
            const injectionRatio = totalAdsOnPage > 0 ? scrollInjectedCount / totalAdsOnPage : 0;

            const problems = [];

            // Check for excessive scroll-triggered ads
            if (scrollInjectedCount > this.lazyLoadThreshold) {
                problems.push({
                    severity: scrollInjectedCount > this.criticalInjectionThreshold ? 'critical' : 'high',
                    type: 'scroll_ad_injection',
                    message: `Detected ${scrollInjectedCount} ads injected during scroll (threshold: ${this.lazyLoadThreshold})`,
                    recommendation: 'Reduce scroll-triggered ad insertion to improve user experience'
                });
            }

            // Check for high injection ratio
            if (injectionRatio > this.adInjectionRatioThreshold) {
                problems.push({
                    severity: 'high',
                    type: 'high_injection_ratio',
                    message: `${Math.round(injectionRatio * 100)}% of ads were injected during scroll`,
                    recommendation: 'High proportion of dynamically loaded ads indicates MFA behavior'
                });
            }

            // Check for injection bursts
            if (injectionAnalysis.burstCount > 0) {
                problems.push({
                    severity: 'medium',
                    type: 'injection_burst',
                    message: `Detected ${injectionAnalysis.burstCount} ad injection burst(s)`,
                    recommendation: 'Avoid injecting multiple ads simultaneously'
                });
            }

            const riskScore = this.calculateScrollInjectionRisk({
                scrollInjectedCount,
                injectionRatio,
                burstCount: injectionAnalysis.burstCount,
                totalAds: totalAdsOnPage
            });

            return {
                metrics: {
                    scrollInjectedAdCount: scrollInjectedCount,
                    totalAdsOnPage,
                    injectionRatio: Math.round(injectionRatio * 100),
                    injectionBursts: injectionAnalysis.burstCount,
                    averageInjectionInterval: injectionAnalysis.avgInterval,
                    scrollTriggeredAds
                },
                problems,
                summary: {
                    scrollInjectionDetected: scrollInjectedCount > this.lazyLoadThreshold,
                    excessiveInjection: injectionRatio > this.adInjectionRatioThreshold,
                    riskScore,
                    isMfaLikely: riskScore > 0.5
                }
            };

        } catch (error) {
            logger.error('Error analyzing scroll injection', error);
            return { error: error.message, metrics: {}, summary: {} };
        }
    }

    /**
     * Check if a selector/element looks like an ad
     */
    isLikelyAdElement(selector, attributes = {}) {
        const adPatterns = [
            /ad[-_]?slot/i, /ad[-_]?unit/i, /ad[-_]?container/i,
            /google[-_]?ad/i, /dfp[-_]?ad/i, /gpt[-_]?ad/i,
            /doubleclick/i, /adsense/i, /adsbygoogle/i,
            /sponsored/i, /advertisement/i
        ];

        const selectorMatch = adPatterns.some(p => p.test(selector));
        const idMatch = attributes.id && adPatterns.some(p => p.test(attributes.id));
        const classMatch = attributes.class && adPatterns.some(p => p.test(attributes.class));

        return selectorMatch || idMatch || classMatch;
    }

    /**
     * Analyze injection patterns to detect bursts and timing
     */
    analyzeInjectionPatterns(mutationLog, adElements) {
        const adMutations = mutationLog.filter(m =>
            m.type === 'ADDED' && this.isLikelyAdElement(m.target || '', m.attributes || {})
        ).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        let burstCount = 0;
        let totalInterval = 0;
        let intervalCount = 0;
        const burstWindowMs = 500; // Ads added within 500ms = burst

        for (let i = 1; i < adMutations.length; i++) {
            const interval = (adMutations[i].timestamp || 0) - (adMutations[i - 1].timestamp || 0);
            totalInterval += interval;
            intervalCount++;

            // Detect burst (multiple ads added rapidly)
            if (interval < burstWindowMs) {
                // Look ahead to count burst size
                let burstSize = 2;
                while (i + burstSize - 1 < adMutations.length) {
                    const nextInterval = (adMutations[i + burstSize - 1].timestamp || 0) -
                        (adMutations[i + burstSize - 2].timestamp || 0);
                    if (nextInterval < burstWindowMs) burstSize++;
                    else break;
                }

                if (burstSize >= 3) burstCount++;
                i += burstSize - 2; // Skip processed items
            }
        }

        return {
            burstCount,
            avgInterval: intervalCount > 0 ? Math.round(totalInterval / intervalCount) : 0
        };
    }

    calculateScrollInjectionRisk(metrics) {
        let score = 0;

        // Base score from injection count
        if (metrics.scrollInjectedCount > this.criticalInjectionThreshold) score += 0.4;
        else if (metrics.scrollInjectedCount > this.lazyLoadThreshold) score += 0.25;
        else if (metrics.scrollInjectedCount > 2) score += 0.1;

        // Injection ratio impact
        if (metrics.injectionRatio > 0.5) score += 0.3;
        else if (metrics.injectionRatio > 0.3) score += 0.2;
        else if (metrics.injectionRatio > 0.15) score += 0.1;

        // Burst behavior
        if (metrics.burstCount > 2) score += 0.2;
        else if (metrics.burstCount > 0) score += 0.1;

        return Math.min(1, score);
    }

    /**
     * Generate report combining with crawlData
     */
    generateReport(crawlData) {
        return this.analyzeScrollInjection(crawlData);
    }
}

module.exports = ScrollInjectionDetector;
