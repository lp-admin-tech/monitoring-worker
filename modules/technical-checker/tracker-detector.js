/**
 * TrackerDetector - Third-party tracker and analytics detection
 * Categorizes and counts tracking scripts for MFA detection
 */
const logger = require('../logger');

class TrackerDetector {
    constructor(config = {}) {
        // Comprehensive tracker domain lists by category
        this.trackerDomains = {
            // Analytics & Measurement
            analytics: [
                'google-analytics.com', 'googletagmanager.com', 'analytics.google.com',
                'hotjar.com', 'clarity.ms', 'mouseflow.com', 'fullstory.com',
                'heap.io', 'mixpanel.com', 'amplitude.com', 'segment.io',
                'plausible.io', 'matomo.', 'piwik.', 'chartbeat.com',
                'quantserve.com', 'scorecardresearch.com', 'comscore.com',
                'newrelic.com', 'nr-data.net', 'optimizely.com', 'omtrdc.net',
            ],

            // Advertising Networks
            advertising: [
                'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
                'googleads.g.doubleclick.net', 'pagead2.googlesyndication.com',
                'adnxs.com', 'adsrvr.org', 'rubiconproject.com', 'pubmatic.com',
                'openx.net', 'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com',
                'mgid.com', 'revcontent.com', 'amazon-adsystem.com', 'media.net',
                'bidswitch.net', 'casalemedia.com', 'contextweb.com', 'lijit.com',
                'indexww.com', 'sharethrough.com', 'triplelift.com', 'teads.tv',
                'yieldmo.com', 'spotxchange.com', 'springserve.com', 'adroll.com',
                'mopub.com', 'applovin.com', 'unity3d.com', 'ironsrc.com',
            ],

            // Social Media Trackers
            social: [
                'facebook.net', 'facebook.com', 'fbcdn.net', 'connect.facebook.net',
                'twitter.com', 'twimg.com', 'platform.twitter.com',
                'linkedin.com', 'licdn.com', 'snap.licdn.com',
                'pinterest.com', 'pinimg.com', 'tiktok.com', 'byteoversea.com',
                'instagram.com', 'cdninstagram.com', 'reddit.com', 'redditstatic.com',
            ],

            // Fingerprinting & Identification
            fingerprinting: [
                'fingerprintjs.com', 'ipify.org', 'ipinfo.io', 'ipapi.co',
                'deviceatlas.com', 'iovation.com', 'threatmetrix.com',
                'bluecava.com', 'addthis.com', 'sharethis.com',
            ],

            // Retargeting & Remarketing
            retargeting: [
                'adsymptotic.com', 'adform.net', 'demdex.net', 'bluekai.com',
                'exelator.com', 'crwdcntrl.net', 'rlcdn.com', 'rfihub.com',
                'eyeota.net', 'tapad.com', 'liveramp.com', 'acxiom.com',
            ],

            // Content Recommendation (Often MFA)
            contentRec: [
                'taboola.com', 'outbrain.com', 'revcontent.com', 'mgid.com',
                'content.ad', 'contentabc.com', 'nativo.com', 'dianomi.com',
                'zergnet.com', 'adblade.com', 'nrelate.com',
            ],

            // Video Ad Networks
            videoAds: [
                'moatads.com', 'doubleverify.com', 'iasds01.com', 'adsafeprotected.com',
                'jwpcdn.com', 'jwplayer.com', 'brightcove.com', 'vidazoo.com',
                'connatix.com', 'primis.tech', 'ex.co', 'aniview.com',
            ],
        };

        // Risk weights by category
        this.categoryRisk = {
            analytics: 0.05,      // Normal, low risk
            advertising: 0.15,    // Expected on monetized sites
            social: 0.08,         // Common, low-medium risk
            fingerprinting: 0.25, // Suspicious
            retargeting: 0.20,    // High correlation with MFA
            contentRec: 0.30,     // Strong MFA signal
            videoAds: 0.18,       // Medium-high risk
        };

        this.thresholds = {
            maxTotalTrackers: 15,      // More than this is suspicious
            maxAdNetworks: 5,          // More ad networks = MFA signal
            maxContentRec: 2,          // Multiple content rec = strong MFA
            warningTotal: 10,
        };
    }

