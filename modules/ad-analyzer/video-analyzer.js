const logger = require('../logger');

class VideoAnalyzer {
    constructor(config = {}) {
        this.maxAllowedPlayers = config.maxAllowedPlayers || 3;
        this.videoDomains = [
            'youtube.com',
            'vimeo.com',
            'dailymotion.com',
            'twitch.tv',
            'jwplayer.com',
            'brightcove.com',
            'kaltura.com',
            'connatix.com',
            'primis.tech',
            'anyclip.com'
        ];
    }

    isVideoIframe(url) {
        if (!url) return false;
        return this.videoDomains.some(domain => url.includes(domain));
    }

    analyze(crawlData) {
        try {
            const iframes = crawlData.iframes || [];
            // Note: We might need to extract <video> tags specifically in the crawler if not already present
            // For now, we rely on iframes and generic element analysis if available

            const videoIframes = iframes.filter(iframe => this.isVideoIframe(iframe.src));

            // Heuristic: Check for elements with 'video' or 'player' in ID/Class from adElements if they are not ads
            // This is a bit loose, so we'll stick to strict iframe/src checks for now to avoid false positives

            const videoCount = videoIframes.length;
            const autoplayCount = videoIframes.filter(iframe =>
                (iframe.src && iframe.src.includes('autoplay=1')) ||
                (iframe.attributes && iframe.attributes.autoplay)
            ).length;

            const problems = [];
            const recommendations = [];

            if (videoCount > this.maxAllowedPlayers) {
                problems.push({
                    severity: 'critical',
                    message: `Detected ${videoCount} video players (Video Stuffing), exceeds limit of ${this.maxAllowedPlayers}`,
                    recommendation: 'Remove excessive video players to avoid MFA classification'
                });
                recommendations.push('CRITICAL: Remove excessive video players (Video Stuffing)');
            }

            if (autoplayCount > 0) {
                problems.push({
                    severity: 'medium',
                    message: `Detected ${autoplayCount} autoplaying video players`,
                    recommendation: 'Disable autoplay to improve user experience'
                });
            }

            return {
                metrics: {
                    videoPlayerCount: videoCount,
                    autoplayCount: autoplayCount,
                    videoPlayers: videoIframes.map(v => ({ src: v.src, location: v.boundingBox }))
                },
                problems,
                recommendations,
                summary: {
                    videoStuffingDetected: videoCount > this.maxAllowedPlayers,
                    riskScore: videoCount > this.maxAllowedPlayers ? 1.0 : (autoplayCount > 0 ? 0.3 : 0)
                }
            };

        } catch (error) {
            logger.error('Error analyzing video content', error);
            return { error: error.message };
        }
    }
}

module.exports = VideoAnalyzer;
