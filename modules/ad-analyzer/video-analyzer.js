const logger = require('../logger');

/**
 * VideoAnalyzer - Industry-standard MFA video ad detection
 * Detects: autoplay, muted autoplay, sticky/floating video, out-stream, video stuffing
 */
class VideoAnalyzer {
    constructor(config = {}) {
        this.maxAllowedPlayers = config.maxAllowedPlayers || 3;
        this.videoDomains = [
            'youtube.com', 'vimeo.com', 'dailymotion.com', 'twitch.tv',
            'jwplayer.com', 'brightcove.com', 'kaltura.com', 'connatix.com',
            'primis.tech', 'anyclip.com', 'teads.tv', 'vidazoo.com',
            'ex.co', 'springserve.com', 'spotx.tv', 'outbrain.com'
        ];

        // MFA video ad networks (high correlation with MFA)
        this.mfaVideoNetworks = [
            'connatix.com', 'primis.tech', 'anyclip.com', 'vidazoo.com',
            'ex.co', 'teads.tv', 'outbrain.com'
        ];
    }

    isVideoIframe(url) {
        if (!url) return false;
        return this.videoDomains.some(domain => url.includes(domain));
    }

    isMfaVideoNetwork(url) {
        if (!url) return false;
        return this.mfaVideoNetworks.some(domain => url.includes(domain));
    }

    /**
     * Detect autoplay patterns from various sources
     */
    detectAutoplay(element) {
        const indicators = {
            urlAutoplay: false,
            attributeAutoplay: false,
            mutedAutoplay: false,
            isAutoplay: false
        };

        const url = element.src || element.url || '';
        const attrs = element.attributes || {};

        // URL-based autoplay detection
        if (url.includes('autoplay=1') || url.includes('autoplay=true') ||
            url.includes('auto_play=1') || url.includes('muted=1')) {
            indicators.urlAutoplay = true;
        }

        // Attribute-based autoplay
        if (attrs.autoplay !== undefined || attrs.autoplay === '' || attrs.autoplay === 'true') {
            indicators.attributeAutoplay = true;
        }

        // Muted autoplay (common MFA tactic to bypass browser restrictions)
        if ((url.includes('muted=1') || url.includes('mute=1') || attrs.muted !== undefined) &&
            (indicators.urlAutoplay || indicators.attributeAutoplay)) {
            indicators.mutedAutoplay = true;
        }

        indicators.isAutoplay = indicators.urlAutoplay || indicators.attributeAutoplay;
        return indicators;
    }

    /**
     * Detect sticky/floating video players (common MFA tactic)
     */
    detectStickyVideo(element) {
        const style = element.style || '';
        const className = element.className || '';
        const id = element.id || '';

        const stickyPatterns = [
            /position:\s*fixed/i, /position:\s*sticky/i,
            /sticky/i, /floating/i, /corner/i, /pip/i
        ];

        const isStickyByStyle = stickyPatterns.some(p => p.test(style));
        const isStickyByClass = /sticky|float|corner|pip|fixed/i.test(className);
        const isStickyById = /sticky|float|corner|pip/i.test(id);

        return isStickyByStyle || isStickyByClass || isStickyById;
    }

    /**
     * Detect out-stream video ads (video ads within text content)
     */
    detectOutstream(element, adElements = []) {
        // Out-stream videos typically appear in-article, between paragraphs
        if (!element.boundingBox) return false;

        // Check if video is positioned within content area (rough heuristic)
        const { y, height } = element.boundingBox;
        const isInContentArea = y > 200 && y < 2000; // Typical article content zone
        const isSmallPlayer = height && height < 400; // Out-stream typically smaller

        return isInContentArea && isSmallPlayer;
    }