    /**
     * Analyze network requests for trackers
     * @param {Array} networkRequests - Array of network request objects
     * @param {string} siteUrl - The main site URL
     * @returns {Object} Tracker analysis results
     */
    analyze(networkRequests, siteUrl) {
        const startTime = Date.now();

        logger.info('[TrackerDetector] Starting tracker analysis', {
            siteUrl,
            requestCount: networkRequests?.length || 0,
        });

        try {
            if (!networkRequests || !Array.isArray(networkRequests)) {
                logger.warn('[TrackerDetector] No network requests provided', { siteUrl });
                return this.getEmptyAnalysis();
            }

            const siteDomain = this.extractDomain(siteUrl);
            logger.debug('[TrackerDetector] Extracted site domain', { siteDomain });

            const trackersByCategory = {};
            const detectedTrackers = [];
            const thirdPartyDomains = new Set();

            // Initialize categories
            Object.keys(this.trackerDomains).forEach(cat => {
                trackersByCategory[cat] = { count: 0, domains: [] };
            });

            // Analyze each request
            let analyzedCount = 0;
            for (const request of networkRequests) {
                const url = request.url || '';
                const domain = this.extractDomain(url);

                if (!domain || domain === siteDomain) continue;
                analyzedCount++;

                // Check if third-party
                if (!url.includes(siteDomain)) {
                    thirdPartyDomains.add(domain);
                }

                // Check against tracker lists
                for (const [category, domains] of Object.entries(this.trackerDomains)) {
                    for (const trackerDomain of domains) {
                        if (url.includes(trackerDomain)) {
                            if (!trackersByCategory[category].domains.includes(trackerDomain)) {
                                trackersByCategory[category].count++;
                                trackersByCategory[category].domains.push(trackerDomain);
                                detectedTrackers.push({
                                    domain: trackerDomain,
                                    category,
                                    url: url.substring(0, 100),
                                });
                                logger.debug('[TrackerDetector] Detected tracker', {
                                    domain: trackerDomain,
                                    category,
                                });
                            }
                            break;
                        }
                    }
                }
            }

            logger.debug('[TrackerDetector] Request analysis complete', {
                totalRequests: networkRequests.length,
                thirdPartyRequests: analyzedCount,
                thirdPartyDomains: thirdPartyDomains.size,
            });

            // Calculate metrics
            const totalTrackers = detectedTrackers.length;
            const uniqueTrackerDomains = new Set(detectedTrackers.map(t => t.domain)).size;

            // Calculate risk score
            let riskScore = 0;
            for (const [category, data] of Object.entries(trackersByCategory)) {
                riskScore += data.count * this.categoryRisk[category];
            }
            riskScore = Math.min(1, riskScore / 10); // Normalize to 0-1

            // MFA indicators
            const adNetworkCount = trackersByCategory.advertising.count;
            const contentRecCount = trackersByCategory.contentRec.count;
            const isMfaSignal = (
                totalTrackers > this.thresholds.maxTotalTrackers ||
                adNetworkCount > this.thresholds.maxAdNetworks ||
                contentRecCount > this.thresholds.maxContentRec
            );

            const problems = this.identifyProblems(trackersByCategory, totalTrackers);

            const result = {
                timestamp: new Date().toISOString(),
                summary: {
                    totalTrackers,
                    uniqueTrackerDomains,
                    thirdPartyDomainCount: thirdPartyDomains.size,
                    riskScore: Math.round(riskScore * 1000) / 1000,
                    riskLevel: this.getRiskLevel(riskScore),
                    isMfaSignal,
                },
                byCategory: trackersByCategory,
                metrics: {
                    analyticsCount: trackersByCategory.analytics.count,
                    advertisingCount: trackersByCategory.advertising.count,
                    socialCount: trackersByCategory.social.count,
                    fingerprintingCount: trackersByCategory.fingerprinting.count,
                    retargetingCount: trackersByCategory.retargeting.count,
                    contentRecCount: trackersByCategory.contentRec.count,
                    videoAdCount: trackersByCategory.videoAds.count,
                },
                detectedTrackers: detectedTrackers.slice(0, 50), // Limit for storage
                problems,
            };

            const duration = Date.now() - startTime;
            logger.info('[TrackerDetector] Analysis complete', {
                siteUrl,
                duration: `${duration}ms`,
                totalTrackers,
                adNetworks: adNetworkCount,
                contentRec: contentRecCount,
                riskScore: result.summary.riskScore,
                riskLevel: result.summary.riskLevel,
                isMfaSignal,
                problemCount: problems.length,
            });

            if (isMfaSignal) {
                logger.warn('[TrackerDetector] MFA SIGNAL DETECTED', {
                    siteUrl,
                    totalTrackers,
                    adNetworkCount,
                    contentRecCount,
                    problems: problems.map(p => p.message),
                });
            }

            return result;
        } catch (error) {
            logger.error('[TrackerDetector] Analysis failed', {
                siteUrl,
                error: error.message,
                stack: error.stack,
            });
            return {
                ...this.getEmptyAnalysis(),
                error: error.message,
            };
        }
    }

