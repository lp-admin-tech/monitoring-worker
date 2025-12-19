const logger = require('../logger');

/**
 * TrafficArbitrageDetector - Detect traffic arbitrage signals
 * Traffic arbitrage = buying cheap traffic (social, native ads) to monetize with display ads
 * Enhanced with GAM historical data analysis for trend detection
 */
class TrafficArbitrageDetector {
    constructor(config = {}) {
        this.supabase = config.supabaseClient || null;

        // Known traffic arbitrage sources
        this.arbitrageSources = [
            // Native ad networks often used for arbitrage
            'taboola.com', 'outbrain.com', 'revcontent.com', 'mgid.com',
            'content.ad', 'zergnet.com', 'postquare.com',
            // Social traffic arbitrage 
            'facebook.com/tr', 'facebook.net/tr', // FB pixel for paid social
            'tiktok.com/i18n', 'analytics.tiktok.com',
            // Push notification services (often used for arbitrage)
            'onesignal.com', 'pushcrew.com', 'pushengage.com', 'webpushr.com',
            // Exit intent/popunder
            'exitintent', 'popunder', 'popup'
        ];

        // Redirect/cloaking patterns
        this.redirectPatterns = [
            /utm_source=(?:taboola|outbrain|mgid|revcontent)/i,
            /utm_medium=(?:native|paid|cpc|ppc)/i,
            /\?ref=(?:fb|facebook|ig|instagram|tiktok)/i,
            /gclid=/i, // Google Ads click ID
            /fbclid=/i, // Facebook click ID
            /ttclid=/i, // TikTok click ID
        ];

        // Arbitrage traffic thresholds
        this.thresholds = {
            ctrSpike: 2.0,        // 2x above average = suspicious
            ecpmDrop: 0.5,        // eCPM drop of 50% = arbitrage sign
            impressionSpike: 3.0, // 3x spike = possible bought traffic
            revenuePerSession: 0.01, // Very low revenue per impression
        };
    }

    /**
     * Comprehensive arbitrage analysis combining crawl + GAM data
     */
    async analyzeArbitrage(crawlData, publisherId = null) {
        try {
            // Crawl-based analysis
            const crawlAnalysis = this.analyzeArbitrageSignals(crawlData);

            // GAM historical analysis (if available)
            let gamAnalysis = { available: false };
            if (this.supabase && publisherId) {
                gamAnalysis = await this.analyzeGAMHistory(publisherId);
            }

            // Combine risk scores
            const combinedRiskScore = this.combineRiskScores(
                crawlAnalysis.summary?.riskScore || 0,
                gamAnalysis.riskScore || 0
            );

            // Merge problems from both sources
            const allProblems = [
                ...(crawlAnalysis.problems || []),
                ...(gamAnalysis.problems || [])
            ];

            return {
                crawlAnalysis: crawlAnalysis.metrics,
                gamAnalysis: gamAnalysis.available ? gamAnalysis.metrics : null,
                problems: allProblems,
                summary: {
                    trafficArbitrageDetected: combinedRiskScore > 0.4,
                    crawlRiskScore: crawlAnalysis.summary?.riskScore || 0,
                    gamRiskScore: gamAnalysis.riskScore || 0,
                    combinedRiskScore,
                    isMfaLikely: combinedRiskScore > 0.5,
                    gamDataAvailable: gamAnalysis.available,
                    ...crawlAnalysis.summary
                }
            };

        } catch (error) {
            logger.error('Error in comprehensive arbitrage analysis', error);
            return this.analyzeArbitrageSignals(crawlData);
        }
    }