    analyze(crawlData) {
        try {
            const iframes = crawlData.iframes || [];
            const adElements = crawlData.adElements || [];
            const videoElements = crawlData.videoElements || []; // If crawler extracts <video> tags

            const videoIframes = iframes.filter(iframe => this.isVideoIframe(iframe.src));

            // Combine all video sources
            const allVideos = [...videoIframes, ...videoElements];

            let autoplayCount = 0;
            let mutedAutoplayCount = 0;
            let stickyVideoCount = 0;
            let outstreamCount = 0;
            let mfaNetworkCount = 0;
            const videoDetails = [];

            for (const video of allVideos) {
                const autoplay = this.detectAutoplay(video);
                const isSticky = this.detectStickyVideo(video);
                const isOutstream = this.detectOutstream(video, adElements);
                const isMfaNetwork = this.isMfaVideoNetwork(video.src || '');

                if (autoplay.isAutoplay) autoplayCount++;
                if (autoplay.mutedAutoplay) mutedAutoplayCount++;
                if (isSticky) stickyVideoCount++;
                if (isOutstream) outstreamCount++;
                if (isMfaNetwork) mfaNetworkCount++;

                videoDetails.push({
                    src: video.src,
                    autoplay: autoplay.isAutoplay,
                    mutedAutoplay: autoplay.mutedAutoplay,
                    sticky: isSticky,
                    outstream: isOutstream,
                    mfaNetwork: isMfaNetwork,
                    location: video.boundingBox
                });
            }

            const videoCount = allVideos.length;
            const problems = [];
            const recommendations = [];

            // Video stuffing detection
            if (videoCount > this.maxAllowedPlayers) {
                problems.push({
                    severity: 'critical',
                    type: 'video_stuffing',
                    message: `Detected ${videoCount} video players (Video Stuffing), exceeds limit of ${this.maxAllowedPlayers}`,
                    recommendation: 'Remove excessive video players to avoid MFA classification'
                });
            }

            // Muted autoplay (major MFA indicator)
            if (mutedAutoplayCount > 0) {
                problems.push({
                    severity: 'high',
                    type: 'muted_autoplay',
                    message: `Detected ${mutedAutoplayCount} muted autoplay video(s) - common MFA tactic`,
                    recommendation: 'Disable muted autoplay to improve user experience'
                });
            }

            // Sticky/floating video
            if (stickyVideoCount > 0) {
                problems.push({
                    severity: 'medium',
                    type: 'sticky_video',
                    message: `Detected ${stickyVideoCount} sticky/floating video player(s)`,
                    recommendation: 'Consider removing sticky video players'
                });
            }

            // Out-stream ads
            if (outstreamCount > 0) {
                problems.push({
                    severity: 'medium',
                    type: 'outstream_ads',
                    message: `Detected ${outstreamCount} out-stream video ad(s) in content`,
                    recommendation: 'Monitor out-stream ad placement for user experience'
                });
            }

            // MFA video networks
            if (mfaNetworkCount > 0) {
                problems.push({
                    severity: 'high',
                    type: 'mfa_video_network',
                    message: `Detected ${mfaNetworkCount} video(s) from known MFA-correlated networks`,
                    recommendation: 'Review video ad partner relationships'
                });
            }

            // Calculate MFA risk score for video
            const videoRiskScore = this.calculateVideoRiskScore({
                videoCount,
                autoplayCount,
                mutedAutoplayCount,
                stickyVideoCount,
                outstreamCount,
                mfaNetworkCount
            });

            return {
                metrics: {
                    videoPlayerCount: videoCount,
                    autoplayCount,
                    mutedAutoplayCount,
                    stickyVideoCount,
                    outstreamCount,
                    mfaNetworkCount,
                    videoPlayers: videoDetails
                },
                problems,
                recommendations: problems.map(p => p.recommendation),
                summary: {
                    videoStuffingDetected: videoCount > this.maxAllowedPlayers,
                    autoplayDetected: autoplayCount > 0,
                    mutedAutoplayDetected: mutedAutoplayCount > 0,
                    stickyVideoDetected: stickyVideoCount > 0,
                    mfaVideoRiskScore: videoRiskScore,
                    isMfaLikely: videoRiskScore > 0.5
                }
            };

        } catch (error) {
            logger.error('Error analyzing video content', error);
            return { error: error.message, metrics: {}, summary: {} };
        }
    }

    calculateVideoRiskScore(metrics) {
        let score = 0;

        // Video stuffing is critical
        if (metrics.videoCount > this.maxAllowedPlayers) score += 0.4;
        else if (metrics.videoCount > 2) score += 0.1;

        // Muted autoplay is a strong MFA indicator
        if (metrics.mutedAutoplayCount > 0) score += 0.3;
        else if (metrics.autoplayCount > 0) score += 0.15;

        // Sticky videos add to MFA likelihood
        if (metrics.stickyVideoCount > 0) score += 0.15;

        // MFA network usage
        if (metrics.mfaNetworkCount > 0) score += 0.2;

        return Math.min(1, score);
    }
}

module.exports = VideoAnalyzer;
