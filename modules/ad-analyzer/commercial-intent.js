/**
 * CommercialIntentDetector - Detect monetization patterns and commercial signals
 * Strong MFA indicator when combined with low content quality
 */
const logger = require('../logger');

class CommercialIntentDetector {
    constructor(config = {}) {
        // Affiliate network patterns
        this.affiliatePatterns = {
            amazon: [
                'amazon.com/gp/product', 'amzn.to', 'amazon.com/dp/',
                'affiliate-program.amazon', 'assoc-amazon.com',
                'amazon.com?tag=', 'amazon.com&tag=',
            ],
            clickbank: ['clickbank.net', 'hop.clickbank.net'],
            shareasale: ['shareasale.com', 'shareasale-analytics.com'],
            cj: ['cj.com', 'commission-junction', 'dpbolvw.net', 'jdoqocy.com', 'kqzyfj.com'],
            rakuten: ['rakuten.com', 'linksynergy.com'],
            impact: ['impactradius.com', 'impact.com', 'sjv.io'],
            awin: ['awin1.com', 'zenaps.com'],
            flexOffers: ['flexoffers.com', 'flexlinks.com'],
            other: [
                'anrdoezrs.net', 'tkqlhce.com', 'lduhtrp.net', 'avantlink.com',
                'pepperjam.com', 'partnerize.com', 'go2cloud.org',
            ],
        };

        // Pop-up and interstitial patterns
        this.aggressiveMonetizationPatterns = [
            'popunder', 'pop-under', 'popads', 'popcash', 'propellerads',
            'exoclick', 'trafficjunky', 'clickadu', 'adsterra',
            'interstitial', 'overlay-ad', 'exit-intent', 'welcome-mat',
            'pushcrew', 'pushengage', 'onesignal', 'webpush',
        ];

        // Email/lead capture patterns
        this.leadGenPatterns = [
            'mailchimp', 'convertkit', 'aweber', 'getresponse',
            'activecampaign', 'klaviyo', 'hubspot', 'optinmonster',
            'sumo.com', 'sumome', 'leadpages', 'unbounce',
            'signup', 'subscribe', 'newsletter', 'email-capture',
        ];

        // Sponsored content identifiers
        this.sponsoredPatterns = [
            'sponsored', 'promotion', 'ad-container', 'native-ad',
            'paid-post', 'partner-content', 'branded-content',
        ];
    }

    /**
     * Analyze page for commercial intent signals
     * @param {Object} crawlData - Crawler output with scripts, links, HTML
     * @param {Array} adElements - Detected ad elements
     * @returns {Object} Commercial intent analysis
     */
    analyze(crawlData, adElements = []) {
        const startTime = Date.now();
        const siteUrl = crawlData?.url || crawlData?.siteUrl || 'unknown';

        logger.info('[CommercialIntent] Starting commercial intent analysis', {
            siteUrl,
            hasScripts: !!(crawlData?.scripts?.length),
            hasLinks: !!(crawlData?.links?.length),
            adElementCount: adElements?.length || 0,
        });

        try {
            const scripts = crawlData?.scripts || [];
            const iframes = crawlData?.iframes || [];
            const links = crawlData?.links || [];
            const htmlContent = crawlData?.htmlContent || crawlData?.content || '';
            const networkRequests = crawlData?.networkRequests || [];

            logger.debug('[CommercialIntent] Input data summary', {
                scriptsCount: scripts.length,
                iframesCount: iframes.length,
                linksCount: links.length,
                htmlLength: htmlContent.length,
                networkRequestsCount: networkRequests.length,
            });

            // Analyze affiliate links
            const affiliateAnalysis = this.detectAffiliateLinks(links, htmlContent, networkRequests);
            logger.debug('[CommercialIntent] Affiliate analysis complete', {
                totalLinks: affiliateAnalysis.totalAffiliateLinks,
                isHeavy: affiliateAnalysis.isHeavilyAffiliated,
            });

            // Analyze aggressive monetization
            const aggressiveMonetization = this.detectAggressiveMonetization(scripts, iframes, htmlContent);
            logger.debug('[CommercialIntent] Aggressive monetization check', {
                patterns: aggressiveMonetization.detectedPatterns,
                hasPopups: aggressiveMonetization.hasPopups,
            });

            // Analyze lead gen patterns
            const leadGen = this.detectLeadGeneration(scripts, htmlContent);

            // Analyze ad network diversity
            const adNetworkDiversity = this.analyzeAdNetworkDiversity(adElements, scripts);
            logger.debug('[CommercialIntent] Ad network diversity', {
                networks: adNetworkDiversity.networks,
                count: adNetworkDiversity.networkCount,
            });

            // Calculate commercial intent score (0-1, higher = more commercial)
            const commercialScore = this.calculateCommercialScore({
                affiliate: affiliateAnalysis,
                aggressive: aggressiveMonetization,
                leadGen,
                adDiversity: adNetworkDiversity,
            });

            // MFA signal: high commercial + multiple signals
            const isMfaSignal = (
                commercialScore > 0.6 ||
                affiliateAnalysis.totalAffiliateLinks > 10 ||
                adNetworkDiversity.networkCount > 4 ||
                aggressiveMonetization.hasPopups
            );

            const problems = this.identifyProblems(affiliateAnalysis, aggressiveMonetization, adNetworkDiversity);

            const result = {
                timestamp: new Date().toISOString(),
                summary: {
                    commercialScore: Math.round(commercialScore * 1000) / 1000,
                    intentLevel: this.getIntentLevel(commercialScore),
                    isMfaSignal,
                    primaryMonetization: this.detectPrimaryMonetization(affiliateAnalysis, adNetworkDiversity),
                },
                affiliateLinks: affiliateAnalysis,
                aggressiveMonetization,
                leadGeneration: leadGen,
                adNetworkDiversity,
                problems,
            };

            const duration = Date.now() - startTime;
            logger.info('[CommercialIntent] Analysis complete', {
                siteUrl,
                duration: `${duration}ms`,
                commercialScore: result.summary.commercialScore,
                intentLevel: result.summary.intentLevel,
                isMfaSignal,
                affiliateCount: affiliateAnalysis.totalAffiliateLinks,
                adNetworks: adNetworkDiversity.networkCount,
                hasPopups: aggressiveMonetization.hasPopups,
                problemCount: problems.length,
            });

            if (isMfaSignal) {
                logger.warn('[CommercialIntent] MFA SIGNAL DETECTED', {
                    siteUrl,
                    commercialScore: result.summary.commercialScore,
                    affiliateLinks: affiliateAnalysis.totalAffiliateLinks,
                    adNetworks: adNetworkDiversity.networks,
                    hasPopups: aggressiveMonetization.hasPopups,
                    problems: problems.map(p => p.message),
                });
            }

            return result;
        } catch (error) {
            logger.error('[CommercialIntent] Analysis failed', {
                siteUrl,
                error: error.message,
                stack: error.stack,
            });
            return this.getEmptyAnalysis();
        }
    }

