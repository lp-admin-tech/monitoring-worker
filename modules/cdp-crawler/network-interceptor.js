/**
 * Network Interceptor
 * Captures all network requests via CDP for ad detection
 */

const logger = require('../logger');

class NetworkInterceptor {
    constructor(client) {
        this.client = client;
        this.Network = client.Network;
        this.requests = [];
        this.adRequests = [];
        this.prebidEvents = [];
        this.vastCalls = [];
        this.refreshPatterns = new Map();
        this.websockets = [];
    }

    static AD_NETWORKS = [
        // Google
        'googlesyndication.com', 'doubleclick.net', 'googleadservices.com',
        'googletag', 'securepubads', 'googleads.g.doubleclick.net',
        'pagead2.googlesyndication.com', 'adservice.google.',

        // Major SSPs
        'pubmatic.com', 'rubiconproject.com', 'openx.net', 'criteo.',
        'amazon-adsystem', 'adsystem.', 'bidswitch.net', 'casalemedia.com',

        // Ad exchanges
        'adnxs.com', 'appnexus.com', 'indexexchange.com', 'triplelift.com',
        'sharethrough.com', 'teads.tv', '33across.com', 'smartadserver.com',

        // Native/Content
        'taboola.com', 'outbrain.com', 'mgid.com', 'revcontent.com',
        'content.ad', 'zergnet.com', 'nativo.com',

        // Verification/Viewability
        'moatads.com', 'adsafeprotected.com', 'iasds01.com', 'doubleverify.com',

        // Video
        'spotxchange.com', 'springserve.com', 'jwpltx.com'
    ];

    async start() {
        logger.info('[NetworkInterceptor] Starting network capture...');

        // Listen for requests
        this.Network.requestWillBeSent((params) => {
            this.handleRequest(params);
        });

        // Listen for responses
        this.Network.responseReceived((params) => {
            this.handleResponse(params);
        });

        // WebSocket monitoring
        this.Network.webSocketCreated((params) => {
            this.websockets.push({
                url: params.url,
                timestamp: Date.now()
            });
        });

        // Request failed (useful for blocked ads)
        this.Network.loadingFailed((params) => {
            // Track if ad requests are being blocked
            const request = this.requests.find(r => r.requestId === params.requestId);
            if (request && this.isAdRequest(request.url)) {
                request.blocked = true;
                request.blockReason = params.blockedReason || params.errorText;
            }
        });

        logger.info('[NetworkInterceptor] Network capture active');
    }

    isAdRequest(url) {
        const lowerUrl = url.toLowerCase();
        return NetworkInterceptor.AD_NETWORKS.some(n => lowerUrl.includes(n));
    }

    handleRequest(params) {
        const url = params.request.url;
        const lowerUrl = url.toLowerCase();

        const request = {
            requestId: params.requestId,
            url,
            type: params.type,
            method: params.request.method,
            timestamp: params.timestamp * 1000,
            initiator: params.initiator?.type,
            initiatorUrl: params.initiator?.url
        };

        this.requests.push(request);

        // Detect ad network requests
        if (this.isAdRequest(lowerUrl)) {
            this.adRequests.push(request);
            this.trackRefreshPattern(url);

            // Log ad request
            logger.debug(`[NetworkInterceptor] Ad request: ${new URL(url).hostname}`);
        }

        // Detect Prebid
        if (lowerUrl.includes('prebid') || lowerUrl.includes('pbjs') ||
            lowerUrl.includes('/hb/') || lowerUrl.includes('header-bidding')) {
            this.prebidEvents.push(request);
        }

        // Detect VAST
        if (lowerUrl.includes('vast') || lowerUrl.includes('/ad/') ||
            lowerUrl.includes('vpaid') || lowerUrl.includes('video/ad')) {
            this.vastCalls.push(request);
        }
    }

    handleResponse(params) {
        const url = params.response.url?.toLowerCase() || '';
        const mimeType = params.response.mimeType || '';

        // Detect VAST responses by content type
        if (mimeType.includes('xml') &&
            (url.includes('vast') || url.includes('ad') || url.includes('video'))) {
            this.vastCalls.push({
                url: params.response.url,
                timestamp: Date.now(),
                type: 'VAST_RESPONSE',
                status: params.response.status
            });
        }
    }

    trackRefreshPattern(url) {
        try {
            const domain = new URL(url).hostname;
            if (!this.refreshPatterns.has(domain)) {
                this.refreshPatterns.set(domain, []);
            }
            this.refreshPatterns.get(domain).push(Date.now());
        } catch {
            // Invalid URL, skip
        }
    }