    extractDomain(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.replace(/^www\./, '');
        } catch {
            return '';
        }
    }

    getRiskLevel(score) {
        if (score < 0.2) return 'low';
        if (score < 0.4) return 'medium';
        if (score < 0.6) return 'high';
        return 'critical';
    }

    identifyProblems(byCategory, totalTrackers) {
        const problems = [];

        if (totalTrackers > this.thresholds.maxTotalTrackers) {
            problems.push({
                severity: 'critical',
                message: `Excessive trackers detected: ${totalTrackers} (threshold: ${this.thresholds.maxTotalTrackers})`,
                category: 'tracker_overload',
            });
        } else if (totalTrackers > this.thresholds.warningTotal) {
            problems.push({
                severity: 'warning',
                message: `High tracker count: ${totalTrackers}`,
                category: 'tracker_warning',
            });
        }

        if (byCategory.advertising.count > this.thresholds.maxAdNetworks) {
            problems.push({
                severity: 'critical',
                message: `Multiple ad networks detected: ${byCategory.advertising.count} (MFA indicator)`,
                category: 'ad_network_stacking',
            });
        }

        if (byCategory.contentRec.count > this.thresholds.maxContentRec) {
            problems.push({
                severity: 'critical',
                message: `Multiple content recommendation widgets: ${byCategory.contentRec.count} (strong MFA signal)`,
                category: 'content_rec_abuse',
            });
        }

        if (byCategory.fingerprinting.count > 0) {
            problems.push({
                severity: 'high',
                message: `Fingerprinting trackers detected: ${byCategory.fingerprinting.count}`,
                category: 'fingerprinting',
            });
        }

        return problems;
    }

    getEmptyAnalysis() {
        return {
            timestamp: new Date().toISOString(),
            summary: {
                totalTrackers: 0,
                uniqueTrackerDomains: 0,
                thirdPartyDomainCount: 0,
                riskScore: 0,
                riskLevel: 'low',
                isMfaSignal: false,
            },
            byCategory: Object.keys(this.trackerDomains).reduce((acc, cat) => {
                acc[cat] = { count: 0, domains: [] };
                return acc;
            }, {}),
            metrics: {
                analyticsCount: 0,
                advertisingCount: 0,
                socialCount: 0,
                fingerprintingCount: 0,
                retargetingCount: 0,
                contentRecCount: 0,
                videoAdCount: 0,
            },
            detectedTrackers: [],
            problems: [],
        };
    }

    mergeResults(analysisResult) {
        return {
            trackerCount: analysisResult.summary?.totalTrackers || 0,
            trackerRiskScore: analysisResult.summary?.riskScore || 0,
            adNetworkCount: analysisResult.metrics?.advertisingCount || 0,
            contentRecCount: analysisResult.metrics?.contentRecCount || 0,
            isMfaTrackerSignal: analysisResult.summary?.isMfaSignal || false,
        };
    }
}

module.exports = TrackerDetector;