    detectAffiliateLinks(links, htmlContent, networkRequests) {
        const detected = {};
        let totalAffiliateLinks = 0;

        // Initialize categories
        Object.keys(this.affiliatePatterns).forEach(network => {
            detected[network] = { count: 0, urls: [] };
        });

        // Check links
        const allUrls = [
            ...links.map(l => l.href || l),
            ...networkRequests.map(r => r.url || ''),
        ];

        for (const url of allUrls) {
            if (!url) continue;

            for (const [network, patterns] of Object.entries(this.affiliatePatterns)) {
                for (const pattern of patterns) {
                    if (url.toLowerCase().includes(pattern.toLowerCase())) {
                        detected[network].count++;
                        if (detected[network].urls.length < 3) {
                            detected[network].urls.push(url.substring(0, 80));
                        }
                        totalAffiliateLinks++;
                        break;
                    }
                }
            }
        }

        // Check HTML for affiliate patterns
        const htmlLower = htmlContent.toLowerCase();
        const hasAffiliateDisclosure = /affiliate|commission|partner program|sponsored/i.test(htmlContent);

        return {
            totalAffiliateLinks,
            byNetwork: detected,
            hasAffiliateDisclosure,
            isHeavilyAffiliated: totalAffiliateLinks > 5,
        };
    }

    detectAggressiveMonetization(scripts, iframes, htmlContent) {
        const detected = [];
        let hasPopups = false;
        let hasInterstitials = false;
        let hasPushNotifications = false;

        const allContent = [
            ...scripts.map(s => s.src || s.content || ''),
            ...iframes.map(i => i.src || ''),
            htmlContent,
        ].join(' ').toLowerCase();

        for (const pattern of this.aggressiveMonetizationPatterns) {
            if (allContent.includes(pattern)) {
                detected.push(pattern);

                if (['popunder', 'pop-under', 'popads', 'popcash'].includes(pattern)) {
                    hasPopups = true;
                }
                if (['interstitial', 'overlay-ad', 'welcome-mat'].includes(pattern)) {
                    hasInterstitials = true;
                }
                if (['pushcrew', 'pushengage', 'onesignal', 'webpush'].includes(pattern)) {
                    hasPushNotifications = true;
                }
            }
        }

        return {
            detectedPatterns: detected,
            patternCount: detected.length,
            hasPopups,
            hasInterstitials,
            hasPushNotifications,
            isAggressive: detected.length > 2 || hasPopups,
        };
    }

    detectLeadGeneration(scripts, htmlContent) {
        const detected = [];
        const allContent = [
            ...scripts.map(s => s.src || s.content || ''),
            htmlContent,
        ].join(' ').toLowerCase();

        for (const pattern of this.leadGenPatterns) {
            if (allContent.includes(pattern)) {
                detected.push(pattern);
            }
        }

        // Check for email input fields
        const hasEmailForms = /<input[^>]*type="email"/i.test(htmlContent);
        const hasNewsletterForm = /newsletter|subscribe|signup/i.test(htmlContent);

        return {
            detectedPatterns: detected,
            hasEmailForms,
            hasNewsletterForm,
            leadGenScore: Math.min(1, detected.length * 0.2 + (hasEmailForms ? 0.3 : 0)),
        };
    }