    /**
     * Analyze GAM historical data for arbitrage patterns
     */
    async analyzeGAMHistory(publisherId, daysBack = 90) {
        try {
            if (!this.supabase) {
                return { available: false, riskScore: 0, problems: [] };
            }

            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - daysBack);

            logger.info('[TrafficArbitrage] Fetching GAM historical data', { publisherId, daysBack });

            const { data: gamData, error } = await this.supabase
                .from('reports_dimensional')
                .select('*')
                .eq('publisher_id', publisherId)
                .gte('date', startDate.toISOString().split('T')[0])
                .lte('date', endDate.toISOString().split('T')[0])
                .order('date', { ascending: false });

            if (error) {
                logger.error('[TrafficArbitrage] Error fetching GAM data', error);
                return { available: false, riskScore: 0, problems: [] };
            }

            if (!gamData || gamData.length < 7) {
                logger.info('[TrafficArbitrage] Insufficient GAM data', { records: gamData?.length });
                return { available: false, riskScore: 0, problems: [], reason: 'Insufficient data' };
            }

            // Analyze the data
            const trends = this.analyzeGAMTrends(gamData);
            const spikes = this.detectTrafficSpikes(gamData);
            const revenuePatterns = this.analyzeRevenuePatterns(gamData);

            const problems = [];
            let riskScore = 0;

            // Check for arbitrage indicators in GAM data
            if (spikes.impressionSpikeCount > 2) {
                problems.push({
                    severity: 'high',
                    type: 'impression_spikes',
                    message: `Detected ${spikes.impressionSpikeCount} unusual traffic spikes in last ${daysBack} days`,
                    recommendation: 'Traffic spikes may indicate paid/bought traffic'
                });
                riskScore += 0.25;
            }

            if (trends.ctrTrend === 'declining' && trends.impressionTrend === 'increasing') {
                problems.push({
                    severity: 'high',
                    type: 'low_quality_traffic',
                    message: 'CTR declining while impressions increasing - indicates low-quality traffic',
                    recommendation: 'Review traffic sources for quality'
                });
                riskScore += 0.3;
            }

            if (revenuePatterns.avgEcpm < 1.0 && revenuePatterns.avgCtr > 0.02) {
                problems.push({
                    severity: 'medium',
                    type: 'suspicious_ecpm_ctr',
                    message: `Low eCPM ($${revenuePatterns.avgEcpm.toFixed(2)}) with high CTR (${(revenuePatterns.avgCtr * 100).toFixed(2)}%)`,
                    recommendation: 'This pattern is common in arbitrage traffic'
                });
                riskScore += 0.2;
            }

            if (spikes.revenueVolatility > 0.5) {
                problems.push({
                    severity: 'medium',
                    type: 'volatile_revenue',
                    message: `High revenue volatility (${(spikes.revenueVolatility * 100).toFixed(0)}%)`,
                    recommendation: 'Unstable revenue suggests inconsistent traffic quality'
                });
                riskScore += 0.15;
            }

            return {
                available: true,
                riskScore: Math.min(1, riskScore),
                metrics: {
                    dataPoints: gamData.length,
                    dateRange: {
                        start: gamData[gamData.length - 1]?.date,
                        end: gamData[0]?.date
                    },
                    trends,
                    spikes,
                    revenuePatterns
                },
                problems
            };

        } catch (error) {
            logger.error('[TrafficArbitrage] Error analyzing GAM history', error);
            return { available: false, riskScore: 0, problems: [] };
        }
    }

    /**
     * Analyze GAM data trends over time
     */
    analyzeGAMTrends(gamData) {
        if (!gamData || gamData.length < 7) {
            return { ctrTrend: 'unknown', impressionTrend: 'unknown', revenueTrend: 'unknown' };
        }

        // Split data into recent (7 days) vs older
        const recent = gamData.slice(0, 7);
        const older = gamData.slice(7, Math.min(30, gamData.length));

        const calcAvg = (arr, field) => {
            const values = arr.map(r => parseFloat(r[field]) || 0);
            return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        };

        const recentImpressions = calcAvg(recent, 'impressions');
        const olderImpressions = calcAvg(older, 'impressions');
        const recentClicks = calcAvg(recent, 'clicks');
        const olderClicks = calcAvg(older, 'clicks');
        const recentRevenue = calcAvg(recent, 'revenue');
        const olderRevenue = calcAvg(older, 'revenue');

        const recentCtr = recentImpressions > 0 ? recentClicks / recentImpressions : 0;
        const olderCtr = olderImpressions > 0 ? olderClicks / olderImpressions : 0;

        const getTrend = (recent, older) => {
            if (older === 0) return 'stable';
            const change = (recent - older) / older;
            if (change > 0.2) return 'increasing';
            if (change < -0.2) return 'declining';
            return 'stable';
        };

        return {
            ctrTrend: getTrend(recentCtr, olderCtr),
            impressionTrend: getTrend(recentImpressions, olderImpressions),
            revenueTrend: getTrend(recentRevenue, olderRevenue),
            recentCtr: Math.round(recentCtr * 10000) / 100, // xx.xx%
            olderCtr: Math.round(olderCtr * 10000) / 100,
            impressionChange: older > 0 ? Math.round(((recentImpressions - olderImpressions) / olderImpressions) * 100) : 0
        };
    }

    /**
     * Detect unusual traffic spikes
     */
    detectTrafficSpikes(gamData) {
        if (!gamData || gamData.length < 7) {
            return { impressionSpikeCount: 0, revenueVolatility: 0 };
        }

        const impressions = gamData.map(r => parseInt(r.impressions) || 0);
        const revenues = gamData.map(r => parseFloat(r.revenue) || 0);

        // Calculate mean and std dev
        const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
        const stdDev = arr => {
            const m = mean(arr);
            return Math.sqrt(arr.reduce((sq, n) => sq + Math.pow(n - m, 2), 0) / arr.length);
        };

        const impMean = mean(impressions);
        const impStd = stdDev(impressions);

        // Count days with >2 std dev spike
        const impressionSpikeCount = impressions.filter(i =>
            impStd > 0 && (i - impMean) / impStd > 2
        ).length;

        // Revenue volatility (coefficient of variation)
        const revMean = mean(revenues);
        const revStd = stdDev(revenues);
        const revenueVolatility = revMean > 0 ? revStd / revMean : 0;

        return {
            impressionSpikeCount,
            revenueVolatility: Math.round(revenueVolatility * 100) / 100,
            avgImpressions: Math.round(impMean),
            impressionStdDev: Math.round(impStd)
        };
    }

    /**
     * Analyze revenue patterns for arbitrage signs
     */
    analyzeRevenuePatterns(gamData) {
        if (!gamData || gamData.length === 0) {
            return { avgEcpm: 0, avgCtr: 0, revenuePerImpression: 0 };
        }

        const totalImpressions = gamData.reduce((s, r) => s + (parseInt(r.impressions) || 0), 0);
        const totalClicks = gamData.reduce((s, r) => s + (parseInt(r.clicks) || 0), 0);
        const totalRevenue = gamData.reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0);

        const avgEcpm = totalImpressions > 0 ? (totalRevenue / totalImpressions) * 1000 : 0;
        const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
        const revenuePerImpression = totalImpressions > 0 ? totalRevenue / totalImpressions : 0;

        return {
            avgEcpm: Math.round(avgEcpm * 100) / 100,
            avgCtr: Math.round(avgCtr * 10000) / 10000,
            revenuePerImpression: Math.round(revenuePerImpression * 10000) / 10000,
            totalImpressions,
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            dataPoints: gamData.length
        };
    }

    /**
     * Combine crawler and GAM risk scores
     */
    combineRiskScores(crawlRisk, gamRisk) {
        // Weight GAM data slightly higher as it's more reliable
        if (gamRisk > 0) {
            return Math.min(1, crawlRisk * 0.4 + gamRisk * 0.6);
        }
        return crawlRisk;
    }

    /**
     * Analyze traffic sources and arbitrage signals from crawler data
     */
    analyzeArbitrageSignals(crawlData) {
        try {
            const networkRequests = this.extractNetworkRequests(crawlData);
            const referrer = crawlData.referrer || '';
            const url = crawlData.url || '';

            // Detect arbitrage sources in network requests
            const arbitrageRequests = [];
            for (const request of networkRequests) {
                const reqUrl = request.url || '';
                if (this.arbitrageSources.some(source => reqUrl.includes(source))) {
                    arbitrageRequests.push({
                        url: reqUrl,
                        source: this.identifySource(reqUrl),
                        type: request.resourceType || 'unknown'
                    });
                }
            }

            // Check for arbitrage tracking parameters in URL
            const urlArbitrageSignals = this.redirectPatterns.filter(p => p.test(url));

            // Check referrer for arbitrage sources
            const referrerSignals = this.arbitrageSources.filter(source =>
                referrer.toLowerCase().includes(source.split('/')[0])
            );

            // Analyze native widget presence (common in arbitrage)
            const nativeWidgets = this.detectNativeWidgets(crawlData);

            // Analyze content recommendation blocks
            const contentRecBlocks = this.detectContentRecBlocks(crawlData);

            // Calculate metrics
            const arbitrageSourceCount = new Set(arbitrageRequests.map(r => r.source)).size;
            const hasNativeWidgets = nativeWidgets.length > 0;
            const hasContentRecBlocks = contentRecBlocks.length > 0;
            const hasPaidTrafficSignals = urlArbitrageSignals.length > 0 || referrerSignals.length > 0;

            const problems = [];

            if (arbitrageSourceCount >= 2) {
                problems.push({
                    severity: 'high',
                    type: 'multiple_arbitrage_sources',
                    message: `Detected ${arbitrageSourceCount} traffic arbitrage sources`,
                    recommendation: 'Multiple native ad networks suggest traffic arbitrage model'
                });
            }

            if (hasNativeWidgets && contentRecBlocks.length > 2) {
                problems.push({
                    severity: 'high',
                    type: 'excessive_native_widgets',
                    message: `Detected ${contentRecBlocks.length} content recommendation blocks`,
                    recommendation: 'Excessive native widgets are a strong MFA indicator'
                });
            }

            if (hasPaidTrafficSignals && hasNativeWidgets) {
                problems.push({
                    severity: 'critical',
                    type: 'traffic_arbitrage_pattern',
                    message: 'Detected traffic arbitrage pattern (paid source + monetization)',
                    recommendation: 'Site appears to be monetizing arbitraged traffic'
                });
            }

            const riskScore = this.calculateArbitrageRisk({
                arbitrageSourceCount,
                nativeWidgetCount: nativeWidgets.length,
                contentRecBlockCount: contentRecBlocks.length,
                hasPaidTrafficSignals,
                arbitrageRequestCount: arbitrageRequests.length
            });

            return {
                metrics: {
                    arbitrageSourceCount,
                    nativeWidgetCount: nativeWidgets.length,
                    contentRecBlockCount: contentRecBlocks.length,
                    hasPaidTrafficSignals,
                    detectedSources: [...new Set(arbitrageRequests.map(r => r.source))],
                    arbitrageRequests: arbitrageRequests.slice(0, 10),
                },
                problems,
                summary: {
                    trafficArbitrageDetected: riskScore > 0.4,
                    hasNativeWidgets,
                    hasContentRecBlocks,
                    riskScore,
                    isMfaLikely: riskScore > 0.5
                }
            };

        } catch (error) {
            logger.error('Error analyzing traffic arbitrage', error);
            return { error: error.message, metrics: {}, summary: {} };
        }
    }

    extractNetworkRequests(crawlData) {
        if (crawlData.har?.log?.entries) {
            return crawlData.har.log.entries.map(e => ({
                url: e.request?.url,
                resourceType: e.request?.resourceType || e._resourceType
            }));
        }
        return crawlData.networkRequests || [];
    }

    identifySource(url) {
        const urlLower = url.toLowerCase();
        if (urlLower.includes('taboola')) return 'Taboola';
        if (urlLower.includes('outbrain')) return 'Outbrain';
        if (urlLower.includes('revcontent')) return 'RevContent';
        if (urlLower.includes('mgid')) return 'MGID';
        if (urlLower.includes('zergnet')) return 'ZergNet';
        if (urlLower.includes('facebook')) return 'Facebook Pixel';
        if (urlLower.includes('tiktok')) return 'TikTok Pixel';
        if (urlLower.includes('onesignal')) return 'OneSignal';
        return 'Unknown';
    }

    detectNativeWidgets(crawlData) {
        const adElements = crawlData.adElements || [];
        const iframes = crawlData.iframes || [];

        const nativePatterns = [
            /taboola/i, /outbrain/i, /revcontent/i, /mgid/i,
            /content-rec/i, /sponsored-content/i, /related-articles/i,
            /you-may-like/i, /recommended-for-you/i
        ];

        const widgets = [];

        for (const el of [...adElements, ...iframes]) {
            const identifier = `${el.id || ''} ${el.className || ''} ${el.src || ''}`;
            if (nativePatterns.some(p => p.test(identifier))) {
                widgets.push({ type: 'native_widget', identifier: identifier.substring(0, 100) });
            }
        }

        return widgets;
    }

    detectContentRecBlocks(crawlData) {
        const adElements = crawlData.adElements || [];

        const recPatterns = [
            /recommend/i, /related/i, /you-may-like/i, /more-stories/i,
            /sponsored-stories/i, /partner-content/i, /around-the-web/i
        ];

        const blocks = [];
        for (const el of adElements) {
            const identifier = `${el.id || ''} ${el.className || ''}`;
            if (recPatterns.some(p => p.test(identifier))) {
                blocks.push({ type: 'content_rec_block', selector: identifier.substring(0, 100) });
            }
        }

        return blocks;
    }

    calculateArbitrageRisk(metrics) {
        let score = 0;

        // Multiple arbitrage sources is strong signal
        if (metrics.arbitrageSourceCount >= 3) score += 0.4;
        else if (metrics.arbitrageSourceCount >= 2) score += 0.25;
        else if (metrics.arbitrageSourceCount >= 1) score += 0.1;

        // Content rec blocks
        if (metrics.contentRecBlockCount >= 3) score += 0.25;
        else if (metrics.contentRecBlockCount >= 1) score += 0.1;

        // Paid traffic signals with monetization
        if (metrics.hasPaidTrafficSignals) score += 0.2;

        // High number of arbitrage network requests
        if (metrics.arbitrageRequestCount >= 10) score += 0.15;

        return Math.min(1, score);
    }

    generateReport(crawlData) {
        return this.analyzeArbitrageSignals(crawlData);
    }
}

module.exports = TrafficArbitrageDetector;