    analyzeRefreshPatterns() {
        const patterns = [];

        for (const [domain, timestamps] of this.refreshPatterns) {
            if (timestamps.length < 2) continue;

            // Sort timestamps
            timestamps.sort((a, b) => a - b);

            // Calculate intervals
            const intervals = [];
            for (let i = 1; i < timestamps.length; i++) {
                intervals.push(timestamps[i] - timestamps[i - 1]);
            }

            const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const minInterval = Math.min(...intervals);

            // Flag suspicious refresh patterns
            if (minInterval < 30000 || avgInterval < 60000) {
                patterns.push({
                    domain,
                    avgInterval: Math.round(avgInterval),
                    minInterval: Math.round(minInterval),
                    requestCount: timestamps.length,
                    suspicious: true,
                    severity: minInterval < 15000 ? 'HIGH' : 'MEDIUM'
                });
            }
        }

        return patterns;
    }

    detectSuspiciousPatterns() {
        const patterns = [];

        // Too many ad requests
        if (this.adRequests.length > 50) {
            patterns.push({
                type: 'EXCESSIVE_AD_CALLS',
                count: this.adRequests.length,
                severity: this.adRequests.length > 100 ? 'HIGH' : 'MEDIUM'
            });
        }

        // Multiple prebid auctions
        if (this.prebidEvents.length > 10) {
            patterns.push({
                type: 'MULTIPLE_PREBID_AUCTIONS',
                count: this.prebidEvents.length,
                severity: 'MEDIUM'
            });
        }

        // Auto-refresh detected
        const refreshPatterns = this.analyzeRefreshPatterns();
        if (refreshPatterns.length > 0) {
            patterns.push({
                type: 'AUTO_REFRESH_ADS',
                networks: refreshPatterns.map(p => p.domain),
                severity: refreshPatterns.some(p => p.severity === 'HIGH') ? 'HIGH' : 'MEDIUM'
            });
        }

        // Many unique ad networks (fragmented monetization)
        const uniqueNetworks = this.getUniqueAdNetworks();
        if (uniqueNetworks.length > 15) {
            patterns.push({
                type: 'FRAGMENTED_AD_STACK',
                count: uniqueNetworks.length,
                severity: 'LOW'
            });
        }

        // VAST video ads (often higher MFA indicator)
        if (this.vastCalls.length > 5) {
            patterns.push({
                type: 'EXCESSIVE_VIDEO_ADS',
                count: this.vastCalls.length,
                severity: 'MEDIUM'
            });
        }

        return patterns;
    }

    getUniqueAdNetworks() {
        const networks = new Set();

        for (const req of this.adRequests) {
            try {
                const hostname = new URL(req.url).hostname;
                // Get root domain
                const parts = hostname.split('.');
                const rootDomain = parts.slice(-2).join('.');
                networks.add(rootDomain);
            } catch {
                // Invalid URL
            }
        }

        return Array.from(networks);
    }

    getAnalysis() {
        const adNetworks = this.getUniqueAdNetworks();
        const refreshPatterns = this.analyzeRefreshPatterns();
        const suspiciousPatterns = this.detectSuspiciousPatterns();

        return {
            // Counts
            totalRequests: this.requests.length,
            adRequests: this.adRequests.length,
            prebidEvents: this.prebidEvents.length,
            vastCalls: this.vastCalls.length,
            websockets: this.websockets.length,

            // Raw requests for HAR conversion
            rawRequests: this.requests,
            rawAdRequests: this.adRequests,

            // Networks
            adNetworks,
            adNetworkCount: adNetworks.length,

            // Patterns
            refreshPatterns,
            hasAutoRefresh: refreshPatterns.some(p => p.suspicious),

            // Suspicious activity
            suspiciousPatterns,
            hasSuspiciousActivity: suspiciousPatterns.length > 0,

            // Risk score contribution
            networkRiskScore: this.calculateNetworkRiskScore(suspiciousPatterns)
        };
    }

    calculateNetworkRiskScore(patterns) {
        let score = 0;

        // Base score from ad request count
        if (this.adRequests.length > 100) score += 25;
        else if (this.adRequests.length > 50) score += 15;
        else if (this.adRequests.length > 25) score += 5;

        // Suspicious patterns
        for (const pattern of patterns) {
            switch (pattern.type) {
                case 'AUTO_REFRESH_ADS':
                    score += pattern.severity === 'HIGH' ? 30 : 20;
                    break;
                case 'EXCESSIVE_AD_CALLS':
                    score += pattern.severity === 'HIGH' ? 20 : 10;
                    break;
                case 'MULTIPLE_PREBID_AUCTIONS':
                    score += 10;
                    break;
                case 'EXCESSIVE_VIDEO_ADS':
                    score += 15;
                    break;
                case 'FRAGMENTED_AD_STACK':
                    score += 5;
                    break;
            }
        }

        return Math.min(100, score);
    }

    // Get raw data for storage
    getRawData() {
        return {
            requests: this.requests,
            adRequests: this.adRequests,
            prebidEvents: this.prebidEvents,
            vastCalls: this.vastCalls,
            websockets: this.websockets
        };
    }
}

module.exports = NetworkInterceptor;