    analyzeAdNetworkDiversity(adElements, scripts) {
        const networks = new Set();

        // Known ad network patterns
        const adNetworkPatterns = {
            google: ['googlesyndication', 'doubleclick', 'googleads', 'pagead'],
            amazon: ['amazon-adsystem'],
            media_net: ['media.net'],
            taboola: ['taboola'],
            outbrain: ['outbrain'],
            criteo: ['criteo'],
            revcontent: ['revcontent'],
            mgid: ['mgid'],
            adthrive: ['adthrive'],
            mediavine: ['mediavine'],
            ezoic: ['ezoic'],
        };

        const allSources = [
            ...adElements.map(a => a.src || a.id || ''),
            ...scripts.map(s => s.src || ''),
        ].join(' ').toLowerCase();

        for (const [network, patterns] of Object.entries(adNetworkPatterns)) {
            for (const pattern of patterns) {
                if (allSources.includes(pattern)) {
                    networks.add(network);
                    break;
                }
            }
        }

        const networkCount = networks.size;

        return {
            networks: Array.from(networks),
            networkCount,
            isStackedNetworks: networkCount > 3,
            // More networks = more likely MFA (legitimate sites usually use 1-2)
            diversityScore: Math.min(1, networkCount * 0.2),
        };
    }

    calculateCommercialScore(analysis) {
        let score = 0;

        // Affiliate contribution (max 0.3)
        score += Math.min(0.3, analysis.affiliate.totalAffiliateLinks * 0.03);

        // Aggressive monetization (max 0.3)
        score += Math.min(0.3, analysis.aggressive.patternCount * 0.1);
        if (analysis.aggressive.hasPopups) score += 0.15;

        // Lead gen (max 0.15)
        score += analysis.leadGen.leadGenScore * 0.15;

        // Ad network diversity (max 0.25)
        score += analysis.adDiversity.diversityScore * 0.25;

        return Math.min(1, score);
    }

    getIntentLevel(score) {
        if (score < 0.2) return 'minimal';
        if (score < 0.4) return 'moderate';
        if (score < 0.6) return 'high';
        return 'aggressive';
    }

    detectPrimaryMonetization(affiliate, adDiversity) {
        if (affiliate.totalAffiliateLinks > 5) return 'affiliate';
        if (adDiversity.networkCount > 3) return 'display_ads';
        if (adDiversity.networkCount > 0) return 'ads';
        if (affiliate.totalAffiliateLinks > 0) return 'affiliate';
        return 'unknown';
    }

    identifyProblems(affiliate, aggressive, adDiversity) {
        const problems = [];

        if (affiliate.isHeavilyAffiliated) {
            problems.push({
                severity: 'high',
                message: `Heavy affiliate linking: ${affiliate.totalAffiliateLinks} links`,
                category: 'affiliate_abuse',
            });
        }

        if (aggressive.hasPopups) {
            problems.push({
                severity: 'critical',
                message: 'Pop-up/pop-under ads detected (strong MFA signal)',
                category: 'popup_ads',
            });
        }

        if (adDiversity.isStackedNetworks) {
            problems.push({
                severity: 'high',
                message: `Multiple ad networks: ${adDiversity.networkCount} (MFA indicator)`,
                category: 'ad_network_stacking',
            });
        }

        if (aggressive.hasInterstitials) {
            problems.push({
                severity: 'high',
                message: 'Interstitial/overlay ads detected',
                category: 'interstitial_ads',
            });
        }

        return problems;
    }

    getEmptyAnalysis() {
        return {
            timestamp: new Date().toISOString(),
            summary: {
                commercialScore: 0,
                intentLevel: 'minimal',
                isMfaSignal: false,
                primaryMonetization: 'unknown',
            },
            affiliateLinks: { totalAffiliateLinks: 0, byNetwork: {}, isHeavilyAffiliated: false },
            aggressiveMonetization: { detectedPatterns: [], hasPopups: false, isAggressive: false },
            leadGeneration: { detectedPatterns: [], hasEmailForms: false },
            adNetworkDiversity: { networks: [], networkCount: 0, isStackedNetworks: false },
            problems: [],
        };
    }

    mergeResults(analysisResult) {
        return {
            commercialIntentScore: analysisResult.summary?.commercialScore || 0,
            intentLevel: analysisResult.summary?.intentLevel || 'unknown',
            affiliateLinkCount: analysisResult.affiliateLinks?.totalAffiliateLinks || 0,
            adNetworkCount: analysisResult.adNetworkDiversity?.networkCount || 0,
            hasPopupAds: analysisResult.aggressiveMonetization?.hasPopups || false,
            isMfaCommercialSignal: analysisResult.summary?.isMfaSignal || false,
        };
    }
}

module.exports = CommercialIntentDetector;
